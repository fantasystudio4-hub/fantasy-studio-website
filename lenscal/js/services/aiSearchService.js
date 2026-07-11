/* LensCal — AI search bar. Natural language (incl. Hinglish) → structured
   filter { date, slotIds, roles, radiusKm, area }.

   Two engines, same output shape:
   1. Claude API (claude-opus-4-8, structured outputs) when the user has
      saved an Anthropic API key in Profile → AI settings. The key is kept
      in localStorage only — never written to Firestore.
   2. A local rule-based Hinglish parser as the zero-setup fallback,
      covering the common patterns ("kal evening Malakpet ke paas 3 km
      mein kaun free hai video ke liye", "who's free 14 Dec morning").
*/
import { todayISO, addDaysISO, toISODate } from './availabilityService.js';
import { SLOT_IDS } from '../config.js';

const KEY_STORAGE = 'lenscal_anthropic_key';
export const getApiKey = () => localStorage.getItem(KEY_STORAGE) || '';
export const setApiKey = k => k ? localStorage.setItem(KEY_STORAGE, k.trim())
                                : localStorage.removeItem(KEY_STORAGE);

/** Main entry. Returns { date, slotIds, roles, radiusKm, area, engine }. */
export async function parseQuery(text) {
  const key = getApiKey();
  if (key) {
    try {
      return { ...(await parseWithClaude(text, key)), engine: 'claude' };
    } catch (e) {
      console.warn('Claude parse failed, falling back to local parser', e);
    }
  }
  return { ...parseLocal(text), engine: 'local' };
}

/* ---------------- Claude (structured outputs) ---------------- */

const SCHEMA = {
  type: 'object',
  properties: {
    date: { type: ['string', 'null'], description: 'ISO date YYYY-MM-DD, resolved from relative words like kal/tomorrow. null if not mentioned.' },
    slot: { type: ['string', 'null'], enum: ['morning', 'evening', 'fullday', null] },
    roles: {
      type: 'array',
      items: { type: 'string', enum: ['photographer', 'videographer', 'drone', 'editor'] },
    },
    radiusKm: { type: ['number', 'null'] },
    area: { type: ['string', 'null'], description: 'Locality/area name mentioned, e.g. Malakpet' },
  },
  required: ['date', 'slot', 'roles', 'radiusKm', 'area'],
  additionalProperties: false,
};

async function parseWithClaude(text, apiKey) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-8',
      max_tokens: 1024,
      system: `You parse availability-search queries from Indian wedding photographers into a JSON filter. Queries may be in English, Hindi/Urdu (Hinglish), or mixed. Today is ${todayISO()} (${new Date().toDateString()}). "kal"=tomorrow, "parso"=day after tomorrow, "aaj"=today, "subah"=morning, "shaam/raat"=evening, "photo/candid"=photographer, "video"=videographer. Resolve dates to the NEXT future occurrence.`,
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: text }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}`);
  const data = await res.json();
  if (data.stop_reason === 'refusal') throw new Error('refused');
  const block = (data.content || []).find(b => b.type === 'text');
  const out = JSON.parse(block.text);
  return normalize(out);
}

/* ---------------- Local Hinglish parser ---------------- */

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

export function parseLocal(text) {
  const t = ' ' + text.toLowerCase().replace(/[?.!,]/g, ' ') + ' ';
  const out = { date: null, slot: null, roles: [], radiusKm: null, area: null };

  // --- date ---
  if (/\bparso(n)?\b/.test(t)) out.date = addDaysISO(todayISO(), 2);
  else if (/\b(kal|tomorrow|tmrw)\b/.test(t)) out.date = addDaysISO(todayISO(), 1);
  else if (/\b(aaj|today|abhi)\b/.test(t)) out.date = todayISO();
  if (!out.date) {
    // "14 dec" / "dec 14" / "14 december"
    const m1 = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/);
    const m2 = t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?\b/);
    const day = m1 ? +m1[1] : (m2 ? +m2[2] : null);
    const mon = m1 ? MONTHS.indexOf(m1[2]) : (m2 ? MONTHS.indexOf(m2[1]) : -1);
    if (day && mon >= 0) {
      const now = new Date();
      let d = new Date(now.getFullYear(), mon, day);
      if (d < new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
        d = new Date(now.getFullYear() + 1, mon, day); // next occurrence
      }
      out.date = toISODate(d);
    }
  }
  if (!out.date) {
    // weekday: next occurrence
    for (let i = 0; i < 7; i++) {
      if (new RegExp(`\\b${WEEKDAYS[i]}\\b`).test(t) || new RegExp(`\\b${WEEKDAYS[i].slice(0, 3)}\\b`).test(t)) {
        const now = new Date();
        let diff = (i - now.getDay() + 7) % 7;
        if (diff === 0) diff = 7;
        out.date = addDaysISO(todayISO(), diff);
        break;
      }
    }
  }

  // --- slot ---
  const morning = /\b(morning|subah|subha|sube|din|fajr)\b/.test(t);
  const evening = /\b(evening|shaam|sham|night|raat|reception)\b/.test(t);
  if (/\b(full ?day|pura din|poora din|whole day)\b/.test(t) || (morning && evening)) out.slot = 'fullday';
  else if (morning) out.slot = 'morning';
  else if (evening) out.slot = 'evening';

  // --- roles ---
  if (/\b(video|videographer|cinemat)\w*/.test(t)) out.roles.push('videographer');
  if (/\b(photo|photographer|candid|camera ?man)\w*/.test(t)) out.roles.push('photographer');
  if (/\b(drone|aerial)\w*/.test(t)) out.roles.push('drone');
  if (/\b(edit|editor|editing)\w*/.test(t)) out.roles.push('editor');

  // --- radius ---
  const km = t.match(/\b(\d+(?:\.\d+)?)\s*(?:km|kilomet|kms)\b/);
  if (km) out.radiusKm = parseFloat(km[1]);

  // --- area: "near X", "X ke paas/pass", "X mein/me" ---
  let area = null;
  let m = t.match(/\bnear\s+([a-z][a-z ]{2,30}?)(?=\s+(?:for|who|kaun|\d|$))/);
  if (!m) m = t.match(/\b([a-z][a-z ]{2,30}?)\s+ke\s+pa+s\b/);
  if (!m) m = t.match(/\bnear\s+([a-z][a-z ]+)$/);
  if (m) area = m[1].trim();
  if (area) {
    // strip stopwords the regex may have swallowed
    area = area.replace(/\b(kal|aaj|parso|tomorrow|today|morning|evening|subah|shaam|free|hai|kaun|video|photo|drone|editor)\b/g, ' ')
      .replace(/\s+/g, ' ').trim();
    if (area.length >= 3) out.area = titleCase(area);
  }

  return normalize(out);
}

function titleCase(s) {
  return s.replace(/\b\w/g, c => c.toUpperCase());
}

function normalize(out) {
  let slotIds;
  if (out.slot === 'fullday') slotIds = [...SLOT_IDS];
  else if (out.slot && SLOT_IDS.includes(out.slot)) slotIds = [out.slot];
  else slotIds = [...SLOT_IDS];
  return {
    date: out.date || todayISO(),
    slotIds,
    roles: out.roles || [],
    radiusKm: out.radiusKm ?? null,
    area: out.area || null,
  };
}
