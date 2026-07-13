/* Fantasy Studio — royal quotation PDF template (client-side, jsPDF)
   Exports buildQuotePdf(pkg, contact, terms) -> jsPDF document.
   Embeds Noto Sans for the ₹ glyph; falls back to "Rs." if that fails. */

const GOLD  = [184, 144, 43];
const GOLDD = [142, 110, 30];
const CREAM = [251, 246, 234];
const DARK  = [43, 43, 43];
const WHITE = [255, 255, 255];

const PAGE_W = 595.28, PAGE_H = 841.89;
const OUTER = 28, INNER = 36;
const ML = 52, MR = PAGE_W - 52;           // content margins
const FOOTER_TOP = 758;                     // content must stay above this

let jsPDFCtor = null;
let fontsReady = null;                      // null=untried, true/false after attempt
let fontB64 = { normal: null, bold: null };

async function ensureJsPDF(){
  if (window.jspdf && window.jspdf.jsPDF) { jsPDFCtor = window.jspdf.jsPDF; return; }
  await new Promise((res, rej) => {
    const sc = document.createElement('script');
    sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    sc.onload = res; sc.onerror = () => rej(new Error('jsPDF failed to load'));
    document.head.appendChild(sc);
  });
  jsPDFCtor = window.jspdf.jsPDF;
}

async function fetchFontB64(url){
  const r = await fetch(url);
  if (!r.ok) throw new Error('font http ' + r.status);
  const buf = new Uint8Array(await r.arrayBuffer());
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < buf.length; i += CH) bin += String.fromCharCode.apply(null, buf.subarray(i, i + CH));
  return btoa(bin);
}

async function ensureFonts(){
  if (fontsReady !== null) return fontsReady;
  try {
    const base = 'https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts@main/hinted/ttf/NotoSans/';
    const [n, b] = await Promise.all([
      fetchFontB64(base + 'NotoSans-Regular.ttf'),
      fetchFontB64(base + 'NotoSans-Bold.ttf'),
    ]);
    fontB64.normal = n; fontB64.bold = b;
    fontsReady = true;
  } catch (e) { fontsReady = false; }
  return fontsReady;
}

function fmtDateHuman(iso){
  if (!iso) return '';
  try { return new Date(iso + 'T00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch (e) { return iso; }
}

export async function buildQuotePdf(pkg, contact, terms){
  await ensureJsPDF();
  const hasRupee = await ensureFonts();

  const doc = new jsPDFCtor({ unit: 'pt', format: 'a4' });
  if (hasRupee) {
    doc.addFileToVFS('NotoSans-Regular.ttf', fontB64.normal);
    doc.addFont('NotoSans-Regular.ttf', 'NotoSans', 'normal');
    doc.addFileToVFS('NotoSans-Bold.ttf', fontB64.bold);
    doc.addFont('NotoSans-Bold.ttf', 'NotoSans', 'bold');
  }
  const money = n => (hasRupee ? '₹' : 'Rs. ') + Math.round(Number(n) || 0).toLocaleString('en-IN');
  const setMoneyFont = (style, size) => { doc.setFont(hasRupee ? 'NotoSans' : 'helvetica', style); doc.setFontSize(size); };

  /* ---------- drawing helpers ---------- */
  const diamond = (cx, cy, r, rgb) => {
    doc.setFillColor(...rgb);
    doc.triangle(cx - r, cy, cx, cy - r, cx + r, cy, 'F');
    doc.triangle(cx - r, cy, cx, cy + r, cx + r, cy, 'F');
  };
  const flourish = (cy) => { diamond(PAGE_W/2 - 16, cy, 3.4, GOLD); diamond(PAGE_W/2, cy, 4.4, GOLD); diamond(PAGE_W/2 + 16, cy, 3.4, GOLD); };

  const border = () => {
    doc.setDrawColor(...GOLD);
    doc.setLineWidth(2.2);
    doc.rect(OUTER, OUTER, PAGE_W - 2*OUTER, PAGE_H - 2*OUTER);
    doc.setLineWidth(0.9);
    doc.rect(INNER, INNER, PAGE_W - 2*INNER, PAGE_H - 2*INNER);
    [[OUTER, OUTER], [PAGE_W - OUTER, OUTER], [OUTER, PAGE_H - OUTER], [PAGE_W - OUTER, PAGE_H - OUTER]]
      .forEach(([x, y]) => diamond(x, y, 7, GOLD));
  };

  const footer = () => {
    flourish(766);
    doc.setFont('times', 'bold'); doc.setFontSize(11); doc.setTextColor(...DARK);
    doc.text('FANTASY STUDIO', PAGE_W/2, 782, { align: 'center' });
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...GOLD);
    doc.text(String((contact && contact.phone) || '+91 86868 68803'), PAGE_W/2, 796, { align: 'center' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...GOLD);
    doc.text(String((contact && contact.website) || 'www.fantasystudio.in'), PAGE_W/2, 808, { align: 'center' });
  };

  const logo = (cy) => {
    const cx = PAGE_W/2;
    doc.setFillColor(...WHITE); doc.circle(cx, cy, 27, 'F');
    doc.setDrawColor(...GOLD);
    doc.setLineWidth(1.6); doc.circle(cx, cy, 26);
    doc.setLineWidth(0.9); doc.circle(cx, cy, 20);
    [[cx, cy - 26], [cx, cy + 26], [cx - 26, cy], [cx + 26, cy]]
      .forEach(([x, y]) => { doc.setFillColor(...GOLD); doc.circle(x, y, 2.4, 'F'); });
    doc.setFont('times', 'bold'); doc.setFontSize(17); doc.setTextColor(...GOLD);
    doc.text('FS', cx, cy + 6, { align: 'center' });
  };

  const slimHeader = () => {
    doc.setFont('times', 'bold'); doc.setFontSize(11); doc.setTextColor(...GOLD);
    doc.text('FANTASY STUDIO — EVENT QUOTATION', PAGE_W/2, 58, { align: 'center' });
    doc.setDrawColor(...GOLD); doc.setLineWidth(0.7);
    doc.line(ML, 66, MR, 66);
  };

  let y = 0;
  const newPage = () => { doc.addPage(); border(); footer(); slimHeader(); y = 84; };
  const ensure = (h) => { if (y + h > FOOTER_TOP) newPage(); };

  /* ---------- page 1 header ---------- */
  border(); footer();
  logo(84);
  doc.setFont('times', 'bold'); doc.setFontSize(30); doc.setTextColor(...GOLD);
  doc.text('FANTASY STUDIO', PAGE_W/2, 142, { align: 'center' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...DARK);
  doc.text('Wedding Photography & Cinematography  •  Hyderabad', PAGE_W/2, 158, { align: 'center' });
  doc.setDrawColor(...GOLD); doc.setLineWidth(0.8);
  doc.line(PAGE_W/2 - 110, 172, PAGE_W/2 - 12, 172);
  doc.line(PAGE_W/2 + 12, 172, PAGE_W/2 + 110, 172);
  diamond(PAGE_W/2, 172, 4, GOLD);
  doc.setFont('times', 'bold'); doc.setFontSize(16); doc.setTextColor(...GOLD);
  doc.text('EVENT QUOTATION', PAGE_W/2, 194, { align: 'center' });

  /* client block */
  y = 220;
  doc.setFontSize(10.5);
  doc.setFont('helvetica', 'bold'); doc.setTextColor(...DARK);
  doc.text('Client Name :', ML, y);
  doc.setFont('helvetica', 'normal');
  doc.text(String(pkg.clientName || ''), ML + 70, y);
  doc.setFont('helvetica', 'bold');
  doc.text('Date :', MR - 110, y);
  doc.setFont('helvetica', 'normal');
  doc.text(fmtDateHuman(pkg.quoteDate) || fmtDateHuman(new Date().toLocaleDateString('en-CA')), MR - 74, y);
  if (pkg.careOf) {
    y += 15;
    doc.setFont('helvetica', 'bold'); doc.text('C/o :', ML, y);
    doc.setFont('helvetica', 'normal'); doc.text(String(pkg.careOf), ML + 30, y);
  }
  y += 18;

  /* ---------- events ---------- */
  const COL_QTY = 388, COL_RATE = 468, COL_AMT = MR - 4;
  (pkg.events || []).forEach(ev => {
    const rows = (ev.items || []).length;
    ensure(22 + 16 + Math.min(rows, 2) * 18 + 12);

    // gold event bar
    doc.setFillColor(...GOLD);
    doc.rect(ML - 8, y, (MR - ML) + 16, 22, 'F');
    doc.setFont('times', 'bold'); doc.setFontSize(12); doc.setTextColor(...WHITE);
    doc.text(String(ev.title || 'EVENT').toUpperCase(), ML, y + 15);
    const right = [fmtDateHuman(ev.date), ev.venue].filter(Boolean).join('  •  ');
    if (right) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
      doc.text(right, MR, y + 14, { align: 'right' });
    }
    y += 30;

    // table header
    doc.setDrawColor(...GOLD); doc.setLineWidth(0.7);
    doc.line(ML - 8, y - 6, MR + 8, y - 6);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...DARK);
    doc.text('SERVICE', ML, y + 4);
    doc.text('QTY', COL_QTY, y + 4, { align: 'right' });
    doc.text('RATE', COL_RATE, y + 4, { align: 'right' });
    doc.text('AMOUNT', COL_AMT, y + 4, { align: 'right' });
    y += 10;
    doc.setLineWidth(0.5);
    doc.line(ML - 8, y, MR + 8, y);

    (ev.items || []).forEach((it, i) => {
      ensure(18 + 8);
      if (i % 2 === 0) { doc.setFillColor(...CREAM); doc.rect(ML - 8, y, (MR - ML) + 16, 18, 'F'); }
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...DARK);
      doc.text(String(it.service || ''), ML, y + 12.5, { maxWidth: 300 });
      doc.text(String(it.qty || 1), COL_QTY, y + 12.5, { align: 'right' });
      setMoneyFont('normal', 10); doc.setTextColor(...DARK);
      doc.text(money(it.rate), COL_RATE, y + 12.5, { align: 'right' });
      setMoneyFont('bold', 10); doc.setTextColor(...GOLD);
      doc.text(money((Number(it.qty) || 1) * (Number(it.rate) || 0)), COL_AMT, y + 12.5, { align: 'right' });
      y += 18;
    });
    doc.setDrawColor(...GOLD); doc.setLineWidth(0.7);
    doc.line(ML - 8, y, MR + 8, y);
    y += 16;
  });

  /* ---------- album ---------- */
  const alb = pkg.album || {};
  if ((Number(alb.sheets) || 0) > 0 || (Number(alb.price) || 0) > 0) {
    ensure(22 + 26 + 12);
    doc.setFillColor(...GOLD);
    doc.rect(ML - 8, y, (MR - ML) + 16, 22, 'F');
    doc.setFont('times', 'bold'); doc.setFontSize(12); doc.setTextColor(...WHITE);
    doc.text('ALBUM', ML, y + 15);
    if (Number(alb.sheets) > 0) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
      doc.text(`${alb.sheets} SHEETS`, MR, y + 14, { align: 'right' });
    }
    y += 26;
    doc.setFillColor(...CREAM);
    doc.rect(ML - 8, y, (MR - ML) + 16, 18, 'F');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...DARK);
    doc.text('Premium Album' + (Number(alb.sheets) > 0 ? ` — ${alb.sheets} sheets` : ''), ML, y + 12.5);
    setMoneyFont('bold', 10); doc.setTextColor(...GOLD);
    doc.text(money(alb.price || 0), COL_AMT, y + 12.5, { align: 'right' });
    y += 18;
    doc.setDrawColor(...GOLD); doc.setLineWidth(0.7);
    doc.line(ML - 8, y, MR + 8, y);
    y += 16;
  }

  /* ---------- add-ons ---------- */
  const addons = (pkg.addons || []).filter(Boolean);
  if (addons.length) {
    ensure(20 + addons.length * 14);
    doc.setFont('times', 'bold'); doc.setFontSize(11); doc.setTextColor(...GOLDD);
    doc.text('INCLUDED', ML, y + 4);
    y += 14;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...DARK);
    addons.forEach(a => {
      ensure(14);
      diamond(ML + 3, y + 1.5, 2.6, GOLD);
      doc.text(String(a), ML + 12, y + 4, { maxWidth: MR - ML - 20 });
      y += 14;
    });
    y += 6;
  }

  /* ---------- flourish + pricing box ---------- */
  const t = pkg.totals || {};
  const showAdv = (Number(t.advance) || 0) > 0;
  const boxRows = 1 + (showAdv ? 2 : 0);
  const boxH = 14 + boxRows * 20 + 34 + 12;
  ensure(16 + boxH + 10);
  flourish(y + 4); y += 16;

  const BX = PAGE_W/2 - 150, BW = 300;
  doc.setFillColor(...CREAM);
  doc.setDrawColor(...GOLD); doc.setLineWidth(1.2);
  doc.rect(BX, y, BW, boxH, 'FD');
  [[BX, y], [BX + BW, y], [BX, y + boxH], [BX + BW, y + boxH]].forEach(([x, yy]) => diamond(x, yy, 4, GOLD));

  let by = y + 24;
  const boxRow = (label, val, bold) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(10.5); doc.setTextColor(...DARK);
    doc.text(label, BX + 18, by);
    setMoneyFont(bold ? 'bold' : 'normal', 11); doc.setTextColor(...DARK);
    doc.text(money(val), BX + BW - 18, by, { align: 'right' });
    by += 20;
  };
  boxRow('Total Package Price', t.gross || 0, false);
  if (showAdv) {
    boxRow('Advance Received', t.advance || 0, false);
    boxRow('Balance', t.balance || 0, true);
  }
  // gold band with the final price — the largest number on the page
  const bandY = by - 10;
  doc.setFillColor(...GOLD);
  doc.rect(BX + 1, bandY, BW - 2, 34, 'F');
  doc.setFont('times', 'bold'); doc.setFontSize(12); doc.setTextColor(...WHITE);
  doc.text('After Discount', BX + 18, bandY + 22);
  setMoneyFont('bold', 17); doc.setTextColor(...WHITE);
  doc.text(money(t.finalPrice || 0), BX + BW - 18, bandY + 23, { align: 'right' });
  y += boxH + 22;

  /* ---------- terms ---------- */
  const termList = (terms && terms.length ? terms : []).filter(Boolean);
  if (termList.length) {
    ensure(20 + termList.length * 26);
    doc.setFont('times', 'bold'); doc.setFontSize(12); doc.setTextColor(...GOLDD);
    doc.text('TERMS', ML, y + 4);
    y += 18;
    termList.forEach((tm, i) => {
      const lines = doc.splitTextToSize(String(tm), MR - ML - 26);
      ensure(lines.length * 12 + 12);
      doc.setFillColor(...GOLD); doc.circle(ML + 7, y + 2, 7, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...WHITE);
      doc.text(String(i + 1), ML + 7, y + 5, { align: 'center' });
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...DARK);
      doc.text(lines, ML + 22, y + 5);
      y += Math.max(20, lines.length * 12 + 8);
    });
  }

  return doc;
}
