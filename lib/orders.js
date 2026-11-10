// Agrupa les comandes confirmades per proveïdor i genera PDF i text (WhatsApp).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';

export function formatDay(day, week) {
  if (!day) return '';
  const m = /^(\d{1,2})\/(\d{1,2})$/.exec(day.trim());
  if (m) return `${m[1].padStart(2, '0')}/${m[2].padStart(2, '0')}/${week.year}`;
  return day.trim().toUpperCase();
}

const fmtDate = (iso) => iso.split('-').reverse().join('/');

export function weekLabel(week) {
  return `Setmana ${week.week} (del ${fmtDate(week.from)} al ${fmtDate(week.to)})`;
}

/**
 * Retorna [{ provider, schools: [{ school, status, items }] }] només amb línies demanades.
 * onlyConfirmed=false inclou també escoles pendents de validar (per a previsualitzar).
 */
export function ordersByProvider(db, week, { onlyConfirmed = true } = {}) {
  const schools = db.schools.filter((s) => s.active || week.submissions[s.id]?.items?.length);
  const result = [];
  for (const provider of db.providers) {
    const perSchool = [];
    for (const school of schools) {
      const sub = week.submissions[school.id];
      if (!sub) continue;
      if (onlyConfirmed && sub.status !== 'confirmed') continue;
      const items = sub.items.filter(
        (it) => it.providerId === provider.id && (it.product || '').trim() && ((it.quantity || '').trim() || (it.day || '').trim()),
      );
      if (items.length) perSchool.push({ school, status: sub.status, items });
    }
    if (perSchool.length) result.push({ provider, schools: perSchool });
  }
  return result;
}

export function orderText(order, week, settings) {
  const lines = [settings.mailBody.split('\n')[0] || 'Bon dia,', '', `*Comanda setmana ${week.week}*`];
  for (const { school, items } of order.schools) {
    lines.push('', `*${school.name.toUpperCase()}*`);
    for (const it of items) {
      const day = formatDay(it.day, week);
      lines.push(`- ${it.product}: ${it.quantity || '-'}${day ? ` (servir ${day})` : ''}${it.note ? ` — ${it.note}` : ''}`);
    }
  }
  lines.push('', 'Gràcies');
  return lines.join('\n');
}

// Colors del logo de Teca i Xerinola
const RED = '#e3312c';
const GREEN = '#8cb83a';
const LEAF = '#3f8222';
const GRAY = '#404040';
const LIGHT = '#eef5e1';
const ZEBRA = '#f8faf3';
const BORDER = '#cfdcb4';
const MAX_ROWS = 30;
const LOGO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'logo.jpg');

// Proveïdors que volen, al final del PDF, un resum amb el total de cada producte
const WANTS_SUMMARY = (provider) => provider?.id === 'grosmercat' || /GROS\s*MERCAT/i.test(provider?.name || '');

// Unitats escrites de maneres diferents que són la mateixa
const UNIT_ALIASES = [
  [/^(K|KG|KGS|KILO|KILOS|QUILO|QUILOS)$/, 'KG'],
  [/^(G|GR|GRS|GRAM|GRAMS)$/, 'G'],
  [/^(L|LT|LTS|LITRE|LITRES|LITRO|LITROS)$/, 'L'],
  [/^(U|UN|UNS|UNI|UNIT|UNITAT|UNITATS|UNIDAD|UNIDADES)$/, 'UNITATS'],
  [/^(CX|CAIXA|CAIXES|CAJA|CAJAS)$/, 'CAIXES'],
  [/^(BOSSA|BOSSES|BOLSA|BOLSAS)$/, 'BOSSES'],
  [/^(PAQ|PAQUET|PAQUETS|PAQUETE|PAQUETES)$/, 'PAQUETS'],
  [/^(SAC|SACS|SACO|SACOS)$/, 'SACS'],
  [/^(POT|POTS)$/, 'POTS'],
  [/^(LLAUNA|LLAUNES|LATA|LATAS)$/, 'LLAUNES'],
  [/^(AMPOLLA|AMPOLLES|BOTELLA|BOTELLAS)$/, 'AMPOLLES'],
  [/^(DOTZENA|DOTZENES|DOCENA|DOCENAS)$/, 'DOTZENES'],
];
const normUnit = (u) => {
  const clean = u.toUpperCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
  return UNIT_ALIASES.find(([re]) => re.test(clean))?.[1] ?? clean;
};
const SINGULAR = {
  UNITATS: 'UNITAT', CAIXES: 'CAIXA', BOSSES: 'BOSSA', PAQUETS: 'PAQUET', SACS: 'SAC', POTS: 'POT',
  LLAUNES: 'LLAUNA', AMPOLLES: 'AMPOLLA', DOTZENES: 'DOTZENA',
};
const fmtNum =(n) => (Math.round(n * 100) / 100).toLocaleString('ca-ES', { maximumFractionDigits: 2 });

/** Total de cada producte sumant totes les escoles: [{ product, total, schools }] */
export function productTotals(order) {
  const byProduct = new Map();
  for (const { school, items } of order.schools) {
    for (const it of items) {
      const name = (it.product || '').trim().toUpperCase();
      if (!name) continue;
      if (!byProduct.has(name)) byProduct.set(name, { units: new Map(), other: [], schools: new Set() });
      const p = byProduct.get(name);
      p.schools.add(school.name);
      const q = (it.quantity || '').trim();
      const m = /^(\d+(?:[.,]\d+)?)\s*(.*)$/.exec(q);
      if (m) {
        const unit = normUnit(m[2]);
        p.units.set(unit, (p.units.get(unit) || 0) + Number(m[1].replace(',', '.')));
      } else if (q) {
        p.other.push(q.toUpperCase()); // quantitat sense número: es mostra tal qual
      }
    }
  }
  return [...byProduct.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'ca'))
    .map(([product, p]) => ({
      product,
      total: [...[...p.units].map(([u, n]) => `${fmtNum(n)}${u ? ' ' + (n === 1 ? SINGULAR[u] || u : u) : ''}`), ...p.other].join(' + ') || '-',
      schools: p.schools.size,
    }));
}

export function orderPdf(order, week, settings = {}) {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 28, bufferPages: true,
    info: { Title: `${order.provider.name} - Comanda setmana ${week.week}`, Author: 'Teca & Xerinola' } });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const m = 28;
  const gap = 16;
  const cols = 3;
  const blockW = (pageW - m * 2 - gap * (cols - 1)) / cols;
  const colW = [blockW * 0.5, blockW * 0.27, blockW * 0.23];
  const headerH = 22;
  const subH = 14;
  const rowH = 13.5;
  const footerH = 18;
  const hasLogo = fs.existsSync(LOGO);

  const pageHeader = () => {
    let x = m;
    if (hasLogo) { doc.image(LOGO, m, m - 6, { height: 44 }); x = m + 136; }
    doc.font('Helvetica-Bold').fontSize(18).fillColor(GRAY)
      .text(order.provider.name, x, m - 2, { width: pageW - x - m - 200, lineBreak: false, ellipsis: true });
    doc.font('Helvetica').fontSize(10.5).fillColor(GRAY)
      .text(`Comanda setmana ${week.week}  ·  del ${fmtDate(week.from)} al ${fmtDate(week.to)}`, x, m + 20, { lineBreak: false });
    // Requadre setmana a la dreta
    const bx = pageW - m - 190;
    doc.roundedRect(bx, m - 4, 190, 40, 6).fill(LIGHT);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(LEAF).text('SETMANA', bx, m + 1, { width: 190, align: 'center' });
    doc.font('Helvetica-Bold').fontSize(16).fillColor(RED).text(String(week.week), bx, m + 13, { width: 190, align: 'center' });
    // Franja vermella i verda, com la capçalera de l'app
    const y = m + 44;
    doc.rect(m, y, (pageW - 2 * m) / 2, 3).fill(RED);
    doc.rect(m + (pageW - 2 * m) / 2, y, (pageW - 2 * m) / 2, 3).fill(GREEN);
    return y + 14;
  };

  // Blocs (una escola pot ocupar més d'un bloc si demana molts productes)
  const blocks = [];
  for (const { school, items } of order.schools) {
    for (let i = 0; i < items.length; i += MAX_ROWS) {
      blocks.push({ name: school.name.toUpperCase() + (i ? ' (cont.)' : ''), items: items.slice(i, i + MAX_ROWS) });
    }
  }
  // Resum amb el total de cada producte (només per als proveïdors que el volen)
  if (WANTS_SUMMARY(order.provider) && order.schools.length) {
    const totals = productTotals(order).map((t) => ({ product: t.product, quantity: t.total, day: `${t.schools}` }));
    for (let i = 0; i < totals.length; i += MAX_ROWS) {
      blocks.push({
        name: 'RESUM · TOTAL PER PRODUCTE' + (i ? ' (cont.)' : ''),
        items: totals.slice(i, i + MAX_ROWS),
        summary: true,
        newRow: i === 0,
      });
    }
  }

  let y = pageHeader();
  let col = 0;
  let rowMaxH = 0;
  // Escriu una cel·la d'una línia; si el text no hi cap, redueix la lletra (fins a 6 pt)
  const cell = (text, x, yy, w, opts = {}) => {
    const str = String(text ?? '');
    let size = 8;
    doc.fontSize(size);
    while (size > 6 && doc.widthOfString(str) > w - 8) doc.fontSize((size -= 0.25));
    doc.text(str, x + 4, yy + 3.5 + (8 - size) / 2, { width: w - 8, height: rowH - 2, ellipsis: true, lineBreak: false, ...opts });
  };

  for (const block of blocks) {
    const h = headerH + subH + block.items.length * rowH;
    const limit = pageH - m - footerH;
    // El resum ocupa dues columnes, perquè hi càpiguen totals com "2 DOTZENES + 30 UNITATS"
    const span = block.summary ? 2 : 1;
    if ((block.newRow || col + span > cols) && col !== 0) {
      // El resum comença en una fila nova, separat de les escoles
      y += rowMaxH + gap;
      col = 0;
      rowMaxH = 0;
    }
    if (y + h > limit && col !== 0) {
      // No hi cap en aquesta fila: passa a la fila següent
      y += rowMaxH + gap;
      col = 0;
      rowMaxH = 0;
    }
    if (y + h > limit) {
      doc.addPage();
      y = pageHeader();
      col = 0;
      rowMaxH = 0;
    }
    const x = m + col * (blockW + gap);
    const bw = blockW * span + gap * (span - 1);
    const cw = block.summary ? [bw * 0.55, bw * 0.33, bw * 0.12] : colW;

    // Capçalera de l'escola (o del resum, en vermell)
    doc.save().roundedRect(x, y, bw, headerH + 6, 5).clip();
    doc.rect(x, y, bw, headerH).fill(block.summary ? RED : GREEN);
    doc.restore();
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#ffffff')
      .text(block.name, x, y + 5.5, { width: bw, align: 'center', lineBreak: false, ellipsis: true });
    let yy = y + headerH;
    doc.rect(x, yy, bw, subH).fill(LIGHT);
    doc.font('Helvetica-Bold').fontSize(7).fillColor(LEAF);
    doc.text('PRODUCTE', x + 4, yy + 4, { width: cw[0] - 8, lineBreak: false });
    doc.text(block.summary ? 'TOTAL' : 'QUANTITAT', x + cw[0], yy + 4, { width: cw[1], align: 'center', lineBreak: false });
    doc.text(block.summary ? 'ESCOLES' : 'SERVIR DIA', x + cw[0] + cw[1], yy + 4, { width: cw[2], align: 'center', lineBreak: false });
    yy += subH;

    block.items.forEach((it, i) => {
      if (i % 2) doc.rect(x, yy, bw, rowH).fill(ZEBRA);
      doc.font('Helvetica').fontSize(8).fillColor(GRAY);
      cell(it.product + (it.note ? ` (${it.note})` : ''), x, yy, cw[0]);
      doc.font('Helvetica-Bold').fillColor(RED);
      cell((it.quantity || '').toUpperCase(), x + cw[0], yy, cw[1], { align: 'center' });
      doc.font('Helvetica').fillColor(GRAY);
      cell(block.summary ? it.day : formatDay(it.day, week), x + cw[0] + cw[1], yy, cw[2], { align: 'center' });
      doc.lineWidth(0.4).strokeColor(BORDER).moveTo(x, yy + rowH).lineTo(x + bw, yy + rowH).stroke();
      yy += rowH;
    });
    doc.lineWidth(0.8).strokeColor(BORDER).rect(x, y + headerH, bw, yy - y - headerH).stroke();
    doc.lineWidth(0.4).moveTo(x + cw[0], y + headerH).lineTo(x + cw[0], yy).stroke();
    doc.moveTo(x + cw[0] + cw[1], y + headerH).lineTo(x + cw[0] + cw[1], yy).stroke();

    rowMaxH = Math.max(rowMaxH, yy - y);
    col += span;
    if (col >= cols) {
      col = 0;
      y += rowMaxH + gap;
      rowMaxH = 0;
    }
  }

  // Peu de pàgina (sense marge inferior, perquè PDFKit no afegeixi pàgines)
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const fy = pageH - m - 4;
    doc.lineWidth(0.5).strokeColor(BORDER).moveTo(m, fy - 5).lineTo(pageW - m, fy - 5).stroke();
    let fx = m;
    const piece = (text, color, font = 'Helvetica-Bold') => {
      doc.font(font).fontSize(8).fillColor(color).text(text, fx, fy, { lineBreak: false });
      fx += doc.widthOfString(text);
    };
    piece('Teca', RED);
    piece(' & ', GRAY);
    piece('Xerinola', GREEN);
    if (settings.mailFrom) piece(`   ·   ${settings.mailFrom}`, GRAY, 'Helvetica');
    doc.font('Helvetica').fontSize(8).fillColor(GRAY)
      .text(`Pàgina ${i - range.start + 1} de ${range.count}`, pageW - m - 120, fy, { width: 120, align: 'right', lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
  doc.end();
  return done;
}

// ---------- Llista per portar a les escoles ----------
/**
 * Línies marcades amb 🏫 (toSchool) de totes les escoles, ordenades per escola i producte.
 * Torna { rows: [{ school, product, quantity }], pending: [noms d'escoles amb línies marcades però sense confirmar] }
 */
export function schoolList(db, week) {
  const rows = [];
  const pending = [];
  for (const school of db.schools) {
    const sub = week.submissions[school.id];
    const items = (sub?.items || []).filter((it) => it.toSchool && (it.product || '').trim());
    if (!items.length) continue;
    if (sub.status !== 'confirmed') { pending.push(school.name); continue; }
    items
      .map((it) => ({ school: school.name.toUpperCase(), product: it.product.trim().toUpperCase(), quantity: (it.quantity || '').trim().toUpperCase() }))
      .sort((a, b) => a.product.localeCompare(b.product, 'ca'))
      .forEach((r) => rows.push(r));
  }
  rows.sort((a, b) => a.school.localeCompare(b.school, 'ca'));
  return { rows, pending };
}

export function schoolListPdf(rows, week, settings = {}) {
  const doc = new PDFDocument({ size: 'A4', margin: 36, bufferPages: true,
    info: { Title: `Llista per portar a les escoles - setmana ${week.week}`, Author: 'Teca & Xerinola' } });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const m = 36;
  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const tableW = pageW - 2 * m;
  const cw = [tableW * 0.5, tableW * 0.22, tableW * 0.28];
  const rowH = 18;
  const hasLogo = fs.existsSync(LOGO);

  const header = () => {
    let x = m;
    if (hasLogo) { doc.image(LOGO, m, m - 6, { height: 40 }); x = m + 124; }
    doc.font('Helvetica-Bold').fontSize(16).fillColor(GRAY).text("Llista per portar a les escoles", x, m - 2, { lineBreak: false });
    doc.font('Helvetica').fontSize(10).fillColor(GRAY)
      .text(`Setmana ${week.week}  ·  del ${fmtDate(week.from)} al ${fmtDate(week.to)}`, x, m + 19, { lineBreak: false });
    const y = m + 42;
    doc.rect(m, y, tableW / 2, 3).fill(RED);
    doc.rect(m + tableW / 2, y, tableW / 2, 3).fill(GREEN);
    let yy = y + 14;
    doc.rect(m, yy, tableW, rowH).fill(GREEN);
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#ffffff');
    doc.text('PRODUCTE', m + 6, yy + 5, { width: cw[0] - 12, lineBreak: false });
    doc.text('QUANTITAT', m + cw[0], yy + 5, { width: cw[1], align: 'center', lineBreak: false });
    doc.text('ESCOLA', m + cw[0] + cw[1] + 6, yy + 5, { width: cw[2] - 12, lineBreak: false });
    return yy + rowH;
  };

  let y = header();
  const limit = pageH - m - 24;
  let prevSchool = null;
  let zebra = 0;
  for (const r of rows) {
    if (y + rowH > limit) { doc.addPage(); y = header(); prevSchool = null; }
    if (prevSchool !== null && r.school !== prevSchool) {
      // Separació més marcada quan canvia l'escola
      doc.lineWidth(1.2).strokeColor(LEAF).moveTo(m, y).lineTo(m + tableW, y).stroke();
      zebra = 0;
    }
    if (zebra++ % 2) doc.rect(m, y, tableW, rowH).fill(ZEBRA);
    doc.font('Helvetica').fontSize(9.5).fillColor(GRAY)
      .text(r.product, m + 6, y + 5, { width: cw[0] - 12, lineBreak: false, ellipsis: true });
    doc.font('Helvetica-Bold').fillColor(RED)
      .text(r.quantity || '-', m + cw[0], y + 5, { width: cw[1], align: 'center', lineBreak: false, ellipsis: true });
    doc.font(r.school === prevSchool ? 'Helvetica' : 'Helvetica-Bold').fillColor(r.school === prevSchool ? '#8a8a8a' : LEAF)
      .text(r.school, m + cw[0] + cw[1] + 6, y + 5, { width: cw[2] - 12, lineBreak: false, ellipsis: true });
    doc.lineWidth(0.4).strokeColor(BORDER).moveTo(m, y + rowH).lineTo(m + tableW, y + rowH).stroke();
    prevSchool = r.school;
    y += rowH;
  }
  if (!rows.length) {
    doc.font('Helvetica').fontSize(10).fillColor(GRAY).text("No hi ha cap línia marcada per portar a l'escola.", m, y + 10);
  }

  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const fy = pageH - m + 6;
    doc.font('Helvetica-Bold').fontSize(8).fillColor(RED).text('Teca', m, fy, { lineBreak: false, continued: true })
      .fillColor(GRAY).text(' & ', { continued: true }).fillColor(GREEN).text('Xerinola', { lineBreak: false });
    doc.font('Helvetica').fontSize(8).fillColor(GRAY)
      .text(`Pàgina ${i - range.start + 1} de ${range.count}`, pageW - m - 120, fy, { width: 120, align: 'right', lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
  doc.end();
  return done;
}

export function pdfFileName(order, week) {
  const safe = order.provider.name.replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '');
  return `${safe}_${week.week}.pdf`;
}
