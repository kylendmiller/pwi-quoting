"""Build seed SQL for settings + reference tables from reference/*.json."""
import json, os
R = 'reference'
def q(v):
    if v is None: return 'null'
    if isinstance(v, bool): return 'true' if v else 'false'
    if isinstance(v, (int, float)): return repr(round(v, 6))
    return "'" + str(v).replace("'", "''") + "'"
out = []
settings = {
  'shop_rate': (140, 'Shop labor $/hr'),
  'onsite_rate': (113, 'On-site labor $/hr (before adders)'),
  'onsite_adders': ({'A': 30, 'B': 15, 'C': 30}, 'On-site wage adders $/hr (names to confirm)'),
  'pm_rate': (95, 'Project management $/hr'), 'cad_rate': (120, 'AutoCAD design $/hr'), 'pe_rate': (180, 'P.E. calcs $/hr'),
  'production_factor': ({'freestanding': .56, 'stairs': .65, 'bridge': .68, 'gantry': .69, 'monorail': .70, 'fall_protection': .70,
                         'vrc': .73, 'jib': .77, 'rv_rotator': .81, 'work_platform': .82, 'mezzanine': .60, 'other': .76}, 'Shop hours = SMT-method hours x factor'),
  'install_factor': ({'jib': 1.25, 'stairs': 1.22, 'mezzanine': 1.11, 'gantry': 1.09, 'fall_protection': 1.09, 'freestanding': 1.02,
                      'monorail': 1.02, 'vrc': 1.02, 'bridge': 1.0, 'rv_rotator': .99, 'work_platform': .95, 'other': .98}, 'Suggested install x factor'),
  'cad_factor': ({'mezzanine': 1.40, 'stairs': 1.40, 'other': 1.28, 'rv_rotator': 1.19, 'work_platform': 1.13, 'jib': 1.11,
                  'fall_protection': 1.03, 'freestanding': .98, 'gantry': .97, 'monorail': .97, 'bridge': .86}, 'CAD hours x factor'),
  'freestanding_pv_per_shop_hour': (38.60, 'Freestanding Production Value $ per quoted shop hour (internal, 100% GM)'),
  'one_pct_adder': ({'on': True}, 'Hidden 1% adder on material lines (SMT C column)'),
  'install_multiplier': (1.01, 'SMT applies x1.01 to installation'),
  'structural_markup_pct': (26, 'Structural steel markup %'),
  'plate_price_per_lb': (1.35, 'Plasma plate $/lb'), 'plate_markup_pct': (21, 'Plate markup %'), 'plate_drop_factor': (1.1, 'Plate drop/waste'),
  'sales_tax_rate': (0.07, 'Indiana sales tax'),
  'freight_markup': (0.20, 'Outbound freight markup'),
  'collision_avoidance_hours_per_bridge': (20, 'Kyle 11/19'),
  'default_radio_brand': ('Starke', 'Kyle 11/19'),
  'quote_valid_days': (15, 'Quote validity'),
  'steel_cost': (json.load(open('src/engine/rules/steel_cost.default.json')), 'Dated steel $/lb by price group — update weekly from the steel brief (tools/steel-cost-from-brief.md)'),
  'banned_strings': (["Paul's Welding", 'xx', ' OR ', '?'], 'Wording that blocks sending'),
  'min_gm_pct': (0.25, 'Gross margin below this needs a sales manager (MIN_GM)'),
  'max_discount_pct': (0.10, 'Discount (dealer % + credit lines) above this needs a sales manager (BIG_DISCOUNT)'),
  'std_parts_default_gm_pct': (0.30, 'GM used to cost a standard part whose std_parts.gm_pct is blank'),
}
for k, (v, d) in settings.items():
    out.append(f"insert into settings(key,value,description) values ({q(k)}, {q(json.dumps(v))}::jsonb, {q(d)}) on conflict (key) do update set value=excluded.value, description=excluded.description;")
g = json.load(open(f'{R}/steel_price_groups.json'))
out.append('insert into steel_price_groups(code,price_per_lb,updated) values ' + ','.join(f"({q(k)},{q(v['price_per_lb'])},{q(v['updated'])})" for k, v in g.items()) + ' on conflict do nothing;')
sh = json.load(open(f'{R}/steel_shapes.json'))
seen=set(); rows=[]
for s in sh:
    if s['shape'] in seen or s['group'] not in g: continue
    seen.add(s['shape']); rows.append(f"({q(s['shape'])},{q(s['group'])},{q(s['lb_per_ft'])})")
out.append('insert into steel_shapes(shape,price_group,lb_per_ft) values ' + ','.join(rows) + ' on conflict do nothing;')
sp = json.load(open(f'{R}/standard_parts.json'))
out.append('insert into std_parts(section,description,vendor,part,sell,shop_hours_each,gm_pct,price_updated) values ' + ','.join(
  f"({q(x['section'])},{q(x['description'])},{q(x['vendor'])},{q(x['part'])},{q(x['sell'])},{q(x['shop_hours_each'] if isinstance(x['shop_hours_each'],(int,float)) else None)},{q(x['gm_pct'] if isinstance(x['gm_pct'],(int,float)) else None)},{q(x['price_updated'] if isinstance(x['price_updated'],str) and x['price_updated'][:2]=='20' else None)})" for x in sp) + ';')
vp = json.load(open(f'{R}/vendor_price_lists.json'))
out.append('insert into vendor_discounts values ' + ','.join(f"({q(k)},{q(v['default_pwi_discount_pct'])},{q(v['default_customer_discount_pct'])})" for k, v in vp.items()) + ' on conflict do nothing;')
labor = [('cut_list','shop','Cut list','job',2),('col_fab','shop','Column fab (no gussets)','column',1),('col_fab_gusset','shop','Column fab (with gussets)','column',2.5),
 ('col_fab_tapered','shop','Tapered column fab','column',8),('pcr_runway_short','shop',"PCR runway <20'",'runway beam',1),('pcr_runway_long','shop',"PCR runway >20'",'runway beam',2),
 ('web_stiffeners','shop','Web stiffeners on runway beam','beam',1),('asce_rail_shop','shop','ASCE rail in shop','5 ft',0.25),('pcr_header','shop','PCR header / crossmember','piece',None),
 ('manual_bridge_fab','shop','Manual bridge fab','bridge',20),('manual_bridge_ap','shop','Manual bridge after-paint assembly','bridge',8),
 ('sg_bridge_fab','shop','Single girder motorized bridge fab','bridge',50),('sg_bridge_ap','shop','Single girder bridge after-paint assembly','bridge',70),
 ('dg_bridge_fab','shop','Double girder bridge fab','bridge',55),('dg_bridge_ap','shop','Double girder bridge after-paint assembly','bridge',55),
 ('box_girder_fab','shop','Box girder fab','ft',2),('collision_avoid_shop','shop','Collision avoidance','bridge',20),('handling','shop','Handling / shipping','ton',2),
 ('site_setup','site','Unload, set up, layout','job',10),('site_column','site','Install crane column','column',3),('site_runway','site','Install runway beam / splice','runway',3),
 ('site_bracing','site','Install bracing','location',1),('site_asce_rail','site','Install ASCE rail','100 ft',16),('site_end_stops','site','Install runway end stops','set of 4',2),
 ('site_electrification','site','Install electrification','100 ft',5.8),('site_bridge_manual','site','Install manual bridge','bridge',6),
 ('site_bridge_mot_small','site','Install motorized bridge <8k lb','bridge',12),('site_bridge_mot_large','site','Install motorized bridge >8k lb','bridge',18),
 ('site_collision_avoid','site','Collision avoidance','bridge',12.5),('site_touchup','site','Paint touch-up + cleanup','job',20),('site_travel','site','Travel','job',None),
 ('site_difficulty','site','Site Difficulty Allowance (reason required)','job',None),('shop_other','shop','Other shop labor (describe)','hour',1),('site_other','site','Other on-site labor (describe)','hour',1)]
out.append('insert into labor_ops(code,side,name,unit,hours_per_unit) values ' + ','.join(f"({q(a)},{q(b)},{q(c)},{q(d)},{q(e)})" for a,b,c,d,e in labor) + ' on conflict do nothing;')
ri=[]
for kind, f, pk in [('painting','painting.json','sell'),('pre_use','preuse_load_test.json','daily'),('travel','travel.json','cost')]:
    for x in json.load(open(f'{R}/{f}')): ri.append(f"({q(kind)},{q(x['item'])},{q(x.get(pk))},null,null)")
for x in json.load(open(f'{R}/equipment.json')): ri.append(f"('equipment',{q(x['item'])},{q(x.get('daily'))},{q(x.get('weekly'))},{q(x.get('monthly'))})")
for x in json.load(open(f'{R}/decals.json')): ri.append(f"('decal',{q(x['item'])},{q(x['price'])},null,null)")
out.append('insert into rate_items(kind,item,price,price_weekly,price_monthly) values ' + ','.join(ri) + ';')
open('db/seed_core.sql','w').write('\n'.join(out))
vrows=[]
for v, d in vp.items():
    seen=set()
    for p in d['parts']:
        if p['part'] in seen: continue
        seen.add(p['part']); vrows.append([v, p['part'], p['description'], p['list']])
json.dump(vrows, open('db/seed_vendor_parts.json','w'), separators=(',',':'))
print(len(open('db/seed_core.sql').read()), 'bytes core;', os.path.getsize('db/seed_vendor_parts.json'),'bytes vendor parts', len(vrows))
