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
    sc.integrity = 'sha384-JcnsjUPPylna1s1fvi1u12X5qjY5OL56iySh75FdtrwhO/SWXgMjoVqcKyIIWOLk';
    sc.crossOrigin = 'anonymous';
    sc.onload = res; sc.onerror = () => rej(new Error('jsPDF failed to load'));
    document.head.appendChild(sc);
  });
  jsPDFCtor = window.jspdf.jsPDF;
}

async function fetchFontB64(url, timeoutMs){
  /* Two ~500 KB TTFs with no timeout: on a stalled connection buildQuotePdf
     hung long enough for the tap's user-activation window to expire, which is
     what made navigator.share() throw NotAllowedError and drop the PDF. */
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const t = ctl ? setTimeout(() => ctl.abort(), timeoutMs || 8000) : null;
  let r;
  try { r = await fetch(url, ctl ? { signal: ctl.signal } : undefined); }
  finally { if (t) clearTimeout(t); }
  if (!r.ok) throw new Error('font http ' + r.status);
  const buf = new Uint8Array(await r.arrayBuffer());
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < buf.length; i += CH) bin += String.fromCharCode.apply(null, buf.subarray(i, i + CH));
  return btoa(bin);
}

let fontsPromise = null;
async function ensureFonts(){
  if (fontsReady === true) return true;
  /* A single failure used to latch fontsReady=false for the whole session, so
     every later PDF silently printed "Rs." instead of ₹ until the app was
     reloaded. A retry is allowed on the next PDF; concurrent calls share one
     in-flight fetch instead of each pulling ~1 MB. */
  if (fontsPromise) return fontsPromise;
  fontsPromise = (async () => {
  try {
    /* pinned release tag — @main is a moving target and could silently change PDF output */
    const base = 'https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts@v20201206-phase3/hinted/ttf/NotoSans/';
    const [n, b] = await Promise.all([
      fetchFontB64(base + 'NotoSans-Regular.ttf'),
      fetchFontB64(base + 'NotoSans-Bold.ttf'),
    ]);
    fontB64.normal = n; fontB64.bold = b;
    fontsReady = true;
  } catch (e) {
    fontsReady = false;
    fontsPromise = null;          // let the next PDF try again
  }
  return fontsReady;
  })();
  return fontsPromise;
}

function fmtDateHuman(iso){
  if (!iso) return '';
  try { return new Date(iso + 'T00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch (e) { return iso; }
}
/* "14 – 16 Aug 2026" when the functions share a month, the two full dates
   when they don't. A three-day wedding should read as one span. */
function fmtDateSpan(dates){
  const ds = dates.filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d || '')).sort();
  if (!ds.length) return '';
  if (ds.length === 1 || ds[0] === ds[ds.length - 1]) return fmtDateHuman(ds[0]);
  const a = ds[0], b = ds[ds.length - 1];
  if (a.slice(0, 7) === b.slice(0, 7)) {
    try {
      const d1 = new Date(a + 'T00:00'), d2 = new Date(b + 'T00:00');
      return d1.getDate() + ' – ' + d2.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch (e) { /* fall through */ }
  }
  return fmtDateHuman(a) + ' – ' + fmtDateHuman(b);
}

export async function buildQuotePdf(pkg, contact, terms){
  await ensureJsPDF();
  const hasRupee = await ensureFonts();
  /* White-label B2B job: the partner studio hands this to THEIR client, so
     every Fantasy Studio mark has to come off — logo, masthead, tagline and
     the contact footer. The admin panel promises exactly this next to the
     checkbox, and the promise was not being kept. */
  const wl = !!(pkg && pkg.whiteLabel);
  const isB2B = !!(pkg && pkg.clientType === 'studio');

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
    if (wl) return;                       // white-label: no studio identity at all
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
    doc.text(wl ? 'EVENT QUOTATION' : 'FANTASY STUDIO — EVENT QUOTATION', PAGE_W/2, 58, { align: 'center' });
    doc.setDrawColor(...GOLD); doc.setLineWidth(0.7);
    doc.line(ML, 66, MR, 66);
  };

  /* A draft that goes out by accident should say so on every page, behind the
     content rather than over it — drawn right after the border, before
     anything else lands on the page. */
  const isDraft = String((pkg && pkg.status) || '') === 'draft';
  const watermark = () => {
    if (!isDraft) return;
    doc.setFont('times', 'bold'); doc.setFontSize(90);
    doc.setTextColor(238, 232, 219);
    try { doc.text('DRAFT', PAGE_W/2, PAGE_H/2 + 30, { align: 'center', angle: 32 }); }
    catch (e) { /* older jsPDF without angle support: skip rather than print it flat */ }
    doc.setTextColor(...DARK);
  };

  let y = 0;
  const newPage = () => { doc.addPage(); border(); watermark(); footer(); slimHeader(); y = 84; };
  const ensure = (h) => { if (y + h > FOOTER_TOP) newPage(); };

  /* ---------- page 1 header ---------- */
  border(); watermark(); footer();
  if (!wl) {
    logo(84);
    doc.setFont('times', 'bold'); doc.setFontSize(30); doc.setTextColor(...GOLD);
    doc.text('FANTASY STUDIO', PAGE_W/2, 142, { align: 'center' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...DARK);
    doc.text('Wedding Photography & Cinematography  \u2022  Hyderabad', PAGE_W/2, 158, { align: 'center' });
  }
  doc.setDrawColor(...GOLD); doc.setLineWidth(0.8);
  doc.line(PAGE_W/2 - 110, 172, PAGE_W/2 - 12, 172);
  doc.line(PAGE_W/2 + 12, 172, PAGE_W/2 + 110, 172);
  diamond(PAGE_W/2, 172, 4, GOLD);
  doc.setFont('times', 'bold'); doc.setFontSize(16); doc.setTextColor(...GOLD);
  doc.text('EVENT QUOTATION', PAGE_W/2, 194, { align: 'center' });

  /* one line that answers "how big is this?" before a page of line items:
     how many functions, over which dates, and the album if there is one */
  const _evs = (pkg.events || []);
  const _span = fmtDateSpan(_evs.map(e => e.date));
  const _albSheets = Number((pkg.album || {}).sheets) || 0;
  const _summary = [
    _evs.length ? _evs.length + (_evs.length === 1 ? ' function' : ' functions') : '',
    _span,
    _albSheets > 0 ? _albSheets + '-sheet album' : ''
  ].filter(Boolean).join('   •   ');
  if (_summary) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...GOLDD);
    doc.text(_summary, PAGE_W/2, 210, { align: 'center' });
  }

  /* client block */
  y = _summary ? 234 : 220;
  doc.setFontSize(10.5);
  doc.setFont('helvetica', 'bold'); doc.setTextColor(...DARK);
  doc.text('Client Name :', ML, y);
  doc.setFont('helvetica', 'normal');
  /* On a white-label job pkg.clientName is the PARTNER STUDIO — printing it
     on the sheet they hand to their own couple makes no sense. Use the end
     client when one was entered. */
  doc.text(String((wl && pkg.endClientName) || pkg.clientName || ''), ML + 70, y);
  doc.setFont('helvetica', 'bold');
  doc.text('Date :', MR - 110, y);
  doc.setFont('helvetica', 'normal');
  doc.text(fmtDateHuman(pkg.quoteDate) || fmtDateHuman(new Date().toLocaleDateString('en-CA')), MR - 74, y);
  if (pkg.careOf) {
    y += 15;
    doc.setFont('helvetica', 'bold'); doc.text('C/o :', ML, y);
    doc.setFont('helvetica', 'normal'); doc.text(String(pkg.careOf), ML + 30, y);
  }
  if (pkg.quoteNo) {
    doc.setFont('helvetica', 'bold');
    doc.text('Quote No :', MR - 110, y + (pkg.careOf ? 0 : 15));
    doc.setFont('helvetica', 'normal');
    doc.text(String(pkg.quoteNo), MR - 55, y + (pkg.careOf ? 0 : 15));
    if (!pkg.careOf) y += 15;
  }
  y += 18;

  /* ---------- events ---------- */
  const COL_QTY = 388, COL_RATE = 468, COL_AMT = MR - 4;
  const multiEvent = (pkg.events || []).length > 1;
  (pkg.events || []).forEach((ev, evIdx) => {
    const rows = (ev.items || []).length;
    ensure(22 + 16 + Math.min(rows, 2) * 18 + 12 + (multiEvent ? 16 : 0));

    // gold event bar
    doc.setFillColor(...GOLD);
    doc.rect(ML - 8, y, (MR - ML) + 16, 22, 'F');
    doc.setFont('times', 'bold'); doc.setFontSize(12); doc.setTextColor(...WHITE);
    /* numbered on a multi-day booking, so the couple can see it is day 2 of 3 */
    doc.text((multiEvent ? (evIdx + 1) + '.  ' : '') + String(ev.title || 'EVENT').toUpperCase(), ML, y + 15);
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
    /* what this one function costs. With a single event it would just repeat
       the package total two inches further down, so it is only for a booking
       that actually has several. */
    const evTotal = (ev.items || []).reduce((s, it) => s + (Number(it.qty) || 1) * (Number(it.rate) || 0), 0);
    if (multiEvent && evTotal > 0) {
      ensure(18);
      doc.setDrawColor(...GOLD); doc.setLineWidth(0.4);
      doc.line(COL_QTY - 30, y, MR + 8, y);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...DARK);
      doc.text('Event total', COL_RATE, y + 13, { align: 'right' });
      setMoneyFont('bold', 10.5); doc.setTextColor(...GOLDD);
      doc.text(money(evTotal), COL_AMT, y + 13, { align: 'right' });
      y += 18;
    }
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
    const perSheet = Number(alb.perSheet) || (Number(alb.sheets) > 0 ? Math.round((Number(alb.price) || 0) / Number(alb.sheets)) : 0);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...DARK);
    doc.text('Premium Album', ML, y + 12.5);
    doc.text(String(alb.sheets || ''), COL_QTY, y + 12.5, { align: 'right' });
    setMoneyFont('normal', 10); doc.setTextColor(...DARK);
    if (perSheet > 0) doc.text(money(perSheet), COL_RATE, y + 12.5, { align: 'right' });
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
  const gross = Number(t.gross) || 0;
  const fin = Number(t.finalPrice) || 0;
  const disc = Math.max(0, Number(t.discount) || (gross - fin));
  const hasDisc = disc > 0;                    // no discount → one clean price, no duplicate rows
  const showAdv = (Number(t.advance) || 0) > 0;
  const bandY0 = 14 + (hasDisc ? 40 : 0);      // band offset inside the box
  const boxH = bandY0 + 34 + (showAdv ? 56 : 12);
  ensure(16 + boxH + 10);
  flourish(y + 4); y += 16;

  const BX = PAGE_W/2 - 150, BW = 300;
  doc.setFillColor(...CREAM);
  doc.setDrawColor(...GOLD); doc.setLineWidth(1.2);
  doc.rect(BX, y, BW, boxH, 'FD');
  [[BX, y], [BX + BW, y], [BX, y + boxH], [BX + BW, y + boxH]].forEach(([x, yy]) => diamond(x, yy, 4, GOLD));

  let by = y + 24;
  const boxRow = (label, valTxt, bold, rgb) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(10.5); doc.setTextColor(...DARK);
    doc.text(label, BX + 18, by);
    setMoneyFont(bold ? 'bold' : 'normal', 11); doc.setTextColor(...(rgb || DARK));
    doc.text(valTxt, BX + BW - 18, by, { align: 'right' });
    by += 20;
  };
  if (hasDisc) {
    boxRow('Package Total', money(gross), false);
    boxRow('Discount', '- ' + money(disc), false, GOLDD);
  }
  // gold band with the final price — the largest number on the page
  const bandY = y + bandY0;
  doc.setFillColor(...GOLD);
  doc.rect(BX + 1, bandY, BW - 2, 34, 'F');
  doc.setFont('times', 'bold'); doc.setFontSize(12); doc.setTextColor(...WHITE);
  doc.text(hasDisc ? 'After Discount' : 'Total Package Price', BX + 18, bandY + 22);
  setMoneyFont('bold', 17); doc.setTextColor(...WHITE);
  doc.text(money(fin), BX + BW - 18, bandY + 23, { align: 'right' });
  // advance + balance sit under the band so the split is unmistakable
  if (showAdv) {
    by = bandY + 34 + 20;
    boxRow('Advance Received', money(t.advance || 0), false);
    boxRow('Balance Due', money(t.balance || 0), true);
  }
  y += boxH + 22;

  /* ---------- terms ---------- */
  let termList = (terms && terms.length ? terms : []).filter(Boolean).slice();
  /* advance entered -> the generic payment term is replaced by the real split:
     remaining on the event day + 10% of the final price at delivery */
  const advAmt = Number(t.advance) || 0;
  /* B2B jobs run on the partner studio's own payment terms — injecting the
     retail "balance on event day + 10% at delivery" split contradicted them */
  if (advAmt > 0 && !isB2B) {
    const delivery = Math.round(fin * 0.10);
    const eventDay = Math.max(0, fin - advAmt - delivery);
    termList = termList.filter(tm => !/^50% advance/i.test(String(tm)));
    termList.unshift(`Advance received: ${money(advAmt)}. Balance ${money(eventDay)} payable on the event day and ${money(delivery)} (10%) at the time of delivery.`);
  }
  if (termList.length) {
    ensure(20 + termList.length * 26);
    doc.setFont('times', 'bold'); doc.setFontSize(12); doc.setTextColor(...GOLDD);
    doc.text('TERMS', ML, y + 4);
    y += 18;
    termList.forEach((tm, i) => {
      setMoneyFont('normal', 9.5);
      const lines = doc.splitTextToSize(String(tm), MR - ML - 26);
      ensure(lines.length * 12 + 12);
      doc.setFillColor(...GOLD); doc.circle(ML + 7, y + 2, 7, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...WHITE);
      doc.text(String(i + 1), ML + 7, y + 5, { align: 'center' });
      setMoneyFont('normal', 9.5); doc.setTextColor(...DARK);
      doc.text(lines, ML + 22, y + 5);
      y += Math.max(20, lines.length * 12 + 8);
    });
  }

  /* ---------- acceptance ----------
     Only while the quotation is still an offer. On a booked or delivered
     package a signature line invites the couple to agree to something they
     agreed to months ago. */
  const _st = String((pkg && pkg.status) || 'draft');
  if (_st === 'draft' || _st === 'sent' || _st === 'unconfirmed') {
    ensure(52);
    y += 12;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...GOLDD);
    doc.text('Happy to go ahead? Sign below and send this back, or simply confirm on WhatsApp.', ML, y);
    y += 26;
    doc.setDrawColor(...GOLD); doc.setLineWidth(0.6);
    doc.line(ML, y, ML + 190, y);
    doc.line(MR - 150, y, MR, y);
    doc.setFontSize(8); doc.setTextColor(...DARK);
    doc.text('Client signature', ML, y + 12);
    doc.text('Date', MR - 150, y + 12);
  }

  /* ---------- page numbers ----------
     Added last, because the total is only known once the document is built.
     A three-day wedding runs to several pages and they arrive as loose
     printouts otherwise. */
  const pageCount = doc.internal.getNumberOfPages();
  if (pageCount > 1) {
    for (let p = 1; p <= pageCount; p++) {
      doc.setPage(p);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...GOLDD);
      doc.text('Page ' + p + ' of ' + pageCount, MR, 768, { align: 'right' });
      if (pkg.quoteNo) doc.text(String(pkg.quoteNo), ML, 768);
    }
  }

  return doc;
}
