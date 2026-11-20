// Round 4: spec.installDays — install days as one control. Site labor = men × days × 10 h (a visible +/− line on top of
// the builder's tasks); travel nights, per diem, hotel, commute and rental periods use exactly those days; the install
// suggestion stays the builder's own, so fewer days than it needs raises install_below_suggested. Unset = unchanged.
import { describe, it, expect } from 'vitest';
import { buildFromSpec, type QuoteSpec } from '../src/engine/buildSpec';
import { priceManual, validateDoc, INSTALL_DAYS_OP, type QuoteDoc, type QuoteLine } from '../src/engine/manual';
import { HOURS_PER_DAY, RULES } from '../src/engine/kit';
import { planRebuild, applyPlan } from '../src/engine/rebuildPlan';
import { price } from '../app/src/editor/engineApi';
import { testCatalog } from './catalog';
import { CAL_SETTINGS } from './calibration/harness';

const S = CAL_SETTINGS as any;
const base: QuoteDoc = { family: 'other', lines: [], outboundFreight: 0, preUse: 0, showPreUse: false, dealerDiscount: 0, taxOn: false, wording: '', options: [], suggestedInstallHours: null, freestandingShopHours: 0, pvPerHourOverride: null };
const FSTR = { type: 'freestanding', capacityTons: 5, spanFt: 30, runwayOalFt: 80, overallHeightFt: 20, bridgeDrive: 'motorized', voltage: '460V/3', install: true, miles: 400 };
const spec = (extra: Record<string, unknown> = {}, item: Record<string, unknown> = FSTR): QuoteSpec => ({ pwi_quote: 1, items: [{ ...item, id: 'fs-1', ...extra } as any] });
const build = (s: QuoteSpec) => buildFromSpec(s, testCatalog, S, base);
const site = (d: QuoteDoc) => d.lines.filter(l => l.kind === 'site_labor');
const tasks = (d: QuoteDoc) => site(d).filter(l => l.laborOp !== 'site_travel' && l.laborOp !== INSTALL_DAYS_OP);
const adjOf = (d: QuoteDoc) => d.lines.filter(l => l.laborOp === INSTALL_DAYS_OP);
const sum = (ls: QuoteLine[]) => Math.round(ls.reduce((a, l) => a + l.qty, 0) * 10) / 10;
const travelDetail = (d: QuoteDoc, what: string) => d.lines.find(l => (l.detail as any)?.type === 'travel' && (l.detail as any).what === what)!;
const equip = (d: QuoteDoc) => d.lines.filter(l => l.kind === 'equipment' && (l.detail as any)?.purpose !== 'delivery');
const noKeys = (d: QuoteDoc) => JSON.parse(JSON.stringify(d.lines.map(({ key: _k, ...l }) => l)));

describe('installDays: unset = unchanged', () => {
  const a = build(spec()).doc, b = build(spec({ installDays: undefined })).doc;
  it('no installDays → no adjustment line, same lines, prices and suggestion', () => {
    expect(adjOf(a)).toEqual([]);
    expect(noKeys(b)).toEqual(noKeys(a));
    expect(price(b, S).quote).toEqual(price(a, S).quote);
    expect(b.suggestedInstallHours).toBe(a.suggestedInstallHours);
  });
  it('installDays on a ship-only item is ignored', () => {
    const x = build(spec({ install: false })).doc, y = build(spec({ install: false, installDays: 4 })).doc;
    expect(noKeys(y)).toEqual(noKeys(x));
    expect(price(y, S).quote).toEqual(price(x, S).quote);
  });
});

describe('installDays: one item', () => {
  const b0 = build(spec()).doc;
  const t0 = travelDetail(b0, 'hotel').detail as any;
  const builtDays: number = t0.crewDays, men: number = t0.men;
  const sugg = b0.suggestedInstallHours!;

  it('more days: site labor = men × days × h/day (+ travel time), tasks untouched, one visible + line', () => {
    const days = builtDays + 1;
    const d = build(spec({ installDays: days })).doc;
    expect(noKeys({ ...d, lines: tasks(d) })).toEqual(noKeys({ ...b0, lines: tasks(b0) }));      // builder's breakdown intact
    const adj = adjOf(d);
    expect(adj).toHaveLength(1);
    expect(adj[0].qty).toBeGreaterThan(0);
    expect(adj[0].ref).toBe('fs-1:install/install-days-adjustment');
    expect(adj[0].auto).toBe(true);
    expect(adj[0].description).toContain(`${men} men × ${days} days × ${HOURS_PER_DAY} h`);
    expect(sum([...tasks(d), ...adj])).toBe(men * days * HOURS_PER_DAY);
    // hours on the priced quote: the target + travel time (drive: same as built)
    const travel = sum(site(d).filter(l => l.laborOp === 'site_travel'));
    expect(price(d, S).totals.installHours).toBeCloseTo(men * days * HOURS_PER_DAY + travel, 6);
    // the suggestion stays the builder's
    expect(d.suggestedInstallHours).toBe(sugg);
    expect(price(d, S).flags.map(f => f.rule)).not.toContain('INSTALL_BELOW_SUGGESTED');
  });

  it('travel uses exactly those days: nights, hotel rooms, per diem', () => {
    const days = builtDays + 2;
    const d = build(spec({ installDays: days })).doc;
    const extra = 400 > RULES.travel.sameDayDriveMiles ? 2 : 0;
    const hotel = travelDetail(d, 'hotel'), pd = travelDetail(d, 'per_diem');
    expect((hotel.detail as any).crewDays).toBe(days);
    expect((hotel.detail as any).nights).toBe(days + extra - 1);
    expect(hotel.qty).toBe(men * (days + extra - 1));
    expect(pd.qty).toBe(men * (days + extra));
    expect(hotel.description).toBe(`Hotels — ${men} rooms × ${days + extra - 1} nights`);
    expect(hotel.basis?.text).toContain('installDays');
    // and the money follows
    expect(price(d, S).quote.installation).toBeGreaterThan(price(b0, S).quote.installation);
  });

  it('equipment rental duration and day / week / month rate follow installDays', () => {
    const E = RULES.equipment;
    const check = (days: number) => {
      const d = build(spec({ installDays: days })).doc;
      const weeks = Math.ceil(days / 5);
      const period = days < E.weekly.fromDays ? 'day' : weeks >= E.monthly.fromWeeks ? 'month' : 'week';
      for (const l of equip(d)) {
        const det = l.detail as any;
        expect(det.crewDays).toBe(days);
        expect(det.period).toBe(period);
        const unit = period === 'day' ? det.rates.daily * days : period === 'week' ? det.rates.weekly * weeks : det.rates.monthly * weeks / 4;
        expect(l.unitCost).toBeCloseTo(Math.round(unit * 100) / 100, 2);
      }
      return d;
    };
    check(2); check(builtDays + 3); check(25);
    expect(equip(check(2))[0].description).toMatch(/— 2 day$/);
  });

  it('fewer days than the builder needs raises install_below_suggested (suggestion is still the builder\'s)', () => {
    const d = build(spec({ installDays: builtDays - 1 })).doc;
    expect(d.suggestedInstallHours).toBe(sugg);
    const adj = adjOf(d)[0];
    expect(adj.qty).toBeLessThan(0);                        // a visible − line
    const p = price(d, S);
    const f = p.flags.find(x => x.rule === 'INSTALL_BELOW_SUGGESTED')!;
    expect(f).toBeTruthy();
    expect(f.detail.suggested).toBe(Math.round(sugg * 10) / 10);
    expect(f.lineKeys).toContain(adj.key);
    // the − hours are not a discount
    expect(p.flags.map(x => x.rule)).not.toContain('BIG_DISCOUNT');
    // and the doc still saves (negative qty is allowed on this one line only)
    expect(validateDoc(d)).toEqual([]);
    expect(validateDoc({ ...d, lines: d.lines.map(l => (l.key === adj.key ? { ...l, laborOp: 'site_other' } : l)) })[0]).toMatch(/quantity must be/);
  });

  it('crewMen and installDays together: men × days', () => {
    const d = build(spec({ crewMen: 3, installDays: 3 })).doc;
    expect(sum([...tasks(d), ...adjOf(d)])).toBe(3 * 3 * HOURS_PER_DAY);
    expect((travelDetail(d, 'hotel').detail as any).men).toBe(3);
  });

  it('local jobs: the daily commute follows the days', () => {
    const loc = { ...FSTR, miles: 60 };
    const a = build(spec({}, loc)).doc, b = build(spec({ installDays: 9 }, loc)).doc;
    const tA = site(a).find(l => l.laborOp === 'site_travel')!, tB = site(b).find(l => l.laborOp === 'site_travel')!;
    const dA = (tA.detail as any).crewDays, m = (tA.detail as any).men;
    expect((tB.detail as any).crewDays).toBe(9);
    expect(tB.qty).toBe(Math.round(m * 2 * 9 * 60 / RULES.travel.driveMph));
    expect(tA.qty).toBe(Math.round(m * 2 * dA * 60 / RULES.travel.driveMph));
    expect(b.suggestedInstallHours).toBe(a.suggestedInstallHours);   // suggestion: the builder's commute
  });

  it('a bad installDays is a blocker, not a silent guess', () => {
    for (const v of [0, 2.5, -1, 400, 'four']) expect(build(spec({ installDays: v })).blockers.join(' ')).toMatch(/installDays/);
  });
});

describe('installDays: shared trip (several installed items)', () => {
  const MEZZ = { type: 'mezzanine', lengthFt: 40, widthFt: 30, deckHeightFt: 12, stairs: 1, install: true, miles: 150 };
  const FS = { ...FSTR, capacityTons: 3, spanFt: 25, runwayOalFt: 60, overallHeightFt: 18, miles: 150 };
  const two = (a: Record<string, unknown>, b: Record<string, unknown>): QuoteSpec => ({ pwi_quote: 1, items: [{ ...FS, id: 'a', ...a } as any, { ...MEZZ, id: 'b', ...b } as any] });
  const d0 = build(two({}, {})).doc;
  const men = (travelDetail(d0, 'per_diem').detail as any).men as number;

  it('unset: no adjustment lines', () => expect(adjOf(d0)).toEqual([]));

  it('days on every item: each item gets its own line, the trip runs Σ days', () => {
    const d = build(two({ installDays: 4 }, { installDays: 3 })).doc;
    const adj = adjOf(d);
    expect(adj.map(l => l.ref).sort()).toEqual(['a:install/install-days-adjustment', 'b:install/install-days-adjustment']);
    const itemTasks = (i: number) => tasks(d).filter(l => l.item === i);
    expect(sum([...itemTasks(0), ...adj.filter(l => l.item === 0)])).toBe(men * 4 * HOURS_PER_DAY);
    expect(sum([...itemTasks(1), ...adj.filter(l => l.item === 1)])).toBe(men * 3 * HOURS_PER_DAY);
    const pd = travelDetail(d, 'per_diem').detail as any;
    expect(pd.crewDays).toBe(7);
    expect(equip(d).every(l => (l.detail as any).crewDays === 7)).toBe(true);
    expect(d.suggestedInstallHours).toBe(d0.suggestedInstallHours);
  });

  it('days on one item: the other adds its builder days', () => {
    const d = build(two({ installDays: 2 }, {})).doc;
    expect(adjOf(d)).toHaveLength(1);
    const pd = travelDetail(d, 'per_diem').detail as any;
    expect(pd.crewDays).toBeGreaterThan(2);
  });
});

describe('installDays through planRebuild (the editor\'s path)', () => {
  const d0 = build(spec()).doc;
  const days = ((travelDetail(d0, 'hotel').detail as any).crewDays as number) + 2;
  it('the plan shows the adjustment add and the travel / equipment updates; apply = a fresh build', () => {
    const plan = planRebuild(d0, spec({ installDays: days }), testCatalog, S);
    const adds = plan.specChanges.filter(c => c.change === 'add').map(c => c.ref);
    expect(adds).toContain('fs-1:install/install-days-adjustment');
    const upd = plan.specChanges.filter(c => c.change === 'update').map(c => c.ref);
    expect(upd).toEqual(expect.arrayContaining(['trip:travel-hotel', 'trip:travel-per_diem']));
    expect(plan.money.delta.total).toBeGreaterThan(0);
    const next = applyPlan(plan);
    const fresh = build(spec({ installDays: days })).doc;
    expect(priceManual({ ...next, freestandingShopHours: 0 }, S).quote).toEqual(priceManual({ ...fresh, freestandingShopHours: 0 }, S).quote);
    // back to unset → back to the builder's numbers
    const back = applyPlan(planRebuild(next, spec(), testCatalog, S));
    expect(adjOf(back)).toEqual([]);
    expect(price(back, S).quote).toEqual(price(d0, S).quote);
  });
  it('fewer days through the plan raises the approval', () => {
    const plan = planRebuild(d0, spec({ installDays: 2 }), testCatalog, S);
    expect(plan.flags.raised.map(f => f.rule)).toContain('INSTALL_BELOW_SUGGESTED');
  });
});
