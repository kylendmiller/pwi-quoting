import json,sys,re
def v(s,c):
  x=s.get(c); return None if x is None else x[1]
def rows(s):
  return sorted({int(re.sub(r'^[A-Z]+','',k)) for k in s if re.match(r'^[A-Z]+\d+$',k)})
def num(x):
  return x if isinstance(x,(int,float)) and not isinstance(x,bool) else 0
def dump(job):
  d=json.load(open(f'/home/claude/pwi-quoting/fixtures/{job}.json')); S=d['sheets']; out=[]
  P=lambda *a: out.append(' '.join(str(x) for x in a))
  ms=S.get('Main Summary',{})
  P(f"===== {job} {d['file']}")
  P('MS:', {r:round(num(v(ms,f'D{r}'))) for r in range(4,27) if num(v(ms,f'D{r}'))}, 'base',round(num(v(ms,'D31'))),'inst',round(num(v(ms,'D32'))),'frt',round(num(v(ms,'D33'))),'tot',round(num(v(ms,'D36'))))
  st=S.get('Structural',{})
  for r in rows(st):
    if num(v(st,f'B{r}')) and v(st,f'C{r}'): P(f" ST {v(st,f'A{r}')!s:22.22} {v(st,f'B{r}')} x {v(st,f'C{r}')} @ {v(st,f'D{r}')}' = {round(num(v(st,f'I{r}')))}")
  pl=S.get('Plate',{})
  for r in rows(pl):
    if num(v(pl,f'B{r}')) and num(v(pl,f'J{r}')): P(f" PL {v(pl,f'A{r}')!s:26.26} {v(pl,f'B{r}')} x {v(pl,f'C{r}')}x{v(pl,f'D{r}')}x{v(pl,f'E{r}')} = {round(num(v(pl,f'J{r}')))}")
  sp=S.get('Standard Parts & Products',{})
  for r in rows(sp):
    if num(v(sp,f'B{r}')) and num(v(sp,f'G{r}')): P(f" SP {v(sp,f'A{r}')!s:50.50} {v(sp,f'B{r}')} = {round(num(v(sp,f'G{r}')))}")
  vd=S.get('Hoist & Crane Vendor Items',{})
  for r in rows(vd):
    if num(v(vd,f'C{r}')) and num(v(vd,f'I{r}')): P(f" VD {v(vd,f'A{r}')!s:18.18} {v(vd,f'B{r}')!s:60.60} {v(vd,f'C{r}')} = {round(num(v(vd,f'I{r}')))}")
  cb=S.get('Cost Based Items',{})
  for r in rows(cb):
    if num(v(cb,f'B{r}')) and num(v(cb,f'F{r}')): P(f" CB {v(cb,f'A{r}')!s:50.50} {v(cb,f'B{r}')} x {v(cb,f'C{r}')} +{v(cb,f'E{r}')}% = {round(num(v(cb,f'F{r}')))}")
  lb=S.get('Labor',{})
  for r in rows(lb):
    if num(v(lb,f'B{r}')) and num(v(lb,f'D{r}')) and not str(v(lb,f'A{r}')).lower().startswith('total'): P(f" LS {v(lb,f'A{r}')!s:45.45} {v(lb,f'B{r}')}h = {round(num(v(lb,f'D{r}')))}  [C={v(lb,f'C{r}')}]")
    if num(v(lb,f'G{r}')) and num(v(lb,f'I{r}')) and not str(v(lb,f'F{r}')).lower().startswith('total'): P(f" LO {v(lb,f'F{r}')!s:45.45} {v(lb,f'G{r}')}h = {round(num(v(lb,f'I{r}')))}  [H={v(lb,f'H{r}')}]")
  for sh,q,t in [('Painting','B','D'),('Equipment','B','F'),('Travel Costs','B','D'),('Concrete','B','D')]:
    s=S.get(sh,{})
    for r in rows(s):
      if num(v(s,f'{q}{r}')) and any(num(v(s,f'{c}{r}')) for c in 'CDEFGH'): P(f" {sh[:2].upper()} {v(s,f'A{r}')!s:40.40} {v(s,f'{q}{r}')} | {[round(num(v(s,f'{c}{r}')),1) for c in 'CDEFG']}")
  w=d.get('wording') or ''
  if isinstance(w,list): w='\n---\n'.join(x if isinstance(x,str) else str(x) for x in w)
  P(' WORDING:', w.replace('\n',' / ')[:2500])
  return '\n'.join(out)
for j in sys.argv[1:]: print(dump(j))
