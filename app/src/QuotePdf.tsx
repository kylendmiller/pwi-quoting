// Customer PDF (QUOTATION / CONFIRMATION / CHANGE ORDER), laid out to match PWI's
// Sales Main Template quotes point-for-point (measured from sold quote 29140, US Letter).
// tests/pdf.test.tsx renders it and compares it to that reference, so layout can't drift.
import { Document, Page, Text, View, Image, Svg, Path, StyleSheet, Font, pdf } from '@react-pdf/renderer';
import type { Priced, QuoteDoc } from '../../src/engine/manual';
import { parseWording, type Block } from '../../src/engine/wordingFormat';
import SHIELD from './pwiShield.json';

let BASE = '/';
let registered = false;
/** Fonts and images load from `base` (a URL in the browser, a folder path in tests). */
export function registerPdfAssets(base: string) {
  BASE = base.endsWith('/') ? base : base + '/';
  Font.register({ family: 'Poppins', fonts: [
    { src: BASE + 'Poppins-ExtraLight.ttf', fontWeight: 200 }, { src: BASE + 'Poppins-Light.ttf', fontWeight: 300 },
    { src: BASE + 'Poppins-Regular.ttf', fontWeight: 400 }, { src: BASE + 'Poppins-Bold.ttf', fontWeight: 700 }] });
  Font.register({ family: 'Signature', src: BASE + 'Damion-Regular.ttf' });   // closest free match to Brush Script MT
  Font.registerHyphenationCallback(w => [w]);
  registered = true;
}
const PDF_IMAGES = new Set(['fstr', 'bridge', 'gantry']); // files in public/pdf — other names are skipped
const asset = (p: string) => BASE + p;

const ORANGE = '#FF6800', BLACK = '#000000';
const PT = 10.8;                         // body size used throughout the template
const st = StyleSheet.create({
  page: { fontFamily: 'Poppins', fontWeight: 200, fontSize: PT, color: BLACK, paddingTop: 36, paddingBottom: 56, paddingLeft: 44, paddingRight: 44 },
  abs: { position: 'absolute' },
  title: { fontSize: 15.6, fontWeight: 700, marginTop: 9.4, marginBottom: 14 },
  h: { fontSize: 13.8, fontWeight: 700, marginTop: 10, marginBottom: 15 },
  row: { flexDirection: 'row', fontSize: PT, lineHeight: 1.5 },
  o: { fontFamily: 'Courier', fontSize: PT, width: 22, marginLeft: 0.5, position: 'relative', top: 1.6 },
  dot: { fontFamily: 'Helvetica', fontSize: PT, width: 21.2, marginLeft: 36.1, position: 'relative', top: 1.6 },
  p: { marginLeft: 22, marginRight: 8, fontSize: PT, lineHeight: 1.51, marginBottom: 2 },
  footText: { position: 'absolute', top: 755.2, fontSize: PT, fontWeight: 400, color: '#FFFFFF' },
});
const usd = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
const longDate = (d: Date) => d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

const LEAD = 'The current ship date for your project will be approximately (15) weeks after PO is received. This includes (5) business days for the customer to review approval drawings, request any changes, and sign the final approval drawings. If signed approval drawings are delayed, the ship date will also be delayed. Lead times are determined by shop labor availability and are allocated on a first come, first served basis. For projects that are installed on-site by PWI personnel, the project completion date will be agreed upon by the customer and the PWI project manager. All labor, steel, and components are sold first come, first serve. Lead times shown are not guaranteed until a PO is received and may be adjusted based on capacity sold during the quote period.';
const TERMS = 'Terms: 35% Down with Purchase Order for orders over $25,000. Monthly progress payments may be issued as delivery and/or installation of each phase of the project is completed. Does not include any applicable tax unless noted. Customer is responsible to provide an ST-105 form to avoid sales tax. Final payment due upon completion. A 2% finance charge will apply for all overdue payments.';
const ACCEPT = 'This signifies that I have read the above quotation including customer provisions and terms. I agree to make timely payments as stated in Terms and understand that PWI reserves the right to place a hold on installation of components  until payment(s) are received.';

function Shield({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  return <Svg viewBox={SHIELD.viewBox} style={{ position: 'absolute', left: x, top: y, width: w, height: h }}><Path d={SHIELD.d} fill={BLACK} fillRule="evenodd" /></Svg>;
}

/** Page frame + black footer bar, repeated on every page. */
function Chrome() {
  return <>
    <View fixed style={{ position: 'absolute', left: 24.5, top: 15.5, width: 563, height: 760, borderWidth: 1.8, borderColor: BLACK }} />
    <View fixed style={{ position: 'absolute', left: 25, top: 754.5, width: 563, height: 21, backgroundColor: BLACK }} />
    <Text fixed style={[st.footText, { left: 94.3 }]}>pwiworks.com</Text>
    <Image fixed src={asset('pdf/phone.png')} style={{ position: 'absolute', left: 234.4, top: 758.1, width: 102.4, height: 8.5 }} />
    <Text fixed style={[st.footText, { left: 397.9 }]}>CONQUER YOUR SPACE</Text>
  </>;
}

function Title({ text }: { text: string }) {
  const m = /^(\(\d+\)\s*-?\s*)?(IN)(COMMAND)(.*)$/.exec(text);
  if (!m) return <Text style={st.title}>{text}</Text>;
  return <Text style={st.title}>{m[1] ?? ''}IN<Text style={{ fontWeight: 400 }}>COMMAND</Text>{m[4]}</Text>;
}

function Wording({ blocks }: { blocks: Block[] }) {
  return <>{blocks.map((b, i) => {
    switch (b.t) {
      case 'title': return <Title key={i} text={b.text} />;
      case 'h': return <Text key={i} style={st.h} minPresenceAhead={40}>{b.text}</Text>;
      case 'b': return <View key={i} style={st.row} wrap={false}><Text style={st.o}>o</Text><Text style={{ flex: 1 }}>{b.text}</Text></View>;
      case 'b2': return <View key={i} style={st.row} wrap={false}><Text style={st.dot}>•</Text><Text style={{ flex: 1 }}>{b.text}</Text></View>;
      case 'kv': return <View key={i} style={st.row} wrap={false}><Text style={[st.o, { marginLeft: 4.8 }]}>o</Text><Text style={{ width: 114.3 }}>{b.k}</Text><Text style={{ flex: 1, fontWeight: 400 }}>{b.v}</Text></View>;
      case 'p': return <Text key={i} style={st.p}>{b.text}</Text>;
      case 'img': return !PDF_IMAGES.has(b.name) ? null : <Image key={i} src={asset(`pdf/${b.name}.jpg`)} style={{ width: 460, height: 165, marginTop: 10, marginLeft: 27 }} />;
      case 'gap': return <View key={i} style={{ height: 6 }} />;
    }
  })}</>;
}

export function QuoteDocPdf({ quote, rev, doc, priced, me, number }: { quote: any; rev: any; doc: QuoteDoc; priced: Priced; me: { full_name: string; title: string }; number: string }) {
  if (!registered) registerPdfAssets('/');
  const q = priced.rollup.quote;
  const isQuote = rev.doc_type === 'QUOTATION';
  const rows: [string, number | null][] = [['Base Price (per above specs)', q.base], ['Installation Charges', q.installation], ['Outbound Freight Charges', q.freight],
    q.preUse != null ? ['Pre-Use Inspections and Load Tests', q.preUse] : ['', null], ['Sales Tax', q.tax]];
  const total = rows.reduce((s, [, v]) => s + Math.round(v ?? 0), 0);     // total = sum of the printed (rounded) rows
  const head: [string, string][] = [['Date:', longDate(new Date(rev.sent_at ?? Date.now()))], ['Company:', quote.customers?.name ?? ''], ['Attention:', quote.contacts?.name ?? ''],
    ['Project:', quote.project_name ?? ''], ['Job Location:', quote.job_location ?? ''], ['PO Number:', (doc as any).poNumber ?? ''], ['Job #:', quote.job_id ?? '']];
  const blocks = parseWording(doc.wording);
  return (
    <Document title={`${number} - ${quote.project_name} - ${rev.doc_type} R${rev.rev}`} author="PWI Corp" creator="PWI Quotes" producer="PWI Quotes">
      <Page size="LETTER" style={st.page}>
        <Chrome />
        {!rev.locked && <Text fixed style={{ position: 'absolute', top: 330, left: 120, fontSize: 110, fontWeight: 700, color: '#D4D7DA', opacity: 0.45, transform: 'rotate(-30deg)' }}>DRAFT</Text>}

        {/* page-1 header, placed in page coordinates */}
        <View style={{ marginTop: -36, marginLeft: -44, marginRight: -44, height: 186, position: 'relative' }}>
          {head.map(([k, v], i) => <View key={k} style={{ position: 'absolute', top: 29.2 + i * 17.0, left: 0, flexDirection: 'row' }}>
            <Text style={{ width: 104.6, textAlign: 'right', fontWeight: 400 }}>{k}</Text>
            <Text style={{ marginLeft: 3, fontWeight: 400 }}>{v}</Text></View>)}
          <Shield x={462} y={49} w={92} h={98} />
          <Text style={{ position: 'absolute', left: 28.9, top: 148.9, fontSize: 19.6, fontWeight: 700, color: ORANGE }}>{rev.doc_type}</Text>
          <View style={{ position: 'absolute', left: 26, top: 178, width: 562, height: 2, backgroundColor: BLACK }} />
        </View>

        <Wording blocks={blocks} />

        {/* closing page, placed in page coordinates like the template */}
        <View break style={{ marginTop: -36, marginLeft: -44, marginRight: -44, height: 690, position: 'relative' }}>
          <Text style={{ position: 'absolute', left: 31, top: 34.2, width: 550, fontSize: 8.8, lineHeight: 2.0, textAlign: 'center' }}>{LEAD}</Text>
          {isQuote && <Text style={{ position: 'absolute', left: 31, top: 154.2, width: 550, textAlign: 'center' }}>This quote is valid for 15 days.</Text>}
          {rows.map(([k, v], i) => v == null ? null : <View key={i} style={{ position: 'absolute', left: 110.8, top: 202.8 + i * 21, width: 458.5, flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontWeight: 400 }}>{k}</Text><Text style={{ fontWeight: 400 }}>{usd(v)}</Text></View>)}
          <View style={{ position: 'absolute', left: 110.8, top: 307.8, width: 458.5, flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontWeight: 700 }}>Total Package Price</Text><Text style={{ fontWeight: 700 }}>{usd(total)}</Text></View>
          {doc.options.filter(o => o.description).map((o, i) => <View key={'o' + i} style={{ position: 'absolute', left: 110.8, top: 335 + i * 21, width: 458.5, flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontWeight: 400 }}>Option {i + 1}: {o.description}</Text><Text style={{ fontWeight: 400 }}>{usd(o.price)}</Text></View>)}
          <Text style={{ position: 'absolute', left: 35, top: 419.2, width: 541, fontSize: PT, lineHeight: 1.98 }}>{TERMS}</Text>
          <Text style={{ position: 'absolute', left: 45.5, top: 501, fontFamily: 'Signature', fontSize: 31 }}>{me.full_name}</Text>
          <Text style={{ position: 'absolute', left: 42.6, top: 549.8 }}>{me.title}</Text>
          <Shield x={484} y={517} w={70} h={73} />
          {isQuote && <Text style={{ position: 'absolute', left: 44.3, top: 572.2, fontSize: 19.6, fontWeight: 700 }}>Project Acceptance</Text>}
          <Text style={{ position: 'absolute', left: 34.6, top: 609.6, width: 535, fontSize: 7.8, lineHeight: 2.03 }}>{ACCEPT}</Text>
          {isQuote && <>
            <Text style={{ position: 'absolute', left: 35, top: 647.8 }}>Purchase Order Number: __________________</Text>
            <Text style={{ position: 'absolute', left: 35, top: 668.7, fontSize: PT, lineHeight: 1.305 }}>{'Sales Tax on this project: (please mark X on the appropriate option below)\nSales Tax exempt form included _____   I will be paying Sales Tax on all components _____'}</Text>
            <Text style={{ position: 'absolute', left: 35, top: 704.8 }}>Circle options above (if any) and confirm Grand Total Price $ _________________</Text>
            <View style={{ position: 'absolute', left: 35, top: 728.7, width: 540, flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text>Customer Signature _____________________________________________</Text><Text>Date___________</Text></View>
          </>}
        </View>
      </Page>
    </Document>
  );
}

export async function downloadPdf(p: Parameters<typeof QuoteDocPdf>[0]) {
  const blob = await pdf(<QuoteDocPdf {...p} />).toBlob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${p.number} - ${p.quote.project_name} - ${p.rev.doc_type === 'QUOTATION' ? 'Quote' : p.rev.doc_type === 'CONFIRMATION' ? 'Confirmation' : 'Change Order'} R${p.rev.rev}.pdf`.replace(/[\\/:*?"<>|]/g, '-');
  a.click();
}
