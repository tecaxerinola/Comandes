// Lectura de les fotos dels fulls de comanda escrits a mà, amb Claude (visió).
import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5-5';

let client = null;
export function ocrAvailable() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}
function getClient() {
  if (!client) client = new Anthropic();
  return client;
}

function buildSystemPrompt(providers) {
  const catalog = providers
    .map((p) => {
      const aliases = p.aliases?.length ? ` (al full pot aparèixer com: ${p.aliases.join(', ')})` : '';
      return `### provider_id="${p.id}" — ${p.name}${aliases}\n${p.products.map((x) => `- ${x}`).join('\n')}`;
    })
    .join('\n\n');

  return `Ets un assistent que transcriu comandes setmanals de cuines escolars. Els cuiners omplen a mà un full imprès (en català) i n'envien fotos per WhatsApp. El full té seccions per proveïdor amb una llista de productes i, per a cada producte, les columnes QUANTITAT i SERVIR DIA.

La teva feina: llegir les fotos i retornar NOMÉS les línies on el cuiner ha escrit alguna cosa (quantitat, data o anotació). Ignora els productes impresos que estan buits.

Regles:
- Assigna cada línia al proveïdor correcte del catàleg (provider_id). Els noms de secció del full poden ser antics (vegeu els àlies). Si dubtes, tria el proveïdor que té aquell producte al catàleg.
- "product": fes servir el nom EXACTE del catàleg d'aquell proveïdor quan coincideixi. Si el cuiner ha ratllat o modificat el producte (p. ex. "ESPAGUETIS" ratllat i escrit "integrals"), o ha afegit un producte a mà que no és al catàleg, escriu el producte tal com l'ha volgut dir el cuiner, en MAJÚSCULES (p. ex. "ESPAGUETIS INTEGRALS"), i posa in_catalog=false.
- "quantity": transcriu la quantitat amb la unitat en MAJÚSCULES i sense abreviatures confuses: "6un." → "6 UNITATS", "7k" → "7 KG", "4cx" → "4 CAIXES", "2 bosses" → "2 BOSSES", "200un" → "200 UNITATS". Si hi ha una correcció (un valor ratllat i un altre escrit), queda't amb el valor final i explica-ho a "note".
- "serve_day": la data o el dia de servei tal com està escrit, normalitzat a "DD/MM" si és una data (p. ex. "09/11"), o el nom del dia en majúscules (p. ex. "DIVENDRES"). Si no hi ha res escrit, cadena buida.
- Si una mateixa data o anotació (p. ex. una fletxa o una clau) afecta diverses línies, aplica-la a totes.
- Anotacions generals que no són d'un producte concret (p. ex. "URGENT PER DIVENDRES" escrit en diagonal a una secció) van a "observations", indicant a quina secció es refereixen. Si clarament afecten una línia concreta, posa-ho també a la "note" d'aquella línia.
- "confidence": "baixa" si la lletra és difícil de llegir o no estàs segur del producte, la quantitat o la data; si no, "alta".
- "school_name": si el full porta escrit el nom de l'escola o cuina, retorna'l; si no, null.
- No t'inventis res. És millor marcar "baixa" que endevinar.

CATÀLEG DE PROVEÏDORS I PRODUCTES:

${catalog}`;
}

function buildSchema(providers) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['school_name', 'week_text', 'items', 'observations'],
    properties: {
      school_name: { type: ['string', 'null'] },
      week_text: { type: ['string', 'null'], description: 'El que hi ha escrit a "SETMANA DEL ... AL ... DEL MES DE ..."' },
      observations: { type: 'string' },
      items: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['provider_id', 'product', 'in_catalog', 'quantity', 'serve_day', 'note', 'confidence'],
          properties: {
            provider_id: { type: 'string', enum: providers.map((p) => p.id) },
            product: { type: 'string' },
            in_catalog: { type: 'boolean' },
            quantity: { type: 'string' },
            serve_day: { type: 'string' },
            note: { type: 'string' },
            confidence: { type: 'string', enum: ['alta', 'baixa'] },
          },
        },
      },
    },
  };
}

/**
 * @param {{data: Buffer, mediaType: string}[]} images
 * @param {object[]} providers proveïdors actius
 * @param {{from: string, to: string}} week
 */
export async function readOrderPhotos(images, providers, week) {
  const content = [];
  images.forEach((img, i) => {
    const pdf = img.mediaType === 'application/pdf';
    content.push({ type: 'text', text: `${pdf ? 'Document PDF' : 'Foto'} ${i + 1} de ${images.length}:` });
    content.push({
      type: pdf ? 'document' : 'image',
      source: { type: 'base64', media_type: img.mediaType, data: img.data.toString('base64') },
    });
  });
  content.push({
    type: 'text',
    text: `Totes aquestes fotos (o documents PDF) són d'una mateixa cuina/escola i de la setmana del ${week.from} al ${week.to} (format AAAA-MM-DD). Les fotos poden estar girades. Transcriu la comanda.`,
  });

  const stream = getClient().beta.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    thinking: { type: 'adaptive' },
    output_config: {
      effort: 'high',
      format: { type: 'json_schema', schema: buildSchema(providers) },
    },
    system: [{ type: 'text', text: buildSystemPrompt(providers), cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content }],
  });
  const message = await stream.finalMessage();

  if (message.stop_reason === 'refusal') {
    throw new Error("El servei d'IA no ha pogut processar aquestes fotos. Introdueix la comanda manualment.");
  }
  if (message.stop_reason === 'max_tokens') {
    throw new Error('La resposta ha quedat tallada. Prova de pujar menys fotos de cop.');
  }
  const text = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("No s'ha pogut interpretar la resposta de la lectura automàtica.");
  }
}

/**
 * Detecta cap a on apunta la part de dalt del full a la foto i retorna els graus (sentit horari)
 * que cal girar-la perquè quedi dreta: 0, 90, 180 o 270.
 */
export async function detectRotation(jpegBuffer) {
  const response = await getClient().beta.messages.create({
    model: MODEL,
    max_tokens: 2000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: {
      effort: 'low',
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['top_of_text_points'],
          properties: { top_of_text_points: { type: 'string', enum: ['up', 'right', 'down', 'left'] } },
        },
      },
    },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpegBuffer.toString('base64') } },
        {
          type: 'text',
          text: "Aquesta és la foto d'un full imprès (pot estar girada). Mira el text imprès (els títols i els noms de productes) i digues cap a on apunta la part de DALT de les lletres a la imatge tal com es veu: 'up' si el text es llegeix normal, 'right' si la part de dalt de les lletres apunta a la dreta de la imatge, 'down' si està de cap per avall, 'left' si apunta a l'esquerra.",
        },
      ],
    }],
  });
  if (response.stop_reason === 'refusal') return 0;
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const dir = JSON.parse(text).top_of_text_points;
  // Si la part de dalt apunta a l'esquerra, cal girar 90° en sentit horari, etc.
  return { up: 0, left: 90, down: 180, right: 270 }[dir] ?? 0;
}
