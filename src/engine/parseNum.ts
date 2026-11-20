// Safe numeric input for the editor grids (round 3 S8 / U5). No eval, no Function: a small whitelist lexer and
// recursive-descent parser for + − × ÷ and parentheses, plus feet-inches (20'6", 20' 6 1/2", 6"). Lengths come
// back in FEET. Anything else (letters, exponents, empty operands, ÷0, > 64 chars, non-finite) returns null.

export type ParseNumResult = { ok: true; value: number } | { ok: false; error: string };
export interface ParseNumOpts { allowNegative?: boolean }

const MAX_LEN = 64;
type Tok = { t: 'num'; v: number } | { t: 'op'; v: '+' | '-' | '*' | '/' | '(' | ')' };

function lex(src: string): Tok[] | string {
  const s = src.replace(/[′’]/g, "'").replace(/[″”]/g, '"').replace(/[×x]/gi, '*').replace(/÷/g, '/');
  if (!/^[0-9.,+\-*/()'" \t]*$/.test(s)) return 'Only numbers, + − × ÷, ( ) and feet-inches like 20\'6" are allowed.';
  const out: Tok[] = [];
  let i = 0;
  const ws = () => { while (s[i] === ' ' || s[i] === '\t') i++; };
  const readNum = (): number | null => {
    const m = /^(\d{1,3}(?:,\d{3})+|\d+)?(\.\d+)?/.exec(s.slice(i));
    if (!m || !m[0]) return null;
    if (m[1] == null && m[2] == null) return null;
    i += m[0].length;
    return Number((m[1] ?? '0').replace(/,/g, '') + (m[2] ?? ''));
  };
  // inches after a feet mark or alone: "6", "6.5", "6 1/2", "1/2" followed by "
  const tryInches = (): number | null => {
    const save = i;
    ws(); if (s[i] === '-') { i++; ws(); }
    const m = /^(\d+(?:\.\d+)?)(?:[ \t]+(\d+)\/(\d+))?"|^(\d+)\/(\d+)"/.exec(s.slice(i));
    if (!m) { i = save; return null; }
    i += m[0].length;
    if (m[4] != null) return Number(m[5]) ? Number(m[4]) / Number(m[5]) : NaN;
    return Number(m[1]) + (m[2] != null ? (Number(m[3]) ? Number(m[2]) / Number(m[3]) : NaN) : 0);
  };
  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\t') { i++; continue; }
    if ('+-*/()'.includes(c)) { out.push({ t: 'op', v: c as any }); i++; continue; }
    if (/[0-9.]/.test(c)) {
      // a mixed-number inch value "6 1/2"" or a fraction inch "1/2"" starts here?
      const inchFirst = /^(\d+(?:\.\d+)?)(?:[ \t]+\d+\/\d+)?"|^\d+\/\d+"/.exec(s.slice(i));
      if (inchFirst) { const v = tryInches(); if (v == null || !isFinite(v)) return 'Bad inches.'; out.push({ t: 'num', v: v / 12 }); continue; }
      const n = readNum(); if (n == null) return 'Bad number.';
      if (s[i] === "'") {                        // feet, maybe followed by inches
        i++;
        const inch = tryInches();
        if (inch != null && !isFinite(inch)) return 'Bad inches.';
        out.push({ t: 'num', v: n + (inch ?? 0) / 12 });
        continue;
      }
      if (s[i] === '"') return 'Bad inches.';
      if (/[0-9.,]/.test(s[i] ?? '')) return 'Bad number.';
      out.push({ t: 'num', v: n });
      continue;
    }
    return `Unexpected "${c}".`;
  }
  return out;
}

function evaluate(toks: Tok[]): number | string {
  let p = 0;
  const peek = () => toks[p];
  const expr = (): number | string => {
    let a = term(); if (typeof a === 'string') return a;
    while (peek()?.t === 'op' && (peek()!.v === '+' || peek()!.v === '-')) {
      const op = toks[p++].v; const b = term(); if (typeof b === 'string') return b;
      a = op === '+' ? a + b : a - b;
    }
    return a;
  };
  const term = (): number | string => {
    let a = factor(); if (typeof a === 'string') return a;
    while (peek()?.t === 'op' && (peek()!.v === '*' || peek()!.v === '/')) {
      const op = toks[p++].v; const b = factor(); if (typeof b === 'string') return b;
      if (op === '/' && b === 0) return 'Division by zero.';
      a = op === '*' ? a * b : a / b;
    }
    return a;
  };
  let depth = 0;
  const factor = (): number | string => {
    const t = toks[p++];
    if (!t) return 'Incomplete expression.';
    if (t.t === 'num') return t.v;
    if (t.v === '-' || t.v === '+') { const v = factor(); return typeof v === 'string' ? v : t.v === '-' ? -v : v; }
    if (t.v === '(') {
      if (++depth > 16) return 'Too many parentheses.';
      const v = expr(); if (typeof v === 'string') return v;
      if (toks[p++]?.v !== ')') return 'Missing ).';
      depth--; return v;
    }
    return 'Incomplete expression.';
  };
  const v = expr();
  if (typeof v === 'string') return v;
  if (p !== toks.length) return 'Unexpected text at the end.';
  return v;
}

export function parseNumResult(text: string, opts: ParseNumOpts = {}): ParseNumResult {
  if (typeof text !== 'string') return { ok: false, error: 'Not text.' };
  let s = text.trim();
  if (s.startsWith('=')) s = s.slice(1).trim();
  if (!s) return { ok: false, error: 'Empty.' };
  if (s.length > MAX_LEN) return { ok: false, error: `Longer than ${MAX_LEN} characters.` };
  const toks = lex(s);
  if (typeof toks === 'string') return { ok: false, error: toks };
  const v = evaluate(toks);
  if (typeof v === 'string') return { ok: false, error: v };
  if (!Number.isFinite(v)) return { ok: false, error: 'Not a finite number.' };
  if (v < 0 && !opts.allowNegative) return { ok: false, error: 'Negative numbers are not allowed here.' };
  const r = Math.round(v * 1e9) / 1e9;          // strip float noise (0.1+0.2)
  return { ok: true, value: Object.is(r, -0) ? 0 : r };
}

/** Parses a cell entry to a number, or null when it isn't a safe arithmetic / feet-inches expression. */
export function parseNum(text: string, opts: ParseNumOpts = {}): number | null {
  const r = parseNumResult(text, opts);
  return r.ok ? r.value : null;
}

/** Feet-inches only (20'6", 20' 6 1/2", 20'-6", 6", 1/2", 20.5) → feet. No arithmetic. */
const FT_IN = /^(?:\d+(?:\.\d+)?(?:'(?:[ \t]*-?[ \t]*\d+(?:\.\d+)?(?:[ \t]+\d+\/\d+)?")?)?|\d+(?:\.\d+)?(?:[ \t]+\d+\/\d+)?"|\d+\/\d+")$/;
export function parseFtIn(text: string): number | null {
  const s = typeof text === 'string' ? text.trim().replace(/[′’]/g, "'").replace(/[″”]/g, '"') : '';
  return FT_IN.test(s) ? parseNum(s) : null;
}
