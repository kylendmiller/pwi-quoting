// Golden-layout test: renders sold quote 29140 with the app's PDF template and compares
// every text line's position and font to the PDF PWI actually sent (tests/golden/29140-quote.pdf).
import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { renderToFile } from '@react-pdf/renderer';
import { QuoteDocPdf, registerPdfAssets } from '../app/src/QuotePdf';

it('renders 29140 like the sold quote', async () => {
  registerPdfAssets(process.cwd() + '/app/public/');
  const quote = { customers: { name: 'Anchor Richey EVS' }, contacts: { name: 'Dannie Ritchie' }, project_name: 'FSTRM 2-Ton', job_location: '241 Advent Church RD, Taylorsville NC 28681', job_id: null };
  const rev = { doc_type: 'QUOTATION', rev: 0, locked: true, sent_at: '2026-08-06T15:00:00' };
  const doc: any = { wording: readFileSync('tests/golden/29140-wording.txt', 'utf8'), options: [] };
  const priced: any = { rollup: { quote: { base: 82133.66, installation: 0, freight: 3460, preUse: null, tax: 0, total: 85593.66 } } };
  const out = '/tmp/pdf-29140-ours.pdf';
  await renderToFile(<QuoteDocPdf quote={quote} rev={rev} doc={doc} priced={priced} me={{ full_name: 'Anthony Hochstetler', title: 'Regional Sales / Project Management' }} number="Q-26-0001" />, out);
  const report = execFileSync('python3', ['tests/golden/compare.py', 'tests/golden/29140-quote.pdf', out]).toString();
  console.log(report);
  const worst = Math.max(...[...report.matchAll(/WORST_DY=([\d.]+)/g)].map(m => Number(m[1])));
  const missing = Number(/MISSING=(\d+)/.exec(report)![1]);
  expect(worst).toBeLessThan(3);          // header + closing page within 3 pt; every line same font, size and indent
  expect(missing).toBeLessThanOrEqual(2); // wording may wrap a word differently than Excel
}, 60000);
