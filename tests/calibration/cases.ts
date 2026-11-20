// Calibration cases: each sold job (fixtures/) whose product has a builder, re-spec'd from the
// fixture's own geometry (wording General Specs + Structural/Vendor tabs) the way a rep would say it.
// `outlier` jobs are priced and reported but kept out of the product averages used for tuning
// (custom scope the builder can't know about). `skip` lists jobs with no matching builder.
export interface CalCase {
  job: string;
  product: string;                       // BUILDERS key of the main item
  items: any[];                          // spec items (buildFromSpec)
  note?: string;                         // what the spec had to approximate
  outlier?: string;                      // why this job is kept out of tuning averages
}

export const CASES: CalCase[] = [
  // ------------------------------------------------------------------ freestanding (FSTR)
  { job: '29140', product: 'freestanding', items: [{ type: 'freestanding', series: 'M', runwayOalFt: 80, spanFt: 37, capacityTons: 2, hookHeightFt: 13.58, columnsPerSystem: 8, bridgeDrive: 'motorized', voltage: '208V/3', control: 'radio', collisionAvoidance: true, install: false, miles: 616 },
    { type: 'catalog', item: 'travel-time', description: 'Travel time (cost based on sold quote)', unitPrice: 3750, qty: 1 }],
    note: 'Sold quote carried a $3,750 travel-time line in Cost Based; added as a line.' },
  { job: '29213', product: 'freestanding', items: [{ type: 'freestanding', series: 'GM', runwayOalFt: 20.67, spanFt: 7.29, capacityTons: 1, hookHeightFt: 8, columnsPerSystem: 4, bridgeDrive: 'motorized', voltage: '460V/3', control: 'radio', install: true, miles: 660 }] },
  { job: '29354', product: 'freestanding', items: [{ type: 'freestanding', series: 'GM', runwayOalFt: 124, spanFt: 43.5, capacityTons: 10, hookHeightFt: 15, liftFt: 26, columnsPerSystem: 12, bridgeDrive: 'motorized', voltage: '460V/3', control: 'radio', asceRail: true, install: true, miles: 733 }],
    note: 'Sold with a Street ZX 10 t hoist; builder prices Starke SMW.' },
  { job: '29331', product: 'freestanding', items: [{ type: 'freestanding', series: 'GM', runwayOalFt: 384, spanFt: 50, capacityTons: 10, hookHeightFt: 19.5, liftFt: 20, columnsPerSystem: 30, bridgesPerSystem: 2, bridgeDrive: 'motorized', voltage: '460V/3', control: 'radio', collisionAvoidance: true, asceRail: true, install: true, miles: 1101 }],
    note: 'Runway is 208\' at 10 t + 176\' at 5 t and one bridge is 5 t; spec\'d all at 10 t.' },
  { job: '29523', product: 'freestanding', items: [{ type: 'freestanding', series: 'GM', runwayOalFt: 116, spanFt: 19.92, capacityTons: 5, hookHeightFt: 14, liftFt: 20, columnsPerSystem: 8, bridgesPerSystem: 2, doubleGirder: true, bridgeDrive: 'motorized', voltage: '460V/3', control: 'radio', collisionAvoidance: true, asceRail: true, install: true, miles: 900 },
    { type: 'catalog', item: 'interlock', description: 'Bridge interlock system (sold cost line)', unitPrice: 32500, qty: 1 }],
    note: '~58\' bays with W27x194 runways on stools + RT headers; $32.5k interlock added as a line.', outlier: 'Custom header/stool frame and 58\' runway bays — not the standard FSTR layout.' },
  { job: '28640', product: 'freestanding', items: [{ type: 'freestanding', series: 'M', runwayOalFt: 38, spanFt: 15, capacityTons: 2, overallHeightFt: 11, liftFt: 8, columnsPerSystem: 6, bridgeDrive: 'motorized', voltage: '460V/3', control: 'radio', install: true, miles: 120 }],
    note: 'AQT quote (base from the AQT price block; no steel repricing).' },
  { job: '27678', product: 'freestanding', items: [
    { type: 'freestanding', series: 'M', runwayOalFt: 40, spanFt: 19, capacityTons: 1, hookHeightFt: 9, liftFt: 10, columnsPerSystem: 4, bridgeDrive: 'motorized', voltage: '460V/3', control: 'radio', install: false },
    { type: 'freestanding', series: 'UL', runwayOalFt: 35.5, spanFt: 6, capacityTons: 0.5, hookHeightFt: 9, liftFt: 10, columnsPerSystem: 4, bridgeDrive: 'manual', voltage: '460V/3', install: false }],
    note: 'Two systems (1 t motorized 19\'×40\', ½ t Ultralite 6\'×35\'6") sharing 4 columns with the building.', outlier: 'Only 4 columns for two systems (partly building-supported).' },
  { job: '28342', product: 'freestanding', items: [{ type: 'freestanding', series: 'HL', hanging: 'underhung', runwayOalFt: 31.5, spanFt: 18, capacityTons: 1, overallHeightFt: 16, liftFt: 15, columnsPerSystem: 6, bridgesPerSystem: 2, bridgeDrive: 'manual', voltage: '460V/3', install: false }],
    outlier: 'HyperLite enclosed-track (S400) system — the builder has no enclosed-track parts.' },

  // ------------------------------------------------------------------ bridge (building runway / crane columns / bridge only)
  { job: '28192', product: 'bridge', items: [{ type: 'bridge', support: 'crane_columns', runwayOalFt: 80, spanFt: 40, capacityTons: 10, hookHeightFt: 12, liftFt: 20, columnsPerSystem: 10, motorized: true, voltage: '460V/3', control: 'radio', asceRail: true, install: true, miles: 300 },
    { type: 'catalog', item: 'gantry', description: 'Motorized gantry crane (bought-in, sold cost line)', unitPrice: 44296, qty: 2 }],
    note: 'Two bought-in motorized gantries ($45,200 −2%) added as catalog lines.' },
  { job: '28426', product: 'bridge', items: [{ type: 'bridge', support: 'bridge_only', runwayOalFt: 144, runwayElectrification: true, asceRail: true, spanFt: 44.08, capacityTons: 4, hookHeightFt: 14, liftFt: 20, motorized: true, voltage: '460V/3', control: 'radio', install: true, miles: 150 }],
    note: 'Bridge only on customer runway; new 30# rail (288\') + 145\' runway conductor bar.' },
  { job: '29562', product: 'bridge', items: [{ type: 'bridge', support: 'bridge_only', runwayOalFt: 225, runwayElectrification: true, spanFt: 70, capacityTons: 10, hoistsPerBridge: 2, hookHeightFt: 20, liftFt: 20, motorized: true, voltage: '460V/3', control: 'radio', collisionAvoidance: true, install: true, miles: 400 }],
    note: 'Box girder (189 plf) bridge, 2 hoists; 225\' 120 A runway bar. The 125\' runway completion package (40# rail) is not spec\'d.' },

  // ------------------------------------------------------------------ mezzanine
  { job: '28527', product: 'mezzanine', items: [{ type: 'mezzanine', lengthFt: 27.67, widthFt: 23.83, deckHeightFt: 9.52, liveLoadPsf: 125, deck: 'bdeck_advantech', guardrailFt: 50, gates: [{ type: 'manual_rolling', qty: 1 }], bracing: 'knee', install: false }],
    note: 'Sold with 2 columns + wall ledger; builder grids freestanding.' },
  { job: '27893', product: 'mezzanine', items: [{ type: 'mezzanine', lengthFt: 70.52, widthFt: 18.48, deckHeightFt: 13.33, liveLoadPsf: 40, deck: 'none', guardrailFt: 0, bracing: 'none', primerOnly: true, install: true, miles: 250 }],
    note: 'AVM structure package (members sized by AVM; 340 psf total load) — frame only.', outlier: 'Customer-engineered (AVM) equipment frame: headers only, no crossmember grid or deck.' },
  { job: '27793', product: 'mezzanine', items: [{ type: 'mezzanine', lengthFt: 60.92, widthFt: 58.17, deckHeightFt: 19.5, liveLoadPsf: 35, deck: 'none', guardrailFt: 0, bracing: 'none', primerOnly: true, install: true, miles: 250 },
    { type: 'catalog', item: 'joists', description: 'Mezzanine joists + connection allowance (sold cost lines)', unitPrice: 9377, qty: 1 }],
    note: 'AVM roof-type structure package (20 psf LL → spec\'d at the 35 psf minimum); joists bought in.', outlier: 'Customer-engineered (AVM) roof structure on bought-in joists, not a mezzanine floor.' },

  // ------------------------------------------------------------------ gantry
  { job: '28884', product: 'gantry', items: [
    { type: 'gantry', capacityTons: 5, spanFt: 58, heightUnderBeamFt: 17.92, hookHeightFt: 15.67, hoists: 2, liftFt: 20, motorized: true, voltage: '460V/3', control: 'radio', floorTrackFt: 85, colors: { gantry: 'White RAL 9003' }, install: true, miles: 200 },
    { type: 'gantry', capacityTons: 5, spanFt: 48, heightUnderBeamFt: 18.17, hookHeightFt: 15.92, hoists: 2, liftFt: 20, motorized: true, voltage: '460V/3', control: 'radio', floorTrackFt: 60, colors: { gantry: 'White RAL 9003' }, install: true, miles: 200 }],
    note: 'Two gantries (58\' and 48\'), 2 × 3 t hoists each; sold quote deducted cord reels and InMotion radios ($6.7k).' },

  // ------------------------------------------------------------------ monorail
  { job: '29061', product: 'monorail', items: [{ type: 'monorail', lengthFt: 45, capacityTons: 1.5, support: 'freestanding', frame: 'single_post', overallHeightFt: 20, hoists: 3, trolley: 'manual', electrification: 'conductor', voltage: '460V/3', control: 'radio', install: false }],
    note: 'No hoists/trolleys (customer supplied components).' },
  { job: '27952', product: 'monorail', items: [
    { type: 'monorail', systems: 2, lengthFt: 121, capacityTons: 1, support: 'freestanding', frame: 'goal_post', frameWidthFt: 10.3, overallHeightFt: 20, hookHeightFt: 16.92, liftFt: 20, hoists: 1, trolley: 'manual', voltage: '460V/3', control: 'pendant', install: false },
    { type: 'monorail', systems: 2, lengthFt: 75, capacityTons: 1, support: 'freestanding', frame: 'goal_post', frameWidthFt: 10.6, overallHeightFt: 20, hookHeightFt: 16.92, liftFt: 20, hoists: 1, trolley: 'motorized', voltage: '460V/3', control: 'pendant', install: false },
    { type: 'jib', capacityTons: 0.5, spanFt: 15, heightUnderBoomFt: 10, mount: 'foundationless', rotation: 180, voltage: '460V/3', install: false }],
    note: 'Two dual-parallel monorails on shared goal-post frames (121\' and 75\') + a HyperLite jib (bought in at $5,586).' },

  // ------------------------------------------------------------------ jib
  { job: '28728', product: 'jib', items: [{ type: 'jib', qty: 2, capacityTons: 0.25, spanFt: 11, overallHeightFt: 13.75, mount: 'foundationless', rotation: 360, liftFt: 15, voltage: '460V/3', install: false },
    { type: 'catalog', item: 'spreader', description: 'Below-the-hook spreader bar (sold cost line)', unitPrice: 10604, qty: 1 }],
    note: 'HyperLite jibs were bought in ($5,415 each website price) with CM hoists; spreader bar added as a line.', outlier: 'Bought-in HyperLite jibs (no PWI fabrication).' },
];

/** Sold jobs in fixtures/ with no matching builder (or not a sold product quote). */
export const SKIPPED: [string, string][] = [
  ['27490', 'Blank Sales Main Template'], ['27654', 'Stair tread replacement parts'], ['27815', 'Collision avoidance parts only'],
  ['27914', 'Columns + crossmember structures (no product builder)'], ['28193', 'Installation only'], ['28299', 'AERO work cells (catalog pass-through)'],
  ['28390', 'AERO work cells (catalog pass-through)'], ['29035', 'AERO work cells (catalog pass-through)'], ['28938', 'AERO end stop kit'],
  ['28594', 'Engineering only'], ['28867', '300 series track parts'], ['28952', 'End truck weldments'], ['29137', 'Sliding deck plates'],
  ['29237', 'Runway extension'], ['28937', 'Ultralite crane bought in as one cost line (FC #55764)'], ['29181', 'Bridge components only (no girder / fab)'],
  ['28670', 'Custom modular box-girder crane (R&D, engineering hours)'], ['28970', '25 t double-girder bridges — above builder range (20 t)'],
  ['27660', 'Barnhart 16 t / 40 t custom monorail structures'], ['28953', 'Barnhart 16 t / 40 t custom monorail structures'],
  ['27823', '22,000 sq ft mezzanine on a bought-in joist package (NMBS) with structure by others'],
  ['28323', '7-system multi-bay crane package (not modeled yet)'], ['28723', 'Runway completion + 6 double-girder box bridges (not modeled yet)'],
  ['28738', 'Work platform (see work_platform builder)'],
  ['28772', '2 building runways, 5 bridges + 8 wall jibs (not modeled yet)'],
  ['29629', 'AQT template — no sold price'], ['27685', 'AQT template — no sold price'], ['28726', 'AQT template — no sold price'], ['28083', 'AQT template — no sold price'],
  ['28893', 'AQT template — no sold price'], ['28013', 'AQT template — no sold price'], ['28945', 'AQT template — no sold price'],
];
