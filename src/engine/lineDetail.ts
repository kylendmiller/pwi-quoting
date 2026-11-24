// Structured per-line data for the quote editor (round 3, builder C).
// Every auto-built QuoteLine can carry:
//   role   — what the line IS on the job (column, runway, girder, hoist, anchor, install, …)
//   item   — which spec item it belongs to (index into spec.items; -1 = shared across the job)
//   group  — human label for that item ("Item 1 (Bay A) — bridge", "Shared trip")
//   basis  — WHY it was chosen (chart + row, calc + unity, rule, catalog, assumption id)
//   detail — the numbers behind the price, typed per kind (steel lb/ft, plate t×w×l, vendor discounts, labor op/factor, …)
// All optional: hand-typed lines and quotes saved before round 3 have none of them, and nothing
// prices off these fields — priceManual() still uses only qty / unitCost / markupPct / unitSell.
// Per-each values only: totals (lb, hours, $) are always derived from the line's CURRENT qty, so a
// rep editing qty keeps the totals right; sectionize() flags when an edit no longer matches the build.

export type Role =
  // structural / plate members
  | 'column' | 'runway' | 'girder' | 'beam' | 'header' | 'crossmember' | 'brace' | 'mast' | 'boom' | 'arm' | 'bracket'
  | 'truss' | 'tower' | 'platform' | 'end_truck_weldment' | 'track'
  | 'base_plate' | 'cap_plate' | 'gusset' | 'stiffener' | 'connection_plate'
  // bought / standard items
  | 'hoist' | 'end_truck' | 'control_panel' | 'radio' | 'collision_avoidance' | 'electrification' | 'end_stop'
  | 'anchor' | 'bolt' | 'rail' | 'deck' | 'guardrail' | 'gate' | 'stair' | 'decal' | 'casters' | 'vrc' | 'fall_protection'
  | 'hardware' | 'option'
  // services
  | 'paint' | 'shop_labor' | 'install' | 'mobilization' | 'travel_time' | 'lodging' | 'per_diem' | 'airfare' | 'rental_car' | 'tool_return'
  | 'lift' | 'telehandler' | 'forklift' | 'generator' | 'equipment' | 'rental_delivery' | 'pm' | 'cad' | 'pe'
  | 'freight_in' | 'other';

export type BasisSource =
  | 'chart'        // read off a sizing chart (AQT, PWI bridge chart, Gantry tab, mezzanine column table)
  | 'calc'         // sized by a calculation (deflection / bending) — carries unity
  | 'rule'         // a calibrated SMT rule in rules/*.json (labor op, crew size, paint run, anchors per column)
  | 'catalog'      // a price-list pick (smallest stocked hoist ≥ capacity, end truck wheelbase, …)
  | 'spec'         // straight from what the rep asked for
  | 'fixed';       // fixed per-unit amount on an SMT product tab (work platform per set, VRC model)

export interface Basis {
  source: BasisSource;
  text: string;                 // plain-English one-liner for the editor
  chart?: string;               // e.g. 'PWI bridge chart (motor)', 'AQT runway_by_bay'
  row?: string;                 // e.g. '5 t × 40\' span'
  unity?: number;               // governing demand / capacity for calc-sized members (PWI max 0.98)
  checks?: { name: string; unity: number }[];   // every check that went into `unity`
  assumption?: string;          // Assumption.field this line hangs on (resolve with doc.assumptions + line.item)
  flag?: string;                // reviewer attention (past chart, unity > 0.98, engineering to confirm)
}

/** Price source for steel $/lb: the dated steel_cost setting, else the catalog row. */
export type CostSource = 'steel_cost' | 'catalog';

export type LineDetail =
  | { type: 'steel'; shape: string; lengthFt: number; lbPerFt: number; lbEach: number; priceGroup?: string; costPerLb: number; costSource: CostSource; steelCostDate?: string; paintUnitsEach: number }
  | { type: 'plate'; tIn: number; wIn: number; lIn: number; lbPerIn3: number; dropFactor: number; lbEach: number; costPerLb: number; costSource: CostSource; steelCostDate?: string }
  | { type: 'box'; plf: number; lengthFt: number; fabFactor: number; lbEach: number; costPerLb: number; costSource: CostSource; steelCostDate?: string; paintUnitsEach: number }
  | { type: 'std'; sellEach: number; builtHrsEach: number }
  | { type: 'vendor'; vendor: string; part: string; partDescription: string; list: number; pwiDiscPct: number; customerDiscPct: number; costEach: number; sellEach: number }
  | { type: 'cost'; costEach: number; markupPct: number }
  | { type: 'sell'; sellEach: number }
  | { type: 'paint'; run: 'standard' | 'custom' | 'primer' | 'flat'; pieceUnits: number; piecesPerRun: number; runRate: number; minRuns?: number; colorLabel?: string }
  | { type: 'labor'; where: 'shop' | 'site'; op: string; smtRow?: string; baseHrs: number; factor: number; factorName: 'production' | 'install'; hours: number; scheduleOnly?: boolean }
  | { type: 'travel'; what: 'travel_time' | 'hotel' | 'per_diem' | 'flight' | 'rental_car' | 'tool_return'; mode: 'drive' | 'fly' | 'local'; men: number; crewDays: number; tripDays?: number; nights?: number; miles: number; rate?: number; markupPct?: number; driveMph?: number; builtCrewDays?: number /* set only when spec installDays overrides the builder's days */ }
  | { type: 'equipment'; item: string; purpose: 'lift' | 'handler' | 'generator' | 'extra' | 'delivery'; period: 'day' | 'week' | 'month'; crewDays: number; builtCrewDays?: number; weeks: number; rates?: { daily: number; weekly: number; monthly: number }; markupPct: number; why?: string }
  | { type: 'pmcad'; what: 'pm' | 'cad'; method: 'power_law' | 'fixed'; driverDollars?: number; k?: number; exp?: number; mult?: number; share?: number; rate?: number; min?: number; hours: number }
  | { type: 'pe'; hours: number };

export type DetailType = LineDetail['type'];

/** Role from a builder's line description, for lines the builder didn't tag explicitly.
 *  Order matters: plate parts ('Runway seat brackets') before the member they hang on ('Runways'). */
export function roleOf(desc: string, category?: string): Role {
  const d = desc.toLowerCase();
  if (category === 'painting') return 'paint';
  if (category === 'decals') return 'decal';
  if (category === 'inboundFreight') return 'freight_in';
  if (/travel time/.test(d)) return 'travel_time';
  if (/floor track/.test(d)) return 'track';
  if (/crane rail/.test(d)) return 'rail';
  if (/end stop/.test(d)) return 'end_stop';
  if (/guardrail|handrail|toe ?plate|kick ?plate/.test(d)) return 'guardrail';
  if (/base ?plate/.test(d)) return 'base_plate';
  if (/top plate|cap plate|chamfer plate/.test(d)) return 'cap_plate';
  if (/gusset/.test(d)) return 'gusset';
  if (/stiffener/.test(d)) return 'stiffener';
  if (/splice|end plate|knife plate|shear tab|tie-back clip|mount to|brace to column|bracket plate/.test(d)) return 'connection_plate';
  if (/bracket/.test(d)) return 'bracket';
  if (/caster plate weldment/.test(d)) return 'end_truck_weldment';
  if (/caster|drive wheel/.test(d)) return 'casters';
  if (/girder/.test(d)) return 'girder';
  if (/runway electrification|electrification|collector|festoon|slip ring/.test(d)) return 'electrification';
  if (/runway/.test(d)) return 'runway';
  if (/column|riser/.test(d)) return 'column';
  if (/monorail beam/.test(d)) return 'beam';
  if (/header/.test(d)) return 'header';
  if (/crossmember/.test(d)) return 'crossmember';
  if (/brac|knee/.test(d)) return 'brace';
  if (/\bmast\b/.test(d)) return 'mast';
  if (/\bboom\b/.test(d)) return 'boom';
  if (/cantilever arm/.test(d)) return 'arm';
  if (/end truck/.test(d)) return 'end_truck';
  if (/anchor/.test(d)) return 'anchor';
  if (/\bjib .*kit\b/.test(d)) return 'hardware';
  if (/bolt|drop rod|screws|pins and shots|shims|saddle clip/.test(d)) return 'bolt';
  if (/deck|advantech|resindek|grating|tread plate/.test(d)) return 'deck';
  if (/gate/.test(d)) return 'gate';
  if (/stair/.test(d)) return 'stair';
  if (/radio|pairing/.test(d)) return 'radio';
  if (/pendant|control panel|\bscp-/.test(d)) return 'control_panel';
  if (/collision/.test(d)) return 'collision_avoidance';
  if (/hoist|\bst[kw]\d|\bsmw\d/.test(d)) return 'hoist';
  if (/tower/.test(d)) return 'tower';
  if (/truss|chord|runner/.test(d)) return 'truss';
  if (/track/.test(d)) return 'track';
  if (/vrc|lift model|pwsd/.test(d)) return 'vrc';
  if (/srl|lifeline|harness|anchorpoint|fall/.test(d)) return 'fall_protection';
  return 'other';
}

/** Role for a vendor line from its Starke part number. */
export function vendorRole(part: string, description = ''): Role {
  const p = part.toUpperCase();
  if (/^ST[KW]|^SMW/.test(p)) return 'hoist';
  if (/^STT|^SCU/.test(p)) return 'end_truck';
  if (/^SCP/.test(p)) return 'control_panel';
  if (/^S80\d/.test(p)) return 'radio';
  if (/^SCA/.test(p)) return 'collision_avoidance';
  return roleOf(`${part} ${description}`, 'vendor');
}

/** SMT Labor tab block a builder's shop labor lands in (reference/smt_tabs/Labor.txt). */
export function smtLaborBlock(family: string): { block: string; handlingRow: string } {
  if (family === 'mezzanine') return { block: 'Labor B24:B35 Mezzanine Labor', handlingRow: 'Labor A33 Suggested Handling Hours' };
  if (family === 'work_platform') return { block: 'Labor A60:A68 Work Platforms Per Set', handlingRow: 'Labor A67 loading and handling' };
  if (family === 'vrc') return { block: 'Labor A73:A79 VRCs', handlingRow: 'Labor A42 Suggested Handling Hours' };
  if (['freestanding', 'bridge', 'gantry', 'monorail', 'jib'].includes(family)) return { block: family === 'gantry' ? 'Labor B21 AutoCalc Gantry Hours (Gantry!J80)' : 'Labor B9:B21 Crane Labor', handlingRow: 'Labor A18 Suggested Handling Hours' };
  return { block: 'Labor B38:B44 Misc. Labor', handlingRow: 'Labor A42 Suggested Handling Hours' };
}
