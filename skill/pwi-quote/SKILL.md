---
name: pwi-quote
description: Turn a spoken or typed PWI job description (freestanding crane, bridge, gantry, mezzanine…) into a quote block that fills the PWI quote app. Use when a PWI salesperson describes a project to quote.
---

# PWI Quote

The salesperson describes a job in plain words, and may attach a drawing. Your output is ONE JSON block that they paste into **Paste from Claude** in the quote app (https://pwi-quotes.netlify.app). From that block the app builds every line item, the labor, the install, the freight and the customer wording.

The company name is PWI or PWI Corp. Never write "Paul's Welding".

## How to run it

1. Read what they said and pull out every field below. Model codes carry a lot of the answer: **FSTRM2** = freestanding, motorized, 2 ton; **FSTRGM5** = girder motorized, 5 ton; **FSTRUL1** = Ultra-Lite, 1 ton; **FSTRHL** = Hyper-Lite. If they attached a drawing, read the dimensions off it.
2. Ask only for the **required fields that are still missing**. Put them all in one round of multiple-choice questions (AskUserQuestion when you have it), with the most common answer first. Never ask about anything that has a default unless they brought it up.
3. Output the block, then give 2–3 lines on any assumption that changes price (for example, "assumed 460V" or "no install").

Keep it fast. One question round is the goal; two is the most.

## Fields: freestanding (`"type": "freestanding"`)

| field | required | values / default |
|---|---|---|
| series | yes | `UL` Ultra-Lite, `M` motorized/standard top running, `GM` girder motorized, `HL` Hyper-Lite |
| capacityTons | yes | 0.25, 0.5, 1, 2, 3, 5, 7.5, 10 |
| runwayOalFt | yes | feet (decimals OK: 20'8" = 20.67) |
| spanFt | yes | feet |
| hookHeightFt | yes | height under hook, feet |
| bridgeDrive | yes | `manual` or `motorized`. FSTR is NOT automatically either way, so ask unless the model code or their words say it. |
| trolley | no | defaults to the same as bridgeDrive |
| voltage | yes | `460V/3`, `230V/3`, `208V/3` |
| control | no | `radio` (default when motorized; Starke Echo) or `pendant` (default when manual) |
| install | yes | true / false (ship only) |
| miles | if install | one-way miles from Nappanee, IN. If they give a city instead, estimate the miles. |
| systems | no | 1 |
| bridgesPerSystem | no | 1 |
| hoistsPerBridge | no | 1 |
| columnsPerSystem | no | auto from OAL; set it only if the drawing shows it |
| collisionAvoidance | no | false; true only when 2+ bridges share a runway or they ask for it |
| asceRail | no | auto (motorized and 5 t+) |
| bracedToBuilding | no | false |
| liftFt | no | auto from hook height |
| preUseInspection | no | false |

## Other products

Bridge, gantry, monorail, jib, mezzanine, stairs, VRC, fall protection: their auto-builders are not ready yet. Still include each one as an item with `type` and a full `wording` string written in PWI's spec style:
- the title line `(qty) - MODEL TITLE`
- General Specs
- the component sections

The app keeps that wording and tells the rep to add the lines by hand.

## Output format

Output exactly one fenced json block:

```json
{
  "pwi_quote": 1,
  "project": "Bay 3 crane",
  "location": "Elkhart, IN",
  "items": [
    { "type": "freestanding", "series": "M", "capacityTons": 2, "runwayOalFt": 60, "spanFt": 30,
      "hookHeightFt": 16, "bridgeDrive": "motorized", "trolley": "motorized", "voltage": "460V/3",
      "control": "radio", "install": true, "miles": 25, "systems": 1 }
  ]
}
```

A job with several products is one block with several items.

## Example

> "FSTRM2, 2 ton, 60 foot runway, 30 span, 16 under hook, 460, installed in Elkhart"

Everything required is there: 2 t, motorized (M), OAL, span, hook height, voltage, install, location. Ask nothing. Output the block with miles ≈ 25 and control `radio`. Then add one line: "Assumed radio control, 1 bridge, 1 hoist."
