// Preparació de les fotos: sempre dretes i en JPEG d'una mida raonable.
import sharp from 'sharp';
import { detectRotation, ocrAvailable } from './ocr.js';

const MAX_SIDE = 2200;

/** Aplica l'orientació EXIF del mòbil, redueix la mida i converteix a JPEG. */
async function normalize(buffer) {
  return sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();
}

export async function rotateJpeg(buffer, degrees) {
  if (!degrees) return buffer;
  return sharp(buffer).rotate(degrees).jpeg({ quality: 85, mozjpeg: true }).toBuffer();
}

/**
 * Deixa la foto dreta: primer segons l'EXIF i després mirant el contingut (el full pot
 * estar fotografiat de costat o de cap per avall). Retorna { buffer, rotated }.
 */
export async function uprightPhoto(buffer) {
  let jpeg = await normalize(buffer);
  let rotated = 0;
  if (ocrAvailable()) {
    try {
      const small = await sharp(jpeg).resize({ width: 1000, height: 1000, fit: 'inside' }).jpeg({ quality: 75 }).toBuffer();
      rotated = await detectRotation(small);
      jpeg = await rotateJpeg(jpeg, rotated);
    } catch (e) {
      console.error("No s'ha pogut detectar l'orientació:", e.message);
    }
  }
  return { buffer: jpeg, rotated };
}
