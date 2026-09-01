<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { supabase } from '$lib/supabase/client';
  import { user, profile, isLoading } from '$lib/stores/auth';
  import type { Booking, Membership, MembershipUsage, Review, Report, Room, Plan } from '$lib/types/database';
  import { formatDate, formatTime, formatDuration, formatCurrency } from '$lib/utils/format';
  import { getStatusMeta, getReportStatusMeta } from '$lib/utils/booking';
  import { quoteForStoredBooking, usageMeter } from '$lib/utils/pricing';
  import { groupBookings, dateRangeLabel } from '$lib/utils/booking-groups';
  import { isWeekend } from '$lib/utils/dates';
  import { isVictorianHoliday } from '$lib/utils/holidays';
  import Modal from '$lib/components/Modal.svelte';

  let bookings: Booking[] = [];
  let reviews: Review[] = [];
  let reports: Report[] = [];
  let membership: Membership | null = null;
  let membershipUsage: MembershipUsage[] = [];
  let loading = true;
  let activeTab: 'upcoming' | 'past' | 'reviews' | 'reports' = 'upcoming';

  let showReviewModal = false;
  let reviewBooking: Booking | null = null;
  let reviewRating = 5;
  let reviewComment = '';
  let reviewLoading = false;

  let showReportModal = false;
  let reportBooking: Booking | null = null;
  let reportSubject = '';
  let reportDescription = '';
  let reportLoading = false;

  let showRescheduleModal = false;
  let rescheduleGroup: MemberGroup | null = null;
  let rescheduleDate = '';
  let rescheduleTime = '';
  let rescheduleLoading = false;
  let rescheduleError = '';

  let showCancelModal = false;
  let cancelGroup: MemberGroup | null = null;
  let cancelLoading = false;

  async function postApi(path: string, payload: unknown): Promise<boolean> {
    const {
      data: { session }
    } = await supabase.auth.getSession();
    if (!session?.access_token) return false;
    const res = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`
      },
      body: JSON.stringify(payload)
    });
    return res.ok;
  }

  $: isLoggedIn = !!$user;
  $: reviewedBookingIds = new Set(reviews.map((r) => r.booking_id));

  $: if (!$isLoading && !isLoggedIn) {
    goto('/auth/login');
  }

  onMount(async () => {
    await loadData();
  });

  async function loadData() {
    const [bookingsRes, reviewsRes, reportsRes, membershipRes, usageRes] = await Promise.all([
      supabase
        .from('bookings')
        .select('*, room:rooms(*), plan:plans(*)')
        .eq('user_id', $user!.id)
        .order('date', { ascending: false }),
      supabase
        .from('reviews')
        .select('*, room:rooms(name)')
        .eq('user_id', $user!.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('reports')
        .select('*')
        .eq('user_id', $user!.id)
        .order('created_at', { ascending: false }),
      supabase.from('memberships').select('*').eq('user_id', $user!.id).maybeSingle(),
      supabase
        .from('membership_usage')
        .select('*')
        .order('period_start', { ascending: false })
    ]);

    bookings = bookingsRes.data ?? [];
    reviews = reviewsRes.data ?? [];
    reports = reportsRes.data ?? [];
    membership = (membershipRes.error ? null : membershipRes.data) ?? null;
    membershipUsage = usageRes.data ?? [];
    loading = false;
  }

  function openCancelModal(group: MemberGroup) {
    cancelGroup = group;
    showCancelModal = true;
  }

  async function submitCancel() {
    if (!cancelGroup) return;
    cancelLoading = true;

    let ok = true;
    for (const b of cancelGroup.bookings) {
      const r = await postApi('/api/bookings/status', {
        bookingId: b.id,
        status: 'cancelled'
      });
      if (!r) ok = false;
    }

    cancelLoading = false;
    showCancelModal = false;
    cancelGroup = null;

    if (ok) await loadData();
  }

  function openReviewModal(booking: Booking) {
    reviewBooking = booking;
    reviewRating = 5;
    reviewComment = '';
    showReviewModal = true;
  }

  async function submitReview() {
    if (!reviewBooking) return;
    reviewLoading = true;

    const { error } = await supabase
      .from('reviews')
      .insert({
        user_id: $user!.id,
        room_id: reviewBooking.room_id,
        booking_id: reviewBooking.id,
        rating: reviewRating,
        comment: reviewComment || null
      });

    reviewLoading = false;
    showReviewModal = false;

    if (!error) await loadData();
  }

  function openReportModal(booking: Booking | null = null) {
    reportBooking = booking;
    reportSubject = '';
    reportDescription = '';
    showReportModal = true;
  }

  async function submitReport() {
    reportLoading = true;

    const ok = await postApi('/api/reports', {
      booking_id: reportBooking?.id || null,
      subject: reportSubject,
      description: reportDescription
    });

    reportLoading = false;
    showReportModal = false;

    if (ok) await loadData();
  }

  function openRescheduleModal(group: MemberGroup) {
    rescheduleGroup = group;
    rescheduleDate = group.dates[0];
    rescheduleTime = group.bookings[0].start_time;
    rescheduleError = '';
    showRescheduleModal = true;
  }

  async function submitReschedule() {
    if (!rescheduleGroup) return;

    if (isWeekend(rescheduleDate) || isVictorianHoliday(rescheduleDate)) {
      rescheduleError = 'The hub is closed on that day (weekend or public holiday). Please pick an open weekday.';
      return;
    }
    rescheduleError = '';
    rescheduleLoading = true;

    const group = rescheduleGroup;
    const [h, m] = rescheduleTime.split(':').map(Number);
    const rep = group.bookings[0];
    const duration = Math.abs(
      (rep.end_time.split(':').map(Number)[0] * 60 + rep.end_time.split(':').map(Number)[1]) -
      (rep.start_time.split(':').map(Number)[0] * 60 + rep.start_time.split(':').map(Number)[1])
    );
    const endMinutes = h * 60 + m + duration;
    const endH = Math.floor(endMinutes / 60);
    const endM = endMinutes % 60;
    const endTime = `${endH.toString().padStart(2, '0')}:${endM.toString().padStart(2, '0')}`;

    const msPerDay = 86400000;
    const delta = Math.round(
      (new Date(rescheduleDate + 'T00:00:00').getTime() - new Date(group.dates[0] + 'T00:00:00').getTime()) / msPerDay
    );

    let ok = true;
    for (const b of group.bookings) {
      const d = new Date(b.date + 'T00:00:00');
      d.setDate(d.getDate() + delta);
      const newDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const r = await postApi('/api/bookings/status', {
        bookingId: b.id,
        date: newDate,
        start_time: rescheduleTime,
        end_time: endTime,
        status: 'pending'
      });
      if (!r) ok = false;
    }

    rescheduleLoading = false;
    showRescheduleModal = false;
    rescheduleGroup = null;

    if (ok) await loadData();
  }

  interface MemberGroup {
    key: string;
    room?: Room;
    plan?: Plan;
    bookings: Booking[];
    dates: string[];
    status: Booking['status'];
    isSeries: boolean;
  }

  // Weekly/Monthly create one booking row per date, but they are a single
  // purchase. Group them back into one "series" so each pass shows as a single
  // card listing its assigned days. See lib/utils/booking-groups.ts.
  $: allBookingGroups = groupBookings(bookings);

  // A pass is "upcoming" while it is active (not cancelled/completed) and at
  // least one of its days is today or later; otherwise it belongs to "past".
  $: upcomingGroups = allBookingGroups.filter(g => {
    const today = new Date().toISOString().split('T')[0];
    const active = g.status !== 'cancelled' && g.status !== 'completed';
    return active && g.dates.some(d => d >= today);
  });

  $: pastGroups = allBookingGroups.filter(g => !upcomingGroups.includes(g));

  $: memberTabs = [
    { key: 'upcoming', label: 'Upcoming', count: upcomingGroups.length },
    { key: 'past', label: 'Past', count: pastGroups.length },
    { key: 'reviews', label: 'Reviews', count: reviews.length },
    { key: 'reports', label: 'Reports', count: reports.length },
  ] as { key: 'upcoming' | 'past' | 'reviews' | 'reports'; label: string; count: number }[];

  $: confMeter = membership?.is_active ? usageMeter(membership, membershipUsage, 'conference-room') : null;
  $: meetMeter = membership?.is_active ? usageMeter(membership, membershipUsage, 'meeting-room') : null;
</script>

<svelte:head>
  <title>My Dashboard - BAI Business Hub</title>
</svelte:head>

<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
  <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8 bg-gradient-to-r from-primary-700 to-primary-900 rounded-2xl px-8 py-8">
    <div>
      <h1 class="text-3xl font-bold text-white">My Dashboard</h1>
      <p class="text-primary-100 mt-1">Manage your bookings, reviews, and reports</p>
    </div>
    <button on:click={() => openReportModal()} class="text-sm self-start bg-white text-primary-700 hover:bg-primary-50 font-medium px-4 py-2 rounded-lg transition-colors duration-200">
      Report Issue
    </button>
  </div>

  {#if membership?.is_active && !loading}
    <div class="card mb-4">
      <div class="flex flex-col sm:flex-row sm:items-center gap-4">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-1">
            <h2 class="text-lg font-semibold text-dark-900">My Membership</h2>
            <span class="badge-green">Active</span>
          </div>
          <p class="text-xs text-dark-500">Included hours reset each calendar month (no rollover). Additional usage is billed at standard rates.</p>
        </div>
      </div>
      <div class="grid sm:grid-cols-2 gap-4 mt-4">
        {#if confMeter}
          <div class="bg-dark-50 border border-dark-200 rounded-xl p-4">
            <div class="flex items-center justify-between mb-1">
              <p class="text-sm font-medium text-dark-900">Conference Room</p>
              <p class="text-xs text-dark-500">{confMeter.remainingLabel} left</p>
            </div>
            <div class="h-2 bg-dark-200 rounded-full overflow-hidden">
              <div
                class="h-full {confMeter.exhausted ? 'bg-gold-500' : 'bg-primary-600'} transition-all"
                style="width: {Math.min(100, (confMeter.usedMinutes / confMeter.includedMinutes) * 100)}%"
              ></div>
            </div>
            <p class="text-xs text-dark-500 mt-1.5">
              {confMeter.exhausted ? 'Included hours used — overage bills at standard rate' : `Remaining this month: ${confMeter.remainingLabel}`}
            </p>
          </div>
        {/if}
        {#if meetMeter}
          <div class="bg-dark-50 border border-dark-200 rounded-xl p-4">
            <div class="flex items-center justify-between mb-1">
              <p class="text-sm font-medium text-dark-900">Meeting Room</p>
              <p class="text-xs text-dark-500">{meetMeter.remainingLabel} left</p>
            </div>
            <div class="h-2 bg-dark-200 rounded-full overflow-hidden">
              <div
                class="h-full {meetMeter.exhausted ? 'bg-gold-500' : 'bg-primary-600'} transition-all"
                style="width: {Math.min(100, (meetMeter.usedMinutes / meetMeter.includedMinutes) * 100)}%"
              ></div>
            </div>
            <p class="text-xs text-dark-500 mt-1.5">
              {meetMeter.exhausted ? 'Included hours used — overage bills at standard rate' : `Remaining this month: ${meetMeter.remainingLabel}`}
            </p>
          </div>
        {/if}
      </div>
    </div>
  {/if}

  <div class="flex gap-1 bg-dark-100 border border-dark-200 rounded-lg p-1 mb-8 overflow-x-auto">
    {#each memberTabs as tab}
      <button
        on:click={() => activeTab = tab.key}
        class="px-4 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap
          {activeTab === tab.key ? 'bg-primary-600 text-white' : 'text-dark-500 hover:text-dark-900 hover:bg-dark-50'}"
      >
        {tab.label}
        {#if tab.count > 0}
          <span class={`ml-1.5 inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${activeTab === tab.key ? 'bg-white/25 text-white' : 'bg-primary-100 text-primary-700'}`}>
            {tab.count}
          </span>
        {/if}
      </button>
    {/each}
  </div>

  {#if loading}
    <div class="space-y-4">
      {#each [1, 2, 3] as _}
        <div class="card animate-pulse">
          <div class="flex items-start gap-4">
            <div class="flex-1">
              <div class="flex items-center gap-2 mb-3">
                <div class="h-5 w-40 bg-dark-200 rounded"></div>
                <div class="h-5 w-16 bg-dark-200 rounded-full"></div>
              </div>
              <div class="h-4 w-64 bg-dark-200 rounded mb-2"></div>
              <div class="h-4 w-48 bg-dark-200 rounded"></div>
            </div>
            <div class="flex gap-2 shrink-0">
              <div class="h-8 w-20 bg-dark-200 rounded-lg"></div>
              <div class="h-8 w-20 bg-dark-200 rounded-lg"></div>
            </div>
          </div>
        </div>
      {/each}
    </div>
  {:else if activeTab === 'upcoming'}
    {#if upcomingGroups.length === 0}
      <div class="card text-center py-12">
        <svg class="w-12 h-12 text-dark-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <h3 class="text-lg font-medium text-dark-900 mb-2">No upcoming bookings</h3>
        <p class="text-dark-500 mb-6">You don't have any upcoming bookings.</p>
        <a href="/#rooms" class="btn-primary">Browse Rooms</a>
      </div>
    {:else}
      <div class="space-y-4">
        {#each upcomingGroups as group (group.key)}
          {@const rep = group.bookings[0]}
          {@const statusMeta = getStatusMeta(group.status)}
          {#if group.isSeries}
            <div class="card">
              <div class="flex flex-col sm:flex-row sm:items-center gap-4">
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 mb-1 flex-wrap">
                    <h3 class="text-lg font-semibold text-dark-900 truncate">{group.room?.name || 'Unknown Room'}</h3>
                    {#if group.plan}
                      <span class="badge bg-purple-100 text-purple-700 border-purple-200">{group.plan.name}</span>
                    {/if}
                    <span class={statusMeta.badgeClass}>{statusMeta.label}</span>
                  </div>
                  <p class="text-sm text-dark-500">
                    {dateRangeLabel(group)}
                    {#if group.dates.length === 1}
                      · {formatTime(rep.start_time)} - {formatTime(rep.end_time)}
                    {/if}
                  </p>
                  {#if group.plan}
                    <p class="text-sm text-dark-500">{group.plan.name} · {formatCurrency(quoteForStoredBooking(rep).total)}</p>
                  {/if}
                </div>
                <div class="flex items-center gap-2">
                  {#if group.status === 'pending' || group.status === 'approved'}
                    <button on:click={() => openRescheduleModal(group)} class="btn-ghost-primary">
                      Reschedule
                    </button>
                  {/if}
                  {#if group.status !== 'cancelled'}
                    <button on:click={() => openCancelModal(group)} class="btn-ghost-danger">
                      Cancel
                    </button>
                  {/if}
                </div>
              </div>
              <div class="mt-3">
                <p class="text-xs text-dark-500 mb-1.5">Scheduled days</p>
                <div class="flex flex-wrap gap-1.5">
                  {#each group.dates as iso (iso)}
                    <span class="px-2 py-1 rounded-lg bg-dark-50 border border-dark-200 text-xs text-dark-700">
                      {formatDate(iso)}
                    </span>
                  {/each}
                </div>
              </div>
            </div>
          {:else}
            <div class="card">
              <div class="flex flex-col sm:flex-row sm:items-center gap-4">
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 mb-1">
                    <h3 class="text-lg font-semibold text-dark-900 truncate">{group.room?.name || 'Unknown Room'}</h3>
                    <span class={statusMeta.badgeClass}>{statusMeta.label}</span>
                  </div>
                  <p class="text-sm text-dark-500">
                    {formatDate(rep.date)} · {formatTime(rep.start_time)} - {formatTime(rep.end_time)}
                  </p>
                  <p class="text-sm text-dark-500">
                    {formatDuration(rep.start_time, rep.end_time)} · {group.room ? formatCurrency(group.room.price_per_hour) : ''}/hr
                  </p>
                </div>
                <div class="flex items-center gap-2">
                  {#if group.status === 'pending' || group.status === 'approved'}
                    <button on:click={() => openRescheduleModal(group)} class="btn-ghost-primary">
                      Reschedule
                    </button>
                  {/if}
                  {#if group.status !== 'cancelled'}
                    <button on:click={() => openCancelModal(group)} class="btn-ghost-danger">
                      Cancel
                    </button>
                  {/if}
                </div>
              </div>
            </div>
          {/if}
        {/each}
      </div>
    {/if}

  {:else if activeTab === 'past'}
    {#if pastGroups.length === 0}
      <div class="card text-center py-12">
        <svg class="w-12 h-12 text-dark-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
        </svg>
        <h3 class="text-lg font-medium text-dark-900 mb-2">No past bookings</h3>
        <p class="text-dark-500 mb-6">Your completed and cancelled bookings will appear here.</p>
        <a href="/#rooms" class="btn-primary">Browse Rooms</a>
      </div>
    {:else}
      <div class="space-y-4">
        {#each pastGroups as group (group.key)}
          {@const rep = group.bookings[0]}
          {@const statusMeta = getStatusMeta(group.status)}
          {@const alreadyReviewed = rep.id ? reviewedBookingIds.has(rep.id) : false}
          {@const canReview = (group.status === 'completed' || group.status === 'paid')}
          <div class="card">
            <div class="flex flex-col sm:flex-row sm:items-center gap-4">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1 flex-wrap">
                  <h3 class="text-lg font-semibold text-dark-900 truncate">{group.room?.name || 'Unknown Room'}</h3>
                  {#if group.plan}
                    <span class="badge bg-purple-100 text-purple-700 border-purple-200">{group.plan.name}</span>
                  {/if}
                  <span class={statusMeta.badgeClass}>{statusMeta.label}</span>
                </div>
                <p class="text-sm text-dark-500">
                  {#if group.isSeries}
                    {dateRangeLabel(group)}
                  {:else}
                    {formatDate(rep.date)}
                  {/if}
                  · {formatTime(rep.start_time)} - {formatTime(rep.end_time)}
                </p>
                {#if canReview && !alreadyReviewed}
                  <p class="mt-1 text-xs text-gold-600">Rate your visit — we'd love your feedback.</p>
                {/if}
              </div>
              <div class="flex items-center gap-2">
                {#if canReview}
                  {#if alreadyReviewed}
                    <span class="inline-flex items-center gap-1 text-xs text-green-700">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                      </svg>
                      Reviewed
                    </span>
                  {:else}
                    <button on:click={() => openReviewModal(rep)} class="btn-ghost-primary">
                      Leave Review
                    </button>
                  {/if}
                {/if}
              </div>
            </div>
          </div>
        {/each}
      </div>
    {/if}

  {:else if activeTab === 'reviews'}
    {#if reviews.length === 0}
      <div class="card text-center py-12">
        <svg class="w-12 h-12 text-dark-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.196-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.783-.57-.38-1.81.588-1.81h4.915a1 1 0 00.95-.69l1.519-4.674z" />
        </svg>
        <h3 class="text-lg font-medium text-dark-900 mb-2">No reviews yet</h3>
        <p class="text-dark-500 mb-6">Complete a booking to leave a review.</p>
        <a href="/#rooms" class="btn-primary">Browse Rooms</a>
      </div>
    {:else}
      <div class="space-y-4">
        {#each reviews as review (review.id)}
          <div class="card">
            <div class="flex items-start gap-4">
              <div class="flex-shrink-0">
                <div class="flex items-center gap-0.5">
                  {#each Array(5) as _, i}
                    <svg class="w-4 h-4 {i < review.rating ? 'text-gold-500' : 'text-dark-300'}" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                  {/each}
                </div>
              </div>
              <div class="flex-1">
                <p class="text-sm text-dark-900 font-medium">{review.room?.name || 'Room'}</p>
                {#if review.comment}
                  <p class="text-sm text-dark-700 mt-1">{review.comment}</p>
                {/if}
                <p class="text-xs text-dark-500 mt-2">{formatDate(review.created_at)}</p>
              </div>
            </div>
          </div>
        {/each}
      </div>
    {/if}

  {:else if activeTab === 'reports'}
    {#if reports.length === 0}
      <div class="card text-center py-12">
        <svg class="w-12 h-12 text-dark-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
        </svg>
        <h3 class="text-lg font-medium text-dark-900 mb-2">No reports</h3>
        <p class="text-dark-500 mb-6">You haven't submitted any reports yet.</p>
        <button on:click={() => openReportModal()} class="btn-primary">Submit a Report</button>
      </div>
    {:else}
      <div class="space-y-4">
        {#each reports as report (report.id)}
          {@const reportMeta = getReportStatusMeta(report.status)}
          <div class="card">
            <div class="flex items-start justify-between gap-4">
              <div class="flex-1">
                <div class="flex items-center gap-2 mb-1">
                  <h3 class="font-semibold text-dark-900">{report.subject}</h3>
                  <span class={reportMeta.badgeClass}>{reportMeta.label}</span>
                </div>
                <p class="text-sm text-dark-600 line-clamp-2">{report.description}</p>
                {#if report.admin_response}
                  <div class="mt-3 p-3 bg-dark-100 border border-dark-200 rounded-lg">
                    <p class="text-xs text-dark-500 mb-1">Admin Response:</p>
                    <p class="text-sm text-dark-700">{report.admin_response}</p>
                  </div>
                {/if}
                <p class="text-xs text-dark-500 mt-2">{formatDate(report.created_at)}</p>
              </div>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<!-- Review Modal -->
<Modal isOpen={showReviewModal} title="Leave a Review" on:close={() => showReviewModal = false}>
  {#if reviewBooking}
    <form on:submit|preventDefault={submitReview} class="space-y-4">
      <div class="bg-dark-50 border border-dark-200 rounded-lg p-3">
        <p class="text-sm text-dark-600">{reviewBooking.room?.name}</p>
        <p class="text-sm text-dark-900">{formatDate(reviewBooking.date)}</p>
      </div>

      <div>
        <span class="block text-sm font-medium text-dark-700 mb-2">Rating</span>
        <div class="flex gap-1" role="radiogroup" aria-label="Rating">
          {#each [1, 2, 3, 4, 5] as star}
            <button type="button" role="radio" aria-checked={reviewRating === star} aria-label={`${star} star${star > 1 ? 's' : ''}`} on:click={() => reviewRating = star} class="p-0.5">
              <svg class="w-8 h-8 {star <= reviewRating ? 'text-gold-500' : 'text-dark-300'}" fill="currentColor" viewBox="0 0 20 20">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
              </svg>
            </button>
          {/each}
        </div>
      </div>

      <div>
        <label for="review-comment" class="block text-sm font-medium text-dark-700 mb-1">Comment <span class="text-dark-500">(optional)</span></label>
        <textarea id="review-comment" bind:value={reviewComment} class="input" rows="3" placeholder="Share your experience..."></textarea>
      </div>

      <div class="flex gap-3 pt-2">
        <button type="button" on:click={() => showReviewModal = false} class="btn-secondary flex-1">Cancel</button>
        <button type="submit" disabled={reviewLoading} class="btn-primary flex-1">
          {reviewLoading ? 'Submitting...' : 'Submit Review'}
        </button>
      </div>
    </form>
  {/if}
</Modal>

<!-- Report Modal -->
<Modal isOpen={showReportModal} title="Submit a Report" on:close={() => showReportModal = false}>
  <form on:submit|preventDefault={submitReport} class="space-y-4">
    <div>
      <label for="report-subject" class="block text-sm font-medium text-dark-700 mb-1">Subject</label>
      <input id="report-subject" type="text" bind:value={reportSubject} class="input" placeholder="Brief description of the issue" required />
    </div>

    <div>
      <label for="report-description" class="block text-sm font-medium text-dark-700 mb-1">Description</label>
      <textarea id="report-description" bind:value={reportDescription} class="input" rows="4" placeholder="Please provide details about your issue..." required></textarea>
    </div>

    <div class="flex gap-3 pt-2">
      <button type="button" on:click={() => showReportModal = false} class="btn-secondary flex-1">Cancel</button>
      <button type="submit" disabled={reportLoading} class="btn-primary flex-1">
        {reportLoading ? 'Submitting...' : 'Submit Report'}
      </button>
    </div>
  </form>
</Modal>

<!-- Reschedule Modal -->
<Modal isOpen={showRescheduleModal} title="Reschedule Booking" on:close={() => showRescheduleModal = false}>
  {#if rescheduleGroup}
    <form on:submit|preventDefault={submitReschedule} class="space-y-4">
      <div class="bg-dark-50 border border-dark-200 rounded-lg p-3">
        <p class="text-sm text-dark-600">{rescheduleGroup.room?.name}</p>
        <p class="text-sm text-dark-900">
          Currently:
          {#if rescheduleGroup.isSeries}
            {dateRangeLabel(rescheduleGroup)}
          {:else}
            {formatDate(rescheduleGroup.dates[0])}
          {/if}
          · {formatTime(rescheduleGroup.bookings[0].start_time)} - {formatTime(rescheduleGroup.bookings[0].end_time)}
        </p>
      </div>

      <div>
        <label for="reschedule-date" class="block text-sm font-medium text-dark-700 mb-1">New {rescheduleGroup.isSeries ? 'Start ' : ''}Date</label>
        <input id="reschedule-date" type="date" bind:value={rescheduleDate} class="input" required />
        <p class="mt-1 text-xs text-dark-500">The hub is closed on weekends and public holidays.</p>
      </div>

      <div>
        <label for="reschedule-time" class="block text-sm font-medium text-dark-700 mb-1">New Start Time</label>
        <input id="reschedule-time" type="time" bind:value={rescheduleTime} class="input" required />
      </div>

      {#if rescheduleError}
        <div class="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {rescheduleError}
        </div>
      {/if}

      {#if rescheduleGroup.isSeries}
        <p class="text-xs text-dark-500">
          This is a {rescheduleGroup.plan?.name || 'weekly'} pass. Rescheduling moves all {rescheduleGroup.dates.length} scheduled days by the same amount and keeps the daily time window.
        </p>
      {:else}
        <p class="text-xs text-dark-500">
          Your booking will be moved to pending status for re-approval. Payment is non-refundable.
        </p>
      {/if}

      <div class="flex gap-3 pt-2">
        <button type="button" on:click={() => showRescheduleModal = false} class="btn-secondary flex-1">Cancel</button>
        <button type="submit" disabled={rescheduleLoading} class="btn-primary flex-1">
          {rescheduleLoading ? 'Rescheduling...' : 'Confirm Reschedule'}
        </button>
      </div>
    </form>
  {/if}
</Modal>

<!-- Cancel Confirmation Modal -->
<Modal isOpen={showCancelModal} title="Cancel Booking" on:close={() => showCancelModal = false}>
  {#if cancelGroup}
    <div class="space-y-4">
      <div class="bg-dark-50 border border-dark-200 rounded-lg p-3">
        <p class="text-sm text-dark-600">{cancelGroup.room?.name}</p>
        <p class="text-sm text-dark-900">
          {#if cancelGroup.isSeries}
            {dateRangeLabel(cancelGroup)}
          {:else}
            {formatDate(cancelGroup.dates[0])}
          {/if}
          · {formatTime(cancelGroup.bookings[0].start_time)} - {formatTime(cancelGroup.bookings[0].end_time)}
        </p>
      </div>
      <p class="text-xs text-dark-500">
        Are you sure you want to cancel this {cancelGroup.isSeries ? 'pass (all ' + cancelGroup.dates.length + ' scheduled days)' : 'booking'}? Payment is non-refundable. This cannot be undone.
      </p>
      <div class="flex gap-3 pt-2">
        <button type="button" on:click={() => showCancelModal = false} class="btn-secondary flex-1">Keep Booking</button>
        <button type="submit" disabled={cancelLoading} class="btn-danger flex-1" on:click={submitCancel}>
          {cancelLoading ? 'Cancelling...' : 'Yes, Cancel'}
        </button>
      </div>
    </div>
  {/if}
</Modal>
