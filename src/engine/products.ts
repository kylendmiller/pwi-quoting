// Smaller product lines: jib cranes, AnchorPoint fall protection, Apex VRCs, and catalog products
// (frame rotators, below-the-hook devices, AERO work cells, anything in the price lists).
import V from './rules/vrc_rules.json';
import { Kit, check, keep, volt, ftIn, hgt, tons, ixOf, type Catalog, type Factors } from './kit';
import { pickHoist, type BuildResult, type BuildOpts } from './crane';

const result = (K: Kit, wording: string, job: any, geometry: Record<string, number | string> = {}): BuildResult => {
  K.done();
  return { lines: K.lines, assumptions: K.A, notes: K.notes, blockers: K.blockers, wording, preUse: 0, suggestedInstallHours: Math.round(K.site * 10) / 10, smtShopHours: K.smtShopHours,
    outboundFreight: K.freight, tons: K.lbs / 2000, job: { ...job, workHrs: K.workHrs }, geometry };
};
const findStd = (cat: Catalog, q: string) => {
  const all = cat.stdAll?.() ?? [];
  const ql = q.toLowerCase().trim();
  return all.find(x => String(x.part ?? '').toLowerCase() === ql) ?? all.find(x => x.description.toLowerCase() === ql)
    ?? all.find(x => ql.split(/\s+/).every(w => `${x.description} ${String(x.part ?? '')} ${x.info ?? ''}`.toLowerCase().includes(w)));
};
const W_BY_I = ['W6 x 15', 'W8 x 18', 'W8 x 24', 'W10 x 22', 'W10 x 30', 'W12 x 26', 'W12 x 35', 'W14 x 30', 'W14 x 43', 'W16 x 40', 'W16 x 57', 'W18 x 50', 'W18 x 71', 'W21 x 62', 'W21 x 83', 'W24 x 84', 'W24 x 104'];

// ------------------------------------------------------------------------- jib cranes
export interface JibSpec {
  qty?: number; capacityTons: number; spanFt: number; overallHeightFt?: number; heightUnderBoomFt?: number;
  mount?: 'floor' | 'foundationless' | 'wall';
  rotation?: 180 | 270 | 360; hoist?: boolean; trolley?: 'manual' | 'motorized'; liftFt?: number; voltage?: string;
  install: boolean; miles?: number; crewMen?: number; travelMode?: 'drive' | 'fly' | 'local';
}
export function buildJib(spec: JibSpec, cat: Catalog, f: Factors = { production: 0.77, install: 1.25 }, bo: BuildOpts = {}): BuildResult {
  check('capacityTons', spec.capacityTons, 0.125, 5, true); check('spanFt', spec.spanFt, 4, 30, true); check('overallHeightFt', spec.overallHeightFt, 6, 30); check('heightUnderBoomFt', spec.heightUnderBoomFt, 5, 28); check('qty', spec.qty, 1, 20);
  if (spec.install || spec.miles != null) check('miles', spec.miles, 0, 3500, true);
  const s = keep<JibSpec>(spec, ['qty', 'capacityTons', 'spanFt', 'overallHeightFt', 'heightUnderBoomFt', 'mount', 'rotation', 'hoist', 'trolley', 'liftFt', 'voltage', 'install', 'miles', 'crewMen', 'travelMode']);
  const n = s.qty ?? 1, cap = s.capacityTons, mount = s.mount ?? 'floor', v = volt(s.voltage), trolley = s.trolley ?? 'manual';
  const K = new Kit(cat, 'jib', f);
  const hub = s.heightUnderBoomFt ?? (s.overallHeightFt ?? 16) - 1.5, overall = s.overallHeightFt ?? hub + 1.5, hook = hub - 2.5;
  // boom: cantilever, deflection ≤ L/150 at the tip with 1.25× load
  const P = cap * 2000 * 1.25, L = s.spanFt * 12, Ireq = P * L ** 3 / (3 * 29e6 * (L / 150));
  const boom = W_BY_I.find(w => ixOf(w) >= Ireq && cat.shape(w)) ?? 'W24 x 104';
  const mast = cap <= 0.5 ? 'ST 8 x 8 x 1/4' : cap <= 1 ? 'ST 10 x 10 x 3/8' : cap <= 2 ? 'ST 12 x 12 x 3/8' : 'ST 14 x 14 x 3/8';
  K.A.push({ field: 'members', value: `${mast} mast / ${boom} boom`, why: `${tons(cap)} t at ${s.spanFt}' reach, tip deflection ≤ L/150 → ${boom}; mast ${mast} — engineering to confirm`, alt: mount === 'floor' ? 'foundationless' : 'floor' });
  if (mount !== 'wall') K.steel('Jib mast', mast, n, Math.ceil(overall - 1));
  K.steel('Jib boom', boom, n, Math.ceil(s.spanFt + 1));
  if (mount === 'floor') { K.plate('Mast base plate', n, 1.25, 30, 30); K.plate('Base gussets', 8 * n, 0.5, 8, 18); K.std('3/4" Epoxy Anchors', 8 * n); }
  else if (mount === 'foundationless') { K.plate('Foundationless base plate', n, 1, 60, 60); K.plate('Base gussets', 8 * n, 0.5, 10, 24); K.std('3/4" Concrete Wedge Anchor', 16 * n); }
  else { K.plate('Wall / column bracket plates', 2 * n, 1, 18, 24); K.std('3/4" Structural Bolt and Nut', 8 * n); }
  K.std('Jib Hinge Kit', n); K.std('Jib Rod Kit', n); K.std('Jib Stop Kit', n);
  if (s.hoist !== false && (s.rotation ?? (mount === 'wall' ? 180 : 360)) >= 360) K.std('Jib 360° Slip Ring Electrical Assembly', n);
  K.std('Manual Bridge Crane Electrification Package (per foot)', Math.ceil(s.spanFt) * n);
  K.std('PWI HD Adjustable End Stop Kit (slides on Flange)', n);
  const lift = s.liftFt ?? Math.max(10, Math.ceil((hook + 2) / 5) * 5);
  if (s.hoist !== false) { const hp = pickHoist(cat, cap, lift, v.startsWith('460') ? '460V' : '230V', trolley, false); if (hp) K.vend(hp, n); else K.notes.push(`No hoist found for ${cap} t — pick in editor.`); }
  K.paint(0, null);
  K.decal('(11" - 13" tall decals) Manual Crane Decal Set', n);
  K.shop([['Mast fab', mount === 'wall' ? 0 : 6 * n], ['Boom fab', 4 * n], ['After paint assembly', 3 * n]]);
  const job = { workTopFt: overall, heaviestPickLb: (cat.shape(boom)?.lbPerFt ?? 30) * s.spanFt + 400 };
  K.finish({ install: s.install, miles: s.miles ?? 0, crewMen: s.crewMen, travelMode: s.travelMode, skipTravel: bo.skipTravel, ...job,
    site: [{ desc: 'Unload, layout', hours: 4 }, { desc: `Set and anchor jib${n > 1 ? 's' : ''} (${n})`, hours: (mount === 'floor' ? 8 : mount === 'foundationless' ? 6 : 6) * n }, { desc: 'Electrification + hoist', hours: 3 * n }] });
  K.pmCad(0.8, { pm: 8, cad: 6 });
  const wording = [
    `# ${n > 1 ? `(${n}) ` : ''}${mount === 'foundationless' ? 'ULTRALITE FOUNDATIONLESS JIB CRANE SYSTEM' : mount === 'wall' ? 'ULTRALITE WALL MOUNTED JIB CRANE SYSTEM' : 'ULTRALITE JIB CRANE SYSTEM'}`, '', '## General Specs:',
    `- Span:\t${ftIn(s.spanFt)}`, ...(mount !== 'wall' ? [`- Overall Height:\t${hgt(overall)}`] : []), `- Height Under Boom:\t${hgt(hub)}`,
    `- Rated Capacity:\t${tons(cap)} Ton with (1) hoist`, `- System Voltage:\t${v.replace('/3', '/3 phase')}`, '',
    `## (${n}) ${ftIn(s.spanFt)} x ${tons(cap)} Ton Capacity Jib Crane`,
    `- ${s.rotation ?? (mount === 'wall' ? 180 : 360)}° manual rotation`, '- Bolted rotational stop kit',
    mount === 'floor' ? '- Epoxy anchor bolt kit with template (foundation by others per PWI drawing)' : mount === 'foundationless' ? '- Foundationless base plate anchored to a 6" reinforced slab (slab by others)' : '- Wall / column mounting brackets (building to be verified for the loads)',
    ...(s.hoist !== false ? [`- (1) Starke - STK Series ${tons(cap)} ton electric chain hoist`, `-- ${lift}' lift`, `-- ${v.startsWith('460') ? '460V/3ph' : '230V/3ph'}`, `- (1) Starke ${trolley === 'motorized' ? 'motorized' : 'manual'} trolley`] : []),
    '- Festoon electrification system on boom', '- PWI HD end stops', '- Spark Orange industrial coating', '- Rated capacity decals', '',
    ...(s.install ? ['## Installation', '- Complete installation by PWI crew', ''] : ['## Shipping', '- Ship only — installation by others', '']),
    '[image:jib]',
  ].join('\n');
  return result(K, wording, job, { boom, mast });
}

// ------------------------------------------------------------------------- fall protection
export interface FallProtectionSpec {
  systems?: number; lengthFt: number; supportSpacingFt?: number; people?: 1 | 2;
  trolleys?: number; srl?: 20 | 30 | 50; harnesses?: number;
  install: boolean; miles?: number; crewMen?: number; travelMode?: 'drive' | 'fly' | 'local';
}
export function buildFallProtection(spec: FallProtectionSpec, cat: Catalog, f: Factors = { production: 0.7, install: 1.09 }, bo: BuildOpts = {}): BuildResult {
  check('lengthFt', spec.lengthFt, 10, 400, true); check('systems', spec.systems, 1, 20); check('supportSpacingFt', spec.supportSpacingFt, 8, 40);
  if (spec.install || spec.miles != null) check('miles', spec.miles, 0, 3500, true);
  const s = keep<FallProtectionSpec>(spec, ['systems', 'lengthFt', 'supportSpacingFt', 'people', 'trolleys', 'srl', 'harnesses', 'install', 'miles', 'crewMen', 'travelMode']);
  const n = s.systems ?? 1, K = new Kit(cat, 'fall_protection', f);
  const spacing = s.supportSpacingFt ?? 20, truss = spacing > 20 ? 10 : 7;
  const kits = [21, 32, 43, 53].filter(k => truss === 7 || k >= 32);
  let left = s.lengthFt; const used: number[] = [];
  while (left > 0) { const k = kits.find(x => x >= left) ?? kits[kits.length - 1]; used.push(k); left -= k; }
  for (const k of used) {
    const part = `PWFP${truss === 10 ? '10' : '07'}${k}S`;
    const item = findStd(cat, part);
    if (item) K.sell(`AnchorPoint ${k}' single track fall protection truss (${truss}" truss) — ${part}`, n, item.sell, 'stdParts'), K.builtHrs += item.hours * n;
    else K.notes.push(`Standard part not found: ${part}`);
  }
  const splices = used.length - 1;
  if (splices) K.std('Fall Protection Splice Kit', splices * n);
  const drops = (Math.ceil(s.lengthFt / spacing) + 1) * n;
  const drop = findStd(cat, 'Drop Rod Connection'); if (drop) K.sell("Drop rod connection (hardware & clamp, longer than 6')", drops, drop.sell, 'stdParts');
  const people = s.people ?? 2, trolleys = s.trolleys ?? people * n;
  const tr = findStd(cat, 'SFT-400'), srl = findStd(cat, `SRLWR-${s.srl ?? 20}`), har = findStd(cat, 'SDH200-SM/ML/XL');
  if (tr) K.sell('Starke enclosed track fall protection trolley (SFT-400)', trolleys, tr.sell, 'stdParts');
  if (srl) K.sell(`Starke ${s.srl ?? 20}' self retracting lifeline (SRLWR-${s.srl ?? 20})`, trolleys, srl.sell, 'stdParts');
  if (har) K.sell('Starke deluxe body harness (SDH200)', s.harnesses ?? trolleys, har.sell, 'stdParts');
  K.A.push({ field: 'layout', value: used.join("' + ") + "'", why: `${s.lengthFt}' track with supports every ${spacing}' → ${truss}" truss kits ${used.join("' + ")}' (${splices} splice${splices === 1 ? '' : 's'}), ${drops} drop rods` });
  K.shop([['Prep and pack', 2 * n]], { handling: true });
  const job = { workTopFt: 20, heaviestPickLb: 600 };
  K.finish({ install: s.install, miles: s.miles ?? 0, crewMen: s.crewMen, travelMode: s.travelMode, skipTravel: bo.skipTravel, ...job,
    site: [{ desc: 'Unload, layout', hours: 4 }, { desc: `Install drops / braces (${drops})`, hours: 3 * drops }, { desc: `Field splices (${splices * n})`, hours: 3 * splices * n }, { desc: 'Hang track, trolleys and lifelines', hours: 4 * n }] });
  K.pmCad(0.6, { pm: 6, cad: 6 });
  const wording = [
    `# (${n}) - ANCHORPOINT ${ftIn(s.lengthFt)} SINGLE TRACK FALL PROTECTION SYSTEM`, '', '## System Includes:',
    ...used.map(k => `- (1) PWFP${truss === 10 ? '10' : '07'}${k}S PWI single track fall protection truss, ${k}' (engineered system)`),
    '- Spark Orange industrial coating', `- Rated capacity decals - ${people} person`, '- Conforms to OSHA Code 1910.140(c)(13)(i) & 1910.140(c)(13)(ii)',
    '- Safety rated clamp plates and attaching hardware', '- Brackets are designed to attach directly to bar joists or steel building structure', '',
    '## Accessories', `- (${trolleys}) - Starke (SFT-400) fall protection trolley`, `- (${trolleys}) - Starke (SRLWR-${s.srl ?? 20}) ${s.srl ?? 20}' self retracting lifeline`, `- (${s.harnesses ?? trolleys}) - Starke (SDH200) deluxe body harness`, '',
    ...(s.install ? ['## Installation', '- Complete installation by PWI crew', ''] : ['## Shipping', '- Ship only — installation by others', '']),
  ].join('\n');
  return result(K, wording, job, { truss, kits: used.join('+'), drops });
}

// ------------------------------------------------------------------------- VRC
export interface VrcSpec { model: keyof typeof V.models; qty?: number; noPit?: boolean; hdColumns?: boolean; install: boolean; miles?: number; crewMen?: number; travelMode?: 'drive' | 'fly' | 'local' }
export function buildVrc(spec: VrcSpec, cat: Catalog, f: Factors = { production: 0.73, install: 1.02 }, bo: BuildOpts = {}): BuildResult {
  const m = (V.models as any)[spec.model]; if (!m) throw new Error(`Unknown VRC model ${spec.model}. Models: ${Object.keys(V.models).join(', ')}`);
  check('qty', spec.qty, 1, 10); if (spec.install || spec.miles != null) check('miles', spec.miles, 0, 3500, true);
  const n = spec.qty ?? 1, K = new Kit(cat, 'vrc', f);
  const total = (m.total + (spec.noPit ? m.noPitDeduct : 0) + (spec.hdColumns ? m.hdColumns : 0)) * n;
  // SMT VRC tab: 20% of the price is on-site install, the rest is the VRC line (30% shop / 50% components inside it)
  K.sell(`Apex ${spec.model} ${m.name} VRC${spec.noPit ? ' (no pit)' : ''}${spec.hdColumns ? ' with HD columns' : ''}`, n, Math.round((spec.install ? total * 0.8 : total * 0.8) / n * 100) / 100, 'vrc');
  K.smtShopHours = Math.round(total * 0.3 / 100);
  if (spec.install) {
    K.site = Math.round(total * 0.2 / 113 * 10) / 10;
    (K as any).lines.push({ key: `vrc${Date.now()}`, family: 'vrc', kind: 'site_labor', category: 'onsiteLabor', description: `VRC on-site install (SMT: 20% of VRC price)`, qty: K.site, laborOp: 'site_other' });
    K.workHrs = K.site;
    if (!bo.skipTravel) K.travel({ workHrs: K.site, miles: spec.miles ?? 0, workTopFt: 16, heaviestPickLb: 3500, crewMen: spec.crewMen, travelMode: spec.travelMode });
  }
  K.A.push({ field: 'vrcPrice', value: total, why: `${spec.model} list ${m.total}${spec.noPit ? ` − no-pit ${-m.noPitDeduct}` : ''}${spec.hdColumns ? ` + HD columns ${m.hdColumns}` : ''} (SMT VRC tab); 20% is install` });
  const wording = [`# (${n}) - APEX VERTICAL RECIPROCATING CONVEYOR${n > 1 ? 'S' : ''}`, '', `## ${spec.model} — ${m.name}`, ...m.specs.map((x: string) => `- ${x}`),
    ...(spec.noPit ? ['- No-pit design'] : []), ...(spec.hdColumns ? ['- Heavy duty columns'] : []), '',
    ...(spec.install ? ['## Installation', '- Complete installation by PWI crew', ''] : ['## Shipping', '- Ship only — installation by others', '']), '[image:vrc]'].join('\n');
  return result(K, wording, { workTopFt: 16, heaviestPickLb: 3500 }, { total });
}

// ------------------------------------------------------------------------- catalog products
export interface CatalogSpec { item: string; qty?: number; unitPrice?: number; description?: string; installHours?: number; install?: boolean; miles?: number; wording?: string }
export function buildCatalogItem(spec: CatalogSpec, cat: Catalog, f: Factors = { production: 0.76, install: 1 }, bo: BuildOpts = {}): BuildResult {
  check('qty', spec.qty, 1, 500); check('unitPrice', spec.unitPrice, 0, 1e6); check('installHours', spec.installHours, 0, 2000);
  const n = spec.qty ?? 1, K = new Kit(cat, 'other', f);
  const hit = findStd(cat, spec.item);
  const vend = !hit ? cat.vendor(spec.item) : null;
  let title = spec.description ?? spec.item;
  if (hit && spec.unitPrice == null) { title = spec.description ?? `${hit.description}${hit.part ? ` (${hit.part})` : ''}${hit.info ? ` — ${hit.info}` : ''}`; K.sell(title, n, hit.sell, 'stdParts'); K.builtHrs += hit.hours * n; }
  else if (vend && spec.unitPrice == null) { K.vend(spec.item, n); title = spec.description ?? `${vend.vendor} ${spec.item} — ${vend.description}`; }
  else if (spec.unitPrice != null) K.sell(title, n, spec.unitPrice, 'costBased');
  else { K.sell(`${title} — PRICE NEEDED`, n, 0, 'costBased'); K.blockers.push(`"${spec.item}" isn't in the price lists — add unitPrice or edit the line.`); }
  if (K.builtHrs) K.shop([], { handling: true });
  const job = { workTopFt: 12, heaviestPickLb: 500 };
  if (spec.install && spec.installHours) {
    (K as any).lines.push({ key: `cat${Date.now()}`, family: 'other', kind: 'site_labor', category: 'onsiteLabor', description: `Install ${title}`, qty: spec.installHours, laborOp: 'site_other' });
    K.site = spec.installHours; K.workHrs = spec.installHours;
    if (!bo.skipTravel) K.travel({ workHrs: spec.installHours, miles: spec.miles ?? 0, ...job });
  }
  const wording = spec.wording ?? [`# (${n}) - ${title.toUpperCase()}`, ...(spec.install && spec.installHours ? ['- Installed by PWI crew'] : ['- Ship only'])].join('\n');
  return result(K, wording, job);
}
