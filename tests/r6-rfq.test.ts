// Website RFQ → spec: parse the RFQs.autoRFQdetails block, map configurator fields, build a draft.
import { describe, it, expect } from 'vitest';
import { parseRfqDetails, configuratorSpec, milesFromState, pct } from '../src/engine/rfq';
import { buildFromSpec } from '../src/engine/buildSpec';
import { testCatalog } from './catalog';
import { CAL_SETTINGS } from './calibration/harness';

const block = (form: string, body: string) => `# Customer Details\n\nCustomer: **Acme Co**\nContact: **Jane Doe**\nEmail: **jane@acme.com**\nPhone: **(330) 449-3482**\n\n# Project Details\n\nAddress: **4255 Lincoln Way East, Wooster, Ohio 44691-8669 (US)**\nProject Timeline: **Requested quote by November 30, 2026**\n\n# ${form}\n\n${body}\n\n\n\n# RFQ Details\n\nSubmission ID: **3862**\nReferrer: **https://pwiworks.com/**\n`;
const BRIDGE = block('PWI: Crane Configurator', 'Price estimate: Starting at $40,000  \nMovement type: 3 Axis (Bridge)  \nSeries: INCOMMAND (Motorized)  \nCapacity: 3 T  \nMount option: Floor mounted  \nBridge quantity: 1  \nLength: 100  \nSpan: 29  \nOverall height: 16  \nBuilding voltage: 460V/3 Phase\n\nRemove 1 ton bridge crane and relocate.');
const MONO = block('PWI: Crane Configurator', 'Movement type: Straight (Monorail)  \nSeries:  \nCapacity: 2 T  \nMount option: Floor mounted  \nSupport spans: 10  \nLength: 12  \nSpan: 12  \nOverall height: 10  \nBuilding voltage: Not sure\n\nBulk bags over a hopper');
const GANTRY = block('PWI: Crane Configurator', 'Movement type: Mobile (Gantry)  \nSeries: INCOMMAND (Motorized)  \nCapacity: 5 T  \nTrack length: 20  \nSpan: 20  \nOverall height: 20  \nBuilding voltage: Not sure\n\nTrackless if possible.');
const AERO = block('PWI: Crane Configurator', 'Movement type: 3 Axis (Bridge)  \nSeries: AERO (Manual Work Cell)  \nCapacity: 1000 LB  \nLength: 15  \nSpan: 15  \nOverall height: 10');
const FREE = block('PWI: RFQ', 'Looking for 2 top running bridge cranes, 15 ton each, 80 long 30 wide 18 high.');

describe('parse the RFQ block', () => {
  it('reads customer, contact, address and the form fields', () => {
    const p = parseRfqDetails(BRIDGE);
    expect(p).toMatchObject({ customer: 'Acme Co', contact: 'Jane Doe', email: 'jane@acme.com', city: 'Wooster', state: 'Ohio', zip: '44691', form: 'PWI: Crane Configurator' });
    expect(p.fields['movement type']).toBe('3 Axis (Bridge)');
    expect(p.fields['span']).toBe('29');
    expect(p.note).toMatch(/Remove 1 ton/);
  });
  it('free-text RFQ keeps its note and has no configurator fields', () => {
    const p = parseRfqDetails(FREE);
    expect(p.form).toBe('PWI: RFQ'); expect(p.note).toMatch(/15 ton/);
  });
});

describe('configurator → spec → draft quote', () => {
  const build = (md: string) => { const r = configuratorSpec(parseRfqDetails(md), 250); return { ...r, doc: r.spec && (buildFromSpec(r.spec, testCatalog, CAL_SETTINGS, { lines: [], options: [] } as any).doc as any) }; };
  it('floor-mounted bridge → freestanding, motorized, priced', () => {
    const r = build(BRIDGE);
    expect(r.spec!.items[0]).toMatchObject({ type: 'freestanding', spanFt: 29, runwayOalFt: 100, overallHeightFt: 16, capacityTons: 3, bridgeDrive: 'motorized', voltage: '460V/3', install: true, miles: 250 });
    expect(r.doc.lines.length).toBeGreaterThan(10);
  });
  it('monorail with "Not sure" voltage defaults to 460 and says so', () => {
    const r = build(MONO);
    expect(r.spec!.items[0]).toMatchObject({ type: 'monorail', lengthFt: 12, capacityTons: 2, support: 'freestanding', voltage: '460V/3' });
    expect(r.assumed.join(' ')).toMatch(/460V\/3/);
    expect(r.doc.lines.length).toBeGreaterThan(3);
  });
  it('gantry builds', () => {
    const r = build(GANTRY);
    expect(r.spec!.items[0]).toMatchObject({ type: 'gantry', capacityTons: 5, spanFt: 20, heightUnderBeamFt: 20, motorized: true });
    expect(r.doc.lines.length).toBeGreaterThan(3);
  });
  it('AERO and free text are skipped with a reason', () => {
    expect(build(AERO).skip).toMatch(/AERO/);
    expect(build(FREE).skip).toMatch(/Not a configurator/);
  });
});

describe('helpers', () => {
  it('miles by state are in the right range', () => {
    expect(milesFromState('Ohio')).toBeGreaterThan(150); expect(milesFromState('Ohio')).toBeLessThan(300);
    expect(milesFromState('CA')).toBeGreaterThan(2000);
  });
  it('reads the AI score', () => { expect(pct('85% Serious Inquiry\n\nReasoning')).toBe(85); expect(pct('')).toBeUndefined(); });
});

import { stateOf, tableFare } from '../src/engine/airfare';
describe('SBN fare table', () => {
  it('reads the state from a location', () => {
    expect(stateOf('3931 Carbon Plant Road, Ozark, Arkansas 72949-8803 (US)')).toBe('AR');
    expect(stateOf('Tulsa, OK 74107')).toBe('OK');
    expect(stateOf('Charleston, West Virginia')).toBe('WV');
  });
  it('picks the nearest surveyed airport', () => {
    expect(tableFare({ state: 'GA' })?.code).toBe('ATL');
    expect(tableFare({ state: 'Massachusetts' })?.code).toBe('BOS');
    expect(tableFare({ state: 'LA' })?.fare).toBe(374);     // MSY at its usual price, not the $1,132 survey spike
    expect(tableFare({})).toBeUndefined();
  });
});
