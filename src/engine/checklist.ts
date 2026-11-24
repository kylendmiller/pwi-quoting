// "Before you send" checklist: the numbers most likely to be wrong on a quote. Each item must be ticked
// (doc.checklist) before the quote can be sent — lintWording turns open items into one blocking error,
// so the server enforces it, not just the screen. Items appear only when they apply to this quote.
import type { QuoteDoc } from './manual';

export interface CheckItem { key: string; label: string; detail?: string }
export interface CheckTick { at: string; by?: string }

export function sendChecklist(doc: QuoteDoc): CheckItem[] {
  const lines = doc.lines ?? [];
  const d = (what: string) => lines.find(l => (l.detail as any)?.what === what)?.detail as any;
  const out: CheckItem[] = [];
  const site = lines.some(l => l.kind === 'site_labor');
  const tt = d('travel_time') ?? d('per_diem') ?? d('hotel');
  if (site) out.push({ key: 'onsite', label: 'On-site days and crew size', detail: tt ? `${tt.crewDays} days × ${tt.men} men — does that match similar jobs?` : 'Compare the install hours with similar jobs.' });
  if (tt) out.push({ key: 'travel', label: `Travel: ${tt.mode === 'local' ? 'daily commute' : tt.mode === 'fly' ? 'crew flies' : 'crew drives and stays'}`, detail: `${tt.miles} mi${tt.tripDays ? `, ${tt.tripDays} trip days` : ''} — are the miles real or estimated?` });
  const fl = lines.find(l => (l.detail as any)?.what === 'flight');
  if (fl) out.push({ key: 'airfare', label: /fare table/.test(fl.description) ? 'Airfare (SBN fare table)' : /searched/.test(fl.description) ? 'Airfare (fare entered on the quote)' : 'Airfare — NOT priced from the table (no job state, flat fallback)', detail: `${fl.description.replace(/^Flights /, '')} — right airport for the job?` });
  out.push({ key: 'install', label: 'Installed or ship only — confirmed with the customer' });
  if (doc.spec) out.push({ key: 'specs', label: 'Voltage, heights and dimensions match the customer' });
  out.push({ key: 'freight', label: 'Outbound freight', detail: doc.outboundFreight ? `$${Math.round(doc.outboundFreight).toLocaleString('en-US')}` : 'None on the quote — right?' });
  const rfq = (doc as any).rfq;
  if (rfq?.assumed?.length || doc.assumptions?.length) out.push({ key: 'assumed', label: 'Every assumption reviewed', detail: rfq ? `"Assumed — check these" from ${rfq.number}` : 'The assumptions the builder made' });
  return out;
}

export function openChecklist(doc: QuoteDoc): CheckItem[] {
  const ticks = ((doc as any).checklist ?? {}) as Record<string, CheckTick>;
  return sendChecklist(doc).filter(i => !ticks[i.key]);
}
