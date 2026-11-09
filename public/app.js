// ===================== Utilitats =====================
const $ = (sel, root = document) => root.querySelector(sel);
const app = $('#app');

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value') el.value = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

async function api(url, opts = {}) {
  const init = { ...opts };
  if (opts.json !== undefined) {
    init.method = init.method || 'POST';
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(opts.json);
  }
  const res = await fetch(url, init);
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) throw new Error(data?.error || `Error ${res.status}`);
  return data;
}

let toastTimer;
function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = 'toast'), isError ? 6000 : 2800);
}

function dialog(title, body, buttons) {
  const d = $('#dialog');
  return new Promise((resolve) => {
    d.replaceChildren(
      h('h2', {}, title),
      h('div', { style: 'margin-top:10px' }, body),
      h('div', { class: 'actions' }, buttons.map((b) =>
        h('button', { class: 'btn ' + (b.class || ''), onclick: () => { d.close(); resolve(b.value); } }, b.label))),
    );
    d.onclose = () => resolve(undefined);
    d.showModal();
  });
}
const confirmBox = (title, text, ok = 'D\'acord') =>
  dialog(title, h('p', {}, text), [{ label: 'Cancel·la', value: false }, { label: ok, value: true, class: 'primary' }]);

const fmtDate = (iso) => iso.split('-').reverse().join('/');
const fmtDateTime = (iso) => new Date(iso).toLocaleString('ca-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const STATUS = {
  pending: ['pending', 'Pendent'],
  review: ['review', 'Per revisar'],
  confirmed: ['confirmed', 'Confirmada ✓'],
};
function statusBadge(sub) {
  if (sub?.reading) return h('span', { class: 'badge reading' }, h('span', { class: 'spin' }), 'Llegint fotos…');
  const [cls, label] = STATUS[sub?.status || 'pending'];
  return h('span', { class: 'badge ' + cls }, label);
}

// ===================== Estat =====================
const state = { config: null, weekId: null, data: null, tab: 'escoles', schoolId: null };
let pollTimer = null;

function isoWeekId(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
function shiftWeek(id, delta) {
  const [y, w] = id.split('-W').map(Number);
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - (jan4.getUTCDay() || 7) + 1 + (w - 1 + delta) * 7);
  return isoWeekId(monday);
}

async function loadState() {
  state.data = await api(`/api/state?week=${state.weekId}`);
  const w = state.data.week;
  $('#weekLabel').replaceChildren(`Setmana ${w.week}`, h('small', {}, `del ${fmtDate(w.from)} al ${fmtDate(w.to)}`));
  schedulePoll();
}

function schedulePoll() {
  clearTimeout(pollTimer);
  const reading = Object.values(state.data.week.submissions).some((s) => s.reading);
  if (reading) {
    pollTimer = setTimeout(async () => {
      const before = JSON.stringify(state.data.week.submissions);
      await loadState().catch(() => {});
      if (JSON.stringify(state.data.week.submissions) !== before && !editing()) render();
    }, 3000);
  }
}
// No re-renderitzar mentre l'usuari escriu en una línia
const editing = () => state.tab === 'escola' && document.activeElement?.closest?.('table.items, textarea');

const sub = (schoolId) => state.data.week.submissions[schoolId];
const provider = (id) => state.data.providers.find((p) => p.id === id);
const activeSchools = () => state.data.schools.filter((s) => s.active);

// ===================== Router =====================
function parseHash() {
  const [tab, id] = location.hash.replace('#', '').split('/');
  state.tab = ['escoles', 'escola', 'enviar', 'config'].includes(tab) ? tab : 'escoles';
  state.schoolId = id || null;
}
window.addEventListener('hashchange', () => { parseHash(); render(); });

function render() {
  document.querySelectorAll('.tabs a').forEach((a) =>
    a.classList.toggle('active', a.dataset.tab === state.tab || (state.tab === 'escola' && a.dataset.tab === 'escoles')));
  if (state.tab === 'escola' && state.schoolId) return renderSchool();
  if (state.tab === 'enviar') return renderSend();
  if (state.tab === 'config') return renderConfig();
  return renderSchools();
}

// ===================== Pujada de fotos =====================
async function resizeImage(file) {
  // Redueix les fotos grans al navegador (pujada més ràpida i dins dels límits de la IA)
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const max = 2400;
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 3.5e6 && /jpe?g|png|webp/.test(file.type)) return file;
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.88));
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

async function uploadPhotos(schoolId, files) {
  files = [...files].filter((f) => f.type.startsWith('image/'));
  if (!files.length) return toast('Només es poden pujar imatges', true);
  const school = state.data.schools.find((s) => s.id === schoolId);
  toast(`Pujant ${files.length} foto${files.length > 1 ? 's' : ''} de ${school.name}…`);
  const fd = new FormData();
  for (const f of await Promise.all(files.map(resizeImage))) fd.append('photos', f, f.name);
  try {
    const res = await fetch(`/api/weeks/${state.weekId}/schools/${schoolId}/photos`, { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    state.data.week.submissions[schoolId] = data;
    toast(state.config.ocr ? `Fotos pujades. Llegint la comanda de ${school.name}…` : 'Fotos pujades');
    render();
    schedulePoll();
  } catch (e) {
    toast(e.message, true);
  }
}

function pickFiles(schoolId) {
  const input = h('input', { type: 'file', accept: 'image/*', multiple: true });
  input.onchange = () => uploadPhotos(schoolId, input.files);
  input.click();
}

async function askSchoolAndUpload(files) {
  const schools = activeSchools();
  const choice = await dialog('De quina escola són aquestes fotos?',
    h('p', { class: 'muted' }, `${files.length} foto(s)`),
    [...schools.map((s) => ({ label: s.name, value: s.id })), { label: 'Cancel·la', value: null, class: 'ghost' }]);
  if (choice) uploadPhotos(choice, files);
}

// Arrossegar fotos a qualquna part de la pàgina
let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  if (![...e.dataTransfer.types].includes('Files')) return;
  dragDepth++;
  $('#dropOverlay').classList.add('show');
});
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#dropOverlay').classList.remove('show'); } });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  $('#dropOverlay').classList.remove('show');
  if (e.defaultPrevented && e._handled) return;
  const files = e.dataTransfer?.files;
  if (!files?.length || e._handled) return;
  if (state.tab === 'escola' && state.schoolId) uploadPhotos(state.schoolId, files);
  else askSchoolAndUpload(files);
});
// Enganxar (Ctrl+V) una imatge
window.addEventListener('paste', (e) => {
  const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
  if (!files.length) return;
  if (state.tab === 'escola' && state.schoolId) uploadPhotos(state.schoolId, files);
  else askSchoolAndUpload(files);
});

// ===================== Vista 1: Escoles =====================
function renderSchools() {
  const schools = activeSchools();
  const confirmed = schools.filter((s) => sub(s.id)?.status === 'confirmed').length;
  const pct = schools.length ? Math.round((confirmed / schools.length) * 100) : 0;

  const cards = schools.map((school) => {
    const s = sub(school.id);
    const photos = s?.photos || [];
    const lines = s?.items?.length || 0;
    const low = s?.items?.filter((i) => i.confidence === 'baixa').length || 0;
    const card = h('div', { class: 'card school-card' },
      h('div', { class: 'head' }, h('h2', {}, school.name), statusBadge(s)),
      h('div', { class: 'meta' },
        `${photos.length} foto${photos.length === 1 ? '' : 's'} · ${lines} ${lines === 1 ? 'línia' : 'línies'}`,
        low ? h('span', { class: 'tag warn' }, `${low} a revisar`) : null,
        s?.readError ? h('span', { class: 'tag warn' }, 'error de lectura') : null),
      photos.length ? h('div', { class: 'thumbs' }, photos.slice(0, 6).map((p) => h('img', { src: '/uploads/' + p.file, alt: '' }))) : null,
      h('div', { class: 'dropzone', onclick: () => pickFiles(school.id) }, '📷 Arrossega o clica per pujar fotos'),
      h('div', { class: 'card-actions' },
        h('a', { class: 'btn ' + (s?.status === 'review' ? 'primary' : ''), href: `#escola/${school.id}` },
          s?.status === 'confirmed' ? 'Veure / editar' : 'Revisar i validar')),
    );
    card.addEventListener('dragover', (e) => { e.preventDefault(); card.classList.add('drag'); });
    card.addEventListener('dragleave', () => card.classList.remove('drag'));
    card.addEventListener('drop', (e) => {
      e.preventDefault();
      e._handled = true;
      card.classList.remove('drag');
      uploadPhotos(school.id, e.dataTransfer.files);
    });
    return card;
  });

  app.replaceChildren(
    h('h1', {}, 'Comandes rebudes'),
    h('p', { class: 'sub' }, 'Arrossega les fotos de WhatsApp a la targeta de cada escola. La comanda es llegeix sola; després revisa-la i confirma-la.'),
    !state.config.ocr ? h('div', { class: 'alert warn' }, 'La lectura automàtica de fotos no està configurada (falta la clau ANTHROPIC_API_KEY). Pots pujar les fotos i entrar les línies a mà.') : null,
    h('div', { class: 'progress-wrap' },
      h('strong', {}, `${confirmed} de ${schools.length} escoles confirmades`),
      h('div', { class: 'progress' }, h('div', { style: `width:${pct}%` })),
      h('a', { class: 'btn ' + (confirmed === schools.length && schools.length ? 'green' : ''), href: '#enviar' }, 'Anar a enviar →')),
    h('div', { class: 'grid' }, cards),
  );
}

// ===================== Vista 1b: Revisió d'una escola =====================
let saveTimer = null;
let photoIdx = 0;
let rotation = {};

function renderSchool() {
  const school = state.data.schools.find((s) => s.id === state.schoolId);
  if (!school) { location.hash = '#escoles'; return; }
  const s = sub(school.id) || { status: 'pending', photos: [], items: [], observations: '' };
  state.data.week.submissions[school.id] = s;
  const providers = state.data.providers;
  const activeProviders = providers.filter((p) => p.active);

  // ----- Visor de fotos -----
  if (photoIdx >= s.photos.length) photoIdx = 0;
  const cur = s.photos[photoIdx];
  const stage = h('div', { class: 'stage' },
    cur ? h('img', {
      src: '/uploads/' + cur.file,
      style: `transform: rotate(${rotation[cur.id] || 0}deg)`,
      onclick: () => stage.classList.toggle('zoom'),
    }) : h('div', { class: 'empty-photo' }, 'Encara no hi ha fotos.', h('br'), 'Arrossega-les aquí o clica "Afegir fotos".'));
  const viewer = h('div', { class: 'viewer' },
    stage,
    h('div', { class: 'tools' },
      h('div', { class: 'thumbs' }, s.photos.map((p, i) =>
        h('img', { src: '/uploads/' + p.file, class: i === photoIdx ? 'sel' : '', onclick: () => { photoIdx = i; renderSchool(); } }))),
      h('span', { style: 'flex:1' }),
      cur ? h('button', { class: 'btn small', title: 'Girar', onclick: () => { rotation[cur.id] = ((rotation[cur.id] || 0) + 90) % 360; renderSchool(); } }, '⟳ Girar') : null,
      cur ? h('button', { class: 'btn small danger', onclick: async () => {
        if (!(await confirmBox('Esborrar foto', 'Segur que vols esborrar aquesta foto? Les línies ja llegides es mantenen.', 'Esborrar'))) return;
        state.data.week.submissions[school.id] = await api(`/api/weeks/${state.weekId}/schools/${school.id}/photos/${cur.id}`, { method: 'DELETE' });
        renderSchool();
      } }, 'Esborrar') : null,
      h('button', { class: 'btn small', onclick: () => pickFiles(school.id) }, '📷 Afegir fotos'),
    ),
  );

  // ----- Avisos -----
  const low = s.items.filter((i) => i.confidence === 'baixa').length;
  const outCat = s.items.filter((i) => i.inCatalog === false).length;
  const alerts = [
    s.reading ? h('div', { class: 'alert info' }, h('span', { class: 'spin' }), ' Llegint les fotos… (pot trigar un minut). Pots anar fent altres escoles.') : null,
    s.readError ? h('div', { class: 'alert error' }, '⚠️ ', s.readError) : null,
    s.detectedSchool && !norm(s.detectedSchool).includes(norm(school.name)) && !norm(school.name).includes(norm(s.detectedSchool))
      ? h('div', { class: 'alert warn' }, `⚠️ Al full hi posa "${s.detectedSchool}". Comprova que les fotos són de ${school.name}.`) : null,
    s.weekText ? h('div', { class: 'alert info' }, `Setmana escrita al full: "${s.weekText}"`) : null,
    low ? h('div', { class: 'alert warn' }, `🟡 ${low} línia${low > 1 ? 'es' : ''} marcada${low > 1 ? 'es' : ''} en groc: la lectura no és segura, comprova-les amb la foto.`) : null,
    outCat ? h('div', { class: 'alert warn' }, `${outCat} producte${outCat > 1 ? 's' : ''} no és al catàleg (escrit a mà o modificat pel cuiner). Revisa el nom.`) : null,
    s.status === 'confirmed' ? h('div', { class: 'alert ok' }, '✓ Comanda confirmada. Si la modifiques es manté confirmada.') : null,
  ];

  // ----- Línies agrupades per proveïdor -----
  const saveState = h('span', { class: 'save-state' }, s.updatedAt ? `Desat ${fmtDateTime(s.updatedAt)}` : '');
  const persist = (status) => {
    clearTimeout(saveTimer);
    saveState.textContent = 'Desant…';
    return api(`/api/weeks/${state.weekId}/schools/${school.id}`, {
      method: 'PUT', json: { items: s.items, observations: s.observations, status },
    }).then((d) => {
      Object.assign(s, { status: d.status, updatedAt: d.updatedAt });
      saveState.textContent = `Desat ${fmtDateTime(d.updatedAt)}`;
      return d;
    }).catch((e) => { saveState.textContent = 'No desat!'; toast(e.message, true); throw e; });
  };
  const autosave = () => { clearTimeout(saveTimer); saveState.textContent = 'Canvis sense desar…'; saveTimer = setTimeout(() => persist(), 800); };

  const byProv = new Map();
  for (const it of s.items) {
    const key = provider(it.providerId) ? it.providerId : '';
    if (!byProv.has(key)) byProv.set(key, []);
    byProv.get(key).push(it);
  }
  const orderedKeys = [...providers.map((p) => p.id).filter((id) => byProv.has(id)), ...(byProv.has('') ? [''] : [])];

  const rowFor = (it) => {
    const p = provider(it.providerId);
    const listId = 'dl-' + (p?.id || 'none');
    const inp = (field, attrs = {}) => h('input', {
      type: 'text', value: it[field] || '', ...attrs,
      oninput: (e) => { it[field] = e.target.value; if (field === 'product') it.inCatalog = !!p?.products.includes(e.target.value.trim()); autosave(); },
    });
    const tr = h('tr', { class: it.confidence === 'baixa' ? 'low' : '', 'data-id': it.id },
      h('td', { class: 'col-prod' }, inp('product', { list: listId, placeholder: 'Producte' }),
        it.aiNote ? h('div', { class: 'ainote' }, 'ℹ️ ', it.aiNote) : null),
      h('td', { class: 'col-qty' }, inp('quantity', { placeholder: 'Quantitat' })),
      h('td', { class: 'col-day' }, inp('day', { placeholder: 'dd/mm' })),
      h('td', { class: 'col-note' }, inp('note', { placeholder: 'Nota pel proveïdor' })),
      h('td', { class: 'col-x' },
        h('div', { class: 'row', style: 'gap:2px;flex-wrap:nowrap' },
          it.confidence === 'baixa' ? h('button', { class: 'btn small ghost', title: 'Marcar com a revisada', onclick: () => { it.confidence = 'alta'; autosave(); renderSchool(); } }, '✓') : null,
          h('button', { class: 'btn small ghost danger', title: 'Esborrar línia', onclick: () => { s.items = s.items.filter((x) => x !== it); autosave(); renderSchool(); } }, '✕'))),
    );
    return tr;
  };

  const sections = orderedKeys.map((key) => {
    const p = provider(key);
    const items = byProv.get(key);
    return h('div', { class: 'card prov-section' },
      h('div', { class: 'ph' },
        h('h2', {}, p ? p.name : 'Sense proveïdor', h('span', { class: 'tag' }, items.length)),
        h('div', { class: 'row' },
          h('select', { class: 'input', title: 'Moure línies a un altre proveïdor', onchange: (e) => {
            if (!e.target.value) return;
            items.forEach((i) => { i.providerId = e.target.value; });
            autosave(); renderSchool();
          } }, h('option', { value: '' }, 'Moure a…'), activeProviders.filter((x) => x.id !== key).map((x) => h('option', { value: x.id }, x.name))),
          h('button', { class: 'btn small', onclick: () => addLine(key) }, '+ Línia'))),
      h('table', { class: 'items' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Producte'), h('th', {}, 'Quantitat'), h('th', {}, 'Servir dia'), h('th', { class: 'col-note' }, 'Nota'), h('th'))),
        h('tbody', {}, items.map(rowFor))));
  });

  const addLine = (providerId) => {
    const id = crypto.randomUUID();
    s.items.push({ id, providerId, product: '', quantity: '', day: '', note: '', confidence: 'alta', inCatalog: true, source: 'manual' });
    autosave();
    renderSchool();
    app.querySelector(`tr[data-id="${id}"] input`)?.focus();
  };


  const addSelect = h('select', { class: 'input' }, h('option', { value: '' }, 'Afegir línia a…'), activeProviders.map((p) => h('option', { value: p.id }, p.name)));
  addSelect.onchange = () => addSelect.value && addLine(addSelect.value);

  const datalists = providers.map((p) => h('datalist', { id: 'dl-' + p.id }, p.products.map((x) => h('option', { value: x }))));

  const confirmBtn = s.status === 'confirmed'
    ? h('button', { class: 'btn', onclick: async () => { await persist('review'); renderSchool(); } }, 'Desconfirmar')
    : h('button', { class: 'btn green', disabled: s.reading, onclick: async () => {
      const lowNow = s.items.filter((i) => i.confidence === 'baixa').length;
      if (lowNow && !(await confirmBox('Hi ha línies en groc', `Encara hi ha ${lowNow} línia(es) marcades com a dubtoses. Vols confirmar igualment?`, 'Confirmar'))) return;
      await persist('confirmed');
      toast(`${school.name} confirmada ✓`);
      const next = activeSchools().find((x) => x.id !== school.id && sub(x.id)?.status === 'review');
      location.hash = next ? `#escola/${next.id}` : '#escoles';
    } }, '✓ Confirmar comanda');

  const schoolsNav = activeSchools();
  const idx = schoolsNav.findIndex((x) => x.id === school.id);

  app.replaceChildren(
    h('div', { class: 'row mb' },
      h('a', { class: 'btn', href: '#escoles' }, '← Escoles'),
      h('h1', { style: 'margin:0' }, school.name),
      statusBadge(s),
      h('span', { style: 'flex:1' }),
      idx > 0 ? h('a', { class: 'btn small', href: `#escola/${schoolsNav[idx - 1].id}` }, '‹ ' + schoolsNav[idx - 1].name) : null,
      idx < schoolsNav.length - 1 ? h('a', { class: 'btn small', href: `#escola/${schoolsNav[idx + 1].id}` }, schoolsNav[idx + 1].name + ' ›') : null),
    h('div', { class: 'review-layout' },
      viewer,
      h('div', {},
        alerts,
        sections.length ? sections : h('div', { class: 'card mb muted' }, s.reading ? 'Esperant la lectura…' : 'Cap línia encara. Puja fotos o afegeix línies a mà.'),
        h('div', { class: 'row mb' },
          addSelect,
          state.config.ocr && s.photos.length ? h('button', { class: 'btn', disabled: s.reading, onclick: async () => {
            if (s.items.some((i) => i.source === 'ia') && !(await confirmBox('Tornar a llegir', 'Es substituiran les línies llegides automàticament (les afegides a mà es mantenen). Continuar?', 'Tornar a llegir'))) return;
            state.data.week.submissions[school.id] = await api(`/api/weeks/${state.weekId}/schools/${school.id}/read`, { method: 'POST' });
            await loadState(); renderSchool();
          } }, '🔄 Tornar a llegir les fotos') : null),
        h('div', { class: 'card mb' },
          h('label', { class: 'f', style: 'margin-top:0' }, 'Observacions (internes)'),
          h('textarea', { rows: 3, value: s.observations || '', oninput: (e) => { s.observations = e.target.value; autosave(); } })),
        h('div', { class: 'sticky-actions' }, saveState,
          h('button', { class: 'btn', onclick: () => persist() }, 'Desar'),
          confirmBtn)),
    ),
    datalists,
  );
}
const norm = (x) => (x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// ===================== Vista 2: Enviar =====================
async function renderSend() {
  app.replaceChildren(h('p', { class: 'muted' }, 'Carregant…'));
  const data = await api(`/api/weeks/${state.weekId}/orders`);
  const { orders, notConfirmed, subject } = data;

  const doSendMail = async (o, btn) => {
    if (!(await confirmBox('Enviar correu', `S'enviarà "${subject}" a ${o.provider.emails.join(', ')} amb el PDF de ${o.confirmedSchools} escola(es).`, 'Enviar'))) return false;
    btn && (btn.disabled = true, btn.textContent = 'Enviant…');
    try {
      await api(`/api/weeks/${state.weekId}/orders/${o.provider.id}/send-mail`, { method: 'POST' });
      toast(`Correu enviat a ${o.provider.name} ✓`);
      return true;
    } catch (e) {
      toast(e.message, true);
      btn && (btn.disabled = false, btn.textContent = '✉️ Enviar per correu');
      return false;
    }
  };
  const markSent = async (o, via, undo = false) => {
    await api(`/api/weeks/${state.weekId}/orders/${o.provider.id}/mark-sent`, { json: { via, undo } });
    renderSend();
  };
  const pdfUrl = (o, dl) => `/api/weeks/${state.weekId}/orders/${o.provider.id}/pdf${dl ? '?download=1' : ''}`;

  const cards = orders.map((o) => {
    const p = o.provider;
    const ready = o.confirmedSchools > 0;
    const actions = [];
    if (p.emails?.length) {
      if (state.config.mail) {
        const b = h('button', { class: 'btn primary', disabled: !ready, onclick: async () => { if (await doSendMail(o, b)) renderSend(); } }, '✉️ Enviar per correu');
        actions.push(b);
      } else {
        actions.push(h('button', { class: 'btn primary', disabled: !ready, onclick: () => {
          const a = h('a', { href: pdfUrl(o, true), download: '' }); a.click();
          location.href = `mailto:${p.emails.join(',')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(state.data.settings.mailBody)}`;
          toast('S\'ha descarregat el PDF: adjunta\'l al correu');
          markSent(o, 'email');
        } }, '✉️ Obrir correu + PDF'));
      }
    }
    if (p.phone && p.channel !== 'phone') {
      actions.push(h('a', {
        class: 'btn whatsapp' + (ready ? '' : ' disabled'), target: '_blank', rel: 'noopener',
        href: ready ? `https://wa.me/${waPhone(p.phone)}?text=${encodeURIComponent(o.text)}` : undefined,
        onclick: () => ready && markSent(o, 'whatsapp'),
      }, '💬 WhatsApp'));
      if (navigator.canShare) {
        actions.push(h('button', { class: 'btn', disabled: !ready, onclick: async () => {
          const blob = await (await fetch(pdfUrl(o))).blob();
          const file = new File([blob], `${p.name}_${state.data.week.week}.pdf`, { type: 'application/pdf' });
          if (navigator.canShare({ files: [file] })) navigator.share({ files: [file], text: subject }).catch(() => {});
          else toast('Aquest dispositiu no permet compartir fitxers', true);
        } }, '📎 Compartir PDF'));
      }
    }
    if (p.channel === 'phone' && p.phone) actions.push(h('a', { class: 'btn primary', href: `tel:${p.phone}` }, `📞 Trucar ${p.phone}`));
    if (p.channel === 'print') actions.push(h('a', { class: 'btn primary', href: ready ? pdfUrl(o) : undefined, target: '_blank', onclick: () => ready && markSent(o, 'imprès') }, '🖨️ Imprimir'));
    actions.push(h('a', { class: 'btn', href: ready ? pdfUrl(o) : undefined, target: '_blank' }, '📄 Veure PDF'));
    if (p.channel === 'whatsapp' || p.channel === 'phone') {
      actions.push(h('button', { class: 'btn', disabled: !ready, onclick: () => navigator.clipboard.writeText(o.text).then(() => toast('Text copiat')) }, '📋 Copiar text'));
    }
    actions.push(o.sent
      ? h('button', { class: 'btn ghost small', onclick: () => markSent(o, '', true) }, 'Desmarcar enviat')
      : h('button', { class: 'btn ghost small', disabled: !ready, onclick: () => markSent(o, 'manual') }, 'Marcar com enviat'));

    const totalLines = o.schools.reduce((n, s) => n + s.items.length, 0);
    return h('div', { class: 'card order-card' + (o.sent ? ' sent' : '') },
      h('div', { class: 'head' },
        h('h2', {}, p.name),
        o.sent ? h('span', { class: 'badge confirmed' }, `Enviat ${fmtDateTime(o.sent.at)} (${o.sent.via})`) : h('span', { class: 'badge pending' }, 'No enviat')),
      h('div', { class: 'recip' }, channelLabel(p), o.recipients ? ' · ' + o.recipients : '', p.notes ? ` · ${p.notes}` : ''),
      h('div', { class: 'chips' }, o.schools.map((s) => h('span', { class: 'chip' + (s.status === 'confirmed' ? '' : ' pend'), title: s.status === 'confirmed' ? 'Confirmada' : 'Pendent de confirmar' }, `${s.name} (${s.items.length})`))),
      o.pendingSchools.length ? h('div', { class: 'alert warn', style: 'margin:0' }, `Escoles sense confirmar (no s'enviaran): ${o.pendingSchools.join(', ')}`) : null,
      h('details', { class: 'preview' },
        h('summary', { class: 'muted', style: 'cursor:pointer' }, `Veure ${totalLines} ${totalLines === 1 ? 'línia' : 'línies'}`),
        o.schools.map((s) => [
          h('h4', {}, s.name, s.status !== 'confirmed' ? ' (sense confirmar)' : ''),
          h('ul', {}, s.items.map((it) => h('li', {}, h('strong', {}, it.product), `: ${it.quantity || '-'}`, it.day ? ` · servir ${it.day}` : '', it.note ? ` · ${it.note}` : ''))),
        ])),
      h('div', { class: 'order-actions' }, actions),
    );
  });

  const sendable = orders.filter((o) => o.provider.emails?.length && o.confirmedSchools > 0 && !o.sent);
  const bulk = state.config.mail && sendable.length
    ? h('button', { class: 'btn primary', onclick: async () => {
      if (!(await confirmBox('Enviar tots els correus', `S'enviarà el correu a ${sendable.length} proveïdor(s): ${sendable.map((o) => o.provider.name).join(', ')}.`, 'Enviar tots'))) return;
      let ok = 0;
      for (const o of sendable) {
        try { await api(`/api/weeks/${state.weekId}/orders/${o.provider.id}/send-mail`, { method: 'POST' }); ok++; } catch (e) { toast(`${o.provider.name}: ${e.message}`, true); }
      }
      toast(`${ok} correu(s) enviat(s)`);
      renderSend();
    } }, `✉️ Enviar tots els correus pendents (${sendable.length})`)
    : null;

  app.replaceChildren(
    h('div', { class: 'row', style: 'justify-content:space-between' },
      h('div', {}, h('h1', {}, 'Enviar comandes als proveïdors'), h('p', { class: 'sub' }, `Assumpte: "${subject}". Només hi surten els productes demanats, separats per escola.`)),
      bulk),
    notConfirmed.length
      ? h('div', { class: 'alert warn' }, `Falten per confirmar: ${notConfirmed.join(', ')}. Pots enviar igualment, però aquestes escoles no hi sortiran.`)
      : h('div', { class: 'alert ok' }, 'Totes les escoles actives estan confirmades ✓'),
    !state.config.mail ? h('div', { class: 'alert info' }, 'L\'enviament directe de correu no està configurat: el botó obrirà el teu programa de correu i descarregarà el PDF per adjuntar-lo.') : null,
    orders.length ? h('div', { class: 'order-grid' }, cards) : h('div', { class: 'card muted' }, 'Encara no hi ha cap comanda aquesta setmana.'),
  );
}
const waPhone = (phone) => { const d = phone.replace(/\D/g, ''); return d.length === 9 ? '34' + d : d; };
const channelLabel = (p) => ({ email: '✉️ Correu', whatsapp: '💬 WhatsApp', phone: '📞 Trucar', print: '🖨️ Imprimir' }[p.channel] || p.channel);

// ===================== Vista 3: Configuració =====================
function toggle(checked, onchange) {
  return h('label', { class: 'switch', title: checked ? 'Actiu' : 'Inactiu' },
    h('input', { type: 'checkbox', checked, onchange: (e) => onchange(e.target.checked) }), h('span'));
}

function renderConfig() {
  const { schools, providers, settings } = state.data;

  const schoolRows = schools.map((s) => h('div', { class: 'list-row' + (s.active ? '' : ' inactive') },
    h('span', { class: 'name' }, s.name),
    h('button', { class: 'btn small ghost', onclick: async () => {
      const input = h('input', { type: 'text', value: s.name, style: 'width:100%' });
      const ok = await dialog('Canviar el nom', input, [{ label: 'Cancel·la', value: false }, { label: 'Desar', value: true, class: 'primary' }]);
      if (ok && input.value.trim()) { await api(`/api/schools/${s.id}`, { method: 'PATCH', json: { name: input.value } }); await reload(); }
    } }, 'Editar'),
    h('span', { class: 'muted', style: 'font-size:12px;width:56px;text-align:right' }, s.active ? 'Activa' : 'Inactiva'),
    toggle(s.active, async (v) => { await api(`/api/schools/${s.id}`, { method: 'PATCH', json: { active: v } }); await reload(); })));

  const newSchool = h('input', { type: 'text', placeholder: 'Nom de la nova escola / client' });
  const addSchool = async () => {
    try { await api('/api/schools', { json: { name: newSchool.value } }); toast('Escola afegida'); await reload(); } catch (e) { toast(e.message, true); }
  };
  newSchool.onkeydown = (e) => e.key === 'Enter' && addSchool();

  const providerForm = (p) => {
    const f = {
      name: h('input', { type: 'text', value: p?.name || '' }),
      channel: h('select', { class: 'input' }, [['email', 'Correu'], ['whatsapp', 'WhatsApp'], ['phone', 'Trucar'], ['print', 'Imprimir']]
        .map(([v, l]) => h('option', { value: v, selected: (p?.channel || 'email') === v }, l))),
      emails: h('input', { type: 'text', value: (p?.emails || []).join('; '), placeholder: 'correu1@...; correu2@...' }),
      phone: h('input', { type: 'tel', value: p?.phone || '', placeholder: '600000000' }),
      notes: h('input', { type: 'text', value: p?.notes || '' }),
      aliases: h('input', { type: 'text', value: (p?.aliases || []).join('; '), placeholder: 'Noms antics que surten al full imprès' }),
      products: h('textarea', { rows: 8, value: (p?.products || []).join('\n') }),
    };
    const saveBtn = h('button', { class: 'btn primary', onclick: async () => {
      const body = Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value]));
      try {
        if (p) await api(`/api/providers/${p.id}`, { method: 'PATCH', json: body });
        else await api('/api/providers', { json: body });
        toast('Proveïdor desat'); if ($('#dialog').open) $('#dialog').close(); await reload();
      } catch (e) { toast(e.message, true); }
    } }, 'Desar');
    return h('div', {},
      h('div', { class: 'row', style: 'align-items:start' },
        h('label', { class: 'f', style: 'flex:2' }, 'Nom', f.name),
        h('label', { class: 'f', style: 'flex:1' }, "Com s'envia", f.channel)),
      h('label', { class: 'f' }, 'Correus (separats per ;)', f.emails),
      h('label', { class: 'f' }, 'Telèfon / WhatsApp', f.phone),
      h('label', { class: 'f' }, 'Notes (persona de contacte, horaris…)', f.notes),
      h('label', { class: 'f' }, 'Altres noms al full dels cuiners', f.aliases),
      h('label', { class: 'f' }, 'Productes (un per línia) — serveixen per reconèixer el que escriuen els cuiners', f.products),
      h('div', { class: 'row', style: 'margin-top:10px' }, saveBtn));
  };

  const provRows = providers.map((p) => h('details', { class: 'prov' },
    h('summary', {},
      h('span', { class: 'name', style: p.active ? '' : 'color:var(--muted);text-decoration:line-through' }, p.name),
      h('span', { class: 'muted', style: 'font-size:13px' }, `${channelLabel(p)} · ${p.products.length} productes`),
      h('span', { onclick: (e) => e.stopPropagation() },
        toggle(p.active, async (v) => { await api(`/api/providers/${p.id}`, { method: 'PATCH', json: { active: v } }); await reload(); }))),
    providerForm(p)));

  const subj = h('input', { type: 'text', value: settings.mailSubject, style: 'width:100%' });
  const body = h('textarea', { rows: 5, value: settings.mailBody });

  app.replaceChildren(
    h('h1', {}, 'Configuració'),
    h('p', { class: 'sub' }, 'Escoles (clients), proveïdors i text del correu.'),
    h('div', { class: 'cfg' },
      h('div', {},
        h('div', { class: 'card mb' },
          h('h2', { class: 'mb' }, 'Escoles / clients'),
          schoolRows,
          h('div', { class: 'form-row' }, newSchool, h('button', { class: 'btn primary', onclick: addSchool }, 'Afegir'))),
        h('div', { class: 'card mb' },
          h('h2', {}, 'Correu als proveïdors'),
          h('label', { class: 'f' }, 'Assumpte ({setmana} = número de setmana)', subj),
          h('label', { class: 'f' }, 'Text', body),
          h('div', { class: 'row', style: 'margin-top:10px' }, h('button', { class: 'btn primary', onclick: async () => {
            await api('/api/settings', { method: 'PUT', json: { mailSubject: subj.value, mailBody: body.value } });
            toast('Desat'); await reload();
          } }, 'Desar'))),
        h('div', { class: 'card mb' },
          h('h2', {}, 'Estat del sistema'),
          h('p', {}, state.config.ocr ? '✅ Lectura automàtica de fotos activada' : '⚠️ Lectura automàtica de fotos NO configurada (ANTHROPIC_API_KEY)'),
          h('p', {}, state.config.mail ? '✅ Enviament de correu activat' : '⚠️ Enviament directe de correu NO configurat (SMTP). Es farà amb el teu programa de correu.'))),
      h('div', { class: 'card' },
        h('div', { class: 'row', style: 'justify-content:space-between' }, h('h2', {}, 'Proveïdors'),
          h('button', { class: 'btn small', onclick: async () => {
            const form = providerForm(null);
            await dialog('Nou proveïdor', form, [{ label: 'Tancar', value: false }]);
          } }, '+ Nou proveïdor')),
        h('p', { class: 'muted', style: 'font-size:13px' }, 'Clica un proveïdor per editar-lo. Un proveïdor inactiu no surt a la lectura ni a l\'enviament.'),
        provRows)),
  );
}

async function reload() {
  await loadState();
  render();
}

// ===================== Inici =====================
$('#prevWeek').onclick = async () => { state.weekId = shiftWeek(state.weekId, -1); sessionStorage.setItem('week', state.weekId); await reload(); };
$('#nextWeek').onclick = async () => { state.weekId = shiftWeek(state.weekId, 1); sessionStorage.setItem('week', state.weekId); await reload(); };

(async function init() {
  state.config = await api('/api/config');
  let saved = null;
  try { saved = sessionStorage.getItem('week'); } catch {}
  state.weekId = saved || state.config.currentWeek;
  parseHash();
  await loadState();
  render();
})().catch((e) => { app.replaceChildren(h('div', { class: 'alert error' }, 'Error carregant: ' + e.message)); });
