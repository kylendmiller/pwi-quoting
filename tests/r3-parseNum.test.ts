// Round 3 S8 / U5: safe numeric parser (no eval).
import { describe, it, expect } from 'vitest';
import { parseNum, parseNumResult, parseFtIn } from '../src/engine/parseNum';

describe('parseNum', () => {
  it.each([
    ['12', 12], ['  12.5 ', 12.5], ['=2*(3+4)', 14], ['1,250.5', 1250.5], ['10/4', 2.5], ['.5', 0.5], ['0.1+0.2', 0.3],
    ['3 x 4', 12], ['8 × 2', 16], ['(1+2)*(3+4)/7', 3], ['-(-3)', 3], ['+4', 4],
    [`20'6"`, 20.5], [`20' 6"`, 20.5], [`20'-6"`, 20.5], [`20'`, 20], [`6"`, 0.5], [`20' 6 1/2"`, 20 + 6.5 / 12], [`1/2"`, 1 / 24],
    [`2*20'6"`, 41], [`20'6" + 1'6"`, 22],
  ])('%s → %s', (t, v) => expect(parseNum(t)).toBeCloseTo(v as number, 9));
  it.each(['', '=', 'abc', '=alert(1)', '1e400', '1e5', '2*', '*2', '(1+2', '1+2)', '1/0', '1,2', '1..2', 'Infinity', 'NaN', '0x10x', '2**3',
    'constructor', '1;2', '${1}', '`1`', '9'.repeat(65), '((((((((((((((((((1))))))))))))))))))'])('rejects %j', t => expect(parseNum(t)).toBeNull());
  it('negatives only when allowed', () => {
    expect(parseNum('-3')).toBeNull();
    expect(parseNum('2-5')).toBeNull();
    expect(parseNum('-3', { allowNegative: true })).toBe(-3);
    expect(parseNumResult('-3').ok).toBe(false);
  });
  it('gives a reason', () => {
    const r = parseNumResult('2*');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Incomplete/);
  });
  it('parseFtIn takes lengths only', () => {
    expect(parseFtIn(`20'6"`)).toBe(20.5);
    expect(parseFtIn('20.5')).toBe(20.5);
    expect(parseFtIn(`2*20'`)).toBeNull();
    expect(parseFtIn('abc')).toBeNull();
  });
  it('never calls eval or Function', async () => {
    const src = (await import('node:fs')).readFileSync('src/engine/parseNum.ts', 'utf8');
    expect(src).not.toMatch(/\beval\s*\(|new Function|Function\(/);
  });
});
