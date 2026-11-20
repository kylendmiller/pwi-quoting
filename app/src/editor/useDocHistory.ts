// Undo / redo for the quote doc (U8) + a local draft so a refresh or a lost connection never loses typed work.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { QuoteDoc } from '../../../src/engine/manual';

interface H { past: { doc: QuoteDoc; label: string }[]; present: QuoteDoc | null; label: string; future: { doc: QuoteDoc; label: string }[] }
const CAP = 200;

export function useDocHistory(initial: QuoteDoc | null = null) {
  const [h, setH] = useState<H>(() => ({ past: [], present: initial, label: '', future: [] }));
  const last = useRef<{ tag?: string; at: number }>({ at: 0 });
  /** Replace the doc. `tag` coalesces quick repeats of the same edit (typing in the wording box) into one undo step. */
  const set = useCallback((doc: QuoteDoc, label = 'edit', tag?: string) => {
    const now = Date.now();
    const merge = !!tag && last.current.tag === tag && now - last.current.at < 800;
    last.current = { tag, at: now };
    setH(cur => {
      if (!cur.present) return { ...cur, present: doc };
      if (merge) return { ...cur, present: doc };
      return { past: [...cur.past, { doc: cur.present, label }].slice(-CAP), present: doc, label, future: [] };
    });
  }, []);
  const reset = useCallback((doc: QuoteDoc | null) => setH({ past: [], present: doc, label: '', future: [] }), []);
  const undo = useCallback(() => setH(cur => {
    const p = cur.past.at(-1); if (!p || !cur.present) return cur;
    return { past: cur.past.slice(0, -1), present: p.doc, label: p.label, future: [{ doc: cur.present, label: p.label }, ...cur.future] };
  }), []);
  const redo = useCallback(() => setH(cur => {
    const f = cur.future[0]; if (!f || !cur.present) return cur;
    return { past: [...cur.past, { doc: cur.present, label: f.label }], present: f.doc, label: f.label, future: cur.future.slice(1) };
  }), []);
  return { doc: h.present, set, reset, undo, redo, canUndo: h.past.length > 0, canRedo: h.future.length > 0,
    undoLabel: h.past.at(-1)?.label, redoLabel: h.future[0]?.label };
}

/** Ctrl/⌘+Z undo, Ctrl+Y or Ctrl+Shift+Z redo, Ctrl/⌘+S save — ignored while typing in a text box (the box keeps its own undo). */
export function useEditorKeys(k: { undo: () => void; redo: () => void; save?: () => void }) {
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const el = document.activeElement as HTMLElement | null;
      const typing = !!el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'checkbox'));
      const key = e.key.toLowerCase();
      if (key === 's' && k.save) { e.preventDefault(); k.save(); return; }
      if (typing) return;
      if (key === 'z' && !e.shiftKey) { e.preventDefault(); k.undo(); }
      else if (key === 'y' || (key === 'z' && e.shiftKey)) { e.preventDefault(); k.redo(); }
    };
    addEventListener('keydown', f); return () => removeEventListener('keydown', f);
  }, [k.undo, k.redo, k.save]);
}

// ---------------------------------------------------------------- local drafts
export interface Draft { docVersion: number | null; at: string; doc: QuoteDoc; header?: any }
const dkey = (revId: string) => `pwi.draft.${revId}`;
export function saveDraft(revId: string, d: Draft) { try { localStorage.setItem(dkey(revId), JSON.stringify(d)); } catch { /* storage full / private mode: drafts are best-effort */ } }
export function readDraft(revId: string): Draft | null { try { const s = localStorage.getItem(dkey(revId)); return s ? JSON.parse(s) : null; } catch { return null; } }
export function clearDraft(revId: string) { try { localStorage.removeItem(dkey(revId)); } catch { /* ignore */ } }
