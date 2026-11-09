// Agrupa les comandes confirmades per proveïdor i genera PDF i text (WhatsApp).
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

const BLUE = '#1b8fd0';
const MAX_ROWS = 34;

export function orderPdf(order, week) {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 28 });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const m = 28;
  const gap = 18;
  const cols = 3;
  const blockW = (pageW - m * 2 - gap * (cols - 1)) / cols;
  const colW = [blockW * 0.56, blockW * 0.22, blockW * 0.22];
  const headerH = 22;
  const subH = 14;
  const rowH = 13;

  const title = () => {
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#000')
      .text(`${order.provider.name} — COMANDA ${weekLabel(week).toUpperCase()}`, m, m, { width: pageW - m * 2 });
    return m + 26;
  };

  // Blocs (una escola pot ocupar més d'un bloc si demana molts productes)
  const blocks = [];
  for (const { school, items } of order.schools) {
    for (let i = 0; i < items.length; i += MAX_ROWS) {
      blocks.push({ name: school.name.toUpperCase() + (i ? ' (cont.)' : ''), items: items.slice(i, i + MAX_ROWS) });
    }
  }

  let y = title();
  let col = 0;
  let rowMaxH = 0;
  const cell = (text, x, yy, w, opts = {}) => {
    doc.text(String(text ?? ''), x + 3, yy + 3, { width: w - 6, height: rowH - 2, ellipsis: true, lineBreak: false, ...opts });
  };

  for (const block of blocks) {
    const h = headerH + subH + block.items.length * rowH;
    if (col === 0 && y + h > pageH - m) {
      doc.addPage();
      y = title();
    }
    const x = m + col * (blockW + gap);

    // Capçalera escola
    doc.rect(x, y, blockW, headerH).fill(BLUE);
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#fff')
      .text(block.name, x, y + 5, { width: blockW, align: 'center', lineBreak: false, ellipsis: true });
    // Subcapçalera
    let yy = y + headerH;
    doc.rect(x, yy, blockW, subH).fill('#d9d9d9');
    doc.font('Helvetica-Bold').fontSize(7).fillColor('#000');
    doc.text('PRODUCTE', x + 3, yy + 4, { width: colW[0] - 6, lineBreak: false });
    doc.text('QUANTITAT', x + colW[0], yy + 4, { width: colW[1], align: 'center', lineBreak: false });
    doc.text('SERVIR DIA', x + colW[0] + colW[1], yy + 4, { width: colW[2], align: 'center', lineBreak: false });
    yy += subH;

    doc.font('Helvetica').fontSize(8);
    for (const it of block.items) {
      doc.fillColor('#c00000');
      cell(it.product + (it.note ? ` (${it.note})` : ''), x, yy, colW[0]);
      cell((it.quantity || '').toUpperCase(), x + colW[0], yy, colW[1], { align: 'center' });
      cell(formatDay(it.day, week), x + colW[0] + colW[1], yy, colW[2], { align: 'center' });
      doc.lineWidth(0.4).strokeColor('#000').moveTo(x, yy + rowH).lineTo(x + blockW, yy + rowH).stroke();
      yy += rowH;
    }
    // Vores
    doc.lineWidth(1).strokeColor('#000').rect(x, y, blockW, yy - y).stroke();
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
  doc.end();
  return done;
}

export function pdfFileName(order, week) {
  const safe = order.provider.name.replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '');
  return `${safe}_${week.week}.pdf`;
}
