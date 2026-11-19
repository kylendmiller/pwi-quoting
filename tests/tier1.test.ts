// Tier 1: fed each real quote's own SMT inputs, the engine must reproduce the SMT's numbers.
import { describe, it, expect } from 'vitest';
import { smtFixtures, num, raw, formula, hasFormula, rows, close, type Fixture } from './fixtures';
import { structuralLine, plateLine, plateBoxLine, stdPartLine, vendorLine, costBasedLine, rateLine } from '../src/engine/lines';
import { rollup, ROW, type CategoryKey } from '../src/engine/rollup';

const FX = smtFixtures();
const report: Record<string, { checked: number; failed: string[] }> = {};
const note = (k: string, ok: boolean, msg: string) => {
  report[k] ??= { checked: 0, failed: [] };
  report[k].checked++;
  if (!ok) report[k].failed.push(msg);
};

describe('tier 1 — line calculators match the SMT', () => {
  it('structural rows', () => {
    for (const f of FX) {
      const S = 'Structural'; const markup = num(f, S, 'I4');
      for (const r of rows(f, S)) {
        if (!hasFormula(f, S, `I${r}`) || !num(f, S, `B${r}`) || /Gantry!/.test(formula(f, S, `H${r}`) ?? '')) continue; // gantry auto-calc rows come from the gantry builder
        const res = structuralLine({ qty: num(f, S, `B${r}`), lengthFt: num(f, S, `D${r}`), lbPerFt: num(f, S, `E${r}`), pricePerLb: num(f, S, `F${r}`), markupPct: markup });
        note('structural', close(res.sell, num(f, S, `I${r}`)) && close(res.tons, num(f, S, `G${r}`), 1e-6), `${f.job} r${r}: ${res.sell} vs ${num(f, S, `I${r}`)}`);
      }
    }
  });

  it('plate rows', () => {
    for (const f of FX) {
      const S = 'Plate';
      for (const r of rows(f, S)) {
        const fj = formula(f, S, `J${r}`) ?? '';
        if (!hasFormula(f, S, `G${r}`) || !num(f, S, `B${r}`) || !hasFormula(f, S, `J${r}`)) continue;
        const mref = /\$J\$(\d+)/.exec(fj)?.[1] ?? '4';
        const g0 = formula(f, S, `G${r}`) ?? '';
        const drop = /0\.2833\*1\.1/.test(g0) ? 1.1 : /0\.2833/.test(g0) ? 1 : (rows(f, S).some(x => /0\.2833\*1\.1/.test(formula(f, S, `G${x}`) ?? '')) ? 1.1 : 1);
        if (!num(f, S, `D${r}`)) { // box rows: C = lb/ft, E = length ft
          const b = plateBoxLine(num(f, S, `B${r}`), num(f, S, `C${r}`), num(f, S, `E${r}`), num(f, S, `F${r}`), num(f, S, `J${mref}`));
          note('plate', close(b.sell, num(f, S, `J${r}`)), `${f.job} r${r} box: ${b.sell} vs ${num(f, S, `J${r}`)}`); continue;
        }
        const res = plateLine({ qty: num(f, S, `B${r}`), thicknessIn: num(f, S, `C${r}`), widthIn: num(f, S, `D${r}`), lengthIn: num(f, S, `E${r}`), pricePerLb: num(f, S, `F${r}`), markupPct: num(f, S, `J${mref}`), dropFactor: drop });
        const g = formula(f, S, `G${r}`) ?? '';
        if (g !== '<shared>' && !g.includes('0.2833')) continue; // box-girder / no-plasma rows use other formulas
        note('plate', close(res.sell, num(f, S, `J${r}`)), `${f.job} r${r}: ${res.sell} vs ${num(f, S, `J${r}`)}`);
      }
    }
  });

  it('standard parts rows', () => {
    for (const f of FX) {
      const S = 'Standard Parts & Products';
      for (const r of rows(f, S)) {
        const g = formula(f, S, `G${r}`);
        if (!g || !num(f, S, `B${r}`) || (g !== '<shared>' && !/^B\d+\*F\d+$/.test(g))) continue;
        // older mezz sections keep the sell price in E and GM% in F
        const mezz = num(f, S, `F${r}`) < 1 && num(f, S, `E${r}`) > 0;
        const v = mezz ? stdPartLine(num(f, S, `B${r}`), num(f, S, `E${r}`), num(f, S, `F${r}`)) : stdPartLine(num(f, S, `B${r}`), num(f, S, `F${r}`));
        note('stdParts', close(v, num(f, S, `G${r}`)), `${f.job} r${r}: ${v} vs ${num(f, S, `G${r}`)}`);
      }
    }
  });

  it('vendor rows', () => {
    for (const f of FX) {
      const S = 'Hoist & Crane Vendor Items';
      for (const r of rows(f, S)) {
        const fi = formula(f, S, `I${r}`);
        if (!fi || !num(f, S, `C${r}`) || (fi !== '<shared>' && !fi.includes('H'))) continue;
        const v = vendorLine({ qty: num(f, S, `C${r}`), listEach: num(f, S, `D${r}`), pwiDiscountPct: num(f, S, `E${r}`), customerDiscountPct: num(f, S, `H${r}`) });
        note('vendor', close(v.sell, num(f, S, `I${r}`)), `${f.job} r${r}: ${v.sell} vs ${num(f, S, `I${r}`)}`);
      }
    }
  });

  it('cost-based rows', () => {
    for (const f of FX) {
      const S = 'Cost Based Items';
      for (const r of rows(f, S)) {
        if (!hasFormula(f, S, `F${r}`) || !num(f, S, `B${r}`) || r > 26) continue;
        const v = costBasedLine(num(f, S, `B${r}`), num(f, S, `C${r}`), num(f, S, `E${r}`));
        note('costBased', close(v.sell, num(f, S, `F${r}`)), `${f.job} r${r}: ${v.sell} vs ${num(f, S, `F${r}`)}`);
      }
    }
  });

  it('labor rows', () => {
    for (const f of FX) {
      const S = 'Labor';
      for (const r of rows(f, S)) {
        if (r < 8 || r > 45 || /^total/i.test(String(raw(f, S, `A${r}`) ?? '')) || /^total/i.test(String(raw(f, S, `F${r}`) ?? ''))) continue; // subtotal rows
        for (const [h, rate, tot] of [['B', 'C', 'D'], ['G', 'H', 'I']]) {
          if (!hasFormula(f, S, `${tot}${r}`) || !num(f, S, `${h}${r}`)) continue;
          const v = rateLine(num(f, S, `${h}${r}`), num(f, S, `${rate}${r}`));
          note('labor', close(v, num(f, S, `${tot}${r}`)), `${f.job} ${tot}${r}: ${v} vs ${num(f, S, `${tot}${r}`)}`);
        }
      }
    }
  });
});

describe('tier 1 — Main Summary + Quote price block match the SMT', () => {
  it('rollup', () => {
    for (const f of FX) {
      const M = 'Main Summary', Q = 'Quote';
      const categories: Partial<Record<CategoryKey, number>> = {};
      for (const [k, r] of Object.entries(ROW)) categories[k as CategoryKey] = num(f, M, `D${r}`);
      const c4 = formula(f, M, 'C4') ?? '';
      const d35 = formula(f, M, 'D35') ?? '';
      const res = rollup({
        categories,
        onePct: { mode: c4.startsWith('IF(') ? 'switchable' : 'always', off: raw(f, M, 'E2') === true },
        dealerDiscount: num(f, M, 'E29'),
        outboundFreight: num(f, M, 'D33'),
        preUse: num(f, M, 'D34'),
        showPreUse: raw(f, M, 'A41') === true,
        tax: { on: raw(f, M, 'F35') === true, rate: num(f, M, 'F36'), base: d35.includes('D32') ? 'all' : 'materials' },
      });
      const checks: [string, number, number][] = [
        ['D31', res.basePrice, num(f, M, 'D31')], ['D32', res.installation, num(f, M, 'D32')],
        ['D35', res.salesTax, num(f, M, 'D35')], ['D36', res.totalDirect, num(f, M, 'D36')],
        ['L12', res.quote.base, num(f, Q, 'L12')], ['L17', res.quote.total, num(f, Q, 'L17')],
      ];
      for (const [k, got, exp] of checks) note('rollup ' + k, close(got, exp, 0.01), `${f.job} ${k}: ${got.toFixed(2)} vs ${exp.toFixed(2)}`);
    }
  });

  it('summary', () => {
    const lines = Object.entries(report).map(([k, v]) => `${k.padEnd(14)} ${v.checked - v.failed.length}/${v.checked} pass` + (v.failed.length ? `\n    e.g. ${v.failed.slice(0, 3).join('\n         ')}` : ''));
    console.log('\nTIER 1 REPORT\n' + lines.join('\n'));
    const total = Object.values(report).reduce((s, v) => s + v.checked, 0);
    const failed = Object.values(report).reduce((s, v) => s + v.failed.length, 0);
    expect(total).toBeGreaterThan(0);
    expect(failed).toBe(0);
  });
});
