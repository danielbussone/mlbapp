# Fielding Grid (OAA directional visualization) (retrospective PRD)

**Surface:** Player card **fielding** role — **`OaaHeatmapPlaceholder`** (section title in UX may appear alongside FanGraphs fielding tables). This is the **Savant directional Outs Above Average** visualization on a **shared field diagram**, not the FanGraphs numeric tables.

## Summary

When **`savant_fielding_oaa_cell`** has rows for the player-season, render **directional OAA** as **wedges / slices** on an outfield or infield SVG (**`OaaDirectionalField`** vs **`OaaIfDirectionalField`**). Color encodes **goodness-adjusted** defensive percentile context using **`GET …/league-percentiles?role=fielding`** when available. Otherwise explains ingest / loading states.

## How it works

1. **Cells API:** `GET /api/players/:playerId/fielding-oaa?game_year=` returns `{ cells: [...] }` (`statcastFieldingOaaCells`). Each cell has **`cell_id`**, **`oaa`**, **`attempts`**, etc.
2. **Directional scheme:**
   - **`of_dir_*`:** Outfield directional slices — pie-like anchors (**LF / CF / RF**) informed by **FanGraphs innings** (`primaryOutfieldByInnings` on `fg-fielding` rows).
   - **`if_dir_*`:** Infield directional grid (`OaaIfDirectionalField`) with geometry helpers (`ifMiniPieAnchorFromFg`).
3. **OF vs IF routing:** If both prefixes exist, UI picks **outfield vs infield** by **which FanGraphs inning total is larger** (LF–RF vs 1B–SS); ties use small tie-break rules (`directionalKind` in `OaaHeatmapPlaceholder.tsx`).
4. **Totals:** Sums **`oaa`** across cells matching the active prefix for a headline total where implemented.
5. **Percentile alignment:** **League percentiles** query with **`role=fielding`** supplies **`fieldingOaaGoodnessDp`** for thumb-style coloring consistent with the Vs-league panel (`percentileGoodnessColor.ts`).
6. **Dependencies:** Waits for **FanGraphs fielding rows** to be loaded (`fieldingRowsReady`) so primary position / innings splits are stable before choosing anchors.

## Data sources

| Layer | Detail |
|-------|--------|
| OAA cells | Table **`savant_fielding_oaa_cell`** — PK `(player_mlbam, game_year, cell_id)`; populated by **`pnpm etl:fielding-oaa`** (outfield) and **`pnpm etl:fielding-oaa-if`** (infield) per `docs/PLAYER_CARDS_V2.md` / `STATCAST_REQUIREMENTS.md` |
| Anchors / innings | **`GET /api/players/:playerId/fg-fielding`** (same rows as fielding card table) |
| Percentiles | **`GET /api/players/:playerId/league-percentiles?role=fielding&game_year=`** |

## Stats used

- **Primary display:** Per-cell **`oaa`** (runs saved vs average in that directional bucket).
- **Weighting / opacity:** **`attempts`** drives visual weight (sqrt scaling noted in design docs) so small-sample cells are not overstated.
- **Context:** League percentile goodness for OAA — see **`fieldingOaaGoodnessDp`** and fielding **`pos_oaa`** cohort logic in **`COHORT_PERCENTILES_SPEC.md`**.

## What this is not

- **Not** a generic “defensive stats table” — that is **FanGraphs fielding** (`OutfieldFieldingTables` / `fg-fielding`).
- **Not** the future “spray-shaped” full-field heat map — **`PLAYER_CARD_ENHANCEMENTS_PLAN.md`** / **`PLAYER_CARDS_V2.md`** list remaining work for a full **field-overlay** grid (cell vocabulary → SVG map). **Shipped today** is the **directional** visualization tied to **`of_dir_*` / `if_dir_*`** cell IDs.

## Key implementation files

- `apps/web/src/features/fielding-oaa/OaaHeatmapPlaceholder.tsx`
- `apps/web/src/features/fielding-oaa/OaaDirectionalField.tsx`
- `apps/web/src/features/fielding-oaa/OaaIfDirectionalField.tsx`
- `apps/api/src/repos/statcastFielding.ts`
- `etl/mlbapp_etl/fielding_oaa_cell.py`
- `docs/PLAYER_CARDS_V2.md` — § OAA heat map grid
