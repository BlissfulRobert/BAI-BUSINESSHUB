import { sendMail } from '$lib/server/mail';
import { createServerClient } from '$lib/supabase/server';
import type { TimeRange } from '$lib/types/database';

type BookingSummary = {
	id: string;
	booking_number: string;
	date: string;
	end_date: string | null;
	start_time: string;
	end_time: string;
	excluded_ranges?: TimeRange[];
};

type BookingEmailParams = {
	guestEmail: string;
	guestName: string;
	roomName: string;
	bookings: BookingSummary[];
};

function formatExclusions(excluded_ranges: TimeRange[]): string {
	return excluded_ranges
		.map((r) => `  \u2022 ${r.start_time}\u2013${r.end_time}`)
		.join('\n');
}

function exclusionNote(bookings: BookingSummary[]): string {
	const withExclusions = bookings.filter((b) => (b.excluded_ranges ?? []).length > 0);
	if (withExclusions.length === 0) return '';

	const note = withExclusions
		.map(
			(b) =>
				`  \u2022 ${b.booking_number} (${b.date}): the following business hour(s) are already booked by other guests and are NOT included in your pass \u2014 you won't be able to use the room then:\n${formatExclusions(b.excluded_ranges!)}`,
		)
		.join('\n');

	return `\nNote: Your pass excludes time held by other guests.\n${note}\n`;
}

function shortDate(iso: string): string {
	const d = new Date(iso.slice(0, 10) + 'T00:00:00');
	if (isNaN(d.getTime())) return iso;
	return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
}

// Weekly/Monthly passes are a single booking row spanning date..end_date; show
// the range ("Mon 14 Sep – Fri 18 Sep") instead of a single day.
function dateRangeLabel(b: BookingSummary): string {
	if (b.end_date && b.end_date !== b.date) {
		return `${shortDate(b.date)} \u2013 ${shortDate(b.end_date)}`;
	}
	return shortDate(b.date);
}

function formatBookingList(bookings: BookingSummary[]): string {
	return bookings
		.map((b) => `  \u2022 ${b.booking_number} \u2014 ${dateRangeLabel(b)}, ${b.start_time}\u2013${b.end_time}`)
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

${formatBookingList(bookings)}${exclusionNote(bookings)}

Your booking${plural ? 's are' : ' is'} currently pending payment. Please complete payment within 30 minutes, or the reservation will be released automatically.

Booking reference${plural ? 's' : ''}: ${numbers}

Thanks,
BAI Business Hub`
	});
}

// Sent when a pending booking isn't paid within the 30-minute window and is
// automatically released. Triggered by the shared expiry sweep
// (lib/server/expireBookings.ts), which runs from the server boot job and from
// the booking-related endpoints.
export function sendBookingExpiredEmail(params: BookingEmailParams): void {
	const { guestEmail, guestName, bookings } = params;
	const numbers = referenceLabel(bookings);
	const plural = bookings.length > 1;

	sendMail({
		to: guestEmail,
		subject: `Booking expired \u2014 ${numbers}`,
		text: `Hi ${guestName},

The following booking${plural ? 's have' : ' has'} expired because payment wasn't completed within 30 minutes:

${formatBookingList(bookings)}

The room time slot${plural ? 's have' : ' has'} been released and ${plural ? 'are' : 'is'} available again. If you'd still like to book, please create a new booking.

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

${formatBookingList(bookings)}${exclusionNote(bookings)}

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