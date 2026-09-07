import { expireStalePendingBookings } from './expireBookings';

let started = false;

/**
 * Starts the in-process pending-booking expiry sweep. Runs immediately on boot
 * and then every minute. This is reliable on a persistent Node server (the
 * deployment model this app already assumes — see the setTimeout-based payment
 * reminder in bookingEmails.ts). On a serverless host the interval would not
 * persist; the booking/status endpoints and /api/bookings/expire still sweep on
 * traffic in that case.
 */
export function ensureExpiryJobStarted(): void {
	if (started) return;
	started = true;

	void expireStalePendingBookings();
	setInterval(() => {
		void expireStalePendingBookings();
	}, 60 * 1000);
}