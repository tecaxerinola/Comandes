// Enviament de correus.
//  1) Microsoft 365 (recomanat per a Outlook): Microsoft Graph amb una aplicació registrada a Entra ID
//     (variables MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, permís d'aplicació Mail.Send).
//  2) SMTP clàssic (Gmail amb contrasenya d'aplicació, altres proveïdors): SMTP_HOST, SMTP_USER, SMTP_PASS.
import nodemailer from 'nodemailer';

const graphConfigured = () => Boolean(process.env.MS_TENANT_ID && process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET);
const smtpConfigured = () => Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

export function mailAvailable() {
  return graphConfigured() || smtpConfigured();
}

// ---------- Microsoft Graph ----------
let graphToken = null;
async function getGraphToken() {
  if (graphToken && graphToken.expires > Date.now() + 60_000) return graphToken.value;
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(process.env.MS_TENANT_ID)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.MS_CLIENT_ID,
      client_secret: process.env.MS_CLIENT_SECRET,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Microsoft 365 no ha acceptat les credencials: ${data.error_description || data.error || res.status}`);
  graphToken = { value: data.access_token, expires: Date.now() + (data.expires_in || 3600) * 1000 };
  return graphToken.value;
}

const recipients = (list) => String(list || '').split(/[,;]+/).map((x) => x.trim()).filter(Boolean)
  .map((address) => ({ emailAddress: { address } }));

async function sendWithGraph({ from, to, subject, text, attachments }) {
  const token = await getGraphToken();
  const message = {
    subject,
    body: { contentType: 'Text', content: text },
    toRecipients: recipients(to),
    ccRecipients: recipients(process.env.MAIL_CC),
    replyTo: recipients(from),
    attachments: (attachments || []).map((a) => ({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: a.filename,
      contentType: a.contentType || 'application/octet-stream',
      contentBytes: Buffer.from(a.content).toString('base64'),
    })),
  };
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(from)}/sendMail`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, saveToSentItems: true }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const msg = data.error?.message || `error ${res.status}`;
    throw new Error(res.status === 403
      ? `Microsoft 365 no deixa enviar des de ${from}: falta el permís Mail.Send (amb consentiment d'administrador). ${msg}`
      : `Microsoft 365: ${msg}`);
  }
}

// ---------- SMTP ----------
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
// Amb Microsoft 365 el correu queda també a "Elements enviats" d'aquesta bústia.
export async function sendMail({ from, to, subject, text, attachments }) {
  if (graphConfigured()) return sendWithGraph({ from, to, subject, text, attachments });
  const cc = process.env.MAIL_CC || undefined;
  return getTransport().sendMail({ from, replyTo: from, to, cc, subject, text, attachments });
}
