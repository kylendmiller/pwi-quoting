// Everything the quote-api edge function needs from the engine, built as one ES module and served
// from the Netlify site (/engine/engine-<hash>.mjs). The edge function imports it by URL at deploy
// time, so the deployed function always matches the app's engine byte-for-byte.
export { priceManual, sendBlocked, deriveFamily, pvHours, validateDoc } from '../src/engine/manual';
export { buildFromSpec, ensureRefs } from '../src/engine/buildSpec';
export { stampFromBuild } from '../src/engine/stamp';
export { readSteelCost } from '../src/engine/kit';
export { loadCatalog } from '../src/engine/catalogLoader';
export { deltaDoc, reviseStatus } from '../src/engine/changeOrder';
export { parseSpec } from '../src/engine/buildSpec';
export { parseRfqDetails, configuratorSpec, milesFromState, pct } from '../src/engine/rfq';
export { emptyDoc } from '../app/src/model';
export { default as SKILL_MD } from '../skill/pwi-quote/SKILL.md';
