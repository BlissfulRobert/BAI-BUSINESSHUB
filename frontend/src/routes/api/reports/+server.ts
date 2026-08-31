import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createServerClient } from '$lib/supabase/server';
import { sendMail, getAdminEmails } from '$lib/server/mail';

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

	const body = await request.json();
	const subject = (body.subject as string)?.trim();
	const description = (body.description as string)?.trim();

	if (!subject || !description) {
		return json({ message: 'Missing report subject or description.' }, { status: 400 });
	}

	const { error: insertError } = await supabase.from('reports').insert({
		user_id: user.id,
		booking_id: body.booking_id ?? null,
		subject,
		description
	});

	if (insertError) {
		return json({ message: 'Could not submit the report. Please try again.' }, { status: 500 });
	}

	// Notify all admins about the new report (fire-and-forget).
	const admins = await getAdminEmails(supabase);
	if (admins.length > 0) {
		sendMail({
			to: admins,
			subject: `New report: ${subject}`,
			text: `A new report has been submitted by ${user.email ?? 'a member'}:\n\n${subject}\n\n${description}\n\nOpen the admin dashboard to respond.`
		});
	}

	return json({ ok: true });
};
