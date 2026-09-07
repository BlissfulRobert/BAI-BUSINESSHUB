import type { Handle } from '@sveltejs/kit';
import { ensureExpiryJobStarted } from '$lib/server/expiryJob';

// Start the pending-booking expiry sweep when the server boots.
ensureExpiryJobStarted();

export const handle: Handle = async ({ event, resolve }) => resolve(event);