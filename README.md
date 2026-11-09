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
   - ✉️ **Correu**: envia "Comanda setmana X / Bon dia, Adjuntem comanda. Gràcies" amb un **PDF** on, per a cada
     escola, només hi surten els productes demanats (com l'exemple de Coubet). Hi ha un botó per enviar tots els correus de cop.
   - 💬 **WhatsApp**: obre WhatsApp amb el text de la comanda ja escrit (i, al mòbil, un botó per compartir el PDF).
   - 📞 **Trucar** i 🖨️ **Imprimir** (Gros Mercat) amb el PDF.
   Cada proveïdor queda marcat com a "Enviat" amb la data i l'hora.

Si alguna escola no està confirmada, l'app avisa i aquella escola no surt a la comanda.

**Configuració**: afegir escoles/clients i activar-les o inactivar-les; afegir i editar proveïdors (correus, telèfon,
manera d'enviar, llista de productes i "altres noms" que surten al full imprès); canviar el text del correu.

## Posar-la en marxa

Cal [Node.js](https://nodejs.org) 20 o superior.

```bash
npm install
cp .env.example .env     # i omple les claus (vegeu a sota)
npm start                # http://localhost:3000
```

O amb Docker:

```bash
docker build -t comandes .
docker run -d -p 3000:3000 --env-file .env -v comandes-data:/data comandes
```

### Claus que cal configurar (`.env`)

| Variable | Per a què serveix |
|---|---|
| `ANTHROPIC_API_KEY` | Lectura automàtica de les fotos (Claude). Es crea a console.anthropic.com. Sense clau, l'app funciona però les línies s'entren a mà. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | Enviament directe dels correus. Amb Gmail: `smtp.gmail.com`, port `465` i una *contrasenya d'aplicació*. Sense SMTP, el botó obre el programa de correu i descarrega el PDF per adjuntar-lo. |
| `MAIL_FROM`, `MAIL_CC` | Remitent i còpia opcional de tots els correus enviats. |
| `APP_PASSWORD` | Contrasenya per entrar a l'app (molt recomanat si està publicada a internet). |

## Dades

Tot es guarda a la carpeta `data/` (`db.json` + les fotos a `data/uploads/`). Per fer una còpia de seguretat n'hi ha prou
de copiar aquesta carpeta. La primera vegada es carreguen les escoles i els proveïdors (amb tots els productes)
del full `SETMANA46.xlsx`.

### A revisar de la configuració inicial

- **Pescados Videla**: al document de mails hi posava `juan.ruizrupovidela.com` (sense @). S'ha posat
  `juan.ruiz@rupovidela.com`; comproveu-ho a Configuració.
- **Carns Coubet** substitueix Cusins/Carns Roura, **Fruits Semcal** substitueix Vigafruit, **Pescados Videla**
  agafa la secció "Del Moral / Congelat" i **Riera** inclou els productes de Masó i Riera A/B, tal com al full de la setmana 46.
  Si algun no és correcte, es pot canviar a Configuració → Proveïdors.
- Escoles actives: Àgora, Dalmau, Aixart, Llers, Cuina Central, Taialà, Vilafant, Lladó i Cassià Costal.
  Vilademany, Esculapi, Escola Pau, Sol i Vent i Avinyonet estan creades però inactives.

## Estructura del codi

- `server.js` — servidor web (Express) i API.
- `lib/ocr.js` — lectura de les fotos amb Claude (visió + sortida JSON estructurada).
- `lib/orders.js` — agrupació per proveïdor, PDF i text de WhatsApp.
- `lib/mail.js` — enviament per SMTP.
- `lib/db.js` — dades en un fitxer JSON; `lib/seed-data.json` — catàleg inicial.
- `public/` — la interfície web (HTML/CSS/JS sense compilació).
