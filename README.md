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

## Posar-la en marxa

Cal [Node.js](https://nodejs.org) 20 o superior i un projecte de [Supabase](https://supabase.com).

```bash
npm install
cp .env.example .env     # i omple les claus (vegeu a sota)
npm start                # http://localhost:3000
```

O amb Docker:

```bash
docker build -t comandes .
docker run -d -p 3000:3000 --env-file .env comandes
```

En arrencar, l'app crea sola les taules a Supabase (fitxer `supabase/migrations/001_init.sql`), el bucket privat
de fotos i, la primera vegada, carrega les escoles i els proveïdors amb tots els productes del full `SETMANA46.xlsx`.

### Claus que cal configurar (`.env`)

| Variable | D'on surt / per a què serveix |
|---|---|
| `DATABASE_URL` | Supabase → botó **Connect** → *Session pooler* (URI), amb la contrasenya de la base de dades. |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase → *Project Settings* → *API*. Serveix per guardar les fotos a Storage. **La service role key és secreta**: només va al servidor. |
| `ANTHROPIC_API_KEY` | Lectura automàtica de les fotos (Claude). Es crea a console.anthropic.com. Sense clau, les línies s'entren a mà. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | Compte de correu **jordi@tecaxerinola.com**, que és des d'on surten tots els correus. Amb Google Workspace: `smtp.gmail.com`, port `465` i una *contrasenya d'aplicació*. |
| `MAIL_CC` | (Opcional) Còpia de tots els correus enviats. |
| `APP_PASSWORD` | Contrasenya per entrar a l'app. |

Els correus s'envien directament des de l'app (no s'obre cap programa de correu). El remitent es pot canviar
a Configuració → Correu als proveïdors (per defecte `jordi@tecaxerinola.com`).

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

- `server.js` — servidor web (Express) i API.
- `lib/ocr.js` — lectura de les fotos amb Claude (visió + sortida JSON estructurada).
- `lib/orders.js` — agrupació per proveïdor, PDF i text de WhatsApp.
- `lib/mail.js` — enviament per SMTP.
- `lib/db.js` — accés a la base de dades de Supabase (Postgres); `lib/storage.js` — fotos a Supabase Storage.
- `supabase/migrations/001_init.sql` — esquema de la base de dades; `lib/seed-data.json` — catàleg inicial.
- `public/` — la interfície web (HTML/CSS/JS sense compilació).
