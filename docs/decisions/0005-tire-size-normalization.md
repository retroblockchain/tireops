# 0005 — Tire Size Normalization

## Context

Humans type tire sizes inconsistently: `235/65R17`, `235 65 17`, `p215/60r16`, `235-65-17`. The data layer needs to match on size reliably — both for search (`search_tires` filtering by size) and for the upcoming price anchor feature, which will query historical comps by exact `width + aspect_ratio + diameter + condition`. Normalizing at the input layer (forcing a strict format) would break voice input and make manual forms annoying. Normalizing at the data layer means we accept anything, store what the user typed, and extract structured fields for queries.

## Decision

Three nullable integer columns on `tires`: `width`, `aspect_ratio`, `diameter`. One TEXT column: `size_raw` (exactly what the user typed). The original `size` column stays temporarily — six read paths still reference it; removing it is a separate migration once those are updated.

A pure function `normalizeTireSize(input)` parses the raw string, strips P/LT/ST prefixes, tolerates `/`, `-`, space, `ZR`, `XL`, and validates ranges (width 100–400, aspect ratio 25–90, diameter 10–28). Flotation sizes return null with a console.warn — none exist in current inventory.

A shared helper `prepareTireSizeFields(rawInput)` wraps the normalizer with DB-column shape and a warning string for unparseable inputs. All four write paths call it: `add_tire` tool, `update_tire` tool, manual add form (`/add`), manual edit form (`/edit/[id]`).

## How parse failures are handled

When input can't be parsed, the row is still written: `size_raw` holds the raw input, integer columns are null, and a warning surfaces to the user. On AI tool paths, the warning is a `size_warning` string in the tool return — the AI relays it in its chat reply. On manual form paths, the warning travels via `sessionStorage` to the dashboard, which shows an amber banner on mount: "Tire saved, but couldn't parse size 'xyz' — open the tire to fix it." The save is never blocked.

## Why integers, not a normalized string

Range queries ("all 17-inch tires"), cross-sells ("same width, different aspect ratio"), and the price anchor query all need integer comparisons. A composite index on `(width, aspect_ratio, diameter)` gives fast exact-match lookups. Display format is a UI concern handled by `formatTireSize()`.

## Deferred

- Migrating read paths off `size` and dropping the column
- `get_price_anchor()` query function
- Chat agent tool for surfacing comps during entry
- Tread depth bucketing for used tires
- Flotation size parsing (e.g. `33x12.50R15`)
- `condition` normalization (only `used` and null exist today — premature to lock down)
