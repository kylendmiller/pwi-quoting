// Guardian RV work platform set (type "work_platform"): per set, 2 truss platforms hung from 4 towers on
// 4 Starke chain hoists with secondary brakes. Ported from the SMT "Work Platforms" tab + Labor rows 59-71,
// patterned on mezzanine.ts / kit.ts. Steel is priced through Kit (steel_cost setting), the rest per the tab.
import W from './rules/work_platform_rules.json';
import { Kit, check, keep, ftIn, type Catalog, type Factors } from './kit';
import type { BuildResult, BuildOpts } from './crane';

export interface WorkPlatformSpec {
  sets?: number;                         // work platform sets (2 platforms + 4 towers each)
  lengthFt: number;                      // platform length, not including end extensions
  widthFt?: number;                      // platform width (default 4'; wider adds runner tubes + $500/ft)
  tallestUnitFt?: number;                // tallest customer unit → 24' standard or 30' tall towers
  fingerRacks?: boolean;                 // finger racks / storage on the platform (forces box truss)
  fingerRackFt?: number;                 // line feet of finger racks for trim storage
  motorizedWidth?: boolean;              // motorized width adjustability (forces box truss)
  woodFloor?: boolean;                   // supply 3/4" Advantech flooring (default: by others)
  crosswalks?: { standard?: number; pivot?: number; expandable?: number; aluminum?: number; expandedLengthFt?: number; wideUnits?: boolean };
  gapProtection?: boolean; vNose?: boolean;
  telescopingGuardrail?: number; telescopingLengthFt?: number;
  camGateFrontFt?: number; camGateRearFt?: number;
  endExtensions?: number;                // per set (0-4); the rest of the 4 ends get end caps
  treadPlateExtensions?: boolean; longestUnitFt?: number;
  ladder?: boolean; extraTrackRuns?: number;
  install: boolean; miles?: number; crewMen?: number; travelMode?: 'drive' | 'fly' | 'local';
}
const KEYS = ['sets', 'lengthFt', 'widthFt', 'tallestUnitFt', 'fingerRacks', 'fingerRackFt', 'motorizedWidth', 'woodFloor', 'crosswalks', 'gapProtection', 'vNose', 'telescopingGuardrail',
  'telescopingLengthFt', 'camGateFrontFt', 'camGateRearFt', 'endExtensions', 'treadPlateExtensions', 'longestUnitFt', 'ladder', 'extraTrackRuns', 'install', 'miles', 'crewMen', 'travelMode'] as const;

export function buildWorkPlatform(spec: WorkPlatformSpec, cat: Catalog, f: Factors = { production: 0.82, install: 0.95 }, bo: BuildOpts = {}): BuildResult {
  check('lengthFt', spec.lengthFt, 20, 90, true); check('widthFt', spec.widthFt, 2, 10); check('sets', spec.sets, 1, 10); check('tallestUnitFt', spec.tallestUnitFt, 6, 20);
  check('fingerRackFt', spec.fingerRackFt, 0, 200); check('telescopingGuardrail', spec.telescopingGuardrail, 0, 10); check('telescopingLengthFt', spec.telescopingLengthFt, 0, 30);
  check('camGateFrontFt', spec.camGateFrontFt, 0, 90); check('camGateRearFt', spec.camGateRearFt, 0, 90); check('endExtensions', spec.endExtensions, 0, 4); check('extraTrackRuns', spec.extraTrackRuns, 0, 10);
  check('longestUnitFt', spec.longestUnitFt, 10, 90);
  for (const [k, v] of Object.entries(spec.crosswalks ?? {})) if (k !== 'wideUnits') check(`crosswalks.${k}`, v as number, 0, k === 'expandedLengthFt' ? 30 : 10);
  if (spec.install || spec.miles != null) check('miles', spec.miles, 0, 3500, true);
  const s = keep<WorkPlatformSpec>(spec, KEYS);
  const n = s.sets ?? 1, L = s.lengthFt, Wd = s.widthFt ?? 4, adj = L / 50, O = W.options;
  const K = new Kit(cat, 'work_platform', f), A = K.A;
  const box = L > W.boxTrussIf.lengthOverFt || Wd > W.boxTrussIf.widthOverFt || !!s.fingerRacks || !!s.motorizedWidth;
  const tall = (s.tallestUnitFt ?? 13.5) > W.tallTowerIfUnitOverFt;
  const hoistT = L > 62 ? '3 Ton' : L > 40 || Wd > 4 || s.fingerRacks || s.motorizedWidth ? '2 Ton' : '1 Ton';
  A.push({ field: 'truss', value: box ? 'box' : 'triangular', why: box ? `Box truss (length > ${W.boxTrussIf.lengthOverFt}', width > ${W.boxTrussIf.widthOverFt}', finger racks or motorized width)` : `Triangular truss (≤ ${W.boxTrussIf.lengthOverFt}' × ${W.boxTrussIf.widthOverFt}', no racks)` });
  A.push({ field: 'hoists', value: hoistT, why: `(4) Starke ${hoistT} chain hoists per set for a ${L}' × ${Wd}' platform (Work Platforms tab)` });
  if (s.widthFt == null) A.push({ field: 'widthFt', value: 4, why: 'Standard 4\' platform width (wider adds runner tubes + $500/ft)', alt: 6 });
  if (s.tallestUnitFt == null) A.push({ field: 'tallestUnitFt', value: 13.5, why: 'Units ≤ 14\' tall → standard 24\' towers', alt: 15, altLabel: 'Units over 14\' → 30\' towers' });

  // ---------- steel (structural markup, steel_cost setting); paint is a flat per-set booth charge
  const rows = (box ? W.structural.box : W.structural.triangular) as [string, number, string, number, boolean][];
  for (const [d, q, sh, len, scale] of rows) K.steel(d, sh, q * n, Math.round(len * (scale ? adj : 1) * 100) / 100, { paint: false,
    basis: { source: 'fixed', chart: `Work Platforms tab — ${box ? 'box' : 'triangular'} truss`, text: `${q} per set${scale ? ` × ${len}' scaled by length ${L}' ÷ 50'` : ` × ${len}'`}`, assumption: 'truss' } });
  for (const [d, q, t, w, l] of W.plate as [string, number, number, number, number][]) K.plate(d, q * n, t, w, l, { basis: { source: 'fixed', chart: 'Work Platforms tab — plate', text: `${q} per set` } });
  const C = W.calc as unknown as Record<string, (string | number)[]>;
  const calc = (k: string, qty: number, desc: string) => { const [sh, len, per] = C[k] as [string, number, number?]; if (qty > 0) K.steel(desc, sh, qty * (per ?? 1), len, { paint: false }); };
  if (Wd > 4) { calc('extraLongTower', n, 'Width adder — extra tower material'); calc('extraRunner', n, 'Width adder — extra runner tubes'); K.sell(`Width adder (${Wd}' wide)`, n, (Wd - 4) * O.widthOver4PerFt, 'workPlatforms'); }
  if (tall) { calc('extraLongTower', n, "30' tall tower material"); K.sell("30' tall tower adder", n, O.tallTowerAdd, 'workPlatforms'); }

  // ---------- components (list less 15%), specialty items (+25%)
  const comp = (part: string, qty: number) => { const p = cat.vendor(part); if (!p) { K.notes.push(`Vendor part not found: ${part}`); return 0; } const each = p.list * (1 - W.componentDiscount); K.sell(`${p.vendor} ${part} — ${p.description}`, qty, each, 'vendor'); return each; };
  K.sell(W.sirenStrobe.desc, W.sirenStrobe.perSet * n, W.sirenStrobe.sell, 'vendor');
  const trackEach = comp(W.track.part, W.track.perSet * n);
  const H = (W.hoists as any)[hoistT];
  comp(H.part, 4 * n); comp(H.brake, 4 * n);
  const sp = W.specialty as [string, number, number][];
  K.sell('Specialty hardware (UHMW slides, U-bolts, hoist / end-unit bolts, decals, wiring harness)', n, sp.reduce((a, [, q, c]) => a + q * c, 0) * (1 + W.specialtyMarkupPct / 100), 'workPlatforms');

  // ---------- options and accessories (per set)
  const cw = s.crosswalks ?? {}, hrs: [string, number][] = [];
  const opt = (desc: string, dollars: number, h: number) => { if (dollars > 0) { K.sell(desc, n, dollars, 'workPlatforms'); hrs.push([desc, h * n]); } };
  const HR = W.shop.accessoryHrsPerDollar;
  if (s.woodFloor) { const sheets = Math.ceil((L * Wd * 2 + 96) / 32); K.sell(`3/4" Advantech flooring (${sheets} sheets per set)`, n, sheets * O.advantechSheet * 2, 'workPlatforms'); }
  opt(`Standard PWI crosswalks (${cw.standard ?? 0})`, (cw.standard ?? 0) * O.crosswalk.standard, (cw.standard ?? 0) * O.crosswalk.standard * HR.crosswalk);
  opt(`Pivot style PWI crosswalks (${cw.pivot ?? 0})`, (cw.pivot ?? 0) * O.crosswalk.pivot, (cw.pivot ?? 0) * O.crosswalk.pivot * HR.crosswalk);
  const expD = (cw.expandable ?? 0) * (O.crosswalk.expandable + Math.max(0, (cw.expandedLengthFt ?? 0) - 6) * O.crosswalk.expandablePerFtOver6);
  opt(`Expandable PWI crosswalks (${cw.expandable ?? 0})`, expD, expD * HR.crosswalk);
  const alD = (cw.aluminum ?? 0) * (cw.wideUnits ? O.crosswalk.aluminumWide : O.crosswalk.aluminum);
  opt(`Werner aluminum extendable crosswalks (${cw.aluminum ?? 0})`, alD, alD * HR.crosswalk);
  if (s.gapProtection) { const g = ((cw.standard ?? 0) + (cw.pivot ?? 0) + (cw.expandable ?? 0)) * O.gapProtectionPerCrosswalk; opt('Aluminum angle gap protection', g, g * HR.guard); }
  if (s.vNose) opt('V-nose protection', O.vNose, O.vNose * HR.guard);
  if (s.telescopingGuardrail) { const t = s.telescopingGuardrail * (O.telescopingGuardrail + ((s.telescopingLengthFt ?? 0) > 6 ? ((s.telescopingLengthFt ?? 0) - 10) * O.telescopingPerFtOver10 : 0)); opt(`Telescoping guardrail sections (${s.telescopingGuardrail})`, t, t * HR.guard); }
  const sm = (k: string) => { const [sh, len] = C[k] as [string, number]; const g = cat.shape(sh); return g ? g.lbPerFt * len * K.steelPerLb(g.group, g.pricePerLb) * (1 + cat.structuralMarkupPct / 100) : 0; };
  const cam = (s.camGateFrontFt ?? 0) + (s.camGateRearFt ?? 0);
  if (cam > 0) {
    opt(`Cam gates (${cam}' of unit coverage)`, cam * 2 * (sm('camGate') + O.camGatePerFtAdd), cam * 2 * 1.25);
    const inner = (L - cam + (s.endExtensions ?? 0)) * 2;
    if (inner > 0) opt(`Interior guardrail (${inner}')`, inner * (sm('innerGuardrail') + O.innerGuardrailPerFtAdd), inner * (sm('innerGuardrail') + O.innerGuardrailPerFtAdd) * HR.material075);
  }
  const ext = s.endExtensions ?? 0;
  if (ext) { opt(`WP end extensions (${ext})`, ext * (sm('endExtension') + O.endExtensionAdd), ext * 3.66); opt(`Swing gates (${ext})`, ext * (sm('swingGate') + O.swingGateAdd), ext * 1.8); }
  if (4 - ext > 0) opt(`WP end caps (${4 - ext})`, (4 - ext) * (sm('endCap') + O.endCapAdd), (4 - ext) * 1.66);
  if (s.fingerRackFt) opt(`Finger racks for trim storage (${s.fingerRackFt}')`, s.fingerRackFt * sm('fingerRack') * 2 + s.fingerRackFt * O.fingerRackPerFtAdd, s.fingerRackFt / 2);
  if (s.treadPlateExtensions) { const lb = 0.1875 * 12 * 36 * 0.2833, d = (s.longestUnitFt ?? 48) * lb * K.platePerLb() * 2 * O.treadPlateFactor; opt('Slide-out tread plate extension sheets', d, d * HR.treadPlate); }
  if (s.ladder) opt('Ladder access', O.ladder, 2.5);
  if (s.extraTrackRuns) opt(`Additional runs of PWI 300 series track (${s.extraTrackRuns})`, s.extraTrackRuns * trackEach, 0);
  if (Wd > 4) hrs.push(['Width adder fabrication', ((Wd - 4) * O.widthOver4PerFt) * HR.material075 * n]);

  // ---------- per-set charges: paint booth (1 white primer + 1 yellow), inbound freight
  K.sell('Paint booth charges — 1 white primer, 1 yellow (per set)', n, W.perSet.paintDollars, 'painting');
  K.cost('Incoming freight (per set)', n, W.perSet.inboundFreightDollars, 0, 'inboundFreight');
  K.decal('(11" - 13" tall decals) Manual Crane Decal Set', n);

  // ---------- shop labor (Labor tab rows 60-68, SMT hours × production factor)
  const S = W.shop;
  K.shop([
    ['Fabricate 4 towers', S.towers * n], ['Fabricate 4 end units', S.endUnits * n], ['Fab (2) handrails', S.handrailsPer50ft * adj * n],
    ['Form end channels / prep parts', S.endChannels * n], ['Assemble bench components / hook points', S.benchComponents * n],
    [`Assemble (2) work platforms${box ? ' (box truss)' : ''}`, S.assemblePlatformsPer50ft * adj * n * (box ? 2 : 1)],
    ['Assembly after paint', S.afterPaint * n], ['Loading and handling', S.loading * n], ['All cutting charges', S.cutting * n],
  ], { handling: false, builtParts: false });
  // Accessory hours (tab column E / Labor row 48) are counted, not priced — the option prices carry their labor.
  const accHrs = hrs.reduce((a, [, h]) => a + h, 0);
  K.smtShopHours += accHrs;
  if (accHrs > 0) A.push({ field: 'accessoryHours', value: Math.round(accHrs * 10) / 10, why: 'Shop hours for options and accessories (scheduling only — their prices already include the labor, as on the SMT)' });

  // ---------- install (estimate; no sold WP installs to calibrate)
  const X = W.site, cws = (cw.standard ?? 0) + (cw.pivot ?? 0) + (cw.expandable ?? 0) + (cw.aluminum ?? 0);
  const towerFt = tall ? 30 : box ? 24 : 22;
  const job = { workTopFt: towerFt, heaviestPickLb: Math.max(K.heaviestLb, 1200) };
  K.finish({ install: s.install, miles: s.miles ?? 0, crewMen: s.crewMen, travelMode: s.travelMode, skipTravel: bo.skipTravel, ...job,
    site: [
      { desc: 'Unload, layout', hours: X.unloadLayout * n }, { desc: `Set towers (${4 * n})`, hours: X.tower * 4 * n }, { desc: `Hang platforms (${2 * n})`, hours: X.platform * 2 * n },
      { desc: `Hoists + secondary brakes (${4 * n})`, hours: X.hoist * 4 * n }, { desc: 'Controls / wiring', hours: X.controls * n }, { desc: 'Brace to building structure', hours: X.buildingBracing * n },
      { desc: `Crosswalks (${cws * n})`, hours: X.crosswalk * cws * n },
    ] });
  A.push({ field: 'install', value: s.install, why: 'Work platform install hours are an estimate per set — no sold work-platform installs to calibrate; confirm with the install crew' });
  K.pmCadFixed(W.perSet.pmHrs * n, W.perSet.cadHrs * n);
  K.done();

  const wording = [
    `# (${n}) - GUARDIAN WORK PLATFORM SET${n > 1 ? 'S' : ''}`, '', '## General Specs:',
    `- (2) ${ftIn(L)} x ${Wd >= 4 ? ftIn(Wd) : `${Math.round(Wd * 12)}"`} work platforms (engineer-approved ${box ? 'box' : 'triangular'} truss design)`,
    `- (4) ${tall ? "30' tall" : "24' standard"} stationary single tube tower assemblies`,
    ...(cws ? [`- (${cws}) traveling crosswalks${cw.pivot ? ' (pivot rail)' : ''}${cw.expandable ? ' (expandable)' : ''}`] : []),
    `- (4) Starke ${hoistT.toLowerCase()} capacity chain hoists (pendant operated from one tower)`,
    '- Fully braced to building structure for stability',
    s.woodFloor ? '- 3/4" Advantech flooring on all work platforms' : '- Does not include required 3/4" plywood flooring on all work platforms and crosswalks',
    '- Spark Orange industrial coating', '- Includes rated capacity decals', '',
    '## Safety Components',
    `- (4) Starke (${H.brake.replace(/-20$/, '')}) secondary brake assemblies`, '-- Installed on each end tower protecting the unit in case of a hoist chain failure',
    '- (2) siren and strobe alarm kits',
    ...(cam ? [`- Cam gates covering ${cam}' of unit, with inner safety railing between gates`] : []),
    ...(ext ? [`- (${ext}) end extensions with self closing swing gates`] : []),
    '- Work platforms and crosswalks include 42" tubular guardrail with 4" toe kick along outer edges', '',
    ...(s.install ? ['## Installation', '- Complete installation by PWI crew, including towers, platforms, hoists, controls and bracing to the building', ''] : ['## Shipping', '- Ship only — installation by others', '']),
  ].join('\n');
  return { lines: K.lines, assumptions: A, notes: K.notes, blockers: K.blockers, wording, preUse: 0, suggestedInstallHours: Math.round(K.site * 10) / 10, smtShopHours: K.smtShopHours,
    outboundFreight: K.freight, tons: K.lbs / 2000, job: { ...job, workHrs: K.workHrs }, geometry: { truss: box ? 'box' : 'triangular', hoist: hoistT, tower: tall ? 30 : 24, sets: n } };
}
