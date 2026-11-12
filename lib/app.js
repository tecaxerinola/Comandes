// L'aplicació (API + pàgina). La fan servir server.js (en local) i api/index.js (Vercel).
import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { waitUntil } from '@vercel/functions';
import * as db from './db.js';
import { initStorage, putFile, getFile, removeFile } from './storage.js';
import { readOrderPhotos, ocrAvailable } from './ocr.js';
import { ordersByProvider, orderText, orderPdf, pdfFileName, weekLabel, schoolList, schoolListPdf } from './orders.js';
import { sendMail, mailAvailable } from './mail.js';
import { uprightPhoto, rotateJpeg } from './images.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---------- Inicialització (una vegada per instància; a Vercel, en el primer accés) ----------
let readyPromise = null;
const ready = () => {
  if (!readyPromise) {
    readyPromise = Promise.all([db.initDb(), initStorage()]).catch((e) => { readyPromise = null; throw e; });
  }
  return readyPromise;
};
export { ready };

// ---------- Accés amb contrasenya (APP_PASSWORD) ----------
const COOKIE = 'comandes_auth';
const authToken = () => crypto.createHmac('sha256', process.env.APP_PASSWORD).update('comandes-v1').digest('hex');
const cookieOf = (req, name) => (req.headers.cookie || '').split(';').map((c) => c.trim().split('='))
  .find(([k]) => k === name)?.[1];

app.post('/api/login', (req, res) => {
  if (!process.env.APP_PASSWORD) return res.json({ ok: true });
  const given = String(req.body.password || '');
  const ok = given.length === process.env.APP_PASSWORD.length
    && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(process.env.APP_PASSWORD));
  if (!ok) return res.status(401).json({ error: 'Contrasenya incorrecta' });
  const secure = req.secure ? '; Secure' : '';
  res.set('Set-Cookie', `${COOKIE}=${authToken()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 90}${secure}`);
  res.json({ ok: true });
});
app.post('/api/logout', (req, res) => {
  res.set('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  res.json({ ok: true });
});
app.use(['/api', '/photos'], (req, res, next) => {
  if (!process.env.APP_PASSWORD || cookieOf(req, COOKIE) === authToken()) return next();
  res.status(401).json({ error: 'Cal iniciar sessió', login: true });
});

app.use(['/api', '/photos'], (req, res, next) => {
  ready().then(() => next()).catch((e) => {
    console.error('Error inicialitzant:', e);
    res.status(500).json({ error: `No es pot connectar amb la base de dades: ${e.message}` });
  });
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 20 },
  fileFilter: (req, file, cb) => cb(null, /^(image\/(jpeg|png|webp|gif)|application\/pdf)$/.test(file.mimetype)),
});

const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    if (!err.status) console.error(err);
    const msg = err.code === '23505' ? 'Ja existeix un registre amb aquest nom' : err.message || 'Error';
    res.status(err.status || (err.code === '23505' ? 400 : 500)).json({ error: msg });
  });
const fail = (status, message) => Object.assign(new Error(message), { status });
const list = (v) => (Array.isArray(v) ? v : String(v ?? '').split(/[\n;,]+/)).map((x) => String(x).trim()).filter(Boolean);

// ---------- Configuració i estat ----------
app.get('/api/config', wrap(async (req, res) => {
  const now = db.isoWeekOf(new Date());
  res.json({ ocr: ocrAvailable(), mail: mailAvailable(), currentWeek: db.weekId(now.year, now.week), settings: await db.getSettings() });
}));

app.get('/api/state', wrap(async (req, res) => {
  res.json(await db.loadWeek(String(req.query.week)));
}));

app.put('/api/settings', wrap(async (req, res) => {
  const { mailFrom, mailSubject, mailBody } = req.body;
  if (mailFrom !== undefined && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mailFrom)) throw fail(400, 'Correu del remitent no vàlid');
  res.json(await db.setSettings({ mailFrom, mailSubject, mailBody }));
}));

// ---------- Escoles (clients) ----------
app.post('/api/schools', wrap(async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) throw fail(400, 'Cal un nom');
  res.json(await db.createSchool(name));
}));

app.patch('/api/schools/:id', wrap(async (req, res) => {
  const name = typeof req.body.name === 'string' && req.body.name.trim() ? req.body.name.trim() : undefined;
  const active = typeof req.body.active === 'boolean' ? req.body.active : undefined;
  const school = await db.updateSchool(req.params.id, { name, active });
  if (!school) throw fail(404, 'Escola no trobada');
  res.json(school);
}));

// ---------- Proveïdors i productes ----------
const CHANNELS = ['email', 'whatsapp', 'phone', 'print'];
function providerFields(body) {
  const f = {};
  if (typeof body.name === 'string' && body.name.trim()) f.name = body.name.trim();
  if (CHANNELS.includes(body.channel)) f.channel = body.channel;
  if (body.emails !== undefined) f.emails = list(body.emails);
  if (body.aliases !== undefined) f.aliases = list(body.aliases).map((x) => x.toUpperCase());
  if (typeof body.phone === 'string') f.phone = body.phone.replace(/[^\d+]/g, '');
  if (typeof body.notes === 'string') f.notes = body.notes.trim();
  if (typeof body.active === 'boolean') f.active = body.active;
  return f;
}
const productNames = (v) => (Array.isArray(v) ? v : String(v ?? '').split('\n'))
  .map((x) => String(x).trim().replace(/\s+/g, ' ').toUpperCase()).filter(Boolean);

app.post('/api/providers', wrap(async (req, res) => {
  const f = providerFields(req.body);
  if (!f.name) throw fail(400, 'Cal un nom');
  const id = f.name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 30) || 'prov';
  const existing = await db.listProviders();
  const finalId = existing.some((p) => p.id === id) ? `${id}${Date.now().toString(36)}` : id;
  let p = await db.createProvider({ channel: 'email', emails: [], phone: '', aliases: [], notes: '', ...f, id: finalId });
  if (req.body.products) p = await db.addProducts(finalId, productNames(req.body.products));
  res.json(p);
}));

app.patch('/api/providers/:id', wrap(async (req, res) => {
  const p = await db.updateProvider(req.params.id, providerFields(req.body));
  if (!p) throw fail(404, 'Proveïdor no trobat');
  res.json(p);
}));

app.post('/api/providers/:id/products', wrap(async (req, res) => {
  const names = productNames(req.body.names ?? req.body.name);
  if (!names.length) throw fail(400, 'Escriu el nom del producte');
  const p = await db.addProducts(req.params.id, names);
  if (!p) throw fail(404, 'Proveïdor no trobat');
  res.json(p);
}));

app.delete('/api/providers/:id/products', wrap(async (req, res) => {
  res.json(await db.removeProduct(req.params.id, String(req.body.name || '')));
}));

// ---------- Fotos ----------
app.get('/photos/:id', wrap(async (req, res) => {
  const photo = await db.getPhoto(req.params.id);
  if (!photo) throw fail(404, 'Foto no trobada');
  res.set('Content-Type', photo.media_type).set('Cache-Control', 'private, max-age=604800');
  res.send(await getFile(photo.storage_path));
}));

// ---------- Comandes de cada escola ----------
async function startReading(wid, schoolId, photoIds, replace) {
  const sub = await db.ensureSubmission(wid, schoolId);
  const photos = await db.photosOf(sub.id, photoIds);
  if (!photos.length) return;
  await db.updateSubmissionFields(sub.id, { reading: true, readError: null });

  const job = (async () => {
    try {
      const providers = (await db.listProviders()).filter((p) => p.active);
      const images = await Promise.all(photos.map(async (p) => ({ data: await getFile(p.storage_path), mediaType: p.media_type })));
      const result = await readOrderPhotos(images, providers, db.weekInfo(wid));
      const items = (result.items || []).map((it) => ({
        providerId: it.provider_id,
        product: (it.product || '').trim().toUpperCase(),
        quantity: (it.quantity || '').trim(),
        day: (it.serve_day || '').trim(),
        aiNote: (it.note || '').trim(),
        confidence: it.confidence,
        inCatalog: it.in_catalog,
        source: 'ia',
        // De quines fotos ve la línia (per treure-la si s'esborra la foto)
        photoIds: photos.map((p) => p.id),
      }));
      await db.addAiItems(sub.id, items, replace);
      await db.markPhotosRead(photos.map((p) => p.id));
      const current = await db.getSubmission(wid, schoolId);
      const obs = (result.observations || '').trim();
      await db.updateSubmissionFields(sub.id, {
        reading: false,
        observations: obs && !current.observations.includes(obs) ? [current.observations, obs].filter(Boolean).join('\n') : undefined,
        detectedSchool: result.school_name || null,
        weekText: result.week_text || null,
        status: current.status === 'confirmed' ? undefined : 'review',
      });
    } catch (err) {
      console.error('Error llegint fotos:', err);
      const current = await db.getSubmission(wid, schoolId).catch(() => null);
      await db.updateSubmissionFields(sub.id, {
        reading: false,
        readError: err.message || 'Error llegint les fotos',
        status: current?.status === 'pending' ? 'review' : undefined,
      }).catch(() => {});
    }
  })();
  // A Vercel, manté la funció viva fins que acaba la lectura (la resposta ja s'ha enviat)
  waitUntil(job);
}

const checkWeek = (wid) => db.weekInfo(wid).id;

app.post('/api/weeks/:week/schools/:schoolId/photos', upload.array('photos', 20), wrap(async (req, res) => {
  const wid = checkWeek(req.params.week);
  if (!req.files?.length) throw fail(400, "No s'ha rebut cap foto o PDF vàlid (JPG, PNG, WEBP o PDF)");
  const sub = await db.ensureSubmission(wid, req.params.schoolId);
  const added = [];
  for (const f of req.files) {
    const base = `${wid}/${req.params.schoolId}/${Date.now()}_${db.newId().slice(0, 8)}`;
    if (f.mimetype === 'application/pdf') {
      if (f.buffer.subarray(0, 5).toString() !== '%PDF-') throw fail(400, `"${f.originalname}" no és un PDF vàlid`);
      await putFile(`${base}.pdf`, f.buffer, 'application/pdf');
      added.push(await db.addPhoto(sub.id, `${base}.pdf`, 'application/pdf'));
      continue;
    }
    // Sempre dreta: orientació del mòbil + detecció del full girat
    const { buffer } = await uprightPhoto(f.buffer);
    await putFile(`${base}.jpg`, buffer, 'image/jpeg');
    added.push(await db.addPhoto(sub.id, `${base}.jpg`, 'image/jpeg'));
  }
  await db.updateSubmissionFields(sub.id, { status: sub.status === 'confirmed' || !ocrAvailable() ? 'review' : undefined });
  if (ocrAvailable() && req.query.read !== '0') await startReading(wid, req.params.schoolId, added.map((p) => p.id), false);
  res.json(await db.getSubmission(wid, req.params.schoolId));
}));

app.post('/api/weeks/:week/schools/:schoolId/read', wrap(async (req, res) => {
  if (!ocrAvailable()) throw fail(400, 'La lectura automàtica no està configurada (falta ANTHROPIC_API_KEY).');
  const wid = checkWeek(req.params.week);
  const sub = await db.getSubmission(wid, req.params.schoolId);
  if (sub.reading) throw fail(409, "Ja s'està llegint");
  // Sense photoIds: torna a llegir totes les fotos i substitueix les línies llegides abans.
  // Amb photoIds: llegeix només aquestes fotos (acabades de pujar) i n'afegeix les línies.
  const ids = Array.isArray(req.body?.photoIds) && req.body.photoIds.length ? req.body.photoIds.map(String) : null;
  await startReading(wid, req.params.schoolId, ids, !ids);
  res.json(await db.getSubmission(wid, req.params.schoolId));
}));

// Girar una foto (queda desada girada per a tothom)
app.post('/api/weeks/:week/schools/:schoolId/photos/:photoId/rotate', wrap(async (req, res) => {
  const wid = checkWeek(req.params.week);
  const photo = await db.getPhoto(req.params.photoId);
  if (!photo) throw fail(404, 'Foto no trobada');
  if (photo.media_type === 'application/pdf') throw fail(400, 'Els PDF no es poden girar');
  const deg =[90, 180, 270].includes(Number(req.body.degrees)) ? Number(req.body.degrees) : 90;
  const rotated = await rotateJpeg(await getFile(photo.storage_path), deg);
  const key = `${wid}/${req.params.schoolId}/${Date.now()}_${db.newId().slice(0, 8)}.jpg`;
  await putFile(key, rotated, 'image/jpeg');
  await db.updatePhotoPath(photo.id, key, 'image/jpeg');
  await removeFile(photo.storage_path).catch(() => {});
  res.json(await db.getSubmission(wid, req.params.schoolId));
}));

// Esborrar una foto: també es treuen les línies que s'hi van llegir.
// Si la foto es va llegir juntament amb altres, aquestes es tornen a llegir per recuperar-ne les línies.
app.delete('/api/weeks/:week/schools/:schoolId/photos/:photoId', wrap(async (req, res) => {
  const wid = checkWeek(req.params.week);
  const current = await db.getSubmission(wid, req.params.schoolId);
  if (current.reading) throw fail(409, "S'estan llegint les fotos. Espera que acabi i torna-ho a provar.");
  const photo = await db.getPhoto(req.params.photoId);
  if (!photo || photo.submission_id !== current.id) throw fail(404, 'Foto no trobada');
  await db.deletePhoto(photo.id);
  await removeFile(photo.storage_path).catch(() => {});
  const { batch, legacy } = await db.removeItemsOfPhoto(current.id, photo.id);
  const left = (await db.photosOf(current.id, null)).map((p) => p.id);
  if (legacy) {
    // Línies llegides abans que es guardés de quina foto venien: es tornen a llegir totes les fotos que queden
    if (!left.length) await db.deleteAiItems(current.id);
    else if (ocrAvailable()) await startReading(wid, req.params.schoolId, null, true);
  } else {
    const reread = batch.filter((id) => left.includes(id));
    if (reread.length && ocrAvailable()) await startReading(wid, req.params.schoolId, reread, false);
  }
  res.json(await db.getSubmission(wid, req.params.schoolId));
}));

// Esborrar la comanda sencera d'una escola (fotos i línies) per tornar a començar
app.delete('/api/weeks/:week/schools/:schoolId', wrap(async (req, res) => {
  const wid = checkWeek(req.params.week);
  const current = await db.getSubmission(wid, req.params.schoolId);
  if (current.reading) throw fail(409, "S'estan llegint les fotos. Espera que acabi i torna-ho a provar.");
  const paths = await db.deleteSubmission(wid, req.params.schoolId);
  await Promise.all(paths.map((p) => removeFile(p).catch(() => {})));
  res.json(await db.getSubmission(wid, req.params.schoolId));
}));

app.put('/api/weeks/:week/schools/:schoolId', wrap(async (req, res) => {
  const wid = checkWeek(req.params.week);
  const sub = await db.ensureSubmission(wid, req.params.schoolId);
  const { items, observations, status, version } = req.body;
  if (Array.isArray(items)) {
    await db.replaceItems(sub.id, items.map((it) => ({
      id: /^[0-9a-f-]{36}$/i.test(it.id || '') ? it.id : undefined,
      providerId: String(it.providerId || ''),
      product: String(it.product || '').trim(),
      quantity: String(it.quantity || '').trim(),
      day: String(it.day || '').trim(),
      note: String(it.note || '').trim(),
      aiNote: String(it.aiNote || ''),
      confidence: it.confidence === 'baixa' ? 'baixa' : 'alta',
      inCatalog: it.inCatalog ?? true,
      source: it.source === 'ia' ? 'ia' : 'manual',
      toSchool: it.toSchool === true,
      photoIds: Array.isArray(it.photoIds) ? it.photoIds.filter((x) => /^[0-9a-f-]{36}$/i.test(String(x))) : [],
    })), typeof version === 'number' ? version : undefined);
  }
  if (status === 'confirmed' && (items || []).some((i) => !i.providerId)) throw fail(400, 'Hi ha línies sense proveïdor assignat');
  await db.updateSubmissionFields(sub.id, {
    observations: typeof observations === 'string' ? observations : undefined,
    status: ['pending', 'review', 'confirmed'].includes(status) ? status : undefined,
  });
  res.json(await db.getSubmission(wid, req.params.schoolId));
}));

// ---------- Històric ----------
app.get('/api/history', wrap(async (req, res) => {
  const weeks = await db.history({
    schoolId: req.query.school ? String(req.query.school) : null,
    providerId: req.query.provider ? String(req.query.provider) : null,
  });
  res.json(weeks.map((w) => ({ ...w, ...db.weekInfo(w.weekId) })));
}));

// ---------- Comandes per proveïdor ----------
const recipientsSummary = (p) => (p.channel === 'email' ? p.emails.join(', ') : p.phone || '');
const subjectFor = (settings, week) => settings.mailSubject.replace('{setmana}', week.week);

app.get('/api/weeks/:week/orders', wrap(async (req, res) => {
  const data = await db.loadWeek(checkWeek(req.params.week));
  const { week } = data;
  const confirmed = ordersByProvider(data, week, { onlyConfirmed: true });
  const all = ordersByProvider(data, week, { onlyConfirmed: false });
  const notConfirmed = data.schools.filter((s) => s.active && week.submissions[s.id]?.status !== 'confirmed').map((s) => s.name);
  const orders = all.map((o) => {
    const c = confirmed.find((x) => x.provider.id === o.provider.id);
    return {
      provider: o.provider,
      recipients: recipientsSummary(o.provider),
      schools: o.schools.map(({ school, status, items }) => ({ id: school.id, name: school.name, status, items })),
      confirmedSchools: c ? c.schools.length : 0,
      pendingSchools: o.schools.filter((s) => s.status !== 'confirmed').map((s) => s.school.name),
      text: c ? orderText(c, week, data.settings) : '',
      sent: week.sent[o.provider.id] || null,
    };
  });
  const list = schoolList(data, week);
  res.json({
    orders, notConfirmed, subject: subjectFor(data.settings, week), from: data.settings.mailFrom, label: weekLabel(week),
    schoolList: { lines: list.rows.length, schools: new Set(list.rows.map((r) => r.school)).size, pending: list.pending },
  });
}));

// Llista per portar a les escoles (línies marcades amb 🏫): Producte / Quantitat / Escola
app.get('/api/weeks/:week/school-list/pdf', wrap(async (req, res) => {
  const data = await db.loadWeek(checkWeek(req.params.week));
  const { rows } = schoolList(data, data.week);
  const pdf = await schoolListPdf(rows, data.week, data.settings);
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="Llista_escoles_${data.week.week}.pdf"`);
  res.send(pdf);
}));

/**
 * Esborra els fitxers (fotos i PDF) de les escoles d'una setmana que ja s'han enviat del tot:
 * l'escola està confirmada i tots els proveïdors on té línies ja consten com a enviats.
 * Les línies es mantenen (l'històric no canvia); només s'alliberen els fitxers per no omplir l'espai.
 */
async function clearSentFiles(wid) {
  const data = await db.loadWeek(wid);
  const { week } = data;
  const orders = ordersByProvider(data, week, { onlyConfirmed: true });
  const cleared = [];
  for (const school of data.schools) {
    const sub = week.submissions[school.id];
    if (!sub || sub.status !== 'confirmed' || !sub.photos.length || sub.reading) continue;
    const providers = orders.filter((o) => o.schools.some((s) => s.school.id === school.id)).map((o) => o.provider.id);
    if (!providers.length || !providers.every((id) => week.sent[id])) continue;
    const paths = await db.clearSubmissionFiles(sub.id);
    await Promise.all(paths.map((p) => removeFile(p).catch((e) => console.error('No s\'ha pogut esborrar', p, e))));
    cleared.push(school.name);
  }
  if (cleared.length) console.log(`Setmana ${wid}: fitxers esborrats de ${cleared.join(', ')}`);
  return cleared;
}
const clearSentFilesSafe = (wid) => clearSentFiles(wid).catch((e) => { console.error('Error esborrant fitxers enviats:', e); return []; });

async function confirmedOrder(req) {
  const data = await db.loadWeek(checkWeek(req.params.week));
  const order = ordersByProvider(data, data.week).find((o) => o.provider.id === req.params.providerId);
  if (!order) throw fail(404, 'Aquest proveïdor no té cap línia confirmada aquesta setmana');
  return { data, week: data.week, order };
}

app.get('/api/weeks/:week/orders/:providerId/pdf', wrap(async (req, res) => {
  const { data, week, order } = await confirmedOrder(req);
  const pdf = await orderPdf(order, week, data.settings);
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${encodeURIComponent(pdfFileName(order, week))}"`);
  res.send(pdf);
}));

app.post('/api/weeks/:week/orders/:providerId/send-mail', wrap(async (req, res) => {
  if (!mailAvailable()) throw fail(400, "L'enviament de correu no està configurat al servidor (SMTP).");
  const { data, week, order } = await confirmedOrder(req);
  if (!order.provider.emails.length) throw fail(400, 'Aquest proveïdor no té cap correu');
  const pdf = await orderPdf(order, week, data.settings);
  const to = order.provider.emails.join(', ');
  try {
    await sendMail({
      from: data.settings.mailFrom,
      to,
      subject: subjectFor(data.settings, week),
      text: data.settings.mailBody,
      attachments: [{ filename: pdfFileName(order, week), content: pdf, contentType: 'application/pdf' }],
    });
  } catch (e) {
    console.error('Error enviant correu:', e);
    throw fail(502, `No s'ha pogut enviar el correu: ${e.message}`);
  }
  await db.markSent(week.id, order.provider.id, 'correu', to);
  const cleared = await clearSentFilesSafe(week.id);
  res.json({ ok: true, to, cleared });
}));

// Còpia d'una comanda només al remitent (p. ex. per tenir constància d'una que ja s'ha enviat).
// No es marca com a enviada ni s'envia al proveïdor.
app.post('/api/weeks/:week/orders/:providerId/send-copy', wrap(async (req, res) => {
  if (!mailAvailable()) throw fail(400, "L'enviament de correu no està configurat al servidor.");
  const { data, week, order } = await confirmedOrder(req);
  const sent = week.sent[order.provider.id];
  const fmt = (iso) => new Date(iso).toLocaleString('ca-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const note = sent
    ? `Còpia de la comanda enviada a ${order.provider.name} (${sent.to || recipientsSummary(order.provider)}) el ${fmt(sent.at)}.`
    : `Còpia de la comanda de ${order.provider.name} (encara no enviada al proveïdor).`;
  const pdf = await orderPdf(order, week, data.settings);
  const to = data.settings.mailFrom;
  try {
    await sendMail({
      from: data.settings.mailFrom,
      to,
      subject: `[CÒPIA] ${subjectFor(data.settings, week)} - ${order.provider.name}`,
      text: `${note}\n\n---\n\n${data.settings.mailBody}`,
      attachments: [{ filename: pdfFileName(order, week), content: pdf, contentType: 'application/pdf' }],
    });
  } catch (e) {
    console.error('Error enviant la còpia:', e);
    throw fail(502, `No s'ha pogut enviar la còpia: ${e.message}`);
  }
  res.json({ ok: true, to });
}));

// Correu de prova: només al remitent (mai als proveïdors), amb un PDF de mostra
app.post('/api/test-mail', wrap(async (req, res) => {
  if (!mailAvailable()) throw fail(400, "L'enviament de correu no està configurat al servidor.");
  const settings = await db.getSettings();
  const now = db.isoWeekOf(new Date());
  const week = db.weekInfo(db.weekId(now.year, now.week));
  const order = {
    provider: { name: 'PROVA (correu de mostra)' },
    schools: [{ school: { name: 'ESCOLA DE PROVA' }, items: [
      { product: 'CARN PICADA POLLASTRE', quantity: '7 KG', day: '09/11', note: '' },
      { product: 'ESCALOPA DE POLLASTRE', quantity: '200 UNITATS', day: '12/11', note: '' },
    ] }],
  };
  const pdf = await orderPdf(order, week, settings);
  try {
    await sendMail({
      from: settings.mailFrom,
      to: settings.mailFrom,
      subject: `[PROVA] ${settings.mailSubject.replace('{setmana}', week.week)}`,
      text: `Això és un correu de prova de l'app de comandes. No s'ha enviat a cap proveïdor.\n\n${settings.mailBody}`,
      attachments: [{ filename: 'PROVA.pdf', content: pdf, contentType: 'application/pdf' }],
    });
  } catch (e) {
    console.error('Error en el correu de prova:', e);
    throw fail(502, `No s'ha pogut enviar: ${e.message}`);
  }
  res.json({ ok: true, to: settings.mailFrom });
}));

app.post('/api/weeks/:week/orders/:providerId/mark-sent', wrap(async (req, res) => {
  const wid = checkWeek(req.params.week);
  if (req.body.undo) {
    await db.unmarkSent(wid, req.params.providerId);
    return res.json({ ok: true, cleared: [] });
  }
  await db.markSent(wid, req.params.providerId, String(req.body.via || 'manual'));
  res.json({ ok: true, cleared: await clearSentFilesSafe(wid) });
}));

export default app;
