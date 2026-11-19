"""Extract reference (price-book) data from a blank Sales Main Template.

Usage: python3 tools/extract_reference.py <template.xlsx> <out_dir>
Writes JSON files that seed the price book: steel shapes + price groups,
standard parts catalog, vendor price lists, rates found on the data tabs.
"""
import json, re, sys, datetime, os
import openpyxl

src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
wb = openpyxl.load_workbook(src, data_only=True)
wf = openpyxl.load_workbook(src)  # formulas, to read lookup ranges

def j(v):
    if isinstance(v, (datetime.date, datetime.datetime)):
        return v.date().isoformat() if isinstance(v, datetime.datetime) else v.isoformat()
    return v

def dump(name, data):
    with open(os.path.join(out, name), "w") as f:
        json.dump(data, f, indent=1, default=j)
    print(f"{name}: {len(data) if hasattr(data, '__len__') else ''}")

L = wb["List"]

# --- steel price groups (List F:H) and shapes (List A:D) ---
groups = {}
for r in range(1, 60):
    k, d, p = L.cell(r, 6).value, L.cell(r, 7).value, L.cell(r, 8).value
    if k and isinstance(p, (int, float)):
        groups[str(k).strip()] = {"price_per_lb": p, "updated": j(d)}
shapes = []
for r in range(1, L.max_row + 1):
    name, typ, plf = L.cell(r, 1).value, L.cell(r, 2).value, L.cell(r, 3).value
    if name and typ and isinstance(plf, (int, float)):
        shapes.append({"shape": str(name).strip(), "group": str(typ).strip(), "lb_per_ft": plf})
dump("steel_price_groups.json", groups)
dump("steel_shapes.json", shapes)

# --- vendor price lists, located through the Hoist & Crane tab's lookup formulas ---
H, HF = wb["Hoist & Crane Vendor Items"], wf["Hoist & Crane Vendor Items"]
vendors = {}
section = None
for r in range(1, HF.max_row + 1):
    a = H.cell(r, 1).value
    if isinstance(a, str) and a.strip().endswith("Components"):
        section = a.replace("Components", "").strip()
    f = HF.cell(r, 2).value
    if section and isinstance(f, str) and "VLOOKUP" in f and section not in vendors:
        m = re.search(r"List!\$([A-Z]+)\$(\d+):\$([A-Z]+)\$(\d+)", f)
        disc = H.cell(r, 5).value
        cdisc = H.cell(r, 8).value
        vendors[section] = {"range": m.groups(), "pwi_discount_pct": disc, "customer_discount_pct": cdisc}
from openpyxl.utils import column_index_from_string as ci
price_lists = {}
for v, info in vendors.items():
    c0, r0, c1, r1 = info["range"]
    c0, c1, r0, r1 = ci(c0), ci(c1), int(r0), int(r1)
    rows = []
    for r in range(r0, r1 + 1):
        part, desc, lst = L.cell(r, c0).value, L.cell(r, c0 + 1).value, L.cell(r, c0 + 2).value
        if part and isinstance(lst, (int, float)):
            rows.append({"part": str(part).strip(), "description": (desc or "").strip(), "list": round(lst, 2)})
    price_lists[v] = {"default_pwi_discount_pct": info["pwi_discount_pct"],
                      "default_customer_discount_pct": info["customer_discount_pct"], "parts": rows}
dump("vendor_price_lists.json", price_lists)

# --- standard parts & products catalog ---
S = wb["Standard Parts & Products"]
cat, sec = [], None
for r in range(1, S.max_row + 1):
    a, b, f = S.cell(r, 1).value, S.cell(r, 2).value, S.cell(r, 6).value
    if isinstance(a, str) and b is None and f is None and a.strip() and not a.startswith("Description"):
        sec = a.strip(); continue
    if isinstance(a, str) and isinstance(f, (int, float)) and f > 0:
        cat.append({"section": sec, "row": r, "description": a.strip(),
                    "vendor": S.cell(r, 3).value, "part": S.cell(r, 4).value,
                    "price_updated": j(S.cell(r, 5).value), "sell": round(f, 4),
                    "shop_hours_each": S.cell(r, 11).value, "gm_pct": S.cell(r, 13).value})
dump("standard_parts.json", cat)

# --- simple rate tables: painting, equipment, travel, pre-use, decals ---
def table(sheet, qty_col, price_cols, first=1):
    ws = wb[sheet]; rows = []
    for r in range(first, ws.max_row + 1):
        a = ws.cell(r, 1).value
        vals = {k: ws.cell(r, c).value for k, c in price_cols.items()}
        if isinstance(a, str) and any(isinstance(v, (int, float)) and v for v in vals.values()):
            rows.append({"row": r, "item": a.strip(), **{k: (round(v, 4) if isinstance(v, (int, float)) else v) for k, v in vals.items()}})
    return rows
dump("painting.json", table("Painting", 2, {"sell": 3}))
dump("equipment.json", table("Equipment", 2, {"daily": 3, "weekly": 6, "monthly": 9}))
dump("travel.json", table("Travel Costs", 2, {"cost": 4}))
dump("preuse_load_test.json", table("Pre-use Load Test", 2, {"daily": 3}))

M = wb["Main Summary"]
decals = [{"item": M.cell(r, 12).value.strip(), "price": M.cell(r, 13).value}
          for r in range(14, 30) if isinstance(M.cell(r, 12).value, str) and isinstance(M.cell(r, 13).value, (int, float))]
dump("decals.json", decals)

# freight history (List BF:BK)
fr = []
for r in range(2, L.max_row + 1):
    d, t, b, mi, usd = (L.cell(r, c).value for c in (58, 59, 60, 61, 62))
    if t and isinstance(mi, (int, float)) and isinstance(usd, (int, float)):
        fr.append({"month": d, "type": t, "miles_bucket": b, "miles": mi, "price": usd})
dump("freight_history.json", fr)

# rates in the template (starting values for settings)
LB = wb["Labor"]
settings = {
    "template_shop_rate": LB["C2"].value, "template_onsite_rate": LB["H2"].value,
    "pm_rate": M["H15"].value, "cad_rate": M["H16"].value, "pe_rate": M["H17"].value,
    "structural_markup_pct": wb["Structural"]["I4"].value,
    "sales_tax_rate": M["F36"].value, "freight_markup": M["T33"].value,
}
dump("template_settings.json", settings)
