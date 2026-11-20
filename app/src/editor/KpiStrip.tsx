// Always-visible smell-test numbers (U4), with the change since the last save.
import type { Priced, QuoteDoc } from '../../../src/engine/manual';
import { lbOf, fmtMoney, fmtNum } from './smt';

export interface Kpis {
  total: number; base: number; gmPct: number; tons: number; noWeight: number; sellPerLb: number | null; shopH: number; hPerTon: number | null;
  pvPerShopH: number | null; installH: number; suggested: number | null; men: number | null; days: number | null;
}
const STEEL = ['structural', 'plate', 'miscSteel', 'xBracing'];

export function crewOf(doc: QuoteDoc): { men: number | null; days: number | null } {
  const t: any = doc.lines.map(l => l.detail).find((d: any) => d?.type === 'travel');
  const a = (f: string) => (doc.assumptions ?? []).find(x => x.field === f)?.value as number | undefined;
  return { men: t?.men ?? a('crewMen') ?? null, days: t?.crewDays ?? a('crewDays') ?? null };
}

export function kpis(doc: QuoteDoc, p: Priced): Kpis {
  const steel = p.lines.filter(l => STEEL.includes(l.category));
  const lb = steel.reduce((a, l) => a + lbOf(l), 0);
  const steelSell = steel.filter(l => l.detail).reduce((a, l) => a + l.sell, 0);
  const matCost = p.lines.filter(l => l.kind === 'material').reduce((a, l) => a + l.cost, 0);
  const t = lb / 2000, shopH = p.totals.shopHours;
  const c = crewOf(doc);
  return {
    total: p.rollup.quote.total, base: p.rollup.quote.base, gmPct: p.totals.grossMarginPct, tons: t,
    noWeight: steel.filter(l => !l.detail).length,
    sellPerLb: lb ? steelSell / lb : null, shopH, hPerTon: t ? shopH / t : null,
    pvPerShopH: shopH ? (p.rollup.quote.base - matCost) / shopH : null,
    installH: p.totals.installHours, suggested: doc.suggestedInstallHours ?? null, men: c.men, days: c.days,
  };
}

function Delta({ a, b, money, pct, d = 1 }: { a: number | null; b: number | null | undefined; money?: boolean; pct?: boolean; d?: number }) {
  if (b == null || a == null) return null;
  const x = a - b; if (Math.abs(x) < (pct ? 0.0005 : money ? 0.5 : 0.05)) return null;
  const s = pct ? `${(x * 100).toFixed(1)} pt` : money ? fmtMoney(Math.abs(x)) : fmtNum(Math.abs(x), d);
  return <span className={`qe-delta ${x > 0 ? 'up' : 'dn'}`}>{x > 0 ? '▲' : '▼'}{pct ? s.replace('-', '') : s}</span>;
}

export function KpiStrip({ k, saved, hideCost }: { k: Kpis; saved?: Kpis | null; hideCost: boolean }) {
  const below = k.suggested != null && k.installH + 0.05 < k.suggested;
  const cells: [string, React.ReactNode, React.ReactNode?, string?][] = [
    ['Total', `$${fmtMoney(k.total)}`, <Delta a={k.total} b={saved?.total} money />],
    ['Base', `$${fmtMoney(k.base)}`, <Delta a={k.base} b={saved?.base} money />],
    ...(!hideCost ? [['GM', `${(k.gmPct * 100).toFixed(1)}%`, <Delta a={k.gmPct} b={saved?.gmPct} pct />] as [string, React.ReactNode, React.ReactNode]] : []),
    ['Steel', <>{fmtNum(k.tons, 2)} t{k.noWeight ? <small className="bad" title="Steel lines with no weight (added without a shape)"> +{k.noWeight} no wt</small> : null}</>, <Delta a={k.tons} b={saved?.tons} d={2} />],
    ['Sell $/lb', k.sellPerLb == null ? '—' : `$${k.sellPerLb.toFixed(2)}`, null, 'Structural + plate sell ÷ lb'],
    ['Shop h', fmtNum(k.shopH, 1), <Delta a={k.shopH} b={saved?.shopH} />],
    ['h / ton', k.hPerTon == null ? '—' : fmtNum(k.hPerTon, 1), null, 'Shop hours per ton of steel'],
    ...(!hideCost ? [['PV / shop h', k.pvPerShopH == null ? '—' : `$${fmtMoney(k.pvPerShopH)}`, null, '(Base − material cost) ÷ shop hours'] as [string, React.ReactNode, React.ReactNode, string]] : []),
    ['Install h', <span className={below ? 'bad' : ''}>{fmtNum(k.installH, 1)}{k.suggested != null ? <small> / {fmtNum(k.suggested, 1)} sugg.</small> : null}</span>, <Delta a={k.installH} b={saved?.installH} />],
    ['Crew', k.men ? `${k.men} men × ${k.days ?? '?'} days` : '—'],
  ];
  return (
    <div className="qe-kpis">
      {cells.map(([label, v, delta, title]) => <div key={label} className="qe-kpi" title={title}><label>{label}</label><b>{v}</b>{delta}</div>)}
    </div>
  );
}
