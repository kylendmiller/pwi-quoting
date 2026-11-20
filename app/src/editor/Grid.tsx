// Spreadsheet-feel grid for one SMT tab (U5).
// Click / arrows select · Enter or F2 edits · typing a digit starts replacing · Tab / Shift+Tab move between
// editable cells · Esc cancels · Ctrl+Backspace reverts a changed cell · Delete removes the row (undo with Ctrl+Z).
// Number cells take simple arithmetic and feet-inches through parseNum (no eval).
import { useEffect, useRef, useState } from 'react';
import type { PricedLine } from '../../../src/engine/manual';
import { parseNum, getPath, type EditorLine } from './engineApi';
import type { Col } from './tabs';

export interface GridRow { line: EditorLine; priced: PricedLine }
interface Props {
  rows: GridRow[]; cols: Col[]; locked: boolean;
  onEdit: (key: string, path: string, value: unknown) => void;
  onRevert: (key: string, path: string) => void;
  onDelete: (key: string) => void;
  highlight?: Set<string>;
  shapes?: string[];
  rowNote?: (l: EditorLine) => string | undefined;
}

const fmtBuilder = (v: unknown) => (v == null ? '—' : typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : String(v));

export function Grid({ rows, cols, locked, onEdit, onRevert, onDelete, highlight, shapes, rowNote }: Props) {
  const [at, setAt] = useState<{ r: number; c: number } | null>(null);
  const [edit, setEdit] = useState<{ r: number; c: number; text: string; err?: boolean } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const inp = useRef<HTMLInputElement>(null);
  useEffect(() => { if (edit) { inp.current?.focus(); } }, [edit?.r, edit?.c]);

  const pathAt = (r: number, c: number) => (rows[r] && cols[c]?.path ? cols[c].path!(rows[r].line) : null);
  const editable = (r: number, c: number) => !locked && !!pathAt(r, c);
  const nextEditable = (r: number, c: number, dir: 1 | -1) => {
    let rr = r, cc = c;
    for (let n = 0; n < rows.length * cols.length; n++) {
      cc += dir; if (cc >= cols.length) { cc = 0; rr++; } if (cc < 0) { cc = cols.length - 1; rr--; }
      if (rr < 0 || rr >= rows.length) return null;
      if (editable(rr, cc)) return { r: rr, c: cc };
    }
    return null;
  };
  const start = (r: number, c: number, text?: string) => {
    if (!editable(r, c)) return;
    const v = getPath(rows[r].line, pathAt(r, c)!);
    setEdit({ r, c, text: text ?? (v == null ? '' : String(v)) });
  };
  const commit = (): boolean => {
    if (!edit) return true;
    const { r, c, text } = edit; const col = cols[c]; const path = pathAt(r, c)!; const l = rows[r].line;
    let v: unknown = text;
    if (col.input === 'num') {
      const n = parseNum(text);
      if (n == null || (path !== 'markupPct' && path !== 'unitSell' && n < 0 && path !== 'qty')) { setEdit({ ...edit, err: true }); return false; }
      v = n;
    } else if (col.input === 'shape') {
      const s = text.trim(); const hit = shapes?.find(x => x.toLowerCase().replace(/\s/g, '') === s.toLowerCase().replace(/\s/g, ''));
      if (!hit) { setEdit({ ...edit, err: true }); return false; }
      v = hit;
    }
    const before = getPath(l, path);
    if (v !== before) onEdit(l.key, path, v);
    setEdit(null); box.current?.focus();
    return true;
  };
  const cancel = () => { setEdit(null); box.current?.focus(); };

  const onKey = (e: React.KeyboardEvent) => {
    if (edit) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (commit()) setAt({ r: Math.min(rows.length - 1, edit.r + 1), c: edit.c }); }
      else if (e.key === 'Tab') { e.preventDefault(); if (commit()) { const n = nextEditable(edit.r, edit.c, e.shiftKey ? -1 : 1); if (n) setAt(n); } }
      return;
    }
    if (!at) { if (/^Arrow/.test(e.key)) { setAt({ r: 0, c: 0 }); e.preventDefault(); } return; }
    const { r, c } = at;
    const mv = (rr: number, cc: number) => { e.preventDefault(); setAt({ r: Math.max(0, Math.min(rows.length - 1, rr)), c: Math.max(0, Math.min(cols.length - 1, cc)) }); };
    switch (e.key) {
      case 'ArrowUp': return mv(r - 1, c);
      case 'ArrowDown': return mv(r + 1, c);
      case 'ArrowLeft': return mv(r, c - 1);
      case 'ArrowRight': return mv(r, c + 1);
      case 'Tab': { const n = nextEditable(r, c, e.shiftKey ? -1 : 1); if (n) { e.preventDefault(); setAt(n); } return; }
      case 'Enter': case 'F2': e.preventDefault(); return start(r, c);
      case 'Escape': setAt(null); return;
      case 'Delete': if (!locked) { e.preventDefault(); onDelete(rows[r].line.key); } return;
      case 'Backspace': if (e.ctrlKey || e.metaKey) { const p = pathAt(r, c); if (p && rows[r].line.edited && p in rows[r].line.edited) { e.preventDefault(); onRevert(rows[r].line.key, p); } } return;
    }
    if (e.key.length === 1 && /[0-9.=\-(a-zA-Z]/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey && editable(r, c)) { e.preventDefault(); start(r, c, e.key); }
  };

  return (
    <div className="qe-grid" ref={box} tabIndex={0} onKeyDown={onKey} onBlur={e => { if (!box.current?.contains(e.relatedTarget as Node)) setAt(null); }}>
      <table>
        <colgroup>{cols.map(c => <col key={c.id} style={{ width: c.w }} />)}{!locked && <col style={{ width: 26 }} />}</colgroup>
        <thead><tr>{cols.map(c => <th key={c.id} title={c.title} className={c.align === 'l' ? '' : 'num'}>{c.label}</th>)}{!locked && <th />}</tr></thead>
        <tbody>
          {rows.map((row, r) => {
            const l = row.line;
            const note = rowNote?.(l);
            return (
              <tr key={l.key} className={`${highlight?.has(l.key) ? 'hl' : ''} ${!l.auto ? 'hand' : ''}`}>
                {cols.map((c, ci) => {
                  const p = c.path?.(l) ?? null;
                  const changed = !!(p && l.edited && p in l.edited);
                  const active = at?.r === r && at?.c === ci;
                  const v = c.get(l, row.priced);
                  const txt = c.show ? c.show(v, l, row.priced) : v == null ? '' : String(v);
                  const isEdit = edit?.r === r && edit?.c === ci;
                  const cls = [c.align === 'l' ? 'l' : 'num', p && !locked ? 'ed' : '', changed ? 'changed' : '', active ? 'active' : ''].join(' ');
                  return (
                    <td key={c.id} className={cls}
                      title={changed ? `Builder had ${fmtBuilder(l.edited![p!])} · you changed it to ${fmtBuilder(getPath(l, p!))}` : ci === 0 ? [l.description, l.group, note].filter(Boolean).join('\n') : undefined}
                      onMouseDown={() => { if (!isEdit) { if (edit) commit(); setAt({ r, c: ci }); } }}
                      onDoubleClick={() => start(r, ci)}>
                      {isEdit ? <input ref={inp} className={edit!.err ? 'err' : ''} value={edit!.text} list={c.input === 'shape' ? 'qe-shapes' : undefined}
                        onChange={e => setEdit({ ...edit!, text: e.target.value, err: false })} onBlur={() => { if (edit) commit() || cancel(); }} />
                        : <>
                          {ci === 0 && !l.auto && <span className="tag hand" title="Added by you">+</span>}
                          {ci === 0 && note && <span className="tag warn" title={note}>!</span>}
                          <span className="v">{txt}</span>
                          {changed && !locked && <button tabIndex={-1} className="rv" title={`Back to builder's ${fmtBuilder(l.edited![p!])}`} onMouseDown={e => { e.stopPropagation(); onRevert(l.key, p!); }}>↺</button>}
                        </>}
                    </td>
                  );
                })}
                {!locked && <td className="x"><button tabIndex={-1} title="Remove line (Ctrl+Z to undo)" onClick={() => onDelete(l.key)}>×</button></td>}
              </tr>
            );
          })}
        </tbody>
      </table>
      {shapes && <datalist id="qe-shapes">{shapes.map(s => <option key={s} value={s} />)}</datalist>}
    </div>
  );
}
