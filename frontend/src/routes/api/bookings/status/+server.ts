import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createServerClient } from '$lib/supabase/server';
import { sendMail } from '$lib/server/mail';
import { isWeekend } from '$lib/utils/dates';
import { isVictorianHoliday } from '$lib/utils/holidays';

const ALLOWED_STATUSES = ['pending', 'approved', 'paid', 'completed', 'cancelled'];

export const POST: RequestHandler = async ({ request }) => {
	const supabase = createServerClient();

	const authHeader = request.headers.get('authorization');
	const accessToken = authHeader?.replace('Bearer ', '');
	if (!accessToken) {
		return json({ message: 'You must be logged in.' }, { status: 401 });
	}

	const {
		data: { user },
		error: authError
	} = await supabase.auth.getUser(accessToken);
	if (authError || !user) {
		return json({ message: 'Your session has expired. Please log in again.' }, { status: 401 });
	}

	const body = await request.json();
	const bookingIds: string[] = Array.isArray(body.bookingIds)
		? body.bookingIds
		: body.bookingId
			? [body.bookingId]
			: [];
	const status = body.status as string;

	if (bookingIds.length === 0) {
		return json({ message: 'Missing booking id.' }, { status: 400 });
	}
	if (!ALLOWED_STATUSES.includes(status)) {
		return json({ message: 'Invalid status.' }, { status: 400 });
	}

	// Only admins may change the status of arbitrary bookings to approved/paid/
	// completed; a member may only cancel (or reschedule, which stays pending).
	const { data: requester } = await supabase
		.from('profiles')
		.select('role')
		.eq('id', user.id)
		.single();
	const isAdmin = requester?.role === 'admin';

	// Load the affected bookings with room name and the owning member's email.
	const { data: existings, error: loadError } = await supabase
		.from('bookings')
		.select('*, room:rooms(name), profile:profiles(email, full_name)')
		.in('id', bookingIds);

	if (loadError || !existings) {
		return json({ message: 'Could not load the booking.' }, { status: 500 });
	}

	// Non-admins can only act on bookings they own.
	if (!isAdmin && existings.some((b) => b.user_id !== user.id)) {
		return json({ message: 'You do not have permission to modify this booking.' }, { status: 403 });
	}

	// Optional reschedule fields (member reschedule). date/start_time/end_time
	// are updated alongside the status when provided.
	const patch: Record<string, unknown> = { status };

	// You can't reschedule onto a closed day (weekend or Victorian public holiday).
	if (body.date && (isWeekend(body.date) || isVictorianHoliday(body.date))) {
		return json(
			{ message: 'The hub is closed on that day. Please pick an open weekday.' },
			{ status: 400 }
		);
	}

	if (body.date) patch.date = body.date;
	if (body.start_time) patch.start_time = body.start_time;
	if (body.end_time) patch.end_time = body.end_time;

	const { error: updateError } = await supabase
		.from('bookings')
		.update(patch)
		.in('id', bookingIds);

	if (updateError) {
		return json({ message: 'Could not update the booking. Please try again.' }, { status: 500 });
	}

	// Notify each member about their booking's new status (fire-and-forget).
	const isReschedule = !!(body.date || body.start_time || body.end_time);

	for (const booking of existings) {
		// Skip only when nothing actually changed: no status transition and no
		// reschedule. A reschedule notifies even if the status stayed the same
		// (e.g. a pending booking rescheduled to a new time).
		if (booking.status === status && !isReschedule) continue;
		const memberEmail = booking.profile?.email || booking.guest_email;
		if (!memberEmail) continue;

		const roomName = booking.room?.name || 'a room';
		const memberText = isReschedule
			? `Your booking for ${roomName} has been rescheduled to ${body.date} (${body.start_time} - ${body.end_time}). It is pending re-approval.`
			: booking.status === 'pending' && status === 'cancelled'
				? `Your booking for ${roomName} on ${booking.date} has been cancelled.`
				: `Your booking for ${roomName} on ${booking.date} (${booking.start_time} - ${booking.end_time}) is now ${status}.`;

		sendMail({
			to: memberEmail,
			subject: isReschedule ? 'Booking rescheduled' : `Booking ${status}`,
			text: memberText
		});
	}

	return json({ ok: true });
};
