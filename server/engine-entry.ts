// Everything the quote-api edge function needs from the engine, built as one ES module and served
// from the Netlify site (/engine/engine-<hash>.mjs). The edge function imports it by URL at deploy
// time, so the deployed function always matches the app's engine byte-for-byte.
export { priceManual, sendBlocked, deriveFamily, pvHours } from '../src/engine/manual';
export { buildFromSpec } from '../src/engine/buildSpec';
export { loadCatalog } from '../src/engine/catalogLoader';
