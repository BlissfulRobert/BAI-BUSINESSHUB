import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createServerClient } from '$lib/supabase/server';
import { isPastDate, rangesOverlap, timeToMinutes } from '$lib/utils/dates';
import { sendMail, getAdminEmails } from '$lib/server/mail';

const BLOCKING_STATUSES = ['pending', 'approved', 'paid', 'completed'];

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
		payment_method: 'onsite'
	}));

	const { data: bookings, error: insertError } = await supabase.from('bookings').insert(rows).select();

	if (insertError) {
		return json({ message: 'Could not create the booking. Please try again.' }, { status: 500 });
	}

	// Notify all admins about the new booking. Fire-and-forget with error
	// logging so a mail failure never blocks the successful booking response.
	const { data: room } = await supabase
		.from('rooms')
		.select('name')
		.eq('id', room_id)
		.single();

	const admins = await getAdminEmails(supabase);
	if (admins.length > 0) {
		const dateList = dates.join(', ');
		sendMail({
			to: admins,
			subject: 'New booking submitted',
			text: `A new booking has been submitted for ${room?.name ?? 'a room'} on ${dateList} from ${start_time} to ${end_time} by ${guest_name} (${guest_email}). It is pending approval.`
		});
	}

	return json({ bookings }, { status: 201 });
};