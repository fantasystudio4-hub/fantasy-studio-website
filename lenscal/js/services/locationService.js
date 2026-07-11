/* ============================================================
   LENSCAL — LOCATION SERVICE
   One module for geolocation, geohashing and distance math,
   reused by search, map and broadcasts.

   Geohash functions mirror the geofire-common API
   (geohashForLocation / geohashQueryBounds / distanceBetween)
   so a swap to the npm package later is a drop-in.

   Privacy model (non-negotiable):
   - Users share AREA-LEVEL location only: the centroid of their
     locality (geocoded via OpenStreetMap Nominatim), stored as
     lat/lng + geohash on their profile.
   - Live GPS, when permitted, is used ONLY on-device as the
     searcher's origin for distance sorting. It is never uploaded.
   - locationMode 'off' hides the user from distance sort and map.
   ============================================================ */

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

/** geofire-common compatible: encode lat/lng to a geohash string. */
export function geohashForLocation([lat, lng], precision = 7) {
  let idx = 0, bit = 0, evenBit = true, hash = '';
  let latMin = -90, latMax = 90, lngMin = -180, lngMax = 180;
  while (hash.length < precision) {
    if (evenBit) {
      const mid = (lngMin + lngMax) / 2;
      if (lng > mid) { idx = idx * 2 + 1; lngMin = mid; } else { idx = idx * 2; lngMax = mid; }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat > mid) { idx = idx * 2 + 1; latMin = mid; } else { idx = idx * 2; latMax = mid; }
    }
    evenBit = !evenBit;
    if (++bit === 5) { hash += BASE32[idx]; bit = 0; idx = 0; }
  }
  return hash;
}

/** Haversine distance in km (geofire-common: distanceBetween). */
export function distanceBetween([lat1, lng1], [lat2, lng2]) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** geofire-common compatible: geohash prefix ranges covering a radius (m).
    Not needed while networks are ≤ tens of people (we distance-sort
    client-side), but ready for radius queries at scale. */
export function geohashQueryBounds(center, radiusM) {
  const [lat] = center;
  const bits = [52, 52, 47, 42, 37, 32, 27, 22, 17, 12, 7, 2];
  const mPerDeg = 110574;
  const latDelta = radiusM / mPerDeg;
  const precisions = [8, 8, 7, 6, 6, 5, 5, 4, 4, 3, 3, 2];
  let precision = 2;
  for (let i = 0; i < bits.length; i++) {
    if (radiusM <= heightForBits(bits[i]) / 2) { precision = precisions[i]; break; }
  }
  function heightForBits(b) { return 180 / 2 ** Math.floor(b / 2) * mPerDeg; }
  // Cover the bounding circle with the 3x3 neighbor cells around the center.
  const bounds = new Set();
  for (const dLat of [-latDelta, 0, latDelta]) {
    const lngDelta = radiusM / (mPerDeg * Math.max(0.01, Math.cos((lat + dLat) * Math.PI / 180)));
    for (const dLng of [-lngDelta, 0, lngDelta]) {
      const h = geohashForLocation([clampLat(lat + dLat), wrapLng(center[1] + dLng)], precision);
      bounds.add(h);
    }
  }
  return [...bounds].map(prefix => [prefix, prefix + '~']);
}
const clampLat = l => Math.max(-90, Math.min(90, l));
const wrapLng = l => ((l + 540) % 360) - 180;

/* ---------- geocoding (OpenStreetMap Nominatim — free, no key) ---------- */

/** Geocode an area/locality (e.g. "Malakpet, Hyderabad") to its centroid.
    Returns [{ name, lat, lng }] candidates. */
export async function geocodeArea(area, city) {
  const q = [area, city, 'India'].filter(Boolean).join(', ');
  const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=4&countrycodes=in&q='
    + encodeURIComponent(q);
  const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
  if (!res.ok) throw new Error('Could not look up that area — try again');
  const rows = await res.json();
  return rows.map(r => ({
    name: r.display_name.split(',').slice(0, 3).join(','),
    lat: parseFloat(r.lat),
    lng: parseFloat(r.lon),
  }));
}

/* ---------- device location (on-device only, never uploaded) ---------- */

export function getDeviceLocation({ timeout = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('No geolocation'));
    navigator.geolocation.getCurrentPosition(
      pos => resolve([pos.coords.latitude, pos.coords.longitude]),
      err => reject(err),
      { enableHighAccuracy: false, timeout, maximumAge: 5 * 60 * 1000 },
    );
  });
}

/** The searcher's origin for distance sorting: live GPS if the user allows
    it (refreshed on app open), else their saved home-area centroid. */
let cachedOrigin = null;
export async function getSearchOrigin(profile) {
  if (cachedOrigin) return cachedOrigin;
  try {
    cachedOrigin = await getDeviceLocation();
    return cachedOrigin;
  } catch {
    if (profile && profile.areaLat != null) {
      cachedOrigin = [profile.areaLat, profile.areaLng];
      return cachedOrigin;
    }
    return null;
  }
}

/** Area-level shared location for a profile ('off' → null). */
export function sharedLocation(profile) {
  if (!profile || profile.locationMode === 'off') return null;
  if (profile.areaLat == null || profile.areaLng == null) return null;
  return [profile.areaLat, profile.areaLng];
}

export function fmtKm(km) {
  if (km == null) return '';
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}
