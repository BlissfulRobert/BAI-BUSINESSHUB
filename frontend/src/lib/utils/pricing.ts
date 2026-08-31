import type { Booking, Membership, MembershipUsage, Plan, Room } from '$lib/types/database';
import { timeToMinutes } from '$lib/utils/dates';

/**
 * Rental-period pricing per the Room Rental Rate Structure (figures mirrored
 * as AUD values). A 30-minute booking is charged at 50% of the hourly rate.
 *
 * Conference Room: hourly $/AU$50, half-day 200, full-day 350, weekly 1600, monthly 6400
 * Meeting Room:    hourly $/AU$30, half-day 120, full-day 200, weekly 960, monthly 3840
 *
 * Weekly/Monthly are per-room configured rates that undercut hourly pricing,
 * so they live in RATE_CARDS keyed by room slug rather than being derived
 * from the plan's own (display-only) price.
 */

/** Durations (hours) that map to the flat half-day / full-day rates. */
export const HALF_DAY_HOURS = 4;
export const FULL_DAY_HOURS = 8;

/** Promotional discount applied to the weekly rate (5% off the configured weekly price). */
export const WEEKLY_DISCOUNT_RATE = 0.05;

export interface RateCard {
	halfDay: number;
	fullDay: number;
	weekly: number;
	monthly: number;
}

/** Flat per-room rates (AUD) keyed by room slug. */
const RATE_CARDS: Record<string, RateCard> = {
	'conference-room': { halfDay: 200, fullDay: 350, weekly: 1600, monthly: 6400 },
	'meeting-room': { halfDay: 120, fullDay: 200, weekly: 960, monthly: 3840 }
};

export interface Quote {
	/** Human label for the charged period, e.g. 'Half-day' or '3 hours'. */
	label: string;
	/** Unit price for the charging period. */
	unitPrice: number;
	/** Number of units charged. */
	quantity: number;
	/** Total amount for the booking (AUD). */
	total: number;
}

export function round2(n: number): number {
	return Math.round(n * 100) / 100;
}

/** Whether a plan slug uses its own configured (per-room) weekly/monthly rate. */
function isConfiguredPlan(plan: Plan | null): boolean {
	return plan?.slug === 'weekly' || plan?.slug === 'monthly';
}

/** Per-room weekly/monthly rate, falling back to the plan's display price. */
function configuredPlanPrice(room: Room, plan: Plan | null, key: 'weekly' | 'monthly'): number {
	const card = RATE_CARDS[room.slug];
	if (card) return round2(card[key]);
	return plan ? plan.price : 0;
}

/** Whether the plan is the discounted Weekly pass. */
export function isWeekly(plan: Plan | null): boolean {
	return plan?.slug === 'weekly';
}

/** Weekly rate with the advertised 5% promotional discount applied. */
function weeklyDiscountedPrice(room: Room, plan: Plan | null): number {
	return round2(configuredPlanPrice(room, plan, 'weekly') * (1 - WEEKLY_DISCOUNT_RATE));
}

/**
 * Reference price shown on a plan card for a given room. Hourly/Half-day/
 * Full-day use the room's own rates so the card matches the room being booked;
 * Weekly/Monthly use the per-room configured rate.
 */
export function planReferencePrice(room: Room, plan: Plan): number {
	const hourly = room.price_per_hour;
	const card = RATE_CARDS[room.slug];

	switch (plan.slug) {
		case 'weekly':
			return weeklyDiscountedPrice(room, plan);
		case 'monthly':
			return configuredPlanPrice(room, plan, 'monthly');
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
 * start/end times. Weekly/Monthly use the per-room configured rate; every
 * other period is derived from the room's hourly rate and the applicable flat
 * half/full-day rates.
 */
export function quoteForBooking(
	room: Room,
	plan: Plan | null,
	startTime: string,
	endTime: string
): Quote {
	const totalMinutes = timeToMinutes(endTime) - timeToMinutes(startTime);

	// Weekly/Monthly: per-room configured rate (Weekly gets the 5% promo discount).
	if (isConfiguredPlan(plan) && plan) {
		const isWk = isWeekly(plan);
		const price = isWk ? weeklyDiscountedPrice(room, plan) : configuredPlanPrice(room, plan, 'monthly');
		return {
			label: isWk ? `${plan.duration_label || plan.name} (−5%)` : plan.duration_label || plan.name,
			unitPrice: price,
			quantity: 1,
			total: price
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

/**
 * Prices a stored booking (admin revenue / member display) from its joined
 * plan and room. Requires the booking to have its `plan` and `room` relations
 * populated. Weekly/Monthly return the full per-room configured rate (a series
 * of rows is charged once); other periods are priced off the row's times.
 */
export function quoteForStoredBooking(booking: Booking): Quote {
	const room = booking.room ?? { price_per_hour: 0 } as Room;
	const plan = booking.plan ?? null;

	if (plan && isConfiguredPlan(plan)) {
		const isWk = isWeekly(plan);
		const price = isWk ? weeklyDiscountedPrice(room, plan) : configuredPlanPrice(room, plan, 'monthly');
		return {
			label: isWk ? `${plan.duration_label || plan.name} (−5%)` : plan.duration_label || plan.name,
			unitPrice: price,
			quantity: 1,
			total: price
		};
	}

	return quoteForBooking(room, plan, booking.start_time, booking.end_time);
}

// ============================================
// MEMBERSHIP / INCLUDED-HOURS HELPERS (Sections 6, 7, 8)
// ============================================

/** The included-hours field on a membership for a given room slug. */
export function includedHoursFor(membership: Membership, roomSlug: string): number {
	return roomSlug === 'conference-room'
		? membership.included_conference_hours
		: membership.included_meeting_hours;
}

/** Minutes in a booking's time range. */
export function bookingMinutes(startTime: string, endTime: string): number {
	return timeToMinutes(endTime) - timeToMinutes(startTime);
}

export interface UsageMeter {
	includedMinutes: number;
	usedMinutes: number;
	remainingMinutes: number;
	/** Remaining label, e.g. '3h' or '30min'. */
	remainingLabel: string;
	/** Whether additional (overage) usage has kicked in this month. */
	exhausted: boolean;
}

/**
 * Compares the membership's included hours for a room class against the
 * current month's ledger balance, for the member/admin usage meter.
 */
export function usageMeter(
	membership: Membership,
	usage: MembershipUsage[] | undefined,
	roomSlug: string
): UsageMeter {
	const includedMinutes = Math.round(includedHoursFor(membership, roomSlug) * 60);
	const usedMinutes = (usage ?? []).find((u) => u.room_slug === roomSlug)?.used_minutes ?? 0;
	const remainingMinutes = Math.max(0, includedMinutes - usedMinutes);
	return {
		includedMinutes,
		usedMinutes,
		remainingMinutes,
		remainingLabel: formatMinutes(remainingMinutes),
		exhausted: usedMinutes >= includedMinutes
	};
}

/** '90' -> '1h 30min'; '30' -> '30min'; '120' -> '2h'. */
export function formatMinutes(minutes: number): string {
	const mins = Math.round(minutes);
	const h = Math.floor(mins / 60);
	const m = mins % 60;
	if (h === 0) return `${m}min`;
	if (m === 0) return `${h}h`;
	return `${h}h ${m}min`;
}
