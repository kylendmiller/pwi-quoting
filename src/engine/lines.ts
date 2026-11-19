// Line calculators. Each one reproduces one row type of the Sales Main Template (SMT)
// exactly, so tier-1 tests can compare against real quotes to the cent.

export interface StructuralInput { qty: number; lengthFt: number; lbPerFt: number; pricePerLb: number; markupPct: number }
export interface StructuralResult { tons: number; cost: number; sell: number }
/** Structural tab: G = B*D*E/2000, H = F*G*2000, I = H*markup/100 + H */
export function structuralLine(i: StructuralInput): StructuralResult {
  const tons = (i.qty * i.lengthFt * i.lbPerFt) / 2000;
  const cost = i.pricePerLb * tons * 2000;
  return { tons, cost, sell: (cost * i.markupPct) / 100 + cost };
}

export interface PlateInput { qty: number; thicknessIn: number; widthIn: number; lengthIn: number; pricePerLb: number; markupPct: number; /** drop/waste factor; current SMT 1.1, older templates 1.0 */ dropFactor?: number }
export interface PlateResult { lbEach: number; tons: number; cost: number; sell: number }
/** Plate tab: G = C*D*E*0.2833*drop (lb each; current SMT drop = 1.1), H = G*B/2000, I = B*G*F, J = I*J4/100 + I */
export function plateLine(i: PlateInput): PlateResult {
  const lbEach = i.thicknessIn * i.widthIn * i.lengthIn * 0.2833 * (i.dropFactor ?? 1.1);
  const cost = i.qty * lbEach * i.pricePerLb;
  return { lbEach, tons: (lbEach * i.qty) / 2000, cost, sell: (cost * i.markupPct) / 100 + cost };
}

/** Box-girder / weldment plate rows: G = PLF weight × length (ft) × 1.03 (drop); then same cost/markup as plate. */
export function plateBoxLine(qty: number, lbPerFt: number, lengthFt: number, pricePerLb: number, markupPct: number, dropFactor = 1.03) {
  const lbEach = lbPerFt * lengthFt * dropFactor;
  const cost = qty * lbEach * pricePerLb;
  return { lbEach, tons: (lbEach * qty) / 2000, cost, sell: (cost * markupPct) / 100 + cost };
}

/** Standard Parts & Products: G = B*F (catalog sell). Mezzanine sections price cost × (1 + markup): G = B*E*(F+1). */
export const stdPartLine = (qty: number, sellEach: number, markup = 0) => qty * sellEach * (1 + markup);

export interface VendorInput { qty: number; listEach: number; pwiDiscountPct: number; customerDiscountPct: number }
/** Hoist & Crane Vendor Items: F = (1-E%)*D, G = F*C, I = (1-H%)*D*C */
export function vendorLine(i: VendorInput) {
  const costEach = (1 - i.pwiDiscountPct * 0.01) * i.listEach;
  return { costEach, cost: costEach * i.qty, sell: (1 - i.customerDiscountPct * 0.01) * i.listEach * i.qty };
}

/** Cost Based Items: D = C*B, F = D*(E/100+1) */
export function costBasedLine(qty: number, costEach: number, markupPct: number) {
  const cost = costEach * qty;
  return { cost, sell: cost * (markupPct / 100 + 1) };
}

/** Labor, Painting, Pre-use: D = rate * qty */
export const rateLine = (qty: number, rate: number) => qty * rate;

/** Travel Costs: E = D*B*(E4/100+1) */
export const travelLine = (qty: number, cost: number, markupPct: number) => cost * qty * (markupPct / 100 + 1);

/** Stairways: F = E*C, H = F*(G/100+1) */
export function stairLine(qty: number, costEach: number, markupPct: number) {
  const cost = costEach * qty;
  return { cost, sell: cost * (markupPct / 100 + 1) };
}

/** Outbound freight (Main Summary T35): ROUNDUP(rate*(1+markup)*(1+surcharge)*miles, -1) * loads */
export function freightQuote(ratePerMile: number, markup: number, surcharge: number, miles: number, loads: number) {
  const raw = ratePerMile * (1 + markup) * (1 + surcharge) * miles;
  return roundUpTo(raw, 10) * loads;
}

/** Excel ROUNDUP to a multiple (away from zero). Guards float noise like 1209.9999999. */
export function roundUpTo(x: number, step: number) {
  const q = x / step;
  const r = Math.round(q);
  const n = Math.abs(q - r) < 1e-9 ? r : Math.sign(q) * Math.ceil(Math.abs(q));
  return n * step;
}
