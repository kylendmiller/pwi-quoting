// Freestanding crane auto-builder (FSTRUL / FSTRM / FSTRGM / FSTRHL).
// Turns ~15 answers into every quote line + the customer wording, using the rules
// taken from PWI's sold Sales Main Template quotes (Rulebook §2–3).
// Steel sizes are DEFAULTS until Spenser's sizing tool is plugged in (sizeSteel()).
import type { QuoteLine, QuoteDoc } from './manual';

export interface FreestandingSpec {
  series: 'UL' | 'M' | 'GM' | 'HL';
  systems: number;                 // identical crane systems
  runwayOalFt: number;
  spanFt: number;
  capacityTons: number;
  hookHeightFt: number;            // height under hook
  liftFt?: number;                 // hoist lift (default = hook height rounded up to 10/15/20…)
  columnsPerSystem?: number;       // default from OAL (bays ≤ 30')
  bridgesPerSystem?: number;       // default 1
  hoistsPerBridge?: number;        // default 1
  bridgeDrive: 'manual' | 'motorized';
  trolley?: 'manual' | 'motorized';      // default = bridgeDrive
  voltage: '460V/3' | '230V/3' | '208V/3';
  control?: 'radio' | 'pendant';         // default radio if motorized, else pendant
  collisionAvoidance?: boolean;
  asceRail?: boolean;              // default: motorized bridge and capacity ≥ 5 t
  bracedToBuilding?: boolean;      // adds a note; freestanding bracing is included either way
  install: boolean;
  miles?: number;                  // one way, Nappanee → site
  preUseInspection?: boolean;
  customerName?: string;
}

export interface Catalog {
  stdSell(description: string): number | null;
  vendor(part: string): { list: number; description: string; vendor: string } | null;
  vendorParts(prefix: string): { part: string; list: number; description: string }[];
  discount(vendor: string): { pwi: number; customer: number };
  shape(name: string): { lbPerFt: number; pricePerLb: number } | null;
  plate: { pricePerLb: number; markupPct: number; dropFactor: number };
  structuralMarkupPct: number;
  paintRunSell: number;            // standard paint full booth run
  decalSell(name: string): number | null;
}

export interface BuildResult {
  doc: Partial<QuoteDoc>;
  lines: QuoteLine[];
  wording: string;
  notes: string[];                 // things the rep should check
  suggestedInstallHours: number;
  smtShopHours: number;            // before the production factor
}

const ftIn = (ft: number) => { const f = Math.floor(ft + 1e-9); const i = Math.round((ft - f) * 12); return i ? `${f}' ${i}"` : `${f}'`; };
const tons = (t: number) => (t === 0.5 ? '1/2' : t === 0.25 ? '1/4' : String(t));
let seq = 0;
const key = () => `fs${Date.now().toString(36)}${(seq++).toString(36)}`;

/** Default steel by capacity — replace with Spenser's sizing tool. */
export function sizeSteel(s: FreestandingSpec, bayFt: number) {
  const c = s.capacityTons;
  const column = c <= 1 ? 'ST 6 x 6 x 7ga' : c <= 2 ? 'ST 8 x 8 x 1/4' : c <= 3 ? 'ST 10 x 10 x 1/4' : c <= 5 ? 'W14 x 61' : 'W14 x 61';
  const runway = c <= 1 ? (bayFt <= 25 ? 'W12 x 26' : 'W14 x 43') : c <= 2 ? (bayFt <= 25 ? 'W14 x 43' : 'W14 x 53') : c <= 3 ? 'W16 x 57' : c <= 5 ? 'W21 x 62' : 'W24 x 76';
  const girder = s.series === 'UL' || s.series === 'HL' ? null
    : c <= 1 ? (s.spanFt <= 20 ? 'W10 x 22' : 'W12 x 26') : c <= 2 ? (s.spanFt <= 30 ? 'W12 x 35' : 'W14 x 53') : c <= 3 ? 'W16 x 57' : c <= 5 ? (s.spanFt <= 30 ? 'W16 x 40' : 'W18 x 50') : 'W21 x 62';
  const basePlate = c <= 1 ? { t: 0.5, w: 14 } : c <= 3 ? { t: 0.75, w: 20 } : { t: 1, w: 28 };
  return { column, runway, girder, basePlate, verify: true };
}

export interface Factors { production: number; install: number }

export function buildFreestanding(s: FreestandingSpec, cat: Catalog, f: Factors = { production: 0.56, install: 1.02 }): BuildResult {
  s = { ...s, trolley: s.trolley ?? s.bridgeDrive, control: s.control ?? (s.bridgeDrive === 'motorized' ? 'radio' : 'pendant'),
    voltage: (String(s.voltage).replace(/\s/g, '').toUpperCase().replace('V', 'V').startsWith('460') ? '460V/3' : String(s.voltage).startsWith('208') ? '208V/3' : String(s.voltage).startsWith('230') ? '230V/3' : s.voltage) as any };
  const notes: string[] = [];
  const n = Math.max(1, s.systems);
  const bridges = (s.bridgesPerSystem ?? 1) * n;
  const hoists = bridges * (s.hoistsPerBridge ?? 1);
  const bays = Math.max(1, Math.ceil(s.runwayOalFt / 30));
  const colsPer = s.columnsPerSystem ?? 2 * (bays + 1);
  const cols = colsPer * n;
  const bayFt = s.runwayOalFt / (colsPer / 2 - 1);
  const motorBridge = s.bridgeDrive === 'motorized';
  const rail = s.asceRail ?? (motorBridge && s.capacityTons >= 5);
  const doubleGirder = s.series === 'GM' && s.capacityTons >= 5;
  const steel = sizeSteel(s, bayFt);
  notes.push(`Steel sizes are defaults (columns ${steel.column}, runways ${steel.runway}${steel.girder ? `, girder ${steel.girder}` : ''}) — confirm with engineering / Spenser's tool.`);
  const lines: QuoteLine[] = [];
  const fam = 'freestanding';

  // ---------- structural ----------
  const steelLine = (desc: string, shape: string, qty: number, lengthFt: number) => {
    const sh = cat.shape(shape);
    if (!sh) { notes.push(`Shape ${shape} not in steel list — add it.`); return; }
    lines.push({ key: key(), kind: 'material', category: 'structural', family: fam, description: `${desc} — ${shape} × ${ftIn(lengthFt)}`, qty,
      unitCost: Math.round(sh.lbPerFt * lengthFt * sh.pricePerLb * 100) / 100, markupPct: cat.structuralMarkupPct });
    return sh.lbPerFt * lengthFt * qty;
  };
  let lbs = 0;
  const colLen = Math.ceil((s.hookHeightFt + 4) / 5) * 5;
  lbs += steelLine('Columns', steel.column, cols, colLen) ?? 0;
  const runPieces = Math.max(1, Math.ceil(s.runwayOalFt / 40));
  lbs += steelLine('Runways', steel.runway, 2 * runPieces * n, Math.ceil((s.runwayOalFt / runPieces) * 2) / 2) ?? 0;
  if (steel.girder) lbs += steelLine(doubleGirder ? 'Bridge girders (double)' : 'Bridge girder', steel.girder, bridges * (doubleGirder ? 2 : 1), s.spanFt + 2) ?? 0;
  if (cols >= 6 * n || s.capacityTons >= 3) lbs += steelLine('Bracing', 'ST 3 x 3 x 1/4', 6 * n, 20) ?? 0;

  // ---------- plate ----------
  const plate = (desc: string, qty: number, t: number, w: number, l: number) => {
    const lbEach = t * w * l * 0.2833 * cat.plate.dropFactor;
    lbs += lbEach * qty;
    lines.push({ key: key(), kind: 'material', category: 'plate', family: fam, description: `${desc} — ${t}" × ${w}" × ${l}"`, qty,
      unitCost: Math.round(lbEach * cat.plate.pricePerLb * 100) / 100, markupPct: cat.plate.markupPct });
  };
  plate('Column base plates', cols, steel.basePlate.t, steel.basePlate.w, steel.basePlate.w);
  plate('Column top plates', cols, s.capacityTons <= 1 ? 0.375 : 0.5, 10, 14);
  plate('Column gussets', cols * 4, s.capacityTons <= 1 ? 0.25 : 0.3125, 5, 12);
  plate('Runway splice / end plates', 2 * (runPieces + 1) * n, 0.375, 8, 14);
  if (steel.girder) plate('Bridge end plates', bridges * 2, 0.375, 12, 18);

  // ---------- standard parts ----------
  const std = (description: string, qty: number) => {
    const sell = cat.stdSell(description);
    if (sell == null) { notes.push(`Standard part not found: ${description}`); return; }
    if (qty > 0) lines.push({ key: key(), kind: 'material', category: 'stdParts', family: fam, description, qty, unitSell: sell });
  };
  const big = s.capacityTons >= 2;
  std(big ? '3/4" Concrete Wedge Anchor' : '5/8" Concrete Wedge Anchor', cols * (big ? 8 : 4));
  std(big ? '3/4" Structural Bolt and Nut' : '5/8" Structural Bolt and Nut', 12 * cols + 20 * bridges);
  const amps = s.capacityTons >= 5 || bridges > 1 ? '120' : '65';
  std(`Runway Electrification Package (4-Conductor x ${amps} amp max)`, Math.ceil(s.runwayOalFt) * n);
  std(motorBridge ? 'Motorized Bridge Crane Electrification Package (per foot)' : 'Manual Bridge Crane Electrification Package (per foot)', Math.ceil(s.spanFt) * bridges);
  if (motorBridge) std(amps === '120' ? '120 Amp Tandem Collector Set (for VFD)' : '65 Amp Single Collector Set  (Non-VFD)', bridges * (amps === '120' ? 2 : 1));
  else std('65 Amp Single Collector Set  (Non-VFD)', bridges);
  std('Beam End Stop Kit for Runway System (4 total per kit)', n);
  std('PWI HD Adjustable End Stop Kit (slides on Flange)', 2 * bridges);
  if (motorBridge) std(s.capacityTons <= 2 ? 'End Truck Plug & Play Upcharge (2 ton or smaller)' : 'End Truck Plug & Play Upcharge (3 ton or larger)', bridges);
  if (rail) std(s.capacityTons <= 10 ? '30# ASCE Crane Rail (per linear foot including clips and splicers)' : '40# ASCE Crane Rail (per linear foot including clips and splicers)', 2 * Math.ceil(s.runwayOalFt) * n);
  if (s.series === 'UL') {
    const kit = s.capacityTons <= 0.5 ? '1/2 Ton Manual Ultra-Lite End Truck Kit  39.5"' : s.capacityTons <= 1 ? '1 Ton Manual Ultra-Lite End Truck Kit 39.5"' : s.capacityTons <= 2 ? '2 Ton Manual Ultra-Lite End Truck Kit 39.5"' : '3 Ton Manual Ultra-Lite End Truck Kit';
    std(kit, bridges);
  } else if (!motorBridge) {
    std(s.spanFt <= 20 ? 'PWI Manual Top Runner End Truck Kit 32.5"' : s.spanFt <= 30 ? 'PWI Manual Top Runner End Truck Kit 38.25"' : 'PWI Manual Top Runner End Truck Kit 50.25"', bridges);
  }

  // ---------- vendor (Starke) ----------
  const vend = (part: string, qty: number) => {
    const p = cat.vendor(part);
    if (!p) { notes.push(`Vendor part not found: ${part} — pick it in the editor.`); return; }
    const d = cat.discount(p.vendor);
    const cost = p.list * (1 - d.pwi / 100), sell = p.list * (1 - d.customer / 100);
    lines.push({ key: key(), kind: 'material', category: 'vendor', family: fam, description: `${p.vendor} ${part} — ${p.description}`, qty,
      unitCost: Math.round(cost * 100) / 100, markupPct: Math.round((sell / cost - 1) * 10000) / 100 });
  };
  const v = s.voltage.startsWith('460') ? '460V' : '230V';
  const lift = s.liftFt ?? Math.max(10, Math.ceil(s.hookHeightFt / 5) * 5);
  const capCode = s.capacityTons < 1 ? '05' : String(Math.round(s.capacityTons * 10)).padStart(2, '0');
  const hoistType = s.trolley === 'motorized' ? 'C' : 'B';
  const hoistCandidates = cat.vendorParts(`STK${capCode}`).filter(p => p.part.includes(`-${v}-3PH-${hoistType}`))
    .map(p => ({ ...p, lift: Number(/-(\d+)-/.exec(p.part)?.[1] ?? 0) })).filter(p => p.lift >= lift).sort((a, b) => a.lift - b.lift);
  if (hoistCandidates[0]) vend(hoistCandidates[0].part, hoists);
  else notes.push(`No Starke STK hoist found for ${tons(s.capacityTons)} ton, ${lift}' lift, ${v} — pick one in the editor.`);
  if (motorBridge) {
    const wb = Math.max(42, Math.ceil((s.spanFt * 12) / 7 / 6) * 6);   // wheelbase ≥ span/7
    const etPrefix = s.capacityTons >= 5 ? 'STT-170-150' : 'SCT-110-100';
    const et = cat.vendorParts(etPrefix).map(p => ({ ...p, wb: Number(p.part.split('-').pop()) })).filter(p => p.wb >= wb).sort((a, b) => a.wb - b.wb)[0]
      ?? cat.vendorParts('STT-130-100').map(p => ({ ...p, wb: Number(p.part.split('-').pop()) })).filter(p => p.wb >= wb).sort((a, b) => a.wb - b.wb)[0];
    if (et) vend(et.part, bridges); else notes.push('End trucks not found — pick in the editor.');
    vend(v === '460V' ? (s.capacityTons >= 5 ? 'SCP-0546' : 'SCP-0246') : (s.capacityTons >= 5 ? 'SCP-0523' : 'SCP-0323'), bridges);
  }
  if (s.control === 'radio') {
    const motions = (motorBridge ? 1 : 0) + (s.trolley === 'motorized' ? 1 : 0) + 1;
    vend(`S802-2R-${motions}M-SD`, bridges);
    std('Radio Receiving Units Pairing Charge', bridges * 2);
  }
  if (s.collisionAvoidance) vend('SCA-LZ-200T', bridges);

  // ---------- paint + decals ----------
  const tonsSteel = lbs / 2000;
  const runs = Math.max(1, Math.ceil(tonsSteel * 0.25));
  lines.push({ key: key(), kind: 'material', category: 'painting', family: fam, description: 'Standard paint full booth run (gray + Spark Orange)', qty: runs, unitSell: cat.paintRunSell });
  const decal = motorBridge ? '(13" x 36") Motorized Crane Die Cut Set' : s.series === 'UL' ? '(6"-10" tall decals) Ultra-Lite Crane Set' : '(11" - 13" tall decals) Manual Crane Decal Set';
  const ds = cat.decalSell(decal); if (ds) lines.push({ key: key(), kind: 'material', category: 'decals', family: fam, description: decal, qty: bridges, unitSell: ds });

  // ---------- shop labor: SMT-method hours × production factor ----------
  const shop = (description: string, hours: number) => { if (hours > 0) lines.push({ key: key(), kind: 'shop_labor', category: 'shopLabor', family: fam, description, qty: Math.round(hours * f.production * 10) / 10, laborOp: 'shop_other' }); };
  const smt: [string, number][] = [
    ['Cut list', 2 * n],
    ['Column fab (with gussets)', 2.5 * cols],
    [`PCR runways (${2 * runPieces * n} beams)`, (s.runwayOalFt / runPieces > 20 ? 2 : 1) * 2 * runPieces * n],
    [motorBridge ? (doubleGirder ? 'Double girder bridge fab + after-paint assembly' : 'Motorized bridge fab + after-paint assembly') : 'Manual bridge fab + after-paint assembly',
      (motorBridge ? (doubleGirder ? 105 : 60) : s.series === 'UL' ? 10 : 28) * bridges],
    ...(rail ? [['ASCE rail in shop', 0.05 * 2 * s.runwayOalFt * n] as [string, number]] : []),
    ...(s.collisionAvoidance ? [['Collision avoidance', 20 * bridges] as [string, number]] : []),
    ['Handling / shipping', Math.max(5, 2 * tonsSteel)],
  ];
  const smtShopHours = smt.reduce((a, [, h]) => a + h, 0);
  for (const [d, h] of smt) shop(d, h);

  // ---------- install (suggested) ----------
  let site = 0;
  if (s.install) {
    const siteLines: [string, number][] = [
      ['Unload, set up, layout', 10],
      [`Install crane columns (${cols})`, 3 * cols],
      [`Install runway beams / splices (${2 * runPieces * n})`, 3 * 2 * runPieces * n],
      ['Install runway end stops', 2 * n],
      ['Install electrification', 5.8 * s.runwayOalFt * n / 100],
      [motorBridge ? 'Install motorized bridge' : 'Install manual bridge', (motorBridge ? (s.capacityTons >= 5 ? 24 : 12) : 6) * bridges],
      ...(rail ? [['Install ASCE rail', 16 * 2 * s.runwayOalFt * n / 100] as [string, number]] : []),
      ...(s.collisionAvoidance ? [['Collision avoidance', 12.5 * bridges] as [string, number]] : []),
      ['Paint touch-up + cleanup', 20],
    ];
    const miles = s.miles ?? 0;
    if (miles > 0) siteLines.push([`Travel (${miles} mi each way, 2-man crew)`, Math.round(2 * 2 * miles / 55)]);
    for (const [d, h] of siteLines) {
      const hrs = Math.round(h * f.install * 10) / 10;
      site += hrs;
      lines.push({ key: key(), kind: 'site_labor', category: 'onsiteLabor', family: fam, description: d, qty: hrs, laborOp: 'site_other' });
    }
  }

  // ---------- PM / CAD ----------
  lines.push({ key: key(), kind: 'pm', category: 'pmMarketing', family: fam, description: 'Project management', qty: 15 + 5 * n });
  lines.push({ key: key(), kind: 'cad', category: 'cad', family: fam, description: 'AutoCAD design / approval drawings', qty: Math.round((12 + 4 * n) * 0.98) });

  if (s.capacityTons >= 5 && s.series !== 'GM') notes.push('5 ton and up is normally an FSTRGM (girder motorized) — check the series.');
  if (s.bridgeDrive === 'manual' && s.spanFt > 30) notes.push('Manual bridge over 30\' span is hard to push — consider motorized.');

  const freight = s.miles ? Math.ceil((3.6 * 1.2 * s.miles) / 10) * 10 * Math.max(1, Math.ceil(tonsSteel / 20)) : 0;
  return {
    lines, notes, suggestedInstallHours: Math.round(site * 10) / 10, smtShopHours,
    wording: wordingFreestanding(s, { cols, colsPer, steel, rail, motorBridge, hoistPart: hoistCandidates[0]?.description, lift, bridges, hoists, doubleGirder, bayFt }),
    doc: { family: fam, outboundFreight: freight, preUse: s.preUseInspection ? 1500 * n : 0, showPreUse: !!s.preUseInspection, suggestedInstallHours: s.install ? Math.round(site * 10) / 10 : null },
  };
}

function wordingFreestanding(s: FreestandingSpec, x: any): string {
  const series = `FSTR${s.series}${s.capacityTons < 1 ? tons(s.capacityTons).replace('/', '') : s.capacityTons}`;
  const title = s.series === 'UL' ? 'PWI TOP RUNNER ULTRALITE MANUAL BRIDGE CRANE SYSTEM' : x.motorBridge ? 'INCOMMAND TOP RUNNING MOTORIZED BRIDGE CRANE SYSTEM' : 'INCOMMAND TOP RUNNER MANUAL BRIDGE CRANE SYSTEM';
  const hoistTxt = `(${s.hoistsPerBridge ?? 1}) Starke - STK Series ${tons(s.capacityTons)} ton electric chain hoist`;
  const out = [
    `(${s.systems}) - ${series} ${title}`,
    '',
    'General Specs:',
    `Runway OAL:\t${ftIn(s.runwayOalFt)}`,
    `Bridge Crane Span:\t${ftIn(s.spanFt)}`,
    `Rated Capacity:\t${tons(s.capacityTons)} Ton with (${s.hoistsPerBridge ?? 1}) hoist`,
    `Hook Height:\t${ftIn(s.hookHeightFt)}`,
    `System Voltage:\t${s.voltage.replace('/3', '/3 phase')}`,
    '',
    'Crane Classification:',
    'Class C (Moderate Service): This service covers cranes whose service requirements are deemed moderate, handling loads which average 50 percent of the rated capacity with 5 to 10 lifts per hour, averaging 15 feet, with not over 50 percent of the lifts at rated capacity.',
    '',
    'Runway Package',
    `(${x.colsPer}) Square tube columns spaced at approx. ${ftIn(Math.round(x.bayFt))} span`,
    `${ftIn(s.runwayOalFt)} x ${tons(s.capacityTons)} Ton capacity WF beam runway system`,
    ...(x.rail ? ['30# ASCE rail and standard weld clips'] : []),
    'Runway system will include lateral and longitudinal tie back bracing',
    '(4) HD end stops',
    'Complete ElectroTrack electrification system',
    'Runways painted gray, columns painted two-tone gray and Spark Orange industrial coating',
    'Square tube support columns with gusseted base plates designed for a 6" concrete slab.',
    ...(s.bracedToBuilding ? ['Runway system to be braced to the existing building structure (details in approval drawings)'] : []),
    '',
    `(${x.bridges}) ${ftIn(s.spanFt)} x ${tons(s.capacityTons)} Ton Capacity ${x.motorBridge ? 'Top Running Motorized' : 'Top Running Manual'} Bridge Crane`,
    ...(x.motorBridge ? [`Includes ${tons(s.capacityTons)} ton top running motorized end trucks with 2-speed/VFD`] : [`Includes ${tons(s.capacityTons)} ton manual top running end trucks`]),
    hoistTxt,
    `${x.lift}' lift`,
    s.voltage.startsWith('460') ? '460V/3ph' : '230V/3ph',
    s.trolley === 'motorized' ? '(1) Starke motorized trolley — 2-speed/VFD' : '(1) Starke manual trolley',
    `${x.motorBridge ? 'Festoon' : 'Festoon'} electrification system on bridge`,
    'PWI HD end stops at each end of bridge crane',
    'Spark Orange industrial coating',
    'Rated capacity decals',
    '',
    ...(s.control === 'radio' ? ['Radio Remote Control System', `Starke Echo radio remote control system`, `Capable of ${x.motorBridge ? '3 Motion/2 Step control (N/S - E/W - Up/Down)' : 'hoist and trolley control'}`, 'Includes (1) spare transmitter', ''] : ['Pendant control', '']),
    ...(x.motorBridge ? ['Starke Control Panel', 'Equipped with VFD control for programmable 2-step control and start - stop operation', 'Warning strobe light to indicate bridge is in motion', ''] : []),
    ...(s.collisionAvoidance ? ['Collision Avoidance', 'Starke dual event twin laser collision avoidance for bridge crane to bridge crane and bridge crane to end stops', ''] : []),
    ...(s.install ? ['Installation', 'Complete installation by PWI crew, including setup, anchoring, electrification and final adjustments. Customer to provide power to the main disconnect.'] : ['Ship only — installation by others.']),
  ];
  return out.join('\n');
}
