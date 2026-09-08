<script lang="ts">
  import { onDestroy } from "svelte";
  import { goto } from "$app/navigation";
  import Modal from "$lib/components/Modal.svelte";
  import Calendar from "$lib/components/Calendar.svelte";
  import { supabase } from "$lib/supabase/client";
  import { user, profile } from "$lib/stores/auth";
  import {
    CALENDAR_LOOKAHEAD_DAYS,
    HUB_CLOSE_HOUR,
    HUB_OPEN_HOUR,
    buildTimeSlots,
    getFreeHourCount,
    getSeriesDates,
    getWeeklySeriesDates,
    getMonthlySeriesDates,
    minutesToTime,
    rangesOverlap,
  } from "$lib/utils/dates";
  import { formatDate, getRoomImage, formatCurrency } from "$lib/utils/format";
  import { quoteForBooking, planReferencePrice } from "$lib/utils/pricing";
  import type { Room, Plan, Booking } from "$lib/types/database";

  export let isOpen = false;
  export let room: Room | null = null;
  export let plans: Plan[] = [];

  const BLOCKING_STATUSES = ["pending", "paid", "completed"];

  // Draft persistence for guests: an unauthenticated user can build their full
  // booking, then at "Confirm Booking" is routed through login/register. The
  // draft is stashed in sessionStorage so it survives the navigation and can be
  // restored (and the modal re-opened) when they return.
  const DRAFT_KEY = "bai_booking_draft";

  let selectedPlan: Plan | null = null;

  let selectedDate = "";
  let startTime = "";
  let endTime = "";

  let guestName = "";
  let guestEmail = "";
  let guestPhone = "";
  let purpose = "";

  let submitting = false;
  let errorMessage = "";
  let showConfirmation = false;
  let bookingReference = "";

  // Pending payment timer state
  let pendingMinutesRemaining = 0;
  let pendingTimerInterval: ReturnType<typeof setInterval> | null = null;
  let bookingCreatedTime = null;

  // Multi-step wizard: 1 = plan & date, 2 = time & details, 3 = review & confirm.
  let step = 1;

  // A signed-out browser session (guest). Guests may browse the wizard but are
  // prompted to log in / register at the details step before continuing.
  $: isGuest = !$user;

  // A Full-day or Half-day pass may book around hours another guest already
  // holds: those hours are "excluded" from the pass once the member
  // acknowledges them. Acknowledgment happens in a dedicated pop-up modal shown
  // when the member hits Continue (step 1 for full-day, step 2 for half-day),
  // so the warning is impossible to miss.
  let acknowledgedExclusions = false;
  let showExclusionModal = false;
  // Whether acknowledging the pop-up should advance a step. True when the
  // pop-up intercepted a Continue press (full-day step 1, half-day step 2 via
  // Continue); false when it appeared right after an end time was picked on
  // step 2, where the member still has form fields to fill in.
  let exclusionModalAdvances = false;

  // "View schedule" pop-up — shows the pass's calendar (scheduled day in blue,
  // partially booked with an orange dot, weekends grey, holidays sky-blue with
  // a blue dot) over the plan's chosen date window.
  let showSchedule = false;

  // Keep the readonly details fields in sync with the signed-in profile. This
  // covers the case where a guest logs in/registers mid-booking: the saved
  // draft's name/email/phone are empty, and $profile may not have loaded yet
  // when the modal resumes, so we fill them reactively once the profile loads.
  $: if ($user) {
    if ($profile?.full_name) guestName = $profile.full_name;
    if ($profile?.email) guestEmail = $profile.email;
    if ($profile?.phone) guestPhone = $profile.phone;
  }

  // Validity gates for moving forward — each step only needs what it shows,
  // so every step fits the viewport without scrolling.
  //
  // Exclusion flow: full-day fixes its time to 9–7 at step 1, so the pop-up
  // fires there; half-day picks start/end on step 2, so it fires there. Either
  // way the member must acknowledge the held hours before continuing, and a
  // range that is entirely swallowed by other guests' bookings can't proceed.
  $: ackNeeded =
    exclusionEligiblePlan &&
    selectedDate &&
    !!startTime &&
    !!endTime &&
    pendingExclusions.length > 0 &&
    !selectionCovered;
  $: canContinue1 = !!selectedPlan && !!selectedDate;
  // The acknowledgement is NOT a hard gate here — Continue stays clickable so
  // nextStep() can intercept and raise the pop-up (same as full-day on step 1).
  // ackNeeded && !acknowledgedExclusions just flips the pop-up on.
  $: canContinue2 =
    !!startTime &&
    !!endTime &&
    guestName.trim().length > 0 &&
    guestEmail.trim().length > 0 &&
    !selectionCovered;
  const lastStep = 3;

  // Friendly hints shown instead of a silently-disabled "Continue" button.
  $: step1Hints = [
    !selectedPlan ? "Select a plan to continue." : "",
    !selectedDate ? "Select a date to continue." : "",
    isFullDayPlan && selectionCovered
      ? "This day is fully booked by other guests — pick another date."
      : "",
  ].filter(Boolean);
  $: step2Hints = [
    !startTime ? "Choose a start time." : "",
    !endTime ? "Choose an end time." : "",
    !guestName.trim() ? "Enter your name." : "",
    !guestEmail.trim() ? "Enter your email." : "",
    isHalfDayPlan && selectionCovered
      ? "The time you picked is fully booked by other guests — choose a different range."
      : "",
    ackNeeded && !acknowledgedExclusions
      ? "Confirm the missing hour(s) to continue."
      : "",
  ].filter(Boolean);

  // The step that owns the time selection for the chosen plan: full-day, weekly
  // and monthly keep the whole business day fixed (9–7), so the acknowledgement
  // fires once a date is chosen on step 1; half-day picks start/end on step 2.
  $: exclusionTriggerStep =
    isFullDayPlan || isWeeklyPlan || isMonthlyPlan
      ? 1
      : isHalfDayPlan
        ? 2
        : 0;

  function nextStep() {
    // If another guest holds part of the chosen window, intercept before
    // advancing and surface the acknowledgement pop-up instead — the member
    // must explicitly agree to lose that hour before continuing.
    if (
      step === exclusionTriggerStep &&
      ackNeeded &&
      !acknowledgedExclusions
    ) {
      exclusionModalAdvances = true;
      showExclusionModal = true;
      return;
    }
    if (step < lastStep) {
      step += 1;
      // Refresh availability on reaching the time picker (so grey-outs are
      // current the moment it's shown) and the Confirm step (so the user
      // commits against the freshest snapshot).
      if ((step === 2 || step === 3) && room) {
        loadBookings();
      }
    }
  }

  function acknowledgeExclusionsAndContinue() {
    acknowledgedExclusions = true;
    showExclusionModal = false;
    if (exclusionModalAdvances) {
      exclusionModalAdvances = false;
      if (step < lastStep) {
        step += 1;
        if ((step === 2 || step === 3) && room) {
          loadBookings();
        }
      }
    }
  }

  function dismissExclusionModal() {
    showExclusionModal = false;
  }

  function openSchedule() {
    showSchedule = true;
  }

  function closeSchedule() {
    showSchedule = false;
  }

  function prevStep() {
    if (step > 1) {
      step -= 1;
      // Freshen the picker when coming back to it (e.g. from Confirm).
      if (step === 2 && room) loadBookings();
    }
  }

  function gotoStep(target: number) {
    // Only allow revisiting steps that have already been reached.
    if (target < step) {
      step = target;
      if (target === 2 && room) loadBookings();
    } else if (target === step + 1 && target <= lastStep) {
      // Jumping forward off the exclusion step must not skip the
      // acknowledgement — intercept like nextStep does.
      if (
        step === exclusionTriggerStep &&
        ackNeeded &&
        !acknowledgedExclusions
      ) {
        exclusionModalAdvances = true;
        showExclusionModal = true;
        return;
      }
      step = target;
    }
  }

  const stepTitles = ["Plan & Date", "Time & Details", "Confirm"];

  // Weekly/Monthly plans repeat the same time across several dates; keep the
  // room's blocking bookings so the calendar can mark fully-booked days.
  let bookingsByDate: Record<string, Booking[]> = {};

  $: isSeriesPlan =
    selectedPlan?.slug === "weekly" || selectedPlan?.slug === "monthly";
  // Full-day, weekly and monthly passes cover the whole business day, so their
  // time is fixed to 9 AM – 7 PM and the time selectors are hidden (the member
  // picks only a date — a month pass runs the full day it's active).
  $: fixedTimePlan =
    selectedPlan?.slug === "full-day" ||
    selectedPlan?.slug === "weekly" ||
    selectedPlan?.slug === "monthly";
  $: isFullDayPlan = selectedPlan?.slug === "full-day";
  $: isHalfDayPlan = selectedPlan?.slug === "half-day";
  $: isWeeklyPlan = selectedPlan?.slug === "weekly";
  $: isMonthlyPlan = selectedPlan?.slug === "monthly";

  // Plans allowed to book around hours another guest already holds. Hourly
  // stays a hard block (a 30/60-minute block with carved-out minutes is nearly
  // never useful).
  $: exclusionEligiblePlan =
    isFullDayPlan || isHalfDayPlan || isWeeklyPlan || isMonthlyPlan;
  // Plans whose price is reduced by excluded hours. Weekly/Monthly are flat
  // rates, so exclusions shrink their usable time but never their fee.
  $: exclusionBilledPlan = isFullDayPlan || isHalfDayPlan;

  // Auto-fill 9 AM – 7 PM for fixed-time plans once a date is picked.
  $: if (fixedTimePlan && selectedDate) {
    startTime = "09:00";
    endTime = "19:00";
  }

  // Minutes a single booking genuinely holds. A full-day pass with its own
  // recorded excluded_ranges does NOT hold those hours — they belonged to a
  // third guest instead — so they are carved out before unioning.
  function heldRanges(booking: Booking): [number, number][] {
    const start = timeToMinutes(booking.start_time);
    const end = timeToMinutes(booking.end_time);
    const exclusions = (booking.excluded_ranges ?? [])
      .map(
        (r) => [timeToMinutes(r.start_time), timeToMinutes(r.end_time)] as [
          number,
          number,
        ],
      )
      .sort((a, b) => a[0] - b[0]);

    if (exclusions.length === 0) return [[start, end]];

    const held: [number, number][] = [];
    let cursor = start;
    for (const [es, ee] of exclusions) {
      if (cursor < es) held.push([cursor, Math.min(es, end)]);
      cursor = Math.max(cursor, ee);
    }
    if (cursor < end) held.push([cursor, end]);
    return held.length > 0 ? held : [[start, end]];
  }

  // Merge a list of bookings into minimal ["HH:MM:SS", "HH:MM:SS"] ranges of
  // the hours they genuinely hold (start/end minus each booking's own
  // exclusions), clipped to the [startMin, endMin] window the caller asked for.
  function mergedTimeRangesIn(
    startMin: number,
    endMin: number,
    bookings: Booking[],
  ): { start_time: string; end_time: string }[] {
    const ranges = bookings
      .flatMap(heldRanges)
      .map(
        ([s, e]) =>
          [Math.max(s, startMin), Math.min(e, endMin)] as [number, number],
      )
      .filter(([s, e]) => s < e)
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const merged: [number, number][] = [];
    for (const [start, end] of ranges) {
      const last = merged[merged.length - 1];
      if (last && start <= last[1]) last[1] = Math.max(last[1], end);
      else merged.push([start, end]);
    }
    return merged.map(([start, end]) => ({
      start_time: minutesToTime(start),
      end_time: minutesToTime(end),
    }));
  }

  // Hours another guest already holds inside the chosen window, per date: the
  // whole 9–7 day for full-day co-owner/weekly, the picked start–end for
  // half-day. These are "excluded" — the member acknowledges them and the
  // booking goes ahead without that time. Weekly may span several dates, so the
  // hold is tracked for every date in the series; single-date plans key on the
  // selected date only.
  $: pendingExclusionsByDate = (() => {
    const hasBlockingBookings =
      !!bookingsByDate && Object.keys(bookingsByDate).length > 0;
    const theSelectedDate = selectedDate;
    const theEligible = exclusionEligiblePlan;
    const theStart = startTime;
    const theEnd = endTime;
    const theSeriesDates = seriesDates;
    void [
      hasBlockingBookings,
      theSelectedDate,
      theEligible,
      theStart,
      theEnd,
      theSeriesDates,
    ];

    if (!exclusionEligiblePlan || !selectedDate || !startTime || !endTime)
      return {} as Record<string, { start_time: string; end_time: string }[]>;
    const startMin = timeToMinutes(startTime);
    const endMin = timeToMinutes(endTime);
    const result: Record<string, { start_time: string; end_time: string }[]> =
      {};
    for (const date of relevantDays()) {
      const ranges = mergedTimeRangesIn(
        startMin,
        endMin,
        bookingsByDate[date] ?? [],
      );
      if (ranges.length > 0) result[date] = ranges;
    }
    return result;
  })();

  // Flat list across every affected date, for gating (ackNeeded) and the
  // single-date display paths.
  $: pendingExclusions = Object.values(pendingExclusionsByDate).flat();

  // Total minutes of the chosen window that are unavailable to the pass-holder.
  $: excludedMinutes = pendingExclusions.reduce(
    (total, r) =>
      total + (timeToMinutes(r.end_time) - timeToMinutes(r.start_time)),
    0,
  );

  // Total minutes the pass-holder picks (window minus exclusions). Falls back
  // to the whole business day before times are chosen (step 1 full-day view).
  $: selectedMinutes = (() => {
    if (!startTime || !endTime)
      return (HUB_CLOSE_HOUR - HUB_OPEN_HOUR) * 60;
    return timeToMinutes(endTime) - timeToMinutes(startTime);
  })();

  // Dates whose entire requested window is gone (every minute is excluded) —
  // e.g. a full day swallowed by another guest.
  $: coveredByDate = (() => {
    const result: Record<string, boolean> = {};
    if (!exclusionEligiblePlan || selectedMinutes <= 0) return result;
    for (const [date, ranges] of Object.entries(pendingExclusionsByDate)) {
      const covered = ranges.reduce(
        (total, r) =>
          total + (timeToMinutes(r.end_time) - timeToMinutes(r.start_time)),
        0,
      );
      result[date] = covered >= selectedMinutes;
    }
    return result;
  })();

  // Human-readable per-date lines for the warning pop-up and amber notes:
  // For series passes (weekly/monthly) each affected day gets its own line —
  // "12 Jan: 9:00 AM–10:00 AM, 1:00 PM–2:00 PM" with fully-booked days called
  // out as such. Single-date plans keep the date-less range list.
  $: exclusionSummaryLines = (() => {
    if (!isSeriesPlan) {
      return pendingExclusions.length > 0
        ? [formatTimeRangeList(pendingExclusions)]
        : [];
    }
    return Object.entries(pendingExclusionsByDate).map(([date, ranges]) =>
      coveredByDate[date]
        ? `${formatDate(date)}: fully booked`
        : `${formatDate(date)}: ${formatTimeRangeList(ranges)}`,
    );
  })();

  // A window with every minute excluded leaves nothing to offer. For a series
  // (weekly/monthly) a fully-booked single day is merely an excluded day (the
  // rest of the range remains bookable), so only single-date plans can be
  // "covered".
  $: selectionCovered =
    !isSeriesPlan &&
    selectedMinutes > 0 &&
    coveredByDate[selectedDate] === true;

  // True when every blocking booking overlapping the chosen window is covered
  // by an exclusion, so an eligible pass can proceed (server re-verifies).
  // Used for the submit-time re-check.
  function selectionConflictsCovered(): boolean {
    if (!exclusionEligiblePlan || !selectedDate) return false;
    if (!startTime || !endTime) return false;
    const startMin = timeToMinutes(startTime);
    const endMin = timeToMinutes(endTime);
    return relevantDays().every((date) => {
      const dayBookings = bookingsByDate[date] ?? [];
      const exclusions = mergedTimeRangesIn(startMin, endMin, dayBookings);
      return !dayBookings.some((b) => {
        const bStart = timeToMinutes(b.start_time);
        const bEnd = timeToMinutes(b.end_time);
        if (!rangesOverlap(startMin, endMin, bStart, bEnd)) return false;
        const clipS = Math.max(bStart, startMin);
        const clipE = Math.min(bEnd, endMin);
        return !exclusions.some(
          (r) =>
            timeToMinutes(r.start_time) <= clipS &&
            timeToMinutes(r.end_time) >= clipE,
        );
      });
    });
  }
  $: seriesDates =
    selectedPlan && selectedDate
      ? selectedPlan.slug === "weekly"
        ? getWeeklySeriesDates(selectedDate, bookingsByDate)
        : selectedPlan.slug === "monthly"
          ? getMonthlySeriesDates(selectedDate, bookingsByDate)
          : getSeriesDates(selectedDate, selectedPlan)
      : [];

  // All 1-hour blocks for the selected (start) date plus whether each one is
  // free, so step 1 can show the full timeline with booked hours greyed out.
  // Independent of plan duration on purpose.
  $: allHourSlots = selectedDate
    ? (buildTimeSlots(1, bookingsByDate[selectedDate] ?? []) ?? [])
    : [];
  // Free blocks only — used for the "X hours free" chip on step 1.
  $: availableHourSlots = allHourSlots.filter((s) => s.available);
  $: selectedDayFreeCount = selectedDate
    ? getFreeHourCount(bookingsByDate[selectedDate] ?? [])
    : 0;

  // Fetch this room's blocking bookings so the modal's calendar reflects real
  // availability. The browser's direct table read is RLS-restricted to the
  // caller's own bookings, so the modal prefers the server-backed helper
  // (get_room_blocking_bookings, SECURITY DEFINER) which returns every
  // pending/paid/completed booking for the room while skipping the caller's
  // own — your own holds must never look like hours "someone else took" from a
  // full-day pass. The plain query remains as a fallback for guests (who can't
  // call the helper) and for databases where the migration hasn't run yet.
  async function loadBookings() {
    if (!room) {
      bookingsByDate = {};
      return;
    }
    const today = new Date().toISOString().split("T")[0];

    let data: Booking[] | null = null;
    try {
      const { data: rpcData, error } = await supabase.rpc(
        "get_room_blocking_bookings",
        {
          p_room_id: room.id,
          p_from_date: today,
        },
      );
      if (error) throw error;
      data = (rpcData ?? []) as Booking[];
    } catch {
      let query = supabase
        .from("bookings")
        .select("id, room_id, user_id, plan_id, date, start_time, end_time, status, excluded_ranges")
        .eq("room_id", room.id)
        .gte("date", today)
        .in("status", BLOCKING_STATUSES);
      if ($user?.id) query = query.neq("user_id", $user.id);
      const { data: fallback } = await query;
      data = (fallback ?? []) as Booking[];
    }

    bookingsByDate = (data ?? []).reduce<Record<string, Booking[]>>(
      (acc, b) => {
        (acc[b.date] ??= []).push(b);
        return acc;
      },
      {},
    );
  }

  // ---- Live availability sync ---------------------------------------------
  // While the modal is open we keep hot availability fresh two ways:
  // 1. Supabase Realtime pushes on new/updated/cancelled bookings for this
  //    room (instant), and
  // 2. a 15-second poll as a reliable fallback (works even if realtime isn't
  //    enabled on the DB or a push is delivered to a stale snapshot).
  // Both funnel into loadBookings(), so every view (calendar dots, step-1
  // hour chips, step-2 greyed-out times) updates together.
  const AVAILABILITY_REFRESH_MS = 15000;

  let availabilityTimer: ReturnType<typeof setInterval> | null = null;
  let availabilityChannel: ReturnType<typeof supabase.channel> | null = null;

  // Full refetch on any realtime change beats hand-merging events: a status
  // flip to cancelled/expired must remove the row, an update may shift its
  // time, and a fresh query is always authoritative.
  function onAvailabilityChange() {
    loadBookings();
  }

  function startAvailabilitySync() {
    if (!room || !isOpen) return;

    // Polling — restart any existing interval so re-entry doesn't stack ticks.
    if (availabilityTimer) clearInterval(availabilityTimer);
    availabilityTimer = setInterval(onAvailabilityChange, AVAILABILITY_REFRESH_MS);

    // Realtime — named per room so reopening the modal reuses/replaces cleanly.
    if (availabilityChannel) void availabilityChannel.unsubscribe();
    availabilityChannel = supabase
      .channel(`room-availability-${room.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "bookings",
          filter: `room_id=eq.${room.id}`,
        },
        onAvailabilityChange,
      )
      .subscribe();
  }

  function stopAvailabilitySync() {
    if (availabilityTimer) {
      clearInterval(availabilityTimer);
      availabilityTimer = null;
    }
    if (availabilityChannel) {
      void availabilityChannel.unsubscribe();
      availabilityChannel = null;
    }
  }

  onDestroy(stopAvailabilitySync);

  // (Re)load availability whenever the modal opens or the selected room changes,
  // and keep it live via polling + realtime.
  $: if (isOpen && room) {
    loadBookings();
    startAvailabilitySync();
  }

  // Auto-fill the guest's details from their signed-in profile so they don't
  // have to retype them. Runs every time the modal opens. When a saved guest
  // draft exists for this room, restore it instead so returning users pick up
  // exactly where they left off.
  function hasDraftForRoom(): boolean {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (!raw) return false;
      const draft = JSON.parse(raw);
      return !!draft && draft.room_id === room?.id;
    } catch {
      return false;
    }
  }

  $: if (isOpen) {
    if (hasDraftForRoom()) {
      resumeDraftIfPresent();
    } else {
      if ($profile?.full_name) guestName = $profile.full_name;
      if ($profile?.email) guestEmail = $profile.email;
      if ($profile?.phone) guestPhone = $profile.phone;
    }

    // Start the 30-minute pending payment timer
    bookingCreatedTime = new Date();
    pendingMinutesRemaining = 30;
    startPendingTimer();
  } else {
    // Clear the timer when modal closes, and stop the availability sync.
    if (pendingTimerInterval) {
      clearInterval(pendingTimerInterval);
      pendingTimerInterval = null;
    }
    pendingMinutesRemaining = 0;
    bookingCreatedTime = null;
    stopAvailabilitySync();
  }

  // Business hours come from the shared availability engine so the modal's
  // bookable range always matches the rest of the app.
  const openingHour = HUB_OPEN_HOUR;
  const closingHour = HUB_CLOSE_HOUR;

  // Generate hourly time slots.
  function generateTimeSlots() {
    const slots: string[] = [];

    for (let hour = openingHour; hour <= closingHour; hour++) {
      slots.push(formatTime(hour, 0));
    }

    return slots;
  }

  const timeSlots = generateTimeSlots();

  function formatTime(hour: number, minute: number): string {
    const date = new Date();

    date.setHours(hour, minute, 0, 0);

    return date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function startPendingTimer() {
    if (pendingTimerInterval) {
      clearInterval(pendingTimerInterval);
    }
    pendingTimerInterval = setInterval(() => {
      pendingMinutesRemaining--;

      // Show warning at 5 minutes remaining
      if (pendingMinutesRemaining <= 5) {
        // Could add visual warning here
      }

      // Auto-expire after 30 minutes
      if (pendingMinutesRemaining <= 0) {
        if (pendingTimerInterval) {
            clearInterval(pendingTimerInterval);
            pendingTimerInterval = null;
        }
        // Trigger booking expiry - mark as expired
        errorMessage =
          "Your booking has expired due to pending payment timeout. The room/time slot has been released.";
        // Reset form
        selectedPlan = null;
        selectedDate = "";
        startTime = "";
        endTime = "";
        guestName = "";
        guestEmail = "";
        guestPhone = "";
        purpose = "";
        step = 1;
        pendingMinutesRemaining = 0;
        bookingCreatedTime = null;
      }
    }, 60000); // 1 minute intervals
  }

  function timeToMinutes(time: string): number {
    const [hours, minutes] = time.split(":").map(Number);

    return hours * 60 + minutes;
  }

  function formatDisplayTime(time: string): string {
    if (!time) return "";

    const [hours, minutes] = time.split(":").map(Number);

    return formatTime(hours, minutes);
  }

  function formatTimeRangeList(
    ranges: { start_time: string; end_time: string }[],
  ): string {
    return ranges
      .map((r) => `${formatDisplayTime(r.start_time)}\u2013${formatDisplayTime(r.end_time)}`)
      .join(", ");
  }

  function getTimeValue(displayTime: string): string {
    const date = new Date(`1970-01-01 ${displayTime}`);

    const hours = date.getHours();
    const minutes = date.getMinutes();

    return minutesToTime(hours * 60 + minutes);
  }

  // A candidate time range is "booked" if it overlaps any blocking booking on
  // the relevant day(s). For single-day plans we check just the selected date;
  // for Weekly/Monthly series we check every day in the series (the chosen
  // time must be free on all of them, mirroring buildSeriesTimeSlots).
  function isSlotBooked(startMin: number, endMin: number): boolean {
    const days =
      isSeriesPlan && seriesDates.length > 0
        ? seriesDates
        : selectedDate
          ? [selectedDate]
          : [];
    // For series plans a slot is only usable if it's free on every day; for a
    // single day we simply check that day. Overlap on any relevant day.
    const conflictingDays = days.filter((date) =>
      (bookingsByDate[date] ?? []).some((b) =>
        rangesOverlap(
          startMin,
          endMin,
          timeToMinutes(b.start_time),
          timeToMinutes(b.end_time),
        ),
      ),
    );
    // A slot is unavailable if it conflicts on any checked day.
    return conflictingDays.length > 0;
  }

  // Human-readable message when the picked slot was just claimed by another
  // guest (client-side re-check or a 409 from the server). Names the exact
  // date(s)/time so the warning is unambiguous.
  function slotConflictMessage(): string {
    const window = `${formatDisplayTime(startTime)}\u2013${formatDisplayTime(endTime)}`;
    if (isSeriesPlan && seriesDates.length > 1) {
      return `The time you picked (${formatDate(seriesDates[0])} \u2192 ${formatDate(seriesDates[seriesDates.length - 1])}, ${window}) was just claimed by another booking on one of the days in your range. Slots are first come, first served \u2014 please pick another time.`;
    }
    return `The time you picked (${formatDate(selectedDate)}, ${window}) was just booked by someone else. Slots are first come, first served \u2014 please pick another time.`;
  }

  // The Hourly plan only allows a 30-minute or 1-hour block, so its end options
  // are limited to start +30min and start +60min. Used by the end picker below.
  $: isHourlyPlan = selectedPlan?.slug === "hourly";

  const closeMin = HUB_CLOSE_HOUR * 60;

  // Maximum minutes a booking can span for the chosen plan. The plan duration
  // is a CAP, not a fixed block — end times are chosen freely below and pricing
  // bills the actual hours used — so a start slot only needs SOME usable end
  // time, not the plan's full stated duration. Weekly/Monthly cover the whole
  // business day, so their block is capped at one business day rather than
  // their raw (40h/176h) duration.
  $: planBlockMinutes = !selectedPlan
    ? 60
    : selectedPlan.slug === "weekly" || selectedPlan.slug === "monthly"
      ? closeMin - HUB_OPEN_HOUR * 60
      : selectedPlan.duration_hours * 60;

  // The date(s) a chosen time must be free on.
  function relevantDays(): string[] {
    return isSeriesPlan && seriesDates.length > 0
      ? seriesDates
      : selectedDate
        ? [selectedDate]
        : [];
  }

  // A candidate END time is usable for a half-day pass when it doesn't fall
  // within another guest's block AND the resulting window still has usable
  // minutes. Blocks are carved out (excluded) rather than hard-blocking: e.g.
  // with 1–2 PM already booked, a 10 AM start may still end at 2 PM or later —
  // the 1–2 PM hour is simply excluded from the pass.
  //
  // Any start/end time that lands within a held block (its start boundary
  // included) is greyed as booked so the pickers show exactly which hours are
  // taken — 1:00 PM and 1:30 PM for a 1–2 PM hold — while 2 PM onward remains
  // selectable. Ends may additionally land on a block's far boundary.
  function endUsableForExclusionPlan(
    bookings: Booking[],
    startMin: number,
    endMin: number,
  ): boolean {
    if (endMin - startMin <= 0) return false;
    if (
      bookings.some(
        (b) =>
          startMin >= timeToMinutes(b.start_time) &&
          startMin < timeToMinutes(b.end_time),
      )
    )
      return false;
    if (
      bookings.some(
        (b) =>
          endMin >= timeToMinutes(b.start_time) &&
          endMin < timeToMinutes(b.end_time),
      )
    )
      return false;
    const exclusions = mergedTimeRangesIn(startMin, endMin, bookings);
    const covered = exclusions.reduce(
      (total, r) =>
        total + (timeToMinutes(r.end_time) - timeToMinutes(r.start_time)),
      0,
    );
    return covered < endMin - startMin;
  }

  // True if there is at least one valid end time after `startMin` — an hourly
  // end slot within business hours, no later than start + plan duration — that
  // doesn't overlap a blocking booking on every relevant day. Mirrors the end
  // picker so a start time is only disabled when it genuinely can't be used:
  // e.g. a Half-day pass may start at 4 PM and end at 7 PM, even though
  // start + plan duration would run past closing.
  function hasFreeEnd(startMin: number): boolean {
    const days = relevantDays();
    const maxEnd = Math.min(closeMin, startMin + planBlockMinutes);
    if (maxEnd <= startMin) return false;
    return timeSlots.some((time) => {
      const end = timeToMinutes(getTimeValue(time));
      if (end <= startMin || end > maxEnd) return false;
      return days.every((date) => {
        const books = bookingsByDate[date] ?? [];

        // Half-day and monthly passes may span an existing block (it gets
        // excluded); a start slot is usable as soon as one usable end exists
        // afterward on every day of the range.
        if (isHalfDayPlan || isMonthlyPlan) {
          return endUsableForExclusionPlan(books, startMin, end);
        }

        const conflicts = books.some((b) =>
          rangesOverlap(
            startMin,
            end,
            timeToMinutes(b.start_time),
            timeToMinutes(b.end_time),
          ),
        );
        return !conflicts;
      });
    });
  }

  // Start times that are unavailable, plus the reason shown beside each:
  // "After closing" when no block can fit before the hub closes, "Booked"
  // when every possible end time overlaps an existing booking. Free times stay
  // selectable even if the plan's full stated duration wouldn't fit before
  // closing — the end time is chosen freely within business hours.
  //
  // NOTE: we must read `bookingsByDate`, `selectedDate`, `isSeriesPlan` and
  // `seriesDates` here directly so Svelte's reactive compiler tracks them as
  // dependencies. They're the values actually used (via hasFreeEnd) to decide
  // availability, and without an explicit reference the block would not re-run
  // when booking data or the chosen date changes.
  $: startSlotStatus = (() => {
    const hasBlockingBookings =
      !!bookingsByDate && Object.keys(bookingsByDate).length > 0;
    const theSelectedDate = selectedDate;
    const theIsSeriesPlan = isSeriesPlan;
    const theSeriesDates = seriesDates;
    const theIsHalfDayPlan = isHalfDayPlan;
    const theIsMonthlyPlan = isMonthlyPlan;
    const thePlanBlockMinutes = planBlockMinutes;
    void [
      hasBlockingBookings,
      theSelectedDate,
      theIsSeriesPlan,
      theSeriesDates,
      theIsHalfDayPlan,
      theIsMonthlyPlan,
      thePlanBlockMinutes,
    ];

    const statusByValue = new Map<string, string>();
    for (const time of timeSlots) {
      const value = getTimeValue(time);
      const start = timeToMinutes(value);
      if (start >= closeMin) {
        statusByValue.set(value, "After closing");
      } else if (!hasFreeEnd(start)) {
        statusByValue.set(value, "Booked");
      }
    }
    return statusByValue;
  })();

  $: availableEndTimes = (() => {
    if (!startTime) return [];

    // Same explicit-dependency trick as startSlotStatus: read the booking/date
    // state so Svelte re-runs this when availability changes.
    const hasBlockingBookings =
      !!bookingsByDate && Object.keys(bookingsByDate).length > 0;
    const theSelectedDate = selectedDate;
    const theIsSeriesPlan = isSeriesPlan;
    const theSeriesDates = seriesDates;
    const theIsHalfDayPlan = isHalfDayPlan;
    const theIsMonthlyPlan = isMonthlyPlan;
    void [
      hasBlockingBookings,
      theSelectedDate,
      theIsSeriesPlan,
      theSeriesDates,
      theIsHalfDayPlan,
      theIsMonthlyPlan,
    ];

    const start = timeToMinutes(startTime);

    if (isHourlyPlan) {
      return [30, 60]
        .map((offsetMin) => {
          const endValue = minutesToTime(start + offsetMin);
          const display = formatDisplayTime(endValue);
          return {
            time: display,
            endValue,
            booked: isSlotBooked(start, start + offsetMin),
            hint: offsetMin === 30 ? "30 minutes" : "1 hour",
          };
        })
        .filter(
          ({ endValue }) => timeToMinutes(endValue) <= HUB_CLOSE_HOUR * 60,
        );
    }

    // Half-day and monthly pick free start/end times; a chosen range may span an
    // existing block (it gets excluded), so an end is greyed only when it falls
    // inside a held block or leaves no usable minutes on ANY day of the range.
    if ((isHalfDayPlan || isMonthlyPlan) && selectedDate) {
      return timeSlots
        .filter((time) => getTimeValue(time) > startTime)
        .map((time) => {
          const endValue = getTimeValue(time);
          const usable = relevantDays().every((date) =>
            endUsableForExclusionPlan(
              bookingsByDate[date] ?? [],
              start,
              timeToMinutes(endValue),
            ),
          );
          return {
            time,
            endValue,
            booked: !usable,
            hint: undefined,
          };
        });
    }

    return timeSlots
      .filter((time) => getTimeValue(time) > startTime)
      .map((time) => {
        const endValue = getTimeValue(time);
        return {
          time,
          endValue,
          booked: isSlotBooked(start, timeToMinutes(endValue)),
          hint: undefined,
        };
      });
  })();

  // Duration between start and end. For a pass with excluded hours, the hours
  // another guest holds are subtracted — e.g. 10 AM–7 PM full-day with 10–11 AM
  // taken shows "9 hours".
  $: bookingDuration =
    startTime && endTime
      ? formatDuration(
          timeToMinutes(endTime) -
            timeToMinutes(startTime) -
            (exclusionBilledPlan ? excludedMinutes : 0),
        )
      : "";

  // Plan chip text in the header/summary — also shows the reduced hours when a
  // pass had part of the window excluded.
  $: selectedPlanLabel = selectedPlan
    ? exclusionBilledPlan && excludedMinutes > 0
      ? `${selectedPlan.name} · ${formatDuration(
          selectedMinutes - excludedMinutes,
        )}`
      : `${selectedPlan.name} · ${selectedPlan.duration_label}`
    : "";

  // Live price quote based on room, plan, and selected times. For a pass with
  // excluded hours, the hours another guest already holds are removed, so the
  // fee is based on the hours that remain usable.
  $: quote =
    room && startTime && endTime
      ? quoteForBooking(
          room,
          selectedPlan,
          startTime,
          endTime,
          exclusionBilledPlan ? excludedMinutes : 0,
        )
      : null;

  // The same window priced WITHOUT exclusions, to show the saving in the pop-up
  // (e.g. "Fee for the remaining hours: $315 [struck-through $350]").
  $: fullDayFullPriceQuote =
    room && selectedPlan && startTime && endTime
      ? quoteForBooking(room, selectedPlan, startTime, endTime, 0)
      : null;

  function formatDuration(difference: number): string {
    if (difference <= 0) return "";

    const hours = Math.floor(difference / 60);
    const minutes = difference % 60;

    if (minutes === 0) {
      return `${hours} hour${hours !== 1 ? "s" : ""}`;
    }

    return `${hours} hour${hours !== 1 ? "s" : ""} ${minutes} minute${minutes !== 1 ? "s" : ""}`;
  }

  // Custom dropdown state (native <option> can't render mixed text colors).
  let startOpen = false;
  let endOpen = false;

  function selectStartTime(value: string) {
    startTime = value;
    endTime = "";
    acknowledgedExclusions = false;
    startOpen = false;
  }

  function selectEndTime(value: string) {
    endTime = value;
    acknowledgedExclusions = false;
    endOpen = false;

    // Half-day/monthly: the instant the picked end spans an hour another guest
    // holds, raise the same "Unavailable to you" pop-up full-day shows —
    // computed here directly because the reactive values haven't flushed within
    // this handler. For a monthly series, any affected day in the range counts.
    if (
      (isHalfDayPlan || isMonthlyPlan) &&
      selectedDate &&
      startTime
    ) {
      const startMin = timeToMinutes(startTime);
      const endMin = timeToMinutes(value);
      if (endMin > startMin) {
        const hasExclusion = relevantDays().some((date) => {
          const exclusions = mergedTimeRangesIn(
            startMin,
            endMin,
            bookingsByDate[date] ?? [],
          );
          const covered = exclusions.reduce(
            (total, r) =>
              total + (timeToMinutes(r.end_time) - timeToMinutes(r.start_time)),
            0,
          );
          return exclusions.length > 0 && covered < endMin - startMin;
        });
        if (hasExclusion) {
          exclusionModalAdvances = false;
          showExclusionModal = true;
        }
      }
    }
  }

  function selectPlan(plan: Plan) {
    selectedPlan = plan;
    // Reset date/time when switching plans — a start date valid for one plan
    // may not express the same series for another.
    selectedDate = "";
    startTime = "";
    endTime = "";
    acknowledgedExclusions = false;
  }

  function close() {
    isOpen = false;

    // Reset form after closing.
    selectedPlan = null;
    selectedDate = "";
    startTime = "";
    endTime = "";

    guestName = "";
    guestEmail = "";
    guestPhone = "";
    purpose = "";

    errorMessage = "";
    showConfirmation = false;
    bookingReference = "";
    acknowledgedExclusions = false;

    step = 1;
  }

  // Persist the current selection so a guest can resume it after login/register.
  function saveDraft() {
    try {
      sessionStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({
          room_id: room?.id ?? null,
          plan_id: selectedPlan?.id ?? null,
          date: selectedDate,
          start_time: startTime,
          end_time: endTime,
          guest_name: guestName,
          guest_email: guestEmail,
          guest_phone: guestPhone,
          purpose,
        }),
      );
    } catch {
      // Ignore storage failures (e.g. private mode).
    }
  }

  function clearDraft() {
    try {
      sessionStorage.removeItem(DRAFT_KEY);
    } catch {
      // Ignore.
    }
  }

  // Route a guest to login/register, saving their in-progress selection so the
  // booking modal is restored (and pre-populated) when they finish auth.
  function routeGuestToAuth(href: string) {
    saveDraft();
    goto(href);
  }

  // Restore a previously saved guest draft for this room and jump to the
  // confirm step. Exposed so the page can call it after auth return.
  export function resumeDraftIfPresent() {
    if (!room) return;
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw);
      if (!draft || draft.room_id !== room.id) return;

      selectedPlan =
        plans.find((p) => p.id === draft.plan_id) ??
        (draft.plan_id ? null : selectedPlan);
      selectedDate = draft.date ?? "";
      startTime = draft.start_time ?? "";
      endTime = draft.end_time ?? "";
      purpose = draft.purpose ?? "";

      // The guest's name/email/phone are intentionally NOT restored from the
      // draft: for signed-in users they always come from the profile (the
      // fields are read-only and filled reactively), and for guests they are
      // empty anyway. Restoring empties here would clobber the profile values.

      // Restored vs fresh detection for the page: leave the draft in place;
      // it is cleared on a successful booking or when the modal closes.
      if (draft && draft.plan_id && draft.date) {
        step = 2;
        loadBookings();
      }
    } catch {
      // Ignore malformed drafts.
    }
  }

  async function submitBooking() {
    errorMessage = "";

    if (!room) {
      errorMessage = "No room selected.";
      return;
    }

    if (!selectedPlan) {
      errorMessage = "Please select a booking plan.";
      return;
    }

    if (!selectedDate) {
      errorMessage = "Please select a date.";
      return;
    }

    if (!startTime) {
      errorMessage = "Please select a start time.";
      return;
    }

    if (!endTime) {
      errorMessage = "Please select an end time.";
      return;
    }

    if (timeToMinutes(endTime) <= timeToMinutes(startTime)) {
      errorMessage = "End time must be after start time.";
      return;
    }

    if (!guestName.trim()) {
      errorMessage = "Please enter your name.";
      return;
    }

    if (!guestEmail.trim()) {
      errorMessage = "Please enter your email.";
      return;
    }

    // Client-side re-check against the freshest available snapshot we have.
    // The server re-validates too, but catching it here avoids relying on a
    // possibly stale snapshot taken when the modal opened (another booking may
    // have claimed this slot since). Abort early and send the user back to the
    // time step so they can pick an open slot.
    const startMin = timeToMinutes(startTime);
    const endMin = timeToMinutes(endTime);
    const stillFree = exclusionEligiblePlan
      ? selectionConflictsCovered()
      : isSeriesPlan
        ? !seriesDates.some((d) =>
            (bookingsByDate[d] ?? []).some((b) =>
              rangesOverlap(
                startMin,
                endMin,
                timeToMinutes(b.start_time),
                timeToMinutes(b.end_time),
              ),
            ),
          )
        : !isSlotBooked(startMin, endMin);
    if (!stillFree) {
      errorMessage = exclusionEligiblePlan
        ? "Another guest just booked time on this day. Please review the updated hours and confirm again."
        : slotConflictMessage();
      gotoStep(2);
      loadBookings();
      return;
    }

    submitting = true;

    try {
      // Get the currently logged-in user's Supabase session
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError || !session?.access_token) {
        errorMessage = "";
        submitting = false;
        // Guest flow: save their in-progress selection and route them through
        // auth. On return (returnTo=/#book) the page re-opens this modal and
        // restores the draft so they can pick up exactly where they left off.
        saveDraft();
        goto(`/auth/login?returnTo=${encodeURIComponent("/#book")}`);
        return;
      }

      const response = await fetch("/api/bookings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          room_id: room.id,
          plan_id: selectedPlan.id,

          // Weekly/Monthly book every day in the series; single-day
          // plans send a one-element array.
          dates: isSeriesPlan ? seriesDates : [selectedDate],

          start_time: startTime,
          end_time: endTime,

          // A pass with excluded hours acknowledges the hours already held by other
          // guests; every other plan sends an empty list. Weekly/Monthly span
          // several dates, so their exclusions are sent per date.
          excluded_ranges: isSeriesPlan
            ? []
            : exclusionEligiblePlan
              ? pendingExclusions
              : [],
          ...(isSeriesPlan
            ? { excluded_ranges_by_date: pendingExclusionsByDate }
            : {}),

          guest_name: guestName.trim(),
          guest_email: guestEmail.trim(),
          guest_phone: guestPhone.trim() || null,
          purpose: purpose.trim() || null,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        if (response.status === 409) {
          // The slot was claimed between the client check and the server
          // insert (race). Refresh availability so the now-taken slot renders
          // as booked, and return the user to the time step to pick another.
          errorMessage = exclusionEligiblePlan
            ? result.message || slotConflictMessage()
            : slotConflictMessage();
          loadBookings();
          acknowledgedExclusions = false;
          gotoStep(2);
          submitting = false;
          return;
        }
        throw new Error(result.message || "Unable to create booking.");
      }

      const bookings = Array.isArray(result?.bookings) ? result.bookings : [];
      const first = bookings[0];
      bookingReference = (first?.booking_number as string | undefined) ?? (first?.id as string | undefined) ??"";

      // Show a dedicated confirmation view instead of auto-closing so the
      // member can see exactly what was submitted and what happens next.
      errorMessage = "";
      clearDraft();
      showConfirmation = true;
      step = 4;
    } catch (error) {
      errorMessage =
        error instanceof Error
          ? error.message
          : "Something went wrong while creating your booking.";
    } finally {
      submitting = false;
    }
  }
</script>

<Modal
  size="lg"
  bind:isOpen
  title={room ? `Book ${room.name}` : "Book a Room"}
  on:close={close}
>
  {#if room}
    <!-- Room context strip (kept small so every step fits the viewport) -->
    <div
      class="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary-100 bg-primary-50 px-4 py-3"
    >
      <div class="flex min-w-0 items-center gap-3">
        <img
          src={getRoomImage(room.name)}
          alt={room.name}
          class="h-10 w-12 rounded-md object-cover"
        />
        <div class="min-w-0">
          <h3 class="truncate text-sm font-semibold text-dark-900">
            {room.name}
          </h3>
          <p class="text-xs text-dark-500">
            Up to {room.capacity} people · {formatCurrency(
              room.price_per_hour,
            )}/hour
          </p>
        </div>
      </div>
      {#if selectedPlan}
        <span
          class="rounded-full bg-primary-100 px-3 py-1 text-xs text-primary-800"
        >
          {selectedPlanLabel}
        </span>
      {/if}
    </div>

    <!-- Progress indicator -->
    {#if step <= 3}
      <div class="mb-6 flex items-center gap-2 text-xs font-medium">
        {#each stepTitles as title, i}
          {@const stepNum = i + 1}
          {#if i > 0}
            <span class="h-px flex-1 bg-primary-100"></span>
          {/if}
          <button
            type="button"
            on:click={() => gotoStep(stepNum)}
            disabled={stepNum > step}
            class="disabled:cursor-default"
            aria-current={step === stepNum ? "step" : undefined}
          >
            <span class="flex items-center gap-1.5">
              <span
                class={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${
                  step === stepNum
                    ? "bg-primary-600 text-white"
                    : step > stepNum
                      ? "bg-primary-50 text-primary-700"
                      : "bg-dark-200 text-dark-600"
                }`}>{stepNum}</span
              >
              <span
                class={step === stepNum ? "text-primary-700" : "text-dark-500"}
                >{title}</span
              >
            </span>
          </button>
        {/each}
      </div>
    {/if}

    <!-- Sticky summary (business hours + chosen plan, no rates) -->
    {#if step <= 3}
      <div
        class="mb-6 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-dark-200 bg-white px-3 py-2 text-xs text-dark-600"
      >
        <span class="inline-flex items-center gap-1.5">
          <svg
            class="h-3.5 w-3.5 text-primary-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          Open {formatDisplayTime(minutesToTime(HUB_OPEN_HOUR * 60))} – {formatDisplayTime(
            minutesToTime(HUB_CLOSE_HOUR * 60),
          )}
        </span>
        <span class="inline-flex items-center gap-1.5">
          <span class="h-1.5 w-1.5 rounded-full bg-primary-500"></span>
          {#if selectedPlan}
            {selectedPlanLabel}
          {:else}
            No plan selected yet
          {/if}
          {#if isSeriesPlan && seriesDates.length > 1}
            <span class="text-dark-400">· {seriesDates.length} days</span>
          {/if}
        </span>
      </div>
    {/if}

    <!-- Error/warning banner — rendered on every step so conflict messages
         remain visible after bouncing the user back to the time picker. -->
    {#if errorMessage}
      <div
        class="mb-6 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        role="alert"
      >
        <span aria-hidden="true" class="mt-0.5">!</span>
        <span>{errorMessage}</span>
      </div>
    {/if}

    <!-- Full-day pass exclusions are surfaced in a dedicated pop-up modal
         (see the overlay at the bottom of this component) the moment the
         member hits Continue on step 1, so the missing-hour warning is
         impossible to miss. -->

    <!-- STEP 1: Plan & Date -->
    {#if step === 1}
      <div class="grid gap-8 sm:grid-cols-2">
        <!-- Plan -->
        <div>
          <p class="mb-4 text-sm font-semibold text-dark-900">Choose a Plan</p>

          <div class="space-y-3">
            {#each plans as plan}
              <button
                type="button"
                class={`flex w-full items-center justify-between gap-4 rounded-xl border p-4 text-left transition ${
                  selectedPlan?.id === plan.id
                    ? "border-primary-500 bg-primary-50 ring-1 ring-primary-500"
                    : "border-dark-200 bg-white hover:border-dark-300"
                }`}
                on:click={() => selectPlan(plan)}
              >
                <div class="min-w-0">
                  <div class="font-semibold text-dark-900">
                    {plan.name}
                  </div>
                  {#if plan.description}
                    <p class="mt-0.5 text-xs text-dark-500">
                      {plan.description}
                    </p>
                  {/if}
                </div>
                <div class="shrink-0 text-right">
                  <div class="font-bold text-dark-900">
                    {formatCurrency(planReferencePrice(room, plan))}
                  </div>
                  <div class="mt-0.5 text-xs text-dark-500">
                    {plan.duration_label}
                  </div>
                </div>
              </button>
            {/each}
          </div>

          {#if selectedDate}
            <div
              class="mt-6 rounded-xl border border-primary-100 bg-primary-50 p-4"
            >
              <div
                class="mb-2 flex flex-wrap items-center justify-between gap-2"
              >
                <p class="text-sm font-medium text-dark-700">
                  Available hours on
                  <span class="font-semibold text-dark-900"
                    >{formatDate(selectedDate)}</span
                  >
                </p>
                {#if selectedDayFreeCount > 0 && availableHourSlots.length > 0}
                  <span
                    class="rounded-full bg-primary-100 px-2.5 py-0.5 text-xs font-medium text-primary-800"
                  >
                    {selectedDayFreeCount} hour{selectedDayFreeCount === 1
                      ? ""
                      : "s"} free
                  </span>
                {/if}
              </div>
              {#if allHourSlots.length > 0}
                <div class="flex flex-wrap gap-1.5">
                  {#each allHourSlots as slot}
                    <span
                      class="rounded-md border px-2 py-1 text-xs font-medium {slot.available
                        ? "border-primary-200 bg-white text-primary-800"
                        : "border-dark-200 bg-dark-50 text-dark-300 line-through"}"
                      title={slot.available
                        ? "Available"
                        : "Already booked"}
                    >
                      {slot.label}
                    </span>
                  {/each}
                </div>
              {/if}
              {#if availableHourSlots.length === 0}
                <p class="text-xs text-dark-500">
                  No 1-hour blocks available on this day.
                </p>
              {/if}
              <p class="mt-2 text-xs text-dark-400">
                {isSeriesPlan && seriesDates.length > 1
                  ? "Preview shows the start date. The time you pick must be free across all days in the range."
                  : "This is just a preview — pick your exact time on the next step."}
              </p>
              <div
                class="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800"
              >
                Free hours are shown for guidance only — bookings are first come,
                first served. If another guest confirms this time before you do,
                it's no longer available.
              </div>
            </div>
          {/if}

          {#if isSeriesPlan && seriesDates.length > 1}
            <div
              class="mt-4 rounded-xl border border-primary-100 bg-primary-50 p-4"
            >
              <p
                class="flex flex-wrap items-baseline gap-x-2 text-sm text-dark-600"
              >
                <span class="font-medium">
                  {isWeeklyPlan || isMonthlyPlan
                    ? "Weekdays"
                    : "Daily block"}:
                </span>
                <span class="font-semibold text-dark-900">
                  {formatDate(seriesDates[0])} → {formatDate(
                    seriesDates[seriesDates.length - 1],
                  )}
                </span>
                <span class="text-dark-500">
                  ({seriesDates.length} days{isWeeklyPlan
                    ? " · Mon–Fri"
                    : isMonthlyPlan
                      ? " · weekdays"
                      : ""})
                </span>
              </p>
              <p class="mt-0.5 text-xs text-dark-500">
                The same time you pick applies to every day in this range.
              </p>
            </div>
          {/if}
        </div>

        <!-- Date -->
        <div>
          <p class="mb-3 text-sm font-medium text-dark-600">
            {isSeriesPlan ? "Select Start Date" : "Select Date"}
          </p>

          {#if isSeriesPlan}
            <p class="mb-3 text-xs text-dark-500">
              {selectedPlan?.slug === "weekly"
                ? "Repeats weekdays only (Mon\u2013Fri) from your start date."
                : "Repeats daily for the month from your start date."}
            </p>
          {/if}

          <Calendar
            {bookingsByDate}
            {selectedDate}
            rangeDates={isSeriesPlan ? seriesDates : []}
            lookaheadDays={CALENDAR_LOOKAHEAD_DAYS}
            on:selectDate={(e) => {
              selectedDate = e.detail;
              acknowledgedExclusions = false;
              // Freshen the preview/count the moment a day is picked so it
              // reflects any booking made since the last refresh.
              loadBookings();
            }}
          />

          <div class="mt-4 flex flex-wrap items-center justify-between gap-3">
            {#if step1Hints.length > 0}
              <div class="space-y-0.5 text-xs text-dark-500">
                {#each step1Hints as hint}
                  <p>• {hint}</p>
                {/each}
              </div>
            {/if}
            <button
              type="button"
              class="btn-primary px-6 py-2.5 disabled:cursor-not-allowed disabled:opacity-50 ml-auto"
              disabled={!canContinue1}
              on:click={nextStep}
            >
              Continue
            </button>
          </div>
        </div>
      </div>
    {/if}

    <!-- STEP 2: Time & Details -->
    {#if step === 2}
      <div class="grid gap-8 sm:grid-cols-2">
        <!-- Time -->
        <div>
          <p class="mb-3 text-sm font-medium text-dark-600">
            {fixedTimePlan ? "Time" : "Select Time"}
          </p>

          {#if fixedTimePlan}
            <div
              class="rounded-xl border border-primary-100 bg-primary-50 p-4 text-sm text-dark-700"
            >
              This {selectedPlan?.name?.toLowerCase() ?? "pass"} covers the whole
              business day
              <span class="font-semibold text-dark-900">
                {formatDisplayTime(startTime)} – {formatDisplayTime(endTime)}
              </span>.

              {#if pendingExclusions.length > 0}
                <div
                  class="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800"
                >
                  <p class="font-semibold">Unavailable to you:</p>
                  <ul class="mt-1 space-y-0.5">
                    {#each exclusionSummaryLines as line}
                      <li>• {line}</li>
                    {/each}
                  </ul>
                  <p class="mt-1">
                    — already booked by another guest, so you can't use the room
                    during that time.
                  </p>
                  {#if !acknowledgedExclusions}
                    <label
                      class="mt-2 flex cursor-pointer items-start gap-2 font-medium"
                    >
                      <input
                        type="checkbox"
                        bind:checked={acknowledgedExclusions}
                        class="mt-px accent-amber-600"
                      />
                      I understand this time is booked and give it up — proceed
                      anyway.
                    </label>
                  {/if}
                </div>
              {/if}
            </div>
          {:else}
            <div class="grid grid-cols-1 gap-4">
              <div>
                <label
                  for="start-time"
                  class="mb-1.5 block text-xs text-dark-500"
                >
                  Start Time
                </label>
                <div class="relative">
                  <button
                    id="start-time"
                    type="button"
                    class="input flex w-full items-center justify-between text-left disabled:cursor-not-allowed disabled:opacity-50"
                    on:click={() => {
                      startOpen = !startOpen;
                      // Refresh the moment the picker opens so booked rows
                      // are greyed out against the freshest data.
                      if (startOpen) loadBookings();
                    }}
                  >
                    <span
                      >{startTime
                        ? formatDisplayTime(startTime)
                        : "Select start time"}</span
                    >
                    <span class="ml-2 text-dark-400"
                      >{startOpen ? "▲" : "▼"}</span
                    >
                  </button>
                  {#if startOpen}
                    <button
                      type="button"
                      tabindex="-1"
                      aria-hidden="true"
                      class="fixed inset-0 z-20 cursor-default"
                      on:click={() => (startOpen = false)}
                    ></button>
                    <div
                      class="absolute z-30 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-dark-200 bg-white shadow-lg"
                    >
                      {#each timeSlots as time}
                        {@const value = getTimeValue(time)}
                        {@const status = startSlotStatus.get(value) ?? ""}
                        <button
                          type="button"
                          class="block w-full px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:bg-dark-100/70 disabled:text-dark-300 disabled:line-through disabled:hover:bg-transparent enabled:hover:bg-dark-50"
                          class:bg-primary-50={value === startTime}
                          disabled={!!status}
                          on:click={() => selectStartTime(value)}
                        >
                          {time}
                          {#if status}
                            <span
                              class="ml-1 font-medium {status === 'Booked'
                                ? 'text-red-600'
                                : 'text-dark-400'}"
                              >({status})</span
                            >
                          {/if}
                        </button>
                      {/each}
                    </div>
                  {/if}
                </div>
              </div>

              <div>
                <label
                  for="end-time"
                  class="mb-1.5 block text-xs text-dark-500"
                >
                  End Time
                </label>
                <div class="relative">
                  <button
                    id="end-time"
                    type="button"
                    class="input flex w-full items-center justify-between text-left disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!startTime}
                    on:click={() => {
                      endOpen = !endOpen;
                      // Same as start: freshen before showing available ends.
                      if (endOpen) loadBookings();
                    }}
                  >
                    <span
                      >{endTime
                        ? formatDisplayTime(endTime)
                        : startTime
                          ? "Select end time"
                          : "Select start time first"}</span
                    >
                    <span class="ml-2 text-dark-400">{endOpen ? "▲" : "▼"}</span
                    >
                  </button>
                  {#if endOpen}
                    <button
                      type="button"
                      tabindex="-1"
                      aria-hidden="true"
                      class="fixed inset-0 z-20 cursor-default"
                      on:click={() => (endOpen = false)}
                    ></button>
                    <div
                      class="absolute z-30 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-dark-200 bg-white shadow-lg"
                    >
                      {#each availableEndTimes as { time, endValue, booked, hint }}
                        <button
                          type="button"
                          class="block w-full px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:bg-dark-100/70 disabled:text-dark-300 disabled:line-through disabled:hover:bg-transparent enabled:hover:bg-dark-50"
                          class:bg-primary-50={endValue === endTime}
                          disabled={booked}
                          on:click={() => selectEndTime(endValue)}
                        >
                          {time}
                          {#if hint}
                            <span class="ml-1.5 text-xs text-dark-400"
                              >({hint})</span
                            >
                          {/if}
                          {#if booked}
                            <span class="font-medium text-red-600"
                              >(Booked)</span
                            >
                          {/if}
                        </button>
                      {/each}
                    </div>
                  {/if}
                </div>
              </div>
            </div>
          {/if}

          {#if isHalfDayPlan && pendingExclusions.length > 0}
            <div
              class="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800"
            >
              <p class="font-semibold">Unavailable to you:</p>
              <ul class="mt-1 space-y-0.5">
                {#each exclusionSummaryLines as line}
                  <li>• {line}</li>
                {/each}
              </ul>
              <p class="mt-1">
                — already booked by another guest, so you can't use the room
                during that time. The rest of your time stays available.
              </p>
              {#if !acknowledgedExclusions}
                <label
                  class="mt-2 flex cursor-pointer items-start gap-2 font-medium"
                >
                  <input
                    type="checkbox"
                    bind:checked={acknowledgedExclusions}
                    class="mt-px accent-amber-600"
                  />
                  I understand this time is booked and give it up — proceed
                  anyway.
                </label>
              {/if}
            </div>
          {/if}

          {#if bookingDuration}
            <div
              class="mt-4 inline-flex items-center rounded-lg bg-primary-50 border border-primary-100 px-3 py-2 text-sm text-primary-800"
            >
              Duration:
              <span class="ml-1.5 font-semibold text-dark-900"
                >{bookingDuration}</span
              >
            </div>
          {/if}

          {#if quote}
            <div class="mt-4 rounded-xl border border-primary-200 bg-white p-4">
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-xs text-dark-500">Estimated total</p>
                  <p class="text-xs text-dark-400">{quote.label}</p>
                </div>
                <p class="text-2xl font-bold text-dark-900">
                  {formatCurrency(quote.total)}
                </p>
              </div>
            </div>
            <button
              type="button"
              on:click={openSchedule}
              class="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-primary-200 bg-white px-4 py-2.5 text-sm font-semibold text-primary-700 transition hover:bg-primary-50"
            >
              <svg
                class="h-4 w-4 text-primary-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
              View schedule
            </button>
          {/if}

          {#if !fixedTimePlan}
            <p class="mt-4 text-xs text-dark-500">
              Greyed-out times marked
              <span class="ml-1.5 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700">(Booked)</span> are already
              taken and can't be selected. Bookings are first come, first served —
              a free-looking time can be claimed by another guest at any moment,
              so availability may change before you confirm.
            </p>
            <p class="mt-1 text-[11px] text-dark-400">
              Availability refreshes automatically — new bookings appear here in
              real time.
            </p>
          {/if}
        </div>

        <!-- Details -->
        <div class="rounded-xl border border-primary-100 bg-primary-50 p-5">
          {#if isGuest}
            <!-- Guest (not logged in): prompt to authenticate before details -->
            <div class="flex flex-col items-center text-center">
              <div
                class="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary-100"
              >
                <svg
                  class="h-6 w-6 text-primary-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                  />
                </svg>
              </div>
              <h3 class="text-sm font-semibold text-dark-900">
                Log in or register to continue
              </h3>
              <p class="mt-1.5 text-sm text-dark-600">
                Your selected room, plan, date and time will be saved. Once
                logged in, your details will be filled in automatically and
                you can finish your booking.
              </p>
              <div class="mt-4 flex w-full flex-col gap-2">
                <button
                  type="button"
                  class="btn-primary w-full py-2.5"
                  on:click={() => routeGuestToAuth("/auth/login?returnTo=" + encodeURIComponent("/#book"))}
                >
                  Login
                </button>
                <button
                  type="button"
                  class="rounded-lg border border-primary-300 bg-white px-6 py-2.5 text-sm font-semibold text-primary-700 transition hover:bg-primary-50"
                  on:click={() => routeGuestToAuth("/auth/register?returnTo=" + encodeURIComponent("/#book"))}
                >
                  Register
                </button>
              </div>
            </div>
          {:else}
            <div class="space-y-4">
              <h3 class="text-sm font-semibold text-dark-900">Your Details</h3>

              <div>
                <label for="guest-name" class="mb-1.5 block text-xs text-dark-500"
                  >Full Name</label
                >
                <input
                  id="guest-name"
                  type="text"
                  bind:value={guestName}
                  placeholder="Enter your full name"
                  readonly
                  class="input disabled:cursor-not-allowed"
                />
                <p class="mt-1 text-xs text-dark-500">
                  Filled from your account profile.
                </p>
              </div>

              <div>
                <label for="guest-email" class="mb-1.5 block text-xs text-dark-500"
                  >Email</label
                >
                <input
                  id="guest-email"
                  type="email"
                  bind:value={guestEmail}
                  placeholder="Enter your email"
                  readonly
                  class="input disabled:cursor-not-allowed"
                />
              </div>

              <div>
                <label for="guest-phone" class="mb-1.5 block text-xs text-dark-500"
                  >Phone</label
                >
                <input
                  id="guest-phone"
                  type="tel"
                  bind:value={guestPhone}
                  placeholder="Enter your phone number"
                  readonly
                  class="input disabled:cursor-not-allowed"
                />
              </div>

              <div>
                <label for="purpose" class="mb-1.5 block text-xs text-dark-500"
                  >Purpose</label
                >
                <textarea
                  id="purpose"
                  bind:value={purpose}
                  rows="3"
                  placeholder="What will you use the room for?"
                  class="input resize-none"
                ></textarea>
              </div>
            </div>
          {/if}
        </div>
      </div>

      <div class="mt-6 flex items-center justify-between gap-4">
        <button
          type="button"
          class="rounded-lg border border-dark-300 px-6 py-2.5 text-sm font-medium text-dark-600 transition hover:bg-dark-100"
          on:click={prevStep}
        >
          Back
        </button>
        {#if step2Hints.length > 0}
          <div class="flex-1 space-y-0.5 text-xs text-dark-500 text-right">
            {#each step2Hints as hint}
              <p>• {hint}</p>
            {/each}
          </div>
        {/if}
        <button
          type="button"
          class="btn-primary px-6 py-2.5 disabled:cursor-not-allowed disabled:opacity-50 shrink-0"
          disabled={!canContinue2}
          on:click={nextStep}
        >
          Continue
        </button>
      </div>
    {/if}

    <!-- STEP 3: Review & Confirm -->
    {#if step === 3}
      <div class="rounded-xl border border-primary-100 bg-primary-50 p-5">
        <h3 class="mb-4 text-sm font-semibold text-dark-900">
          Review your booking
        </h3>

        <div class="space-y-3 text-sm">
          <div class="flex justify-between gap-4">
            <span class="text-dark-500">Room</span>
            <span class="font-medium text-dark-900">{room.name}</span>
          </div>
          <div class="flex justify-between gap-4">
            <span class="text-dark-500">Plan</span>
            <span class="font-medium text-dark-900">{selectedPlan?.name}</span>
          </div>
          <div class="flex justify-between gap-4">
            <span class="text-dark-500">Date</span>
            {#if isSeriesPlan && seriesDates.length > 1}
              <span class="text-right font-medium text-dark-900">
                {seriesDates.length} days<br />
                <span class="text-xs text-dark-500">
                  {formatDate(seriesDates[0])} → {formatDate(
                    seriesDates[seriesDates.length - 1],
                  )}
                </span>
              </span>
            {:else}
              <span class="font-medium text-dark-900">{selectedDate}</span>
            {/if}
          </div>
          <div class="flex justify-between gap-4">
            <span class="text-dark-500">Time</span>
            <div class="text-right">
              <span class="font-medium text-dark-900">
                {formatDisplayTime(startTime)} – {formatDisplayTime(endTime)}
              </span>
              {#if pendingExclusions.length > 0}
                <p
                  class="mt-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-800"
                >
                  &#9888; Cannot use room:
                  {exclusionSummaryLines.join(" \u00b7 ")} (booked by another
                  guest)
                </p>
              {/if}
            </div>
          </div>
          <div class="flex justify-between gap-4">
            <span class="text-dark-500">Duration</span>
            <span class="font-medium text-dark-900">{bookingDuration}</span>
          </div>
          {#if pendingMinutesRemaining > 0}
            <div class="mt-1 flex justify-between gap-4">
              <span class="text-dark-500">Time remaining</span>
              <span class="font-medium text-primary-600"
                >{pendingMinutesRemaining} min</span
              >
            </div>
          {/if}
          {#if pendingMinutesRemaining === 10}
            <div class="mt-1 text-xs text-dark-500">
              Payment reminder: displayed at 10 minutes after booking creation,
              leaving ~5 minutes before expiration.
            </div>
          {/if}
          {#if quote}
            <div
              class="mt-1 flex justify-between gap-4 rounded-lg bg-white px-3 py-2"
            >
              <span class="text-dark-500">Charge</span>
              <span class="text-right">
                <span class="block text-sm font-semibold text-dark-900"
                  >{quote.label}</span
                >
                <span class="block text-xs text-dark-500"
                  >{formatCurrency(quote.total)}</span
                >
              </span>
            </div>
          {/if}
          <div class="flex justify-between gap-4">
            <span class="text-dark-500">Name</span>
            <span class="font-medium text-dark-900">{guestName}</span>
          </div>
          <div class="flex justify-between gap-4">
            <span class="text-dark-500">Email</span>
            <span class="truncate font-medium text-dark-900">{guestEmail}</span>
          </div>
          {#if purpose}
            <div class="flex justify-between gap-4">
              <span class="text-dark-500">Purpose</span>
              <span class="text-right font-medium text-dark-900">{purpose}</span
              >
            </div>
          {/if}
        </div>
      </div>

      <div class="mt-6 flex items-center justify-between">
        <button
          type="button"
          class="rounded-lg border border-dark-300 px-6 py-2.5 text-sm font-medium text-dark-600 transition hover:bg-dark-100"
          on:click={prevStep}
        >
          Back
        </button>
        <button
          type="button"
          class="btn-primary px-6 py-2.5 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={submitting}
          on:click={submitBooking}
        >
          {#if submitting}
            Submitting Booking…
          {:else}
            Confirm Booking
          {/if}
        </button>
      </div>

      <p class="mt-3 text-center text-xs text-dark-500">
        This reserves the {seriesDates.length > 1
          ? `${seriesDates.length} days`
          : "slot"} pending payment. Payment must be completed within 30 minutes
        or the booking will automatically expire and the room/time slot will be released.
      </p>
      <p class="mt-1 text-center text-xs text-dark-400">
        If someone else books this same time before you confirm, you'll be
        returned to the time step with a warning and can pick another slot.
      </p>
      <div class="mt-2 text-center text-xs text-dark-500">
        Available hours: 9:00 AM – 7:00 PM Mon–Fri
      </div>
      {#if selectedPlan?.slug !== "full-day" && selectedPlan?.slug !== "weekly"}
        <p class="mt-2 text-center text-xs text-dark-500">
          Payment reminder will be displayed at approximately 2-5 minutes after
          booking creation, leaving approximately 5 minutes before expiration.
        </p>
      {/if}
    {/if}

    <!-- STEP 4: Confirmation -->
    {#if step === 4 && showConfirmation}
      <div
        class="rounded-xl border border-green-200 bg-green-50 p-6 text-center"
      >
        <div
          class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-100"
        >
          <svg
            class="h-8 w-8 text-green-700"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>
        <h3 class="text-lg font-semibold text-dark-900">
          Booking request submitted
        </h3>
        <p class="mt-1 text-sm text-dark-600">
          Your booking is now pending payment. Once you pay, the room is
          confirmed and your booking is approved. Please complete payment within
          30 minutes or the booking will be released.
        </p>
        <p class="mt-2 text-sm font-medium text-primary-700">
          This slot is now held for you while it's pending — no one else can
          book it.
        </p>
        {#if bookingReference}
          <p class="mt-2 text-xs text-dark-500">
            Reference:
            <span class="font-mono font-semibold text-dark-700"
            >{bookingReference}</span
          >
          </p>
        {/if}
      </div>

      <div class="mt-4 rounded-xl border border-primary-100 bg-primary-50 p-5">
        <h4 class="mb-3 text-sm font-semibold text-dark-900">Summary</h4>
        <div class="space-y-2.5 text-sm">
          <div class="flex justify-between gap-4">
            <span class="text-dark-500">Room</span>
            <span class="font-medium text-dark-900">{room.name}</span>
          </div>
          <div class="flex justify-between gap-4">
            <span class="text-dark-500">Plan</span>
            <span class="font-medium text-dark-900">{selectedPlan?.name}</span>
          </div>
          <div class="flex justify-between gap-4">
            <span class="text-dark-500">Date</span>
            {#if isSeriesPlan && seriesDates.length > 1}
              <span class="text-right font-medium text-dark-900">
                {seriesDates.length} days<br />
                <span class="text-xs text-dark-500">
                  {formatDate(seriesDates[0])} → {formatDate(
                    seriesDates[seriesDates.length - 1],
                  )}
                </span>
              </span>
            {:else}
              <span class="font-medium text-dark-900"
                >{formatDate(selectedDate)}</span
              >
            {/if}
          </div>
          <div class="flex justify-between gap-4">
            <span class="text-dark-500">Time</span>
            <div class="text-right">
              <span class="font-medium text-dark-900">
                {formatDisplayTime(startTime)} – {formatDisplayTime(endTime)}
              </span>
              {#if pendingExclusions.length > 0}
                <p
                  class="mt-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-800"
                >
                  &#9888; Cannot use room:
                  {exclusionSummaryLines.join(" \u00b7 ")} (booked by another
                  guest)
                </p>
              {/if}
            </div>
          </div>
          {#if purpose}
            <div class="flex justify-between gap-4">
              <span class="text-dark-500">Purpose</span>
              <span class="text-right font-medium text-dark-900">{purpose}</span
              >
            </div>
          {/if}
        </div>
      </div>

      <div class="mt-6">
        <button type="button" class="btn-primary w-full" on:click={close}>
          Done
        </button>
      </div>
    {/if}
  {/if}
</Modal>

<!-- Pass exclusion pop-up — shown over the booking modal when the member tries
     to continue while part of the requested time (full-day/day, half-day range,
     or weekly series) is already held by another guest. -->

{#if showExclusionModal && isOpen && exclusionEligiblePlan && selectedDate && pendingExclusions.length > 0}
  <div
    class="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
    role="dialog"
    aria-modal="true"
    aria-labelledby="exclusion-modal-title"
  >
    <div class="w-full max-w-md overflow-y-auto rounded-2xl bg-white shadow-2xl">
      <div class="flex items-start justify-between gap-3 border-b border-amber-200 bg-amber-50 px-5 py-4">
        <h3
          id="exclusion-modal-title"
          class="flex items-center gap-2 text-sm font-bold text-amber-900"
        >
          <span aria-hidden="true" class="flex h-8 w-8 items-center justify-center rounded-full bg-amber-400/30 text-lg font-black text-amber-700">
            !
          </span>
          {selectionCovered ? "No time available" : "Part of your time is already booked"}
        </h3>
        <button
          type="button"
          on:click={dismissExclusionModal}
          class="rounded-lg p-1.5 text-amber-600 transition hover:bg-amber-100"
          aria-label="Close"
        >
          <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div class="space-y-4 px-5 py-5">
        {#if selectionCovered}
          <p class="text-sm text-dark-700">
            {formatDate(selectedDate)}
            {#if startTime && endTime}
              , {formatDisplayTime(startTime)} – {formatDisplayTime(endTime)},
            {/if}
            is fully booked by other guests during your requested time — there's
            nothing for your {selectedPlan?.name?.toLowerCase() ?? "pass"} to
            offer here. Please pick another time.
          </p>
          <button
            type="button"
            class="btn-primary w-full justify-center"
            on:click={dismissExclusionModal}
          >
            OK, pick another time
          </button>
        {:else}
          <p class="text-sm font-medium text-dark-900">
            {#if isSeriesPlan}
              Some days in your {isWeeklyPlan ? "week" : "month"} are already
              booked by other guests — that time won't be available to you in
              the room.
            {:else}
              {formatTimeRangeList(pendingExclusions)} on
              {formatDate(selectedDate)} is already booked by another guest —
              that time won't be available to you on that day in the room.
            {/if}
          </p>
          <p class="text-sm text-dark-700">
            Would you still like to book your
            {selectedPlan?.name?.toLowerCase() ?? "pass"}? The booked time will
            be
            <span class="font-semibold text-amber-800">excluded</span> from
            your pass — you won't be able to use the room then. The days and
            hours that are free remain yours.
          </p>

          <div class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            <p class="font-semibold">Unavailable to you:</p>
            <ul class="mt-1 space-y-0.5">
              {#each exclusionSummaryLines as line}
                <li>• {line}</li>
              {/each}
            </ul>
            <p class="mt-1">
              Your pass covers {formatDisplayTime(startTime)} –{" "}
              {formatDisplayTime(endTime)}
              {#if bookingDuration}
                · Duration: <span class="font-semibold">{bookingDuration}</span>
              {/if}
            </p>
            {#if fullDayFullPriceQuote && quote && quote.total !== fullDayFullPriceQuote.total}
              <p class="mt-1">
                Fee for the remaining hours:
                <span class="font-semibold">{formatCurrency(quote.total)}</span>
                <span class="line-through text-amber-500">
                  {formatCurrency(fullDayFullPriceQuote.total)}
                </span>
              </p>
            {/if}
          </div>

          <div class="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              class="btn-secondary px-4 py-2"
              on:click={dismissExclusionModal}
            >
              Not now
            </button>
            <button
              type="button"
              class="btn-primary px-4 py-2"
              on:click={acknowledgeExclusionsAndContinue}
            >
              I understand — proceed
            </button>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<!-- Schedule pop-up — shown from the "View schedule" button under the estimated
     total. A read-only calendar of the pass's chosen date window: the scheduled
     day is blue, partially booked days carry an orange dot, weekends are grey,
     and public holidays are sky-blue with a blue dot. -->
{#if showSchedule && isOpen && selectedDate && room}
  <div
    class="fixed inset-0 z-[60] overflow-y-auto bg-black/60 backdrop-blur-sm p-4"
    role="dialog"
    aria-modal="true"
    aria-labelledby="schedule-modal-title"
  >
    <div class="flex min-h-full items-center justify-center">
      <div class="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div class="flex items-center justify-between border-b border-dark-100 px-4 py-3.5">
          <h3 id="schedule-modal-title" class="text-sm font-bold text-dark-900">
            Schedule for {room.name}
          </h3>
          <button
            type="button"
            on:click={closeSchedule}
            class="rounded-lg p-1.5 text-dark-500 transition hover:bg-dark-100"
            aria-label="Close"
          >
            <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div class="p-4">
          <p class="mb-2.5 text-xs text-dark-500">
            {#if isSeriesPlan && seriesDates.length > 1}
              Your {selectedPlan?.name?.toLowerCase() ?? "pass"} runs
              {formatDate(seriesDates[0])} → {formatDate(seriesDates[seriesDates.length - 1])}.
            {:else}
              Your scheduled date is
              <span class="font-semibold text-dark-700">{formatDate(selectedDate)}</span>.
            {/if}
          </p>
          <Calendar
            {bookingsByDate}
            {selectedDate}
            rangeDates={isSeriesPlan ? seriesDates : []}
            lookaheadDays={CALENDAR_LOOKAHEAD_DAYS}
            initialDate={selectedDate}
            readonly
            compact
            hideFullyBooked
          />
          <button
            type="button"
            on:click={closeSchedule}
            class="btn-primary mt-3 flex w-full items-center justify-center px-4 py-2 text-sm font-semibold"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}
