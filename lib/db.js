// Emmagatzematge senzill en un fitxer JSON (data/db.json).
// Per al volum d'una empresa de càtering (desenes d'escoles i proveïdors) és més que suficient
// i permet fer còpies de seguretat copiant la carpeta "data".
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const newId = () => crypto.randomBytes(6).toString('hex');

function seed() {
  const seedData = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed-data.json'), 'utf8'));
  return {
    schools: seedData.schools.map((s) => ({ id: newId(), name: s.name, active: s.active })),
    providers: seedData.providers,
    weeks: {},
    settings: {
      mailSubject: 'Comanda setmana {setmana}',
      mailBody: 'Bon dia,\n\nAdjuntem comanda.\n\nGràcies',
    },
  };
}

let db;
function load() {
  if (fs.existsSync(DB_FILE)) {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } else {
    db = seed();
    save();
  }
}

export function save() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
  fs.renameSync(tmp, DB_FILE);
}

export function getDb() {
  if (!db) load();
  return db;
}

// ---------- Setmanes (ISO) ----------
export function isoWeekOf(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}

export function weekId(year, week) {
  return `${year}-W${String(week).padStart(2, '0')}`;
}

export function weekRange(year, week) {
  // Dilluns de la setmana ISO
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - day + 1 + (week - 1) * 7);
  const friday = new Date(monday);
  friday.setUTCDate(monday.getUTCDate() + 4);
  const iso = (d) => d.toISOString().slice(0, 10);
  return { from: iso(monday), to: iso(friday) };
}

export function getWeek(id, create = true) {
  const d = getDb();
  if (!d.weeks[id] && create) {
    const m = /^(\d{4})-W(\d{2})$/.exec(id);
    if (!m) throw new Error('Setmana no vàlida');
    const year = Number(m[1]);
    const week = Number(m[2]);
    d.weeks[id] = { id, year, week, ...weekRange(year, week), submissions: {}, sent: {} };
  }
  return d.weeks[id];
}

export function getSubmission(week, schoolId) {
  if (!week.submissions[schoolId]) {
    week.submissions[schoolId] = { status: 'pending', photos: [], items: [], observations: '', updatedAt: null };
  }
  return week.submissions[schoolId];
}
