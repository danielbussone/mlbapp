# Plan: Savant infield OAA breakdown and Fielding Run Value (FRV) breakdown

This document scopes adding **Statcast-sourced** (Baseball Savant) data that is **not** covered by the existing outfield directional OAA ingest (`pnpm etl:fielding-oaa` → `savant_fielding_oaa_cell`, `of_dir_*`). It complements [STATCAST_REQUIREMENTS.md](./STATCAST_REQUIREMENTS.md) §11 and [DATASETS.md](./DATASETS.md).

**Related product context:** [PLAYER_CARDS_V2.md](./PLAYER_CARDS_V2.md) (fielding rail, OAA field grid), [PLAYER_CARD_ENHANCEMENTS_PLAN.md](./PLAYER_CARD_ENHANCEMENTS_PLAN.md) (geometry / gaps).

---

## 1. Goals and non-goals

### 1.1 Goals

1. **Infield directional OAA** — Ingest Savant’s **Outs Above Average** leaderboard for infielders, including the **directional** buckets (In / toward 3B line / toward 1B line / Behind) and optional **handedness splits** (RHB / LHB), aligned with the [Savant OAA leaderboard](https://baseballsavant.mlb.com/leaderboard/outs_above_average) (e.g. `pos=if`, qualified filters).
2. **Fielding Run Value breakdown** — Ingest Savant’s **Fielding Run Value** leaderboard so the card can show **role-specific** component runs (**§6.2**): **OF** → Range + Arm; **IF** (2B / 3B / SS, etc.) → Range + Arm + DP; **1B** → **Range + DP** only (no Arm bar); **C** → Framing + Throwing + Blocking only (aligned with the [Savant FRV leaderboard](https://baseballsavant.mlb.com/leaderboard/fielding-run-value) and mixed-table layout **§2.3**).

### 1.2 Non-goals (initial phase)

- Replacing **FanGraphs** `frv` on `fg_fielding_season` or changing existing **`pos_frv`** percentile logic without an explicit follow-up (Savant FRV vs FG naming reconciliation).
- Pitch-level Statcast or new MVs for league percentiles from these feeds (optional later).
- **Redundant Savant columns on the card** when a role does not use them (e.g. **`inf_of_runs`** may stay in ETL/API for IF rows but is **not** a separate bar for IF in §6.2 — see role split there).
- **Infield OAA directional** ingest on **catcher-primary** cards (catchers use different OAA / leaderboard surfaces than `pos=if`).
- **Savant FRV for catchers** is **in scope** — see §6.2.2 (Catcher primary).

---

## 2. Data sources

### 2.1 Infield OAA (directional + splits)

| Aspect | Detail |
|--------|--------|
| **User-facing page** | [Outs Above Average — Fielder, Infield](https://baseballsavant.mlb.com/leaderboard/outs_above_average) (`type=Fielder`, `pos=if`, year range, `min`, `split=yes`/`no`) |
| **CSV** | `…/leaderboard/outs_above_average?type=Fielder&startYear={Y}&endYear={Y}&range=year&min={m}&pos=if&roles=&split={yes\|no}&team=&viz=hide&csv=true` |
| **pybaseball** | `statcast_outs_above_average(year, pos, min_att, view='Fielder')` — uses `pos` normalized to `if` for infield; default URL uses `split=no` ([`statcast_fielding.py`](https://github.com/jldbc/pybaseball/blob/master/pybaseball/statcast_fielding.py)). |
| **Column mapping (typical snake_case after strip)** | `player_id` (MLBAM), `year` when `split=yes`, `primary_pos_formatted`, `outs_above_average` (total), `outs_above_average_infront`, `outs_above_average_lateral_toward3bline`, `outs_above_average_lateral_toward1bline`, `outs_above_average_behind`, `outs_above_average_rhh`, `outs_above_average_lhh`; rate columns may be formatted strings — treat as display-only unless parsed carefully. |

**Design choice — `split`:**

- **`split=no`**, `startYear=endYear=Y`: one row per player for season Y; `year` may be empty in CSV — ETL should set **`game_year = Y`** from CLI.
- **`split=yes`**: explicit `year` per row; useful for multi-year pulls in one file; ETL must group/dedupe on `(player_id, year)`.

### 2.2 Fielding Run Value (component runs)

| Aspect | Detail |
|--------|--------|
| **User-facing page** | [Fielding Run Value leaderboard](https://baseballsavant.mlb.com/leaderboard/fielding-run-value) |
| **CSV (example)** | `…/leaderboard/fielding-run-value?gameType=Regular&seasonStart={Y}&seasonEnd={Y}&type=fielder&position={code}&minInnings={n}&minResults=1&csv=true` |
| **pybaseball** | `statcast_fielding_run_value(year, pos, min_inn=100)` — position and min innings matter for cohort shape. |
| **Observed header (sample)** | `name`, `id`, `total_runs`, `inf_of_runs`, `range_runs`, `arm_runs`, `dp_runs`, `catching_runs`, `framing_runs`, `throwing_runs`, `blocking_runs`, `outs_total`, `outs_2`…`outs_9` (position-tag columns — confirm semantics in [Savant glossary](https://baseballsavant.mlb.com/csv-docs) / on-page copy). |

**Verify before implementation:** whether `id` is always **MLBAM** (expected for Savant leaderboards); document any exceptions.

### 2.3 Mixed leaderboard layout (OF + IF + C in one table)

Savant’s **Fielding Run Value** UI often uses **one grid** for all fielders (e.g. broad position filter or “All” style views), with **position-specific columns left blank or zero** when they do not apply. A mixed table (reference: user-provided Savant screenshot, 2026-style layout) groups columns roughly as:

| Top-level / group | Columns (Savant UI labels) | Typical population |
|-------------------|----------------------------|---------------------|
| **Headline** | **Fielding Run Value** (often heat-scaled) | Always: `total_runs` class metric — maps to our **chip** (`total_runs`). |
| **Infield / Outfield** | **INF/OF Runs**, **Range**, **Arm**, **Inf. DP** (Savant table) | Strong for **IF** and **OF** rows; catchers show **0 / em dash** here. CSV: **`range_runs`**, **`arm_runs`**, **`inf_of_runs`**, **`dp_runs`**. **Player card (§6.2)** does **not** mirror every Savant column: **OF** → Range + Arm; **IF** (non-1B) → Range + Arm + DP; **1B** → Range + DP **only** (no Arm); **`inf_of_runs`** remains in storage/API but is **not** its own bar in v1. |
| **Catching** | **Catching Runs**, **Framing**, **Throwing**, **Blocking** | Strong for **C** rows; IF/OF often **0 / blank**. On the site, **Catching Runs** is the aggregate of the three components; on our **player card** we use the **chip** for headline total and **only the three breakdown bars** (no duplicate “Runs” row) — **§6.2**. |
| **Innings** | **Total** plus **C, 1B, 2B, 3B, SS, LF, CF, RF** | Defensive innings by position — useful for **primary-position** resolution and “who is this row about?” when the table mixes roles. |

**Implications for mlbapp**

1. **Ingest:** still store a **wide** row per player-season (and per `position_filter` if using Option A/B in §3.2); empty CSV cells become **NULL** / 0.
2. **Player card:** do **not** render both full Savant column groups for every player — choose **INF/OF block** vs **Catching block** emphasis from **FG primary / max innings** (and hide or collapse all-zero groups so the card does not look like a sparse leaderboard).
3. **Outfielders in a mixed table:** **Range** + **Arm** under INF/OF; **Catching** empty on Savant — our **OF** card shows the same two bars (**§6.2**). Directional OAA + FG remain the primary OF story elsewhere on the card.

---

## 3. Storage design

### 3.1 Infield OAA — reuse `savant_fielding_oaa_cell`

**Recommendation:** Store directional infield OAA in the existing **`savant_fielding_oaa_cell`** table (`player_mlbam`, `game_year`, `cell_id`, `oaa`, `attempts`, `ingested_at`) with a **new `cell_id` prefix**, e.g.:

| `cell_id` | CSV source (conceptual) |
|-----------|-------------------------|
| `if_dir_in` | `outs_above_average_infront` |
| `if_dir_toward_3b` | `outs_above_average_lateral_toward3bline` |
| `if_dir_toward_1b` | `outs_above_average_lateral_toward1bline` |
| `if_dir_behind` | `outs_above_average_behind` |
| `if_split_rhh` | `outs_above_average_rhh` |
| `if_split_lhh` | `outs_above_average_lhh` |

**Optional:** a synthetic `if_oaa_total` row mirroring `outs_above_average` for UI “center total” parity with outfield (or derive total in API from sum of directional columns — **do not** double-count if Savant total ≠ sum of buckets; prefer storing **total only if it matches Savant column**, not as sum of cells).

**Replace semantics:** `DELETE … WHERE game_year = $y AND cell_id LIKE 'if_dir_%' OR cell_id LIKE 'if_split_%'` (tune to final naming) before bulk upsert when `--replace-season` is set, mirroring `of_dir_%` behavior.

**`ingest_snapshot.source`:** e.g. **`statcast_fielding_oaa_if_directional`** (distinct from `statcast_fielding_oaa_directional_of`).

### 3.2 FRV breakdown — new table (recommended)

**Recommendation:** Add a dedicated wide table keyed by player, season, and **ingest position filter** (Savant’s `position` query param), e.g. **`savant_fielding_run_value_season`**:

- **Primary key (candidate):** `(player_mlbam, game_year, position_filter)` where `position_filter` matches Savant’s request (at minimum **`OF`**, **`IF`**, **`C`** for §6.2; optional finer codes like `SS` if ingested).
- **Columns:** mirror CSV numeric run columns (`total_runs`, `range_runs`, `arm_runs`, `dp_runs`, …) as `numeric`; nullable where Savant omits for role.
- **Optional:** `stats_jsonb` for forward-compatible extra columns without Flyway churn.
- **FK / index:** index `(player_mlbam, game_year)` for card reads.

**Rationale:** FRV is **not** a uniform “cell grid” like OAA slices; mixing into `savant_fielding_oaa_cell` would overload `cell_id` / `oaa` semantics. A wide row matches one CSV row per player per ingest configuration.

**`ingest_snapshot.source`:** e.g. **`statcast_fielding_run_value`**; params JSON should record `position`, `min_innings`, `game_type`, `season_start`/`season_end`.

**Multi-row strategy:** Savant returns one row per player **per chosen position filter**. Product decision:

- **Option A (simplest):** ETL ingests **`OF`**, **`IF`**, and **`C`** per season with documented `min_innings`; upserts into `(player_mlbam, game_year, position_filter)`. API returns the row whose **`position_filter`** matches **card primary** (e.g. LF/CF/RF → `OF`; 1B–SS → `IF`; C → `C`).
- **Option B:** Store all position filters (`IF`, `C`, `SS`, …) and let UI or query param choose.

**Preference for FRV visualization (§6.2):** ingest at least **`OF`**, **`IF`**, and **`C`** per season (or equivalent Savant `position` codes) so the API can return the row matching the card’s resolved primary role.

Document chosen option in Flyway comment + STATCAST_REQUIREMENTS.

---

## 4. ETL and operations

### 4.1 Shared patterns

- Reuse **`MLBAPP_STATCAST_THROTTLE_SECONDS`**, `_retry_fetch`, and repo **`load_repo_dotenv`** / `DATABASE_URL` patterns from [`fielding_oaa_cell.py`](../etl/mlbapp_etl/fielding_oaa_cell.py) and [`statcast.py`](../etl/mlbapp_etl/statcast.py).
- **Unit tests:** fixture CSVs (headers + 2–3 rows) for column normalization, MLBAM parse, dedupe, and SQL tuple shape.
- **Compliance:** [DATASETS.md](./DATASETS.md), [http-and-official-apis.md](./data-sources/http-and-official-apis.md) — rate limits, no redistribution claims.

### 4.2 CLI sketch

| Command / flag | Purpose |
|----------------|---------|
| `pnpm etl:fielding-oaa-if` (or extend `etl:fielding-oaa` with `--feed infield`) | Pull IF OAA CSV per `--season`, `--min-att`, `--replace-season`, `--csv` / stdin |
| `pnpm etl:fielding-frv` | Pull FRV CSV per `--season`, `--position`, `--min-innings`, `--replace-season`, `--csv` |

**Idempotency:** upsert on natural keys; `--replace-season` clears prior rows for that season (and position filter for FRV) before insert.

### 4.3 Column drift

Savant occasionally renames CSV columns. ETL should:

- Strip headers; support **aliases** (list of acceptable names per logical field).
- Log unknown columns to stderr in `--verbose` mode for operator visibility.

---

## 5. API

### 5.1 Infield OAA

- **Extend** `GET /api/players/:id/fielding-oaa?game_year=` (or keep single endpoint) to return all `savant_fielding_oaa_cell` rows for `(mlbam, year)` — **already includes** `of_dir_*`; clients distinguish by `cell_id` prefix **`if_dir_*` / `if_split_*`**.
- No breaking change if response is “all cells”.

### 5.2 FRV breakdown

- **New** `GET /api/players/:id/fielding-frv?game_year=` returning the selected wide row + metadata (`position_filter`, `ingested_at`).
- Implementation: resolve `player_mlbam` from `playerId`, query `savant_fielding_run_value_season` with the same **primary-position resolution** policy as §3.2 (document in OpenAPI / route comment).

---

## 6. Web UI (player card — fielding)

### 6.1 Infield OAA

Today [`OaaHeatmapPlaceholder.tsx`](../apps/web/src/features/fielding-oaa/OaaHeatmapPlaceholder.tsx) only treats **`of_dir_*`** as directional for `OaaDirectionalField`. Plan:

- **Dev prototype:** **`/dev/oaa-breakdown-prototype`** — [`OaaBreakdownPrototype.tsx`](../apps/web/src/features/fielding-oaa/OaaBreakdownPrototype.tsx): **OF** reuses shipped `OaaDirectionalField` with mock `of_dir_*`; **IF** uses mock `if_dir_*` via [`OaaIfDirectionalField.tsx`](../apps/web/src/features/fielding-oaa/OaaIfDirectionalField.tsx) (same four 90° wedge pie at **1B/3B** bags, **2B** second-baseman hole, **SS** hole; `INFIELD_DIAMOND_SCALE` fits the chalk diamond; RHH/LHH splits omitted).

1. Detect **`if_dir_*`** (and optionally `if_split_*`) and branch to **Infield OAA** presentation:
   - **MVP:** compact **table** with Savant-aligned labels (In / Toward 3B line / Toward 1B line / Behind / RHB / LHB).
   - **V2:** small **infield diagram** (diamond + four wedges) reusing field SVG conventions from [PLAYER_CARDS_V2.md](./PLAYER_CARDS_V2.md) / spray geometry — document `cell_id` → angle/label map in-repo (e.g. `docs/fielding-oaa-cell-map.md`).
2. **Primary role selection:** if both `of_dir_*` and `if_dir_*` exist for the same year (unusual but possible for dual-role samples), prefer branch by **FanGraphs primary position / max innings** (reuse patterns from [`primaryOutfield.ts`](../apps/web/src/features/fielding-frv/primaryOutfield.ts) or parallel helper for IF vs OF).

### 6.2 FRV breakdown — Savant components (OF / IF / 1B / C)

Add a **“Fielding run value (Savant)”** subpanel on the **fielding** rail when `GET …/fielding-frv` returns a row. Show **`total_runs`** as the headline (with optional FG `frv` footnote: single-line disclaimer that FG may differ). Link or tooltip to [Savant FRV methodology](https://baseballsavant.mlb.com/leaderboard/fielding-run-value) (IF vs OF OAA→run conversion, etc.). **Role-specific bars** — **§6.2.1** / **§6.2.2**.

#### 6.2.1 Metric groups (product vocabulary → CSV columns)

Map by **primary defensive role** (FG innings / primary position). **ETL** should still persist the **full** Savant row (`inf_of_runs`, `catching_runs`, etc.) for parity with the leaderboard; the **card** only plots the subset below.

| Role | Bars / rows on card | CSV fields |
|------|---------------------|------------|
| **OF** | **Range**, **Arm** | `range_runs`, `arm_runs` |
| **IF** (2B, 3B, SS, …) | **Range**, **Arm**, **DP** | `range_runs`, `arm_runs`, `dp_runs` |
| **IF** (**1B** primary) | **Range**, **DP** only | `range_runs`, `dp_runs` — **no `arm_runs` bar** (still persist `arm_runs` from Savant for parity / tooltips). Resolve **1B** from FG primary (`1B`, `DH/1B`, etc.). |
| **C** | **Framing**, **Throwing**, **Blocking** | `framing_runs`, `throwing_runs`, `blocking_runs` |

**Headline:** all roles — **`total_runs`** on the chip / hero (no duplicate “Runs” row under Catching).

**Also persist (not separate bars in v1):** `inf_of_runs` (Savant **INF/OF Runs** bucket), `catching_runs` (QA vs sum of framing + throwing + blocking when applicable), other CSV columns per §2.2.

**Important:** `total_runs` may not equal the sum of the bars shown for that role alone; Savant includes other buckets. Do not force a residual line unless we document a safe formula.

#### 6.2.2 Layout by primary role (OF vs IF vs C)

Resolve **OF** vs **IF** vs **C** from **FanGraphs** primary / max innings (same spirit as §3.2). Use the Savant row for the matching `position_filter` (`OF`, `IF`, or `C`) when ingesting multiple filters.

**Outfield primary**

1. **Block — “Range · Arm”:** two diverging bars (`range_runs`, `arm_runs`). No **DP** bar on the OF card.
2. **Catching:** hide when framing / throwing / blocking are all zero (typical OF).

**Infield primary (non-1B)**

1. **Block — “Range · Arm · DP”:** three bars (`range_runs`, `arm_runs`, `dp_runs`). **`inf_of_runs`** not shown as its own bar (stored for leaderboard / future).
2. **Catching:** hide when all three catcher components are zero (typical IF).

**Infield primary (1B)**

1. **Block — “Range · DP”:** two bars only — **`range_runs`**, **`dp_runs`**. **No Arm bar** for 1B-primary cards (Savant may still ship `arm_runs`; optional footnote / tooltip if non-zero).
2. **Catching:** same as other IF when applicable.

**Catcher primary**

1. **No** Range / Arm / DP block — **C** card is **Framing · Throwing · Blocking** only.
2. **Headline `total_runs`** on the chip; **no** fourth “Runs” row under Catching (chip is the total).

Product grids:

```text
OF              IF (SS/2B/3B)      IF (1B)           C
Range  Arm      Range  Arm  DP     Range  DP         (chip only)
(chip)          (chip)            (chip)            Framing  Throwing  Blocking
```

Wireframe (**C**):

```text
Total FRV (Savant)  +N runs  ───────────────────────────  (chip)

Catching
  [ Framing ] [ Throwing ] [ Blocking ]
```

#### 6.2.3 Visualization mechanics (implementation hints)

- **Interactive prototype (dev only):** **`/dev/frv-prototype`** — [`FrvBreakdownPrototype.tsx`](../apps/web/src/features/fielding-frv/FrvBreakdownPrototype.tsx): **OF**, **SS** (IF Range+Arm+DP), **1B** (IF Range+DP), **C**, plus a **diamond exploration** block using [`FrvDiamondViz.tsx`](../apps/web/src/features/fielding-frv/FrvDiamondViz.tsx) on **`public/spray/dodger-stadium-dimensions.png`** (same 100×100 viewBox as OAA / spray): **Range** as a fielder-centered circle (radius + red/blue hue), **Arm** as an arrow toward **home** (OF) or **1B** (IF), **DP** badge near 2B when `dp_runs` ≠ 0. Catcher row skips the diamond in this sketch (catching-only metrics).
- **Diverging horizontal bar** per metric: shared scale (e.g. clamp display to ±max across components in view, or ±`max(|total_runs|, 15)` for readability); **negative = blue**, **zero = grey**, **positive = red** (or match existing OAA / run-value palette on the card).
- **Alternative MVP:** single **table** (Metric | Runs) in the same group order as §6.2.2 — faster to ship; upgrade to bars in a follow-up.
- **Accessibility:** each bar has `aria-label` with sign and value; table version has clear `th` scope.

#### 6.2.4 API shape (for UI)

Response should expose the **full** normalized Savant row (`position_filter`, `game_year`, `total_runs`, `range_runs`, `arm_runs`, `inf_of_runs`, `dp_runs`, `framing_runs`, `throwing_runs`, `blocking_runs`, `catching_runs`, …) so the client can apply **§6.2.1** role filtering. No **`inf_dp_runs`** requirement for UI (IF uses **`dp_runs`** only for the DP bar). Headline remains **`total_runs`**.

### 6.3 League percentiles

- **Out of scope for v1** unless product explicitly wants **`pos_frv`** to switch to Savant-derived cohorts (large MV / ingest dependency). Default: keep **`pos_frv`** from FG; Savant FRV is **additive context** on the card.

---

## 7. Position coverage and catchers

| Savant filter | Infield OAA ingest | FRV ingest |
|---------------|-------------------|------------|
| `pos=if` | Primary feed for IF directional | **IF** row for IF-primary cards — §6.2.2: **Range + Arm + DP** except **1B** primary → **Range + DP** only. |
| `pos=of` / `OF` | Directional OAA from `directional_outs_above_average` for slices | **OF** row for OF-primary cards — §6.2.2 (Range + Arm only). |
| `C` | Infield OAA directional **not** used for primary catcher cards | **C** row for catcher-primary cards — §6.2.2 (Framing + Throwing + Blocking only). |

Document catcher exclusions from **infield OAA** URL if Savant returns empty or errors.

---

## 8. Testing and validation

| Layer | Infield OAA | FRV |
|-------|-------------|-----|
| **Unit** | DataFrame → `cell_id` rows; `--dry-run` JSON row counts | Same for wide row builder |
| **Spot-check** | Compare 3 players to Savant CSV for season Y | Compare totals and sum of components vs `total_runs` where Savant defines consistency |
| **API contract** | Snapshot test JSON shape | Same |

---

## 9. Documentation updates (checklist)

- [ ] New §§ in [STATCAST_REQUIREMENTS.md](./STATCAST_REQUIREMENTS.md) for infield OAA + FRV (sources, tables, CLI, snapshot sources).
- [ ] [DATASETS.md](./DATASETS.md) — one paragraph each + link to this plan.
- [ ] [PLAYER_CARDS_V2.md](./PLAYER_CARDS_V2.md) — fielding rail bullets + `cell_id` vocabulary for `if_*`.
- [ ] Optional: `docs/fielding-oaa-cell-map.md` — machine- and human-readable map for SVG phase.

---

## 10. Phased delivery

| Phase | Deliverable |
|-------|-------------|
| **P0** | Flyway: FRV table; ETL stubs + tests; ingest_snapshot wiring; `pnpm` scripts |
| **P1** | Infield OAA ETL → `savant_fielding_oaa_cell`; extend/verify `fielding-oaa` API; UI table for IF breakdown |
| **P2** | FRV ETL for **`OF` + `IF` + `C`** + `fielding-frv` API; UI panel per **§6.2** (table MVP → diverging bars) |
| **P3** | Infield directional **diagram** (optional); Savant↔FG reconciliation notes; polish scales / residuals |

---

## 11. Open questions

1. **Single vs multiple FRV rows** per player-season when Savant returns multiple eligible positions — pick Option A or B in §3.2 and document.
2. **Minimum innings / qualified** defaults for FRV ETL so player cards rarely show empty (balance vs Savant “qualified” parity).
3. Whether **RHB/LHB** infield cells belong in the same visual as directional four-way or a **sub-table** (Savant treats them as splits, not spatial wedges).
4. **Historical seasons:** confirm column availability back to target `game_year` min (e.g. 2016) for FRV components.
5. **`primaryPos` normalization** for **1B** (`1B` vs `DH/1B` vs `1B/OF` splits) so Range+DP layout triggers consistently from FanGraphs; optionally surface **`inf_of_runs`** on non-1B IF cards as a footnote / expander.

---

## 12. Summary

| Feed | Storage | Primary consumer |
|------|---------|------------------|
| Infield OAA directional + splits | `savant_fielding_oaa_cell` (`if_dir_*`, `if_split_*`) | Extended `fielding-oaa` API + fielding rail UI |
| FRV component runs | New `savant_fielding_run_value_season` (or agreed name) | New `fielding-frv` API + fielding rail UI |

Both feeds are **Savant leaderboard CSVs**, orthogonal to pitch-level `statcast_pitch` and complementary to **FanGraphs** fielding (`oaa`, `frv` on `fg_fielding_season_current`).
