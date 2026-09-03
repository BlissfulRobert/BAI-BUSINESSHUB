import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createServerClient } from '$lib/supabase/server';
import { sendMail } from '$lib/server/mail';

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

	const { data: requester } = await supabase
		.from('profiles')
		.select('role')
		.eq('id', user.id)
		.single();
	if (requester?.role !== 'admin') {
		return json({ message: 'Only admins can respond to reports.' }, { status: 403 });
	}

	const body = await request.json();
	const reportId = body.reportId as string;
	const response = (body.response as string)?.trim();

	if (!reportId || !response) {
		return json({ message: 'Missing report id or response.' }, { status: 400 });
	}

	const { data: report } = await supabase
		.from('reports')
		.select('*, profile:profiles(email)')
		.eq('id', reportId)
		.single();

	if (!report) {
		return json({ message: 'Report not found.' }, { status: 404 });
	}

	const { error: updateError } = await supabase
		.from('reports')
		.update({ admin_response: response, status: 'resolved', is_seen: true })
		.eq('id', reportId);

	if (updateError) {
		return json({ message: 'Could not respond to the report. Please try again.' }, { status: 500 });
	}

	// Notify the reporter that their report has been answered (fire-and-forget).
	const memberEmail = report.profile?.email ?? report.email;
	if (memberEmail) {
		sendMail({
			to: memberEmail,
			subject: `Re: ${report.subject}`,
			text: `Your report "${report.subject}" has received a response:\n\n${response}`
		});
	}

	return json({ ok: true });
};
