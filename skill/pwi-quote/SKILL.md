---
name: "pwi-quote"
description: "Turn a spoken or typed PWI job description (freestanding, bridge, gantry, monorail, jib, mezzanine, work platform, VRC, fall protection, catalog items) into a link that builds the full quote in the PWI quote app. Use when a PWI salesperson describes a project to quote."
---

# PWI Quote

The rep says the job in plain words, sometimes with a drawing attached. You hand back **one link**. When they tap it, the PWI quote app (pwi-quotes.netlify.app) builds the whole quote: every line item, install, travel, lodging, lifts, freight and the customer wording.

Only ever call the company **PWI** or **PWI Corp**.

## 1. Pull out everything they said

**Model codes**

| Code | Means |
|---|---|
| FSTRM2 | freestanding, motorized, 2 t |
| FSTRGM5 | girder motorized, 5 t |
| FSTRUL1 | Ultra-Lite, 1 t |
| FSTRHL | Hyper-Lite |

"Top runner" is any FSTR. If they attached a drawing, read the dimensions off it.

**Dimensions**
- "30 wide by 80 long" means span 30, runway 80. Width is always the span. Decimals are fine (20'8" = 20.67).
- **"X feet tall" or "X high" is OVERALL height** → `overallHeightFt`.
- Use `hookHeightFt` only when they say "under the hook" or "hook height". Never fill both.

**Paint**
- "Pink columns" → `colors.columns: "pink"`.
- Any color other than gray or Spark Orange is a custom color. It costs more, and the app prices it.

**Location**
- A city or ZIP means installed, unless they say "ship only".
- Estimate one-way road miles from Nappanee, IN 46550 → `miles`.

**Customer and contact**
- Take the customer name and contact name, email and phone only if they were said or are in an attachment.
- Never invent a customer.

## 2. Ask once, only for what is truly missing

Ask in **one** round of multiple-choice questions (AskUserQuestion when you have it), with the most common answer first.

Ask for these only when missing (crane wording below; other products: their own size fields):
- product
- capacity
- span / length
- runway length (freestanding and building runway)
- a height
- whether the bridge is **manual or motorized** (FSTR can be either; skip it if the code or their words already say it)
- **customer name**
- **ship only or installed** (plus the city if installed)

Do NOT ask about these. Default them and say so in one line:
- voltage → 460V/3
- control → radio if motorized, pendant if manual
- 1 bridge, 1 hoist, 1 system
- no collision avoidance unless 2+ bridges share a runway

If they say they want it "right", don't ask more questions. The app shows every assumption on its review screen.

## 3. Make the link

Build the spec as compact JSON. If you can run code, make the link like this:

```bash
python3 -c "import base64,json,sys;s=json.dumps(json.loads(sys.argv[1]),separators=(',',':'));print('https://pwi-quotes.netlify.app/#/new?s='+base64.urlsafe_b64encode(s.encode()).decode().rstrip('='))" '<SPEC JSON>'
```

Then reply with:
1. a one-line read-back, e.g. "FSTRGM5, 5 t, 30' × 80', 20' overall, motorized, radio, pink columns, installed Milwaukee (~165 mi). Assumed 460V/3."
2. the link: **[Open draft quote](link)**

If you cannot run code, do NOT hand-type base64. Instead, give the JSON in a ```json block and say: "Copy this and press Ctrl+V on the quote list page."

## Spec format

```json
{
  "pwi_quote": 1,
  "project": "80' FSTRGM5 crane system",
  "location": "Milwaukee, WI",
  "customer": { "name": "Acme Fabrication", "city": "Milwaukee", "state": "WI",
                "contact": { "name": "Jane Doe", "email": "jane@acme.com" } },
  "items": [
    { "type": "freestanding", "tag": "Bay 1", "series": "GM", "capacityTons": 5,
      "spanFt": 30, "runwayOalFt": 80, "overallHeightFt": 20,
      "bridgeDrive": "motorized", "voltage": "460V/3", "control": "radio",
      "colors": { "columns": "pink" }, "install": true, "miles": 165 }
  ]
}
```

A job with several products is one spec with several items.

**Freestanding fields**

Required:

| Field | Values |
|---|---|
| `series` | `UL` Ultra-Lite / `M` motorized-standard top running / `GM` girder motorized / `HL` Hyper-Lite |
| `capacityTons` | 0.25–10 |
| `spanFt` | 5–60 |
| `runwayOalFt` | 8–600 |
| height | `overallHeightFt` (8–45) **or** `hookHeightFt` (6–42) |
| `bridgeDrive` | `manual` / `motorized` |
| `voltage` | `460V/3` / `230V/3` / `208V/3` |
| `install` | true / false |
| `miles` | one-way from Nappanee; required whenever installed or shipped |

Optional, only if said:
- `systems`, `bridgesPerSystem` (1–2), `hoistsPerBridge` (1–2), `columnsPerSystem` (only if the drawing shows it), `liftFt`
- `trolley` (defaults to bridgeDrive), `control`
- `collisionAvoidance`, `asceRail`, `doubleGirder`, `foundation` (`slab` / `foundation`)
- `colors { columns, runways, bridge }`
- `crewMen`, `travelMode` (`drive` / `fly` / `local`)
- `installDays`: whole days on site (1–365), **only** when the rep says how long the install takes ("3 guys for 5 days" → `crewMen: 3, installDays: 5`). The app then quotes men × days × 10 h on site (a visible +/− hours line on top of its own task list) and uses exactly those days for hotel nights, per diem and equipment rental (day / week / month rate). Leave it out otherwise — the builder works days out from its hours. Fewer days than the builder needs is allowed but goes to a sales manager for approval.
- `bracedToBuilding`, `preUseInspection`, `backupPendant` (radio plus a backup pendant — bridge goes to festoon)
- `serviceClass`: `D` only when they say Class D / heavy service (foundry, steel yard, constant near-capacity lifts) — the app sizes the hoist up and derates it; default Class C

**Out of range**

The auto-builder only handles the ranges above. For anything bigger, or for specials (door interlocks, 50' bays, tapered columns), tell the rep it must be quoted by hand. Still give the link: they get the wording and can add the lines.

**Every other product builds automatically too.** Pick the `type`, fill what was said, default the rest. Each item may also carry `tag`, `install`, `miles`, `crewMen`, `travelMode`, `installDays`. Several installed items on one job share **one** trip automatically (with `installDays` on each item, the trip runs the sum of their days).

**Bridge crane** — `type: "bridge"` (same fields as freestanding, plus):
- `support`: `building_runway` (default — runway on the building's columns) / `crane_columns` (new PWI columns) / `bridge_only` (existing runway)
- `hanging`: `top_running` (default) / `underhung`
- `buildingBayFt` (building column spacing, default 20), `runwayElectrification` (bridge_only)
- `bracketsByOthers: true` when the building (e.g. a new metal building) comes with crane brackets — PWI supplies runway beams only
- `railFt` (total ASCE rail feet) and `runwayElectrificationFt` (total runway conductor-bar feet) only when they differ from the runway length — runway extensions / completion packages
- Spans past the sizing chart (e.g. 70' at 10 t) are sized automatically — a heavier W beam or a plate box girder
- `capacityTons` up to 20; `runwayOalFt` not needed for bridge_only

**Gantry** — `type: "gantry"`: `capacityTons` (≤10), `spanFt` (≤65), `heightUnderBeamFt` or `hookHeightFt`, `motorized` (default true), `qty`, `hoists`, `liftFt`, `voltage`, `control`, `floorTrackFt` (0 = rolls on floor), `colors.gantry`

**Monorail** — `type: "monorail"`: `lengthFt`, `capacityTons` (≤10), `support` (`freestanding` / `ceiling` / `building_brackets`), `overallHeightFt` or `hookHeightFt`, optional `frame` (`single_post` / `goal_post`; default single post up to 2 t), `frameWidthFt`, `supportSpacingFt` (default ≤25' up to 2 t), `parallelBeams` (`2` = two parallel monorails hung from shared goal-post frames), `components` (`false` when the customer supplies the hoists/trolleys — "no components"), `systems`, `hoists` (per system, all beams), `trolley`, `electrification` (`conductor` / `festoon`), `voltage`, `control`, `colors`

**Mezzanine** — `type: "mezzanine"`: `lengthFt`, `widthFt`, `deckHeightFt`, optional `liveLoadPsf` (125 storage default), `deck` (`bdeck_advantech` default / `bdeck_resindek` / `grating` / `treadplate` / `bdeck_only` / `none`), `guardrail` (`osha` / `ibc` / `removable`), `guardrailFt`, `stairs`, `stairType` (`straight` / `switchback`), `stairPrice` (StairZone sell per stair — **without it the quote can't be sent**), `gates: [{type, qty}]` (`manual_rolling` / `manual_pivot` / `pneumatic_pivot` / `motorized_rolling` / `motorized_rollup` / `safety`), `bracing` (`knee` / `x` / `building` / `none`), `primerOnly`, `stamped`, `colors.structure`

**Jib** — `type: "jib"`: `capacityTons` (≤5), `spanFt` (reach, ≤30), `overallHeightFt` or `heightUnderBoomFt`, `mount` (`floor` default / `foundationless` / `wall`), `rotation` (180/270/360), `hoist` (default true), `trolley`, `liftFt`, `voltage`, `qty`

**Work platform (Guardian RV work platform set)** — `type: "work_platform"`. One set = (2) truss platforms, (4) towers, (4) Starke chain hoists with secondary brakes.

Required: `lengthFt` (platform length without end extensions, 20–90), `install`, `miles` when installed.

Optional, only if said:

| Field | Values |
|---|---|
| `sets` | number of sets (default 1) |
| `widthFt` | platform width, default 4 (30" = 2.5); wider than 4' adds runner tubes and $500/ft |
| `tallestUnitFt` | tallest customer unit; over 14' → 30' towers (default 24') |
| `fingerRacks`, `motorizedWidth` | true forces the box truss (also used over 57' long or 6' wide) |
| `fingerRackFt` | line feet of finger racks for trim storage |
| `woodFloor` | true = PWI supplies 3/4" Advantech (default: flooring by others) |
| `crosswalks` | `{ standard, pivot, expandable, aluminum, expandedLengthFt, wideUnits }` counts per set |
| `gapProtection`, `vNose` | true / false |
| `telescopingGuardrail`, `telescopingLengthFt` | sections per set, extended length |
| `camGateFrontFt`, `camGateRearFt` | feet of unit covered by cam gates (adds interior guardrail) |
| `endExtensions` | 0–4 per set (with swing gates); the other ends get end caps |
| `treadPlateExtensions`, `longestUnitFt` | slide-out tread plate sheets |
| `ladder`, `extraTrackRuns` | ladder access; extra runs of 300 series track |

The app picks the truss (triangular / box), hoist size (1 t to 40', 2 t to 62', 3 t over) and tower height from those. Example: "Guardian set, 51 foot by 30 inch platforms, two pivot crosswalks, installed in Elkhart" → `{ "type": "work_platform", "lengthFt": 51, "widthFt": 2.5, "crosswalks": { "pivot": 2 }, "install": true, "miles": 25 }`.

**Fall protection (AnchorPoint)** — `type: "fall_protection"`: `lengthFt`, `supportSpacingFt` (default 20; >20 uses 10" truss), `people` (1–2), `trolleys`, `srl` (20/30/50), `harnesses`, `systems`

**VRC (Apex)** — `type: "vrc"`: `model` = `PWSD0505` 5×5 / `PWSD0606` 6×6 / `PWSD0510` 5×10 / `PWSD0610` 6×10 / `PWSD0812` 8×12 / `PWHD1010` heavy duty 10×10, `qty`, `noPit`, `hdColumns`

**Anything in the price lists** (frame rotators, below-the-hook, AERO work cells, parts) — `type: "catalog"`: `item` (part number or name), `qty`, optional `unitPrice` and `description` if it isn't in the lists, `installHours` if installed.

Ask only for what each product truly needs (size, capacity, height, installed or not). Standalone stairs still go as an item with a `wording` string; the app keeps it for hand lines.

**Changes later**

"Make it 100 feet long" → send the whole updated spec as a new link or block. The rep pastes it into **Update from Claude** on that quote, which rebuilds it and keeps the lines they added by hand.

## Example

> "FSTRM2, 2 ton, 60 foot runway, 30 span, 16 under hook, 460, installed in Elkhart for Acme"

Everything required is there. Ask nothing. Spec: series M, 2 t, OAL 60, span 30, hookHeightFt 16, motorized, 460V/3, install, miles ≈ 25, customer Acme. Reply: "FSTRM2, 2 t, 30' × 60', 16' under hook, motorized, radio, installed Elkhart (~25 mi). Assumed radio, 1 bridge, 1 hoist." + the link.