import type { Plan, Room } from '$lib/types/database';
import { timeToMinutes } from '$lib/utils/dates';

/**
 * Rental-period pricing per the Room Rental Rate Structure.
 *
 * Conference Room: $50/hr, half-day $200, full-day $350
 * Meeting Room:    $30/hr, half-day $120, full-day $200
 * A 30-minute booking is charged at 50% of the hourly rate.
 *
 * Weekly and Monthly plans are intended to be configured separately (they are
 * meant to undercut hourly pricing), so they fall back to the plan's own
 * configured price for now rather than being derived from the hourly rate.
 */

/** Durations (hours) that map to the flat half-day / full-day rates. */
export const HALF_DAY_HOURS = 4;
export const FULL_DAY_HOURS = 8;

export interface RateCard {
	halfDay: number;
	fullDay: number;
}

/** Flat per-room rates (USD) keyed by room slug. */
const RATE_CARDS: Record<string, RateCard> = {
	'conference-room': { halfDay: 200, fullDay: 350 },
	'meeting-room': { halfDay: 120, fullDay: 200 }
};

export interface Quote {
	/** Human label for the charged period, e.g. 'Half-day' or '3 hours'. */
	label: string;
	/** Unit price for the charging period. */
	unitPrice: number;
	/** Number of units charged. */
	quantity: number;
	/** Total amount for the booking (USD). */
	total: number;
}

export function round2(n: number): number {
	return Math.round(n * 100) / 100;
}

/** Whether a plan slugs should use its own configured (placeholder) price. */
function isConfiguredPlan(plan: Plan | null): boolean {
	return plan?.slug === 'weekly' || plan?.slug === 'monthly';
}

/**
 * Reference price shown on a plan card for a given room. Hourly/Half-day/
 * Full-day use the room's own rates so the card matches the room being booked;
 * Weekly/Monthly fall back to their separately-configured plan price.
 */
export function planReferencePrice(room: Room, plan: Plan): number {
	if (plan.slug === 'weekly') return round2(plan.price * 0.95);
	if (isConfiguredPlan(plan)) return plan.price;

	const hourly = room.price_per_hour;
	const card = RATE_CARDS[room.slug];

	switch (plan.slug) {
		case 'half-day':
			return card ? card.halfDay : round2(hourly * HALF_DAY_HOURS);
		case 'full-day':
			return card ? card.fullDay : round2(hourly * FULL_DAY_HOURS);
		case 'hourly':
		default:
			return hourly;
	}
}

/**
 * Computes the total price for a booking from the selected room, plan, and
 * start/end times. Weekly/Monthly plans return their pre-configured price;
 * every other period is derived from the room's hourly rate and the
 * applicable flat half/full-day rates.
 */
export function quoteForBooking(
	room: Room,
	plan: Plan | null,
	startTime: string,
	endTime: string
): Quote {
	const totalMinutes = timeToMinutes(endTime) - timeToMinutes(startTime);

	// Weekly/Monthly: price is configured separately per plan. Weekly gets a 5% discount.
	if (isConfiguredPlan(plan) && plan) {
		const isWeekly = plan.slug === 'weekly';
		const discounted = isWeekly ? round2(plan.price * 0.95) : plan.price;
		return {
			label: isWeekly ? `${plan.duration_label || plan.name} (−5%)` : plan.duration_label || plan.name,
			unitPrice: discounted,
			quantity: 1,
			total: discounted
		};
	}

	const hourly = room.price_per_hour;
	const card = RATE_CARDS[room.slug];

	if (totalMinutes <= 30) {
		const price = round2(hourly * 0.5);
		return { label: '30 minutes', unitPrice: price, quantity: 1, total: price };
	}

	if (totalMinutes <= HALF_DAY_HOURS * 60) {
		const hours = totalMinutes / 60;
		const total = round2(hourly * hours);
		return { label: `${hours} hour${hours === 1 ? '' : 's'}`, unitPrice: hourly, quantity: hours, total };
	}

	if (totalMinutes < FULL_DAY_HOURS * 60 && card) {
		return { label: 'Half-day', unitPrice: card.halfDay, quantity: 1, total: card.halfDay };
	}

	const fullDay = card ? card.fullDay : round2(hourly * FULL_DAY_HOURS);
	return { label: 'Full-day', unitPrice: fullDay, quantity: 1, total: fullDay };
}
