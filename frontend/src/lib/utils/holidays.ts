// Victorian public holidays (Australia) used to block booking on closed days.
// Combines fixed-date holidays, Easter-based holidays, numbered weekday-of-month
// holidays, and the AFL Grand Final Friday approximation.

function toISODate(year: number, month: number, day: number): string {
	return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function addDays(iso: string, days: number): string {
	const d = new Date(`${iso}T00:00:00`);
	d.setDate(d.getDate() + days);
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

/** Easter Sunday for a given year (Meeus/Jones/Butcher algorithm). */
function easterSunday(year: number): string {
	const a = year % 19;
	const b = Math.floor(year / 100);
	const c = year % 100;
	const d = Math.floor(b / 4);
	const e = b % 4;
	const f = Math.floor((b + 8) / 25);
	const g = Math.floor((b - f + 1) / 3);
	const h = (19 * a + b - d - g + 15) % 30;
	const i = Math.floor(c / 4);
	const k = c % 4;
	const l = (32 + 2 * e + 2 * i - h - k) % 7;
	const m = Math.floor((a + 11 * h + 22 * l) / 451);
	const month = Math.floor((h + l - 7 * m + 114) / 31);
	const day = ((h + l - 7 * m + 114) % 31) + 1;
	return toISODate(year, month, day);
}

/** Day-of-month of the n-th given weekday in a month (month is 1-indexed). */
function nthWeekday(year: number, month: number, weekday: number, n: number): number {
	const first = new Date(year, month - 1, 1);
	let offset = (weekday - first.getDay() + 7) % 7;
	return 1 + offset + (n - 1) * 7;
}

/** Australian rules for fixed-date holidays: substitute on the next Monday when the date falls on a weekend. */
function observedDay(iso: string): string {
	const dow = new Date(`${iso}T00:00:00`).getDay();
	if (dow === 6) return addDays(iso, 2); // Saturday -> Monday
	if (dow === 0) return addDays(iso, 1); // Sunday -> Monday
	return iso;
}

/** Friday before the last Saturday of September (AFL Grand Final Friday approximation). */
function grandFinalFriday(year: number): string {
	for (let d = 30; d >= 22; d--) {
		const date = new Date(year, 8, d); // September (0-indexed month 8)
		if (date.getDay() === 6) return toISODate(year, 9, d - 1);
	}
	return toISODate(year, 9, 30);
}

const FIXED_HOLIDAYS = [
	'm01-01', // New Year's Day
	'm01-26', // Australia Day
	'm04-25', // ANZAC Day
	'm12-25', // Christmas Day
	'm12-26' // Boxing Day
];

/** Date keys (MM-DD) that are fixed and get a substitute day if they fall on a weekend. */
const OBSERVED_MONTH_DAYS = ['01-01', '01-26', '04-25', '12-25', '12-26'];

/** Whether the given ISO date (YYYY-MM-DD) is a Victorian public holiday. */
export function isVictorianHoliday(iso: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
	const year = parseInt(iso.slice(0, 4), 10);

	const easter = easterSunday(year);
	const goodFriday = addDays(easter, -2);
	const easterSaturday = addDays(easter, -1);
	const easterMonday = addDays(easter, 1);

	const holidays = new Set<string>([
		...FIXED_HOLIDAYS.map((m) => `${year}-${m.slice(1)}`),
		toISODate(year, 3, nthWeekday(year, 3, 1, 2)), // Labour Day: 2nd Monday of March
		toISODate(year, 6, nthWeekday(year, 6, 1, 2)), // King's Birthday: 2nd Monday of June
		toISODate(year, 11, nthWeekday(year, 11, 2, 1)), // Melbourne Cup: 1st Tuesday of November
		goodFriday,
		easterSaturday,
		easterMonday,
		grandFinalFriday(year)
	]);

	// Substitute days when a fixed holiday lands on a weekend.
	for (const md of OBSERVED_MONTH_DAYS) {
		const raw = `${year}-${md}`;
		const observed = observedDay(raw);
		holidays.add(raw);
		holidays.add(observed);
	}

	return holidays.has(iso);
}

/**
 * Whether a day is closed to booking: weekends plus Australian/Victorian public
 * holidays. Used by the calendar to grey out days and by the server to reject
 * bookings on closed days.
 */
export function isNonBookableDay(iso: string): boolean {
	const dow = new Date(`${iso}T00:00:00`).getDay();
	if (dow === 0 || dow === 6) return true; // Sunday / Saturday
	return isVictorianHoliday(iso);
}
