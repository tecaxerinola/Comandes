// Enviament de correus per SMTP (p. ex. Gmail amb "contrasenya d'aplicació").
import nodemailer from 'nodemailer';

export function mailAvailable() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

let transport = null;
function getTransport() {
  if (!transport) {
    const port = Number(process.env.SMTP_PORT || 465);
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transport;
}

export async function sendMail({ to, subject, text, attachments }) {
  const from = process.env.MAIL_FROM || process.env.SMTP_USER;
  const cc = process.env.MAIL_CC || undefined;
  return getTransport().sendMail({ from, to, cc, subject, text, attachments });
}
