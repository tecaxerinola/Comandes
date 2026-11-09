# Comandes als proveïdors

Aplicació web per passar les comandes que els cuiners de cada escola envien en foto per WhatsApp
a les comandes que s'envien a cada proveïdor (per correu, WhatsApp, telèfon o imprès).

## Com funciona (cada setmana)

1. **Escoles** — Arrossega les fotos de WhatsApp a la targeta de cada escola (o clica-hi per triar-les;
   també es poden enganxar amb Ctrl+V). L'app llegeix el full escrit a mà i detecta, per a cada proveïdor,
   quins productes s'han demanat, la quantitat i el dia de servei.
2. **Revisar i validar** — Al costat de la foto hi ha la llista de línies agrupades per proveïdor.
   Es poden corregir, afegir, esborrar o moure a un altre proveïdor. Les línies dubtoses surten en **groc**
   i les correccions que ha fet el cuiner (productes ratllats, etc.) porten una nota ℹ️.
   Quan està bé, **Confirmar comanda** (passa automàticament a la següent escola per revisar).
3. **Enviar** — Per a cada proveïdor es veu quines escoles hi tenen comanda i un botó per enviar-la:
   - ✉️ **Correu**: envia directament des de `jordi@tecaxerinola.com` "Comanda setmana X / Bon dia, Adjuntem comanda. Gràcies" amb un **PDF** on, per a cada
     escola, només hi surten els productes demanats (com l'exemple de Coubet). Hi ha un botó per enviar tots els correus de cop.
   - 💬 **WhatsApp**: obre WhatsApp amb el text de la comanda ja escrit (i, al mòbil, un botó per compartir el PDF).
   - 📞 **Trucar** i 🖨️ **Imprimir** (Gros Mercat) amb el PDF.
   Cada proveïdor queda marcat com a "Enviat" amb la data i l'hora.

Si alguna escola no està confirmada, l'app avisa i aquella escola no surt a la comanda.

**Configuració**: afegir escoles/clients i activar-les o inactivar-les; afegir i editar proveïdors (correus, telèfon,
manera d'enviar, productes i "altres noms" que surten al full imprès); remitent i text del correu.

## Publicar-la a Vercel (amb Supabase)

L'app està preparada per a Vercel: la pàgina (`public/`) es publica com a web estàtica i tota l'API va en una
sola funció (`api/index.js`, configurada a `vercel.json`). Les dades i les fotos van a Supabase.

1. **Supabase**: no cal crear res a mà. La primera vegada que s'obre l'app, es creen les taules
   (`supabase/migrations/001_init.sql`), el bucket privat de fotos i es carreguen les escoles i els proveïdors
   amb tots els productes. Només cal tenir les claus del projecte:
   - Botó **Connect** → **Transaction pooler** → copia la cadena URI (port `6543`) i posa-hi la contrasenya de la base de dades → `DATABASE_URL`.
   - **Project Settings → API** → *Project URL* → `SUPABASE_URL` i la clau **service_role** → `SUPABASE_SERVICE_ROLE_KEY` (secreta).
2. **Vercel**: *Add New → Project* → importa el repositori de GitHub. No cal canviar res de la configuració
   (ja ve a `vercel.json`: sense build i amb la carpeta `public`).
3. A **Settings → Environment Variables** afegeix:

   | Variable | Valor |
   |---|---|
   | `DATABASE_URL` | Cadena del *Transaction pooler* de Supabase |
   | `SUPABASE_URL` | URL del projecte de Supabase |
   | `SUPABASE_SERVICE_ROLE_KEY` | Clau *service_role* de Supabase |
   | `APP_PASSWORD` | Contrasenya per entrar a l'app (**obligatòria**, l'app és a internet) |
   | `ANTHROPIC_API_KEY` | Clau de console.anthropic.com per llegir les fotos |
   | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | Compte de correu `jordi@tecaxerinola.com` (Google Workspace: `smtp.gmail.com`, `465` i una *contrasenya d'aplicació*) |
   | `MAIL_CC` | (Opcional) còpia de tots els correus enviats |

4. **Deploy**. Obre l'adreça que dona Vercel, entra amb la contrasenya i ja està.

Notes:
- La lectura d'una foto pot trigar fins a un minut o dos: la funció té un límit de 300 s (`maxDuration` a `vercel.json`).
  Si el pla de Vercel no ho permet, baixa aquest valor a `60`.
- Les fotos es pugen d'una en una (Vercel limita cada petició a uns 4,5 MB) i es redueixen al navegador abans de pujar-les.
- Vercel publica la branca principal del repositori. Si aquests canvis són en una altra branca, cal fusionar-la abans.

## En local (opcional)

Cal [Node.js](https://nodejs.org) 22 i les mateixes variables en un fitxer `.env` (vegeu `.env.example`):

```bash
npm install
npm start                # http://localhost:3000
```

## Històric

La pestanya **📅 Històric** mostra totes les comandes agrupades per **any → mes → setmana**, amb el nombre d'escoles,
línies, proveïdors i comandes enviades. Es pot filtrar per escola i per proveïdor; obrint una setmana es veu què es va
demanar a cada proveïdor (amb el PDF) i el botó *Obrir setmana* hi porta per consultar-la o modificar-la.
(Una setmana compta al mes del seu dijous, com la numeració oficial de setmanes.)

## Productes

Cada proveïdor té la seva llista de productes (Configuració → clica el proveïdor → *Productes*). Es poden afegir
d'un en un o enganxant una llista (un per línia), cercar i treure. Si a la revisió d'una comanda surt un producte
que no és al catàleg, hi ha un botó per afegir-lo directament als productes d'aquell proveïdor.
La llista de productes ajuda la lectura automàtica a reconèixer el que escriuen els cuiners.

## Dades (Supabase)

- Taules: `schools`, `providers`, `products`, `submissions` (comanda de cada escola i setmana), `submission_items`,
  `photos`, `sent_orders` i `settings`. Tenen RLS activat sense polítiques: només el servidor de l'app hi accedeix.
- Fotos: bucket privat `comandes-fotos`, organitzades per `setmana/escola/`.

### A revisar de la configuració inicial

- **Pescados Videla**: al document de mails hi posava `juan.ruizrupovidela.com` (sense @). S'ha posat
  `juan.ruiz@rupovidela.com`; comproveu-ho a Configuració.
- **Carns Coubet** substitueix Cusins/Carns Roura, **Fruits Semcal** substitueix Vigafruit, **Pescados Videla**
  agafa la secció "Del Moral / Congelat" i **Riera** inclou els productes de Masó i Riera A/B.
- Escoles actives: Àgora, Dalmau, Aixart, Llers, Cuina Central, Taialà, Vilafant, Lladó i Cassià Costal.
  Vilademany, Esculapi, Escola Pau, Sol i Vent i Avinyonet estan creades però inactives.

## Estructura del codi

- `lib/app.js` — API i servidor web (Express). `api/index.js` l'exposa a Vercel i `server.js` l'arrenca en local.
- `vercel.json` — configuració de Vercel.
- `lib/ocr.js` — lectura de les fotos amb Claude (visió + sortida JSON estructurada).
- `lib/orders.js` — agrupació per proveïdor, PDF i text de WhatsApp.
- `lib/mail.js` — enviament per SMTP.
- `lib/db.js` — accés a la base de dades de Supabase (Postgres); `lib/storage.js` — fotos a Supabase Storage.
- `supabase/migrations/001_init.sql` — esquema de la base de dades; `lib/seed-data.json` — catàleg inicial.
- `public/` — la interfície web (HTML/CSS/JS sense compilació).
