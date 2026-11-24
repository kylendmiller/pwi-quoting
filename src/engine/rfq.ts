// Website RFQ → quote spec. The RFQs table's autoRFQdetails block (markdown) is parsed here.
// Configurator RFQs carry clean fields and map straight to a spec; free-text RFQs go to Claude
// (rfq-intake edge function) and come back as a spec. Either way the spec is checked here.
import type { QuoteSpec } from './buildSpec';

export interface RfqParsed {
  customer?: string; contact?: string; email?: string; phone?: string;
  address?: string; city?: string; state?: string; zip?: string;
  timeline?: string; form?: string; fields: Record<string, string>; note: string;
}

const strip = (s: string) => s.replace(/\*\*/g, '').replace(/\\\*/g, '').replace(/\s+$/g, '').trim();

export function parseRfqDetails(md: string): RfqParsed {
  const out: RfqParsed = { fields: {}, note: '' };
  const kv = (label: string) => { const m = new RegExp(`^${label}:\\s*(.+)$`, 'mi').exec(md); return m ? strip(m[1]) : undefined; };
  out.customer = kv('Customer'); out.contact = kv('Contact'); out.email = kv('Email'); out.phone = kv('Phone');
  out.address = kv('Address'); out.timeline = kv('Project Timeline');
  if (out.address) {
    // "3931 Carbon Plant Road, Ozark, Arkansas 72949-8803 (US)"
    const m = /,\s*([^,]+),\s*([A-Za-z .]+?)\s+(\d{5})(?:-\d{4})?/.exec(out.address);
    if (m) { out.city = m[1].trim(); out.state = m[2].trim(); out.zip = m[3]; }
  }
  // the form section: "# PWI: Crane Configurator" / "# PWI: RFQ" / "# SZ: RFQ" … up to "# RFQ Details"
  const sec = /^#\s+((?:PWI|SZ|StairZone|HZ)[^:\n]*:\s*[^\n]+)\n([\s\S]*?)(?=^#\s+RFQ Details|$(?![\s\S]))/m.exec(md);
  if (sec) {
    out.form = sec[1].trim();
    const note: string[] = [];
    for (const raw of sec[2].split('\n')) {
      const line = raw.trim();
      const f = /^([A-Za-z][A-Za-z ]{1,40}):\s*(.*)$/.exec(line);
      if (f && !/^https?$/i.test(f[1])) out.fields[f[1].trim().toLowerCase()] = strip(f[2]);
      else if (line && !/^#/.test(line) && !/^-\s*Work phone/i.test(line)) note.push(line.replace(/^-\s+/, ''));
    }
    out.note = note.join(' ').trim();
  }
  return out;
}

export const STATE_ABBR: Record<string, string> = { alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT', delaware: 'DE', 'district of columbia': 'DC', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY' };
// state population-ish centers (lat, lng) — only a fallback when nothing better gives the miles
const CENTER: Record<string, [number, number]> = { AL: [33.0, -86.8], AK: [61.2, -149.9], AZ: [33.4, -112.0], AR: [34.9, -92.4], CA: [35.5, -119.4], CO: [39.6, -105.0], CT: [41.6, -72.7], DE: [39.4, -75.6], DC: [38.9, -77.0], FL: [27.8, -81.6], GA: [33.6, -84.2], HI: [21.3, -157.8], ID: [43.6, -116.2], IL: [41.3, -88.4], IN: [40.0, -86.3], IA: [41.9, -93.0], KS: [38.5, -97.0], KY: [37.8, -85.3], LA: [30.7, -91.5], ME: [44.3, -69.8], MD: [39.1, -76.8], MA: [42.3, -71.4], MI: [42.8, -84.6], MN: [45.0, -93.5], MS: [32.4, -89.7], MO: [38.4, -92.2], MT: [46.3, -110.5], NE: [41.0, -97.0], NV: [37.2, -116.4], NH: [43.1, -71.5], NJ: [40.4, -74.4], NM: [35.0, -106.4], NY: [41.5, -74.6], NC: [35.6, -79.4], ND: [47.2, -99.3], OH: [40.3, -82.8], OK: [35.6, -97.0], OR: [44.7, -122.6], PA: [40.5, -77.0], RI: [41.8, -71.4], SC: [34.0, -80.9], SD: [44.0, -99.0], TN: [35.8, -86.4], TX: [31.1, -97.5], UT: [40.5, -111.9], VT: [44.1, -72.7], VA: [37.8, -77.8], WA: [47.4, -121.6], WV: [38.6, -80.6], WI: [43.8, -89.0], WY: [42.8, -107.0] };
const NAPPANEE: [number, number] = [41.443, -85.999];

/** Rough one-way road miles from Nappanee to a state's center (great circle × 1.2). */
export function milesFromState(state?: string): number | undefined {
  if (!state) return undefined;
  const ab = state.length === 2 ? state.toUpperCase() : STATE_ABBR[state.toLowerCase()];
  const c = ab && CENTER[ab]; if (!c) return undefined;
  const r = (d: number) => d * Math.PI / 180, [a1, o1] = NAPPANEE, [a2, o2] = c;
  const h = Math.sin(r(a2 - a1) / 2) ** 2 + Math.cos(r(a1)) * Math.cos(r(a2)) * Math.sin(r(o2 - o1) / 2) ** 2;
  return Math.round(3959 * 2 * Math.asin(Math.sqrt(h)) * 1.2);
}

const num = (s?: string) => { const m = s && /-?\d+(?:\.\d+)?/.exec(s.replace(/,/g, '')); return m ? Number(m[0]) : undefined; };
const tons = (s?: string) => { const n = num(s); if (n == null || !s) return undefined; return /lb/i.test(s) ? Math.round(n / 2000 * 100) / 100 : n; };
const volts = (s?: string) => !s ? undefined : /460|480/.test(s) ? '460V/3' : /230|240/.test(s) && /3/.test(s) ? '230V/3' : /208/.test(s) ? '208V/3' : undefined;

/**
 * Configurator RFQ → spec. Returns { spec } or { skip } with the reason the auto-builder can't take it.
 * miles: one-way road miles to the site (caller's best estimate).
 */
export function configuratorSpec(p: RfqParsed, miles?: number): { spec?: QuoteSpec; skip?: string; assumed: string[] } {
  const f = p.fields, assumed: string[] = [];
  if (!/configurator/i.test(p.form ?? '')) return { skip: 'Not a configurator RFQ', assumed };
  const move = (f['movement type'] ?? '').toLowerCase(), series = (f['series'] ?? '').toUpperCase();
  const cap = tons(f['capacity']), span = num(f['span']), len = num(f['length'] ?? f['track length']), oh = num(f['overall height']);
  const motorized = /MOTORIZED|INCOMMAND/.test(series) && !/MANUAL/.test(series);
  const v = volts(f['building voltage']); if (!v) assumed.push(`Voltage ${f['building voltage'] ? `"${f['building voltage']}"` : 'not given'} → 460V/3`);
  const common = { install: true, miles: miles ?? 0, voltage: v ?? '460V/3' };
  assumed.push('Installed (the form does not ask)');
  if (!cap) return { skip: 'No capacity on the form', assumed };
  let item: any;
  if (/bridge/.test(move)) {
    if (/AERO/.test(series)) return { skip: 'AERO work cell — price-list item, quote by hand', assumed };
    if (!span || !len || !oh) return { skip: 'Bridge without span, length or height', assumed };
    const floor = !/ceiling|building/i.test(f['mount option'] ?? 'floor');
    const bridges = Math.max(1, Math.min(2, num(f['bridge quantity']) ?? 1));
    if ((num(f['bridge quantity']) ?? 1) > 2) assumed.push(`Form says ${f['bridge quantity']} bridges — built as 2 per runway; check`);
    item = floor
      ? { type: 'freestanding', spanFt: span, runwayOalFt: len, overallHeightFt: oh, capacityTons: cap, bridgeDrive: motorized ? 'motorized' : 'manual', bridgesPerSystem: bridges, ...common }
      : { type: 'bridge', support: 'building_runway', spanFt: span, runwayOalFt: len, overallHeightFt: oh, capacityTons: cap, bridgeDrive: motorized ? 'motorized' : 'manual', bridgesPerSystem: bridges, ...common };
  } else if (/gantry/.test(move)) {
    if (!span || !oh) return { skip: 'Gantry without span or height', assumed };
    item = { type: 'gantry', capacityTons: cap, spanFt: span, heightUnderBeamFt: oh, motorized, floorTrackFt: 0, ...common };
    assumed.push('Overall height used as height under beam; trackless (rolls on floor)');
  } else if (/monorail|straight/.test(move)) {
    if (!len) return { skip: 'Monorail without length', assumed };
    const floor = !/ceiling|building/i.test(f['mount option'] ?? 'floor');
    item = { type: 'monorail', capacityTons: cap, lengthFt: len, support: floor ? 'freestanding' : 'ceiling', ...(oh ? { overallHeightFt: oh } : {}), ...common };
    const sp = num(f['support spans']); if (sp && sp > 1 && len / sp >= 5) item.supportSpacingFt = sp;
  } else if (/jib|rotat/.test(move)) {
    if (!span || !oh) return { skip: 'Jib without reach or height', assumed };
    item = { type: 'jib', capacityTons: cap, spanFt: span, overallHeightFt: oh, ...common };
  } else return { skip: `Movement type "${f['movement type'] ?? '?'}" not auto-quoted`, assumed };
  return { spec: { pwi_quote: 1, items: [item] }, assumed };
}

/** 0–100 from Airtable's "NN% Serious Inquiry …" text; undefined when not scored yet. */
export const pct = (s?: string) => { const m = s && /(\d{1,3})\s*%/.exec(s); return m ? Number(m[1]) : undefined; };
