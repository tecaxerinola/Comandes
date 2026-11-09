// Arrencada en local / servidor propi:  npm start
import app, { ready } from './lib/app.js';
import { usingSupabaseStorage } from './lib/storage.js';
import { ocrAvailable } from './lib/ocr.js';
import { mailAvailable } from './lib/mail.js';

await ready();
const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => {
  console.log(`Comandes en marxa a http://localhost:${PORT}`);
  console.log('  Base de dades:         connectada');
  console.log(`  Fotos:                 ${usingSupabaseStorage() ? 'Supabase Storage' : 'carpeta local (SUPABASE_URL no configurat)'}`);
  console.log(`  Lectura de fotos (IA): ${ocrAvailable() ? 'activada' : 'NO configurada (ANTHROPIC_API_KEY)'}`);
  console.log(`  Enviament de correu:   ${mailAvailable() ? 'activat' : 'NO configurat (SMTP_*)'}`);
  console.log(`  Contrasenya d'accés:   ${process.env.APP_PASSWORD ? 'sí' : 'no (APP_PASSWORD buit)'}`);
});
