// Minimal geohash encode/decode — no dependency (SPEC §0: "零/极少运行时依赖").
// We store a full-precision geohash internally but NEVER return it raw;
// callers truncate to the user's chosen loc_precision so precise coords
// never leave the DB (SPEC §5 / §7.1).

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

/** Encode lat/lng to a geohash of `precision` chars (default 9 ≈ ~5m). */
export const encodeGeohash = (
  lat: number,
  lng: number,
  precision = 9,
): string => {
  let latMin = -90,
    latMax = 90,
    lngMin = -180,
    lngMax = 180;
  let hash = '';
  let bit = 0;
  let ch = 0;
  let even = true;

  while (hash.length < precision) {
    if (even) {
      const mid = (lngMin + lngMax) / 2;
      if (lng >= mid) {
        ch = (ch << 1) | 1;
        lngMin = mid;
      } else {
        ch = ch << 1;
        lngMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) {
        ch = (ch << 1) | 1;
        latMin = mid;
      } else {
        ch = ch << 1;
        latMax = mid;
      }
    }
    even = !even;
    if (++bit === 5) {
      hash += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }
  return hash;
};

/** Decode a geohash to the center lat/lng of its cell. */
export const decodeGeohash = (hash: string): { lat: number; lng: number } => {
  let latMin = -90,
    latMax = 90,
    lngMin = -180,
    lngMax = 180;
  let even = true;

  for (const c of hash) {
    const idx = BASE32.indexOf(c);
    if (idx === -1) continue;
    for (let mask = 16; mask >= 1; mask >>= 1) {
      if (even) {
        const mid = (lngMin + lngMax) / 2;
        if (idx & mask) lngMin = mid;
        else lngMax = mid;
      } else {
        const mid = (latMin + latMax) / 2;
        if (idx & mask) latMin = mid;
        else latMax = mid;
      }
      even = !even;
    }
  }
  return { lat: (latMin + latMax) / 2, lng: (lngMin + lngMax) / 2 };
};

/** Blur a geohash to `precision` chars (the coarse cell we expose). */
export const blurGeohash = (hash: string, precision: number): string =>
  hash.slice(0, Math.max(1, precision));
