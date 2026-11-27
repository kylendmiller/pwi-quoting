// Bridge crane builder: freestanding (FSTR), on building runways, on new crane columns inside a
// building, or bridge only on an existing runway — top running or underhung. Calibrated on PWI's
// sold SMT quotes (rules/freestanding_rules.json) with AQT sizing charts for steel.
import CH from './rules/aqt_sizing_charts.json';
import PC from './rules/pwi_bridge_charts.json';
import { Kit, RULES as R, W_SHAPES, ixOf, pick, depthIn, STD_COLORS, check, keep, volt, ftIn, hgt, tons, calcBasis, type Catalog, type Assumption, type Factors } from './kit';
import type { QuoteLine } from './manual';
import type { Basis } from './lineDetail';

export type Support = 'freestanding' | 'building_runway' | 'crane_columns' | 'bridge_only';
export interface CraneSpec {
  series?: 'UL' | 'M' | 'GM' | 'HL';
  support?: Support;                        // default freestanding
  hanging?: 'top_running' | 'underhung';    // default top running
  systems?: number; runwayOalFt?: number; spanFt: number; capacityTons: number;
  overallHeightFt?: number;                 // "20' tall" = overall height (top of runway)
  hookHeightFt?: number;                    // only when they say "under hook"
  liftFt?: number; columnsPerSystem?: number; bridgesPerSystem?: number; hoistsPerBridge?: number;
  buildingBayFt?: number;                   // building column spacing (building_runway)
  runwayElectrification?: boolean;          // bridge_only: add runway conductor bar
  railFt?: number;                          // total ASCE rail feet when it isn't 2 × runway OAL (runway extensions / completion packages)
  runwayElectrificationFt?: number;         // total runway conductor-bar feet when it isn't the runway OAL
  bridgeDrive: 'manual' | 'motorized'; trolley?: 'manual' | 'motorized';
  voltage: string; control?: 'radio' | 'pendant';
  collisionAvoidance?: boolean; asceRail?: boolean; doubleGirder?: boolean; bracing?: boolean;
  foundation?: 'slab' | 'foundation';
  colors?: { columns?: string; runways?: string; bridge?: string };
  install: boolean; miles?: number; crewMen?: number; travelMode?: 'drive' | 'fly' | 'local';
  bracedToBuilding?: boolean; preUseInspection?: boolean;
  backupPendant?: boolean;                  // radio + backup pendant (forces festoon on the bridge)
  serviceClass?: 'C' | 'D';
  runwayCapacityTons?: number;             // runway / columns rated for more than one bridge (tandem): default = capacityTons
  columnStyle?: 'tube' | 'wide_flange' | 'built_up';   // force the column type (sold jobs often use tube / W on crane columns)
  bracketsByOthers?: boolean;               // building_runway: crane brackets / seats come with the building (PEMB) — PWI supplies beams only (sold 28772)                 // CMAA class; D (heavy service) = hoist one size up, derated (sold 29562, 28723)
}
export interface BuildResult { lines: QuoteLine[]; assumptions: Assumption[]; notes: string[]; wording: string; suggestedInstallHours: number; smtShopHours: number;
  outboundFreight: number; preUse: number; blockers: string[]; geometry: Record<string, number | string>; tons: number;
  job?: { workHrs: number; workTopFt: number; heaviestPickLb: number; generator?: boolean } }
export interface BuildOpts { skipTravel?: boolean; installDays?: number; trip?: import('./kit').TripOpts }   // trip: spec.trip (job-level travel facts)   // installDays: spec item crew days (buildFromSpec passes it; travel uses it)

type Norm = CraneSpec & { support: Support; hanging: 'top_running' | 'underhung'; series: 'UL' | 'M' | 'GM' | 'HL'; systems: number; runwayOalFt: number; trolley: 'manual' | 'motorized'; control: 'radio' | 'pendant'; voltage: '460V/3' | '230V/3' | '208V/3' };
const KEYS = ['backupPendant', 'series', 'support', 'hanging', 'systems', 'runwayOalFt', 'spanFt', 'capacityTons', 'overallHeightFt', 'hookHeightFt', 'liftFt', 'columnsPerSystem', 'bridgesPerSystem', 'hoistsPerBridge',
  'buildingBayFt', 'runwayElectrification', 'railFt', 'runwayElectrificationFt', 'bridgeDrive', 'trolley', 'voltage', 'control', 'collisionAvoidance', 'asceRail', 'doubleGirder', 'bracing', 'foundation', 'colors', 'install', 'miles',
  'crewMen', 'travelMode', 'bracedToBuilding', 'preUseInspection', 'serviceClass', 'bracketsByOthers', 'runwayCapacityTons', 'columnStyle'] as const;

export function normalize(x0: CraneSpec): Norm {
  const support: Support = x0.support ?? 'freestanding';
  if (!['freestanding', 'building_runway', 'crane_columns', 'bridge_only'].includes(support)) throw new Error(`Unknown support ${support}.`);
  if (x0.overallHeightFt == null && x0.hookHeightFt == null && support !== 'bridge_only') throw new Error('Crane needs overallHeightFt or hookHeightFt');
  // Limits are wide on purpose (Kyle 11/27: the app must take every job). Past the charts members are calculated and flagged for engineering.
  check('capacityTons', x0.capacityTons, 0.25, 60, true); check('spanFt', x0.spanFt, 5, 150, true);
  check('runwayCapacityTons', x0.runwayCapacityTons, 0.25, 120);
  check('runwayOalFt', x0.runwayOalFt, 8, 3000, support !== 'bridge_only');
  check('overallHeightFt', x0.overallHeightFt, 8, 80); check('hookHeightFt', x0.hookHeightFt, 6, 78); check('systems', x0.systems, 1, 60);
  check('bridgesPerSystem', x0.bridgesPerSystem, 1, 10); check('hoistsPerBridge', x0.hoistsPerBridge, 0, 4); check('columnsPerSystem', x0.columnsPerSystem, 4, 200);
  check('liftFt', x0.liftFt, 8, 150); check('railFt', x0.railFt, 0, 20000); check('runwayElectrificationFt', x0.runwayElectrificationFt, 0, 20000); check('crewMen', x0.crewMen, 2, 10); check('buildingBayFt', x0.buildingBayFt, 8, 80);
  if (x0.columnStyle != null && !['tube', 'wide_flange', 'built_up'].includes(x0.columnStyle)) throw new Error('columnStyle must be tube, wide_flange or built_up.');
  if (x0.install || x0.miles != null) check('miles', x0.miles, 0, 3500, true);
  const series = x0.series ?? (x0.bridgeDrive === 'motorized' ? (x0.capacityTons >= 3 ? 'GM' : 'M') : 'M');
  if (!['UL', 'M', 'GM', 'HL'].includes(series)) throw new Error(`Unknown series ${series}.`);
  if (!['manual', 'motorized'].includes(x0.bridgeDrive)) throw new Error('bridgeDrive must be manual or motorized.');
  if (x0.serviceClass != null && !['C', 'D'].includes(x0.serviceClass)) throw new Error('serviceClass must be C or D.');
  const x = keep<CraneSpec>(x0, KEYS);
  return { ...x, support, series, hanging: x.hanging ?? 'top_running', systems: Math.max(1, x.systems ?? 1), runwayOalFt: x.runwayOalFt ?? 0,
    trolley: x.trolley ?? x.bridgeDrive, control: x.control ?? (x.bridgeDrive === 'motorized' ? 'radio' : 'pendant'), voltage: volt(x.voltage) as Norm['voltage'] };
}

function chartPick(rows: any[], keyName: string, x: number, cap: number): string | null {
  const caps: number[] = CH.capacities; const c = caps.find(v => v >= cap - 1e-9);
  if (c == null) return null;
  const row = rows.find(r => r[keyName] >= x - 1e-9) ?? null;
  return row ? row.byCap[String(c)] ?? null : null;
}
/** PWI bridge girder chart (Sizing Wizard export): smallest charted capacity ≥ cap, first charted span ≥ span.
 *  Returns 'box' when the chart says BOX GIRDER at that span, null when off the chart. */
function pwiGirder(cap: number, span: number, double: boolean): string | null {
  const rows = (double ? PC.double : PC.motor) as [number, number, string][];
  const boxFrom = (double ? PC.doubleBoxFrom : PC.motorBoxFrom) as Record<string, number>;
  const caps = [...new Set(rows.map(r => r[0]))].sort((a, b) => a - b);
  const c = caps.find(v => v >= cap - 1e-9); if (c == null) return null;
  if (boxFrom[String(c)] != null && span >= boxFrom[String(c)] - 1e-9) return 'box';
  const r = rows.filter(r => r[0] === c).sort((a, b) => a[1] - b[1]).find(r => r[1] >= span - 1e-9);
  return r ? r[2] : null;
}
/** Which chart cell chartPick() read, for the editor's basis ("5 t column × overallHeightFt ≤ 20'"). */
function chartCell(rows: any[], keyName: string, x: number, cap: number, what = 'column'): string {
  const c = (CH.capacities as number[]).find(v => v >= cap - 1e-9); const row = rows.find(r => r[keyName] >= x - 1e-9);
  return row && c != null ? `${c} t ${what} × ${keyName.replace(/Ft$/, '')} ≤ ${row[keyName]}' (asked ${cap} t, ${+x.toFixed(1)}')` : 'off chart';
}
function pwiCell(cap: number, span: number, double: boolean): string {
  const rows = (double ? PC.double : PC.motor) as [number, number, string][];
  const c = [...new Set(rows.map(r => r[0]))].sort((a, b) => a - b).find(v => v >= cap - 1e-9);
  const r = rows.filter(r => r[0] === c).sort((a, b) => a[1] - b[1]).find(r => r[1] >= span - 1e-9);
  return r ? `${c} t × span ≤ ${r[1]}' (asked ${cap} t, ${span}')` : 'off chart';
}
const chartMax = (rows: any[]) => { const r = rows[rows.length - 1].byCap; const ks = Object.keys(r).map(Number).sort((a, b) => a - b); return r[String(ks[ks.length - 1])]; };

export function buildCrane(spec: CraneSpec, cat: Catalog, f: Factors = { production: 0.6, install: 1.02 }, bo: BuildOpts = {}): BuildResult {
  const s = normalize(spec), s0 = spec;
  const fam = s.support === 'freestanding' ? 'freestanding' : 'bridge';
  const K = new Kit(cat, fam, f), A = K.A;
  const cap = s.capacityTons, rcap = s.runwayCapacityTons ?? cap, n = s.systems, bridges = (s.bridgesPerSystem ?? 1) * n, hoists = bridges * (s.hoistsPerBridge ?? 1);
  const motor = s.bridgeDrive === 'motorized', under = s.hanging === 'underhung';
  const hasRunway = s.support !== 'bridge_only', hasCols = s.support === 'freestanding' || s.support === 'crane_columns';
  const oal = s.runwayOalFt;
  const rail = !under && (s.support === 'bridge_only' ? !!s.asceRail : s.asceRail ?? (motor && cap >= 5));
  if (s0.asceRail == null && !under && hasRunway) A.push({ field: 'asceRail', value: rail, why: rail ? 'Motorized ≥5 t gets 30# ASCE rail (all sold 5–10 t jobs)' : 'Under 5 t: bridge runs on the beam flange', alt: !rail });
  if (s.support === 'bridge_only') A.push({ field: 'support', value: 'bridge_only', why: `Bridge only on the customer's existing runway${oal ? ` (${oal}' long)` : ''} — runway capacity and condition by others`, alt: 'building_runway', altLabel: 'Add new runway beams on the building columns' });

  // ---------- geometry ----------
  const maxBay = s.support === 'building_runway' ? (s.buildingBayFt ?? 25) : pick(R.bays.maxBayFtByCap as [number, number][], rcap);
  const bays = s.columnsPerSystem ? Math.max(1, s.columnsPerSystem / 2 - 1) : Math.max(1, Math.ceil(oal / maxBay));
  const colsPer = hasCols ? (s.columnsPerSystem ?? 2 * (bays + 1)) : 0, cols = colsPer * n, bayFt = oal ? oal / bays : 0;
  const supports = 2 * (bays + 1) * n;            // runway support points (columns or building brackets)
  if (hasCols && !s.columnsPerSystem) A.push({ field: 'columnsPerSystem', value: colsPer, why: `Bays ≤ ${maxBay}' for ${cap} t → ${bays} bays of ${bayFt.toFixed(1)}'`, alt: colsPer + 2, altLabel: `${colsPer + 2} columns (shorter bays, lighter runway)` });
  if (s.support === 'building_runway') A.push({ field: 'buildingBayFt', value: bayFt.toFixed(1), why: `Runway beams supported at the building columns every ≈${bayFt.toFixed(1)}' (${supports} ${under ? 'hanger' : 'bracket'} locations) — confirm building columns can take the crane loads`, alt: 20 });
  const perPiece = bayFt * 2 <= R.bays.combineBaysUpToFt ? 2 : 1;
  const piecesPerLine = hasRunway ? Math.ceil(bays / perPiece) : 0, pieceFt = hasRunway ? Math.ceil(bayFt * perPiece + 0.5) : 0;
  const doubleGirder = s.doubleGirder ?? cap >= 15;
  if (s0.doubleGirder == null && s.series === 'GM') A.push({ field: 'doubleGirder', value: doubleGirder, why: doubleGirder ? '≥15 t → double girder' : 'Single girder is the sold default up to 10 t (29354, 29331); double only for headroom/specials (29523)', alt: !doubleGirder, altLabel: doubleGirder ? 'Single girder' : 'Double girder (+45 shop h/bridge)' });

  const basis: 'overall' | 'hook' = s.overallHeightFt != null ? 'overall' : 'hook';
  const headroom = pick(R.height.headroomFtByCap as [number, number][], cap);
  const hRaw = s.overallHeightFt ?? s.hookHeightFt ?? 16;
  const overall = basis === 'overall' ? hRaw : hRaw + headroom;
  const hook = basis === 'hook' ? hRaw : hRaw - headroom;
  if (s.overallHeightFt != null || s.hookHeightFt != null) A.push({ field: 'heightBasis', value: basis, why: basis === 'overall' ? `"${hRaw}' tall" read as OVERALL height (top of runway) → hook ≈ ${hook.toFixed(1)}' (${headroom}' hoist/bridge headroom)` : `Hook height ${hRaw}' → top of runway ≈ ${overall.toFixed(1)}'`,
    alt: basis === 'overall' ? 'hook' : 'overall', altLabel: basis === 'overall' ? `${hRaw}' is hook height (system ${(hRaw + headroom).toFixed(1)}' tall)` : `${hRaw}' is overall height` });

  let column = hasCols ? chartPick(CH.column_by_overall_height, 'overallHeightFt', overall, rcap) : null;
  let runway = hasRunway ? chartPick(CH.runway_by_bay, 'bayFt', bayFt, rcap) : null;
  // past the AQT runway chart: calculated (same method as girders past the chart: L/600 + 24 ksi, lightest W ≤ 36", else a plate box), flagged for engineering
  let runBoxPlf = 0, runUnity: ReturnType<typeof sizeGirder>['check'] | undefined, runBoxDepth = 0;
  if (hasRunway && !runway) {
    const perLine = rcap;                                             // one bridge (or the tandem rating) in a bay
    const bridgeDeadLb = 100 * s.spanFt + 1500 + (cap >= 10 ? 60 * s.spanFt : 0);   // girder + end trucks, rough: only the runway past the chart uses it
    const g = sizeGirder(cat, bayFt, perLine, true, bridgeDeadLb);
    runUnity = g.check; runBoxDepth = g.depthIn;
    if (g.shape) runway = g.shape; else runBoxPlf = g.boxPlf;
    K.notes.push(`Runway calculated past the AQT chart (${bayFt.toFixed(1)}' bays, ${perLine} t): ${runway ?? `plate box ${runBoxDepth}" × ${runBoxPlf} plf`} — engineering to confirm.`);
  }
  let girder: string | null = null, girderSrc = 'AQT chart';
  if (s.series !== 'UL' && s.series !== 'HL') {
    const p = pwiGirder(cap, s.spanFt, doubleGirder);
    if (p && p !== 'box' && cat.shape(p)) { girder = p; girderSrc = 'PWI bridge chart'; }
    else if (p !== 'box') girder = chartPick(CH.girder_by_span, 'spanFt', s.spanFt, cap);
    if (girder) A.push({ field: 'girder', value: girder, why: `${cap} t × ${s.spanFt}' span${doubleGirder ? ' (double girder, each)' : ''} → ${girder} from the ${girderSrc}${girderSrc === 'AQT chart' ? ' (not on the PWI bridge chart)' : ' — CONFIRMED PWI CHART'}` });
  }
  let boxPlf = 0, boxDepth = 0, girderUnity: ReturnType<typeof sizeGirder>['check'] | undefined;
  if (girder === null && s.series !== 'UL' && s.series !== 'HL') {
    const g = sizeGirder(cat, s.spanFt, cap, doubleGirder);
    girderUnity = g.check; boxDepth = g.depthIn;
    if (g.shape) { girder = g.shape; A.push({ field: 'girder', value: girder, why: `${s.spanFt}' span at ${cap} t is past the PWI bridge chart — sized at L/${R.boxGirder.deflLimit} (rated load + hoist + self weight) as the lightest W ≤ ${R.boxGirder.maxWDepthIn}" deep; engineering to confirm` }); }
    else { boxPlf = g.boxPlf; A.push({ field: 'girder', value: `box ${boxPlf} plf`, why: `No W shape ≤ ${R.boxGirder.maxWDepthIn}" deep meets L/${R.boxGirder.deflLimit} at ${s.spanFt}' / ${cap} t → plate box girder ${g.depthIn}" deep, ${boxPlf} plf (Ireq ≈ ${Math.round(g.Ireq)} in⁴); engineering to confirm` }); }
  }
  const builtUpAuto = hasCols && (s.support === 'crane_columns' ? rcap >= 5 || !column : rcap >= R.columnType.builtUpFromCap || !column || overall > R.columnType.maxChartHeightFt + 2);
  if (hasCols && s.columnStyle && s.columnStyle !== 'built_up' && !column) {
    // asked for tube / W but past the column chart: largest chart size of that type, flagged
    const want = s.columnStyle === 'tube' ? /^(ST|RT|HSS)/ : /^W/;
    const all = (CH.column_by_overall_height as any[]).flatMap(r => Object.values(r.byCap) as string[]).filter(x => x && want.test(x) && cat.shape(x));
    column = all.sort((a, b) => (Number(/x (\d+(?:\.\d+)?)\s*$/.exec(b)?.[1] ?? 0) - Number(/x (\d+(?:\.\d+)?)\s*$/.exec(a)?.[1] ?? 0)))[0] ?? null;
    if (column) K.notes.push(`${s.columnStyle === 'tube' ? 'Tube' : 'W'} columns asked for past the AQT column chart — priced as ${column}; engineering to size.`);
  }
  const builtUp = hasCols && (s.columnStyle ? s.columnStyle === 'built_up' || !column : builtUpAuto);
  const SC = (R.columnType as any).builtUpShortColumn;
  const colLen0 = Math.ceil((overall - (runway ? depthIn(runway) / 12 : 1.5) - (rail ? R.height.railHeightFt : 0) - R.height.topPlateFt) / R.height.roundColumnToFt) * R.height.roundColumnToFt;
  const builtUpPlf = s.support === 'crane_columns' ? pick([[5, 40], [10, 48], [20, 90], [999, 162]] as [number, number][], rcap)
    : SC && colLen0 <= SC.maxColumnFt && cap <= 10 ? pick(SC.plfByCap as [number, number][], cap) : pick(R.columnType.builtUpPlfByCap as [number, number][], rcap);   // crane columns: tapered 3-plate (sold 28192 48 plf @10 t, 28970 162 plf @25 t)
  A.push({ field: 'steelSource', value: 'chart', why: 'Steel from the AQT sizing chart (height × capacity, bay × capacity, span × capacity) — engineering to confirm' });
  const runDepthFt = runway ? depthIn(runway) / 12 : runBoxPlf ? runBoxDepth / 12 : 1.5;
  const colLen = hasCols ? Math.ceil((overall - runDepthFt - (rail ? R.height.railHeightFt : 0) - R.height.topPlateFt) / R.height.roundColumnToFt) * R.height.roundColumnToFt : 0;
  const columnType = !hasCols ? 'none' : builtUp ? 'built_up' : /^W/.test(column!) ? 'wide_flange' : 'tube';
  const foundation = s.foundation ?? (builtUp || s.support === 'crane_columns' ? 'foundation' : 'slab');
  if (hasCols && !s.foundation) A.push({ field: 'foundation', value: foundation, why: foundation === 'foundation' ? 'Columns set on concrete foundations by others, epoxy anchors and grouted base plates' : 'Gusseted base plates on a 6" slab', alt: foundation === 'slab' ? 'foundation' : 'slab' });

  // ---------- editor basis (why each member) — read-only, no effect on picks ----------
  const colBasis: Basis = builtUp
    ? { source: 'rule', text: s.support === 'crane_columns' ? `Tapered 3-plate crane column, ${builtUpPlf} plf for ${cap} t (sold 28192 / 28970)` : `Built-up plate column ${builtUpPlf} plf for ${cap} t (${!column ? 'past the AQT column chart' : overall > R.columnType.maxChartHeightFt + 2 ? `taller than the ${R.columnType.maxChartHeightFt}' chart` : `≥ ${R.columnType.builtUpFromCap} t`})`, chart: 'freestanding_rules columnType.builtUpPlfByCap', assumption: 'steelSource', flag: 'Engineering to confirm' }
    : { source: 'chart', chart: 'AQT column_by_overall_height', row: chartCell(CH.column_by_overall_height, 'overallHeightFt', overall, cap), text: `${column} from the AQT column chart at ${overall.toFixed(1)}' overall, ${cap} t; ${colLen}' long (overall − runway depth${rail ? ' − rail' : ''} − top plate, rounded up to ${R.height.roundColumnToFt}')`, assumption: 'steelSource' };
  const runBasis: Basis = { source: 'chart', chart: 'AQT runway_by_bay', row: chartCell(CH.runway_by_bay, 'bayFt', bayFt, cap, 'runway'), text: `${runway} from the AQT runway chart for ${bayFt.toFixed(1)}' bays at ${cap} t; ${piecesPerLine} piece${piecesPerLine > 1 ? 's' : ''}/line × ${pieceFt}' (${perPiece} bay${perPiece > 1 ? 's' : ''} per piece)`, assumption: s.support === 'building_runway' ? 'buildingBayFt' : 'columnsPerSystem',
    ...(K.blockers.some(b => /past the AQT runway chart/.test(b)) ? { flag: 'Past the runway chart — placeholder until engineering sizes it' } : {}) };
  let girdBasis: Basis | undefined;
  if (girder && girderSrc === 'PWI bridge chart') girdBasis = { source: 'chart', chart: `PWI bridge chart (${doubleGirder ? 'double' : 'motor'})`, row: pwiCell(cap, s.spanFt, doubleGirder), text: `${girder} from the PWI Sizing Wizard bridge chart, ${cap} t × ${s.spanFt}' span${doubleGirder ? ', each of 2 girders' : ''}; cut ${Math.ceil(s.spanFt + 2)}' (span + 2')`, assumption: 'girder' };
  else if (girder && girderUnity == null) girdBasis = { source: 'chart', chart: 'AQT girder_by_span', row: chartCell(CH.girder_by_span, 'spanFt', s.spanFt, cap, 'girder'), text: `${girder} from the AQT girder chart (not on the PWI bridge chart), ${cap} t × ${s.spanFt}' span`, assumption: 'girder', flag: 'AQT chart fallback — not a confirmed PWI chart size' };
  else if (girder) girdBasis = calcBasis(`${girder} sized at L/${R.boxGirder.deflLimit} (rated load + hoist + self weight) and 24 ksi bending, past the PWI bridge chart`, girderUnity, 'girder');
  else if (boxPlf) { const cb = calcBasis(`Plate box girder ${boxDepth}" deep, ${boxPlf} plf, sized to L/${R.boxGirder.deflLimit} and 24 ksi (webs ignored — conservative)`, girderUnity, 'girder');
    girdBasis = { ...cb, flag: `Plate box girder — engineering to confirm${cb.flag ? `; ${cb.flag}` : ''}` }; }

  // ---------- structural + plate ----------
  if (hasCols) { if (builtUp) K.box('Built-up plate columns', cols, builtUpPlf, colLen, { role: 'column', basis: colBasis }); else K.steel('Columns', column!, cols, colLen, { role: 'column', basis: colBasis }); }
  if (hasRunway && runBoxPlf) K.box('Plate box runways', 2 * piecesPerLine * n, runBoxPlf, pieceFt, { role: 'runway', basis: { ...calcBasis(`Plate box runway ${runBoxDepth}" deep, ${runBoxPlf} plf for ${bayFt.toFixed(1)}' bays at ${rcap} t (L/${R.boxGirder.deflLimit}, 24 ksi)`, runUnity, 'runway'), flag: 'Past the runway chart — calculated, engineering to confirm' } });
  else if (hasRunway) K.steel('Runways', runway!, 2 * piecesPerLine * n, pieceFt, { role: 'runway', basis: runUnity ? { ...calcBasis(`${runway} calculated for ${bayFt.toFixed(1)}' bays at ${rcap} t (L/${R.boxGirder.deflLimit}, 24 ksi), past the AQT runway chart`, runUnity, 'runway'), flag: 'Past the runway chart — calculated, engineering to confirm' } : runBasis });
  const girderLb = girder ? K.steel(doubleGirder ? 'Bridge girders (double)' : 'Bridge girder', girder, bridges * (doubleGirder ? 2 : 1), Math.ceil(s.spanFt + 2), { role: 'girder', basis: girdBasis }) * (doubleGirder ? 2 : 1)
    : boxPlf ? K.box(doubleGirder ? 'Plate box girders (double)' : 'Plate box girder', bridges * (doubleGirder ? 2 : 1), boxPlf, Math.ceil(s.spanFt + 2), { role: 'girder', basis: girdBasis }) * (doubleGirder ? 2 : 1) : 0;
  const BR = (R as any).bracing ?? { tubeFromColumns: 6, tubeFromCap: 3 };
  const bracing = s.support === 'freestanding' && (s.bracing ?? (columnType === 'tube' && (colsPer >= BR.tubeFromColumns || cap >= BR.tubeFromCap)));
  if (bracing) K.steel('Bracing', 'ST 3 x 3 x 1/4', 6 * n, 20, { role: 'brace', basis: { source: 'rule', text: s.bracing != null ? 'Bracing requested on the spec' : `Tube columns with ${colsPer} columns / ${cap} t → 6 ST 3×3×1/4 × 20' braces per system (≥ ${BR.tubeFromColumns} columns or ≥ ${BR.tubeFromCap} t)` } });
  if (hasCols) {
    const bp = (R.basePlate as [number, number, number][]).find(([m]) => rcap <= m) ?? [0, 1, 24];
    K.plate('Column base plates', cols, bp[1], bp[2], bp[2], { basis: { source: 'rule', text: `Base plate ${bp[1]}" × ${bp[2]}" × ${bp[2]}" for ≤ ${bp[0]} t (freestanding_rules basePlate)`, assumption: 'foundation' } });
    K.plate('Column top plates', cols, cap <= 1 ? 0.375 : 0.5, cap <= 3 ? 10 : 18, cap <= 3 ? 14 : 12);
    if (columnType === 'tube') K.plate('Column gussets', cols * 4, cap <= 1 ? 0.25 : 0.3125, 5, 12);
  }
  if (s.support === 'building_runway') {
    if (under) { /* hung from building steel with drop rods — std parts below */ }
    else if (s.bracketsByOthers) A.push({ field: 'bracketsByOthers', value: true, why: 'Runway beams set on crane brackets supplied with the building — PWI supplies beams, rail and hardware only', alt: false });
    else { K.plate('Runway seat brackets', supports, 0.75, 12, 18); K.plate('Runway bracket stiffeners', supports * 2, 0.5, 6, 12); K.plate('Runway tie-back clips', supports, 0.5, 8, 12); }
  }
  if (hasRunway && cap >= 5) K.plate('Runway web stiffeners', 2 * piecesPerLine * n * 2, 0.3125, 6, 16);
  if (hasRunway) K.plate('Runway splice / end plates', 2 * (piecesPerLine + 1) * n, 0.375, 8, 14);
  if (girder || boxPlf) K.plate('Bridge end plates', bridges * 2, 0.375, 15, 21);

  // ---------- standard parts ----------
  if (hasCols) {
    const anc = (R.anchors as any[]).find(a => cap <= a.maxCap && (a.wording !== 'foundation' || foundation === 'foundation')) ?? R.anchors[1];
    const anchorRule = foundation === 'foundation' ? R.anchors[2] : anc.wording === 'foundation' ? R.anchors[1] : anc;
    const ab: Basis = { source: 'rule', text: `${anchorRule.perColumn} per column × ${cols} columns (${foundation === 'foundation' ? 'on foundations' : `slab, ≤ ${anc.maxCap} t`})`, assumption: 'foundation' };
    K.std(anchorRule.part, cols * anchorRule.perColumn, 'stdParts', { role: 'anchor', basis: ab }); for (const p of anchorRule.plus ?? []) K.std(p.part, cols * p.perColumn, 'stdParts', { basis: ab });
  }
  const boltCount = 8 * cols + 16 * bridges + (s.support === 'building_runway' ? 8 * supports : 0);
  K.std(cap >= 2 ? '3/4" Structural Bolt and Nut' : '5/8" Structural Bolt and Nut', boltCount);
  if (s.support === 'building_runway' && under) K.std('Drop Rod Connection', supports);
  const amps = cap >= 5 || bridges > 1 ? '120' : '65';
  const elecFt = s.runwayElectrificationFt ?? oal * n;
  const runwayElec = hasRunway ? true : (!!s.runwayElectrification || s.runwayElectrificationFt != null) && elecFt > 0;
  if (runwayElec) K.std(`Runway Electrification Package (4-Conductor x ${amps} amp max)`, Math.ceil(elecFt));
  K.std(motor ? 'Motorized Bridge Crane Electrification Package (per foot)' : 'Manual Bridge Crane Electrification Package (per foot)', Math.ceil(s.spanFt) * bridges);
  K.std(motor && amps === '120' ? '120 Amp Tandem Collector Set (for VFD)' : '65 Amp Single Collector Set  (Non-VFD)', bridges * (motor && amps === '120' ? 2 : 1));
  if (hasRunway) K.std('Beam End Stop Kit for Runway System (4 total per kit)', n);
  K.std('PWI HD Adjustable End Stop Kit (slides on Flange)', 2 * bridges);
  if (motor && s.spanFt >= 10) K.std(cap <= 2 ? 'End Truck Plug & Play Upcharge (2 ton or smaller)' : 'End Truck Plug & Play Upcharge (3 ton or larger)', bridges);
  const railFt = s.railFt ?? (rail ? 2 * Math.ceil(oal) * n : 0);
  if (railFt > 0) K.std(cap <= 10 ? '30# ASCE Crane Rail (per linear foot including clips and splicers)' : '40# ASCE Crane Rail (per linear foot including clips and splicers)', Math.ceil(railFt));
  if (s.series === 'UL') K.std(cap <= 0.5 ? '1/2 Ton Manual Ultra-Lite End Truck Kit  39.5"' : cap <= 1 ? '1 Ton Manual Ultra-Lite End Truck Kit 39.5"' : cap <= 2 ? '2 Ton Manual Ultra-Lite End Truck Kit 39.5"' : '3 Ton Manual Ultra-Lite End Truck Kit', bridges);
  else if (!motor) {
    const len = s.spanFt <= 20 ? '32.5"' : s.spanFt <= 30 ? '38.25"' : '50.25"';
    K.std(under ? `PWI Manual Underhung End Truck Kit ${len}` : `PWI Manual Top Runner End Truck Kit ${len}`, bridges);
  }

  // ---------- vendor ----------
  const v = s.voltage.startsWith('460') ? '460V' : '230V';
  const lift = s.liftFt ?? Math.max(10, Math.ceil((hook + 2) / 5) * 5);
  if (s0.liftFt == null) A.push({ field: 'liftFt', value: lift, why: `Hook ${hook.toFixed(1)}' + 2' → next stocked lift`, alt: lift + 10 });
  const classD = s.serviceClass === 'D', CD = (R as any).classD;
  const hoistPart = pickHoist(cat, classD ? cap * CD.hoistCapFactor : cap, lift, v, s.trolley, doubleGirder);
  if (classD) A.push({ field: 'serviceClass', value: 'D', why: `Class D (heavy service): hoist sized at ${CD.hoistCapFactor}× rated capacity and derated to ${cap} t (sold 29562, 28723)`, alt: 'C' });
  if (cap > 3) A.push({ field: 'hoistFamily', value: `Starke ${doubleGirder ? 'STW' : 'SMW'} wire rope`, why: '≥5 t sold jobs used wire rope (SMW single girder 29331/28192; STW double girder 29523)' });
  if (hoists === 0) K.notes.push('No hoist on this quote (hoist by others or existing) — 0 hoists per bridge.');
  else if (hoistPart) K.vend(hoistPart, hoists, { role: 'hoist', basis: { source: 'catalog', text: `Smallest stocked ${cap <= 3 && /^STK/.test(hoistPart) ? 'STK chain' : 'wire rope'} hoist ≥ ${classD ? `${cap * CD.hoistCapFactor} t (class D ${CD.hoistCapFactor}×)` : `${cap} t`}, lift ≥ ${lift}', ${v}, ${s.trolley} trolley; ${hoists} = ${bridges} bridge${bridges > 1 ? 's' : ''} × ${s.hoistsPerBridge ?? 1}`, assumption: 'liftFt' } }); else K.notes.push(`No hoist found for ${cap} t / ${lift}' / ${v} — pick in editor.`);
  if (motor) {
    const W = R.endTruckWheelbase; const wb = Math.max(W.minIn, Math.ceil(s.spanFt * 12 / W.spanInPerWbIn / W.stepIn) * W.stepIn);
    const pre = under ? pick([[2, 'SCU-110-100'], [5, 'SCU-130-100'], [999, 'SCU-170-100']] as [number, string][], cap) : pick([...(R.endTruck as [number, string][]).filter(([c]) => c <= 10), [15, 'STT-250-150'], [999, 'STT-500-100']] as [number, string][], cap);
    const etAll = cat.vendorParts(pre).map(p => ({ ...p, wb: Number(p.part.split('-').pop()) })).sort((a, b) => a.wb - b.wb);
    let et = etAll.find(p => p.wb >= wb);
    if (!et && etAll.length) { et = etAll[etAll.length - 1]; K.notes.push(`No ${pre} end truck with a ${wb}" wheelbase on the price list — priced as ${et.part} (longest listed); confirm with Starke.`); }
    if (et) K.vend(et.part, bridges, { role: 'end_truck', basis: { source: 'catalog', text: `${pre} series for ${cap} t ${under ? 'underhung' : 'top running'}; wheelbase ≥ ${wb}" (span ${s.spanFt}' × 12 ÷ ${W.spanInPerWbIn}, step ${W.stepIn}", min ${W.minIn}") → ${et.wb}"` } }); else K.notes.push(`End truck ${pre}-${wb} not found.`);
    K.vend(pick((v === '460V' ? [[3, 'SCP-0246'], [5, 'SCP-0346'], [10, 'SCP-0446'], [15, 'SCP-0746'], [999, 'SCP-1046']] : R.panel230) as [number, string][], cap), bridges);
  }
  if (s.control === 'radio') { K.vend(`S802-2R-${(motor ? 1 : 0) + (s.trolley === 'motorized' ? 1 : 0) + 1}M-SD`, bridges); K.std('Radio Receiving Units Pairing Charge', bridges * 2); }
  if (s.collisionAvoidance) K.vend('SCA-LZ-200T', bridges);

  // ---------- paint ----------
  const custom = Object.entries(s.colors ?? {}).filter(([, c]) => c && !STD_COLORS.test(c));
  const customUnits = custom.reduce((a, [part]) => a + (part === 'columns' ? K.unitsFor(cols, colLen) : part === 'runways' ? K.unitsFor(2 * piecesPerLine * n, pieceFt) : bridges * 2), 0);
  K.paint(customUnits, custom.length ? custom.map(([p, c]) => `${p}: ${c}`).join(', ') : null);
  K.decal(motor ? '(13" x 36") Motorized Crane Die Cut Set' : s.series === 'UL' ? '(6"-10" tall decals) Ultra-Lite Crane Set' : '(11" - 13" tall decals) Manual Crane Decal Set', bridges);

  // ---------- shop hours (SMT labor ops) ----------
  const O = R.shopOps;
  const runBeams = 2 * piecesPerLine * n;
  const bType = s.series === 'UL' ? 'ultralite' : !motor ? 'manual' : doubleGirder ? 'double' : 'single';
  K.shop([
    ['Cut list', O.cutList * n],
    ...(hasCols ? [[`Column fab (${columnType})`, columnType === 'built_up' ? O.colBuiltUpPerFt * colLen * cols : columnType === 'wide_flange' ? O.colWideFlangeMoment * cols : O.colTubeGusset * cols] as [string, number]] : []),
    ...(hasRunway ? [[`PCR runways (${runBeams})`, (pieceFt > 20 ? O.pcrRunwayGT20 : O.pcrRunwayLE20) * runBeams] as [string, number]] : []),
    ...(s.support === 'building_runway' && !under && !s.bracketsByOthers ? [[`Runway bracket fab (${supports})`, 1.5 * supports] as [string, number]] : []),
    ...(hasRunway && cap >= O.webStiffenersPerBeamFromCap[0] ? [['Runway web stiffeners', O.webStiffenersPerBeamFromCap[1] * runBeams] as [string, number]] : []),
    [`Bridge fab + after-paint (${bType})`, ((O.bridge as any)[bType] + (s.spanFt > 70 ? O.bridge.over70ftAdd : 0)) * bridges],
    ...(boxPlf ? [[`Box girder fab (${bridges * (doubleGirder ? 2 : 1)} × ${Math.ceil(s.spanFt + 2)}')`, R.boxGirder.fabHrsPerFt * Math.ceil(s.spanFt + 2) * bridges * (doubleGirder ? 2 : 1)] as [string, number]] : []),
    ...(s.collisionAvoidance ? [['Collision avoidance', O.collisionAvoidPerBridge * bridges] as [string, number]] : []),
    ...(classD ? [['Hoist derating setup', CD.deratingHrsPerBridge * bridges] as [string, number]] : []),
  ]);

  // ---------- install ----------
  const S2 = R.siteOps;
  const bridgeLb = girderLb + 1200 + (cap >= 5 ? 1500 : 300);
  const job = { workTopFt: hasCols ? colLen + runDepthFt : overall, heaviestPickLb: Math.max(K.heaviestLb, bridgeLb), generator: rail || (s.support !== 'freestanding' && cap >= 10) };
  K.finish({
    install: s.install, miles: s.miles ?? 0, crewMen: s.crewMen, travelMode: s.travelMode, skipTravel: bo.skipTravel, installDays: bo.installDays, trip: bo.trip, ...job,
    site: [
      { desc: 'Unload, set up, layout', hours: S2.setup },
      { desc: `Install columns (${cols})`, hours: S2.column * cols },
      { desc: `Install runway ${under ? 'hangers' : 'brackets'} (${s.support === 'building_runway' && !s.bracketsByOthers ? supports : 0})`, hours: s.support === 'building_runway' && !s.bracketsByOthers ? 2 * supports : 0 },
      { desc: `Install runway beams (${runBeams})`, hours: (pieceFt > 40 ? S2.runwayPieceOver40 : S2.runwayPiece) * runBeams },
      { desc: 'Install runway end stops', hours: hasRunway ? S2.endStops * n : 0 },
      { desc: 'Install electrification', hours: runwayElec ? S2.electrificationPer100ftOal * elecFt / 100 : 2 * bridges },
      { desc: `Install bridge (${bridges})`, hours: (!motor ? S2.manualBridge : bridgeLb >= 8000 ? S2.bridgeOver8k : S2.bridgeUnder8k) * bridges },
      { desc: 'Install ASCE rail', hours: railFt > 0 ? S2.railPer100ftOal * railFt / 2 / 100 : 0 },
      { desc: 'Collision avoidance', hours: s.collisionAvoidance ? S2.collisionAvoidPerBridge * bridges : 0 },
      { desc: 'Install bracing', hours: bracing ? S2.bracingPerLocation * 6 * n : 0 },
    ],
  });
  K.pmCad(1);   // bridge was 1.1; the PM/CAD power law is fitted on FSTR and bridge jobs together (tuned 11/20)
  K.done();

  const wireRope = !!hoistPart && /^S[MT]W/.test(hoistPart);
  const festoon = !!s.backupPendant || (!motor && s.spanFt < 30 && cap <= 3);
  if (s.backupPendant) K.notes.push('Backup pendant requested — add the pendant price (bridge set to festoon).');
  const geo = { wireRope, festoon, overall, hook, colLen, colsPer, bayFt, rail, motor, doubleGirder, lift, bridges, builtUp, foundation, supports, runwayElec, cols, railFt, elecFt };
  return { lines: K.lines, assumptions: A, notes: K.notes, blockers: K.blockers, wording: wording(s, geo), preUse: s.preUseInspection ? 1500 * n : 0, suggestedInstallHours: Math.round(K.site * 10) / 10,
    smtShopHours: K.smtShopHours, outboundFreight: K.freight, tons: K.lbs / 2000, job: { ...job, workHrs: K.workHrs },
    geometry: { overall: +overall.toFixed(2), hook: +hook.toFixed(2), colLen, column: !hasCols ? '' : builtUp ? `built-up ${builtUpPlf} plf` : column!, runway: runway ?? (runBoxPlf ? `box ${runBoxPlf} plf` : ''), girder: girder ?? (boxPlf ? `box ${boxPlf} plf` : ''), bays, bayFt: +bayFt.toFixed(1), pieceFt, piecesPerLine, units: K.units } };
}

/** Girder past the AQT chart: lightest W (≤ maxWDepthIn) meeting L/600 under rated load + hoist + self weight and
 *  24 ksi bending, else a plate box girder sized for the same I (and 24 ksi bending). W-shape Ix from ixOf() (conservative). */
export function sizeGirder(cat: Catalog, spanFt: number, cap: number, double: boolean, extraLb = 0): { shape: string | null; boxPlf: number; depthIn: number; Ireq: number; check: { unity: number; checks: { name: string; unity: number }[] } } {
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  const chk = (defl: number, bend: number) => ({ unity: r3(Math.max(defl, bend)), checks: [{ name: `deflection L/${R.boxGirder.deflLimit}`, unity: r3(defl) }, { name: 'bending 24 ksi (15% impact)', unity: r3(bend) }] });
  const B = R.boxGirder, L = spanFt * 12, E = 29e6, lim = L / B.deflLimit;
  const P = (cap * 2000 + cap * B.hoistLbPerTon + 300 + extraLb) / (double ? 2 : 1);
  const Ireq = (w: number) => P * L ** 3 / (48 * E * lim) + 5 * (w / 12) * L ** 4 / (384 * E * lim);
  // lightest W meeting deflection with its own weight and bending (24 ksi on Sx ≈ 2·Ix/d, 15% impact)
  const cands = W_SHAPES.map(n => ({ n, d: depthIn(n), wt: Number(/x (\d+(?:\.\d+)?)/.exec(n)?.[1] ?? 0) })).filter(x => x.d <= B.maxWDepthIn && cat.shape(x.n)).sort((a, b) => a.wt - b.wt);
  for (const c of cands) {
    const I = ixOf(c.n), M = P * 1.15 * L / 4 + (c.wt / 12) * L * L / 8;
    if (Ireq(c.wt) / I <= 0.98 && M / (2 * I / c.d) <= 24000 * 0.98) return { shape: c.n, boxPlf: 0, depthIn: c.d, Ireq: Ireq(c.wt), check: chk(Ireq(c.wt) / I, M / (2 * I / c.d) / 24000) };
  }
  const d = Math.min(B.maxDepthIn, Math.max(B.minDepthIn, Math.round(L * B.depthInPerSpanIn)));
  let plf = 150, I = 0;
  for (let i = 0; i < 6; i++) {
    const M = P * 1.15 * L / 4 + (plf / 12) * L * L / 8;
    I = Math.max(Ireq(plf), M * (d / 2) / 24000) / 0.98;   // deflection or bending, whichever needs more, at PWI's 0.98 max unity (webs ignored: conservative)
    const Af = 2 * I / (d * d); plf = Math.round(B.lbPerIn2Ft * (2 * Af + 2 * d * B.webIn) * B.fabFactor);
  }
  // the box is sized so its I equals the governing need (deflection or bending) at the last iteration's plf
  const Mf = P * 1.15 * L / 4 + (plf / 12) * L * L / 8;
  return { shape: null, boxPlf: plf, depthIn: d, Ireq: I, check: chk(Ireq(plf) / I, Mf * (d / 2) / I / 24000) };
}

export function pickHoist(cat: Catalog, cap: number, lift: number, v: string, trolley: string, doubleGirder: boolean): string | undefined {
  const liftOf = (p: string) => Number(/-(\d+)-/.exec(p)?.[1] ?? 0);
  // smallest stocked capacity code ≥ the rated capacity (STK codes are tenths of a ton, SMW/STW whole tons)
  const pickCode = (prefix: string, need: number, div: number) => {
    const codes = [...new Set(cat.vendorParts(prefix).map(p => p.part.slice(prefix.length, prefix.length + 2)).filter(c => /^\d\d$/.test(c)))].map(c => ({ c, t: Number(c) / div })).sort((a, b) => a.t - b.t);
    return codes.find(x => x.t >= need - 1e-9)?.c;
  };
  if (cap <= 3) {
    const code = pickCode('STK', cap, 10);
    const stk = code ? cat.vendorParts(`STK${code}`).filter(p => p.part.includes(`-${v}-3PH-${trolley === 'motorized' ? 'C' : 'B'}`) && liftOf(p.part) >= lift).sort((a, b) => liftOf(a.part) - liftOf(b.part))[0]?.part : undefined;
    if (stk) return stk;
    // no STK chain hoist at this lift → SMW wire rope (sold 28772: 2 t bridge with 30' lift on an SMW0322-30)
  }
  const fam2 = doubleGirder ? 'STW' : 'SMW'; const code = pickCode(fam2, cap, 1); if (!code) return undefined;
  return cat.vendorParts(`${fam2}${code}`).filter(p => p.part.includes(`-${v}`) && liftOf(p.part) >= lift && !/V$/.test(p.part)).sort((a, b) => liftOf(a.part) - liftOf(b.part))[0]?.part;
}

// ---------------------------------------------------------------- customer wording
function wording(s: Norm, x: any): string {
  const T = tons(s.capacityTons), n = s.hoistsPerBridge ?? 1;
  const kind = s.series === 'UL' ? 'ULTRALITE MANUAL' : x.motor ? 'MOTORIZED' : 'MANUAL';
  const run = s.hanging === 'underhung' ? 'UNDERHUNG' : 'TOP RUNNING';
  const brand = s.series === 'UL' ? 'PWI' : 'INCOMMAND';
  const title = s.support === 'freestanding' ? `${brand} TOP RUNNER ${kind} BRIDGE CRANE SYSTEM` : s.support === 'bridge_only' ? `${brand} ${run} ${kind} BRIDGE CRANE` : `${brand} ${run} ${kind} BRIDGE CRANE SYSTEM`;
  const custom = (c?: string) => !!c && !STD_COLORS.test(c);
  const c = s.colors ?? {};
  const out: string[] = [`# ${s.systems > 1 ? `(${s.systems}) ` : ''}${title}`, '', '## General Specs:'];
  if (s.runwayOalFt) out.push(`- Runway OAL:\t${ftIn(s.runwayOalFt)}`);
  out.push(`- Bridge Crane Span:\t${ftIn(s.spanFt)}`, `- Rated Capacity:\t${T} Ton with (${n}) hoist${n > 1 ? 's' : ''}`);
  if (s.overallHeightFt != null || s.hookHeightFt != null) out.push(`- Hook Height:\t${hgt(x.hook, 'floor')}`, `- ${s.support === 'freestanding' ? 'Overall Height' : 'Top of Runway'}:\t${hgt(x.overall, 'ceil')}`);
  out.push(`- System Voltage:\t${s.voltage.replace('/3', '/3 phase')}`, '',
    '## Crane Classification:',
    s.serviceClass === 'D' ? '> Class D (Heavy Service): This service covers cranes which may be used in heavy machine shops, foundries, fabricating plants, steel warehouses, container yards, lumber mills, etc., and standard duty bucket and magnet operations where heavy duty production is required. In this type of service, loads approaching 50 percent of the rated capacity will be handled constantly during the working period.'
      : '> Class C (Moderate Service): This service covers cranes whose service requirements are deemed moderate, handling loads which average 50 percent of the rated capacity with 5 to 10 lifts per hour, averaging 15 feet, with not over 50 percent of the lifts at rated capacity.', '');
  if (s.support !== 'bridge_only') {
    out.push('## Runway Package');
    if (s.support === 'freestanding' || s.support === 'crane_columns') out.push(`- (${x.colsPer}) Structural ${s.support === 'crane_columns' ? 'crane ' : ''}columns spaced at approx. ${ftIn(Math.round(x.bayFt))} bays`);
    else out.push(`- Runway beams ${s.hanging === 'underhung' ? 'hung from the existing building structure with drop rod connections' : s.bracketsByOthers ? 'set on the crane brackets supplied with the building (brackets by others)' : 'mounted to the existing building columns with PWI runway brackets'} (approx. ${ftIn(Math.round(x.bayFt))} spacing)`, '- Customer to confirm the building structure can support the crane loads (PWI to provide reactions)');
    out.push(`- ${ftIn(s.runwayOalFt)} x ${T} Ton capacity runway system`);
    if (x.rail) out.push('- ASCE crane rail with standard weld clips');
    if (s.support === 'freestanding') out.push('- Runway system will include lateral and longitudinal tie back bracing');
    out.push('- (4) HD end stops', '- Complete ElectroTrack electrification system',
      `- ${custom(c.runways) ? `Runways painted ${c.runways} (custom color)` : 'Runways painted gray'}${x.cols ? `, ${custom(c.columns) ? `columns painted ${c.columns} (custom color)` : 'columns painted gray'}` : ''}`);
    if (x.cols) out.push(x.foundation === 'foundation' ? '- Columns set on concrete foundations by others, with epoxy anchors and grouted base plates' : '- Support columns with gusseted base plates designed for 6" concrete slab');
    if (s.bracedToBuilding) out.push('- Needs to be braced to present structure');
    out.push('');
  } else {
    out.push('## Existing Runway');
    out.push('- Bridge crane to run on the customer\'s existing runway system', '- Runway capacity, alignment and condition to be verified by the customer');
    if (x.railFt > 0) out.push(`- New ASCE crane rail with standard weld clips (${ftIn(x.railFt)} total)`);
    if (x.runwayElec) out.push(`- New ElectroTrack runway electrification (${ftIn(x.elecFt)})`);
    out.push('');
  }
  out.push(`## (${x.bridges}) ${ftIn(s.spanFt)} x ${T} Ton Capacity ${x.doubleGirder ? 'Double Girder ' : ''}${s.hanging === 'underhung' ? 'Underhung' : 'Top Runner'} ${x.motor ? 'Motorized' : 'Manual'} Bridge Crane`,
    x.motor ? `- Includes ${T} ton ${s.hanging === 'underhung' ? 'underhung' : 'top running'} motorized end trucks with 2-speed/VFD` : `- Includes ${T} ton manual ${s.hanging === 'underhung' ? 'underhung' : 'top running'} end trucks`,
    `- (${n}) Starke ${x.wireRope ? 'SMW Series' : 'STK Series'} ${T} ton electric ${x.wireRope ? 'wire rope' : 'chain'} hoist`,
    `-- ${x.lift}' lift`,
    `-- ${s.voltage.startsWith('460') ? '460V/3ph' : s.voltage.startsWith('208') ? '208V/3ph' : '230V/3ph'}`,
    // wire rope hoists come with their own trolley; only chain hoists list the trolley separately
    ...(x.wireRope ? [`-- Integral ${s.trolley === 'motorized' ? 'motorized trolley, 2-speed/VFD' : 'trolley'}`]
      : [`- (${n}) Starke ${s.trolley === 'motorized' ? 'motorized' : 'manual'} trolley`, ...(s.trolley === 'motorized' ? ['-- 2-speed/VFD'] : [])]),
    x.festoon ? '- Festoon electrification system on bridge' : '- ElectroTrack electrification system on bridge', '- PWI HD end stops at each end of bridge crane',
    `- ${custom(c.bridge) ? `Bridge painted ${c.bridge} (custom color)` : 'Spark Orange industrial coating'}`, '- Rated capacity decals', '',
    ...(s.control === 'radio' ? ['## Radio Remote Control System', '- Starke Echo Series radio remote control system', `- Capable of ${x.motor ? '3 Motion/2 Step control   (N/S - E/W - Up/Down)' : 'hoist and trolley control'}`, '- Includes (1) spare transmitter',
        ...(s.backupPendant ? ['- Backup pendant control on festoon'] : []), '']
      : ['## Pendant Control', '- Pendant control for hoist and trolley', '']),
    ...(x.motor ? ['## Control Panel', '- Starke VFD bridge control panel', '- Programmable 2-step control and start - stop operation', '- Warning strobe light to indicate bridge is in motion', ''] : []),
    ...(s.collisionAvoidance ? ['## Collision Avoidance', '- Starke Collision Avoidance for bridge crane to bridge crane and bridge crane to end stops', '- Increased safety for operators especially when transporting heavy loads', '- Simple uni-directional bridge collision avoidance with (2) adjustable events (0-200 ft)', ''] : []),
    ...(s.install ? ['## Installation', '- Complete installation by PWI crew, including setup, anchoring, electrification and final adjustments', '- Customer to provide power to the main disconnect', ''] : ['## Shipping', '- Ship only — installation by others', '']),
    `[image:${s.support === 'freestanding' ? 'fstr' : 'bridge'}]`);
  return out.join('\n');
}
