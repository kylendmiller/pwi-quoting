import { useState } from 'react';
import { loadCatalog } from './catalog';
import { buildFromSpec, parseSpec } from '../../src/engine/buildSpec';
import type { QuoteDoc } from '../../src/engine/manual';

/** Paste a Claude spec or link into an existing quote: rebuilds the auto lines, keeps hand-added ones. */
export function ImportSpec({ doc, settings, onApply }: { doc: QuoteDoc; settings: any; onApply: (d: QuoteDoc, header: any, notes: string[]) => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const run = async () => {
    setBusy(true); setErr('');
    try {
      const spec = parseSpec(text);
      const b = buildFromSpec(spec, await loadCatalog(settings), settings, doc);
      onApply(b.doc, { project_name: spec.project, job_location: spec.location }, [...b.blockers, ...b.notes]);
      setText('');
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="card">
      <h3>{doc.spec ? 'Update from Claude' : 'Paste from Claude'}</h3>
      <p className="muted">{doc.spec ? 'Paste a new block or link from Claude to rebuild this quote. Lines you added by hand stay.' : 'Paste the block or link Claude gave you. Every line and the wording fill in.'}</p>
      <textarea rows={3} value={text} onChange={e => setText(e.target.value)} placeholder="Paste here" />
      {err && <div className="banner block">{err}</div>}
      <button disabled={busy || !text.trim()} onClick={run}>{busy ? 'Building…' : 'Build quote'}</button>
    </div>
  );
}
