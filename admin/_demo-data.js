/* =============================================================================
   DEMO FIXTURES — localhost only, never deployed
   =============================================================================
   Invented data for working on the panel's UI without signing in to the real
   account. Loaded only by the demo branch at the end of app.js, which itself
   only runs on localhost with ?demo in the URL. This file is excluded from the
   Vercel bundle, so on fantasystudio.in it does not exist to be fetched.

   Every name, number and rupee here is made up.

   The point of these rows is NOT to look tidy — it is to break layouts the way
   real records do. Deliberately included:
     · a 39-character client name, and a 4-function wedding on ONE date
     · a package with six events spread across five months
     · ₹8,50,000 (seven glyphs before the decimal) and a ₹0 balance
     · an overpaid package, so the money tiles go negative somewhere
     · a B2B white-label job, and a B2B job with an end-client name
     · an event with no venue, and a lead with no wedding date
     · a shoot TODAY and one TOMORROW, so Home's next-shoot block populates
     · an event needing 3 crew that has 1, so the crew-gap arithmetic bites
     · a team member with no phone (the "⚠ no phone" branch)
     · an inactive crew member and an inactive studio
     · two leads sharing one phone number (the duplicate-lead pill)
     · a quote sent 11 days ago (the follow-up list wants >= 3)
   ========================================================================== */

const DAY = 864e5;
const base = new Date(); base.setHours(9, 0, 0, 0);

/* Firestore hands back Timestamps, and the panel calls .toDate()/.toMillis()
   on them. Anything standing in for one has to answer the same two calls. */
const ts = daysAgo => {
  const d = new Date(base.getTime() - daysAgo * DAY);
  return { toDate: () => d, toMillis: () => d.getTime() };
};
/* YYYY-MM-DD, which is what every date field in this schema stores */
const iso = daysAhead =>
  new Date(base.getTime() + daysAhead * DAY).toLocaleDateString('en-CA');

const money = (final, advance) => ({
  gross: final, discount: 0, finalPrice: final,
  advance, balance: final - advance
});
const pay = (amount, daysAgo, mode) => ({
  id: 'pm' + amount + daysAgo, amount, date: iso(-daysAgo), mode
});
const shoot = (services) => services.map(([service, qty, rate]) => ({ service, qty, rate }));

/* --------------------------------------------------------------- packages */
export const packages = [
  {
    id: 'pk01', quoteNo: 'FS-2026-041', clientName: 'Vikram Rao', clientPhone: '9876543210',
    clientType: 'direct', status: 'booked', createdAt: ts(46),
    events: [
      { date: iso(0), title: 'Haldi', slot: 'morning', venue: 'Taj Krishna, Banjara Hills',
        items: shoot([['Photography', 2, 18000], ['Cinematography', 1, 25000]]) },
      { date: iso(0), title: 'Sangeet', slot: 'evening', venue: 'Taj Krishna, Banjara Hills',
        items: shoot([['Photography', 2, 18000], ['Cinematography', 2, 25000], ['LED Wall', 1, 30000]]) },
      { date: iso(1), title: 'Wedding', slot: 'morning', venue: 'Taj Krishna, Banjara Hills',
        items: shoot([['Photography', 3, 18000], ['Cinematography', 2, 25000], ['Drone', 1, 22000]]) },
    ],
    totals: money(310000, 200000),
    payments: [pay(150000, 44, 'UPI'), pay(50000, 6, 'Bank transfer')],
    delivery: [{ step: 'RAW handover', date: iso(-2) }, { step: 'Photo selection', date: iso(-1) }],
  },
  {
    /* the long-name case: 39 characters, and four functions on ONE date */
    id: 'pk02', quoteNo: 'FS-2026-038', clientName: 'Lakshmi Priyanka & Venkata Subrahmanyam',
    clientPhone: '9701122334', clientType: 'direct', status: 'booked', createdAt: ts(88),
    events: [
      { date: iso(12), title: 'Mehendi', slot: 'morning', venue: 'Novotel HICC',
        items: shoot([['Photography', 2, 18000]]) },
      { date: iso(13), title: 'Haldi', slot: 'morning', venue: 'Novotel HICC',
        items: shoot([['Photography', 2, 18000], ['Cinematography', 1, 25000]]) },
      { date: iso(13), title: 'Nikah', slot: 'evening', venue: 'Novotel HICC',
        items: shoot([['Photography', 3, 18000], ['Cinematography', 2, 25000], ['Drone', 1, 22000]]) },
      { date: iso(13), title: 'Reception', slot: 'evening', venue: 'Novotel HICC',
        items: shoot([['Photography', 3, 18000], ['Cinematography', 2, 25000], ['LED Wall', 1, 30000]]) },
    ],
    totals: money(850000, 300000),   /* the seven-glyph amount */
    payments: [pay(300000, 80, 'Bank transfer')],
    delivery: [],
  },
  {
    /* six events across five months — the "how far does the meta line stretch" case */
    id: 'pk03', quoteNo: 'FS-2026-029', clientName: 'Aisha Fatima', clientPhone: '9848012345',
    clientType: 'direct', status: 'booked', createdAt: ts(120),
    events: [
      { date: iso(-40), title: 'Engagement', slot: 'evening', venue: 'Park Hyatt',
        items: shoot([['Photography', 2, 18000]]) },
      { date: iso(4), title: 'Mehendi', slot: 'morning', venue: '',   /* no venue on purpose */
        items: shoot([['Photography', 1, 18000]]) },
      { date: iso(5), title: 'Nikah', slot: 'morning', venue: 'Falaknuma Palace',
        items: shoot([['Photography', 3, 18000], ['Cinematography', 2, 25000]]) },
      { date: iso(5), title: 'Walima', slot: 'evening', venue: 'Falaknuma Palace',
        items: shoot([['Photography', 2, 18000], ['Cinematography', 1, 25000]]) },
      { date: iso(64), title: 'Post-wedding shoot', slot: 'morning', venue: 'Golconda Fort',
        items: shoot([['Photography', 1, 18000]]) },
      { date: iso(96), title: 'Reception (Vijayawada)', slot: 'evening', venue: 'Gateway Hotel',
        items: shoot([['Photography', 2, 18000], ['Cinematography', 1, 25000]]) },
    ],
    totals: money(495000, 495000),   /* fully paid: the PAID badge, ₹0 balance */
    payments: [pay(250000, 115, 'Bank transfer'), pay(245000, 21, 'UPI')],
    delivery: [{ step: 'RAW handover', date: iso(-30) }],
  },
  {
    /* B2B, white-label */
    id: 'pk04', quoteNo: 'FS-2026-044', clientName: 'Lumiere Weddings', clientPhone: '',
    clientType: 'studio', studioId: 'st01', studioName: 'Lumiere Weddings',
    endClientName: 'Rohit & Deepika', whiteLabel: true,
    status: 'booked', createdAt: ts(30),
    events: [
      { date: iso(2), title: 'Wedding (crew on hire)', slot: 'morning', venue: 'Ramoji Film City',
        items: shoot([['Cinematography', 2, 25000], ['Drone', 1, 22000]]) },
    ],
    totals: money(180000, 90000),
    payments: [pay(90000, 25, 'Bank transfer')],
    delivery: [],
  },
  {
    /* B2B without white-label, and OVERPAID — balance goes negative upstream */
    id: 'pk05', quoteNo: 'FS-2026-035', clientName: 'Aperture Films', clientPhone: '',
    clientType: 'studio', studioId: 'st02', studioName: 'Aperture Films',
    endClientName: 'Sana & Imran', whiteLabel: false,
    status: 'delivered', createdAt: ts(150), deliveredAt: iso(-12),
    events: [
      { date: iso(-58), title: 'Reception', slot: 'evening', venue: 'HICC Novotel',
        items: shoot([['Photography', 2, 18000], ['Cinematography', 1, 25000]]) },
    ],
    totals: { gross: 145000, discount: 5000, finalPrice: 140000, advance: 145000, balance: -5000 },
    payments: [pay(70000, 140, 'UPI'), pay(75000, 30, 'Cash')],
    delivery: [
      { step: 'RAW handover', date: iso(-40) }, { step: 'Photo selection', date: iso(-30) },
      { step: 'Album design', date: iso(-20) }, { step: 'Album print', date: iso(-14) },
      { step: 'Final delivery', date: iso(-12) },
    ],
  },
  {
    /* sent 11 days ago — the follow-up list wants >= 3 */
    id: 'pk06', quoteNo: 'FS-2026-047', clientName: 'Sneha Reddy', clientPhone: '9885566778',
    clientType: 'direct', status: 'sent', createdAt: ts(14), sentAt: iso(-11),
    events: [
      { date: iso(74), title: 'Wedding', slot: 'morning', venue: 'Kancharapalem Gardens',
        items: shoot([['Photography', 2, 18000], ['Cinematography', 1, 25000]]) },
    ],
    totals: money(180000, 0), payments: [], delivery: [],
  },
  {
    id: 'pk07', quoteNo: 'FS-2026-048', clientName: 'Harshavardhan Reddy', clientPhone: '9963321100',
    clientType: 'direct', status: 'sent', createdAt: ts(6), sentAt: iso(-4),
    events: [
      { date: iso(110), title: 'Wedding', slot: 'evening', venue: 'Leonia Resorts',
        items: shoot([['Photography', 3, 18000], ['Cinematography', 2, 25000], ['Drone', 1, 22000]]) },
    ],
    totals: money(420000, 0), payments: [], delivery: [],
  },
  {
    id: 'pk08', quoteNo: 'FS-2026-046', clientName: 'Nikhil & Meghana', clientPhone: '9032145678',
    clientType: 'direct', status: 'unconfirmed', createdAt: ts(20),
    events: [
      { date: iso(38), title: 'Wedding', slot: 'morning', venue: 'Shilpakala Vedika',
        items: shoot([['Photography', 2, 18000], ['Cinematography', 1, 25000]]) },
    ],
    totals: money(235000, 25000), payments: [pay(25000, 18, 'UPI')], delivery: [],
  },
  {
    id: 'pk09', quoteNo: 'FS-2026-049', clientName: 'Rahul Nair', clientPhone: '9700099887',
    clientType: 'direct', status: 'draft', createdAt: ts(2),
    events: [{ date: iso(130), title: 'Wedding', slot: 'morning', venue: '',
               items: shoot([['Photography', 2, 18000]]) }],
    totals: money(160000, 0), payments: [], delivery: [],
  },
  {
    id: 'pk10', quoteNo: 'FS-2026-050', clientName: 'Divya Sree', clientPhone: '9160055443',
    clientType: 'direct', status: 'draft', createdAt: ts(1),
    events: [], totals: money(0, 0), payments: [], delivery: [],   /* a draft with NO events yet */
  },
  {
    id: 'pk11', quoteNo: 'FS-2026-031', clientName: 'Praveen Kumar', clientPhone: '9394455667',
    clientType: 'direct', status: 'delivered', createdAt: ts(200), deliveredAt: iso(-45),
    events: [{ date: iso(-90), title: 'Wedding', slot: 'morning', venue: 'Daspalla Hotel',
               items: shoot([['Photography', 2, 18000], ['Cinematography', 1, 25000]]) }],
    totals: money(265000, 265000),
    payments: [pay(130000, 195, 'Bank transfer'), pay(135000, 60, 'Bank transfer')],
    delivery: [
      { step: 'RAW handover', date: iso(-80) }, { step: 'Photo selection', date: iso(-70) },
      { step: 'Album design', date: iso(-60) }, { step: 'Album print', date: iso(-50) },
      { step: 'Final delivery', date: iso(-45) },
    ],
  },
  {
    /* in the trash, so the Trash section is not empty */
    id: 'pk12', quoteNo: 'FS-2026-022', clientName: 'Cancelled Booking', clientPhone: '9000011122',
    clientType: 'direct', status: 'draft', createdAt: ts(60),
    deleted: true, deletedAt: iso(-9),
    events: [], totals: money(90000, 0), payments: [], delivery: [],
  },
];

/* ------------------------------------------------------------------ leads */
export const leads = [
  { id: 'ld01', name: 'Priya & Arjun', phone: '9848011223', phoneFull: '919848011223',
    source: 'contact_form', status: 'new', createdAt: ts(1),
    eventType: 'Wedding', weddingDate: iso(95), grandTotal: 245000,
    message: 'Need photography and cinematography for a 3-day wedding in November.', notes: '' },
  /* same number as the one above — the duplicate-lead pill */
  { id: 'ld02', name: 'Priya Sharma', phone: '9848011223', phoneFull: '919848011223',
    source: 'package_builder', status: 'contacted', createdAt: ts(3),
    eventType: 'Wedding', weddingDate: iso(95), grandTotal: 260000, message: '', notes: 'Called — comparing quotes.' },
  { id: 'ld03', name: 'Sai Charan', phone: '9985566771', phoneFull: '919985566771',
    source: 'contact_form', status: 'new', createdAt: ts(2),
    eventType: 'Engagement', weddingDate: '', grandTotal: 0,   /* no date on purpose */
    message: 'Engagement shoot, budget around 60k.', notes: '' },
  { id: 'ld04', name: 'Mohammed Abdul Raheem', phone: '9704433221', phoneFull: '919704433221',
    source: 'contact_form', status: 'contacted', createdAt: ts(5),
    eventType: 'Nikah + Walima', weddingDate: iso(140), grandTotal: 380000, message: '', notes: '' },
  { id: 'ld05', name: 'Anjali Verma', phone: '9440099887', phoneFull: '919440099887',
    source: 'package_builder', status: 'converted', createdAt: ts(48),
    eventType: 'Wedding', weddingDate: iso(1), grandTotal: 310000, message: '', notes: '',
    pkgId: 'pk01', quoteNo: 'FS-2026-041' },
  { id: 'ld06', name: 'Kiran Bethi', phone: '9391122334', phoneFull: '919391122334',
    source: 'contact_form', status: 'booked', createdAt: ts(90),
    eventType: 'Wedding', weddingDate: iso(13), grandTotal: 850000, message: '', notes: '' },
  { id: 'ld07', name: 'Swathi Reddy', phone: '9866554433', phoneFull: '919866554433',
    source: 'contact_form', status: 'lost', createdAt: ts(70),
    eventType: 'Reception', weddingDate: iso(-20), grandTotal: 120000, message: '', notes: 'Went with another studio on price.' },
  /* the ONE lead carrying a real builder quote — without it the
     builder → package conversion path cannot be exercised at all, and it is a
     different branch from a plain enquiry (services and rates already chosen,
     so the editor opens priced rather than blank) */
  { id: 'ld08', name: 'Tarun Chowdary', phone: '9550066778', phoneFull: '919550066778',
    source: 'package_builder', status: 'new', createdAt: ts(4),
    eventType: 'Pre-wedding', weddingDate: iso(60), grandTotal: 95000, message: '', notes: '',
    quote: {
      albumSheets: 20,
      events: [
        { type: 'Pre-wedding', date: iso(60),
          services: { candidPhotography: 1, cinematography: 1 } },
        { type: 'Reception', date: iso(62),
          services: { traditionalPhoto: 2, traditionalVideo: 1, drone: 1 } },
      ],
    } },
  { id: 'ld09', name: 'Fatima Begum', phone: '9177788990', phoneFull: '919177788990',
    source: 'contact_form', status: 'delivered', createdAt: ts(210),
    eventType: 'Wedding', weddingDate: iso(-90), grandTotal: 265000, message: '', notes: '' },
  { id: 'ld10', name: 'Ramesh Goud', phone: '9848776655', phoneFull: '919848776655',
    source: 'contact_form', status: 'shot', createdAt: ts(60),
    eventType: 'Wedding', weddingDate: iso(-58), grandTotal: 140000, message: '', notes: '' },
  { id: 'ld11', name: 'Deleted Enquiry', phone: '9000000000', phoneFull: '919000000000',
    source: 'contact_form', status: 'new', createdAt: ts(30), deleted: true, deletedAt: iso(-5),
    eventType: '', weddingDate: '', grandTotal: 0, message: '', notes: '' },
];

/* ------------------------------------------------------------------- team */
export const team = [
  { id: 'tm01', name: 'Vikas Sharma',    phone: '+919848001122', phone10: '9848001122',
    role: 'photography',     cat: 'outdoor', active: true,  defaultRate: 18000 },
  { id: 'tm02', name: 'Imran Qureshi',   phone: '+919701002233', phone10: '9701002233',
    role: 'cinematography',  cat: 'outdoor', active: true,  defaultRate: 25000 },
  { id: 'tm03', name: 'Sandeep Yadav',   phone: '+919885003344', phone10: '9885003344',
    role: 'photography',     cat: 'outdoor', active: true,  defaultRate: 16000 },
  { id: 'tm04', name: 'Naveen Kumar',    phone: '+919963004455', phone10: '9963004455',
    role: 'drone',           cat: 'outdoor', active: true,  defaultRate: 22000 },
  { id: 'tm05', name: 'Bhavani Priya',   phone: '+919032005566', phone10: '9032005566',
    role: 'editing',         cat: 'office',  active: true,  defaultRate: 12000 },
  { id: 'tm06', name: 'Arun Teja',       phone: '+919440006677', phone10: '9440006677',
    role: 'cinematography',  cat: 'outdoor', active: true,  defaultRate: 24000 },
  /* no phone at all — the "⚠ no phone" branch, and no Call/WhatsApp buttons */
  { id: 'tm07', name: 'Rakesh (new hire)', phone: '', phone10: '',
    role: 'assistant',       cat: 'outdoor', active: true,  defaultRate: 6000 },
  { id: 'tm08', name: 'Sunitha Rao',     phone: '+919177007788', phone10: '9177007788',
    role: 'album design',    cat: 'office',  active: true,  defaultRate: 9000 },
  /* inactive — the greyed row and the "inactive" chip */
  { id: 'tm09', name: 'Girish Patnaik',  phone: '+919394008899', phone10: '9394008899',
    role: 'photography',     cat: 'outdoor', active: false, defaultRate: 15000 },
];

/* ------------------------------------------------------------ assignments */
const asg = (id, pkgId, m, date, eventTitle, role, status, fee, got, kind) => ({
  id, pkgId, memberId: m.id, memberName: m.name, memberPhone10: m.phone10,
  date, eventTitle, role, status, ...(kind ? { kind } : {}),
  pay: { amount: fee, paidAmount: got, paid: got >= fee && fee > 0,
         payments: got ? [{ id: 'cp' + id, amount: got, date: iso(-3), mode: 'UPI' }] : [] },
});
export const assignments = [
  /* today's Haldi — fully crewed and acknowledged */
  asg('as01', 'pk01', team[0], iso(0), 'Haldi', 'photography', 'acknowledged', 18000, 18000),
  asg('as02', 'pk01', team[1], iso(0), 'Haldi', 'cinematography', 'acknowledged', 25000, 0),
  /* today's Sangeet — wants 2 photo + 2 cine + LED, has 2 people: a real gap */
  asg('as03', 'pk01', team[0], iso(0), 'Sangeet', 'photography', 'acknowledged', 18000, 0),
  asg('as04', 'pk01', team[5], iso(0), 'Sangeet', 'cinematography', 'pending', 24000, 0),
  /* tomorrow's Wedding — wants 3 photo + 2 cine + drone, has 2: the biggest gap */
  asg('as05', 'pk01', team[2], iso(1), 'Wedding', 'photography', 'pending', 16000, 0),
  asg('as06', 'pk01', team[3], iso(1), 'Wedding', 'drone', 'acknowledged', 22000, 0),
  /* the B2B job in 2 days — crew on hire */
  asg('as07', 'pk04', team[1], iso(2), 'Wedding (crew on hire)', 'cinematography', 'acknowledged', 25000, 12500),
  asg('as08', 'pk04', team[3], iso(2), 'Wedding (crew on hire)', 'drone', 'acknowledged', 22000, 0),
  /* the four-function wedding in 12-13 days, barely staffed */
  asg('as09', 'pk02', team[0], iso(12), 'Mehendi', 'photography', 'pending', 18000, 0),
  asg('as10', 'pk02', team[2], iso(13), 'Nikah', 'photography', 'pending', 16000, 0),
  asg('as11', 'pk02', team[1], iso(13), 'Reception', 'cinematography', 'pending', 25000, 0),
  /* editing work — kind:'edit', which must NOT count as crew on the day */
  asg('as12', 'pk03', team[4], iso(5), 'Nikah', 'editing', 'acknowledged', 12000, 12000, 'edit'),
  asg('as13', 'pk05', team[7], iso(-58), 'Reception', 'album design', 'acknowledged', 9000, 9000, 'edit'),
  /* past work, part-paid — so the crew-pay section has something owed */
  asg('as14', 'pk11', team[0], iso(-90), 'Wedding', 'photography', 'acknowledged', 18000, 9000),
  asg('as15', 'pk11', team[1], iso(-90), 'Wedding', 'cinematography', 'acknowledged', 25000, 0),
  asg('as16', 'pk05', team[2], iso(-58), 'Reception', 'photography', 'acknowledged', 16000, 16000),
];

/* ---------------------------------------------------------------- studios */
export const studios = [
  { id: 'st01', name: 'Lumiere Weddings', ownerName: 'Rahul Menon', city: 'Hyderabad',
    phone: '+919848111222', phone10: '9848111222', active: true,
    gst: '36AABCU9603R1ZX', terms: '50% advance · balance on RAW handover',
    notes: 'Prefers cinematography-only bookings.',
    rateCard: { Photography: 15000, Cinematography: 22000, Drone: 20000 } },
  { id: 'st02', name: 'Aperture Films', ownerName: 'Divya Nagarajan', city: 'Secunderabad',
    phone: '+919701333444', phone10: '9701333444', active: true,
    gst: '', terms: 'Net 15 days', notes: '',
    rateCard: { Photography: 14000, Cinematography: 21000 } },
  /* inactive — out of the new-job picker, still in the list */
  { id: 'st03', name: 'Frame & Co', ownerName: 'Sanjay Pillai', city: 'Bengaluru',
    phone: '+919885555666', phone10: '9885555666', active: false,
    gst: '', terms: '', notes: 'Stopped sending work after Mar 2026.', rateCard: {} },
];

/* --------------------------------------------------------------- expenses */
export const expenses = [
  { id: 'ex01', date: iso(-2),  cat: 'travel',    amount: 4200,  mode: 'UPI',  note: 'Cab to Falaknuma recce' },
  { id: 'ex02', date: iso(-6),  cat: 'equipment', amount: 86000, mode: 'Card', note: 'Sigma 35mm f/1.2' },
  { id: 'ex03', date: iso(-9),  cat: 'salary',    amount: 45000, mode: 'Bank transfer', note: 'Studio assistant — Jul' },
  { id: 'ex04', date: iso(-15), cat: 'rent',      amount: 38000, mode: 'Bank transfer', note: 'Studio rent' },
  { id: 'ex05', date: iso(-22), cat: 'marketing', amount: 12000, mode: 'UPI',  note: 'Instagram ads' },
  { id: 'ex06', date: iso(-40), cat: 'equipment', amount: 15500, mode: 'UPI',  note: 'Batteries + cards' },
  { id: 'ex07', date: iso(-70), cat: 'travel',    amount: 9800,  mode: 'Cash', note: 'Vijayawada shoot fuel' },
  { id: 'ex08', date: iso(-120),cat: 'rent',      amount: 38000, mode: 'Bank transfer', note: 'Studio rent' },
];

/* ----------------------------------------------------------------- config */
export const config = {
  businessName: 'Fantasy Studio',
  phone: '+91 98480 00000',
  email: 'hello@fantasystudio.in',
  city: 'Hyderabad',
  upiVpa: 'fantasystudio@upi',
};
