// Freestanding crane auto-builder v2 (FSTRUL / FSTRM / FSTRGM / FSTRHL).
// Every number comes from rules/*.json (calibrated on PWI's sold quotes) and every guess is
// returned as an explicit Assumption the rep can see and change. Steel sizes come from the
// AQT sizing charts until Spenser's sizing tool is plugged in.
import type { QuoteLine } from './manual';
import R from './rules/freestanding_rules.json';
import CH from './rules/aqt_sizing_charts.json';

export interface Catalog {
  stdSell(description: string): number | null;
  stdHours(description: string): number;                 // shop hours built into a standard part
  vendor(part: string): { list: number; description: string; vendor: string } | null;
  vendorParts(prefix: string): { part: string; list: number; description: string }[];
  discount(vendor: string): { pwi: number; customer: number };
  shape(name: string): { lbPerFt: number; pricePerLb: number } | null;
  plate: { pricePerLb: number; markupPct: number; dropFactor: number };
  structuralMarkupPct: number;
  decalSell(name: string): number | null;
  equip(item: string): { daily: number; weekly: number; monthly: number } | null;
  rate?(item: string): number | null;                  // painting / travel rate items (live, editable)
}

export interface FreestandingSpec {
  series: 'UL' | 'M' | 'GM' | 'HL';
  systems?: number; runwayOalFt: number; spanFt: number; capacityTons: number;
  overallHeightFt?: number;                 // "20' tall" = overall height
  hookHeightFt?: number;                    // height under hook (only when they say "under hook")
  liftFt?: number; columnsPerSystem?: number; bridgesPerSystem?: number; hoistsPerBridge?: number;
  bridgeDrive: 'manual' | 'motorized'; trolley?: 'manual' | 'motorized';
  voltage: '460V/3' | '230V/3' | '208V/3' | string; control?: 'radio' | 'pendant';
  collisionAvoidance?: boolean; asceRail?: boolean; doubleGirder?: boolean; bracing?: boolean;
  foundation?: 'slab' | 'foundation';
  colors?: { columns?: string; runways?: string; bridge?: string };
  install: boolean; miles?: number; crewMen?: number; travelMode?: 'drive' | 'fly' | 'local';
  bracedToBuilding?: boolean; preUseInspection?: boolean;
}
export interface Assumption { field: string; value: unknown; why: string; alt?: unknown; altLabel?: string }
export interface BuildResult { lines: QuoteLine[]; assumptions: Assumption[]; notes: string[]; wording: string; suggestedInstallHours: number; smtShopHours: number;
  outboundFreight: number; preUse: number; blockers: string[]; geometry: Record<string, number | string>; tons: number }

type Norm = FreestandingSpec & { systems: number; trolley: 'manual' | 'motorized'; control: 'radio' | 'pendant'; voltage: '460V/3' | '230V/3' | '208V/3' };
export function normalize(x: FreestandingSpec): Norm {
  const v = String(x.voltage ?? '460').replace(/\s/g, '');
  if (x.overallHeightFt == null && x.hookHeightFt == null) throw new Error('Freestanding item needs overallHeightFt or hookHeightFt');
  const num = (k: string, v: unknown, lo: number, hi: number, need = false) => {
    if (v == null) { if (need) throw new Error(`Missing ${k}.`); return; }
    if (typeof v !== 'number' || !isFinite(v) || v < lo || v > hi) throw new Error(`${k} = ${v} is outside what the auto-builder handles (${lo}–${hi}). Quote this one by hand.`);
  };
  num('capacityTons', x.capacityTons, 0.25, 10, true); num('spanFt', x.spanFt, 5, 60, true); num('runwayOalFt', x.runwayOalFt, 8, 400, true);
  num('overallHeightFt', x.overallHeightFt, 8, 30); num('hookHeightFt', x.hookHeightFt, 6, 28); num('systems', x.systems, 1, 10);
  num('bridgesPerSystem', x.bridgesPerSystem, 1, 2); num('hoistsPerBridge', x.hoistsPerBridge, 1, 2); num('columnsPerSystem', x.columnsPerSystem, 4, 40);
  num('liftFt', x.liftFt, 8, 60); num('crewMen', x.crewMen, 2, 4);
  if (x.install || x.miles != null) num('miles', x.miles, 0, 3500, true);
  if (!['UL', 'M', 'GM', 'HL'].includes(x.series)) throw new Error(`Unknown series ${x.series}.`);
  if (!['manual', 'motorized'].includes(x.bridgeDrive)) throw new Error('bridgeDrive must be manual or motorized.');
  // keep only known fields (drop anything a link could smuggle in)
  const K = ['series', 'systems', 'runwayOalFt', 'spanFt', 'capacityTons', 'overallHeightFt', 'hookHeightFt', 'liftFt', 'columnsPerSystem', 'bridgesPerSystem', 'hoistsPerBridge',
    'bridgeDrive', 'trolley', 'voltage', 'control', 'collisionAvoidance', 'asceRail', 'doubleGirder', 'bracing', 'foundation', 'colors', 'install', 'miles', 'crewMen', 'travelMode',
    'bracedToBuilding', 'preUseInspection'] as const;
  x = Object.fromEntries(K.filter(k => (x as any)[k] !== undefined).map(k => [k, (x as any)[k]])) as FreestandingSpec;
  return { ...x, systems: Math.max(1, x.systems ?? 1), trolley: x.trolley ?? x.bridgeDrive, control: x.control ?? (x.bridgeDrive === 'motorized' ? 'radio' : 'pendant'),
    voltage: v.startsWith('208') ? '208V/3' : v.startsWith('230') || v.startsWith('240') ? '230V/3' : '460V/3' };
}

const pick = <T>(tbl: [number, T][], x: number): T => (tbl.find(([m]) => x <= m) ?? tbl[tbl.length - 1])[1];
const depthIn = (shape: string) => Number(/^(?:W|ST|RT|TC)\s*(\d+)/.exec(shape)?.[1] ?? 12);
const STD_COLORS = /^(gray|grey|spark orange|two-tone|standard)/i;
let seq = 0; const key = () => `v2${(seq++).toString(36)}`;

function chartPick(rows: any[], keyName: string, x: number, cap: number): string | null {
  const caps: number[] = CH.capacities; const c = caps.find(v => v >= cap - 1e-9) ?? caps[caps.length - 1];
  const row = rows.find(r => r[keyName] >= x - 1e-9) ?? null;
  return row ? row.byCap[String(c)] ?? null : null;
}
export function buildFreestanding(spec: FreestandingSpec, cat: Catalog, f = { production: 0.56, install: 1.02 }): BuildResult {
  const s0 = normalize(spec);
  const s = s0;
  const A: Assumption[] = []; const notes: string[] = []; const lines: QuoteLine[] = []; const fam = 'freestanding';
  const cap = s.capacityTons, n = Math.max(1, s.systems), bridges = (s.bridgesPerSystem ?? 1) * n, hoists = bridges * (s.hoistsPerBridge ?? 1);
  const motor = s.bridgeDrive === 'motorized';
  const rail = s.asceRail ?? (motor && cap >= 5);
  if (s0.asceRail == null) A.push({ field: 'asceRail', value: rail, why: rail ? 'Motorized ≥5 t gets 30# ASCE rail (all sold 5–10 t jobs)' : 'Under 5 t: bridge runs on the beam flange', alt: !rail });

  // ---------- geometry: bays, height ----------
  const maxBay = pick(R.bays.maxBayFtByCap as [number, number][], cap);
  const bays = s.columnsPerSystem ? Math.max(1, s.columnsPerSystem / 2 - 1) : Math.max(1, Math.ceil(s.runwayOalFt / maxBay));
  const colsPer = s.columnsPerSystem ?? 2 * (bays + 1), cols = colsPer * n, bayFt = s.runwayOalFt / bays;
  if (!s.columnsPerSystem) A.push({ field: 'columnsPerSystem', value: colsPer, why: `Bays ≤ ${maxBay}' for ${cap} t → ${bays} bays of ${bayFt.toFixed(1)}'`, alt: colsPer + 2, altLabel: `${colsPer + 2} columns (shorter bays, lighter runway)` });
  // runway pieces: one per bay, two bays per piece when it stays ≤ 40'
  const perPiece = bayFt * 2 <= R.bays.combineBaysUpToFt ? 2 : 1;
  const piecesPerLine = Math.ceil(bays / perPiece), pieceFt = Math.ceil(bayFt * perPiece + 0.5);
  const doubleGirder = s.doubleGirder ?? cap >= 15;
  if (s0.doubleGirder == null && s.series === 'GM') A.push({ field: 'doubleGirder', value: doubleGirder, why: doubleGirder ? '≥15 t → double girder' : 'Single girder is the sold default up to 10 t (29354, 29331); double only for headroom/specials (29523)', alt: !doubleGirder, altLabel: doubleGirder ? 'Single girder' : 'Double girder (+45 shop h/bridge)' });

  // ---------- steel sizing: nearest sold job, else AQT chart ----------
  const basis: 'overall' | 'hook' = s.overallHeightFt != null ? 'overall' : 'hook';
  const hRaw = s.overallHeightFt ?? s.hookHeightFt!;
  const headroom = pick(R.height.headroomFtByCap as [number, number][], cap);
  const overall = basis === 'overall' ? hRaw : hRaw + headroom;
  const hook = basis === 'hook' ? hRaw : hRaw - headroom;
  A.push({ field: 'heightBasis', value: basis, why: basis === 'overall' ? `"${hRaw}' tall" read as OVERALL height → hook ≈ ${hook.toFixed(1)}' (${headroom}' hoist/bridge headroom)` : `Hook height ${hRaw}' → overall ≈ ${overall.toFixed(1)}'`,
    alt: basis === 'overall' ? 'hook' : 'overall', altLabel: basis === 'overall' ? `${hRaw}' is hook height (system ${(hRaw + headroom).toFixed(1)}' tall)` : `${hRaw}' is overall height` });
  let column = chartPick(CH.column_by_overall_height, 'overallHeightFt', overall, cap);
  const blockers: string[] = [];
  const chartMax = (rows: any[]) => { const r = rows[rows.length - 1].byCap; const ks = Object.keys(r).map(Number).sort((a, b) => a - b); return r[String(ks[ks.length - 1])]; };
  let runway = chartPick(CH.runway_by_bay, 'bayFt', bayFt, cap);
  if (!runway) throw new Error(`${bayFt.toFixed(1)}' bays at ${cap} t are past the sizing chart — add columns or quote by hand.`);
  let girder = s.series === 'UL' || s.series === 'HL' ? null : chartPick(CH.girder_by_span, 'spanFt', s.spanFt, cap);
  if (girder === null && s.series !== 'UL' && s.series !== 'HL') {
    girder = chartMax(CH.girder_by_span);
    blockers.push(`${s.spanFt}' span at ${cap} t is past the AQT girder chart — engineering must size the girder (priced as ${girder} placeholder).`);
  }
  const builtUp = cap >= R.columnType.builtUpFromCap || !column || overall > R.columnType.maxChartHeightFt + 2;
  let builtUpPlf = pick(R.columnType.builtUpPlfByCap as [number, number][], cap);
  A.push({ field: 'steelSource', value: 'chart', why: 'Steel from the AQT sizing chart (height × capacity, bay × capacity, span × capacity) — engineering to confirm' });
  const runDepthFt = depthIn(runway) / 12;
  const colLen = Math.ceil((overall - runDepthFt - (rail ? R.height.railHeightFt : 0) - R.height.topPlateFt) / R.height.roundColumnToFt) * R.height.roundColumnToFt;
  const columnType = builtUp ? 'built_up' : /^W/.test(column!) ? 'wide_flange' : 'tube';
  const foundation = s.foundation ?? (builtUp ? 'foundation' : 'slab');
  if (!s.foundation) A.push({ field: 'foundation', value: foundation, why: foundation === 'foundation' ? 'Built-up plate columns need concrete foundations (by others), epoxy anchors' : 'Gusseted base plates on a 6" slab', alt: foundation === 'slab' ? 'foundation' : 'slab' });

  // ---------- structural + plate ----------
  let lbs = 0, units = 0, heaviestLb = 0, longest = 0;
  const unitsFor = (qty: number, len: number) => qty * Math.max(1, Math.ceil(len / R.paint.maxLenFt - 1e-9));
  const steel = (desc: string, shape: string, qty: number, len: number) => {
    const sh = cat.shape(shape); if (!sh) { notes.push(`Shape ${shape} not in steel list.`); return 0; }
    lines.push({ key: key(), kind: 'material', category: 'structural', family: fam, description: `${desc} — ${shape} × ${len}'`, qty, unitCost: Math.round(sh.lbPerFt * len * sh.pricePerLb * 100) / 100, markupPct: cat.structuralMarkupPct });
    units += unitsFor(qty, len); heaviestLb = Math.max(heaviestLb, sh.lbPerFt * len); longest = Math.max(longest, len);
    lbs += sh.lbPerFt * len * qty; return sh.lbPerFt * len;
  };
  const plate = (desc: string, qty: number, t: number, w: number, l: number) => {
    const lb = t * w * l * 0.2833 * cat.plate.dropFactor; lbs += lb * qty;
    lines.push({ key: key(), kind: 'material', category: 'plate', family: fam, description: `${desc} — ${t}" × ${w}" × ${l}"`, qty, unitCost: Math.round(lb * cat.plate.pricePerLb * 100) / 100, markupPct: cat.plate.markupPct });
  };
  if (builtUp) {
    const lb = builtUpPlf * colLen * 1.03; lbs += lb * cols; units += unitsFor(cols, colLen); heaviestLb = Math.max(heaviestLb, lb);
    lines.push({ key: key(), kind: 'material', category: 'plate', family: fam, description: `Built-up plate columns — ${builtUpPlf} plf × ${colLen}'`, qty: cols, unitCost: Math.round(lb * cat.plate.pricePerLb * 100) / 100, markupPct: cat.plate.markupPct });
  } else steel('Columns', column!, cols, colLen);
  steel('Runways', runway, 2 * piecesPerLine * n, pieceFt);
  const girderLb = girder ? steel(doubleGirder ? 'Bridge girders (double)' : 'Bridge girder', girder, bridges * (doubleGirder ? 2 : 1), Math.ceil(s.spanFt + 2)) * (doubleGirder ? 2 : 1) : 0;
  const bracing = s.bracing ?? (columnType === 'tube' && (colsPer >= 6 || cap >= 3));
  if (bracing) steel('Bracing', 'ST 3 x 3 x 1/4', 6 * n, 20);
  const bp = (R.basePlate as [number, number, number][]).find(([m]) => cap <= m) ?? [0, 1, 24];
  plate('Column base plates', cols, bp[1], bp[2], bp[2]);
  plate('Column top plates', cols, cap <= 1 ? 0.375 : 0.5, cap <= 3 ? 10 : 18, cap <= 3 ? 14 : 12);
  if (columnType === 'tube') plate('Column gussets', cols * 4, cap <= 1 ? 0.25 : 0.3125, 5, 12);
  if (cap >= 5) plate('Runway web stiffeners', 2 * piecesPerLine * n * 2, 0.3125, 6, 16);
  plate('Runway splice / end plates', 2 * (piecesPerLine + 1) * n, 0.375, 8, 14);
  if (girder) plate('Bridge end plates', bridges * 2, 0.375, 15, 21);

  // ---------- standard parts ----------
  let builtHrs = 0;
  const std = (description: string, qty: number) => {
    if (qty <= 0) return; const sell = cat.stdSell(description);
    if (sell == null) { notes.push(`Standard part not found: ${description}`); return; }
    lines.push({ key: key(), kind: 'material', category: 'stdParts', family: fam, description, qty, unitSell: sell });
    builtHrs += qty * (cat.stdHours(description));
  };
  const anc = (R.anchors as any[]).find(a => cap <= a.maxCap && (a.wording !== 'foundation' || foundation === 'foundation')) ?? R.anchors[1];
  const anchorRule = foundation === 'foundation' ? R.anchors[2] : anc.wording === 'foundation' ? R.anchors[1] : anc;
  std(anchorRule.part, cols * anchorRule.perColumn); for (const p of anchorRule.plus ?? []) std(p.part, cols * p.perColumn);
  std(cap >= 2 ? '3/4" Structural Bolt and Nut' : '5/8" Structural Bolt and Nut', 8 * cols + 16 * bridges);
  const amps = cap >= 5 || bridges > 1 ? '120' : '65';
  std(`Runway Electrification Package (4-Conductor x ${amps} amp max)`, Math.ceil(s.runwayOalFt) * n);
  std(motor ? 'Motorized Bridge Crane Electrification Package (per foot)' : 'Manual Bridge Crane Electrification Package (per foot)', Math.ceil(s.spanFt) * bridges);
  std(motor && amps === '120' ? '120 Amp Tandem Collector Set (for VFD)' : '65 Amp Single Collector Set  (Non-VFD)', bridges * (motor && amps === '120' ? 2 : 1));
  std('Beam End Stop Kit for Runway System (4 total per kit)', n);
  std('PWI HD Adjustable End Stop Kit (slides on Flange)', 2 * bridges);
  if (motor && s.spanFt >= 10) std(cap <= 2 ? 'End Truck Plug & Play Upcharge (2 ton or smaller)' : 'End Truck Plug & Play Upcharge (3 ton or larger)', bridges);
  if (rail) std(cap <= 10 ? '30# ASCE Crane Rail (per linear foot including clips and splicers)' : '40# ASCE Crane Rail (per linear foot including clips and splicers)', 2 * Math.ceil(s.runwayOalFt) * n);
  if (s.series === 'UL') std(cap <= 0.5 ? '1/2 Ton Manual Ultra-Lite End Truck Kit  39.5"' : cap <= 1 ? '1 Ton Manual Ultra-Lite End Truck Kit 39.5"' : cap <= 2 ? '2 Ton Manual Ultra-Lite End Truck Kit 39.5"' : '3 Ton Manual Ultra-Lite End Truck Kit', bridges);
  else if (!motor) std(s.spanFt <= 20 ? 'PWI Manual Top Runner End Truck Kit 32.5"' : s.spanFt <= 30 ? 'PWI Manual Top Runner End Truck Kit 38.25"' : 'PWI Manual Top Runner End Truck Kit 50.25"', bridges);

  // ---------- vendor ----------
  const vend = (part: string, qty: number) => {
    const p = cat.vendor(part); if (!p) { notes.push(`Vendor part not found: ${part}`); return; }
    const d = cat.discount(p.vendor), cost = p.list * (1 - d.pwi / 100), sell = p.list * (1 - d.customer / 100);
    lines.push({ key: key(), kind: 'material', category: 'vendor', family: fam, description: `${p.vendor} ${part} — ${p.description}`, qty, unitCost: Math.round(cost * 100) / 100, markupPct: Math.round((sell / cost - 1) * 10000) / 100 });
  };
  const v = s.voltage.startsWith('460') ? '460V' : '230V';
  const lift = s.liftFt ?? Math.max(10, Math.ceil((hook + 2) / 5) * 5);
  if (s0.liftFt == null) A.push({ field: 'liftFt', value: lift, why: `Hook ${hook.toFixed(1)}' + 2' → next stocked lift`, alt: lift + 10 });
  const capCode = cap < 1 ? '05' : String(Math.round(cap * 10)).padStart(2, '0');
  const liftOf = (p: string) => Number(/-(\d+)-/.exec(p)?.[1] ?? 0);
  let hoist: { part: string } | undefined;
  if (cap <= 3) hoist = cat.vendorParts(`STK${capCode}`).filter(p => p.part.includes(`-${v}-3PH-${s.trolley === 'motorized' ? 'C' : 'B'}`) && liftOf(p.part) >= lift).sort((a, b) => liftOf(a.part) - liftOf(b.part))[0];
  else {
    const fam2 = doubleGirder ? 'STW' : 'SMW'; const c2 = String(Math.round(cap)).padStart(2, '0');
    hoist = cat.vendorParts(`${fam2}${c2}`).filter(p => p.part.includes(`-${v}`) && liftOf(p.part) >= lift && !/V$/.test(p.part)).sort((a, b) => liftOf(a.part) - liftOf(b.part))[0];
    A.push({ field: 'hoistFamily', value: `Starke ${fam2} wire rope`, why: '≥5 t sold jobs used wire rope (SMW single girder 29331; STW double girder 29523)' });
  }
  if (hoist) vend(hoist.part, hoists); else notes.push(`No hoist found for ${cap} t / ${lift}' / ${v} — pick in editor.`);
  if (motor) {
    const W = R.endTruckWheelbase; const wb = Math.max(W.minIn, Math.ceil(s.spanFt * 12 / W.spanInPerWbIn / W.stepIn) * W.stepIn);
    const pre = pick(R.endTruck as [number, string][], cap);
    const et = cat.vendorParts(pre).map(p => ({ ...p, wb: Number(p.part.split('-').pop()) })).filter(p => p.wb >= wb).sort((a, b) => a.wb - b.wb)[0];
    if (et) vend(et.part, bridges); else notes.push(`End truck ${pre}-${wb} not found.`);
    vend(pick((v === '460V' ? R.panel460 : R.panel230) as [number, string][], cap), bridges);
  }
  if (s.control === 'radio') { vend(`S802-2R-${(motor ? 1 : 0) + (s.trolley === 'motorized' ? 1 : 0) + 1}M-SD`, bridges); std('Radio Receiving Units Pairing Charge', bridges * 2); }
  if (s.collisionAvoidance) vend('SCA-LZ-200T', bridges);

  // ---------- paint (piece-unit rule + custom colour) ----------
  const P = { ...R.paint, standardRun: cat.rate?.('Standard Paint Full Booth Run') ?? R.paint.standardRun, customRun: cat.rate?.('Custom Color Paint Full Booth Run') ?? R.paint.customRun }; const runsFor = (u: number) => Math.max(1, Math.ceil(u / P.piecesPerRun / P.roundTo) * P.roundTo);
  const custom = Object.entries(s.colors ?? {}).filter(([, c]) => c && !STD_COLORS.test(c));
  const colUnits = unitsFor(cols, colLen);
  if (custom.length) {
    const customUnits = custom.reduce((a, [part]) => a + (part === 'columns' ? colUnits : part === 'runways' ? unitsFor(2 * piecesPerLine * n, pieceFt) : bridges * 2), 0);
    const cRuns = Math.max(P.customMinRuns, Math.ceil(customUnits / P.piecesPerRun));
    lines.push({ key: key(), kind: 'material', category: 'painting', family: fam, description: `Custom color paint full booth run (${custom.map(([p, c]) => `${p}: ${c}`).join(', ')})`, qty: cRuns, unitSell: P.customRun });
    const rest = Math.max(0, units - customUnits); if (rest > 0) lines.push({ key: key(), kind: 'material', category: 'painting', family: fam, description: 'Standard paint full booth run (gray + Spark Orange)', qty: runsFor(rest), unitSell: P.standardRun });
    A.push({ field: 'colors', value: s.colors, why: `Custom color = $${P.customRun}/run, min ${P.customMinRuns} full run (template rule); ${customUnits} piece-units custom`, alt: {}, altLabel: 'Standard gray / Spark Orange' });
  } else lines.push({ key: key(), kind: 'material', category: 'painting', family: fam, description: 'Standard paint full booth run (gray + Spark Orange)', qty: runsFor(units), unitSell: P.standardRun });
  const decal = motor ? '(13" x 36") Motorized Crane Die Cut Set' : s.series === 'UL' ? '(6"-10" tall decals) Ultra-Lite Crane Set' : '(11" - 13" tall decals) Manual Crane Decal Set';
  const ds = cat.decalSell(decal); if (ds) lines.push({ key: key(), kind: 'material', category: 'decals', family: fam, description: decal, qty: bridges, unitSell: ds });

  // ---------- shop hours (SMT labor ops) ----------
  const O = R.shopOps; const matSell = () => lines.filter(l => l.kind === 'material').reduce((a, l) => a + (l.unitSell != null && l.unitCost == null ? l.unitSell * l.qty : (l.unitCost ?? 0) * l.qty * (1 + (l.markupPct ?? 0) / 100)), 0);
  const runBeams = 2 * piecesPerLine * n;
  const bType = s.series === 'UL' ? 'ultralite' : !motor ? 'manual' : doubleGirder ? 'double' : 'single';
  const smt: [string, number][] = [
    ['Cut list', O.cutList * n],
    [`Column fab (${columnType})`, columnType === 'built_up' ? O.colBuiltUpPerFt * colLen * cols : columnType === 'wide_flange' ? O.colWideFlangeMoment * cols : O.colTubeGusset * cols],
    [`PCR runways (${runBeams})`, (pieceFt > 20 ? O.pcrRunwayGT20 : O.pcrRunwayLE20) * runBeams],
    ...(cap >= O.webStiffenersPerBeamFromCap[0] ? [['Runway web stiffeners', O.webStiffenersPerBeamFromCap[1] * runBeams] as [string, number]] : []),
    [`Bridge fab + after-paint (${bType})`, ((O.bridge as any)[bType] + (s.spanFt > 70 ? O.bridge.over70ftAdd : 0)) * bridges],
    ...(s.collisionAvoidance ? [['Collision avoidance', O.collisionAvoidPerBridge * bridges] as [string, number]] : []),
    ['PWI built standard parts', builtHrs],
  ];
  const handling = Math.max(O.handling.min, Math.round(O.handling.pctOfMaterialSell * matSell() / O.handling.perHour));
  smt.push(['Handling / shipping', handling]);
  const smtShopHours = smt.reduce((a, [, h]) => a + h, 0);
  for (const [d, h] of smt) if (h > 0) lines.push({ key: key(), kind: 'shop_labor', category: 'shopLabor', family: fam, description: d, qty: Math.round(h * f.production * 10) / 10, laborOp: 'shop_other' });

  // ---------- install, crew, travel, equipment ----------
  const T = { ...R.travel, hotel: cat.rate?.('Hotels (one room per person)') ?? R.travel.hotel, perDiem: cat.rate?.('Per diem costs') ?? R.travel.perDiem }, S2 = R.siteOps; let site = 0; const miles = s.miles ?? 0;
  const tons = lbs / 2000;
  if (s.install) {
    const bridgeLb = girderLb + 1200 + (cap >= 5 ? 1500 : 300);
    const pieceLong = pieceFt > 40;
    const sl: [string, number][] = [
      ['Unload, set up, layout', S2.setup], [`Install columns (${cols})`, S2.column * cols],
      [`Install runway beams (${runBeams})`, (pieceLong ? S2.runwayPieceOver40 : S2.runwayPiece) * runBeams], ['Install runway end stops', S2.endStops * n],
      ['Install electrification', S2.electrificationPer100ftOal * s.runwayOalFt * n / 100],
      [`Install bridge (${bridges})`, (!motor ? S2.manualBridge : bridgeLb >= 8000 ? S2.bridgeOver8k : S2.bridgeUnder8k) * bridges],
      ...(rail ? [['Install ASCE rail', S2.railPer100ftOal * s.runwayOalFt * n / 100] as [string, number]] : []),
      ...(s.collisionAvoidance ? [['Collision avoidance', S2.collisionAvoidPerBridge * bridges] as [string, number]] : []),
      ...(bracing ? [['Install bracing', S2.bracingPerLocation * 6 * n] as [string, number]] : []),
    ];
    const sub = sl.reduce((a, [, h]) => a + h, 0);
    sl.push(['Paint touch-up + cleanup', S2.touchupCleanup.base + S2.touchupCleanup.pctOfSubtotal * sub]);
    const workHrs = sl.reduce((a, [, h]) => a + h, 0) * f.install;
    const men = s.crewMen ?? pick(R.crew.menIfHoursAbove as [number, number][], workHrs);
    if (!s.crewMen) A.push({ field: 'crewMen', value: men, why: `${Math.round(workHrs)} on-site hours → ${men}-man crew`, alt: men === 2 ? 3 : 2 });
    const crewDays = Math.max(1, Math.ceil(workHrs / (men * R.crew.hoursPerDay) - R.crew.dayRoundSlack));
    const mode = s.travelMode ?? (miles <= T.localMiles ? 'local' : miles > T.flyAboveMiles ? 'fly' : 'drive');
    if (!s.travelMode) A.push({ field: 'travelMode', value: mode, why: mode === 'local' ? `${miles} mi — daily commute, no lodging` : mode === 'fly' ? `${miles} mi > ${T.flyAboveMiles} — crew flies, rental car, tools ship LTL` : `${miles} mi — crew drives`, alt: mode === 'fly' ? 'drive' : mode === 'drive' ? 'fly' : 'drive' });
    const travelHrs = mode === 'local' ? men * 2 * crewDays * miles / T.driveMph : mode === 'fly' ? men * 2 * T.flyDoorToDoorHrsEachWay : men * 2 * miles / T.driveMph;
    for (const [d, h] of sl) { const hrs = Math.round(h * f.install * 10) / 10; site += hrs; lines.push({ key: key(), kind: 'site_labor', category: 'onsiteLabor', family: fam, description: d, qty: hrs, laborOp: 'site_other' }); }
    if (travelHrs > 0) { const th = Math.round(travelHrs); site += th; lines.push({ key: key(), kind: 'site_labor', category: 'onsiteLabor', family: fam, description: `Travel (${mode}, ${men} men, ${miles} mi)`, qty: th, laborOp: 'site_travel' }); }
    // lodging + per diem
    if (mode !== 'local') {
      const days = crewDays + (miles > T.sameDayDriveMiles ? 2 : 0);   // + travel day each way unless a same-day drive
      const mk = 1 + T.markupPct / 100;
      const tl = (d: string, qty: number, cost: number) => lines.push({ key: key(), kind: 'travel', category: 'travel', family: fam, description: d, qty, unitCost: cost, markupPct: T.markupPct });
      tl(`Hotels — ${men} rooms × ${days - 1} nights`, men * (days - 1), T.hotel);
      tl(`Per diem — ${men} men × ${days} days`, men * days, T.perDiem);
      if (mode === 'fly') { tl('Flights (round trip per man)', men, T.flightPerMan); tl('Rental car (weekly)', Math.ceil(days / 7), T.rentalCarWeekly); tl('LTL tool return to PWI', 1, T.toolReturnLtl); }
      A.push({ field: 'crewDays', value: crewDays, why: `${Math.round(workHrs)} h ÷ (${men} men × ${R.crew.hoursPerDay} h) → ${crewDays} days on site + ${days - crewDays} travel days; lodging $${T.hotel}/night, per diem $${T.perDiem} (+${T.markupPct}%)` });
      void mk;
    }
    // equipment
    const E = R.equipment; const colTop = colLen + runDepthFt;
    const weeks = Math.ceil(crewDays / 5);
    const eq = (item: string, qty: number) => {
      const it = cat.equip(item); if (!it) { notes.push(`Equipment ${item} not in list`); return; }
      const useWeekly = crewDays >= E.weekly.fromDays; const unit = useWeekly ? (weeks >= E.monthly.fromWeeks ? it.monthly * weeks / 4 : it.weekly * weeks) : it.daily * crewDays;
      lines.push({ key: key(), kind: 'equipment', category: 'equipment', family: fam, description: `${item} — ${useWeekly ? `${weeks} wk` : `${crewDays} day`}`, qty, unitCost: Math.round(unit * 100) / 100, markupPct: E.markupPct });
    };
    const liftItem = E.lift.find(l => colTop <= l.maxColumnTopFt)!.item;
    eq(liftItem, (E.liftsByMen as any)[String(men)] ?? 1);
    const pick1 = Math.max(heaviestLb, bridgeLb) * E.handler.reachFactor;
    const handler = (E.handler.classes as [number, string][]).find(([m]) => pick1 <= m)?.[1];
    if (handler) eq(handler, 1); else { eq('Rental 15K Telehandler', 1); blockers.push(`Heaviest pick ≈ ${Math.round(pick1 / 1.3)} lb — ${E.handler.aboveMaxFlag}.`); }
    if (rail) eq('Wacker Neuson Large Generator', 1);
    lines.push({ key: key(), kind: 'equipment', category: 'equipment', family: fam, description: 'Rental delivery / pickup', qty: 1 + (handler && handler !== 'Rental Fork Lift' ? 1 : 0), unitCost: E.deliveryFee, markupPct: 0 });
    A.push({ field: 'equipment', value: `${liftItem}, ${handler ?? '15K telehandler + crane?'}${rail ? ', generator' : ''} × ${weeks} wk`, why: `Column top ≈ ${colTop.toFixed(1)}', heaviest pick ≈ ${Math.round(Math.max(heaviestLb, bridgeLb))} lb, ${crewDays} crew days` });
  }

  // ---------- freight ----------
  const F = R.freight; const bucket = miles <= 500 ? '0-500' : miles <= 1000 ? '500-1000' : miles <= 1500 ? '1000-1500' : '1500+';
  const type = (F.typeRule as any[]).find(t => tons <= t.maxTons && longest <= t.maxPieceFt)?.type ?? 'FB';
  const loads = type === 'FB' ? Math.ceil(tons / F.tonsPerLoad) : 1;
  const oversize = longest > F.oversizeIfPieceOverFt ? 1 : 0;
  const rate = (t: string) => (F.ratePerMile as any)[t][bucket];
  const freight = miles > 0 ? Math.ceil(((loads - oversize) * rate(type) + oversize * rate('OSL')) * miles * (1 + F.markup) / 10) * 10 : 0;
  if (miles > 0) A.push({ field: 'freight', value: `${loads} × ${type}${oversize ? ' (1 oversize)' : ''}`, why: `${tons.toFixed(1)} t, longest piece ${longest}' , ${miles} mi @ $${rate(type)}/mi (freight history) +${F.markup * 100}%` });

  // ---------- PM / CAD scale with job size ----------
  const base0 = matSell() + smtShopHours * f.production * (140 + 38.6);
  const pm = Math.max(R.pmCad.pmMin, Math.round(R.pmCad.pmHrsPer10k * base0 / 1e4));
  const cad = Math.max(R.pmCad.cadMin, Math.round(R.pmCad.cadHrsPer10k * base0 / 1e4 * 0.98));
  lines.push({ key: key(), kind: 'pm', category: 'pmMarketing', family: fam, description: 'Project management', qty: pm });
  lines.push({ key: key(), kind: 'cad', category: 'cad', family: fam, description: 'AutoCAD design / approval drawings', qty: cad });

  const geo = { overall, hook, colLen, colsPer, bayFt, rail, motor, doubleGirder, lift, bridges, builtUp, foundation, hoistDesc: hoist ? cat.vendor(hoist.part)?.description ?? '' : '' };
  for (const n of notes) if (/not found|not in/.test(n)) blockers.push(n);
  return { lines, assumptions: A, notes, blockers, wording: wording(s, geo), preUse: s.preUseInspection ? 1500 * n : 0, suggestedInstallHours: Math.round(site * 10) / 10, smtShopHours, outboundFreight: freight, tons,
    geometry: { overall: +overall.toFixed(2), hook: +hook.toFixed(2), colLen, column: builtUp ? `built-up ${builtUpPlf} plf` : column!, runway, girder: girder ?? '', bays, bayFt: +bayFt.toFixed(1), pieceFt, piecesPerLine, units } };
}


function wording(s: Norm, x: any): string {
  const series = `FSTR${s.series}${s.capacityTons < 1 ? tons(s.capacityTons).replace('/', '') : s.capacityTons}`;
  const title = s.series === 'UL' ? 'PWI TOP RUNNER ULTRALITE MANUAL BRIDGE CRANE SYSTEM' : x.motor ? 'INCOMMAND TOP RUNNING MOTORIZED BRIDGE CRANE SYSTEM' : 'INCOMMAND TOP RUNNER MANUAL BRIDGE CRANE SYSTEM';
  const hoistTxt = `(${s.hoistsPerBridge ?? 1}) Starke ${s.capacityTons >= 5 ? 'wire rope' : 'STK Series electric chain'} hoist, ${tons(s.capacityTons)} ton`;
  const out = [
    `(${s.systems}) - ${series} ${title}`,
    '',
    'General Specs:',
    `Runway OAL:\t${ftIn(s.runwayOalFt)}`,
    `Bridge Crane Span:\t${ftIn(s.spanFt)}`,
    `Rated Capacity:\t${tons(s.capacityTons)} Ton with (${s.hoistsPerBridge ?? 1}) hoist`,
    `Hook Height:\t${ftIn(Math.floor(x.hook * 12) / 12)}`,
    `Overall Height:\t${ftIn(Math.ceil(x.overall * 12) / 12)}`,
    `System Voltage:\t${s.voltage.replace('/3', '/3 phase')}`,
    '',
    'Crane Classification:',
    'Class C (Moderate Service): This service covers cranes whose service requirements are deemed moderate, handling loads which average 50 percent of the rated capacity with 5 to 10 lifts per hour, averaging 15 feet, with not over 50 percent of the lifts at rated capacity.',
    '',
    'Runway Package',
    `(${x.colsPer}) ${x.builtUp ? 'Built-up plate' : 'Structural'} columns spaced at approx. ${ftIn(Math.round(x.bayFt))} bays`,
    `${ftIn(s.runwayOalFt)} x ${tons(s.capacityTons)} Ton capacity WF beam runway system`,
    ...(x.rail ? ['30# ASCE rail and standard weld clips'] : []),
    'Runway system will include lateral and longitudinal tie back bracing',
    '(4) HD end stops',
    'Complete ElectroTrack electrification system',
    paintLine(s),
    x.foundation === 'foundation' ? 'Columns set on concrete foundations by others, with epoxy anchors and grouted base plates' : 'Support columns with gusseted base plates designed for a 6" concrete slab',
    ...(s.bracedToBuilding ? ['Runway system to be braced to the existing building structure (details in approval drawings)'] : []),
    '',
    `(${x.bridges}) ${ftIn(s.spanFt)} x ${tons(s.capacityTons)} Ton Capacity ${x.doubleGirder ? 'Double Girder ' : ''}${x.motor ? 'Top Running Motorized' : 'Top Running Manual'} Bridge Crane`,
    ...(x.motor ? [`Includes ${tons(s.capacityTons)} ton top running motorized end trucks with 2-speed/VFD`] : [`Includes ${tons(s.capacityTons)} ton manual top running end trucks`]),
    hoistTxt,
    `${x.lift}' lift`,
    s.voltage.startsWith('460') ? '460V/3ph' : '230V/3ph',
    s.trolley === 'motorized' ? '(1) Starke motorized trolley — 2-speed/VFD' : '(1) Starke manual trolley',
    'Festoon electrification system on bridge',
    'PWI HD end stops at each end of bridge crane',
    s.colors?.bridge && !STD_COLORS.test(s.colors.bridge) ? `Bridge painted ${s.colors.bridge} (custom color)` : 'Spark Orange industrial coating',
    'Rated capacity decals',
    '',
    ...(s.control === 'radio' ? ['Radio Remote Control System', `Starke Echo radio remote control system`, `Capable of ${x.motor ? '3 Motion/2 Step control (N/S - E/W - Up/Down)' : 'hoist and trolley control'}`, 'Includes (1) spare transmitter', ''] : ['Pendant control', '']),
    ...(x.motor ? ['Starke Control Panel', 'Equipped with VFD control for programmable 2-step control and start - stop operation', 'Warning strobe light to indicate bridge is in motion', ''] : []),
    ...(s.collisionAvoidance ? ['Collision Avoidance', 'Starke dual event twin laser collision avoidance for bridge crane to bridge crane and bridge crane to end stops', ''] : []),
    ...(s.install ? ['Installation', 'Complete installation by PWI crew, including setup, anchoring, electrification and final adjustments. Customer to provide power to the main disconnect.'] : ['Ship only — installation by others.']),
  ];
  return out.join('\n');
}

function paintLine(s: Norm): string {
  const c = s.colors ?? {}; const custom = (v?: string) => v && !STD_COLORS.test(v);
  const col = custom(c.columns) ? `columns painted ${c.columns} (custom color)` : 'columns painted two-tone gray and Spark Orange';
  const run = custom(c.runways) ? `runways painted ${c.runways} (custom color)` : 'runways painted gray';
  return `${run[0].toUpperCase()}${run.slice(1)}, ${col} industrial coating`;
}
const ftIn = (ft: number) => { const f = Math.floor(ft + 1e-9); const i = Math.round((ft - f) * 12); return i === 12 ? `${f + 1}'` : i ? `${f}' ${i}"` : `${f}'`; };
const tons = (t: number) => (t === 0.5 ? '1/2' : t === 0.25 ? '1/4' : String(t));
