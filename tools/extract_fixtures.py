"""Build tier-1 test fixtures from real sold quotes (Sales Main Template files).

Usage: python3 tools/extract_fixtures.py <dir with .xlsx/.xlsm> <out_dir>
For each SMT-style workbook it keeps, per data sheet, every non-empty cell as
[formula or null, cached value]. Tests use the formulas to find rows of a kind
and the cached values as the expected answers.
"""
import json, os, sys, glob, re, zipfile, datetime
from lxml import etree

NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
      'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
      'xdr': 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing',
      'a': 'http://schemas.openxmlformats.org/drawingml/2006/main'}
KEEP = {'Quote', 'Main Summary', 'Standard Parts & Products', 'Hoist & Crane Vendor Items', 'Cost Based Items',
        'Stairways', 'Structural', 'Plate', 'Painting', 'Labor', 'Equipment', 'Travel Costs', 'Pre-use Load Test', 'VRC', 'Concrete'}

def rels(z, path):
    d, b = os.path.split(path); rp = f"{d}/_rels/{b}.rels"
    if rp not in z.namelist(): return {}
    out = {}
    for r in etree.fromstring(z.read(rp)):
        t = r.get('Target')
        out[r.get('Id')] = (r.get('Type').rsplit('/', 1)[-1], t if t.startswith('http') else os.path.normpath(os.path.join(d, t)))
    return out

def extract(fp):
    z = zipfile.ZipFile(fp)
    ss = [''.join(si.itertext()) for si in etree.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si', NS)] if 'xl/sharedStrings.xml' in z.namelist() else []
    wb = etree.fromstring(z.read('xl/workbook.xml')); wr = rels(z, 'xl/workbook.xml')
    sheets = {}
    words = []
    for s in wb.find('m:sheets', NS):
        name = s.get('name'); path = wr[s.get('{%s}id' % NS['r'])][1]
        if name not in KEEP: continue
        x = etree.fromstring(z.read(path)); cells = {}
        for c in x.iter('{%s}c' % NS['m']):
            v, f, t = c.find('m:v', NS), c.find('m:f', NS), c.get('t')
            if v is None: continue
            if t == 's': val = ss[int(v.text)]
            elif t == 'b': val = bool(int(v.text))
            elif t in ('str', 'e'): val = v.text
            else:
                try: val = float(v.text)
                except Exception: val = v.text
            if val in (None, '', 0, 0.0) and f is None: continue
            ftxt = f.text if (f is not None and f.text) else (None if f is None else '<shared>')
            cells[c.get('r')] = [ftxt, val]
        sheets[name] = cells
        if name == 'Quote':
            for rid, (typ, tgt) in rels(z, path).items():
                if typ == 'drawing' and tgt in z.namelist():
                    d = etree.fromstring(z.read(tgt))
                    for sp in d.iter('{%s}sp' % NS['xdr']):
                        txt = '\n'.join(''.join(t.text or '' for t in p.iter('{%s}t' % NS['a'])) for p in sp.iter('{%s}p' % NS['a'])).strip()
                        if txt: words.append(txt)
    return {'sheets': sheets, 'wording': words}

src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
files = sorted(glob.glob(os.path.join(src, '**', '*.xls[xm]'), recursive=True))
index = []
for fp in files:
    try:
        d = extract(fp)
    except Exception as e:
        print('ERR', fp, e); continue
    s = d['sheets']
    if not ({'Quote', 'Main Summary', 'Labor'} <= set(s)): continue
    parts = fp.split(os.sep)
    job = next((p[:5] for p in parts if re.match(r'^\d{5}', p)), 'unknown')
    aqt = 'Main Summary' in s and 'C26' in s['Main Summary'] and 'D31' not in s['Main Summary']
    d.update(job=job, file=os.path.basename(fp), aqt=aqt)
    name = f"{job}.json"
    with open(os.path.join(out, name), 'w') as f: json.dump(d, f, default=str)
    index.append({'job': job, 'file': os.path.basename(fp), 'aqt': aqt})
json.dump(index, open(os.path.join(out, 'index.json'), 'w'), indent=1)
print(len(index), 'fixtures;', sum(1 for i in index if not i['aqt']), 'SMT,', sum(1 for i in index if i['aqt']), 'AQT')
