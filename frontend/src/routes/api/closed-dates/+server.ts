import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createServerClient } from '$lib/supabase/server';

export const GET: RequestHandler = async ({ request }) => {
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

	const { data, error } = await supabase
		.from('closed_dates')
		.select('*');

	if (error) {
		return json({ message: 'Could not fetch closed dates.', error: error.message }, { status: 500 });
	}

	return json({ closedDates: data });
};

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

	if (user.role !== 'admin') {
		return json({ message: 'Only administrators can manage closed dates.' }, { status: 403 });
	}

	const body = await request.json();
	const { date, reason } = body;

	if (!date) {
		return json({ message: 'Date is required.' }, { status: 400 });
	}

	const { error } = await supabase
		.from('closed_dates')
		.insert({ date, reason });

	if (error) {
		return json({ message: 'Could not add closed date.', error: error.message }, { status: 500 });
	}

	return json({ ok: true });
};