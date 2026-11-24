// SBN airfare table (rules/sbn_airfares.json, Google Flights survey to the 50 busiest US airports).
// Used when a flying job has no live fare: nearest airport to the job (its lat/lng, else its state's center).
import TABLE from './rules/sbn_airfares.json';
import { CENTER, STATE_ABBR } from './rfq';

export interface TableFare { code: string; city: string; state: string; fare: number; miles: number; pulledOn: string; dates: string }

const toAbbr = (s?: string) => { if (!s) return undefined; const t = s.trim(); return t.length === 2 ? t.toUpperCase() : STATE_ABBR[t.toLowerCase()]; };

/** State from a spec location like "Ozark, Arkansas 72949 (US)" or "Tulsa, OK". */
export function stateOf(location?: string): string | undefined {
  if (!location) return undefined;
  const ab = /,\s*([A-Z]{2})\b(?:\s+\d{5})?/.exec(location);
  if (ab && CENTER[ab[1]]) return ab[1];
  const low = location.toLowerCase();
  const names = Object.keys(STATE_ABBR).sort((a, b) => b.length - a.length);   // "west virginia" before "virginia"
  for (const n of names) if (new RegExp(`(^|[ ,])${n}([ ,]|$)`).test(low)) return STATE_ABBR[n];
  return undefined;
}

const dist = (a: [number, number], b: [number, number]) => {
  const r = (d: number) => d * Math.PI / 180;
  const h = Math.sin(r(b[0] - a[0]) / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(r(b[1] - a[1]) / 2) ** 2;
  return 3959 * 2 * Math.asin(Math.sqrt(h));
};

/** Nearest surveyed airport to the job; undefined when there's no location to go on. */
export function tableFare(o: { state?: string; lat?: number; lng?: number }): TableFare | undefined {
  const at: [number, number] | undefined = o.lat != null && o.lng != null ? [o.lat, o.lng] : (CENTER as any)[toAbbr(o.state) ?? ''];
  if (!at) return undefined;
  let best: any, bd = Infinity;
  for (const a of TABLE.airports) { const d = dist(at, [a.lat, a.lng]); if (d < bd) { bd = d; best = a; } }
  return best && { code: best.code, city: best.city, state: best.state, fare: best.fare, miles: Math.round(bd), pulledOn: TABLE.pulledOn, dates: TABLE.dates };
}
