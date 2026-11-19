// A spec handed over by Claude (link or paste) waits here until the rep creates the quote.
// localStorage so it survives the sign-in email opening a new tab. Expires after a day.
import { parseSpec, type QuoteSpec } from '../../src/engine/buildSpec';

const KEY = 'pwi_pending_spec';
export function capturePending(text: string): QuoteSpec {
  const spec = parseSpec(text);                     // throws if it isn't a spec
  localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), spec }));
  return spec;
}
export function getPending(): QuoteSpec | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (!v || Date.now() - v.at > 86_400_000) return null;
    return v.spec;
  } catch { return null; }
}
export const clearPending = () => localStorage.removeItem(KEY);

/** Call once at startup: a #/new?s=… link is stored and the hash cleaned up. */
export function captureFromUrl() {
  if (/^#\/new\?s=/.test(location.hash)) {
    try { capturePending(location.hash); } catch { /* bad link: NewQuote shows nothing pending */ }
    history.replaceState(null, '', '#/new');
  }
}
