// Branded customer PDF (QUOTATION / CONFIRMATION / CHANGE ORDER). Same layout as the SMT Quote tab.
import { Document, Page, Text, View, Image, StyleSheet, Font, pdf } from '@react-pdf/renderer';
import type { Priced, QuoteDoc } from '../../src/engine/manual';
import type { Profile } from './main';

Font.register({ family: 'Poppins', fonts: [
  { src: '/Poppins-Regular.ttf' }, { src: '/Poppins-Bold.ttf', fontWeight: 700 }, { src: '/Poppins-Light.ttf', fontWeight: 300 }] });
Font.registerHyphenationCallback(w => [w]);

const O = '#FF6800', C = '#81858B', S = '#D4D7DA';
const st = StyleSheet.create({
  page: { fontFamily: 'Poppins', fontSize: 9, padding: 36, paddingBottom: 54, color: '#000' },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  logo: { width: 54 },
  title: { fontSize: 20, fontWeight: 700, color: O, letterSpacing: 1 },
  kv: { flexDirection: 'row', marginBottom: 1 }, k: { width: 70, color: C }, v: { flex: 1 },
  box: { border: `1pt solid ${S}`, padding: 10, marginTop: 10 },
  section: { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', borderBottom: `2pt solid ${O}`, paddingBottom: 2, marginTop: 12, marginBottom: 6 },
  pRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, borderBottom: `0.5pt solid ${S}` },
  pHead: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: O, color: '#fff', fontWeight: 700, padding: 4 },
  total: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, fontWeight: 700, fontSize: 11 },
  small: { fontSize: 8, color: C },
  footer: { position: 'absolute', bottom: 20, left: 36, right: 36, flexDirection: 'row', justifyContent: 'space-between', fontSize: 8, color: C },
});
const usd = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
const TERMS = 'Terms: 35% Down with Purchase Order for orders over $25,000. Monthly progress payments may be issued as delivery and/or installation of each phase of the project is completed. Does not include any applicable tax unless noted. Customer is responsible to provide an ST-105 form to avoid sales tax. Final payment due upon completion. A 2% finance charge will apply for all overdue payments.';

function QuoteDocPdf({ quote, rev, doc, priced, me, number }: { quote: any; rev: any; doc: QuoteDoc; priced: Priced; me: Profile; number: string }) {
  const q = priced.rollup.quote;
  const isConf = rev.doc_type !== 'QUOTATION';
  const rows: [string, number][] = [['Base Price (per above specs)', q.base], ['Installation Charges', q.installation], ['Outbound Freight Charges', q.freight]];
  if (q.preUse != null) rows.push(['Pre-Use Inspections and Load Tests', q.preUse]);
  rows.push(['Sales Tax', q.tax]);
  const total = rows.reduce((s, [, v]) => s + Math.round(v), 0);   // total = sum of printed (rounded) rows
  const date = new Date(rev.sent_at ?? Date.now()).toLocaleDateString('en-US');
  return (
    <Document title={`${number} - ${quote.project_name} - ${rev.doc_type} R${rev.rev}`} author="PWI Corp">
      <Page size="LETTER" style={st.page}>
        <View style={st.head}>
          <View style={{ flex: 1 }}>
            <View style={st.kv}><Text style={st.k}>Date:</Text><Text style={st.v}>{date}</Text></View>
            <View style={st.kv}><Text style={st.k}>Company:</Text><Text style={st.v}>{quote.customers?.name}</Text></View>
            <View style={st.kv}><Text style={st.k}>Attention:</Text><Text style={st.v}>{quote.contacts?.name ?? ''}</Text></View>
            <View style={st.kv}><Text style={st.k}>Project:</Text><Text style={st.v}>{quote.project_name}</Text></View>
            <View style={st.kv}><Text style={st.k}>Job Location:</Text><Text style={st.v}>{quote.job_location ?? ''}</Text></View>
            <View style={st.kv}><Text style={st.k}>{quote.job_id ? 'Job #:' : 'Quote #:'}</Text><Text style={st.v}>{number}  ·  R{rev.rev}</Text></View>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Image src="/pwi-logo.png" style={st.logo} />
            <Text style={st.title}>{rev.doc_type}</Text>
          </View>
        </View>

        <View style={st.box}>{doc.wording.split('\n').map((line, i) => {
          const m = /^([^\t]+?)\t+(.*)$/.exec(line);
          return m ? <View key={i} style={{ flexDirection: 'row' }}><Text style={{ width: 170 }}>{m[1].trim()}</Text><Text style={{ flex: 1 }}>{m[2].trim()}</Text></View>
            : <Text key={i} style={/^[A-Z0-9 ()\-'".,&/]+$/.test(line.trim()) && line.trim().length > 3 ? { fontWeight: 700 } : {}}>{line || ' '}</Text>;
        })}</View>

        <View wrap={false}>
          <Text style={st.section}>Pricing</Text>
          <View style={st.pHead}><Text>Description</Text><Text>Price</Text></View>
          {rows.map(([k, v]) => <View key={k} style={st.pRow}><Text>{k}</Text><Text>{usd(v)}</Text></View>)}
          <View style={st.total}><Text>TOTAL PACKAGE PRICE</Text><Text>{usd(total)}</Text></View>
          {doc.options.filter(o => o.description).map((o, i) => <View key={i} style={st.pRow}><Text>Option {i + 1}: {o.description}</Text><Text>{usd(o.price)}</Text></View>)}
        </View>

        <View wrap={false}>
          <Text style={st.section}>Terms</Text>
          <Text>{TERMS}</Text>
          {!isConf && <Text style={{ marginTop: 4 }}>This quote is valid for 15 days.</Text>}
          <Text style={{ marginTop: 8, fontWeight: 700 }}>{me.full_name}</Text>
          <Text style={st.small}>{me.title}</Text>
        </View>

        {!isConf && <View wrap={false}>
          <Text style={st.section}>Project Acceptance</Text>
          <Text>This signifies that I have read the above quotation including customer provisions and terms. I agree to make timely payments as stated in Terms and understand that PWI reserves the right to place a hold on installation of components until payment(s) are received.</Text>
          <Text style={{ marginTop: 10 }}>Purchase Order Number: __________________</Text>
          <Text style={{ marginTop: 6 }}>Sales Tax exempt form included _____   I will be paying Sales Tax on all components _____</Text>
          <Text style={{ marginTop: 6 }}>Circle options above (if any) and confirm Grand Total Price $ _________________</Text>
          <Text style={{ marginTop: 14 }}>Customer Signature _____________________________________________   Date ___________</Text>
        </View>}

        <View style={st.footer} fixed>
          <Text>pwiworks.com     574.646.2015</Text>
          <Text style={{ color: O, fontWeight: 700 }}>CONQUER YOUR SPACE</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
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
