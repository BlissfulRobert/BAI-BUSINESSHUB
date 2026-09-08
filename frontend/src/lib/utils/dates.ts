import type { Booking, Plan } from '$lib/types/database';
import { isVictorianHoliday } from '$lib/utils/holidays';

/** Business hours the hub is bookable within. Adjust to match real operating hours. */
export const HUB_OPEN_HOUR = 9; // 9:00 AM
export const HUB_CLOSE_HOUR = 19; // 7:00 PM
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
 * to statuses that hold the slot (pending/paid/completed).
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
 * Weekly/Monthly plans repeat the same daily time slot across several business
 * days (weekdays skipping weekends and public holidays): Weekly = 5 weekdays,
 * Monthly = 20 weekdays (4 weeks of weekdays). If the start date falls on a
 * closed day the first open weekday on/after it is used as day one. When given
 * the current bookings, closed-on-the-day fully-booked days are skipped too so
 * the pass is still 5/20 rentable days. Any other plan is a single day.
 *
 * This is the single source of truth for both the client (prediction, calendar
 * range highlight) and the server (stored end_date + conflict checks), so the
 * days shown to the user always match the stored period.
 */
export function getSeriesDates(startIso: string, plan: Pick<Plan, 'slug'>): string[] {
	if (plan.slug === 'weekly') {
		return getBusinessDaySeries(startIso, 5);
	}
	if (plan.slug === 'monthly') {
		return getBusinessDaySeries(startIso, 20);
	}
	return [startIso];
}

/**
 * The first `count` business days rolling forward from the chosen start,
 * skipping weekends, public holidays, and any day that's already fully booked
 * (no free 1-hour block left), so the pass is still `count` rentable days even
 * when some days are taken. Sequential so a Tuesday start rolls through the
 * following weeks' weekdays.
 */
export function getBusinessDaySeries(
	startIso: string,
	count: number,
	bookingsByDate: Record<string, Booking[]> = {}
): string[] {
	const dates: string[] = [];
	let cur = startIso;
	let guard = 0;
	while (dates.length < count && guard < 732) {
		guard++;
		if (!isWeekend(cur) && !isVictorianHoliday(cur) && !isDateFullyBooked(bookingsByDate[cur] ?? [])) {
			dates.push(cur);
		}
		cur = addDays(cur, 1);
	}
	return dates;
}

/** Weekly series: 5 business days (see getBusinessDaySeries). */
export function getWeeklySeriesDates(
	startIso: string,
	bookingsByDate: Record<string, Booking[]>
): string[] {
	return getBusinessDaySeries(startIso, 5, bookingsByDate);
}

/** Monthly series: 20 business days, i.e. 4 weeks of weekdays. */
export function getMonthlySeriesDates(
	startIso: string,
	bookingsByDate: Record<string, Booking[]>
): string[] {
	return getBusinessDaySeries(startIso, 20, bookingsByDate);
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

export type DayAvailability = 'free' | 'partial' | 'full';

/**
 * Classifies how booked a single day is based on free 1-hour blocks:
 * - 'free'    -> no bookings at all
 * - 'partial' -> some 1-hour blocks free, some booked
 * - 'full'    -> no free 1-hour block left in business hours
 */
export function getDayAvailability(existingBookingsForDate: Booking[]): DayAvailability {
	const hourlySlots = buildTimeSlots(1, existingBookingsForDate);
	if (hourlySlots.length === 0) return 'free';
	if (hourlySlots.every((slot) => !slot.available)) return 'full';
	if (hourlySlots.some((slot) => !slot.available)) return 'partial';
	return 'free';
}

/**
 * Number of free 1-hour blocks available on a day (0 if fully booked).
 * Used for the calendar availability teaser.
 */
export function getFreeHourCount(existingBookingsForDate: Booking[]): number {
	return buildTimeSlots(1, existingBookingsForDate).filter((slot) => slot.available).length;
}

export interface CalendarDay {
	iso: string;
	dayOfMonth: number;
	isCurrentMonth: boolean;
	isPast: boolean;
	isFullyBooked: boolean;
	availability: DayAvailability;
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
		const availability = getDayAvailability(bookingsForDay);

		return {
			iso,
			dayOfMonth: d.getDate(),
			isCurrentMonth: d.getMonth() === month,
			isPast: iso < today,
			isFullyBooked: availability === 'full',
			availability
		};
	});
}