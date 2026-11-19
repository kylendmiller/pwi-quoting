# Compare text lines (page, text start, x, y, font, size) between the reference PDF and ours.
import sys, re, pdfplumber
def lines(path):
    out = []
    with pdfplumber.open(path) as pdf:
        for pn, p in enumerate(pdf.pages):
            for l in p.extract_text_lines(return_chars=True):
                t = re.sub(r'\s+', ' ', l['text']).strip()
                if not t or t.startswith('PWI Standard') or t == 'DRAFT' or t.startswith('pwiworks'): continue
                ch = [c for c in l['chars'] if c['text'].strip()]
                f = ch[-1]['fontname'].split('+')[-1] if ch else ''
                out.append((pn + 1, t, l['x0'], l['top'], f, round(ch[-1]['size'], 1) if ch else 0))
    return out
ref, ours = lines(sys.argv[1]), lines(sys.argv[2])
nref = max(r[0] for r in ref); nours = max(o[0] for o in ours)
fam = lambda f: 'Poppins' if f.startswith('Poppins') else f
key = lambda t: re.sub(r'[^a-z0-9]', '', t.lower())[:18]
used = set(); worst = 0; rows = []
for r in ref:
    cand = [o for i, o in enumerate(ours) if i not in used and key(o[1]) == key(r[1])]
    if not cand: rows.append(f"MISSING p{r[0]} y{r[3]:6.1f} {r[1][:60]}"); continue
    o = min(cand, key=lambda o: abs(o[3] - r[3]) + 1000 * abs(o[0] - r[0])); used.add(ours.index(o))
    dy, dx = o[3] - r[3], o[2] - r[2]
    pagebad = o[0] != r[0]
    fixed = r[0] == 1 and r[3] < 180 or r[0] == nref     # page-1 header and closing page are fixed layout
    if fixed and not r[4].startswith('Brush'): worst = max(worst, abs(dy) if not pagebad else 99)
    if not r[4].startswith('Brush') and (abs(dx) > 4 or fam(r[4]) != fam(o[4]) or abs(r[5] - o[5]) > 0.2): worst = max(worst, 98)
    flag = '  ' if abs(dy) < 3 and abs(dx) < 4 and not pagebad else '!!'
    rows.append(f"{flag} p{r[0]}->{o[0]} dy{dy:+6.1f} dx{dx:+6.1f} {r[4][:14]:14}/{o[4][:14]:14} {r[5]}/{o[5]} {r[1][:50]}")
missing = sum(1 for r in rows if r.startswith('MISSING'))
print('\n'.join(rows)); print(f"PAGES ref={nref} ours={nours} MISSING={missing}"); print(f"WORST_DY={worst:.1f}")
if nref != nours: print('WORST_DY=97')
