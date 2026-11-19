// Quote wording → printable blocks. Generated wording uses light markup; older hand-typed
// wording (no markup) is classified by simple rules so it still prints in the PWI layout.
//   # text        system title          (15.6 pt, INCOMMAND styled)
//   ## text       section heading       (13.8 pt bold)
//   - text        bullet  "o"
//   -- text       sub-bullet "•"
//   - Label:<TAB>Value   spec row (label / value columns)
//   > text        paragraph (indented, no bullet)
//   [image:fstr]  product picture
export type Block =
  | { t: 'title'; text: string }
  | { t: 'h'; text: string }
  | { t: 'b'; text: string }
  | { t: 'b2'; text: string }
  | { t: 'kv'; k: string; v: string }
  | { t: 'p'; text: string }
  | { t: 'img'; name: string }
  | { t: 'gap' };

export function parseWording(w: string): Block[] {
  const out: Block[] = [];
  const marked = /^(#|-|>|\[image:)/m.test(w);
  let atStart = true;
  for (const raw of w.replace(/\r/g, '').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) { if (out.length && out[out.length - 1].t !== 'gap') out.push({ t: 'gap' }); atStart = true; continue; }
    let m: RegExpExecArray | null;
    if ((m = /^\[image:(\w+)\]$/.exec(line.trim()))) out.push({ t: 'img', name: m[1] });
    else if ((m = /^##\s+(.*)$/.exec(line))) out.push({ t: 'h', text: m[1] });
    else if ((m = /^#\s+(.*)$/.exec(line))) out.push({ t: 'title', text: m[1] });
    else if ((m = /^(?:--|\s{2,}-)\s+(.*)$/.exec(line))) out.push({ t: 'b2', text: m[1] });
    else if ((m = /^-\s+(.*)$/.exec(line))) out.push(kvOr(m[1]));
    else if ((m = /^>\s?(.*)$/.exec(line))) out.push({ t: 'p', text: m[1] });
    else if (marked) out.push(kvOr(line.trim()));
    else out.push(classify(line.trim(), atStart));
    atStart = false;
  }
  while (out.length && out[out.length - 1].t === 'gap') out.pop();
  return out;
}

function kvOr(s: string): Block {
  const m = /^([^\t]+?)\t+(.*)$/.exec(s);
  return m ? { t: 'kv', k: m[1].trim(), v: m[2].trim() } : { t: 'b', text: s };
}

/** Rules for unmarked (hand-typed / library) wording. */
function classify(s: string, atStart: boolean): Block {
  if (/\t/.test(s)) return kvOr(s);
  if (atStart && /^\(\d+\)/.test(s) && s === s.toUpperCase()) return { t: 'title', text: s.replace(/^\((\d+)\)\s*-\s*/, '($1) ') };
  if (atStart && /^\(\d+\)/.test(s)) return { t: 'h', text: s };
  if (s.length <= 45 && /:$/.test(s)) return { t: 'h', text: s };
  if (s.length > 140) return { t: 'p', text: s };
  return { t: 'b', text: s };
}
