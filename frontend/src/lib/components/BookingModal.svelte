<script lang="ts">
	import Modal from '$lib/components/Modal.svelte';
	import Calendar from '$lib/components/Calendar.svelte';
	import { supabase } from '$lib/supabase/client';
	import { profile } from '$lib/stores/auth';
	import { CALENDAR_LOOKAHEAD_DAYS, HUB_CLOSE_HOUR, HUB_OPEN_HOUR, buildTimeSlots, getFreeHourCount, getSeriesDates, getWeeklySeriesDates, rangesOverlap } from '$lib/utils/dates';
	import { formatDate, getRoomImage, formatCurrency } from '$lib/utils/format';
	import { quoteForBooking, planReferencePrice } from '$lib/utils/pricing';
	import type { Room, Plan, Booking } from '$lib/types/database';

	export let isOpen = false;
	export let room: Room | null = null;
	export let plans: Plan[] = [];

	const BLOCKING_STATUSES = ['pending', 'approved', 'paid', 'completed'];

	let selectedPlan: Plan | null = null;

	let selectedDate = '';
	let startTime = '';
	let endTime = '';

	let guestName = '';
	let guestEmail = '';
	let guestPhone = '';
	let purpose = '';

	let submitting = false;
	let errorMessage = '';
	let showConfirmation = false;
	let bookingReference = '';

	// Multi-step wizard: 1 = plan & date, 2 = time & details, 3 = review & confirm.
	let step = 1;

	// Validity gates for moving forward — each step only needs what it shows,
	// so every step fits the viewport without scrolling.
	$: canContinue1 = !!selectedPlan && !!selectedDate;
	$: canContinue2 =
		!!startTime &&
		!!endTime &&
		guestName.trim().length > 0 &&
		guestEmail.trim().length > 0;
	const lastStep = 3;

	// Friendly hints shown instead of a silently-disabled "Continue" button.
	$: step1Hints = [
		!selectedPlan ? 'Select a plan to continue.' : '',
		!selectedDate ? 'Select a date to continue.' : ''
	].filter(Boolean);
	$: step2Hints = [
		!startTime ? 'Choose a start time.' : '',
		!endTime ? 'Choose an end time.' : '',
		!guestName.trim() ? 'Enter your name.' : '',
		!guestEmail.trim() ? 'Enter your email.' : ''
	].filter(Boolean);

	function nextStep() {
		if (step < lastStep) step += 1;
	}

	function prevStep() {
		if (step > 1) step -= 1;
	}

	function gotoStep(target: number) {
		// Only allow revisiting steps that have already been reached.
		if (target < step) step = target;
		else if (target === step + 1 && target <= lastStep) step = target;
	}

	const stepTitles = ['Plan & Date', 'Time & Details', 'Confirm'];

	// Weekly/Monthly plans repeat the same time across several dates; keep the
	// room's blocking bookings so the calendar can mark fully-booked days.
	let bookingsByDate: Record<string, Booking[]> = {};

	$: isSeriesPlan = selectedPlan?.slug === 'weekly' || selectedPlan?.slug === 'monthly';
	// Full-day and weekly passes cover the whole business day, so their time is
	// fixed to 9 AM – 5 PM and the time selectors are hidden.
	$: fixedTimePlan = selectedPlan?.slug === 'full-day' || selectedPlan?.slug === 'weekly';

	// Auto-fill 9 AM – 5 PM for fixed-time plans once a date is picked.
	$: if (fixedTimePlan && selectedDate) {
		startTime = '09:00';
		endTime = '17:00';
	}
	$: seriesDates = selectedPlan && selectedDate
		? (selectedPlan.slug === 'weekly'
			? getWeeklySeriesDates(selectedDate, bookingsByDate)
			: getSeriesDates(selectedDate, selectedPlan))
		: [];

	// Available 1-hour blocks for the selected (start) date — used for the
	// calendar "teaser" preview. Independent of plan duration on purpose.
	$: availableHourSlots = selectedDate
		? (buildTimeSlots(1, bookingsByDate[selectedDate] ?? []).filter((s) => s.available) ?? [])
		: [];
	$: selectedDayFreeCount = selectedDate ? getFreeHourCount(bookingsByDate[selectedDate] ?? []) : 0;

	// Fetch this room's blocking bookings so the modal's calendar reflects real
	// availability (mirrors the room page's server query). If the anon key can't
	// read bookings (RLS), this silently leaves the calendar without booked-day
	// dots — the range highlight + banner still work.
	async function loadBookings() {
		if (!room) {
			bookingsByDate = {};
			return;
		}
		const today = new Date().toISOString().split('T')[0];
		const { data } = await supabase
			.from('bookings')
			.select('id, room_id, user_id, plan_id, date, start_time, end_time, status')
			.eq('room_id', room.id)
			.gte('date', today)
			.in('status', BLOCKING_STATUSES);

		bookingsByDate = ((data ?? []) as Booking[]).reduce<Record<string, Booking[]>>((acc, b) => {
			(acc[b.date] ??= []).push(b);
			return acc;
		}, {});
	}

	// (Re)load availability whenever the modal opens or the selected room changes.
	$: if (isOpen && room) {
		loadBookings();
	}

	// Auto-fill the guest's details from their signed-in profile so they don't
	// have to retype them. Runs every time the modal opens.
	$: if (isOpen) {
		if ($profile?.full_name) guestName = $profile.full_name;
		if ($profile?.email) guestEmail = $profile.email;
		if ($profile?.phone) guestPhone = $profile.phone;
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

		return date.toLocaleTimeString('en-US', {
			hour: 'numeric',
			minute: '2-digit'
		});
	}

	function timeToMinutes(time: string): number {
		const [hours, minutes] = time.split(':').map(Number);

		return hours * 60 + minutes;
	}

	function minutesToTime(minutes: number): string {
		const hours = Math.floor(minutes / 60);
		const mins = minutes % 60;

		return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
	}

	function formatDisplayTime(time: string): string {
		if (!time) return '';

		const [hours, minutes] = time.split(':').map(Number);

		return formatTime(hours, minutes);
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
		const days = isSeriesPlan && seriesDates.length > 0 ? seriesDates : selectedDate ? [selectedDate] : [];
		// For series plans a slot is only usable if it's free on every day; for a
		// single day we simply check that day. Overlap on any relevant day.
		const conflictingDays = days.filter((date) =>
			(bookingsByDate[date] ?? []).some((b) =>
				rangesOverlap(startMin, endMin, timeToMinutes(b.start_time), timeToMinutes(b.end_time))
			)
		);
		// A slot is unavailable if it conflicts on any checked day.
		return conflictingDays.length > 0;
	}

	// Start times that are fully booked (that exact starting hour is unavailable).
	$: bookedStarts = new Set(
		timeSlots
			.filter((time) => {
				const start = timeToMinutes(getTimeValue(time));
				// A single hour is the shortest bookable increment, so check the range.
				return isSlotBooked(start, start + 60);
			})
			.map(getTimeValue)
	);

	// End time must always be after start time, and must not create a range that
	// overlaps an existing booking.
	// For the Hourly plan the member can only book a 30-minute or 1-hour block,
	// so the end options are limited to start +30min and start +60min.
	$: isHourlyPlan = selectedPlan?.slug === 'hourly';
	$: availableEndTimes = (() => {
		if (!startTime) return [];
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
						hint: offsetMin === 30 ? '30 minutes' : '1 hour'
					};
				})
				.filter(({ endValue }) => timeToMinutes(endValue) <= HUB_CLOSE_HOUR * 60);
		}

		return timeSlots
			.filter((time) => getTimeValue(time) > startTime)
			.map((time) => {
				const endValue = getTimeValue(time);
				return { time, endValue, booked: isSlotBooked(start, timeToMinutes(endValue)), hint: undefined };
			});
	})();

	// Duration between start and end.
	$: bookingDuration =
		startTime && endTime
			? calculateDuration(startTime, endTime)
			: '';

	// Live price quote based on room, plan, and selected times.
	$: quote =
		room && startTime && endTime
			? quoteForBooking(room, selectedPlan, startTime, endTime)
			: null;

	function calculateDuration(start: string, end: string): string {
		const startMinutes = timeToMinutes(start);
		const endMinutes = timeToMinutes(end);

		const difference = endMinutes - startMinutes;

		if (difference <= 0) return '';

		const hours = Math.floor(difference / 60);
		const minutes = difference % 60;

		if (minutes === 0) {
			return `${hours} hour${hours !== 1 ? 's' : ''}`;
		}

		return `${hours} hour${hours !== 1 ? 's' : ''} ${minutes} minute${minutes !== 1 ? 's' : ''}`;
	}

	// Custom dropdown state (native <option> can't render mixed text colors).
	let startOpen = false;
	let endOpen = false;

	function selectStartTime(value: string) {
		startTime = value;
		endTime = '';
		startOpen = false;
	}

	function selectEndTime(value: string) {
		endTime = value;
		endOpen = false;
	}

	function selectPlan(plan: Plan) {
		selectedPlan = plan;
		// Reset date/time when switching plans — a start date valid for one plan
		// may not express the same series for another.
		selectedDate = '';
		startTime = '';
		endTime = '';
	}

	function close() {
		isOpen = false;

		// Reset form after closing.
		selectedPlan = null;
		selectedDate = '';
		startTime = '';
		endTime = '';

		guestName = '';
		guestEmail = '';
		guestPhone = '';
		purpose = '';

		errorMessage = '';
		showConfirmation = false;
		bookingReference = '';

		step = 1;
	}

    async function submitBooking() {
        errorMessage = '';

        if (!room) {
            errorMessage = 'No room selected.';
            return;
        }

        if (!selectedPlan) {
            errorMessage = 'Please select a booking plan.';
            return;
        }

        if (!selectedDate) {
            errorMessage = 'Please select a date.';
            return;
        }

        if (!startTime) {
            errorMessage = 'Please select a start time.';
            return;
        }

        if (!endTime) {
            errorMessage = 'Please select an end time.';
            return;
        }

        if (timeToMinutes(endTime) <= timeToMinutes(startTime)) {
            errorMessage = 'End time must be after start time.';
            return;
        }

        if (!guestName.trim()) {
            errorMessage = 'Please enter your name.';
            return;
        }

        if (!guestEmail.trim()) {
            errorMessage = 'Please enter your email.';
            return;
        }

        submitting = true;

        try {
            // Get the currently logged-in user's Supabase session
            const {
                data: { session },
                error: sessionError
            } = await supabase.auth.getSession();

            if (sessionError || !session?.access_token) {
                errorMessage = 'Please log in before booking a room.';
                return;
            }

            const response = await fetch('/api/bookings', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${session.access_token}`
                },
                body: JSON.stringify({
                    room_id: room.id,
                    plan_id: selectedPlan.id,

                    // Weekly/Monthly book every day in the series; single-day
                    // plans send a one-element array.
                    dates: isSeriesPlan ? seriesDates : [selectedDate],

                    start_time: startTime,
                    end_time: endTime,

                    guest_name: guestName.trim(),
                    guest_email: guestEmail.trim(),
                    guest_phone: guestPhone.trim() || null,
                    purpose: purpose.trim() || null
                })
            });

			const result = await response.json();

			if (!response.ok) {
				throw new Error(
					result.message || 'Unable to create booking.'
				);
			}

			const bookings = Array.isArray(result?.bookings) ? result.bookings : [];
			const first = bookings[0];
			bookingReference = (first?.id as string | undefined) ?? '';

			// Show a dedicated confirmation view instead of auto-closing so the
			// member can see exactly what was submitted and what happens next.
			errorMessage = '';
			showConfirmation = true;
			step = 4;
		} catch (error) {
            errorMessage =
                error instanceof Error
                    ? error.message
                    : 'Something went wrong while creating your booking.';
        } finally {
            submitting = false;
        }
    }

</script>

<Modal size="lg" bind:isOpen title={room ? `Book ${room.name}` : 'Book a Room'} on:close={close}>
	{#if room}

		<!-- Room context strip (kept small so every step fits the viewport) -->
		<div class="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary-100 bg-primary-50 px-4 py-3">
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
						Up to {room.capacity} people · {formatCurrency(room.price_per_hour)}/hour
					</p>
				</div>
			</div>
			{#if selectedPlan}
			<span class="rounded-full bg-primary-100 px-3 py-1 text-xs text-primary-800">
				{selectedPlan.name} · {selectedPlan.duration_label}
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
					aria-current={step === stepNum ? 'step' : undefined}
				>
					<span class="flex items-center gap-1.5">
						<span
							class={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${
								step === stepNum
									? 'bg-primary-600 text-white'
									: step > stepNum
										? 'bg-primary-50 text-primary-700'
										: 'bg-dark-200 text-dark-600'
							}`}
						>{stepNum}</span>
						<span class={step === stepNum ? 'text-primary-700' : 'text-dark-500'}>{title}</span>
					</span>
				</button>
			{/each}
		</div>
		{/if}

		<!-- Sticky summary (business hours + chosen plan, no rates) -->
		{#if step <= 3}
			<div class="mb-6 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-dark-200 bg-white px-3 py-2 text-xs text-dark-600">
				<span class="inline-flex items-center gap-1.5">
					<svg class="h-3.5 w-3.5 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
					</svg>
					Open {formatDisplayTime(minutesToTime(HUB_OPEN_HOUR * 60))} – {formatDisplayTime(minutesToTime(HUB_CLOSE_HOUR * 60))}
				</span>
				<span class="inline-flex items-center gap-1.5">
					<span class="h-1.5 w-1.5 rounded-full bg-primary-500"></span>
					{#if selectedPlan}
						{selectedPlan.name} · {selectedPlan.duration_label}
					{:else}
						No plan selected yet
					{/if}
					{#if isSeriesPlan && seriesDates.length > 1}
						<span class="text-dark-400">· {seriesDates.length} days</span>
					{/if}
				</span>
			</div>
		{/if}


		<!-- STEP 1: Plan & Date -->
		{#if step === 1}
			<div class="grid gap-8 sm:grid-cols-2">

				<!-- Plan -->
				<div>
					<p class="mb-4 text-sm font-semibold text-dark-900">
						Choose a Plan
					</p>

					<div class="space-y-3">
						{#each plans as plan}
							<button
								type="button"
								class={`flex w-full items-center justify-between gap-4 rounded-xl border p-4 text-left transition ${
									selectedPlan?.id === plan.id
										? 'border-primary-500 bg-primary-50 ring-1 ring-primary-500'
										: 'border-dark-200 bg-white hover:border-dark-300'
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
									<div class="font-bold text-dark-900">{formatCurrency(planReferencePrice(room, plan))}</div>
									<div class="mt-0.5 text-xs text-dark-500">
										{plan.duration_label}
									</div>
								</div>
							</button>
						{/each}
					</div>
				</div>


				<!-- Date -->
				<div>
					<p class="mb-3 text-sm font-medium text-dark-600">
						{isSeriesPlan ? 'Select Start Date' : 'Select Date'}
					</p>

					{#if isSeriesPlan}
						<p class="mb-3 text-xs text-dark-500">
							{selectedPlan?.slug === 'weekly'
								? 'Repeats weekdays only (Mon\u2013Fri) from your start date.'
								: 'Repeats daily for the month from your start date.'}
						</p>
					{/if}

					<Calendar
						{bookingsByDate}
						{selectedDate}
						rangeDates={isSeriesPlan ? seriesDates : []}
						lookaheadDays={CALENDAR_LOOKAHEAD_DAYS}
						on:selectDate={(e) => (selectedDate = e.detail)}
					/>

					{#if selectedDate}
						<div class="mt-4 rounded-xl border border-primary-100 bg-primary-50 p-4">
							<div class="mb-2 flex flex-wrap items-center justify-between gap-2">
								<p class="text-sm font-medium text-dark-700">
									Available hours on
									<span class="font-semibold text-dark-900">{formatDate(selectedDate)}</span>
								</p>
								{#if selectedDayFreeCount > 0 && availableHourSlots.length > 0}
									<span class="rounded-full bg-primary-100 px-2.5 py-0.5 text-xs font-medium text-primary-800">
										{selectedDayFreeCount} hour{selectedDayFreeCount === 1 ? '' : 's'} free
									</span>
								{/if}
							</div>
							{#if availableHourSlots.length > 0}
								<div class="flex flex-wrap gap-1.5">
									{#each availableHourSlots as slot}
										<span
											class="rounded-md border border-primary-200 bg-white px-2 py-1 text-xs font-medium text-primary-800"
										>
											{slot.label}
										</span>
									{/each}
								</div>
							{:else}
								<p class="text-xs text-dark-500">
									No 1-hour blocks available on this day.
								</p>
							{/if}
							<p class="mt-2 text-xs text-dark-400">
								{isSeriesPlan && seriesDates.length > 1
									? 'Preview shows the start date. The time you pick must be free across all days in the range.'
									: 'This is just a preview — pick your exact time on the next step.'}
							</p>
						</div>
					{/if}

					{#if isSeriesPlan && seriesDates.length > 1}
						<div class="mt-4 rounded-xl border border-primary-100 bg-primary-50 p-4">
							<p class="flex flex-wrap items-baseline gap-x-2 text-sm text-dark-600">
								<span class="font-medium">
									{selectedPlan?.slug === 'weekly' ? 'Weekdays' : 'Daily block'}:
								</span>
								<span class="font-semibold text-dark-900">
									{formatDate(seriesDates[0])} → {formatDate(seriesDates[seriesDates.length - 1])}
								</span>
								<span class="text-dark-500">
									({seriesDates.length} days{selectedPlan?.slug === 'weekly' ? ' · Mon\u2013Fri' : ''})
								</span>
							</p>
							<p class="mt-0.5 text-xs text-dark-500">
								The same time you pick applies to every day in this range.
							</p>
						</div>
					{/if}
				</div>
			</div>

			<div class="mt-6 flex items-center justify-between">
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
		{/if}


		<!-- STEP 2: Time & Details -->
		{#if step === 2}
			<div class="grid gap-8 sm:grid-cols-2">

				<!-- Time -->
				<div>
					<p class="mb-3 text-sm font-medium text-dark-600">
						{fixedTimePlan ? 'Time' : 'Select Time'}
					</p>

					{#if fixedTimePlan}
						<div class="rounded-xl border border-primary-100 bg-primary-50 p-4 text-sm text-dark-700">
							This {selectedPlan?.name?.toLowerCase() ?? 'pass'} covers the whole business day
							<span class="font-semibold text-dark-900">
								{formatDisplayTime(startTime)} – {formatDisplayTime(endTime)}
							</span>.
						</div>
					{:else}
					<div class="grid grid-cols-1 gap-4">
						<div>
							<label for="start-time" class="mb-1.5 block text-xs text-dark-500">
								Start Time
							</label>
							<div class="relative">
								<button
									id="start-time"
									type="button"
									class="input flex w-full items-center justify-between text-left disabled:cursor-not-allowed disabled:opacity-50"
									on:click={() => (startOpen = !startOpen)}
								>
									<span>{startTime ? formatDisplayTime(startTime) : 'Select start time'}</span>
									<span class="ml-2 text-dark-400">{startOpen ? '▲' : '▼'}</span>
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
											{@const booked = bookedStarts.has(value)}
											<button
												type="button"
												class="block w-full px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:text-dark-400 disabled:hover:bg-transparent enabled:hover:bg-dark-50"
												class:bg-primary-50={value === startTime}
												disabled={booked}
												on:click={() => selectStartTime(value)}
											>
												{time}
												{#if booked}
													<span class="font-medium text-red-600">(Booked)</span>
												{/if}
											</button>
										{/each}
									</div>
								{/if}
							</div>
						</div>

						<div>
							<label for="end-time" class="mb-1.5 block text-xs text-dark-500">
								End Time
							</label>
							<div class="relative">
								<button
									id="end-time"
									type="button"
									class="input flex w-full items-center justify-between text-left disabled:cursor-not-allowed disabled:opacity-50"
									disabled={!startTime}
									on:click={() => (endOpen = !endOpen)}
								>
									<span>{endTime ? formatDisplayTime(endTime) : (startTime ? 'Select end time' : 'Select start time first')}</span>
									<span class="ml-2 text-dark-400">{endOpen ? '▲' : '▼'}</span>
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
												class="block w-full px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:text-dark-400 disabled:hover:bg-transparent enabled:hover:bg-dark-50"
												class:bg-primary-50={endValue === endTime}
												disabled={booked}
												on:click={() => selectEndTime(endValue)}
											>
												{time}
												{#if hint}
													<span class="ml-1.5 text-xs text-dark-400">({hint})</span>
												{/if}
												{#if booked}
													<span class="font-medium text-red-600">(Booked)</span>
												{/if}
											</button>
										{/each}
									</div>
								{/if}
							</div>
						</div>
					</div>
					{/if}

					{#if bookingDuration}
						<div class="mt-4 inline-flex items-center rounded-lg bg-primary-50 border border-primary-100 px-3 py-2 text-sm text-primary-800">
							Duration:
							<span class="ml-1.5 font-semibold text-dark-900">{bookingDuration}</span>
						</div>
					{/if}

					{#if quote}
						<div class="mt-4 rounded-xl border border-primary-200 bg-white p-4">
							<div class="flex items-center justify-between">
								<div>
									<p class="text-xs text-dark-500">Estimated total</p>
									<p class="text-xs text-dark-400">{quote.label}</p>
								</div>
								<p class="text-2xl font-bold text-dark-900">{formatCurrency(quote.total)}</p>
							</div>
						</div>
					{/if}

					{#if !fixedTimePlan}
					<p class="mt-4 text-xs text-dark-500">
						Greyed-out times marked
						<span class="font-medium text-red-600">(Booked)</span> are already taken and can't be selected.
					</p>
					{/if}
				</div>


				<!-- Details -->
				<div class="space-y-4 rounded-xl border border-primary-100 bg-primary-50 p-5">
					<h3 class="text-sm font-semibold text-dark-900">Your Details</h3>

					<div>
						<label for="guest-name" class="mb-1.5 block text-xs text-dark-500">Full Name</label>
						<input
							id="guest-name"
							type="text"
							bind:value={guestName}
							placeholder="Enter your full name"
							readonly
							class="input disabled:cursor-not-allowed"
						/>
						<p class="mt-1 text-xs text-dark-500">Filled from your account profile.</p>
					</div>

					<div>
						<label for="guest-email" class="mb-1.5 block text-xs text-dark-500">Email</label>
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
						<label for="guest-phone" class="mb-1.5 block text-xs text-dark-500">Phone</label>
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
						<label for="purpose" class="mb-1.5 block text-xs text-dark-500">Purpose</label>
						<textarea
							id="purpose"
							bind:value={purpose}
							rows="3"
							placeholder="What will you use the room for?"
							class="input resize-none"
						></textarea>
					</div>
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
				<h3 class="mb-4 text-sm font-semibold text-dark-900">Review your booking</h3>

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
									{formatDate(seriesDates[0])} → {formatDate(seriesDates[seriesDates.length - 1])}
								</span>
							</span>
						{:else}
							<span class="font-medium text-dark-900">{selectedDate}</span>
						{/if}
					</div>
					<div class="flex justify-between gap-4">
						<span class="text-dark-500">Time</span>
						<span class="font-medium text-dark-900">
							{formatDisplayTime(startTime)} – {formatDisplayTime(endTime)}
						</span>
					</div>
					<div class="flex justify-between gap-4">
						<span class="text-dark-500">Duration</span>
						<span class="font-medium text-dark-900">{bookingDuration}</span>
					</div>
					{#if quote}
						<div class="mt-1 flex justify-between gap-4 rounded-lg bg-white px-3 py-2">
							<span class="text-dark-500">Charge</span>
							<span class="text-right">
								<span class="block text-sm font-semibold text-dark-900">{quote.label}</span>
								<span class="block text-xs text-dark-500">{formatCurrency(quote.total)}</span>
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
							<span class="text-right font-medium text-dark-900">{purpose}</span>
						</div>
					{/if}
				</div>
			</div>

			{#if errorMessage}
				<div class="mt-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
					{errorMessage}
				</div>
			{/if}

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
				This reserves the {seriesDates.length > 1 ? `${seriesDates.length} days` : 'slot'}
				pending admin approval. Payment is on site and non-refundable.
			</p>
		{/if}

		<!-- STEP 4: Confirmation -->
		{#if step === 4 && showConfirmation}
			<div class="rounded-xl border border-green-200 bg-green-50 p-6 text-center">
				<div class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
					<svg class="h-8 w-8 text-green-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
					</svg>
				</div>
				<h3 class="text-lg font-semibold text-dark-900">Booking request submitted</h3>
				<p class="mt-1 text-sm text-dark-600">
					Your booking is now pending admin approval. You'll be notified once it's approved.
				</p>
				{#if bookingReference}
					<p class="mt-2 text-xs text-dark-500">
						Reference:
						<span class="font-mono font-semibold text-dark-700">{bookingReference.slice(0, 8)}</span>
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
									{formatDate(seriesDates[0])} → {formatDate(seriesDates[seriesDates.length - 1])}
								</span>
							</span>
						{:else}
							<span class="font-medium text-dark-900">{formatDate(selectedDate)}</span>
						{/if}
					</div>
					<div class="flex justify-between gap-4">
						<span class="text-dark-500">Time</span>
						<span class="font-medium text-dark-900">
							{formatDisplayTime(startTime)} – {formatDisplayTime(endTime)}
						</span>
					</div>
					{#if purpose}
						<div class="flex justify-between gap-4">
							<span class="text-dark-500">Purpose</span>
							<span class="text-right font-medium text-dark-900">{purpose}</span>
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
