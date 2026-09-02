import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createServerClient } from '$lib/supabase/server';
import { isPastDate, isWeekend, rangesOverlap, timeToMinutes } from '$lib/utils/dates';
import { isVictorianHoliday } from '$lib/utils/holidays';
import { sendMail, getAdminEmails } from '$lib/server/mail';
import { sendBookingConfirmationEmail, schedulePaymentReminder } from '$lib/server/bookingEmails';
import type { BookingChargeType, Membership } from '$lib/types/database';

const BLOCKING_STATUSES = ['pending', 'approved', 'paid', 'completed'];
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

export const POST: RequestHandler = async ({ request }) => {
	const supabase = createServerClient();

	// There's no server-side session (no hooks.server.ts), so the client sends
	// its access token and we verify it here rather than trusting a
	// client-supplied user_id — this client uses the service-role key, which
	// bypasses RLS, so this check is the only thing standing between "logged
	// in as X" and "claims to be X".
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

	// Re-check availability server-side for every date in the series — the
	// client's slot list may be stale if someone else booked one of these
	// dates in the meantime. There's no DB-level exclusion constraint on
	// (room_id, date, time range) in the current schema, so this
	// check-then-insert is best-effort; consider adding a Postgres EXCLUDE
	// constraint (btree_gist) on bookings for airtight protection.
	const { data: existing, error: existingError } = await supabase
		.from('bookings')
		.select('date, start_time, end_time')
		.eq('room_id', room_id)
		.in('date', dates)
		.in('status', BLOCKING_STATUSES);

	if (existingError) {
		return json({ message: 'Could not verify availability. Please try again.' }, { status: 500 });
	}

	const conflictDates = dates.filter((date: string) =>
		(existing ?? []).some(
			(b: { date: string; start_time: string; end_time: string }) =>
				b.date === date &&
				rangesOverlap(
					timeToMinutes(start_time),
					timeToMinutes(end_time),
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

	// ==========================================================
	// MEMBERSHIP / INCLUDED-HOURS COVERAGE (Sections 6, 7, 8)
	// Determine, per date, whether the booking is covered by the user's
	// membership included hours ('membership'), bills as additional usage at
	// standard rates ('additional'), or is a separate pass purchase (null).
	// ==========================================================
	const { data: room } = await supabase
		.from('rooms')
		.select('id, slug, name')
		.eq('id', room_id)
		.single();

	const { data: plan } = plan_id
		? await supabase.from('plans').select('id, slug, name').eq('id', plan_id).single()
		: { data: null };

	// Block bookings on closed days (weekends and Victorian public holidays).
	// Monthly passes are a recurring calendar-month access and keep their full
	// range; every other plan must book on an open weekday.
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
			.in('status', ['approved', 'paid', 'completed']);

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
	const minutes = timeToMinutes(end_time) - timeToMinutes(start_time);

	const chargeTypeByDate: Record<string, BookingChargeType> = {};
	let usageByPeriod: { period_start: string; period_end: string; minutes: number }[] = [];

	if (isOnDemand && membership && room) {
		const roomSlug = room.slug as 'conference-room' | 'meeting-room';
		const includedMinutes = Math.round(
			(roomSlug === 'conference-room'
				? membership.included_conference_hours
				: membership.included_meeting_hours) * 60
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
			const used = (usedAccum[ps] ?? 0) + (usedByPeriod[ps] ?? 0);
			if (used + minutes <= includedMinutes) {
				chargeTypeByDate[date] = 'membership';
				usedAccum[ps] = (usedAccum[ps] ?? 0) + minutes;
				const existing = usageByPeriod.find((u) => u.period_start === ps);
				if (existing) existing.minutes += minutes;
				else usageByPeriod.push({ period_start: ps, period_end: monthEnd(date), minutes });
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
		end_time: b.end_time as string
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
			text: `A new booking has been submitted for ${room?.name ?? 'a room'} on ${dateList} from ${start_time} to ${end_time} by ${guest_name} (${guest_email}). Booking reference: ${bookingNumbersLabel}. It is pending approval.`
		});
	}

	return json({ bookings }, { status: 201 });
};