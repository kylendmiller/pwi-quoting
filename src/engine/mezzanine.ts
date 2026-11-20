// StructuralSpace mezzanine / structure package: column grid, headers and crossmembers sized
// for the floor load at L/360, deck + flooring, guardrail, gates, stairs, bracing, PWI labor.
// Patterned on sold mezzanines 28527, 27823, 27893 and the SMT Mezzanines price rows.
import M from './rules/mezzanine_rules.json';
import { Kit, check, keep, ftIn, hgt, sizeBeam, beamUnity, calcBasis, depthIn, pick, type Catalog, type Factors } from './kit';
import type { BuildResult, BuildOpts } from './crane';

export interface MezzanineSpec {
  qty?: number; lengthFt: number; widthFt: number; deckHeightFt: number;
  liveLoadPsf?: number;                       // default 125 (storage)
  deck?: 'bdeck_advantech' | 'bdeck_resindek' | 'grating' | 'treadplate' | 'bdeck_only' | 'none';
  treadPlate?: '1/8' | '3/16' | '1/4' | '3/8';
  guardrailFt?: number;                       // default: perimeter minus stair and gate openings
  guardrail?: 'osha' | 'ibc' | 'removable';
  stairs?: number; stairType?: 'straight' | 'switchback'; stairPrice?: number;   // StairZone price per stair (sell)
  gates?: { type: keyof typeof M.gates; qty: number }[];
  bracing?: 'knee' | 'x' | 'building' | 'none';
  maxColumnSpacingFt?: number; columns?: number;
  primerOnly?: boolean; colors?: { structure?: string };
  stamped?: boolean;                          // PE-stamped drawings
  install: boolean; miles?: number; crewMen?: number; travelMode?: 'drive' | 'fly' | 'local';
}
const KEYS = ['qty', 'lengthFt', 'widthFt', 'deckHeightFt', 'liveLoadPsf', 'deck', 'treadPlate', 'guardrailFt', 'guardrail', 'stairs', 'stairType', 'stairPrice', 'gates', 'bracing', 'maxColumnSpacingFt', 'columns', 'primerOnly', 'colors', 'stamped', 'install', 'miles', 'crewMen', 'travelMode'] as const;

export function buildMezzanine(spec: MezzanineSpec, cat: Catalog, f: Factors = { production: 0.83, install: 1.11 }, bo: BuildOpts = {}): BuildResult {
  check('lengthFt', spec.lengthFt, 6, 400, true); check('widthFt', spec.widthFt, 6, 300, true); check('deckHeightFt', spec.deckHeightFt, 4, 30, true);
  check('liveLoadPsf', spec.liveLoadPsf, 35, 250); check('guardrailFt', spec.guardrailFt, 0, 2000); check('stairs', spec.stairs, 0, 10); check('qty', spec.qty, 1, 10); check('maxColumnSpacingFt', spec.maxColumnSpacingFt, 8, 40);
  if (spec.install || spec.miles != null) check('miles', spec.miles, 0, 3500, true);
  const s = keep<MezzanineSpec>(spec, KEYS);
  const n = s.qty ?? 1, LL = s.liveLoadPsf ?? 125, DL = M.deadLoadPsf, w = LL + DL, mk = M.markupPct;
  const K = new Kit(cat, 'mezzanine', f), A = K.A;
  const L = Math.max(s.lengthFt, s.widthFt), W = Math.min(s.lengthFt, s.widthFt), sqft = s.lengthFt * s.widthFt;

  // ---------- grid: header lines run along the length, crossmembers span between them at 4' c/c
  const maxCol = s.maxColumnSpacingFt ?? M.maxColumnSpacingFt;
  const lines = Math.max(2, Math.ceil(W / M.maxCrossmemberSpanFt) + 1), crossSpan = W / (lines - 1);
  const colsPerLine = Math.max(2, Math.ceil(L / maxCol) + 1), colSpacing = L / (colsPerLine - 1);
  const cols = lines * colsPerLine;
  const headers = lines * (colsPerLine - 1);
  const cms = (Math.floor(L / M.crossmemberSpacingFt) + 1) * (lines - 1);
  A.push({ field: 'grid', value: `${cols} columns`, why: `${lines} header lines × ${colsPerLine} columns (≤${maxCol}' column spacing → ${colSpacing.toFixed(1)}'), crossmembers at ${M.crossmemberSpacingFt}' c/c spanning ${crossSpan.toFixed(1)}'`, alt: maxCol - 5, altLabel: `Tighter grid (≤${maxCol - 5}' spacing): more columns, lighter beams` });

  const cm = sizeBeam(cat, { spanFt: crossSpan, wPlf: w * M.crossmemberSpacingFt, liveFrac: LL / w, deflLimit: M.deflectionLimit }) ?? 'W12 x 26';
  const trib = lines > 2 ? crossSpan : crossSpan / 2;
  const hdr = sizeBeam(cat, { spanFt: colSpacing, wPlf: w * trib, liveFrac: LL / w, deflLimit: M.deflectionLimit, minDepthIn: depthIn(cm) }) ?? 'W16 x 57';
  const colLoad = w * colSpacing * trib;
  const col = pick(M.columnByLoadLb as [number, string][], colLoad);
  const colLen = Math.ceil((s.deckHeightFt - depthIn(hdr) / 12 - 0.25) * 2) / 2;
  const clear = s.deckHeightFt - (depthIn(hdr) + depthIn(cm) * 0) / 12 - 0.5;
  A.push({ field: 'members', value: `${col} / ${hdr} / ${cm}`, why: `${LL} psf live + ${DL} psf dead at L/${M.deflectionLimit}: crossmembers ${cm}, headers ${hdr}, columns ${col} (≈${Math.round(colLoad / 1000)} kip) — engineering to confirm` });

  const colRow = (M.columnByLoadLb as [number, string][]).find(([m]) => colLoad <= m)?.[0];
  K.steel('Columns', col, cols * n, colLen, { role: 'column', basis: { source: 'chart', chart: 'mezzanine_rules columnByLoadLb', row: `load ≤ ${colRow ?? 'max'} lb`, text: `${Math.round(colLoad).toLocaleString('en-US')} lb per column (${w} psf × ${colSpacing.toFixed(1)}' × ${trib.toFixed(1)}' trib) → ${col}`, assumption: 'members', ...(colRow ? { unity: Math.round(colLoad / colRow * 1000) / 1000 } : { flag: 'Past the column table — engineering to size' }) } });
  K.steel('Headers', hdr, headers * n, Math.ceil(colSpacing), { role: 'header', basis: calcBasis(`${colSpacing.toFixed(1)}' span, ${w} psf × ${trib.toFixed(1)}' trib = ${Math.round(w * trib)} plf, L/${M.deflectionLimit} on live load, ≥ crossmember depth`,
    beamUnity(hdr, { spanFt: colSpacing, wPlf: w * trib, liveFrac: LL / w, deflLimit: M.deflectionLimit }), 'members') });
  K.steel('Crossmembers', cm, cms * n, Math.ceil(crossSpan), { role: 'crossmember', basis: calcBasis(`${crossSpan.toFixed(1)}' span at ${M.crossmemberSpacingFt}' c/c, ${w} psf = ${w * M.crossmemberSpacingFt} plf, L/${M.deflectionLimit} on live load`,
    beamUnity(cm, { spanFt: crossSpan, wPlf: w * M.crossmemberSpacingFt, liveFrac: LL / w, deflLimit: M.deflectionLimit }), 'members') });
  const bp = colLoad > 40000 ? [1, 20] : colLoad > 15000 ? [0.75, 16] : [0.75, 14];
  K.plate('Base plates', cols * n, bp[0], bp[1], bp[1]);
  K.plate('Top / cap plates', cols * n, 0.5, 10, 12);
  K.plate('Header knife plates', headers * 2 * n, 0.5, 6, 12);
  K.plate('Crossmember shear tabs', cms * 2 * n, 0.375, 4, Math.max(6, depthIn(cm) - 3));
  const bracing = s.bracing ?? 'knee';
  const perimCols = 2 * (colsPerLine + lines) - 4;
  if (bracing === 'knee') K.steel('Knee braces', 'AI 3 x 3 x 1/4', perimCols * 2 * n, 8);
  if (bracing === 'x') K.steel('X-bracing', 'AI 3 x 3 x 1/4', 8 * n, 20);
  A.push({ field: 'bracing', value: bracing, why: bracing === 'knee' ? 'Knee braces at perimeter columns (freestanding braced mezzanine)' : bracing === 'x' ? 'X-bracing in end bays' : bracing === 'building' ? 'Lateral loads braced to the existing building (customer to accept)' : 'No bracing (customer to accept)', alt: bracing === 'knee' ? 'building' : 'knee' });

  K.std('3/4" Concrete Wedge Anchor', cols * 6 * n);
  K.std('3/4" Structural Bolt and Nut', (headers * 8 + cms * 4 + (bracing === 'knee' ? perimCols * 4 : bracing === 'x' ? 16 : 0)) * n);

  // ---------- deck + flooring (Mezzanines price rows: cost + 20%)
  const deck = s.deck ?? 'bdeck_advantech';
  const sheets = Math.ceil(sqft / 32 * 1.03);
  const F = M.fasteners;
  if (deck.startsWith('bdeck')) {
    K.sell('1.5" 20 ga. white-bottom B-Deck (per sq ft)', Math.ceil(sqft * n), M.deck.bdeck_white_20ga_per_sqft_sell, 'stdParts');
    K.cost('Pins and shots (deck attachment)', Math.ceil(sqft * F.pinsShotsPerSqft) * n, F.pinsShotsCost, mk, 'stdParts');
    K.cost('Valley shims', Math.ceil(sqft * F.valleyShimsPerSqft) * n, F.valleyShimCost, mk, 'stdParts');
  }
  if (deck === 'bdeck_advantech') { K.cost('3/4" Advantech T&G per 4\' x 8\' sheet', sheets * n, M.deck.advantech_sheet_cost, mk, 'stdParts'); K.cost('Wood screws', sheets * F.woodScrewsPerSheet * n, F.woodScrewCost, mk, 'stdParts'); }
  if (deck === 'bdeck_resindek') { K.cost('ResinDek T&G panel per 4\' x 8\' sheet', sheets * n, M.deck.resindek_sheet_cost, mk, 'stdParts'); K.cost('Panel screws', sheets * F.woodScrewsPerSheet * n, F.woodScrewCost, mk, 'stdParts'); }
  if (deck === 'grating') { K.cost('1" 19W4 bar grating (per 100 sq ft)', Math.ceil(sqft / 100 * 1.05) * n, M.deck.grating_per_100sqft_cost, mk, 'stdParts'); K.cost('Saddle clips and self tappers', Math.ceil(sqft * F.saddleClipsPerSqft) * n, F.saddleClipCost, mk, 'stdParts'); }
  if (deck === 'treadplate') { const t = s.treadPlate ?? '1/4'; K.cost(`Tread plate ${t}" per 4' x 8' sheet`, sheets * n, (M.deck.treadplate_sheet_cost as any)[t], mk, 'stdParts'); }

  // ---------- guardrail, gates, stairs
  const gates = s.gates ?? [];
  const gateOpen = gates.reduce((a, g) => a + g.qty * (g.type === 'safety' ? 3 : 10), 0);
  const stairs = s.stairs ?? 0;
  const guardFt = s.guardrailFt ?? Math.max(0, 2 * (s.lengthFt + s.widthFt) - stairs * 4 - gateOpen);
  if (s.guardrailFt == null) A.push({ field: 'guardrailFt', value: guardFt, why: `Full perimeter ${2 * (s.lengthFt + s.widthFt)}' less stair and gate openings — set the real open sides`, alt: Math.round(guardFt / 2) });
  const gType = s.guardrail ?? 'osha';
  K.cost(`42" ${gType === 'ibc' ? 'IBC' : gType === 'removable' ? 'OSHA pocket removable' : 'OSHA bolt-together'} guardrail with mid-rail and toe-kick (per ft)`, Math.ceil(guardFt) * n, (M.guardrailPerFtCost as any)[gType], mk, 'stdParts');
  let gateSite = 0;
  for (const g of gates) { const [desc, c, hrs] = (M.gates as any)[g.type] ?? []; if (!desc) { K.notes.push(`Gate type ${g.type} not in list`); continue; } K.cost(desc, g.qty * n, c, mk, 'stdParts'); gateSite += hrs * g.qty * n; }
  if (stairs > 0) {
    if (s.stairPrice) K.sell(`StairZone ${s.stairType ?? 'straight'} industrial stairway to ${hgt(s.deckHeightFt)} (OSHA, Type C rail)`, stairs * n, s.stairPrice, 'stairways');
    else { K.sell(`StairZone ${s.stairType ?? 'straight'} industrial stairway to ${hgt(s.deckHeightFt)} — PRICE NEEDED`, stairs * n, 0, 'stairways'); K.blockers.push(`Add the StairZone price for the ${stairs} stair${stairs > 1 ? 's' : ''} (stairPrice), or edit the stairway line.`); }
  }

  // ---------- paint, labor
  const custom = s.colors?.structure && !/^(gray|grey|standard)/i.test(s.colors.structure) ? s.colors.structure : null;
  // Gray structure = gray primer booth runs unless they ask for a finish coat (sold mezz 28527, 27793, 27893 all priced primer runs).
  const primer = s.primerOnly ?? M.paint.primerByDefault;
  K.paint(custom ? K.units : 0, custom ? `structure: ${custom}` : null, { primerOnly: primer });
  K.decal(sqft > 2000 ? '(13"x 30") Mezzanine Decal' : sqft > 600 ? '(10" x 26") Mezzanine Decal' : '(6" x 18") Mezzanine Decal', n * Math.max(1, stairs));
  const S = M.shop, X = M.site;
  K.shop([
    ['Cut list', S.cutList * n],
    [`Mezzanine column fab (${cols * n})`, S.columnFab * cols * n],
    [`PCR headers (${headers * n})`, S.pcrHeader * headers * n],
    [`PCR crossmembers (${cms * n})`, S.pcrCrossmember * cms * n],
    ...(bracing === 'knee' ? [['Knee brace fab', S.braceFab * perimCols * 2 * n] as [string, number]] : []),
  ]);
  const job = { workTopFt: s.deckHeightFt + 4, heaviestPickLb: K.heaviestLb };
  const floorHrs = deck === 'bdeck_advantech' || deck === 'bdeck_resindek' ? X.woodFloorPerSheet * sheets : deck === 'grating' ? X.gratingPerSqft * sqft : deck === 'treadplate' ? X.woodFloorPerSheet * sheets : 0;
  K.finish({
    install: s.install, miles: s.miles ?? 0, crewMen: s.crewMen, travelMode: s.travelMode, skipTravel: bo.skipTravel, ...job,
    site: [
      { desc: 'Unload / markout', hours: X.unloadMarkout * n },
      { desc: `Install columns (${cols * n})`, hours: X.column * cols * n },
      { desc: `Install headers (${headers * n})`, hours: X.header * headers * n },
      { desc: `Install crossmembers (${cms * n})`, hours: X.crossmember * cms * n },
      { desc: 'Install bracing', hours: bracing === 'knee' ? X.brace * perimCols * 2 * n : bracing === 'x' ? X.brace * 8 * n : 0 },
      { desc: 'Install B-deck', hours: deck.startsWith('bdeck') ? X.deckPerSqft * sqft * n : 0 },
      { desc: 'Install flooring', hours: floorHrs * n },
      { desc: `Install guardrail (${Math.ceil(guardFt * n)}')`, hours: X.guardrailPerFt * guardFt * n },
      { desc: 'Install gates', hours: gateSite },
      { desc: `Install stairs (${stairs * n})`, hours: (s.stairType === 'switchback' ? X.stairSwitchback : X.stairStraight) * stairs * n },
    ],
  });
  K.pmCad(1.2);
  if (s.stamped) K.pe(Math.max(6, Math.round(sqft / 1500) + 4));
  K.done();

  const deckLines: Record<string, string[]> = {
    bdeck_advantech: ['- Subfloor: 1-1/2" x 20 ga white-bottom B-Deck attached with Hilti shots', `- Flooring: 3/4" Advantech T&G (${sheets * n}) sheets 4' x 8', collated screws, unfinished surface`],
    bdeck_resindek: ['- Subfloor: 1-1/2" x 20 ga white-bottom B-Deck attached with Hilti shots', `- Flooring: ResinDek T&G (${sheets * n}) panels 4' x 8', collated screws`],
    grating: ['- Flooring: 1" 19W4 bar grating, unpainted, attached with saddle clips'],
    treadplate: [`- Flooring: ${s.treadPlate ?? '1/4'}" tread plate, (${sheets * n}) sheets 4' x 8'`],
    bdeck_only: ['- Subfloor: 1-1/2" x 20 ga B-Deck (concrete fill by others)'],
    none: ['- Flooring by others'],
  };
  const wording = [
    `# (${n}) - ${ftIn(s.lengthFt)} x ${ftIn(s.widthFt)} PWI MEZZANINE PACKAGE`, '', '## General Specs:',
    `- Approximate Square Footage:\t${Math.round(sqft).toLocaleString('en-US')}`,
    `- Mezzanine Rated Capacity:\t${LL} psf L.L.`, `- Engineering Standards:\tL/${M.deflectionLimit}`,
    `- Approximate Deck Height:\t${hgt(s.deckHeightFt)}`, `- Clear Height:\t${hgt(clear)}`,
    `- Approx. Crossmember Spacing:\t${M.crossmemberSpacingFt}' 0" c/c`, `- Max. Assumed Column Load:\t${Math.ceil(colLoad / 1000)} Kips`, '',
    '## Structure Details:',
    '- Includes standard tubular columns with base plates sized to minimize foundation loading',
    '- Standard structural WF beam frame design with bolted connections on all columns and crossmembers',
    bracing === 'knee' ? '- Knee bracing package included (details to be included in approval drawings)' : bracing === 'x' ? '- X-bracing package included (details to be included in approval drawings)' : bracing === 'building' ? '- Structure braced: lateral loads transferred to the existing building structure (customer accepts)' : '- No bracing: customer requires this mezzanine to be unbraced (customer accepts)',
    '- PWI packages include all anchoring and assembly hardware',
    `- All structural steel will be industrial coated ${custom ?? (primer ? 'Gray (primer)' : 'Gray')}`, '- Includes rated capacity decals',
    ...(s.stamped ? ['- Approval drawings stamped by a licensed P.E.'] : []), '',
    '## Supplied Component Breakdown:', ...deckLines[deck],
    ...(guardFt > 0 ? [`- Guardrail Package: 42" tubular guardrail system with mid-rail and toe-kick (${gType === 'ibc' ? 'IBC' : 'OSHA'} approved design), ${Math.ceil(guardFt * n)} linear ft, Spark Orange industrial coating`] : []),
    ...(stairs > 0 ? [`- Stairway Package: (${stairs * n}) - StairZone ${s.stairType ?? 'straight'} industrial steel stairway, height ${hgt(s.deckHeightFt)}, Type C railing, Spark Orange industrial coating`, '-- Customer is responsible to confirm local code compliance'] : []),
    ...gates.map(g => `- Access Gate: (${g.qty * n}) - ${((M.gates as any)[g.type] ?? [g.type])[0]}`), '',
    ...(s.install ? ['## Installation', '- Complete installation by PWI crew, including layout, anchoring, structure, decking, flooring, guardrail and accessories', ''] : ['## Shipping', '- Ship only — installation by others', '']),
    '[image:mezzanine]',
  ].join('\n');
  return { lines: K.lines, assumptions: A, notes: K.notes, blockers: K.blockers, wording, preUse: 0, suggestedInstallHours: Math.round(K.site * 10) / 10, smtShopHours: K.smtShopHours,
    outboundFreight: K.freight, tons: K.lbs / 2000, job: { ...job, workHrs: K.workHrs }, geometry: { cols, headers, cms, col, hdr, cm, colSpacing: +colSpacing.toFixed(1), crossSpan: +crossSpan.toFixed(1), colLoad: Math.round(colLoad) } };
}
