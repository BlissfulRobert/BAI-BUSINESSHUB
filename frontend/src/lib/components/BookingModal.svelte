<script lang="ts">
	import Modal from '$lib/components/Modal.svelte';
	import Calendar from '$lib/components/Calendar.svelte';
	import { supabase } from '$lib/supabase/client';
	import { CALENDAR_LOOKAHEAD_DAYS, HUB_CLOSE_HOUR, HUB_OPEN_HOUR, getSeriesDates, rangesOverlap } from '$lib/utils/dates';
	import { formatDate, getRoomImage } from '$lib/utils/format';
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
	let successMessage = '';

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
	$: seriesDates = selectedPlan && selectedDate ? getSeriesDates(selectedDate, selectedPlan) : [];

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

	// Business hours come from the shared availability engine so the modal's
	// bookable range always matches the rest of the app.
	const openingHour = HUB_OPEN_HOUR;
	const closingHour = HUB_CLOSE_HOUR;

	// Generate hourly time slots.
	function generateTimeSlots() {
		const slots: string[] = [];

		for (let hour = openingHour; hour < closingHour; hour++) {
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
	$: availableEndTimes = (() => {
		if (!startTime) return [];
		const start = timeToMinutes(startTime);
		return timeSlots
			.filter((time) => getTimeValue(time) > startTime)
			.map((time) => {
				const endValue = getTimeValue(time);
				return { time, endValue, booked: isSlotBooked(start, timeToMinutes(endValue)) };
			});
	})();

	// Duration between start and end.
	$: bookingDuration =
		startTime && endTime
			? calculateDuration(startTime, endTime)
			: '';

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

	function handleStartTimeChange() {
		// Reset end time whenever start time changes.
		// This prevents an invalid end time from remaining selected.
		endTime = '';
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
		successMessage = '';

		step = 1;
	}

    async function submitBooking() {
        errorMessage = '';
        successMessage = '';

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

            successMessage = 'Your booking has been submitted successfully.';

            // Close after showing success message
            setTimeout(() => {
                close();
            }, 1500);
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
		<div class="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dark-200 bg-dark-50 px-4 py-3">
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
						Up to {room.capacity} people · ₱{room.price_per_hour}/hour
					</p>
				</div>
			</div>
			{#if selectedPlan}
				<span class="rounded-full bg-dark-200 px-3 py-1 text-xs text-dark-600">
					{selectedPlan.name} · {selectedPlan.duration_label}
				</span>
			{/if}
		</div>

		<!-- Progress indicator -->
		<div class="mb-6 flex items-center gap-2 text-xs font-medium">
			{#each stepTitles as title, i}
				{@const stepNum = i + 1}
				{#if i > 0}
					<span class="h-px flex-1 bg-dark-200"></span>
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
									<div class="font-bold text-dark-900">₱{plan.price}</div>
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
						disableWeekends={selectedPlan?.slug === 'weekly'}
						on:selectDate={(e) => (selectedDate = e.detail)}
					/>

					{#if isSeriesPlan && seriesDates.length > 1}
						<div class="mt-4 rounded-xl border border-dark-200 bg-dark-50 p-4">
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

			<div class="mt-6 flex justify-end">
				<button
					type="button"
					class="btn-primary px-6 py-2.5 disabled:cursor-not-allowed disabled:opacity-50"
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
						Select Time
					</p>

					<div class="grid grid-cols-1 gap-4">
						<div>
							<label for="start-time" class="mb-1.5 block text-xs text-dark-500">
								Start Time
							</label>
							<select
								id="start-time"
								bind:value={startTime}
								on:change={handleStartTimeChange}
								class="input"
							>
								<option value="">Select start time</option>
								{#each timeSlots as time}
									{@const value = getTimeValue(time)}
									<option value={value} disabled={bookedStarts.has(value)}>
										{time}{bookedStarts.has(value) ? ' (Booked)' : ''}
									</option>
								{/each}
							</select>
						</div>

						<div>
							<label for="end-time" class="mb-1.5 block text-xs text-dark-500">
								End Time
							</label>
							<select
								id="end-time"
								bind:value={endTime}
								disabled={!startTime}
								class="input disabled:cursor-not-allowed disabled:opacity-50"
							>
								<option value="">
									{startTime ? 'Select end time' : 'Select start time first'}
								</option>
								{#each availableEndTimes as { time, endValue, booked }}
									<option value={endValue} disabled={booked}>
										{time}{booked ? ' (Booked)' : ''}
									</option>
								{/each}
							</select>
						</div>
					</div>

					{#if bookingDuration}
						<div class="mt-4 inline-flex items-center rounded-lg bg-dark-100 border border-dark-200 px-3 py-2 text-sm text-dark-600">
							Duration:
							<span class="ml-1.5 font-semibold text-dark-900">{bookingDuration}</span>
						</div>
					{/if}

					<p class="mt-4 text-xs text-dark-500">
						Greyed-out times marked
						<span class="font-medium text-red-600">(Booked)</span> are already taken and can't be selected.
					</p>
				</div>


				<!-- Details -->
				<div class="space-y-4 rounded-xl border border-dark-200 bg-dark-50 p-5">
					<h3 class="text-sm font-semibold text-dark-900">Your Details</h3>

					<div>
						<label for="guest-name" class="mb-1.5 block text-xs text-dark-500">Full Name</label>
						<input
							id="guest-name"
							type="text"
							bind:value={guestName}
							placeholder="Enter your full name"
							class="input"
						/>
					</div>

					<div>
						<label for="guest-email" class="mb-1.5 block text-xs text-dark-500">Email</label>
						<input
							id="guest-email"
							type="email"
							bind:value={guestEmail}
							placeholder="Enter your email"
							class="input"
						/>
					</div>

					<div>
						<label for="guest-phone" class="mb-1.5 block text-xs text-dark-500">Phone</label>
						<input
							id="guest-phone"
							type="tel"
							bind:value={guestPhone}
							placeholder="Enter your phone number"
							class="input"
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
					disabled={!canContinue2}
					on:click={nextStep}
				>
					Continue
				</button>
			</div>
		{/if}


		<!-- STEP 3: Review & Confirm -->
		{#if step === 3}
			<div class="rounded-xl border border-dark-200 bg-dark-50 p-5">
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

			{#if successMessage}
				<div class="mt-5 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">
					{successMessage}
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

	{/if}
</Modal>
