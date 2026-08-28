<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { buildMonthGrid, isWeekend, toISODate, type CalendarDay } from '$lib/utils/dates';
	import type { Booking } from '$lib/types/database';

	/** All blocking bookings for the room, keyed by ISO date. */
	export let bookingsByDate: Record<string, Booking[]> = {};
	export let selectedDate: string | null = null;
	/** How many days ahead are actually loaded/bookable — caps forward navigation. */
	export let lookaheadDays = 30;
	/** Greys out Sat/Sun — used for plans (Weekly) that only book weekdays. */
	export let disableWeekends = false;
	/**
	 * ISO dates included in a multi-day series (Weekly/Monthly). When set, the
	 * range is highlighted on the calendar so the member can see the full span
	 * they're booking — start is the strongest, end is distinct, interior days
	 * get a subtle tint. Purely visual; does not affect picking or disabling.
	 */
	export let rangeDates: string[] = [];

	const dispatch = createEventDispatcher<{ selectDate: string }>();

	const today = new Date();
	let viewYear = today.getFullYear();
	let viewMonth = today.getMonth();

	const maxDate = new Date(Date.now() + lookaheadDays * 24 * 60 * 60 * 1000);

	// Sorted range bounds for series highlighting.
	const rangeStart = rangeDates[0] ?? null;
	const rangeEnd = rangeDates[rangeDates.length - 1] ?? null;
	const rangeSet = new Set(rangeDates);

	$: days = buildMonthGrid(viewYear, viewMonth, bookingsByDate);
	$: monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString('en-US', {
		month: 'long',
		year: 'numeric'
	});
	$: canGoPrev = new Date(viewYear, viewMonth, 1) > new Date(today.getFullYear(), today.getMonth(), 1);
	$: canGoNext = new Date(viewYear, viewMonth + 1, 1) <= maxDate;

	function prevMonth() {
		if (!canGoPrev) return;
		if (viewMonth === 0) {
			viewMonth = 11;
			viewYear -= 1;
		} else {
			viewMonth -= 1;
		}
	}

	function nextMonth() {
		if (!canGoNext) return;
		if (viewMonth === 11) {
			viewMonth = 0;
			viewYear += 1;
		} else {
			viewMonth += 1;
		}
	}

	function pick(day: CalendarDay) {
		if (day.isPast || day.isFullyBooked || !day.isCurrentMonth) return;
		if (disableWeekends && isWeekend(day.iso)) return;
		if (toISODate(new Date(day.iso)) > toISODate(maxDate)) return;
		dispatch('selectDate', day.iso);
	}

	const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
</script>

<div class="rounded-xl border border-dark-200 bg-white p-4">
	<div class="flex items-center justify-between">
		<button
			type="button"
			on:click={prevMonth}
			disabled={!canGoPrev}
			aria-label="Previous month"
			class="rounded-md p-1.5 disabled:cursor-not-allowed disabled:opacity-30 text-dark-500 hover:bg-dark-100"
		>
			&larr;
		</button>
		<span class="text-sm font-semibold text-dark-900">{monthLabel}</span>
		<button
			type="button"
			on:click={nextMonth}
			disabled={!canGoNext}
			aria-label="Next month"
			class="rounded-md p-1.5 disabled:cursor-not-allowed disabled:opacity-30 text-dark-500 hover:bg-dark-100"
		>
			&rarr;
		</button>
	</div>

	<div class="mt-3 grid grid-cols-7 gap-1 text-center text-xs font-medium text-dark-500">
		{#each weekdayLabels as label}
			<div>{label}</div>
		{/each}
	</div>

	<div class="mt-1 grid grid-cols-7 gap-1">
		{#each days as day (day.iso)}
			{@const beyondLookahead = day.iso > toISODate(maxDate)}
			{@const isWeekendDay = disableWeekends && isWeekend(day.iso)}
			{@const disabled = day.isPast || day.isFullyBooked || !day.isCurrentMonth || beyondLookahead || isWeekendDay}
			{@const isRangeStart = rangeDates.length > 1 && day.iso === rangeStart}
			{@const isRangeEnd = rangeDates.length > 1 && day.iso === rangeEnd}
			{@const isRangeInterior = rangeDates.length > 1 && day.iso !== rangeStart && day.iso !== rangeEnd && rangeSet.has(day.iso)}
			<button
				type="button"
				on:click={() => pick(day)}
				{disabled}
				aria-pressed={selectedDate === day.iso}
				class="relative aspect-square rounded-lg text-sm transition
					{!day.isCurrentMonth ? 'text-dark-300' : ''}
					{disabled && day.isCurrentMonth ? 'cursor-not-allowed text-dark-300' : ''}
					{!disabled && day.isCurrentMonth && !isRangeStart && !isRangeEnd && !isRangeInterior
						? 'text-dark-700 hover:bg-dark-100'
						: ''}
					{isRangeInterior ? '!bg-primary-500/15 !text-primary-700' : ''}
					{isRangeEnd ? '!bg-dark-800 !text-white' : ''}
					{selectedDate === day.iso || isRangeStart ? '!bg-primary-600 !text-white' : ''}"
			>
				{day.dayOfMonth}
				{#if day.isCurrentMonth && day.isFullyBooked && !day.isPast}
					<span
						class="absolute bottom-1 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-red-500"
						title="Fully booked"
					></span>
				{/if}
			</button>
		{/each}
	</div>

	<div class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-dark-500">
		<span class="flex items-center gap-1">
			<span class="h-1.5 w-1.5 rounded-full bg-red-500"></span>
			Fully booked
		</span>
		{#if rangeDates.length > 1}
			<span class="flex items-center gap-1">
				<span class="h-1.5 w-1.5 rounded-full bg-primary-500/60"></span>
				Included in booking
			</span>
		{/if}
	</div>
</div>