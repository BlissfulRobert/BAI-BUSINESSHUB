import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createServerClient } from '$lib/supabase/server';
import { sendMail } from '$lib/server/mail';
import { isWeekend, addDays, formatTimeLabel } from '$lib/utils/dates';
import { isVictorianHoliday } from '$lib/utils/holidays';

const ALLOWED_STATUSES = ['pending', 'paid', 'completed', 'cancelled', 'expired'];
const PENDING_EXPIRY_MINUTES = 30;

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

	// Load the affected bookings with room name and the owning member's email.
	const { data: existings, error: loadError } = await supabase
		.from('bookings')
		.select('*, room:rooms(name), profile:profiles(email, full_name), created_at')
		.in('id', bookingIds);

	if (loadError || !existings) {
		return json({ message: 'Could not load the booking.' }, { status: 500 });
	}

	// Auto-expire pending bookings older than PENDING_EXPIRY_MINUTES
	const now = new Date();
	for (const booking of existings) {
		if (booking.status === 'pending' && booking.created_at) {
			const created = new Date(booking.created_at);
			const diffMinutes = (now.getTime() - created.getTime()) / 60000;
			if (diffMinutes >= PENDING_EXPIRY_MINUTES) {
				// Auto-expire this booking
				const { error: expireError } = await supabase
					.from('bookings')
					.update({ status: 'expired' })
					.eq('id', booking.id);

				if (expireError) {
					console.error('Failed to auto-expire booking:', expireError);
				}

				// Notify the member
				const memberEmail = booking.profile?.email || booking.guest_email;
				if (memberEmail) {
					sendMail({
						to: memberEmail,
						subject: 'Booking expired',
						text: `Your booking for ${booking.room?.name || 'a room'} on ${booking.date} (${booking.start_time} - ${booking.end_time}) has expired due to non-payment.`
					});
				}
			}
			// Send payment reminder at approximately 10 minutes after booking creation
			else if (diffMinutes >= 3 && diffMinutes < 6) {
				const memberEmail = booking.profile?.email || booking.guest_email;
				if (memberEmail) {
					sendMail({
						to: memberEmail,
						subject: 'Payment reminder',
						text: `Reminder: Your booking for ${booking.room?.name || 'a room'} on ${booking.date} (${booking.start_time} - ${booking.end_time}) is still pending payment. Please complete payment within the next 5 minutes to avoid expiration.`
					});
				}
			}
		}

		// Send booking reminders 1 day and 1 hour before the scheduled booking
		for (const booking of existings) {
			if (booking.date) {
				const diffFromBookingStart = new Date(booking.date).getTime() - now.getTime();
				const diffHours = diffFromBookingStart / 3600000;

				// Check for 1-hour reminder (within 5-10 minutes before start)
				if (diffHours > 0 && diffHours <= 1 && diffHours >= 0.9) {
					const memberEmail = booking.profile?.email || booking.guest_email;
					if (memberEmail) {
						const roomName = booking.room?.name || 'a room';
						const startLabel = formatTimeLabel(booking.start_time);
						const endLabel = formatTimeLabel(booking.end_time);
						sendMail({
							to: memberEmail,
							subject: 'Booking reminder - 1 hour',
							text: `Your booking for ${roomName} in 1 hour (${startLabel} - ${endLabel}) is approaching.`
						});
					}
				}

				// Check for 1-day reminder (within 24-25 hours before start)
				if (diffHours > 23 && diffHours <= 25) {
					const memberEmail = booking.profile?.email || booking.guest_email;
					if (memberEmail) {
						const roomName = booking.room?.name || 'a room';
						const startLabel = formatTimeLabel(booking.start_time);
						const endLabel = formatTimeLabel(booking.end_time);
						sendMail({
							to: memberEmail,
							subject: 'Booking reminder - 1 day',
							text: `Your booking for ${roomName} tomorrow (${startLabel} - ${endLabel}) is approaching.`
						});
					}
				}
			}
		}
	}

	// Only admins may change the status of arbitrary bookings to paid/completed;
	// a member may only cancel (or reschedule, which stays pending).
	const { data: requester } = await supabase
		.from('profiles')
		.select('role')
		.eq('id', user.id)
		.single();
	const isAdmin = requester?.role === 'admin';

	// Non-admins can only act on bookings they own.
	if (!isAdmin && existings.some((b) => b.user_id !== user.id)) {
		return json({ message: 'You do not have permission to modify this booking.' }, { status: 403 });
	}

	// Optional reschedule fields (member reschedule). date/start_time/end_time
	// are updated alongside the status when provided.
	const patch: Record<string, unknown> = { status };

	// Admin actions also dismiss the new-request notification dot.
	if (isAdmin) patch.is_seen = true;

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
			? `Your booking for ${roomName} has been rescheduled to ${body.date} (${body.start_time} - ${body.end_time}). It is pending payment.`
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
