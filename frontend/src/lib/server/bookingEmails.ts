import { sendMail } from '$lib/server/mail';
import { createServerClient } from '$lib/supabase/server';

type BookingSummary = {
	id: string;
	booking_number: string;
	date: string;
	start_time: string;
	end_time: string;
};

type BookingEmailParams = {
	guestEmail: string;
	guestName: string;
	roomName: string;
	bookings: BookingSummary[];
};

function formatBookingList(bookings: BookingSummary[]): string {
	return bookings
		.map((b) => `  \u2022 ${b.booking_number} \u2014 ${b.date}, ${b.start_time}\u2013${b.end_time}`)
		.join('\n');
}

function referenceLabel(bookings: BookingSummary[]): string {
	return bookings.map((b) => b.booking_number).join(', ');
}

// Sent immediately after a booking is created. The booking is still
// "pending" at this point (payment hasn't happened yet) — this just gives
// the customer their booking number(s) and confirms what was requested.
export function sendBookingConfirmationEmail(params: BookingEmailParams): void {
	const { guestEmail, guestName, roomName, bookings } = params;
	const numbers = referenceLabel(bookings);
	const plural = bookings.length > 1;

	sendMail({
		to: guestEmail,
		subject: `Booking received \u2014 ${numbers}`,
		text: `Hi ${guestName},

We've received your booking request for ${roomName}:

${formatBookingList(bookings)}

Your booking${plural ? 's are' : ' is'} currently pending payment. Please complete payment within 30 minutes, or the reservation will be released automatically.

Booking reference${plural ? 's' : ''}: ${numbers}

Thanks,
BAI Business Hub`
	});
}

// ~3 minutes, inside the 2\u20135 minute window described in the booking policy.
const REMINDER_DELAY_MS = 3 * 60 * 1000;

// Schedules a payment reminder a few minutes after booking creation.
//
// IMPORTANT: this uses setTimeout, which only fires if the Node process
// stays alive for the full delay. That's fine on a normal long-running
// server, but it will NOT work on serverless/edge deployments (Vercel,
// Netlify Functions, etc.) since the process is torn down right after the
// HTTP response is sent. If this app ever moves to serverless, replace this
// with a real scheduled job (cron / Supabase Edge Function) that checks for
// pending bookings older than a few minutes.
export function schedulePaymentReminder(params: BookingEmailParams): void {
	const { guestEmail, guestName, roomName, bookings } = params;
	const numbers = referenceLabel(bookings);
	const plural = bookings.length > 1;
	const bookingIds = bookings.map((b) => b.id);

	setTimeout(async () => {
		try {
			const supabase = createServerClient();

			// Only remind if at least one of these bookings is still pending —
			// skip the email if payment already went through or it was cancelled.
			const { data: current, error } = await supabase
				.from('bookings')
				.select('id, status')
				.in('id', bookingIds);

			if (error) {
				console.error('[bookingEmails] Could not check booking status for reminder:', error);
				return;
			}

			const stillPending = (current ?? []).some((b) => b.status === 'pending');
			if (!stillPending) return;

			sendMail({
				to: guestEmail,
				subject: `Reminder: complete payment for ${numbers}`,
				text: `Hi ${guestName},

This is a reminder that payment is still needed for your booking at ${roomName}:

${formatBookingList(bookings)}

Booking reference${plural ? 's' : ''}: ${numbers}

Please complete payment soon \u2014 unpaid bookings are automatically released 30 minutes after they're created.

Thanks,
BAI Business Hub`
			});
		} catch (err) {
			console.error('[bookingEmails] Failed to send payment reminder:', err);
		}
	}, REMINDER_DELAY_MS);
}