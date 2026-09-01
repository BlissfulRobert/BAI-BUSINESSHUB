import type { Booking, Room, Plan } from '$lib/types/database';

// Weekly/Monthly bookings create one DB row per date, but they are a single
// purchase. Group them back into one "series" so a pass shows as one card
// instead of one card per day. A series is identified by room + user + plan +
// time range; rows from one insert share the same created_at, which keeps
// separate weekly passes on different weeks apart.
export function seriesKey(b: Booking): string {
	const slug = b.plan?.slug;
	if (slug === 'weekly' || slug === 'monthly') {
		return `series:${b.room_id}:${b.user_id}:${b.plan_id}:${b.start_time}:${b.end_time}:${b.created_at}`;
	}
	return `single:${b.id}`;
}

export interface BookingGroup {
	key: string;
	room?: Room;
	plan?: Plan;
	bookings: Booking[];
	dates: string[];
	status: Booking['status'];
	isSeries: boolean;
}

// Groups bookings into series, preserving booking order (rows sorted by date
// ascending within each group). Non-series bookings become their own group.
export function groupBookings(bookings: Booking[]): BookingGroup[] {
	const ordered = [...bookings].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
	const map = new Map<string, BookingGroup>();
	for (const b of ordered) {
		const key = seriesKey(b);
		const existing = map.get(key);
		if (existing) {
			existing.bookings.push(b);
			existing.dates.push(b.date);
			existing.dates.sort();
		} else {
			map.set(key, {
				key,
				room: b.room,
				plan: b.plan,
				bookings: [b],
				dates: [b.date],
				status: b.status,
				isSeries: key.startsWith('series:')
			});
		}
	}
	return [...map.values()];
}

// Format a single ISO date ('2026-09-18') as e.g. "Fri 18 Sep". Falls back to
// the raw value if the date can't be parsed so we never render "undefined".
export function shortDate(iso: string): string {
	if (!iso) return '';
	const d = new Date(iso.slice(0, 10) + 'T00:00:00');
	if (isNaN(d.getTime())) return iso;
	return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
}

// Display a series' assigned dates concisely. Consecutive days collapse to a
// range ("Mon 14 Sep – Fri 18 Sep"), otherwise each day is listed.
export function dateRangeLabel(g: Pick<BookingGroup, 'dates'>): string {
	const dates = g.dates.filter(Boolean).sort();
	if (dates.length === 0) return '';
	if (dates.length === 1) return shortDate(dates[0]);

	const msPerDay = 86400000;
	const consecutive = dates.every((d, i) => {
		if (i === 0) return true;
		const prev = new Date(dates[i - 1].slice(0, 10) + 'T00:00:00').getTime();
		const cur = new Date(d.slice(0, 10) + 'T00:00:00').getTime();
		return cur - prev === msPerDay;
	});

	if (consecutive) return `${shortDate(dates[0])} – ${shortDate(dates[dates.length - 1])}`;
	return dates.map(shortDate).join(', ');
}
