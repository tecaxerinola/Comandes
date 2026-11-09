// Accés a la base de dades (Postgres de Supabase).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { attachDatabasePool } from '@vercel/functions';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const newId = () => crypto.randomUUID();

const DEFAULT_SETTINGS = {
  mailFrom: 'jordi@tecaxerinola.com',
  mailSubject: 'Comanda setmana {setmana}',
  mailBody: 'Bon dia,\n\nAdjuntem comanda.\n\nGràcies',
};

let pool;
function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL (cadena de connexió de Supabase)');
    const local = /localhost|127\.0\.0\.1|\/tmp|host=\//.test(process.env.DATABASE_URL);
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: local || process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
      max: process.env.VERCEL ? 3 : 5,
      idleTimeoutMillis: process.env.VERCEL ? 5000 : 30000,
    });
    // A Vercel, tanca bé les connexions inactives quan la funció s'atura
    if (process.env.VERCEL) attachDatabasePool(pool);
  }
  return pool;
}
const q = (text, params) => getPool().query(text, params);

async function tx(fn) {
  const client = await getPool().connect();
  try {
    await client.query('begin');
    const r = await fn(client);
    await client.query('commit');
    return r;
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

// ---------- Inicialització ----------
export async function initDb() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '001_init.sql'), 'utf8');
  await tx(async (c) => {
    // Evita que dues instàncies (Vercel) creïn l'esquema alhora
    await c.query('select pg_advisory_xact_lock(424242)');
    // Si l'app viu dins d'un esquema propi (p. ex. "comandes" dins d'un projecte compartit),
    // comprovem que hi som abans de crear res, per no tocar mai les taules d'una altra app.
    const schema = process.env.DB_SCHEMA;
    if (schema) {
      const cur = (await c.query('select current_schema() as s')).rows[0].s;
      if (cur !== schema) throw new Error(`La connexió treballa a l'esquema "${cur}" i no a "${schema}". Reviseu l'usuari de DATABASE_URL.`);
    }
    const { rows } = await c.query("select to_regclass('sent_orders') is not null as ok");
    if (!rows[0].ok) await c.query(sql);
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
      await c.query('insert into settings (key, value) values ($1, $2) on conflict (key) do nothing', [k, v]);
    }
  });
  const { rows } = await q('select count(*)::int as n from providers');
  if (rows[0].n === 0) await seed();
}

async function seed() {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed-data.json'), 'utf8'));
  await tx(async (c) => {
    await c.query('select pg_advisory_xact_lock(424243)');
    if ((await c.query('select count(*)::int as n from providers')).rows[0].n > 0) return;
    for (const s of data.schools) {
      await c.query('insert into schools (name, active) values ($1, $2) on conflict (name) do nothing', [s.name, s.active]);
    }
    let pos = 0;
    for (const p of data.providers) {
      await c.query(
        `insert into providers (id, name, channel, emails, phone, aliases, notes, active, position)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (id) do nothing`,
        [p.id, p.name, p.channel, p.emails, p.phone, p.aliases, p.notes, p.active, pos++],
      );
      let i = 0;
      for (const name of p.products) {
        await c.query('insert into products (provider_id, name, position) values ($1,$2,$3) on conflict do nothing', [p.id, name, i++]);
      }
    }
  });
}

// ---------- Setmanes (ISO) ----------
export function isoWeekOf(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return { year: d.getUTCFullYear(), week: Math.ceil(((d - yearStart) / 86400000 + 1) / 7) };
}
export const weekId = (year, week) => `${year}-W${String(week).padStart(2, '0')}`;

export function weekInfo(id) {
  const m = /^(\d{4})-W(\d{2})$/.exec(String(id));
  if (!m) throw Object.assign(new Error('Setmana no vàlida'), { status: 400 });
  const year = Number(m[1]);
  const week = Number(m[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - (jan4.getUTCDay() || 7) + 1 + (week - 1) * 7);
  const friday = new Date(monday);
  friday.setUTCDate(monday.getUTCDate() + 4);
  const iso = (d) => d.toISOString().slice(0, 10);
  return { id, year, week, from: iso(monday), to: iso(friday) };
}

// ---------- Escoles ----------
export async function listSchools() {
  const { rows } = await q('select id, name, active from schools');
  return rows.sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name, 'ca'));
}
export async function createSchool(name) {
  return (await q('insert into schools (name) values ($1) returning id, name, active', [name])).rows[0];
}
export async function updateSchool(id, { name, active }) {
  const { rows } = await q(
    'update schools set name = coalesce($2, name), active = coalesce($3, active) where id = $1 returning id, name, active',
    [id, name ?? null, active ?? null],
  );
  return rows[0];
}

// ---------- Proveïdors i productes ----------
export async function listProviders() {
  const { rows } = await q(
    `select p.id, p.name, p.channel, p.emails, p.phone, p.aliases, p.notes, p.active,
            coalesce(array_agg(pr.name order by pr.position, pr.created_at) filter (where pr.id is not null), '{}') as products
       from providers p left join products pr on pr.provider_id = p.id
      group by p.id order by p.position, p.created_at`,
  );
  return rows;
}
export async function getProvider(id) {
  return (await listProviders()).find((p) => p.id === id) || null;
}
export async function createProvider(p) {
  await q(
    `insert into providers (id, name, channel, emails, phone, aliases, notes, active, position)
     values ($1,$2,$3,$4,$5,$6,$7,true,(select coalesce(max(position),0)+1 from providers))`,
    [p.id, p.name, p.channel, p.emails, p.phone, p.aliases, p.notes],
  );
  return getProvider(p.id);
}
export async function updateProvider(id, f) {
  await q(
    `update providers set name = coalesce($2, name), channel = coalesce($3, channel), emails = coalesce($4, emails),
       phone = coalesce($5, phone), aliases = coalesce($6, aliases), notes = coalesce($7, notes), active = coalesce($8, active)
     where id = $1`,
    [id, f.name ?? null, f.channel ?? null, f.emails ?? null, f.phone ?? null, f.aliases ?? null, f.notes ?? null, f.active ?? null],
  );
  return getProvider(id);
}
export async function addProducts(providerId, names) {
  await tx(async (c) => {
    const { rows } = await c.query('select coalesce(max(position), -1) as m from products where provider_id = $1', [providerId]);
    let pos = rows[0].m + 1;
    for (const name of names) {
      await c.query('insert into products (provider_id, name, position) values ($1,$2,$3) on conflict do nothing', [providerId, name, pos++]);
    }
  });
  return getProvider(providerId);
}
export async function removeProduct(providerId, name) {
  await q('delete from products where provider_id = $1 and name = $2', [providerId, name]);
  return getProvider(providerId);
}

// ---------- Configuració ----------
export async function getSettings() {
  const { rows } = await q('select key, value from settings');
  return { ...DEFAULT_SETTINGS, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) };
}
export async function setSettings(values) {
  for (const [k, v] of Object.entries(values)) {
    if (!(k in DEFAULT_SETTINGS) || typeof v !== 'string') continue;
    await q('insert into settings (key, value) values ($1,$2) on conflict (key) do update set value = excluded.value', [k, v]);
  }
  return getSettings();
}

// ---------- Comandes de cada escola ----------
const itemOut = (r) => ({
  id: r.id, providerId: r.provider_id || '', product: r.product, quantity: r.quantity, day: r.day, note: r.note,
  aiNote: r.ai_note, confidence: r.confidence, inCatalog: r.in_catalog, source: r.source,
});
// La url canvia quan la foto es gira, perquè el navegador no mostri la versió antiga
const photoOut = (r) => ({ id: r.id, url: `/photos/${r.id}?v=${encodeURIComponent(r.storage_path.split('/').pop().split('.')[0])}`, mediaType: r.media_type, read: r.read, uploadedAt: r.uploaded_at });
// Una lectura que fa més de 6 minuts que dura s'ha interromput (p. ex. s'ha aturat el servidor)
const STALE_MS = 6 * 60 * 1000;
const subOut = (s, items, photos) => {
  const stale = s.reading && (!s.updated_at || Date.now() - new Date(s.updated_at).getTime() > STALE_MS);
  return subOutRaw({ ...s, reading: stale ? false : s.reading, read_error: stale ? 'Lectura interrompuda. Torna-ho a provar.' : s.read_error }, items, photos);
};
const subOutRaw = (s, items, photos) => ({
  id: s.id, schoolId: s.school_id, status: s.status, observations: s.observations, detectedSchool: s.detected_school,
  weekText: s.week_text, reading: s.reading, readError: s.read_error, version: s.version, updatedAt: s.updated_at,
  items: items.map(itemOut), photos: photos.map(photoOut),
});

/** Totes les comandes d'una setmana: { [schoolId]: submission } */
export async function weekSubmissions(wid) {
  const subs = (await q('select * from submissions where week_id = $1', [wid])).rows;
  if (!subs.length) return {};
  const ids = subs.map((s) => s.id);
  const items = (await q('select * from submission_items where submission_id = any($1) order by position', [ids])).rows;
  const photos = (await q('select * from photos where submission_id = any($1) order by uploaded_at', [ids])).rows;
  return Object.fromEntries(subs.map((s) => [
    s.school_id,
    subOut(s, items.filter((i) => i.submission_id === s.id), photos.filter((p) => p.submission_id === s.id)),
  ]));
}

export async function weekSent(wid) {
  const { rows } = await q('select provider_id, sent_at, via, recipients from sent_orders where week_id = $1', [wid]);
  return Object.fromEntries(rows.map((r) => [r.provider_id, { at: r.sent_at, via: r.via, to: r.recipients }]));
}

export async function ensureSubmission(wid, schoolId) {
  const { rows } = await q(
    `insert into submissions (week_id, school_id) values ($1, $2)
     on conflict (week_id, school_id) do update set week_id = excluded.week_id returning *`,
    [wid, schoolId],
  );
  return rows[0];
}

export async function getSubmission(wid, schoolId) {
  const s = await ensureSubmission(wid, schoolId);
  const items = (await q('select * from submission_items where submission_id = $1 order by position', [s.id])).rows;
  const photos = (await q('select * from photos where submission_id = $1 order by uploaded_at', [s.id])).rows;
  return subOut(s, items, photos);
}

export async function updateSubmissionFields(subId, f) {
  const cols = {
    status: f.status, observations: f.observations, detected_school: f.detectedSchool, week_text: f.weekText,
    reading: f.reading, read_error: f.readError,
  };
  const sets = [];
  const vals = [subId];
  for (const [k, v] of Object.entries(cols)) {
    if (v === undefined) continue;
    vals.push(v);
    sets.push(`${k} = $${vals.length}`);
  }
  sets.push('version = version + 1', 'updated_at = now()');
  await q(`update submissions set ${sets.join(', ')} where id = $1`, vals);
}

async function insertItems(c, subId, items, startPos = 0) {
  let pos = startPos;
  for (const it of items) {
    await c.query(
      `insert into submission_items (id, submission_id, position, provider_id, product, quantity, day, note, ai_note, confidence, in_catalog, source)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [it.id || newId(), subId, pos++, it.providerId || null, it.product || '', it.quantity || '', it.day || '', it.note || '',
        it.aiNote || '', it.confidence || 'alta', it.inCatalog ?? true, it.source || 'manual'],
    );
  }
}

/** Substitueix totes les línies (desat des de la pantalla de revisió). */
export async function replaceItems(subId, items, expectedVersion) {
  return tx(async (c) => {
    const { rows } = await c.query('select version from submissions where id = $1 for update', [subId]);
    if (expectedVersion !== undefined && rows[0].version !== expectedVersion) {
      throw Object.assign(new Error("La comanda s'ha actualitzat mentrestant (lectura de fotos). Es recarrega."), { status: 409 });
    }
    await c.query('delete from submission_items where submission_id = $1', [subId]);
    await insertItems(c, subId, items);
  });
}

/** Afegeix les línies llegides de les fotos (si replaceAi, esborra abans les llegides anteriorment). */
export async function addAiItems(subId, items, replaceAi) {
  await tx(async (c) => {
    if (replaceAi) await c.query("delete from submission_items where submission_id = $1 and source = 'ia'", [subId]);
    const { rows } = await c.query('select coalesce(max(position), -1) as m from submission_items where submission_id = $1', [subId]);
    await insertItems(c, subId, items, rows[0].m + 1);
  });
}

export async function addPhoto(subId, storagePath, mediaType) {
  return (await q('insert into photos (submission_id, storage_path, media_type) values ($1,$2,$3) returning *', [subId, storagePath, mediaType])).rows[0];
}
export async function getPhoto(id) {
  return (await q('select * from photos where id = $1', [id])).rows[0] || null;
}
export async function photosOf(subId, ids) {
  return (await q('select * from photos where submission_id = $1 and ($2::uuid[] is null or id = any($2)) order by uploaded_at', [subId, ids || null])).rows;
}
export async function markPhotosRead(ids) {
  await q('update photos set read = true where id = any($1)', [ids]);
}
export async function updatePhotoPath(id, storagePath, mediaType) {
  await q('update photos set storage_path = $2, media_type = $3 where id = $1', [id, storagePath, mediaType]);
}
export async function deletePhoto(id) {
  return (await q('delete from photos where id = $1 returning *', [id])).rows[0];
}

export async function markSent(wid, providerId, via, recipients = '') {
  await q(
    `insert into sent_orders (week_id, provider_id, via, recipients) values ($1,$2,$3,$4)
     on conflict (week_id, provider_id) do update set sent_at = now(), via = excluded.via, recipients = excluded.recipients`,
    [wid, providerId, via, recipients],
  );
}
export async function unmarkSent(wid, providerId) {
  await q('delete from sent_orders where week_id = $1 and provider_id = $2', [wid, providerId]);
}

/** Tot el que cal per a una setmana, amb la mateixa forma que fa servir lib/orders.js */
export async function loadWeek(wid) {
  const info = weekInfo(wid);
  const [schools, providers, settings, submissions, sent] = await Promise.all([
    listSchools(), listProviders(), getSettings(), weekSubmissions(wid), weekSent(wid),
  ]);
  return { schools, providers, settings, week: { ...info, submissions, sent } };
}

/**
 * Resum de totes les setmanes amb comandes (per a l'històric).
 * Filtres opcionals: una escola i/o un proveïdor.
 */
export async function history({ schoolId = null, providerId = null } = {}) {
  const { rows } = await q(
    `with lines as (
       select s.week_id, s.school_id, s.status, i.provider_id
         from submissions s
         join submission_items i on i.submission_id = s.id
        where (i.quantity <> '' or i.day <> '') and i.product <> ''
          and ($1::uuid is null or s.school_id = $1)
          and ($2::text is null or i.provider_id = $2)
     ),
     photo_weeks as (
       select s.week_id, count(p.id)::int as photos
         from submissions s join photos p on p.submission_id = s.id
        where ($1::uuid is null or s.school_id = $1)
        group by s.week_id
     ),
     w as (
       select week_id,
              count(distinct school_id)::int as schools,
              count(distinct school_id) filter (where status = 'confirmed')::int as confirmed,
              count(*)::int as lines,
              count(distinct provider_id)::int as providers
         from lines group by week_id
     )
     select coalesce(w.week_id, pw.week_id) as week_id,
            coalesce(w.schools, 0) as schools, coalesce(w.confirmed, 0) as confirmed,
            coalesce(w.lines, 0) as lines, coalesce(w.providers, 0) as providers,
            coalesce(pw.photos, 0) as photos,
            (select count(*)::int from sent_orders so where so.week_id = coalesce(w.week_id, pw.week_id)
               and ($2::text is null or so.provider_id = $2)) as sent
       from w full join photo_weeks pw on pw.week_id = w.week_id
      where ($2::text is null or w.week_id is not null)
      order by 1 desc`,
    [schoolId, providerId],
  );
  return rows.map((r) => ({
    weekId: r.week_id, schools: r.schools, confirmed: r.confirmed, lines: r.lines,
    providers: r.providers, photos: r.photos, sent: r.sent,
  }));
}
