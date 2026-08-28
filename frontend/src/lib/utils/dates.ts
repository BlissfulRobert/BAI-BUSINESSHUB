import type { Booking, Plan } from '$lib/types/database';

/** Business hours the hub is bookable within. Adjust to match real operating hours. */
export const HUB_OPEN_HOUR = 6; // 6:00 AM
export const HUB_CLOSE_HOUR = 20; // 8:00 PM
const SLOT_STEP_MINUTES = 60;

/** How far ahead a series start date can be picked. */
export const CALENDAR_LOOKAHEAD_DAYS = 60;
/** Longest a series can run (Monthly, worst case ~31 days) — used to size how far ahead we fetch bookings. */
export const MAX_SERIES_DAYS = 31;

/** 'HH:MM:SS' -> minutes since midnight */
export function timeToMinutes(time: string): number {
	const [h, m] = time.split(':').map(Number);
	return h * 60 + m;
}

/** minutes since midnight -> 'HH:MM:SS' */
export function minutesToTime(minutes: number): string {
	const h = Math.floor(minutes / 60)
		.toString()
		.padStart(2, '0');
	const m = (minutes % 60).toString().padStart(2, '0');
	return `${h}:${m}:00`;
}

/** Human label, e.g. '9:00 AM' */
export function formatTimeLabel(time: string): string {
	const minutes = timeToMinutes(time);
	const date = new Date(2000, 0, 1, 0, minutes);
	return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export interface TimeSlot {
	start_time: string;
	end_time: string;
	label: string;
	available: boolean;
}

/**
 * Builds candidate start-time slots for a given plan duration, marking any
 * slot unavailable if it overlaps an existing booking or runs past closing.
 * `existingBookings` should already be filtered to the same room + date and
 * to statuses that hold the slot (pending/approved/paid/completed).
 */
export function buildTimeSlots(durationHours: number, existingBookings: Booking[]): TimeSlot[] {
	const openMin = HUB_OPEN_HOUR * 60;
	const closeMin = HUB_CLOSE_HOUR * 60;
	const durationMin = durationHours * 60;
	const slots: TimeSlot[] = [];

	for (let start = openMin; start + durationMin <= closeMin; start += SLOT_STEP_MINUTES) {
		const end = start + durationMin;
		const startTime = minutesToTime(start);
		const endTime = minutesToTime(end);

		const overlaps = existingBookings.some((b) =>
			rangesOverlap(start, end, timeToMinutes(b.start_time), timeToMinutes(b.end_time))
		);

		slots.push({
			start_time: startTime,
			end_time: endTime,
			label: `${formatTimeLabel(startTime)} – ${formatTimeLabel(endTime)}`,
			available: !overlaps
		});
	}

	return slots;
}

export function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
	return aStart < bEnd && bStart < aEnd;
}

/** 'YYYY-MM-DD' for a Date, in local time (avoids UTC off-by-one) */
export function toISODate(date: Date): string {
	const y = date.getFullYear();
	const m = (date.getMonth() + 1).toString().padStart(2, '0');
	const d = date.getDate().toString().padStart(2, '0');
	return `${y}-${m}-${d}`;
}

export function isPastDate(isoDate: string): boolean {
	const today = toISODate(new Date());
	return isoDate < today;
}

export function addDays(iso: string, days: number): string {
	const d = new Date(`${iso}T00:00:00`);
	d.setDate(d.getDate() + days);
	return toISODate(d);
}

/**
 * Adds calendar months, clamping to the last valid day of the target month
 * if the original day doesn't exist there (e.g. Jan 31 + 1 month -> Feb 28/29,
 * not Mar 3, which is what naive Date arithmetic would otherwise produce).
 */
export function addMonthsClamped(iso: string, months: number): string {
	const d = new Date(`${iso}T00:00:00`);
	const originalDay = d.getDate();
	d.setMonth(d.getMonth() + months);
	if (d.getDate() !== originalDay) {
		d.setDate(0); // rolls back to the last day of the intended target month
	}
	return toISODate(d);
}

export function isWeekend(iso: string): boolean {
	const dow = new Date(`${iso}T00:00:00`).getDay();
	return dow === 0 || dow === 6;
}

/**
 * Weekly/Monthly plans repeat the same daily time slot across several days:
 * Weekly = 5 weekdays (Mon–Fri), skipping weekends — if the start date itself
 * falls on a weekend the first weekday on/after it is used as day one.
 * Monthly = the same date range up to (but not including) the same date next
 * month. Any other plan is a single day.
 */
export function getSeriesDates(startIso: string, plan: Plan): string[] {
	if (plan.slug === 'weekly') {
		const dates: string[] = [];
		let cur = startIso;
		while (dates.length < 5) {
			if (!isWeekend(cur)) dates.push(cur);
			cur = addDays(cur, 1);
		}
		return dates;
	}
	if (plan.slug === 'monthly') {
		const endExclusive = addMonthsClamped(startIso, 1);
		const dates: string[] = [];
		for (let cur = startIso; cur < endExclusive; cur = addDays(cur, 1)) {
			dates.push(cur);
		}
		return dates;
	}
	return [startIso];
}

/**
 * A day counts as "fully booked" if there's no free 1-hour block left in
 * business hours — used for the calendar's per-day indicator, independent
 * of whatever duration the member ends up picking.
 */
export function isDateFullyBooked(existingBookingsForDate: Booking[]): boolean {
	const hourlySlots = buildTimeSlots(1, existingBookingsForDate);
	return hourlySlots.length > 0 && hourlySlots.every((slot) => !slot.available);
}

export interface CalendarDay {
	iso: string;
	dayOfMonth: number;
	isCurrentMonth: boolean;
	isPast: boolean;
	isFullyBooked: boolean;
}

/**
 * Builds a Sun–Sat grid (including leading/trailing days from adjacent
 * months so every week is 7 cells) for the given month.
 * `bookingsByDate` should map ISO date -> that date's blocking bookings.
 */
export function buildMonthGrid(
	year: number,
	month: number, // 0-indexed, like Date's getMonth()
	bookingsByDate: Record<string, Booking[]>
): CalendarDay[] {
	const firstOfMonth = new Date(year, month, 1);
	const startOffset = firstOfMonth.getDay(); // 0 = Sunday
	const gridStart = new Date(year, month, 1 - startOffset);

	const daysInGrid = 42; // 6 weeks, always enough to cover any month
	const today = toISODate(new Date());

	return Array.from({ length: daysInGrid }, (_, i) => {
		const d = new Date(gridStart);
		d.setDate(gridStart.getDate() + i);
		const iso = toISODate(d);
		const bookingsForDay = bookingsByDate[iso] ?? [];

		return {
			iso,
			dayOfMonth: d.getDate(),
			isCurrentMonth: d.getMonth() === month,
			isPast: iso < today,
			isFullyBooked: isDateFullyBooked(bookingsForDay)
		};
	});
}