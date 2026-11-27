// A spec handed over by Claude (link or paste) waits here until the rep creates the quote.
// localStorage so it survives the sign-in email opening a new tab. Expires after a day.
// It is also saved to quoting.waiting_quotes once the rep is signed in, so it shows as
// "Waiting to be built" on every device (rep + managers) until it is built or removed.
import { parseSpec, type QuoteSpec } from '../../src/engine/buildSpec';
import { supabase } from './supabase';
import { describe } from './model';

const KEY = 'pwi_pending_spec';
type Local = { at: number; spec: QuoteSpec; wid?: string };
const read = (): Local | null => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return v && Date.now() - v.at <= 86_400_000 ? v : null;
  } catch { return null; }
};

export function capturePending(text: string): QuoteSpec {
  const spec = parseSpec(text);                     // throws if it isn't a spec
  localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), spec }));
  return spec;
}
/** Load a saved waiting job into this device so New quote builds it. */
export function usePendingFromWaiting(spec: QuoteSpec, wid: string) {
  localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), spec, wid }));
}
export function getPending(): QuoteSpec | null { return read()?.spec ?? null; }
export const pendingWaitingId = () => read()?.wid ?? null;
export const clearPending = () => localStorage.removeItem(KEY);

/** Call once at startup: a #/new?s=… link is stored and the hash cleaned up. */
export function captureFromUrl() {
  if (/^#\/new\?s=/.test(location.hash)) {
    try { capturePending(location.hash); } catch { /* bad link: NewQuote shows nothing pending */ }
    history.replaceState(null, '', '#/new');
  }
}

function hash(s: string) {
  let h1 = 0x811c9dc5, h2 = 5381;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = (Math.imul(h2, 33) + c) | 0; }
  return (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16);
}
export const specSummary = (spec: QuoteSpec) =>
  [spec.customer?.name, spec.project || (spec.items ?? []).map((it: any) => describe(it)).join('; ')].filter(Boolean).join(' · ').slice(0, 300);

/** Once signed in: save this device's pending spec to the waiting list (once per job per rep). */
export async function syncPending(userId: string) {
  const p = read();
  if (!p || p.wid) return;
  const spec_hash = hash(JSON.stringify(p.spec));
  const { data: ex } = await supabase.from('waiting_quotes').select('id').eq('created_by', userId).eq('spec_hash', spec_hash).maybeSingle();
  let wid = ex?.id as string | undefined;
  if (!wid) {
    const { data, error } = await supabase.from('waiting_quotes').insert({ spec: p.spec, spec_hash, summary: specSummary(p.spec) }).select('id').single();
    if (error) return;
    wid = data.id;
  }
  const cur = read();
  if (cur && JSON.stringify(cur.spec) === JSON.stringify(p.spec)) localStorage.setItem(KEY, JSON.stringify({ ...cur, wid }));
}

export async function markWaiting(wid: string | null, change: { built_quote_id?: string; dismissed?: boolean }) {
  if (!wid) return;
  const { data: s } = await supabase.auth.getSession();
  const uid = s.session?.user.id ?? null, now = new Date().toISOString();
  const up = change.built_quote_id ? { built_quote_id: change.built_quote_id, built_at: now, built_by: uid } : { dismissed_at: now, dismissed_by: uid };
  await supabase.from('waiting_quotes').update(up).eq('id', wid);
}
