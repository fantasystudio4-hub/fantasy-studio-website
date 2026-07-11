/* LensCal — plan gating. Flipping the paywall later = set
   PAYWALL_ENFORCED true in config.js; every feature check in the app
   already routes through canAccess(). */
import { PLANS, PAYWALL_ENFORCED, PRO_ONLY_FEATURES } from '../config.js';

export function planOf(profile) {
  return PLANS[profile && profile.plan] || PLANS.free;
}

export function canAccess(profile, feature) {
  if (!PAYWALL_ENFORCED) return true;
  if ((profile && profile.plan) === 'pro') return true;
  if (PRO_ONLY_FEATURES.includes(feature)) return false;
  return planOf(profile).features.includes(feature);
}

export function canAddConnection(profile, currentCount) {
  return currentCount < planOf(profile).maxConnections;
}
