import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createServerClient } from '$lib/supabase/server';
import { isPastDate, isWeekend, minutesToTime, rangesOverlap, timeToMinutes } from '$lib/utils/dates';
import { isVictorianHoliday } from '$lib/utils/holidays';
import { sendMail, getAdminEmails } from '$lib/server/mail';
import { sendBookingConfirmationEmail, schedulePaymentReminder } from '$lib/server/bookingEmails';
import { expireStalePendingBookings } from '$lib/server/expireBookings';
import type { BookingChargeType, Membership, TimeRange } from '$lib/types/database';

const BLOCKING_STATUSES = ['pending', 'paid', 'completed'];
// Membership included-hours only cover on-demand (hourly/period) bookings;
// Weekly/Monthly passes are separate purchases. (See Room Rental Rate Structure.)
const ON_DEMAND_PLAN_SLUGS = ['hourly', 'half-day', 'full-day'];
const CLOSED_DATES_LOOKAHEAD_DAYS = 60;

function monthStart(isoDate: string): string {
	const [y, m] = isoDate.split('-');
	return `${y}-${m}-01`;
}

function monthEnd(isoDate: string): string {
	const [y, m] = isoDate.split('-');
	const lastDay = new Date(Date.UTC(+y, +m, 0)).getUTCDate();
	return `${y}-${m}-${String(lastDay).padStart(2, '0')}`;
}

/** Sorts and merges overlapping/adjacent minute ranges into a minimal set. */
function mergeMinuteRanges(ranges: [number, number][]): [number, number][] {
	const sorted = [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
	const merged: [number, number][] = [];
	for (const [start, end] of sorted) {
		const last = merged[merged.length - 1];
		if (last && start <= last[1]) last[1] = Math.max(last[1], end);
		else merged.push([start, end]);
	}
	return merged;
}

function rangesEqual(a: [number, number][], b: [number, number][]): boolean {
	return a.length === b.length && a.every((r, i) => r[0] === b[i][0] && r[1] === b[i][1]);
}

function formatDateLabel(isoDate: string): string {
	return new Date(`${isoDate}T00:00:00`).toLocaleDateString('en-AU', {
		weekday: 'long',
		day: 'numeric',
		month: 'long'
	});
}

function formatMinuteRanges(ranges: [number, number][]): string {
	return ranges
		.map(([s, e]) => `${minutesToTime(s)}–${minutesToTime(e)}`)
		.join(', ');
}

export const POST: RequestHandler = async ({ request }) => {
	const supabase = createServerClient();

	// Endpoints verify the client's access token directly rather than relying on
	// a server-side session (hooks.server.ts only starts the expiry job). The
	// Supabase server client uses the service-role key, which bypasses RLS, so
	// this check is the only thing standing between "logged in as X" and "claims
	// to be X".
	const authHeader = request.headers.get('authorization');
	const accessToken = authHeader?.replace('Bearer ', '');

	if (!accessToken) {
		return json({ message: 'You must be logged in to book a room.' }, { status: 401 });
	}

	const {
		data: { user },
		error: authError
	} = await supabase.auth.getUser(accessToken);

	if (authError || !user) {
		return json({ message: 'Your session has expired. Please log in again.' }, { status: 401 });
	}

	const body = await request.json();
	let blockedByMemberPriority = false;
	const {
		room_id,
		plan_id,
		dates, // string[] — one row will be created per date (Weekly/Monthly repeat the same time across several days; Daily/others send a single-element array)
		start_time,
		end_time,
		excluded_ranges, // TimeRange[] — hours already held by other guests that a pass accepts being excluded (single-date plans)
		excluded_ranges_by_date, // Record<string, TimeRange[]> — the same, per date, for Weekly/Monthly passes spanning several days
		guest_name,
		guest_email,
		guest_phone,
		purpose
	} = body ?? {};

	if (
		!room_id ||
		!Array.isArray(dates) ||
		dates.length === 0 ||
		!start_time ||
		!end_time ||
		!guest_name ||
		!guest_email
	) {
		return json({ message: 'Missing required booking fields.' }, { status: 400 });
	}

	if (timeToMinutes(start_time) >= timeToMinutes(end_time)) {
		return json({ message: 'Start time must be before end time.' }, { status: 400 });
	}

	if (dates.some((d: string) => isPastDate(d))) {
		return json({ message: 'Cannot book a date in the past.' }, { status: 400 });
	}

	// ==========================================================
	// ROOM + PLAN are needed to decide how conflicts are handled:
	// a Full-day, Half-day, Weekly or Monthly pass may proceed
	// despite overlapping bookings by recording the held hours as
	// "excluded"; every other plan only ever books free time, so any
	// overlap is a hard conflict.
	// ==========================================================
	const { data: room } = await supabase
		.from('rooms')
		.select('id, slug, name')
		.eq('id', room_id)
		.single();

	const { data: plan } = plan_id
		? await supabase.from('plans').select('id, slug, name').eq('id', plan_id).single()
		: { data: null };

	// Full-day, half-day, weekly and monthly passes may book around hours another
	// guest already holds, recording those hours as "excluded" once the client
	// acknowledges them; every other plan only ever books free time, so any
	// overlap is a hard conflict.
	const canExclude =
		plan?.slug === 'full-day' ||
		plan?.slug === 'half-day' ||
		plan?.slug === 'weekly' ||
		plan?.slug === 'monthly';
	const requestStart = timeToMinutes(start_time);
	const requestEnd = timeToMinutes(end_time);

	// Re-check availability server-side for every date in the series — the
	// client's slot list may be stale if someone else booked one of these
	// dates in the meantime. There's no DB-level exclusion constraint on
	// (room_id, date, time range) in the current schema, so this
	// check-then-insert is best-effort; consider adding a Postgres EXCLUDE
	// constraint (btree_gist) on bookings for airtight protection.
	//
	// user_id is fetched so a pass can tell "other guests' holds"
	// apart from the caller's own bookings: your own prior booking on the same
	// day must NOT look like an hour someone else took (it would turn the day
	// into a self-imposed conflict). Plans without exclusions still check every
	// booking, including the caller's own, to prevent double-booking yourself.
	const { data: existing, error: existingError } = await supabase
		.from('bookings')
		.select('user_id, date, start_time, end_time, excluded_ranges')
		.eq('room_id', room_id)
		.in('date', dates)
		.in('status', BLOCKING_STATUSES);

	if (existingError) {
		return json({ message: 'Could not verify availability. Please try again.' }, { status: 500 });
	}

	// Hours already held by other guests that the caller's pass agrees to
	// exclude, per date. Server-authoritative: recomputed from the query
	// result, then verified against what the client showed/acked.
	const excludedRangesByDate: Record<string, TimeRange[]> = {};

	if (canExclude) {
		// The client acknowledges the held hours per date: a Weekly series sends
		// excluded_ranges_by_date, single-date plans send the flat excluded_ranges.
		const useByDate = !!excluded_ranges_by_date;
		function clientExcludedFor(date: string): [number, number][] {
			const ranges = useByDate
				? (excluded_ranges_by_date as Record<string, TimeRange[]>)[date] ?? []
				: (excluded_ranges ?? []);
			return mergeMinuteRanges(
				ranges.map(
					(r: TimeRange) =>
						[timeToMinutes(r.start_time), timeToMinutes(r.end_time)] as [number, number]
				)
			);
		}

		// Minutes a blocking booking genuinely holds on the requested day. A
	// pass with its own excluded_ranges does NOT hold those hours
	// (they belonged to a third guest), so they are carved out before the
	// union below — otherwise one leftover pass would look like it
	// blocks the entire day.
	function heldRange(b: {
		start_time: string;
		end_time: string;
		excluded_ranges?: TimeRange[];
	}): [number, number][] {
		const start = timeToMinutes(b.start_time);
		const end = timeToMinutes(b.end_time);
		const exclusions = (b.excluded_ranges ?? [])
			.map(
				(r: TimeRange) =>
					[timeToMinutes(r.start_time), timeToMinutes(r.end_time)] as [number, number]
			)
			.sort((a, c: [number, number]) => a[0] - c[0] || a[1] - c[1]);

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

	for (const date of dates) {
			// Only OTHER guests' bookings count as excluded hours for a
			// pass — the caller's own holds are theirs already and
			// must not turn the day into a self-conflict.
			const overlapping = (existing ?? []).filter(
				(b: { user_id: string; date: string; start_time: string; end_time: string }) =>
					b.user_id !== user.id &&
					b.date === date &&
					rangesOverlap(
						requestStart,
						requestEnd,
						timeToMinutes(b.start_time),
						timeToMinutes(b.end_time)
					)
			);

			// The held hours are the union of what each overlapping booking
			// genuinely occupies.
			const required = mergeMinuteRanges(
				overlapping.flatMap((b) =>
					heldRange(b)
						.map(
							([s, e]) =>
								[
									Math.max(s, requestStart),
									Math.min(e, requestEnd)
								] as [number, number]
						)
						.filter(([s, e]) => s < e)
				)
			);
			if (required.length === 0) continue; // this date is fully free

			// A single-date request whose whole window is gone has nothing to
			// offer — hard conflict. A weekly series may still proceed: a fully
			// booked day is simply excluded and the rest of the week stays usable.
			if (
				dates.length === 1 &&
				required.length === 1 &&
				required[0][0] <= requestStart &&
				required[0][1] >= requestEnd
			) {
				return json(
					{
						message: `${formatDateLabel(date)} has no free time left in the period you asked for. Please pick another time or day.`,
						conflictDates: [date]
					},
					{ status: 409 }
				);
			}

			// The client must have acknowledged exactly these hours; anything
			// else means the snapshot the user approved is already stale.
			if (!rangesEqual(clientExcludedFor(date), required)) {
				return json(
					{
						message: `Another booking just claimed time on ${formatDateLabel(date)}. Your pass would now need to exclude ${formatMinuteRanges(required)}. Please review and confirm again.`,
						conflictDates: [date]
					},
					{ status: 409 }
				);
			}

			excludedRangesByDate[date] = required.map(([s, e]) => ({
				start_time: minutesToTime(s),
				end_time: minutesToTime(e)
			}));
		}
	} else {
		const conflictDates = dates.filter((date: string) =>
			(existing ?? []).some(
				(b: { date: string; start_time: string; end_time: string }) =>
					b.date === date &&
					rangesOverlap(
						requestStart,
						requestEnd,
						timeToMinutes(b.start_time),
						timeToMinutes(b.end_time)
					)
			)
		);

		if (conflictDates.length > 0) {
			return json(
				{
					message: `That time is already booked on: ${conflictDates.join(', ')}. Please pick another time or start date.`,
					conflictDates
				},
				{ status: 409 }
			);
		}
	}

	// ==========================================================
	// MEMBERSHIP / INCLUDED-HOURS COVERAGE (Sections 6, 7, 8)
	// Determine, per date, whether the booking is covered by the user's
	// membership included hours ('membership'), bills as additional usage at
	// standard rates ('additional'), or is a separate pass purchase (null).
	// ==========================================================

	// Block bookings on closed days (weekends and Victorian public holidays).
	// Monthly passes are a 20-weekday series (weekends/holidays already skipped
	// on the client), so this check is mostly redundant for them; every other
	// plan must book on an open weekday.
	if (plan?.slug !== 'monthly') {
		const closed = dates.filter((d: string) => isWeekend(d) || isVictorianHoliday(d));
		if (closed.length > 0) {
			return json(
				{
					message: `The hub is closed on: ${closed.join(', ')}. Please pick an open weekday.`,
					closedDays: closed
				},
				{ status: 400 }
			);
		}
	}

	// Check administrator-controlled closed dates.
	const { data: adminClosedDates } = await supabase
		.from('closed_dates')
		.select('date')
		.in('date', dates);

	if (adminClosedDates && adminClosedDates.length > 0) {
		return json(
			{
				message: `The hub is closed on: ${adminClosedDates.map((d) => d.date).join(', ')}. Please pick an open date.`,
				closedDates: adminClosedDates.map((d) => d.date)
			},
			{ status: 400 }
		);
	}

	if (blockedByMemberPriority) {
		return json(
			{
				message:
					'This time slot is reserved for members with a 48-hour priority booking window. Please pick another time or become a member.',
			},
			{ status: 403 }
		);
	}

	const { data: membershipRows } = await supabase
		.from('memberships')
		.select('*')
		.eq('user_id', user.id)
		.eq('is_active', true)
		.limit(1);
	const membership: Membership | null = membershipRows?.[0] ?? null;

	// 48-hour priority booking for members (Section 4)
	// Members get a 48-hour priority booking window before regular customers.
	// If a regular customer tries to book a slot that a member has already booked
	// within the priority window, the regular customer's booking is blocked.
	const priorityWindowMs = 48 * 60 * 60 * 1000;

	if (!membership && plan) {
		// Check if any active member has booked the same room and date/time
		// within the 48-hour priority window, blocking regular customers.
		const priorityCutoff = new Date(Date.now() - priorityWindowMs);
		const { data: memberBookings } = await supabase
			.from('bookings')
			.select('date, start_time, end_time, status, created_at, updated_at')
			.eq('room_id', room_id)
			.in('status', ['paid', 'completed']);

		if (memberBookings && memberBookings.length > 0) {
			for (const mb of memberBookings) {
				const bookingDate = new Date(mb.date);
				const bookingStart = timeToMinutes(mb.start_time);
				const bookingEnd = timeToMinutes(mb.end_time);
				const requestStart = timeToMinutes(start_time);
				const requestEnd = timeToMinutes(end_time);

				// Check for overlap and if the member booking is within the priority window
				if (
					mb.date === dates[0] &&
					!((bookingEnd <= requestStart) || (bookingStart >= requestEnd))
				) {
					const memberBookingTime = new Date(mb.created_at ?? mb.updated_at ?? Date.now());
					const diffMs = Math.abs(Date.now() - memberBookingTime.getTime());
					if (diffMs < priorityWindowMs) {
						blockedByMemberPriority = true;
						break;
					}
				}
			}
		}
	}

	const isOnDemand =
		!!plan && ON_DEMAND_PLAN_SLUGS.includes(plan.slug as string);
	const baseMinutes = timeToMinutes(end_time) - timeToMinutes(start_time);

	// Minutes a BookingChargeType actually occupies on a date: a pass
	// with excluded hours bills the hours it can actually use, not the ones
	// another guest already holds.
	function minutesForDate(date: string): number {
		const excluded = (excludedRangesByDate[date] ?? []).reduce(
			(total, r) => total + (timeToMinutes(r.end_time) - timeToMinutes(r.start_time)),
			0
		);
		return Math.max(0, baseMinutes - excluded);
	}

	const chargeTypeByDate: Record<string, BookingChargeType> = {};
	let usageByPeriod: { period_start: string; period_end: string; minutes: number }[] = [];

	if (isOnDemand && membership && room) {
		const roomSlug = room.slug as 'conference-room' | 'consultation-room';
		const includedMinutes = Math.round(
			(roomSlug === 'conference-room'
				? membership.included_conference_hours
				: membership.included_consultation_hours) * 60
		);

		const monthStarts = [...new Set(dates.map((d: string) => monthStart(d)))];
		const { data: usageRows } = await supabase
			.from('membership_usage')
			.select('period_start, used_minutes')
			.eq('membership_id', membership.id)
			.eq('room_slug', roomSlug)
			.in('period_start', monthStarts);

		const usedByPeriod: Record<string, number> = {};
		(usageRows ?? []).forEach((u: { period_start: string; used_minutes: number }) => {
			usedByPeriod[u.period_start] = u.used_minutes;
		});

		// Whole-booking coverage (Option A): a booking is covered only if the
		// full block fits within the remaining included hours; otherwise the
		// entire booking is billed as additional usage.
		const usedAccum: Record<string, number> = {};
		for (const date of dates) {
			const ps = monthStart(date);
			const dateMinutes = minutesForDate(date);
			const used = (usedAccum[ps] ?? 0) + (usedByPeriod[ps] ?? 0);
			if (used + dateMinutes <= includedMinutes) {
				chargeTypeByDate[date] = 'membership';
				usedAccum[ps] = (usedAccum[ps] ?? 0) + dateMinutes;
				const existing = usageByPeriod.find((u) => u.period_start === ps);
				if (existing) existing.minutes += dateMinutes;
				else usageByPeriod.push({ period_start: ps, period_end: monthEnd(date), minutes: dateMinutes });
			} else {
				chargeTypeByDate[date] = 'additional';
			}
		}
	}

	// A single multi-row INSERT is one statement, so Postgres commits or
	// rolls back the whole series together if something else (e.g. a
	// constraint violation) fails partway through.
	const rows = dates.map((date: string) => ({
		room_id,
		user_id: user.id,
		plan_id: plan_id ?? null,
		date,
		start_time,
		end_time,
		excluded_ranges: excludedRangesByDate[date] ?? [],
		guest_name,
		guest_email,
		guest_phone: guest_phone ?? null,
		purpose: purpose ?? null,
		status: 'pending',
		payment_method: 'onsite',
		charge_type: chargeTypeByDate[date] ?? null
	}));

	// booking_number is assigned automatically by a DB trigger on insert, so
	// it comes back for free in .select() — no need to generate it here.
	const { data: bookings, error: insertError } = await supabase.from('bookings').insert(rows).select();

	if (insertError) {
		return json({ message: 'Could not create the booking. Please try again.' }, { status: 500 });
	}

	// Increment the ledger for membership-covered hours. Uses the atomic
	// add_membership_usage RPC so concurrent bookings don't overwrite each
	// other's usage. Fire-and-forget with error logging; a ledger hiccup must
	// never block the success response.
	if (membership && usageByPeriod.length > 0) {
		for (const u of usageByPeriod) {
			const { error: usageError } = await supabase.rpc('add_membership_usage', {
				p_membership_id: membership.id,
				p_period_start: u.period_start,
				p_period_end: u.period_end,
				p_room_slug: room?.slug,
				p_minutes: u.minutes
			});
			if (usageError) {
				console.error('membership usage increment failed:', usageError);
			}
		}
	}

	// Booking number(s) for this batch, used across the confirmation email,
	// the payment reminder, and the admin notification below.
	const bookingSummaries = (bookings ?? []).map((b) => ({
		id: b.id as string,
		booking_number: b.booking_number as string,
		date: b.date as string,
		start_time: b.start_time as string,
		end_time: b.end_time as string,
		excluded_ranges: (b.excluded_ranges as TimeRange[] | null) ?? []
	}));
	const bookingNumbersLabel = bookingSummaries.map((b) => b.booking_number).join(', ');

	// Confirm the request to the guest right away, and follow up a few
	// minutes later with a payment reminder if it's still pending. Both are
	// fire-and-forget — a mail hiccup must never block the booking response.
	sendBookingConfirmationEmail({
		guestEmail: guest_email,
		guestName: guest_name,
		roomName: room?.name ?? 'the room',
		bookings: bookingSummaries
	});

	schedulePaymentReminder({
		guestEmail: guest_email,
		guestName: guest_name,
		roomName: room?.name ?? 'the room',
		bookings: bookingSummaries
	});

	// Notify all admins about the new booking. Fire-and-forget with error
	// logging so a mail failure never blocks the successful booking response.
	// `room` was already loaded for membership coverage above.
	const admins = await getAdminEmails(supabase);
	if (admins.length > 0) {
		const dateList = dates.join(', ');
		sendMail({
			to: admins,
			subject: `New booking submitted \u2014 ${bookingNumbersLabel}`,
			text: `A new booking has been submitted for ${room?.name ?? 'a room'} on ${dateList} from ${start_time} to ${end_time} by ${guest_name} (${guest_email}). Booking reference: ${bookingNumbersLabel}. It is pending payment.`
		});
	}

	// Release any pending bookings that have now exceeded the 30-minute payment
	// window. Fire-and-forget so a slow sweep can never block the successful
	// booking response.
	void expireStalePendingBookings();

	return json({ bookings }, { status: 201 });
};