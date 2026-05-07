# Spray Chart (retrospective PRD)

**Surface:** Player card **Statcast** column, **batting** role — collapsible **“Spray chart”** rendering **`SprayChart`**.

## Summary

Plot **in-park hit locations** for the selected season on a **fixed outfield diagram** (Dodger Stadium overlay asset). Each point is a **single**, **double**, **triple**, or **home run** with valid Statcast **`hc_x`** / **`hc_y`**; hit type sets **color**. Grounders and unspecified events are excluded (`other`).

## How it works

1. **Data:** `statcast.sample` from **`GET …/statcast-summary?role=batter`** — an array of pitch/BIP rows for the batter-season (see sampling limits below).
2. **Projection:** `hc_x` / `hc_y` (feet, Savant conventions) are clamped and mapped to SVG coordinates with a **linear base map** plus optional **depth-based horizontal “fan”** scaling so deep pulls spread laterally (tunable constants in `SprayChart.tsx`).
3. **Classification:** `events` string is mapped to hit kind; only chartable hit types render.
4. **Empty state:** If no valid points, copy explains need for **`hc_x`/`hc_y`** plus qualifying events and Statcast ETL.

## Data source

| Layer | Detail |
|-------|--------|
| Table | `statcast_pitch`; coordinates read from **`payload_jsonb->>'hc_x'` / `'hc_y'`** on sample query |
| API | `statcastSampleRows` for **role=batter** in `apps/api/src/repos/statcast.ts` |

## Sampling and fields

- Batter sample **cap:** up to **12,000** rows (`MAX_SAMPLE_BATTER`); default limit **8,000** unless overridden by query `limit`.
- Rows require **non-null** `hc_x` and `hc_y` after trim.
- Selected columns include `events` for hit classification (and other pitch context not used by the minimal chart).

## Coordinate semantics (implementation)

Documented in-component: **`hc_y` decreases toward center field** (farther from home → smaller `hc_y`). Mapping uses `(HC_Y_MAX - y)` so **deeper** balls plot **toward the top** of the SVG. Horizontal axis: smaller **`hc_x`** ≈ **LF** side in catcher view.

Constants **`HC_X_*`**, **`HC_Y_*`**, fan shaping **`SPRAY_FAN_*`** are tuned to align with the bundled field image (`sprayFieldConstants.ts`).

## Limitations

- **Hits only** (not all BIP); **`other`** classification skipped.
- Not synced to **live** Savant spray tool UX — same underlying coordinates, custom SVG styling.
- Pitcher-card movement/spray sharing uses different sample filters elsewhere; this doc is **batter spray only**.

## Key implementation files

- `apps/web/src/features/spray-chart/SprayChart.tsx`
- `apps/web/src/features/spray-chart/sprayFieldConstants.ts`
- `apps/api/src/repos/statcast.ts` — `statcastSampleRows` (batter branch)
