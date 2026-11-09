import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, save, newId, getWeek, getSubmission, isoWeekOf, weekId, UPLOAD_DIR } from './lib/db.js';
import { readOrderPhotos, ocrAvailable } from './lib/ocr.js';
import { ordersByProvider, orderText, orderPdf, pdfFileName, weekLabel } from './lib/orders.js';
import { sendMail, mailAvailable } from './lib/mail.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '2mb' }));

// ---------- Contrasenya opcional (APP_PASSWORD) ----------
if (process.env.APP_PASSWORD) {
  app.use((req, res, next) => {
    const hdr = req.headers.authorization || '';
    const [, b64] = hdr.split(' ');
    const pass = b64 ? Buffer.from(b64, 'base64').toString().split(':').slice(1).join(':') : '';
    if (pass === process.env.APP_PASSWORD) return next();
    res.set('WWW-Authenticate', 'Basic realm="Comandes"').status(401).send('Cal contrasenya');
  });
}

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const ext = { 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' }[file.mimetype] || '.jpg';
      cb(null, `${Date.now()}_${newId()}${ext}`);
    },
  }),
  limits: { fileSize: 15 * 1024 * 1024, files: 20 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)),
});

const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || 'Error' });
  });
const fail = (status, message) => Object.assign(new Error(message), { status });

const findSchool = (id) => getDb().schools.find((s) => s.id === id) || (() => { throw fail(404, 'Escola no trobada'); })();
const findProvider = (id) => getDb().providers.find((p) => p.id === id) || (() => { throw fail(404, 'Proveïdor no trobat'); })();

// ---------- Configuració i estat ----------
app.get('/api/config', (req, res) => {
  const now = isoWeekOf(new Date());
  res.json({ ocr: ocrAvailable(), mail: mailAvailable(), currentWeek: weekId(now.year, now.week), settings: getDb().settings });
});

app.get('/api/state', wrap((req, res) => {
  const db = getDb();
  const week = getWeek(String(req.query.week));
  res.json({ week, schools: db.schools, providers: db.providers, settings: db.settings });
}));

app.get('/api/weeks', (req, res) => {
  res.json(Object.values(getDb().weeks).map((w) => ({ id: w.id, week: w.week, from: w.from, to: w.to })));
});

app.put('/api/settings', wrap((req, res) => {
  const db = getDb();
  const { mailSubject, mailBody } = req.body;
  if (typeof mailSubject === 'string') db.settings.mailSubject = mailSubject;
  if (typeof mailBody === 'string') db.settings.mailBody = mailBody;
  save();
  res.json(db.settings);
}));

// ---------- Escoles (clients) ----------
app.post('/api/schools', wrap((req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) throw fail(400, 'Cal un nom');
  const db = getDb();
  if (db.schools.some((s) => s.name.toLowerCase() === name.toLowerCase())) throw fail(400, 'Ja existeix una escola amb aquest nom');
  const school = { id: newId(), name, active: true };
  db.schools.push(school);
  save();
  res.json(school);
}));

app.patch('/api/schools/:id', wrap((req, res) => {
  const school = findSchool(req.params.id);
  if (typeof req.body.name === 'string' && req.body.name.trim()) school.name = req.body.name.trim();
  if (typeof req.body.active === 'boolean') school.active = req.body.active;
  save();
  res.json(school);
}));

// ---------- Proveïdors ----------
const CHANNELS = ['email', 'whatsapp', 'phone', 'print'];
function applyProvider(p, body) {
  if (typeof body.name === 'string' && body.name.trim()) p.name = body.name.trim();
  if (CHANNELS.includes(body.channel)) p.channel = body.channel;
  const list = (v) => (Array.isArray(v) ? v : String(v).split(/[\n;,]+/)).map((x) => String(x).trim()).filter(Boolean);
  if (body.emails !== undefined) p.emails = list(body.emails);
  if (body.aliases !== undefined) p.aliases = list(body.aliases);
  if (body.products !== undefined) {
    p.products = (Array.isArray(body.products) ? body.products : String(body.products).split('\n'))
      .map((x) => x.trim()).filter(Boolean);
  }
  if (typeof body.phone === 'string') p.phone = body.phone.replace(/[^\d+]/g, '');
  if (typeof body.notes === 'string') p.notes = body.notes;
  if (typeof body.active === 'boolean') p.active = body.active;
}

app.post('/api/providers', wrap((req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) throw fail(400, 'Cal un nom');
  const p = { id: newId(), name, channel: 'email', emails: [], phone: '', aliases: [], notes: '', active: true, products: [] };
  applyProvider(p, req.body);
  getDb().providers.push(p);
  save();
  res.json(p);
}));

app.patch('/api/providers/:id', wrap((req, res) => {
  const p = findProvider(req.params.id);
  applyProvider(p, req.body);
  save();
  res.json(p);
}));

// ---------- Comandes de cada escola ----------
function startReading(weekIdStr, schoolId, photoIds, replace) {
  const db = getDb();
  const week = getWeek(weekIdStr);
  const sub = getSubmission(week, schoolId);
  const photos = sub.photos.filter((p) => photoIds.includes(p.id));
  if (!photos.length) return;
  sub.reading = true;
  sub.readError = null;
  save();

  const providers = db.providers.filter((p) => p.active);
  const images = photos.map((p) => ({ data: fs.readFileSync(path.join(UPLOAD_DIR, p.file)), mediaType: p.mediaType }));

  readOrderPhotos(images, providers, week)
    .then((result) => {
      const items = (result.items || []).map((it) => ({
        id: newId(),
        providerId: it.provider_id,
        product: (it.product || '').trim().toUpperCase(),
        quantity: (it.quantity || '').trim(),
        day: (it.serve_day || '').trim(),
        note: '',
        aiNote: (it.note || '').trim(),
        confidence: it.confidence,
        inCatalog: it.in_catalog,
        source: 'ia',
      }));
      sub.items = replace ? [...sub.items.filter((i) => i.source !== 'ia'), ...items] : [...sub.items, ...items];
      const obs = (result.observations || '').trim();
      if (obs && !sub.observations.includes(obs)) sub.observations = [sub.observations, obs].filter(Boolean).join('\n');
      sub.detectedSchool = result.school_name || null;
      sub.weekText = result.week_text || null;
      for (const p of photos) p.read = true;
      if (sub.status !== 'confirmed') sub.status = 'review';
    })
    .catch((err) => {
      console.error('Error llegint fotos:', err);
      sub.readError = err.message || 'Error llegint les fotos';
      if (sub.status === 'pending') sub.status = 'review';
    })
    .finally(() => {
      sub.reading = false;
      sub.updatedAt = new Date().toISOString();
      save();
    });
}

app.post('/api/weeks/:week/schools/:schoolId/photos', upload.array('photos', 20), wrap((req, res) => {
  findSchool(req.params.schoolId);
  if (!req.files?.length) throw fail(400, "No s'ha rebut cap imatge vàlida (JPG, PNG o WEBP)");
  const week = getWeek(req.params.week);
  const sub = getSubmission(week, req.params.schoolId);
  const added = req.files.map((f) => ({ id: newId(), file: f.filename, mediaType: f.mimetype, uploadedAt: new Date().toISOString(), read: false }));
  sub.photos.push(...added);
  if (sub.status === 'confirmed') sub.status = 'review';
  sub.updatedAt = new Date().toISOString();
  save();
  if (ocrAvailable() && req.query.read !== '0') startReading(week.id, req.params.schoolId, added.map((p) => p.id), false);
  else if (sub.status === 'pending') { sub.status = 'review'; save(); }
  res.json(sub);
}));

app.post('/api/weeks/:week/schools/:schoolId/read', wrap((req, res) => {
  if (!ocrAvailable()) throw fail(400, "La lectura automàtica no està configurada (falta ANTHROPIC_API_KEY).");
  const week = getWeek(req.params.week);
  const sub = getSubmission(week, req.params.schoolId);
  if (sub.reading) throw fail(409, 'Ja s\'està llegint');
  startReading(week.id, req.params.schoolId, sub.photos.map((p) => p.id), true);
  res.json(sub);
}));

app.delete('/api/weeks/:week/schools/:schoolId/photos/:photoId', wrap((req, res) => {
  const sub = getSubmission(getWeek(req.params.week), req.params.schoolId);
  const photo = sub.photos.find((p) => p.id === req.params.photoId);
  if (!photo) throw fail(404, 'Foto no trobada');
  sub.photos = sub.photos.filter((p) => p !== photo);
  fs.rm(path.join(UPLOAD_DIR, photo.file), { force: true }, () => {});
  save();
  res.json(sub);
}));

app.put('/api/weeks/:week/schools/:schoolId', wrap((req, res) => {
  findSchool(req.params.schoolId);
  const sub = getSubmission(getWeek(req.params.week), req.params.schoolId);
  const { items, observations, status } = req.body;
  if (Array.isArray(items)) {
    sub.items = items.map((it) => ({
      id: it.id || newId(),
      providerId: String(it.providerId || ''),
      product: String(it.product || '').trim(),
      quantity: String(it.quantity || '').trim(),
      day: String(it.day || '').trim(),
      note: String(it.note || '').trim(),
      aiNote: it.aiNote || '',
      confidence: it.confidence || 'alta',
      inCatalog: it.inCatalog ?? true,
      source: it.source || 'manual',
    }));
  }
  if (typeof observations === 'string') sub.observations = observations;
  if (['pending', 'review', 'confirmed'].includes(status)) {
    if (status === 'confirmed' && sub.items.some((i) => !i.providerId)) throw fail(400, 'Hi ha línies sense proveïdor assignat');
    sub.status = status;
  }
  sub.updatedAt = new Date().toISOString();
  save();
  res.json(sub);
}));

// ---------- Comandes per proveïdor ----------
function recipientsSummary(p) {
  if (p.channel === 'email') return p.emails.join(', ');
  return p.phone || '';
}

app.get('/api/weeks/:week/orders', wrap((req, res) => {
  const db = getDb();
  const week = getWeek(req.params.week);
  const confirmed = ordersByProvider(db, week, { onlyConfirmed: true });
  const all = ordersByProvider(db, week, { onlyConfirmed: false });
  const activeSchools = db.schools.filter((s) => s.active);
  const notConfirmed = activeSchools.filter((s) => week.submissions[s.id]?.status !== 'confirmed').map((s) => s.name);
  const out = all.map((o) => {
    const c = confirmed.find((x) => x.provider.id === o.provider.id);
    return {
      provider: o.provider,
      recipients: recipientsSummary(o.provider),
      schools: o.schools.map(({ school, status, items }) => ({ id: school.id, name: school.name, status, items })),
      confirmedSchools: c ? c.schools.length : 0,
      pendingSchools: o.schools.filter((s) => s.status !== 'confirmed').map((s) => s.school.name),
      text: c ? orderText(c, week, db.settings) : '',
      sent: week.sent[o.provider.id] || null,
    };
  });
  res.json({ orders: out, notConfirmed, subject: db.settings.mailSubject.replace('{setmana}', week.week), label: weekLabel(week) });
}));

function confirmedOrder(req) {
  const db = getDb();
  const week = getWeek(req.params.week);
  const order = ordersByProvider(db, week).find((o) => o.provider.id === req.params.providerId);
  if (!order) throw fail(404, 'Aquest proveïdor no té cap línia confirmada aquesta setmana');
  return { db, week, order };
}

app.get('/api/weeks/:week/orders/:providerId/pdf', wrap(async (req, res) => {
  const { week, order } = confirmedOrder(req);
  const pdf = await orderPdf(order, week);
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${encodeURIComponent(pdfFileName(order, week))}"`);
  res.send(pdf);
}));

app.post('/api/weeks/:week/orders/:providerId/send-mail', wrap(async (req, res) => {
  if (!mailAvailable()) throw fail(400, "L'enviament de correu no està configurat (SMTP).");
  const { db, week, order } = confirmedOrder(req);
  if (!order.provider.emails.length) throw fail(400, 'Aquest proveïdor no té cap correu');
  const pdf = await orderPdf(order, week);
  await sendMail({
    to: order.provider.emails.join(', '),
    subject: db.settings.mailSubject.replace('{setmana}', week.week),
    text: db.settings.mailBody,
    attachments: [{ filename: pdfFileName(order, week), content: pdf, contentType: 'application/pdf' }],
  });
  week.sent[order.provider.id] = { at: new Date().toISOString(), via: 'email', to: order.provider.emails.join(', ') };
  save();
  res.json(week.sent[order.provider.id]);
}));

app.post('/api/weeks/:week/orders/:providerId/mark-sent', wrap((req, res) => {
  const week = getWeek(req.params.week);
  findProvider(req.params.providerId);
  if (req.body.undo) delete week.sent[req.params.providerId];
  else week.sent[req.params.providerId] = { at: new Date().toISOString(), via: String(req.body.via || 'manual') };
  save();
  res.json(week.sent[req.params.providerId] || null);
}));

// En reiniciar, cap lectura queda "penjada"
for (const w of Object.values(getDb().weeks)) {
  for (const s of Object.values(w.submissions)) if (s.reading) { s.reading = false; s.readError = 'Lectura interrompuda. Torna-ho a provar.'; }
}
save();

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => {
  console.log(`Comandes en marxa a http://localhost:${PORT}`);
  console.log(`  Lectura de fotos (IA): ${ocrAvailable() ? 'activada' : 'NO configurada (ANTHROPIC_API_KEY)'}`);
  console.log(`  Enviament de correu:   ${mailAvailable() ? 'activat' : 'NO configurat (SMTP_*)'}`);
});
