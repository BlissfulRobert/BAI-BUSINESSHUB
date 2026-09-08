<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { buildMonthGrid, isWeekend, toISODate, type CalendarDay } from '$lib/utils/dates';
	import { isVictorianHoliday } from '$lib/utils/holidays';
	import { safeStringKey } from '$lib/utils/keys';
	import type { Booking } from '$lib/types/database';

	/** All blocking bookings for the room, keyed by ISO date. */
	export let bookingsByDate: Record<string, Booking[]> = {};
	export let selectedDate: string | null = null;
	/** How many days ahead are actually loaded/bookable — caps forward navigation. */
	export let lookaheadDays = 30;
	/**
	 * ISO dates included in a multi-day series (Weekly/Monthly). When set, the
	 * range is highlighted on the calendar so the member can see the full span
	 * they're booking — start is the strongest, end is distinct, interior days
	 * get a subtle tint. Purely visual; does not affect picking or disabling.
	 */
	export let rangeDates: string[] = [];
	/** Open the calendar on the month containing this ISO date (defaults to today). */
	export let initialDate: string | null = null;
	/**
	 * Read-only display mode (e.g. the "View schedule" pop-up): days are not
	 * selectable, but month navigation stays enabled so the schedule can be
	 * browsed. Purely visual; does not affect the day colouring at all.
	 */
	export let readonly = false;
	/** Compact sizing for embed-in-popup use: tighter padding, smaller cells. */
	export let compact = false;
	/** Hide the "Fully booked" red dot and its legend entry (view-schedule pop-ups). */
	export let hideFullyBooked = false;

	const dispatch = createEventDispatcher<{ selectDate: string }>();

	const today = new Date();
	const startDate = initialDate ? new Date(`${initialDate}T00:00:00`) : today;
	let viewYear = startDate.getFullYear();
	let viewMonth = startDate.getMonth();

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
		if (readonly) return;
		if (day.isPast || day.isFullyBooked || !day.isCurrentMonth) return;
		if (isNonBookable(day.iso)) return;
		if (toISODate(new Date(day.iso)) > toISODate(maxDate)) return;
		dispatch('selectDate', day.iso);
	}

	// Weekends and Victorian public holidays are closed — greyed out and not selectable.
	function isNonBookable(iso: string): boolean {
		return isWeekend(iso) || isVictorianHoliday(iso);
	}

	const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
</script>

<div class="rounded-xl border border-dark-200 bg-white {compact ? 'p-3' : 'p-4'}">
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

	<div class="mt-1 grid grid-cols-7 {compact ? 'gap-0.5' : 'gap-1'}">
		{#each days as day, di (safeStringKey(day.iso, di))}
			{@const beyondLookahead = day.iso > toISODate(maxDate)}
			{@const isClosedDay = isNonBookable(day.iso)}
			{@const disabled = day.isPast || day.isFullyBooked || !day.isCurrentMonth || beyondLookahead || isClosedDay}
			{@const isHoliday = isVictorianHoliday(day.iso)}
			{@const isWeekendDay = isWeekend(day.iso)}
			{@const isRangeStart = rangeDates.length > 1 && day.iso === rangeStart}
			{@const isRangeEnd = rangeDates.length > 1 && day.iso === rangeEnd}
			{@const isRangeInterior = rangeDates.length > 1 && day.iso !== rangeStart && day.iso !== rangeEnd && rangeSet.has(day.iso)}
<button
				type="button"
				on:click={() => pick(day)}
				{disabled}
				tabindex={readonly ? -1 : 0}
				aria-pressed={selectedDate === day.iso}
				class="relative flex items-center justify-center rounded-lg {compact
					? 'h-8 text-xs'
					: 'aspect-square text-sm'} transition
					{!day.isCurrentMonth ? 'text-dark-300' : ''}
					{disabled && day.isCurrentMonth && !isHoliday ? 'cursor-not-allowed text-dark-300' : ''}
					{isHoliday && day.isCurrentMonth ? '!bg-blue-50 !text-blue-500' : ''}
					{day.isCurrentMonth && isWeekendDay && !isHoliday ? 'bg-dark-100' : ''}
					{!disabled && day.isCurrentMonth && !readonly && !isRangeStart && !isRangeEnd && !isRangeInterior
						? 'text-dark-700 hover:bg-dark-100'
						: ''}
					{isRangeInterior ? '!bg-primary-500/15 !text-primary-700' : ''}
					{isRangeEnd ? '!bg-dark-800 !text-white' : ''}
					{selectedDate === day.iso || isRangeStart ? '!bg-primary-600 !text-white' : ''}
					{readonly ? 'cursor-default' : ''}"
			>
			{day.dayOfMonth}
			{#if isHoliday && day.isCurrentMonth}
				<span
					class="absolute left-1/2 -translate-x-1/2 rounded-full bg-blue-500 {compact ? 'bottom-0.5 h-1 w-1' : 'bottom-1 h-1.5 w-1.5'}"
					title="Public holiday"
				></span>
			{:else if day.isCurrentMonth && !day.isPast && day.availability !== 'free' && (!hideFullyBooked || day.availability === 'partial')}
				<span
					class="absolute left-1/2 -translate-x-1/2 rounded-full {day.availability === 'full'
						? 'bg-red-500'
						: 'bg-amber-500'} {compact
						? 'bottom-0.5 h-1 w-1'
						: 'bottom-1 h-1.5 w-1.5'}"
					title={day.availability === 'full' ? 'Fully booked' : 'Partially booked'}
				></span>
			{/if}
			</button>
		{/each}
	</div>

	<div class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-dark-500">
		{#if selectedDate}
			<span class="flex items-center gap-1">
				<span class="inline-block h-3 w-3 rounded bg-primary-600"></span>
				Scheduled
			</span>
		{/if}
		<span class="flex items-center gap-1">
			<span class="inline-block h-3 w-3 rounded border border-dark-200 bg-dark-100"></span>
			Weekend (closed)
		</span>
		<span class="flex items-center gap-1">
			<span class="inline-block h-3 w-3 rounded border border-blue-200 bg-blue-50"></span>
			Public holiday (closed)
		</span>
		{#if !hideFullyBooked}
			<span class="flex items-center gap-1">
				<span class="h-1.5 w-1.5 rounded-full bg-red-500"></span>
				Fully booked
			</span>
		{/if}
		<span class="flex items-center gap-1">
			<span class="h-1.5 w-1.5 rounded-full bg-amber-500"></span>
			Partially booked
		</span>
		{#if rangeDates.length > 1}
			<span class="flex items-center gap-1">
				<span class="h-1.5 w-1.5 rounded-full bg-primary-500/60"></span>
				Included in booking
			</span>
		{/if}
	</div>
</div>