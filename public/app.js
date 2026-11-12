// ===================== Utilitats =====================
const $ = (sel, root = document) => root.querySelector(sel);
const app = $('#app');
const setApp = (...c) => app.replaceChildren(...c.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false));

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
  if (res.status === 401 && data?.login) { showLogin(); throw new Error('Cal iniciar sessió'); }
  if (!res.ok) throw new Error(data?.error || `Error ${res.status}`);
  return data;
}

// ===================== Inici de sessió =====================
function showLogin() {
  if ($('#login')) return;
  const input = h('input', { type: 'password', placeholder: 'Contrasenya', autocomplete: 'current-password', style: 'width:100%' });
  const err = h('div', { class: 'alert error', style: 'display:none;margin-top:10px' });
  const go = async () => {
    const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: input.value }) });
    if (res.ok) return location.reload();
    err.textContent = 'Contrasenya incorrecta';
    err.style.display = 'block';
    input.select();
  };
  input.onkeydown = (e) => { if (e.key === 'Enter') go(); };
  document.body.append(h('div', { id: 'login', class: 'login' },
    h('div', { class: 'card login-card' },
      h('img', { src: 'logo.jpg', alt: 'Teca & Xerinola', style: 'width:100%;max-width:280px;display:block;margin:0 auto 16px' }),
      h('h1', { style: 'text-align:center' }, 'Comandes'),
      h('p', { class: 'sub', style: 'text-align:center' }, 'Introdueix la contrasenya per entrar'),
      input, err,
      h('button', { class: 'btn primary', style: 'width:100%;margin-top:12px', onclick: go }, 'Entrar'))));
  input.focus();
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
  state.tab = ['escoles', 'escola', 'enviar', 'historic', 'config'].includes(tab) ? tab : 'escoles';
  state.schoolId = id || null;
}
window.addEventListener('hashchange', () => { parseHash(); render(); });

function render() {
  document.querySelectorAll('.tabs a').forEach((a) =>
    a.classList.toggle('active', a.dataset.tab === state.tab || (state.tab === 'escola' && a.dataset.tab === 'escoles')));
  if (state.tab === 'escola' && state.schoolId) return renderSchool();
  if (state.tab === 'enviar') return renderSend();
  if (state.tab === 'config') return renderConfig();
  if (state.tab === 'historic') return renderHistory();
  return renderSchools();
}

// ===================== Pujada de fotos =====================
async function resizeImage(file) {
  // Redueix les fotos grans al navegador (pujada més ràpida i dins dels límits de la IA)
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const max = 2200;
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 3e6 && /jpe?g|png|webp/.test(file.type)) return file;
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

const isPdf = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '');
const isUpload = (f) => f.type.startsWith('image/') || isPdf(f);
// Vercel no accepta peticions de més de ~4,5 MB; les fotos es redueixen, però els PDF no
const MAX_PDF = 4.3 * 1024 * 1024;

async function uploadPhotos(schoolId, files) {
  files = [...files].filter(isUpload);
  if (!files.length) return toast('Només es poden pujar fotos o PDF', true);
  const big = files.find((f) => isPdf(f) && f.size > MAX_PDF);
  if (big) return toast(`El PDF "${big.name}" és massa gran (${(big.size / 1048576).toFixed(1)} MB). El màxim és 4 MB: envia'n una foto o un PDF més petit.`, true);
  const school = state.data.schools.find((s) => s.id === schoolId);
  const weekId = state.weekId;
  const before = new Set((sub(schoolId)?.photos || []).map((p) => p.id));
  try {
    // Una foto per petició (Vercel limita la mida de cada petició a ~4,5 MB)
    let data = null;
    for (const [i, file] of files.entries()) {
      toast(`Pujant ${isPdf(file) ? 'PDF' : 'foto'} ${i + 1} de ${files.length} (${school.name})…`);
      const f = isPdf(file) ? new File([file], file.name, { type: 'application/pdf' }) : await resizeImage(file);
      const fd = new FormData();
      fd.append('photos', f, f.name);
      const res = await fetch(`/api/weeks/${weekId}/schools/${schoolId}/photos?read=0`, { method: 'POST', body: fd });
      data = await res.json().catch(() => ({ error: `Error ${res.status}` }));
      if (res.status === 401) { showLogin(); return; }
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
    }
    if (state.config.ocr) {
      const photoIds = data.photos.map((p) => p.id).filter((id) => !before.has(id));
      data = await api(`/api/weeks/${weekId}/schools/${schoolId}/read`, { json: { photoIds } });
      toast(`Fotos pujades. Llegint la comanda de ${school.name}…`);
    } else {
      toast('Fotos pujades');
    }
    if (weekId === state.weekId) state.data.week.submissions[schoolId] = data;
    render();
    schedulePoll();
  } catch (e) {
    toast(e.message, true);
    await loadState().catch(() => {});
    render();
  }
}

function pickFiles(schoolId) {
  const input = h('input', { type: 'file', accept: 'image/*,application/pdf,.pdf', multiple: true });
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
// Arrossegar una imatge que ja és a la pàgina (una foto, el logo…) no és pujar una foto nova:
// el navegador hi posa la imatge com si fos un fitxer i es pujaria repetida.
let internalDrag = false;
document.addEventListener('dragstart', () => { internalDrag = true; });
document.addEventListener('dragend', () => { internalDrag = false; });
window.addEventListener('drop', (e) => {
  if (!internalDrag) return;
  internalDrag = false;
  e.preventDefault();
  e.stopImmediatePropagation();
}, true);
window.addEventListener('dragenter', (e) => {
  if (internalDrag || ![...e.dataTransfer.types].includes('Files')) return;
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
  const files = [...(e.clipboardData?.files || [])].filter(isUpload);
  if (!files.length) return;
  if (state.tab === 'escola' && state.schoolId) uploadPhotos(state.schoolId, files);
  else askSchoolAndUpload(files);
});

// Miniatura d'una foto o d'un PDF
const photoIsPdf = (p) => p.mediaType === 'application/pdf';
const thumb = (p, attrs = {}) => (photoIsPdf(p)
  ? h('span', { class: 'pdf-thumb ' + (attrs.class || ''), title: 'PDF', onclick: attrs.onclick }, '📄', h('small', {}, 'PDF'))
  : h('img', { src: p.url, alt: '', ...attrs }));

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
        !photos.length && s?.filesClearedAt
          ? `fitxers esborrats (enviada) · ${lines} ${lines === 1 ? 'línia' : 'línies'}`
          : `${photos.length} foto${photos.length === 1 ? '' : 's'} · ${lines} ${lines === 1 ? 'línia' : 'línies'}`,
        low ? h('span', { class: 'tag warn' }, `${low} a revisar`) : null,
        s?.readError ? h('span', { class: 'tag warn' }, 'error de lectura') : null),
      photos.length ? h('div', { class: 'thumbs' }, photos.slice(0, 6).map((p) => thumb(p))) : null,
      h('div', { class: 'dropzone', onclick: () => pickFiles(school.id) }, '📷 Arrossega o clica per pujar fotos o PDF'),
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

  setApp(
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
let saveChain = Promise.resolve();
let photoIdx = 0;

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
    cur && photoIsPdf(cur) ? h('iframe', { class: 'pdf-view', src: cur.url, title: 'PDF de la comanda' })
      : cur ? h('img', {
        src: cur.url,
        onclick: () => stage.classList.toggle('zoom'),
      }) : s.filesClearedAt
        ? h('div', { class: 'empty-photo' }, `🗂️ Les fotos i PDF d'aquesta comanda es van esborrar el ${fmtDateTime(s.filesClearedAt)},`, h('br'),
          'un cop enviada a tots els proveïdors, per estalviar espai.', h('br'), 'Les línies de la comanda es mantenen.')
        : h('div', { class: 'empty-photo' }, 'Encara no hi ha fotos.', h('br'), 'Arrossega-les aquí (fotos o PDF) o clica "Afegir fotos".'));
  const viewer = h('div', { class: 'viewer' },
    stage,
    h('div', { class: 'tools' },
      h('div', { class: 'thumbs' }, s.photos.map((p, i) =>
        thumb(p, { class: i === photoIdx ? 'sel' : '', onclick: () => { photoIdx = i; renderSchool(); } }))),
      h('span', { style: 'flex:1' }),
      cur && !photoIsPdf(cur) ? h('button', { class: 'btn small', title: 'Girar la foto 90° (queda desada)', onclick: async (e) => {
        e.target.disabled = true;
        try {
          state.data.week.submissions[school.id] = await api(`/api/weeks/${state.weekId}/schools/${school.id}/photos/${cur.id}/rotate`, { json: { degrees: 90 } });
          renderSchool();
        } catch (err) { toast(err.message, true); e.target.disabled = false; }
      } }, '⟳ Girar') : null,
      cur ? h('button', { class: 'btn small danger', onclick: async () => {
        if (!(await confirmBox('Esborrar foto', 'Segur que vols esborrar aquesta foto? També es trauran les línies que s\'hi van llegir (les afegides a mà es mantenen).', 'Esborrar'))) return;
        try {
          // Primer es desen els canvis pendents, perquè no es perdin ni xoquin amb l'esborrat
          if (saveState.textContent.startsWith('Canvis')) await persist().catch(() => {});
          await saveChain.catch(() => {});
          state.data.week.submissions[school.id] = await api(`/api/weeks/${state.weekId}/schools/${school.id}/photos/${cur.id}`, { method: 'DELETE' });
          toast('Foto esborrada i línies actualitzades');
        } catch (err) { toast(err.message, true); await loadState().catch(() => {}); }
        renderSchool();
        schedulePoll();
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
    // Els desats van un darrere l'altre i porten la versió, per no esborrar línies llegides mentrestant
    saveChain = saveChain.catch(() => {}).then(() => api(`/api/weeks/${state.weekId}/schools/${school.id}`, {
      method: 'PUT', json: { items: s.items, observations: s.observations, status, version: s.version },
    })).then((d) => {
      Object.assign(s, { status: d.status, updatedAt: d.updatedAt, version: d.version });
      saveState.textContent = `Desat ${fmtDateTime(d.updatedAt)}`;
      return d;
    }).catch(async (e) => {
      saveState.textContent = 'No desat!';
      toast(e.message, true);
      if (/actualitzat mentrestant/.test(e.message)) { await loadState(); renderSchool(); }
      throw e;
    });
    return saveChain;
  };
  const autosave = () => { clearTimeout(saveTimer); saveState.textContent = 'Canvis sense desar…'; saveTimer = setTimeout(() => persist(), 800); };

  const byProv = new Map();
  for (const it of s.items) {
    const key = provider(it.providerId) ? it.providerId : '';
    if (!byProv.has(key)) byProv.set(key, []);
    byProv.get(key).push(it);
  }
  const orderedKeys = [...providers.map((p) => p.id).filter((id) => byProv.has(id)), ...(byProv.has('') ? [''] : [])];

  // Canviar una sola línia de proveïdor. Si el producte era al catàleg de l'antic, pregunta si
  // també s'ha de canviar al catàleg, perquè les properes lectures ja el posin al proveïdor bo.
  const changeProvider = async (it, newId) => {
    const to = provider(newId);
    if (!to) return;
    const from = provider(it.providerId);
    const name = (it.product || '').trim().toUpperCase();
    it.providerId = newId;
    it.inCatalog = to.products.includes(name);
    autosave();
    renderSchool();
    toast(`Línia moguda a ${to.name}`);
    if (!name || to.products.includes(name)) return;
    const choice = await dialog('Canviar-ho també al catàleg?',
      h('p', {}, `Vols que "${name}" sigui de ${to.name} a partir d'ara?`,
        from?.products.includes(name) ? ` Es traurà de ${from.name}.` : '',
        h('br'), h('small', { class: 'muted' }, 'Així les properes fotos ja el posaran al proveïdor correcte.')),
      [{ label: 'Només aquesta línia', value: false }, { label: 'Sí, canviar al catàleg', value: true, class: 'primary' }]);
    if (!choice) return;
    try {
      Object.assign(to, await api(`/api/providers/${to.id}/products`, { json: { name } }));
      if (from?.products.includes(name)) Object.assign(from, await api(`/api/providers/${from.id}/products`, { method: 'DELETE', json: { name } }));
      it.product = name;
      it.inCatalog = true;
      autosave();
      renderSchool();
      toast(`"${name}" ara és de ${to.name}`);
    } catch (e) { toast(e.message, true); }
  };

  const rowFor = (it) => {
    const p = provider(it.providerId);
    const listId = 'dl-' + (p?.id || 'none');
    const inp = (field, attrs = {}) => h('input', {
      type: 'text', value: it[field] || '', ...attrs,
      oninput: (e) => { it[field] = e.target.value; if (field === 'product') it.inCatalog = !!p?.products.includes(e.target.value.trim()); autosave(); },
    });
    const tr = h('tr', { class: it.confidence === 'baixa' ? 'low' : '', 'data-id': it.id },
      h('td', { class: 'col-prod' }, inp('product', { list: listId, placeholder: 'Producte' }),
        it.aiNote ? h('div', { class: 'ainote' }, 'ℹ️ ', it.aiNote) : null,
        p && it.product?.trim() && !p.products.includes(it.product.trim().toUpperCase())
          ? h('div', { class: 'ainote' }, h('button', { class: 'btn small ghost', style: 'padding:2px 6px', onclick: async () => {
            try {
              const upd = await api(`/api/providers/${p.id}/products`, { json: { name: it.product } });
              Object.assign(p, upd);
              it.product = it.product.trim().toUpperCase();
              it.inCatalog = true;
              toast(`Afegit al catàleg de ${p.name}`);
              autosave(); renderSchool();
            } catch (e) { toast(e.message, true); }
          } }, `+ Afegir "${it.product.trim().toUpperCase()}" als productes de ${p.name}`)) : null),
      h('td', { class: 'col-qty' }, inp('quantity', { placeholder: 'Quantitat' })),
      h('td', { class: 'col-day' }, inp('day', { placeholder: 'dd/mm' })),
      h('td', { class: 'col-note' }, inp('note', { placeholder: 'Nota pel proveïdor' })),
      h('td', { class: 'col-x' },
        h('div', { class: 'row', style: 'gap:2px;flex-wrap:nowrap' },
          h('select', { class: 'input prov-pick', title: 'Canviar aquesta línia de proveïdor', onchange: (e) => changeProvider(it, e.target.value) },
            h('option', { value: '' }, '⇄'),
            activeProviders.filter((x) => x.id !== it.providerId).map((x) => h('option', { value: x.id }, x.name))),
          it.confidence === 'baixa' ? h('button', { class: 'btn small ghost', title: 'Marcar com a revisada', onclick: () => { it.confidence = 'alta'; autosave(); renderSchool(); } }, '✓') : null,
          h('button', {
            class: 'btn small to-school' + (it.toSchool ? ' on' : ''),
            title: it.toSchool ? "Surt a la llista per portar a l'escola (clica per treure-la)" : "Afegir a la llista per portar a l'escola",
            onclick: () => { it.toSchool = !it.toSchool; autosave(); renderSchool(); },
          }, '🏫'),
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

  setApp(
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
          } }, '🔄 Tornar a llegir les fotos') : null,
          s.photos.length || s.items.length ? h('button', { class: 'btn danger', disabled: s.reading, onclick: async () => {
            const ok = await confirmBox('Esborrar la comanda',
              `S'esborraran totes les fotos i totes les línies de ${school.name} d'aquesta setmana, i la comanda tornarà a quedar pendent. No es pot desfer.`,
              'Esborrar-ho tot');
            if (!ok) return;
            clearTimeout(saveTimer);
            try {
              await saveChain.catch(() => {});
              state.data.week.submissions[school.id] = await api(`/api/weeks/${state.weekId}/schools/${school.id}`, { method: 'DELETE' });
              photoIdx = 0;
              toast(`Comanda de ${school.name} esborrada`);
            } catch (err) { toast(err.message, true); await loadState().catch(() => {}); }
            renderSchool();
          } }, '🗑️ Esborrar la comanda') : null),
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
  setApp(h('p', { class: 'muted' }, 'Carregant…'));
  const data = await api(`/api/weeks/${state.weekId}/orders`);
  const { orders, notConfirmed, subject } = data;

  const doSendMail = async (o, btn) => {
    // Si ja s'ha enviat, avís clar: el proveïdor el rebria dues vegades
    if (o.sent) {
      const again = await dialog(`⚠️ ${o.provider.name} ja ha rebut aquesta comanda`,
        h('div', {},
          h('p', { class: 'alert warn', style: 'margin:0 0 10px' },
            `Es va enviar el ${fmtDateTime(o.sent.at)}${o.sent.to ? ` a ${o.sent.to}` : ''}. Si la tornes a enviar, la rebrà dues vegades.`),
          h('p', {}, 'Només cal tornar-la a enviar si hi has fet canvis o si el proveïdor diu que no li ha arribat.')),
        [{ label: 'No, no la tornis a enviar', value: false, class: 'primary' }, { label: 'Sí, tornar-la a enviar', value: true, class: 'danger' }]);
      if (!again) return false;
    }
    if (!(await confirmBox('Enviar correu', `S'enviarà "${subject}" des de ${data.from} a ${o.provider.emails.join(', ')} amb el PDF de ${o.confirmedSchools} escola(es). Rebràs una còpia oculta a ${data.from}.`, 'Enviar'))) return false;
    btn && (btn.disabled = true, btn.textContent = 'Enviant…');
    try {
      const r = await api(`/api/weeks/${state.weekId}/orders/${o.provider.id}/send-mail`, { method: 'POST' });
      toast(`Correu enviat a ${o.provider.name} ✓${clearedNote(r.cleared)}`);
      if (r.cleared?.length) loadState().catch(() => {});
      return true;
    } catch (e) {
      toast(e.message, true);
      btn && (btn.disabled = false, btn.textContent = '✉️ Enviar per correu');
      return false;
    }
  };
  const markSent = async (o, via, undo = false) => {
    const r = await api(`/api/weeks/${state.weekId}/orders/${o.provider.id}/mark-sent`, { json: { via, undo } });
    if (r.cleared?.length) { toast(`Marcat com enviat.${clearedNote(r.cleared)}`); loadState().catch(() => {}); }
    renderSend();
  };
  const pdfUrl = (o, dl) => `/api/weeks/${state.weekId}/orders/${o.provider.id}/pdf${dl ? '?download=1' : ''}`;

  const cards = orders.map((o) => {
    const p = o.provider;
    const ready = o.confirmedSchools > 0;
    const actions = [];
    if (p.emails?.length) {
      const b = h('button', {
        class: 'btn primary', disabled: !ready || !state.config.mail,
        title: state.config.mail ? '' : 'Cal configurar el correu al servidor',
        onclick: async () => { if (await doSendMail(o, b)) renderSend(); },
      }, o.sent ? '✉️ Tornar a enviar' : '✉️ Enviar per correu');
      actions.push(b);
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
    if (p.emails?.length && ready && state.config.mail) {
      const cb = h('button', { class: 'btn ghost small', title: `Envia una còpia d'aquesta comanda només a ${data.from}`, onclick: async () => {
        cb.disabled = true;
        try { const r = await api(`/api/weeks/${state.weekId}/orders/${p.id}/send-copy`, { method: 'POST' }); toast(`Còpia enviada a ${r.to}`); }
        catch (e) { toast(e.message, true); }
        cb.disabled = false;
      } }, '📩 Enviar-me una còpia');
      actions.push(cb);
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
      const cleared = [];
      for (const o of sendable) {
        try {
          const r = await api(`/api/weeks/${state.weekId}/orders/${o.provider.id}/send-mail`, { method: 'POST' });
          cleared.push(...(r.cleared || []));
          ok++;
        } catch (e) { toast(`${o.provider.name}: ${e.message}`, true); }
      }
      toast(`${ok} correu(s) enviat(s)${clearedNote(cleared)}`);
      if (cleared.length) loadState().catch(() => {});
      renderSend();
    } }, `✉️ Enviar tots els correus pendents (${sendable.length})`)
    : null;

  setApp(
    h('div', { class: 'row', style: 'justify-content:space-between' },
      h('div', {}, h('h1', {}, 'Enviar comandes als proveïdors'), h('p', { class: 'sub' }, `Els correus surten de ${data.from} amb l'assumpte "${subject}". Només hi surten els productes demanats, separats per escola.`)),
      bulk),
    notConfirmed.length
      ? h('div', { class: 'alert warn' }, `Falten per confirmar: ${notConfirmed.join(', ')}. Pots enviar igualment, però aquestes escoles no hi sortiran.`)
      : h('div', { class: 'alert ok' }, 'Totes les escoles actives estan confirmades ✓'),
    schoolListCard(data.schoolList),
    !state.config.mail ? h('div', { class: 'alert error' }, 'L\'enviament de correu encara no està configurat al servidor (dades SMTP del compte ', data.from, '). Fins que no es configuri, els botons de correu estan desactivats.') : null,
    orders.length ? h('div', { class: 'order-grid' }, cards) : h('div', { class: 'card muted' }, 'Encara no hi ha cap comanda aquesta setmana.'),
  );
}
// Escoles a qui s'han esborrat els fitxers perquè ja s'han enviat a tots els proveïdors
const clearedNote = (list) => (list?.length ? ` · Fitxers esborrats (ja enviades): ${list.join(', ')}` : '');

// Targeta de la llista per portar a les escoles (línies marcades amb 🏫)
function schoolListCard(sl) {
  if (!sl || (!sl.lines && !sl.pending?.length)) {
    return h('div', { class: 'card mb muted', style: 'font-size:14px' },
      "🏫 Llista per portar a les escoles: no hi ha cap línia marcada. A la revisió de cada escola, clica 🏫 al costat de la creu de les línies que s'hi han de portar.");
  }
  const url = `/api/weeks/${state.weekId}/school-list/pdf`;
  return h('div', { class: 'card mb school-list-card' },
    h('div', { class: 'row', style: 'justify-content:space-between' },
      h('div', {},
        h('h2', { style: 'margin:0' }, '🏫 Llista per portar a les escoles'),
        h('div', { class: 'muted', style: 'font-size:13px;margin-top:4px' },
          `${sl.lines} ${sl.lines === 1 ? 'producte' : 'productes'} de ${sl.schools} ${sl.schools === 1 ? 'escola' : 'escoles'} · Producte / Quantitat / Escola`)),
      h('div', { class: 'row' },
        h('a', { class: 'btn primary' + (sl.lines ? '' : ' disabled'), href: sl.lines ? url : undefined, target: '_blank' }, '📄 Veure / imprimir PDF'),
        h('a', { class: 'btn' + (sl.lines ? '' : ' disabled'), href: sl.lines ? url + '?download=1' : undefined }, '⬇️ Descarregar'))),
    sl.pending?.length ? h('div', { class: 'alert warn', style: 'margin:10px 0 0' },
      `Escoles amb línies marcades però sense confirmar (no hi surten): ${sl.pending.join(', ')}`) : null);
}
const waPhone = (phone) => { const d = phone.replace(/\D/g, ''); return d.length === 9 ? '34' + d : d; };
const channelLabel = (p) => ({ email: '✉️ Correu', whatsapp: '💬 WhatsApp', phone: '📞 Trucar', print: '🖨️ Imprimir' }[p.channel] || p.channel);

// ===================== Vista 3: Configuració =====================
function toggle(checked, onchange) {
  return h('label', { class: 'switch', title: checked ? 'Actiu' : 'Inactiu' },
    h('input', { type: 'checkbox', checked, onchange: (e) => onchange(e.target.checked) }), h('span'));
}

const openProviders = new Set();
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
  newSchool.onkeydown = (e) => { if (e.key === 'Enter') addSchool(); };

  const providerForm = (p) => {
    const f = {
      name: h('input', { type: 'text', value: p?.name || '' }),
      channel: h('select', { class: 'input' }, [['email', 'Correu'], ['whatsapp', 'WhatsApp'], ['phone', 'Trucar'], ['print', 'Imprimir']]
        .map(([v, l]) => h('option', { value: v, selected: (p?.channel || 'email') === v }, l))),
      emails: h('input', { type: 'text', value: (p?.emails || []).join('; '), placeholder: 'correu1@...; correu2@...' }),
      phone: h('input', { type: 'tel', value: p?.phone || '', placeholder: '600000000' }),
      notes: h('input', { type: 'text', value: p?.notes || '' }),
      aliases: h('input', { type: 'text', value: (p?.aliases || []).join('; '), placeholder: 'Noms antics que surten al full imprès' }),
    };
    if (!p) f.products = h('textarea', { rows: 6, placeholder: 'Un producte per línia (també es poden afegir després)' });
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
      f.products ? h('label', { class: 'f' }, 'Productes', f.products) : null,
      h('div', { class: 'row', style: 'margin-top:10px' }, saveBtn),
      p ? productsEditor(p) : null);
  };

  const productsEditor = (p) => {
    const box = h('div', { class: 'products-box' });
    const draw = () => {
      const input = h('input', { type: 'text', placeholder: 'Nou producte (p. ex. ESPAGUETIS INTEGRALS 5KG)' });
      const filter = h('input', { type: 'text', placeholder: 'Cercar…', style: 'max-width:160px' });
      const chips = h('div', { class: 'prod-chips' });
      const drawChips = () => chips.replaceChildren(...p.products
        .filter((x) => !filter.value || norm(x).includes(norm(filter.value)))
        .map((name) => h('span', { class: 'prod-chip' }, name,
          h('button', { title: 'Treure producte', onclick: async () => {
            if (!(await confirmBox('Treure producte', `Treure "${name}" de ${p.name}? (Les comandes ja fetes no canvien.)`, 'Treure'))) return;
            Object.assign(p, await api(`/api/providers/${p.id}/products`, { method: 'DELETE', json: { name } }));
            draw();
          } }, '✕'))));
      filter.oninput = drawChips;
      const add = async () => {
        if (!input.value.trim()) return;
        try {
          Object.assign(p, await api(`/api/providers/${p.id}/products`, { json: { names: input.value } }));
          toast('Producte afegit');
          draw();
          box.querySelector('input').focus();
        } catch (e) { toast(e.message, true); }
      };
      input.onkeydown = (e) => { if (e.key === 'Enter') add(); };
      input.onpaste = (e) => {
        const t = e.clipboardData.getData('text');
        if (t.includes('\n')) { e.preventDefault(); input.value = t; add(); }
      };
      drawChips();
      box.replaceChildren(
        h('div', { class: 'row', style: 'justify-content:space-between;margin-top:16px' },
          h('strong', {}, `Productes (${p.products.length})`), filter),
        h('p', { class: 'muted', style: 'font-size:12px;margin:4px 0 8px' }, 'Serveixen perquè la lectura reconegui el que escriuen els cuiners. Pots enganxar una llista (un per línia).'),
        h('div', { class: 'form-row', style: 'margin-top:0;margin-bottom:10px' }, input, h('button', { class: 'btn primary', onclick: add }, '+ Afegir')),
        chips);
    };
    draw();
    return box;
  };

  const provRows = providers.map((p) => h('details', { class: 'prov', open: openProviders.has(p.id), ontoggle: (e) => e.target.open ? openProviders.add(p.id) : openProviders.delete(p.id) },
    h('summary', {},
      h('span', { class: 'name', style: p.active ? '' : 'color:var(--muted);text-decoration:line-through' }, p.name),
      h('span', { class: 'muted', style: 'font-size:13px' }, `${channelLabel(p)} · ${p.products.length} productes`),
      h('span', { onclick: (e) => e.stopPropagation() },
        toggle(p.active, async (v) => { await api(`/api/providers/${p.id}`, { method: 'PATCH', json: { active: v } }); await reload(); }))),
    providerForm(p)));

  const from = h('input', { type: 'email', value: settings.mailFrom, style: 'width:100%' });
  const subj = h('input', { type: 'text', value: settings.mailSubject, style: 'width:100%' });
  const body = h('textarea', { rows: 5, value: settings.mailBody });

  setApp(
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
          h('label', { class: 'f' }, 'Remitent (els correus surten sempre d\'aquesta adreça)', from),
          h('label', { class: 'f' }, 'Assumpte ({setmana} = número de setmana)', subj),
          h('label', { class: 'f' }, 'Text', body),
          h('div', { class: 'row', style: 'margin-top:10px' }, h('button', { class: 'btn primary', onclick: async () => {
            await api('/api/settings', { method: 'PUT', json: { mailFrom: from.value.trim(), mailSubject: subj.value, mailBody: body.value } }).catch((e) => { toast(e.message, true); throw e; });
            toast('Desat'); await reload();
          } }, 'Desar'))),
        h('div', { class: 'card mb' },
          h('h2', {}, 'Estat del sistema'),
          h('p', {}, state.config.ocr ? '✅ Lectura automàtica de fotos activada' : '⚠️ Lectura automàtica de fotos NO configurada (ANTHROPIC_API_KEY)'),
          h('p', {}, state.config.mail ? '✅ Enviament de correu activat' : '⚠️ Enviament de correu NO configurat al servidor (SMTP). Cal configurar-lo per poder enviar els correus.'),
          state.config.mail ? h('button', { class: 'btn small', onclick: async (e) => {
            e.target.disabled = true;
            try { const r = await api('/api/test-mail', { method: 'POST' }); toast(`Correu de prova enviat a ${r.to}`); }
            catch (err) { toast(err.message, true); }
            e.target.disabled = false;
          } }, '✉️ Enviar correu de prova') : null)),
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

// ===================== Vista 4: Històric =====================
const MONTHS = ['Gener', 'Febrer', 'Març', 'Abril', 'Maig', 'Juny', 'Juliol', 'Agost', 'Setembre', 'Octubre', 'Novembre', 'Desembre'];
const histFilter = { school: '', provider: '' };
const histOpen = new Set();

// Una setmana compta al mes (i any) del seu dijous, com fa la numeració ISO
function weekMonth(w) {
  const d = new Date(w.from + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 3);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
}

async function openWeek(weekId, tab = 'escoles') {
  state.weekId = weekId;
  try { sessionStorage.setItem('week', weekId); } catch {}
  await loadState();
  if (location.hash === '#' + tab) render(); else location.hash = '#' + tab;
}

async function renderHistory() {
  setApp(h('p', { class: 'muted' }, 'Carregant l\'històric…'));
  const qs = new URLSearchParams(Object.entries(histFilter).filter(([, v]) => v)).toString();
  const weeks = await api('/api/history' + (qs ? '?' + qs : ''));

  const schoolSel = h('select', { class: 'input', onchange: (e) => { histFilter.school = e.target.value; renderHistory(); } },
    h('option', { value: '' }, 'Totes les escoles'),
    state.data.schools.map((s) => h('option', { value: s.id, selected: histFilter.school === s.id }, s.name + (s.active ? '' : ' (inactiva)'))));
  const provSel = h('select', { class: 'input', onchange: (e) => { histFilter.provider = e.target.value; renderHistory(); } },
    h('option', { value: '' }, 'Tots els proveïdors'),
    state.data.providers.map((p) => h('option', { value: p.id, selected: histFilter.provider === p.id }, p.name)));

  // Agrupar: any -> mes -> setmanes
  const years = new Map();
  for (const w of weeks) {
    const { year, month } = weekMonth(w);
    if (!years.has(year)) years.set(year, new Map());
    const months = years.get(year);
    if (!months.has(month)) months.set(month, []);
    months.get(month).push(w);
  }
  const sum = (list, k) => list.reduce((n, w) => n + w[k], 0);
  const now = new Date();

  const weekRow = (w) => {
    const detail = h('div', { class: 'hist-detail' });
    const key = 'w:' + w.weekId;
    const loadDetail = async () => {
      detail.replaceChildren(h('p', { class: 'muted' }, 'Carregant…'));
      const d = await api(`/api/weeks/${w.weekId}/orders`);
      const orders = d.orders.filter((o) => !histFilter.provider || o.provider.id === histFilter.provider);
      detail.replaceChildren(...(orders.length ? orders.map((o) => {
        const schools = o.schools.filter((s) => !histFilter.school || s.id === histFilter.school);
        if (!schools.length) return null;
        return h('div', { class: 'hist-prov' },
          h('div', { class: 'row' },
            h('strong', {}, o.provider.name),
            o.sent ? h('span', { class: 'badge confirmed' }, `Enviat ${fmtDateTime(o.sent.at)}`) : h('span', { class: 'badge pending' }, 'No enviat'),
            o.confirmedSchools ? h('a', { class: 'btn small ghost', target: '_blank', href: `/api/weeks/${w.weekId}/orders/${o.provider.id}/pdf` }, '📄 PDF') : null),
          schools.map((s) => h('div', { class: 'hist-school' },
            h('span', { class: 'hist-sname' }, s.name, s.status !== 'confirmed' ? h('span', { class: 'tag warn' }, 'sense confirmar') : null),
            h('span', {}, s.items.map((it) => `${it.product}: ${it.quantity || '-'}${it.day ? ` (${it.day})` : ''}`).join(' · ')))));
      }).filter(Boolean) : [h('p', { class: 'muted' }, 'Cap comanda.')]));
    };
    const det = h('details', { class: 'hist-week', open: histOpen.has(key), ontoggle: (e) => {
      if (e.target.open) { histOpen.add(key); loadDetail(); } else histOpen.delete(key);
    } },
      h('summary', {},
        h('span', { class: 'hist-wname' }, `Setmana ${w.week}`, h('small', {}, `${fmtDate(w.from)} – ${fmtDate(w.to)}`)),
        h('span', { class: 'hist-stats' },
          h('span', { title: 'Escoles amb comanda' }, `🏫 ${w.schools}`, w.confirmed < w.schools ? h('small', { class: 'muted' }, ` (${w.confirmed} conf.)`) : null),
          h('span', { title: 'Línies demanades' }, `🧾 ${w.lines}`),
          h('span', { title: 'Proveïdors' }, `🚚 ${w.providers}`),
          h('span', { title: 'Comandes enviades', class: w.sent ? 'ok' : '' }, `✉️ ${w.sent}`)),
        h('button', { class: 'btn small', onclick: (e) => { e.preventDefault(); openWeek(w.weekId); } }, 'Obrir setmana')),
      detail);
    if (histOpen.has(key)) loadDetail();
    return det;
  };

  const content = [...years.entries()].map(([year, months]) => {
    const all = [...months.values()].flat();
    return h('section', { class: 'card mb hist-year' },
      h('div', { class: 'row', style: 'justify-content:space-between' },
        h('h2', { class: 'hist-yname' }, String(year)),
        h('span', { class: 'muted' }, `${all.length} setmanes · ${sum(all, 'lines')} línies · ${sum(all, 'sent')} comandes enviades`)),
      [...months.entries()].map(([month, list]) => {
        const key = `m:${year}-${month}`;
        const isCurrent = year === now.getFullYear() && month === now.getMonth();
        const open = histOpen.has(key) || (isCurrent && !histOpen.has('closed:' + key));
        return h('details', { class: 'hist-month', open, ontoggle: (e) => {
          if (e.target.open) { histOpen.add(key); histOpen.delete('closed:' + key); } else { histOpen.delete(key); histOpen.add('closed:' + key); }
        } },
          h('summary', {}, h('strong', {}, MONTHS[month]),
            h('span', { class: 'muted' }, `${list.length} setman${list.length === 1 ? 'a' : 'es'} · ${sum(list, 'lines')} línies`)),
          list.map(weekRow));
      }));
  });

  setApp(
    h('h1', {}, 'Històric de comandes'),
    h('p', { class: 'sub' }, 'Totes les comandes per any, mes i setmana. Obre una setmana per veure què es va demanar a cada proveïdor.'),
    h('div', { class: 'row mb' }, schoolSel, provSel),
    content.length ? content : h('div', { class: 'card muted' }, 'Encara no hi ha cap comanda guardada' + (qs ? ' amb aquest filtre.' : '.')),
  );
}

async function reload() {
  await loadState();
  render();
}

// ===================== Inici =====================
$('#prevWeek').onclick = async () => { state.weekId = shiftWeek(state.weekId, -1); sessionStorage.setItem('week', state.weekId); await reload(); };
$('#logout').onclick = async (e) => {
  e.preventDefault();
  if (!(await confirmBox('Sortir', 'Vols tancar la sessió? Per tornar a entrar caldrà la contrasenya.', 'Sortir'))) return;
  await fetch('/api/logout', { method: 'POST' }).catch(() => {});
  location.hash = '';
  location.reload();
};
$('#nextWeek').onclick = async () => { state.weekId = shiftWeek(state.weekId, 1); sessionStorage.setItem('week', state.weekId); await reload(); };

(async function init() {
  state.config = await api('/api/config');
  let saved = null;
  try { saved = sessionStorage.getItem('week'); } catch {}
  state.weekId = saved || state.config.currentWeek;
  parseHash();
  await loadState();
  render();
})().catch((e) => { setApp(h('div', { class: 'alert error' }, 'Error carregant: ' + e.message)); });
