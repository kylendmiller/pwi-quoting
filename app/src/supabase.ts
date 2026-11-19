import { createClient } from '@supabase/supabase-js';

// Public values (safe in the browser). All writes go through the quote-api function.
export const SUPABASE_URL = 'https://kiuwtbizrantrcyybkfw.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_evrkhfsIfEBBZHLlZkiaJA_J_hPzZqb';
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export async function api<T = any>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const { data: s } = await supabase.auth.getSession();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/quote-api`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: SUPABASE_KEY, authorization: `Bearer ${s.session?.access_token ?? ''}` },
    body: JSON.stringify({ action, ...payload }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error ?? `Error ${res.status}`), { body });
  return body as T;
}

export const money = (n: number | null | undefined, cents = false) =>
  n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
