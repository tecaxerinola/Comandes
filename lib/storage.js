// Fotos a Supabase Storage (bucket privat). Sense Supabase configurat (proves en local),
// es guarden a la carpeta data/uploads.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUCKET = process.env.SUPABASE_BUCKET || 'comandes-fotos';
const LOCAL_DIR = path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'uploads');

let supabase = null;
export const usingSupabaseStorage = () => Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

export async function initStorage() {
  if (!usingSupabaseStorage()) {
    await fs.mkdir(LOCAL_DIR, { recursive: true });
    return;
  }
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await supabase.storage.getBucket(BUCKET);
  if (error) {
    const { error: e2 } = await supabase.storage.createBucket(BUCKET, { public: false });
    if (e2 && !/already exists/i.test(e2.message)) throw new Error(`No s'ha pogut crear el bucket "${BUCKET}": ${e2.message}`);
  }
}

export async function putFile(key, buffer, contentType) {
  if (!supabase) {
    const file = path.join(LOCAL_DIR, key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, buffer);
    return;
  }
  const { error } = await supabase.storage.from(BUCKET).upload(key, buffer, { contentType, upsert: true });
  if (error) throw new Error(`Error pujant la foto: ${error.message}`);
}

export async function getFile(key) {
  if (!supabase) return fs.readFile(path.join(LOCAL_DIR, key));
  const { data, error } = await supabase.storage.from(BUCKET).download(key);
  if (error) throw Object.assign(new Error('Foto no trobada'), { status: 404 });
  return Buffer.from(await data.arrayBuffer());
}

export async function removeFile(key) {
  if (!supabase) return fs.rm(path.join(LOCAL_DIR, key), { force: true });
  await supabase.storage.from(BUCKET).remove([key]);
}
