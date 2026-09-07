import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createServerClient } from '$lib/supabase/server';
import { expireStalePendingBookings } from '$lib/server/expireBookings';

// Explicitly triggers the 30-minute pending-booking expiry sweep and emails the
// affected guests. Called fire-and-forget by the member/admin dashboards on
// load so the UI reflects expired bookings immediately, independent of the
// in-process job timing. Requires a valid session.
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

	const expired = await expireStalePendingBookings();
	return json({ expired });
};