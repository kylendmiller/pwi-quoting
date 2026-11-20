# Steel cost setting — updating it from the weekly steel brief

Every auto-built quote prices steel **cost** ($/lb) from one dated setting, `steel_cost`, in the
`settings` table (Admin → Settings). Markups (structural 26%, plate 21%) and drop factors are separate
settings and are not part of this one.

## Exact JSON shape

```json
{
  "effective": "2026-11-03",
  "source": "weekly steel brief",
  "perLb": {
    "Tube": 1.55, "Tube >6\"": 1.55, "Tube >10\"": 1.55,
    "Channel": 1.2, "Pipe": 1.55, "Angle": 1.0,
    "G01": 1.3, "G02": 1.3, "G03": 1.3, "G04": 1.3,
    "G05": 1.4, "G06": 1.4, "G07": 1.4, "G08": 1.4, "G09": 1.4, "G10": 1.4, "G11": 1.4,
    "Plate": 1.35
  }
}
```

| Field | Type | Rule |
|---|---|---|
| `effective` | string `YYYY-MM-DD` | Date the prices take effect (the brief's date). Anything else → the whole setting is ignored and the price list is used. |
| `source` | string | Free text shown in the quote's assumptions, e.g. `"weekly steel brief 2026-11-17"`. |
| `perLb` | object | Price group → steel cost in **$ per lb** (number, > 0 and < 20). |

### Price-group keys
The keys are exactly the group codes in `reference/steel_price_groups.json` (the `steel_price_groups`
table), plus `Plate`:

- `Tube`, `Tube >6"`, `Tube >10"` — HSS tube by size (note the inch mark is part of the key; escape it as `\"` in JSON)
- `Channel`, `Pipe`, `Angle`
- `G01` … `G11` — wide-flange weight groups (which W shape is in which group is in `reference/steel_shapes.json`)
- `Plate` — plasma plate and built-up plate (box) members; replaces the `plate_price_per_lb` setting while present

Keys may be left out: any group not listed falls back to the price list (`steel_price_groups` /
`plate_price_per_lb`). Unknown keys are ignored. Non-numeric values are dropped.

## Weekly update (what the brief should produce)
1. Take this week's $/lb per group from the brief.
2. Write the full object above with `effective` = brief date and `source` = `"weekly steel brief YYYY-MM-DD"`.
3. Save it as the value of the `steel_cost` setting (Admin → Settings → `steel_cost`).

New quotes and rebuilt quotes use it immediately (the catalog cache is 5 minutes). Quotes already
built keep their line prices until someone rebuilds them.

## How the engine uses it
- `Kit.steel()` — shape × length × lb/ft × `perLb[group]` (fallback: the shape's group price).
- `Kit.plate()` and `Kit.box()` — lb × `perLb.Plate` (fallback: `plate_price_per_lb`).
- The calibration harness (`tests/calibration.test.ts`) re-prices each sold job's steel and plate at the
  seeded setting (`src/engine/rules/steel_cost.default.json`) before comparing, so old jobs sold at older
  steel prices compare fairly with today's builds.
