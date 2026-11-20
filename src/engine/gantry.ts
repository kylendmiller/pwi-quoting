// InCommand gantry crane (PWI box-column gantry on casters), ported from the SMT Gantry tab:
// girder by span bracket, (2) box columns sized from the tab's column chart, caster-plate end
// trucks, (4) brace tubes, plasma plates, wheel-load BOM (casters/drives/motors), the tab's
// standard parts and its labor PLF-with-minimum table. Calibrated against sold job 28884.
import G from './rules/gantry_rules.json';
import { Kit, RULES as R, check, keep, volt, ftIn, hgt, tons, sizeBeam, beamUnity, calcBasis, depthIn, type Catalog, type Factors } from './kit';
import { pickHoist, type BuildResult, type BuildOpts } from './crane';

export interface GantrySpec {
  qty?: number; capacityTons: number; spanFt: number;
  heightUnderBeamFt?: number; hookHeightFt?: number;
  motorized?: boolean;                 // motor-driven casters (default true)
  hoists?: number;                     // per gantry (default 1)
  trolley?: 'manual' | 'motorized'; liftFt?: number;
  voltage?: string; control?: 'radio' | 'pendant';
  floorTrackFt?: number;               // length of anchored floor track per gantry (0 = rolls on the floor)
  colors?: { gantry?: string };
  install: boolean; miles?: number; crewMen?: number; travelMode?: 'drive' | 'fly' | 'local';
}
const KEYS = ['qty', 'capacityTons', 'spanFt', 'heightUnderBeamFt', 'hookHeightFt', 'motorized', 'hoists', 'trolley', 'liftFt', 'voltage', 'control', 'floorTrackFt', 'colors', 'install', 'miles', 'crewMen', 'travelMode'] as const;
const up = (x: number, br: number[]) => br.find(b => x <= b + 1e-9) ?? br[br.length - 1];

export function buildGantry(spec: GantrySpec, cat: Catalog, f: Factors = { production: 0.69, install: 1.09 }, bo: BuildOpts = {}): BuildResult {
  check('capacityTons', spec.capacityTons, 0.25, 10, true); check('spanFt', spec.spanFt, 6, 65, true); check('qty', spec.qty, 1, 20);
  check('heightUnderBeamFt', spec.heightUnderBeamFt, 6, 30); check('hookHeightFt', spec.hookHeightFt, 5, 28); check('hoists', spec.hoists, 1, 3); check('floorTrackFt', spec.floorTrackFt, 0, 400);
  if (spec.install || spec.miles != null) check('miles', spec.miles, 0, 3500, true);
  if (spec.heightUnderBeamFt == null && spec.hookHeightFt == null) throw new Error('Gantry needs heightUnderBeamFt or hookHeightFt');
  const s = keep<GantrySpec>(spec, KEYS);
  const n = s.qty ?? 1, cap = s.capacityTons, motor = s.motorized !== false, hoistsPer = s.hoists ?? 1, hoists = hoistsPer * n;
  const trolley = s.trolley ?? (motor ? 'motorized' : 'manual'), control = s.control ?? (motor ? 'radio' : 'pendant'), v = volt(s.voltage);
  const K = new Kit(cat, 'gantry', f), A = K.A;
  const hub = s.heightUnderBeamFt ?? (s.hookHeightFt! + 2.5);
  const hook = s.hookHeightFt ?? hub - 2.5;
  if (s.heightUnderBeamFt == null || s.hookHeightFt == null) A.push({ field: 'height', value: hub, why: s.heightUnderBeamFt == null ? `Hook ${hook}' + ≈2.5' hoist headroom → ${hub.toFixed(1)}' under beam` : `${hub}' under beam → hook ≈ ${hook.toFixed(1)}'` });

  // girder: bracket length, sized for the hoist load at L/600 (tab's deflection criterion)
  const gLen = up(s.spanFt, G.girderLenBrackets);
  const loadLb = cap * 2000 * 1.15 + hoistsPer * 150 * Math.max(1, cap);
  // two passes so the girder's own weight is in the deflection check (was point load only)
  let girder = sizeBeam(cat, { spanFt: s.spanFt, pointLb: loadLb, deflLimit: 600, wPlf: 0 }) ?? 'W24 x 104';
  for (let i = 0; i < 4; i++) { const g = sizeBeam(cat, { spanFt: s.spanFt, pointLb: loadLb, deflLimit: 600, wPlf: cat.shape(girder)?.lbPerFt ?? 60 }) ?? 'W24 x 104'; if (g === girder) break; girder = g; }
  A.push({ field: 'girder', value: girder, why: `${s.spanFt}' span, ${tons(cap)} t + hoist at L/600 deflection → ${girder} (engineering to confirm)` });
  const girderLb = (cat.shape(girder)?.lbPerFt ?? 60) * gLen;

  // box columns from the tab's chart: smallest PLF whose max girder force at this height covers the load
  const colLen = up(hub - 1 + depthIn(girder) / 12 * 0, G.columnLenBrackets);
  const force = (loadLb + girderLb) / 2;
  const row = G.columnChart.find((r: any) => r.heightFt >= hub - 1e-9) ?? G.columnChart[G.columnChart.length - 1];
  const opts = G.columnPlf.map((p: number, i: number) => ({ p, c: (row.cap as (number | null)[])[i] ?? 0 })).filter((o: any) => o.c >= force).sort((a: any, b: any) => a.p - b.p);
  const colPlf = opts[0]?.p ?? G.columnPlf[G.columnPlf.length - 1];
  if (!opts.length) K.blockers.push(`Gantry column force ${Math.round(force)} lb at ${hub}' is past the column chart — engineering must size the legs.`);
  A.push({ field: 'columns', value: `${colPlf} plf box`, why: `≈${Math.round(force)} lb per leg at ${hub.toFixed(1)}' → ${colPlf} plf box column (Gantry tab chart)` });
  const casterLen = hub / 2;
  const brace = hub < 10 ? 'RT 5 x 3 x 1/4' : hub <= 15 ? 'RT 6 x 4 x 1/4' : 'RT 8 x 4 x 1/4';
  const braceLen = up(casterLen * 1.15, G.braceLenBrackets);

  K.steel('Gantry girder', girder, n, gLen, { role: 'girder', basis: calcBasis(`${s.spanFt}' span, ${tons(cap)} t × 1.15 + hoist at L/600 incl. self weight → lightest W; cut ${gLen}' (Gantry tab length brackets)`,
    beamUnity(girder, { spanFt: s.spanFt, pointLb: loadLb, deflLimit: 600, wPlf: cat.shape(girder)?.lbPerFt ?? 60 }), 'girder') });
  K.box('Box columns / risers', 2 * n, colPlf, colLen, { role: 'column', basis: { source: 'chart', chart: 'Gantry tab column chart', row: `height ≤ ${row.heightFt}', force ${Math.round(force)} lb/leg`, text: `Smallest box column PLF whose chart capacity at ${hub.toFixed(1)}' covers ${Math.round(force)} lb per leg → ${colPlf} plf`, assumption: 'columns',
    ...(opts.length ? { unity: Math.round(force / opts[0].c * 1000) / 1000 } : { flag: 'Past the gantry column chart — engineering must size the legs' }) } });
  K.box('Caster plate weldments (end trucks)', 2 * n, colPlf, Math.ceil(casterLen * 2) / 2);
  K.steel('Brace tubes', brace, 4 * n, braceLen);
  K.plate('Top chamfer plates', 2 * n, 0.5, 8, 8);
  K.plate('Brace / column mount to caster beam plates', 6 * n, 0.5, 10, 10);
  K.plate('Brace to column plates', 4 * n, 0.5, 6, 3);
  K.plate('Girder web stiffeners', 4 * n, 0.5, 4, depthIn(girder) + 2);
  K.plate('Caster plate stiffeners', 8 * n, 0.5, 3, 8);
  if (s.floorTrackFt) { const inches = Math.round(s.floorTrackFt * 12); K.plate('Floor track base plate', 2 * n, 0.5, 9, inches); K.plate('Floor track guide bar', 2 * n, 1, 2, inches); }

  // casters / drives / motors: wheel-load BOM
  const selfLb = girderLb + 2 * colPlf * colLen + 2 * colPlf * casterLen + 300 * hoistsPer;
  const wheel = (cap * 2000 + selfLb) / 4 * 1.25;
  const bom = (G.boms as any[]).find(b => wheel <= b.maxWheelLb) ?? G.boms[G.boms.length - 1];
  const items = (bom.items as any[]).filter(i => i.qty > 0 && (motor || /caster|wheel(?! weldment)|bearing|shaft|spacer|sleeve/i.test(i.desc)));
  const bomCost = items.reduce((a, i) => a + i.qty * (i.cost + i.freight), 0) * (motor ? 1 : 2);   // manual: 4 casters, no drives
  K.cost(`Gantry casters${motor ? ', drive wheels, gear motors and cord reel' : ''} (${bom.label}, ≈${Math.round(wheel)} lb/wheel)`, n, bomCost, G.costMarkupPct, 'costBased');

  // the tab's standard parts per gantry
  K.std(motor ? 'Motorized Bridge Crane Electrification Package (per foot)' : 'Manual Bridge Crane Electrification Package (per foot)', Math.ceil(s.spanFt) * n);
  K.std('65 Amp Single Collector Set  (Non-VFD)', n);
  K.std('PWI HD Adjustable End Stop Kit (slides on Flange)', 2 * n);
  if (motor) K.std('End Truck Plug & Play Upcharge (3 ton or larger)', n);
  K.std('3/4" Structural Bolt and Nut', 64 * n);
  if (motor) K.vend(v.startsWith('460') ? 'SCP-0446' : 'SCP-0523', n);
  if (control === 'radio') { K.vend(`S802-2R-${(motor ? 1 : 0) + (trolley === 'motorized' ? 1 : 0) + 1}M-SD`, n); K.std('Radio Receiving Units Pairing Charge', n); }
  else if (motor) K.sell('Pendant control (gantry drive + hoist)', n, 1800, 'costBased');
  const lift = s.liftFt ?? Math.max(10, Math.ceil((hook + 2) / 5) * 5);
  const hp = pickHoist(cat, cap / hoistsPer, lift, v.startsWith('460') ? '460V' : '230V', trolley, false);
  if (hp) K.vend(hp, hoists); else K.notes.push(`No hoist found for ${cap / hoistsPer} t / ${lift}' — pick in editor.`);
  const custom = s.colors?.gantry && !/^(gray|grey|spark orange|standard)/i.test(s.colors.gantry) ? s.colors.gantry : null;
  K.paint(custom ? K.units : 0, custom ? `gantry: ${custom}` : null);
  K.decal(motor ? '(13" x 36") Motorized Crane Die Cut Set' : '(11" - 13" tall decals) Manual Crane Decal Set', n);

  // the tab's labor table (hours PLF with minimums; manual gantries take half)
  const m = motor ? 1 : 0.5;
  const L = (qty: number, len: number, plf: number, min: number) => Math.max(qty * len * plf * m, qty * min * m);
  K.shop([
    ['Cut list', 1 * n],
    ['Fab girder', L(n, gLen, 0.5, 20)],
    ['Fab columns', L(2 * n, colLen, 1, 10)],
    ['Fab caster plates', L(2 * n, casterLen, 1, 6)],
    ['Fab braces', L(4 * n, braceLen, 0.25, 2)],
    ['After paint assembly — girder', L(n, gLen, 0.5, 20)],
    ['After paint assembly — columns', L(2 * n, 0, 1, 10)],
    ['After paint assembly — caster plates', L(2 * n, 0, 1, 6)],
    ['After paint assembly — hoist prep', 3 * hoists * m],
    ...(s.floorTrackFt ? [['Floor track fab', Math.max(4, s.floorTrackFt * 2 * n / 12)] as [string, number]] : []),
  ]);
  const job = { workTopFt: hub + 2, heaviestPickLb: Math.max(girderLb, K.heaviestLb) };
  K.finish({
    install: s.install, miles: s.miles ?? 0, crewMen: s.crewMen, travelMode: s.travelMode, skipTravel: bo.skipTravel, installDays: bo.installDays, ...job,
    site: [
      { desc: 'Unload, mark out', hours: 10 },
      { desc: `Assemble and set gantries (${n})`, hours: 24 * n * m },
      { desc: 'Install floor track', hours: s.floorTrackFt ? Math.max(6, s.floorTrackFt * n / 14) : 0 },
      { desc: 'Install electrification / cord reels', hours: 6 * n },
    ],
  });
  K.pmCad(1);
  K.done();

  const wording = [
    `# ${n > 1 ? `(${n}) ` : ''}INCOMMAND GANTRY CRANE SYSTEM`, '', '## General Specs:',
    `- Span:\t${ftIn(s.spanFt)}`, `- Height Under Beam:\t${hgt(hub)}`, `- Rated Capacity:\t${tons(cap)} Ton with (${hoistsPer}) hoist${hoistsPer > 1 ? 's' : ''}`,
    `- Hook Height:\t${hgt(hook)}`, `- System Voltage:\t${v.replace('/3', '/3 phase')}`, '',
    '## Crane Classification:',
    '> Class C (Moderate Service): This service covers cranes whose service requirements are deemed moderate, handling loads which average 50 percent of the rated capacity with 5 to 10 lifts per hour, averaging 15 feet, with not over 50 percent of the lifts at rated capacity.', '',
    `## (${n}) ${ftIn(s.spanFt)} x ${tons(cap)} Ton Capacity ${motor ? 'Motorized' : 'Manual'} Gantry Crane`,
    motor ? '- Includes motor driven casters 2-speed/VFD: 40FPM max' : '- Includes heavy duty swivel casters (manual push)',
    ...(s.floorTrackFt ? [`- Runs on ${ftIn(s.floorTrackFt)} of floor track anchored to the concrete`] : ['- Rolls on the existing concrete floor (floor to be level and in good condition)']),
    `- (${hoistsPer}) Starke - ${cap / hoistsPer > 3 ? 'wire rope' : 'STK Series'} ${tons(cap / hoistsPer)} ton electric ${cap / hoistsPer > 3 ? '' : 'chain '}hoist`,
    `-- ${lift}' lift`, `-- ${v.startsWith('460') ? '460V/3ph' : '230V/3ph'}`,
    `- (${hoistsPer}) Starke ${trolley === 'motorized' ? 'Motorized' : 'Manual'} Trolley`,
    '- Festoon electrification system on girder', ...(motor ? ['- Cord reel power feed to the gantry'] : []),
    '- PWI HD end stops', `- ${custom ? `Painted ${custom} (custom color)` : 'Spark Orange industrial coating'}`, '- Includes rated capacity decals', '',
    ...(control === 'radio' ? ['## Radio Remote Control System', '- Starke Echo Series radio remote control system', `- Capable of ${motor ? '3 Motion/2 Step control (N/S - E/W - Up/Down)' : 'hoist and trolley control'}`, '- Includes (1) spare transmitter', '']
      : ['## Pendant Control', '- Pendant control for gantry drive, hoist and trolley', '']),
    ...(motor ? ['## Control Panel', '- Starke VFD control panel', '- Programmable 2-step control and start - stop operation', '- Warning strobe light to indicate gantry is in motion', ''] : []),
    ...(s.install ? ['## Installation', '- Complete installation by PWI crew, including assembly, electrification and final adjustments', '- Customer to provide power to the main disconnect', ''] : ['## Shipping', '- Ship only — installation by others', '']),
    '[image:gantry]',
  ].join('\n');
  return { lines: K.lines, assumptions: A, notes: K.notes, blockers: K.blockers, wording, preUse: 0, suggestedInstallHours: Math.round(K.site * 10) / 10, smtShopHours: K.smtShopHours,
    outboundFreight: K.freight, tons: K.lbs / 2000, job: { ...job, workHrs: K.workHrs }, geometry: { girder, gLen, colPlf, colLen, wheel: Math.round(wheel), bom: bom.label } };
}
