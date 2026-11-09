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

// El remitent és sempre el configurat a l'app (per defecte jordi@tecaxerinola.com).
// El compte SMTP ha de tenir permís per enviar com aquesta adreça (normalment és el mateix compte).
export async function sendMail({ from, to, subject, text, attachments }) {
  const cc = process.env.MAIL_CC || undefined;
  return getTransport().sendMail({ from, replyTo: from, to, cc, subject, text, attachments });
}

export async function verifyMail() {
  await getTransport().verify();
}
