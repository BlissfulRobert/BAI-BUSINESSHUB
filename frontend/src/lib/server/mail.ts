import nodemailer from 'nodemailer';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  MAILPIT_HOST,
  MAILPIT_PORT,
  MAILPIT_USER,
  MAILPIT_PASSWORD,
  MAIL_FROM
} from '$env/static/private';

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: MAILPIT_HOST,
      port: Number(MAILPIT_PORT),
      secure: false, // Mailtrap sandbox uses STARTTLS on port 2525
      auth: {
        user: MAILPIT_USER,
        pass: MAILPIT_PASSWORD
      }
    });
  }
  return transporter;
}

export type MailMessage = {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
};

// Fire-and-forget: notifications must never block or fail the HTTP response.
// Errors are logged server-side so a broken SMTP setup can't break the user flow.
export function sendMail(message: MailMessage): void {
  void (async () => {
    try {
      await getTransporter().sendMail({
        from: MAIL_FROM,
        to: Array.isArray(message.to) ? message.to.join(', ') : message.to,
        subject: message.subject,
        text: message.text,
        html: message.html
      });
    } catch (err) {
      console.error('[mail] Failed to send email:', message.subject, err);
    }
  })();
}

export async function getAdminEmails(
  supabase: SupabaseClient
): Promise<string[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('email')
    .eq('role', 'admin');

  if (error) {
    console.error('[mail] Could not fetch admin emails:', error);
    return [];
  }

  return (data ?? []).map((r) => r.email).filter(Boolean) as string[];
}
