import { createServerClient } from '$lib/supabase/server';
import { sendBookingExpiredEmail } from '$lib/server/bookingEmails';

const PENDING_EXPIRY_MS = 30 * 60 * 1000;

type ExpirableBooking = {
	id: string;
	booking_number: string;
	date: string;
	start_time: string;
	end_time: string;
	guest_name: string;
	guest_email: string;
	room?: { name?: string } | null;
	profile?: { email?: string; full_name?: string } | null;
};

/**
 * Finds every pending booking created more than PENDING_EXPIRY_MS ago, marks
 * it 'expired', and emails the guest. Uses the service-role client so it can
 * run with no user context: from the in-process job (see expiryJob.ts), from
 * the booking/status endpoints, or from the explicit /api/bookings/expire
 * endpoint. Returns the number of bookings expired.
 */
export async function expireStalePendingBookings(): Promise<number> {
	const supabase = createServerClient();
	const cutoff = new Date(Date.now() - PENDING_EXPIRY_MS).toISOString();

	const { data: stale, error } = await supabase
		.from('bookings')
		.select(
			'id, booking_number, date, start_time, end_time, guest_name, guest_email, room:rooms(name), profile:profiles(email, full_name)'
		)
		.eq('status', 'pending')
		.lt('created_at', cutoff);

	if (error) {
		console.error('[expireBookings] Could not load stale pending bookings:', error);
		return 0;
	}
	if (!stale || stale.length === 0) return 0;

	const ids = stale.map((b) => b.id);
	const { error: updateError } = await supabase
		.from('bookings')
		.update({ status: 'expired' })
		.in('id', ids);

	if (updateError) {
		console.error('[expireBookings] Could not mark bookings expired:', updateError);
		return 0;
	}

	for (const booking of stale as ExpirableBooking[]) {
		const email = booking.profile?.email || booking.guest_email;
		if (!email) continue;
		sendBookingExpiredEmail({
			guestEmail: email,
			guestName: booking.profile?.full_name || booking.guest_name,
			roomName: booking.room?.name ?? 'a room',
			bookings: [
				{
					id: booking.id,
					booking_number: booking.booking_number,
					date: booking.date,
					start_time: booking.start_time,
					end_time: booking.end_time
				}
			]
		});
	}

	console.log(`[expireBookings] Expired ${stale.length} pending booking(s).`);
	return stale.length;
}