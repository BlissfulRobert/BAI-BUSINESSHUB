import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { sendMail, getAdminEmails } from '$lib/server/mail';
import { createServerClient } from '$lib/supabase/server';

function escapeHtml(str: string): string {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const POST: RequestHandler = async ({ request }) => {
	let body: { name?: string; email?: string; message?: string };

	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid request.' }, { status: 400 });
	}

	const name = body.name?.trim() ?? '';
	const email = body.email?.trim() ?? '';
	const message = body.message?.trim() ?? '';

	if (!name || !email || !message) {
		return json({ error: 'Please fill in all fields.' }, { status: 400 });
	}

	if (!EMAIL_PATTERN.test(email)) {
		return json({ error: 'Please enter a valid email address.' }, { status: 400 });
	}

	if (name.length > 200 || email.length > 200 || message.length > 5000) {
		return json({ error: 'One of the fields is too long.' }, { status: 400 });
	}

	const supabase = createServerClient();
	const adminEmails = await getAdminEmails(supabase);

	if (adminEmails.length === 0) {
		console.error('[contact] No admin emails found to notify.');
		return json(
			{ error: 'Something went wrong on our end. Please email us directly instead.' },
			{ status: 500 }
		);
	}

	sendMail({
		to: adminEmails,
		subject: `New contact form message from ${name}`,
		text: `Name: ${name}\nEmail: ${email}\n\nMessage:\n${message}`,
		html: `<p><strong>Name:</strong> ${escapeHtml(name)}</p><p><strong>Email:</strong> ${escapeHtml(
			email
		)}</p><p><strong>Message:</strong></p><p>${escapeHtml(message).replace(/\n/g, '<br>')}</p>`
	});

	return json({ success: true });
};