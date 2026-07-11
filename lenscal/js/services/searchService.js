/* LensCal — Find Crew: distance-sorted availability search over the
   user's network. Composes availabilityService + locationService +
   networkService; the UI only calls findCrew(). */
import { connectedUids, listGroups } from './networkService.js';
import { getProfiles, getProfile } from './userService.js';
import { getUsersForDate, isFreeFor, effectiveSlot } from './availabilityService.js';
import { getSearchOrigin, sharedLocation, distanceBetween } from './locationService.js';
import { SLOT_IDS } from '../config.js';

/**
 * findCrew({ uid, date, slotIds, roles, groupId, maxKm })
 * → { origin, results: [{ profile, slots, distanceKm, free }] } sorted nearest-first.
 * slotIds: ['morning'] | ['evening'] | SLOT_IDS (full day).
 */
export async function findCrew({ uid, date, slotIds, roles = [], groupId = null, maxKm = null }) {
  const me = await getProfile(uid);
  const [origin, allUids, groups] = await Promise.all([
    getSearchOrigin(me),
    connectedUids(uid),
    groupId ? listGroups(uid) : Promise.resolve([]),
  ]);

  let uids = allUids;
  if (groupId) {
    const g = groups.find(g => g.id === groupId);
    if (g) uids = uids.filter(u => g.memberUids.includes(u));
  }
  if (!uids.length) return { origin, results: [] };

  const [profiles, availMap] = await Promise.all([
    getProfiles(uids),
    getUsersForDate(uids, date),
  ]);

  const wanted = slotIds && slotIds.length ? slotIds : SLOT_IDS;
  let results = profiles.map(p => {
    const avail = availMap.get(p.id) || null;
    const slots = {};
    for (const sid of SLOT_IDS) slots[sid] = effectiveSlot(avail, sid);
    const loc = sharedLocation(p);
    const distanceKm = origin && loc ? distanceBetween(origin, loc) : null;
    return { profile: p, slots, distanceKm, free: isFreeFor(avail, wanted) };
  });

  // Only 🟢 for the requested slot(s)
  results = results.filter(r => r.free);
  if (roles.length) {
    results = results.filter(r => (r.profile.roles || []).some(role => roles.includes(role)));
  }
  if (maxKm != null) {
    results = results.filter(r => r.distanceKm != null && r.distanceKm <= maxKm);
  }
  // Nearest first; unknown distance sinks to the bottom
  results.sort((a, b) =>
    (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));

  return { origin, results };
}

/** Pre-filled WhatsApp deep link for a result card / broadcast. */
export function whatsappLink(profile, { date, slotLabel, area }) {
  const phone = (profile.phone || '').replace(/\D/g, '');
  const msg = `Salaam ${profile.name || ''}, saw on LensCal you're free ${date} ${slotLabel}` +
    ` — I have a shoot${area ? ` near ${area}` : ''}. Interested?`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
}
