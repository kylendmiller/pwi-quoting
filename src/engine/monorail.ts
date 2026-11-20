// Monorail systems: freestanding (single-post T supports or goal-post frames with headers),
// hung from the building structure (drop rods), or on building brackets. Patterned on sold jobs
// 27952 (BP Aero, dual parallel beams on goal-post frames), 29061 (Axiom, freestanding T-post, customer
// components) and 27660/28953. Defaults from those jobs: ≤2 t supports at ≤25', single post unless two
// parallel beams or >2 t.
import CH from './rules/aqt_sizing_charts.json';
import { Kit, RULES as R, check, keep, volt, ftIn, hgt, tons, depthIn, pick, type Catalog, type Factors } from './kit';
import { pickHoist, type BuildResult, type BuildOpts } from './crane';

export interface MonorailSpec {
  systems?: number; lengthFt: number; capacityTons: number;
  support?: 'freestanding' | 'ceiling' | 'building_brackets';
  frame?: 'single_post' | 'goal_post';     // freestanding only (default: single post ≤ 2 t)
  frameWidthFt?: number;                   // goal-post header length (default 10')
  supportSpacingFt?: number;               // max spacing between supports
  overallHeightFt?: number; hookHeightFt?: number; liftFt?: number;
  hoists?: number;                         // per system (all beams)
  parallelBeams?: 1 | 2;                   // goal-post frames carrying two parallel monorail beams (sold 27952)
  components?: boolean;                    // false = hoists / trolleys / radios supplied by the customer (sold 29061)
  trolley?: 'manual' | 'motorized';
  electrification?: 'conductor' | 'festoon';
  voltage?: string; control?: 'radio' | 'pendant';
  colors?: { columns?: string; beam?: string };
  install: boolean; miles?: number; crewMen?: number; travelMode?: 'drive' | 'fly' | 'local';
}
const KEYS = ['systems', 'lengthFt', 'capacityTons', 'support', 'frame', 'frameWidthFt', 'supportSpacingFt', 'overallHeightFt', 'hookHeightFt', 'liftFt', 'hoists', 'parallelBeams', 'components', 'trolley', 'electrification', 'voltage', 'control', 'colors', 'install', 'miles', 'crewMen', 'travelMode'] as const;
const chart = (rows: any[], k: string, x: number, cap: number) => {
  const c = (CH.capacities as number[]).find(v => v >= cap - 1e-9) ?? 10; const r = rows.find(r => r[k] >= x - 1e-9); return r ? r.byCap[String(c)] ?? null : null;
};

export function buildMonorail(spec: MonorailSpec, cat: Catalog, f: Factors = { production: 0.7, install: 1.02 }, bo: BuildOpts = {}): BuildResult {
  check('lengthFt', spec.lengthFt, 6, 600, true); check('capacityTons', spec.capacityTons, 0.125, 10, true); check('systems', spec.systems, 1, 10);
  check('overallHeightFt', spec.overallHeightFt, 7, 40); check('hookHeightFt', spec.hookHeightFt, 5, 38); check('hoists', spec.hoists, 1, 6); check('supportSpacingFt', spec.supportSpacingFt, 5, 40); check('frameWidthFt', spec.frameWidthFt, 4, 30);
  if (spec.install || spec.miles != null) check('miles', spec.miles, 0, 3500, true);
  const s = keep<MonorailSpec>(spec, KEYS);
  const n = s.systems ?? 1, cap = s.capacityTons, support = s.support ?? 'freestanding', hoistsPer = s.hoists ?? 1, hoists = hoistsPer * n;
  const trolley = s.trolley ?? 'manual', control = s.control ?? (trolley === 'motorized' ? 'radio' : 'pendant'), v = volt(s.voltage);
  const beamsPer = s.parallelBeams === 2 ? 2 : 1, comps = s.components !== false;
  if (s.parallelBeams != null && ![1, 2].includes(s.parallelBeams)) throw new Error('parallelBeams must be 1 or 2.');
  const frame = s.frame ?? (beamsPer === 2 || cap > 2 ? 'goal_post' : 'single_post');
  const K = new Kit(cat, 'monorail', f), A = K.A;
  if (s.overallHeightFt == null && s.hookHeightFt == null && support !== 'ceiling') throw new Error('Monorail needs overallHeightFt or hookHeightFt');
  const overall = s.overallHeightFt ?? (s.hookHeightFt ?? 14) + 3, hook = s.hookHeightFt ?? overall - 3;

  // default support spacing from sold jobs: ≤2 t at ≤25' (29061 22.5' at 1½ t, 27952 24–25' at 1 t), heavier 20'
  const maxSpan = s.supportSpacingFt ?? (support === 'ceiling' ? 15 : pick([[2, 25], [99, 20]] as [number, number][], cap));
  const spans = Math.max(1, Math.ceil(s.lengthFt / maxSpan)), spanFt = s.lengthFt / spans, supportsPer = spans + 1, supports = supportsPer * n;
  A.push({ field: 'supportSpacingFt', value: +spanFt.toFixed(1), why: `${support === 'ceiling' ? 'Hanger' : 'Support'} spacing ≤ ${maxSpan}' → ${supportsPer} supports per system at ≈${spanFt.toFixed(1)}'`, alt: maxSpan - 5 });
  const beam = chart(CH.runway_by_bay, 'bayFt', spanFt, cap) ?? 'W14 x 43';
  A.push({ field: 'beam', value: beam, why: `Monorail beam for ${tons(cap)} t over ${spanFt.toFixed(1)}' spans (AQT runway chart) — engineering to confirm` });
  const perPiece = spanFt * 2 <= 40 ? 2 : 1, piecesPer = Math.ceil(spans / perPiece), pieceFt = Math.ceil(spanFt * perPiece + 0.5);
  const beams = beamsPer * n;
  K.steel(beamsPer === 2 ? 'Monorail beams (2 parallel)' : 'Monorail beam', beam, piecesPer * beams, pieceFt, { role: 'beam', basis: { source: 'chart', chart: 'AQT runway_by_bay', row: `${cap} t × ${spanFt.toFixed(1)}' span`, text: `${beam} from the AQT runway chart for ${spanFt.toFixed(1)}' spans at ${tons(cap)} t; ${piecesPer} piece${piecesPer > 1 ? 's' : ''} × ${pieceFt}' per beam line`, assumption: 'beam', flag: 'Engineering to confirm' } });
  K.plate('Beam splice plates', 2 * piecesPer * beams, 0.375, 10, 12);
  let cols = 0, colLen = 0, headers = 0;
  if (support === 'freestanding') {
    const capCol = frame === 'single_post' ? Math.min(10, cap * 3) : cap;    // cantilevered T-post takes a moment: size up (×3 — sold 29061 1½ t used ST12x12x1/4 posts; was ×2)
    let col = chart(CH.column_by_overall_height, 'overallHeightFt', overall, capCol) ?? 'ST 12 x 12 x 1/4';
    if (frame === 'single_post' && /^ST (4|5|6) /.test(col)) col = 'ST 8 x 8 x 1/4';
    colLen = Math.ceil((overall - depthIn(beam) / 12 - (frame === 'goal_post' ? 1.2 : 0)) * 2) / 2;
    cols = (frame === 'goal_post' ? 2 : 1) * supports;
    K.steel('Columns', col, cols, colLen, { role: 'column', basis: { source: 'chart', chart: 'AQT column_by_overall_height', row: `${capCol} t × ${overall}' overall`, text: `${col} from the AQT column chart at ${overall}' overall${frame === 'single_post' ? `, sized as ${capCol} t (cantilevered T-post ×3)` : ''}; ${cols} = ${frame === 'goal_post' ? 2 : 1} per support × ${supports}`, assumption: 'supportSpacingFt' } });
    if (frame === 'goal_post') {
      headers = supports;
      const hdr = chart(CH.girder_by_span, 'spanFt', s.frameWidthFt ?? 10, cap) ?? 'W12 x 30';
      K.steel('Headers', hdr, headers, Math.ceil(s.frameWidthFt ?? 10));
    } else K.steel('Cantilever arms', 'ST 6 x 6 x 1/4', supports, 5);
    const bp = (R.basePlate as [number, number, number][]).find(([m]) => capCol <= m) ?? [0, 1, 24];
    K.plate('Base plates', cols, bp[1], bp[2], bp[2]);
    K.plate('Top plates', cols, 0.5, 10, 12);
    K.plate('Gussets', cols * 4, 0.3125, 4, 12);
    K.std(cap >= 1 ? '3/4" Concrete Wedge Anchor' : '5/8" Concrete Wedge Anchor', cols * (cap >= 1 ? 8 : 4));
    A.push({ field: 'frame', value: frame, why: frame === 'single_post' ? 'Single-post T supports with cantilever arms (sold 29061)' : `Goal-post frames: 2 columns + header per support (sold 27952)`, alt: frame === 'single_post' ? 'goal_post' : 'single_post' });
  } else if (support === 'ceiling') {
    K.std('Drop Rod Connection', 2 * supports);
    A.push({ field: 'support', value: 'ceiling', why: 'Hung from the existing building steel with drop rod connections — building to be verified for the loads', alt: 'freestanding' });
  } else {
    K.plate('Building bracket plates', supports * 2, 0.75, 12, 16);
    K.steel('Brackets', 'W8 x 18', supports, 3);
  }
  K.std(cap >= 1 ? '3/4" Structural Bolt and Nut' : '5/8" Structural Bolt and Nut', 8 * Math.max(cols, supports) + 8 * piecesPer * beams);

  // runs, electrification, end stops, hoists
  const elec = s.electrification ?? (trolley === 'motorized' || hoistsPer > 1 ? 'conductor' : 'festoon');
  if (elec === 'conductor') { K.std('Runway Electrification Package (4-Conductor x 65 amp max)', Math.ceil(s.lengthFt) * beams); K.std('65 Amp Single Collector Set  (Non-VFD)', hoists); }
  else K.std('Motorized Bridge Crane Electrification Package (per foot)', Math.ceil(s.lengthFt) * beams);
  K.std('PWI HD Adjustable End Stop Kit (slides on Flange)', 2 * beams);
  const lift = s.liftFt ?? Math.max(10, Math.ceil((hook + 2) / 5) * 5);
  if (comps) {
    const hp = pickHoist(cat, cap, lift, v.startsWith('460') ? '460V' : '230V', trolley, false);
    if (hp) K.vend(hp, hoists); else K.notes.push(`No hoist found for ${cap} t / ${lift}' — pick in editor.`);
  } else A.push({ field: 'components', value: false, why: 'Hoists, trolleys and radios supplied by the customer (sold 29061 "No Components")', alt: true });
  if (control === 'radio') { if (comps) K.vend(`S802-2R-${trolley === 'motorized' ? 2 : 1}M-SD`, hoists); K.std('Radio Receiving Units Pairing Charge', hoists); }
  const custom = [s.colors?.columns, s.colors?.beam].filter(c => c && !/^(gray|grey|spark orange|standard)/i.test(c!));
  K.paint(custom.length ? K.units : 0, custom.length ? custom.join(', ') : null);
  K.decal('(11" - 13" tall decals) Manual Crane Decal Set', n);

  K.shop([
    ['Cut list', 1 * n],
    [`PCR monorail beams (${piecesPer * beams})`, (pieceFt > 20 ? 2 : 1.5) * piecesPer * beams],
    ...(cols ? [[`Column fab w/ gussets (${cols})`, 1.8 * cols] as [string, number]] : []),
    ...(headers ? [[`PCR headers (${headers})`, 2 * headers] as [string, number]] : []),
    ...(support === 'freestanding' && frame === 'single_post' ? [['Fab cantilever arms', 1.5 * supports] as [string, number]] : []),
    ['After paint assembly', 3 * beams + (comps ? 1 : 0) * hoists],
  ]);
  const job = { workTopFt: overall, heaviestPickLb: K.heaviestLb + 200 };
  K.finish({
    install: s.install, miles: s.miles ?? 0, crewMen: s.crewMen, travelMode: s.travelMode, skipTravel: bo.skipTravel, installDays: bo.installDays, ...job,
    site: [
      { desc: 'Unload, set up, layout', hours: 8 },
      { desc: `Install columns (${cols})`, hours: 3 * cols },
      { desc: `Install headers (${headers})`, hours: 2 * headers },
      { desc: `Install ${support === 'ceiling' ? 'drop rod hangers' : 'brackets'} (${support === 'freestanding' ? 0 : supports})`, hours: support === 'freestanding' ? 0 : 2 * supports },
      { desc: `Install monorail beam (${piecesPer * beams} pcs)`, hours: 3 * piecesPer * beams },
      { desc: 'Install end stops', hours: 1 * beams },
      { desc: 'Install electrification', hours: 5.8 * s.lengthFt * beams / 100 },
      { desc: `Hang hoists (${comps ? hoists : 0})`, hours: comps ? 3 * hoists : 0 },
    ],
  });
  K.pmCad(1.3);   // tuned 11/20 (was 1.0): sold PM+CAD ran 1.2× (27952) and 2.1× (29061) the builder's
  K.done();
  const T = tons(cap);
  const wording = [
    `# ${n > 1 ? `(${n}) ` : ''}${support === 'freestanding' ? 'FREESTANDING MONORAIL SYSTEM' : 'PWI MONORAIL SYSTEM'}`, '', '## General Specs:',
    `- Overall Length:\t${ftIn(s.lengthFt)}`, `- Rated Capacity:\t${T} Ton with (${hoistsPer}) hoist${hoistsPer > 1 ? 's' : ''}`,
    `- Hook Height:\t${hgt(hook)}`, `- System Voltage:\t${v.replace('/3', '/3 phase')}`, '',
    '## Crane Classification:',
    '> Class C (Moderate Service): This service covers cranes whose service requirements are deemed moderate, handling loads which average 50 percent of the rated capacity with 5 to 10 lifts per hour, averaging 15 feet, with not over 50 percent of the lifts at rated capacity.', '',
    '## Monorail Package',
    beamsPer === 2 ? `- (2) parallel ${ftIn(s.lengthFt)} x ${T} Ton capacity monorails${s.frameWidthFt ? ` spaced at ${ftIn(s.frameWidthFt)}` : ''}` : `- ${ftIn(s.lengthFt)} x ${T} Ton capacity monorail`,
    ...(support === 'freestanding' ? [frame === 'goal_post' ? `- (${supportsPer}) goal-post support frames with structural columns and headers at approx. ${ftIn(Math.round(spanFt))} spacing` : `- (${supportsPer}) single-post support columns with cantilever arms at approx. ${ftIn(Math.round(spanFt))} spacing`,
      '- Support columns with gusseted base plates designed for 6" concrete slab']
      : support === 'ceiling' ? [`- Hung from the existing building structure with drop rod connections at approx. ${ftIn(Math.round(spanFt))} spacing`, '- Customer to confirm the building structure can support the monorail loads (PWI to provide reactions)']
      : [`- Mounted to the existing building columns with PWI brackets at approx. ${ftIn(Math.round(spanFt))} spacing`]),
    '- PWI HD end stops at each end', `- ${elec === 'conductor' ? 'Complete ElectroTrack electrification system' : 'Festoon electrification system'}`,
    `- ${custom.length ? `Painted ${custom.join(' / ')} (custom color)` : 'Gray industrial coating'}`, '- Rated capacity decals', '',
    ...(comps ? [`## (${hoists}) ${T} Ton Hoist${hoists > 1 ? 's' : ''}`,
      `- Starke - ${cap > 3 ? 'wire rope' : 'STK Series'} ${T} ton electric ${cap > 3 ? '' : 'chain '}hoist`, `-- ${lift}' lift`, `-- ${v.startsWith('460') ? '460V/3ph' : '230V/3ph'}`,
      `- Starke ${trolley === 'motorized' ? 'Motorized' : 'Manual'} Trolley${trolley === 'motorized' ? ' — 2-speed/VFD' : ''}`, '']
      : ['## Hoists & Trolleys', `- (${hoists}) hoists and trolleys supplied by the customer`, '']),
    ...(control === 'radio' ? ['## Radio Remote Control System', '- Starke Echo Series radio remote control system', '- Includes (1) spare transmitter', ''] : ['## Pendant Control', '- Pendant control for hoist' + (trolley === 'motorized' ? ' and trolley' : ''), '']),
    ...(s.install ? ['## Installation', '- Complete installation by PWI crew, including setup, anchoring, electrification and final adjustments', '- Customer to provide power to the main disconnect', ''] : ['## Shipping', '- Ship only — installation by others', '']),
    '[image:monorail]',
  ].join('\n');
  return { lines: K.lines, assumptions: A, notes: K.notes, blockers: K.blockers, wording, preUse: 0, suggestedInstallHours: Math.round(K.site * 10) / 10, smtShopHours: K.smtShopHours,
    outboundFreight: K.freight, tons: K.lbs / 2000, job: { ...job, workHrs: K.workHrs }, geometry: { beam, spanFt: +spanFt.toFixed(1), supportsPer, cols, colLen } };
}
