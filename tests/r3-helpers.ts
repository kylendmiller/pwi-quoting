// Shared helpers for the round 3 S tests (no tests in here).
import type { QuoteDoc } from '../src/engine/manual';
/** How the app has always set PV hours: every shop hour when the doc family is freestanding. */
export const legacyPv = (d: QuoteDoc) => d.family === 'freestanding' ? d.lines.filter(l => l.kind === 'shop_labor').reduce((s, l) => s + (l.qty || 0), 0) : 0;
