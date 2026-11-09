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

    // Capçalera de l'escola
    doc.save().roundedRect(x, y, blockW, headerH + 6, 5).clip();
    doc.rect(x, y, blockW, headerH).fill(GREEN);
    doc.restore();
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#ffffff')
      .text(block.name, x, y + 5.5, { width: blockW, align: 'center', lineBreak: false, ellipsis: true });
    let yy = y + headerH;
    doc.rect(x, yy, blockW, subH).fill(LIGHT);
    doc.font('Helvetica-Bold').fontSize(7).fillColor(LEAF);
    doc.text('PRODUCTE', x + 4, yy + 4, { width: colW[0] - 8, lineBreak: false });
    doc.text('QUANTITAT', x + colW[0], yy + 4, { width: colW[1], align: 'center', lineBreak: false });
    doc.text('SERVIR DIA', x + colW[0] + colW[1], yy + 4, { width: colW[2], align: 'center', lineBreak: false });
    yy += subH;

    block.items.forEach((it, i) => {
      if (i % 2) doc.rect(x, yy, blockW, rowH).fill(ZEBRA);
      doc.font('Helvetica').fontSize(8).fillColor(GRAY);
      cell(it.product + (it.note ? ` (${it.note})` : ''), x, yy, colW[0]);
      doc.font('Helvetica-Bold').fillColor(RED);
      cell((it.quantity || '').toUpperCase(), x + colW[0], yy, colW[1], { align: 'center' });
      doc.font('Helvetica').fillColor(GRAY);
      cell(formatDay(it.day, week), x + colW[0] + colW[1], yy, colW[2], { align: 'center' });
      doc.lineWidth(0.4).strokeColor(BORDER).moveTo(x, yy + rowH).lineTo(x + blockW, yy + rowH).stroke();
      yy += rowH;
    });
    doc.lineWidth(0.8).strokeColor(BORDER).rect(x, y + headerH, blockW, yy - y - headerH).stroke();
    doc.lineWidth(0.4).moveTo(x + colW[0], y + headerH).lineTo(x + colW[0], yy).stroke();
    doc.moveTo(x + colW[0] + colW[1], y + headerH).lineTo(x + colW[0] + colW[1], yy).stroke();

    rowMaxH = Math.max(rowMaxH, yy - y);
    col++;
    if (col === cols) {
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

export function pdfFileName(order, week) {
  const safe = order.provider.name.replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '');
  return `${safe}_${week.week}.pdf`;
}
