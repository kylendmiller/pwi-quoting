// Main Summary rollup: turns category subtotals into the customer price block.
// Reproduces the SMT "Main Summary" + "Quote" price formulas, including the two
// older template variants seen in sold quotes (always-on 1%, tax on everything).

/** Category subtotals, keyed by Main Summary row (D4..D26). */
export type CategoryKey =
  | 'stdParts' | 'vendor' | 'costBased' | 'stairways' | 'structural' | 'concrete' | 'workPlatforms'
  | 'plate' | 'vrc' | 'painting' | 'pmMarketing' | 'cad' | 'engineering' | 'decals' | 'miscSteel'
  | 'ultraLitePcr' | 'stairStringerPcr' | 'xBracing' | 'inboundFreight' | 'travel' | 'equipment'
  | 'shopLabor' | 'onsiteLabor';

export const ROW: Record<CategoryKey, number> = {
  stdParts: 4, vendor: 5, costBased: 6, stairways: 7, structural: 8, concrete: 9, workPlatforms: 10,
  plate: 11, vrc: 12, painting: 13, pmMarketing: 14, cad: 15, engineering: 16, decals: 17, miscSteel: 18,
  ultraLitePcr: 19, stairStringerPcr: 20, xBracing: 21, inboundFreight: 22, travel: 23, equipment: 24,
  shopLabor: 25, onsiteLabor: 26,
};

export interface RollupInput {
  categories: Partial<Record<CategoryKey, number>>;
  /** Hidden 1% adder (C column). 'switchable' honours onePctOff; 'always' = older template. */
  onePct: { mode: 'switchable' | 'always'; off: boolean };
  dealerDiscount: number;           // E29, fraction (0.1 = 10%)
  outboundFreight: number;          // D33
  preUse: number;                   // D34
  showPreUse: boolean;              // Main Summary A41 option
  tax: { on: boolean; rate: number; base: 'materials' | 'all' };
}

export interface RollupResult {
  onePct: number;                   // C27 / C31
  basePrice: number;                // D31
  installation: number;             // D32
  outboundFreight: number;          // D33
  preUse: number;                   // D34
  salesTax: number;                 // D35
  totalDirect: number;              // D36
  dealerBase: number;               // E31
  dealerTax: number;                // E35
  quote: { base: number; installation: number; freight: number; preUse: number | null; tax: number; total: number };
}

// rows that carry the hidden 1% (template C4..C22 and C25)
const ONE_PCT_ROWS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 25];
const BASE_ROWS = [...Array.from({ length: 19 }, (_, i) => i + 4), 25];          // D4:D22, D25
const DEALER_DISCOUNTED_ROWS = [4, ...Array.from({ length: 16 }, (_, i) => i + 6), 25]; // D4, D6:D21, D25

export function rollup(i: RollupInput): RollupResult {
  const d = (row: number) => {
    const key = (Object.keys(ROW) as CategoryKey[]).find(k => ROW[k] === row);
    return key ? i.categories[key] ?? 0 : 0;
  };
  const onePctOn = i.onePct.mode === 'always' || !i.onePct.off;
  const onePct = onePctOn ? ONE_PCT_ROWS.reduce((s, r) => s + d(r) * 0.01, 0) : 0;
  const basePrice = BASE_ROWS.reduce((s, r) => s + d(r), 0) + onePct;
  const installation = (d(23) + d(24) + d(26)) * 1.01;   // the SMT applies 1.01 here unconditionally
  const taxBaseDirect = i.tax.base === 'all' ? basePrice + i.outboundFreight + installation + i.preUse : basePrice + i.outboundFreight;
  const salesTax = i.tax.on ? taxBaseDirect * i.tax.rate : 0;
  const totalDirect = basePrice + installation + i.outboundFreight + i.preUse + salesTax;

  const disc = i.dealerDiscount;
  // E31 reproduces the SMT exactly, which drops the 1% when a dealer discount is used (known SMT quirk).
  const dealerBase = disc > 0 ? DEALER_DISCOUNTED_ROWS.reduce((s, r) => s + d(r), 0) * (1 - disc) + d(5) + d(22) : 0;
  const dealerTax = i.tax.on && disc > 0 ? (dealerBase + i.outboundFreight) * i.tax.rate : 0;

  const qBase = disc > 0 ? dealerBase : basePrice;
  const qTax = disc > 0 ? dealerTax : salesTax;
  const qPre = i.showPreUse ? i.preUse : null;
  return {
    onePct, basePrice, installation, outboundFreight: i.outboundFreight, preUse: i.preUse, salesTax, totalDirect,
    dealerBase, dealerTax,
    quote: { base: qBase, installation, freight: i.outboundFreight, preUse: qPre, tax: qTax,
             total: qBase + installation + i.outboundFreight + (qPre ?? 0) + qTax },
  };
}
