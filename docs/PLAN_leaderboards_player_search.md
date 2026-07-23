# Non-chat features: Player Search, Leaderboards (Player Compare deferred)

## Context

Today every way into the app's data goes through the chat/LLM: navigation is chat-driven (no nav bar), the player-search surface only exists as a name→single-id resolver used by chat panels, and `/leaderboards` merely replays a leaderboard that chat produced. The user wants **direct, non-LLM** entry points reachable from the home page:

1. **Player search** — autocomplete from the home page (and nav), 3-char trigger, matching first/last/full name, **ordered by career WAR**, opening the existing player card.
2. **Season leaderboards** — Batting, Pitching, Fielding leaders, **paginated** (20/50/100), **filterable** (team, position, min PA/IP/Fielding innings, **year range**), **click-a-header to re-sort**, with a **Split vs Aggregate** toggle (one row per player-season, vs one row per player summed over the year-range filter), default current year (2026).
3. **Player compare** — **deferred**; the design needs a fuller discussion of use cases and meta-analysis (see the agenda at the end). Not built in this pass.

Backend leverage from exploration: `resolvePlayer()` already does the exact matching+WAR ranking search needs; the leaderboard query engine exists (just not over REST) and needs widening for the new columns/filters/pagination.

**Decisions locked with the user:** Fielding value = FanGraphs **Def (`def_runs`)**; leaderboards include the **full requested column set** (Position, triple-slash, IP, etc.) plus pagination/filters/header-sort; navigation = **persistent top nav bar**, chat stays home, search result opens the existing player card (`/players/:id`). **Compare is deferred pending design discussion.**

Stack: Fastify API (`apps/api`, raw SQL over `pg`), React 19 + Vite + MUI v6 + React Query + React Router v7 web (`apps/web`). Shared Zod schemas in `packages/shared`.

---

## Feature 1 — Player search autocomplete

### Backend: new list-returning search route
`resolvePlayer()` in `apps/api/src/repos/players.ts` already matches accent-insensitive first/last-either-order/substring and **orders by career fWAR** (`NAME_RESOLVE_ORDER_BY` = `fgwar.career_fwar DESC ...`). This satisfies the examples: `trou`→Trout, `sho`→Ohtani, `cy y`→Cy Young, and for `Ken` returns **Ken Griffey Jr. (~83) > Jeff Kent (~55) > Ken Caminiti (~26) > Ken McMullen (~20)** by career WAR. Only gap: a route that returns the candidate **list** (`/players/named` collapses to one id / 409).

- Add `GET /players/search?q=&limit=` in `apps/api/src/routes/players.ts` (zod-validated; require `q.trim().length >= 3`, clamp `limit` ~10).
  - Call `resolvePlayer(pool, { name_query: q, limit })` (preserves WAR order), enrich with `getFgCareerHintsForPlayerIds()` for `career_fwar`/`teams_display`/`fg_seasons` and a display `hint` via `formatCareerDisambiguationHint()`. Return results **still ordered by `career_fwar` desc**.
  - `{ results: [{ player_id, key_mlbam, name_first, name_last, birth_date, career_fwar, hint }] }`.
- Add `playerSearchResponseSchema` to `packages/shared`.

### Frontend: reusable async autocomplete
- New `apps/web/src/features/player-search/PlayerSearchAutocomplete.tsx` using **MUI `Autocomplete`** (installed, currently unused). Debounce ~250ms, query only at ≥3 chars via a new `apps/web/src/api/searchQueries.ts` hook (follow the `fetch`+`parseJsonOrThrow`+`HttpError` pattern in `apps/web/src/api/playerQueries.ts`). Primary text = full name, secondary = `hint`. Preserve server order (disable MUI's internal re-sort/`filterOptions` pass-through). On select → `navigate('/players/' + player_id)`.
- Reused in the nav bar and (later) the compare page pickers.

---

## Feature 2 — Season leaderboards (Batting / Pitching / Fielding)

Engine: `executeLeaderboardQuery()` in `apps/api/src/repos/leaderboardQuery.ts` + allowlist `apps/api/src/leaderboard/catalog.ts`. It already does datasets, sort metrics, `season_from/to`, `min_pa`, `min_ip_outs`, `qualified_only`, and emits a `LeaderboardAttachment`. Extend as follows.

### 2a. New REST route
`GET /leaderboard` — new `apps/api/src/routes/leaderboard.ts`, registered in `apps/api/src/index.ts`. Zod-validate all params below → `executeLeaderboardQuery` → return attachment (or `{ok:false}` as 400).

### 2b. Pagination
- Add `limit` (allow **20/50/100**, clamp ≤100) and `offset` (page-based) to `LeaderboardQueryArgs` and the SQL (`LIMIT $ OFFSET $`).
- Add `COUNT(*) OVER() AS total_rows` to the SELECT so one query returns the page **and** the total for page controls; compute global `rank = offset + i + 1`.
- Extend `leaderboardAttachmentSchema` in `packages/shared` with `page`/`page_size`/`total_rows` (provenance), so the UI can render "1–20 of N" + pager.

### 2c. Widen season catalogs (all source cols verified present on the consolidated MVs in `V30`)
- `BAT_SEASON_COLS`: add triple-slash computed **inline** — `avg=(x.h/NULLIF(x.ab,0))`, `slg=(x.tb/NULLIF(x.ab,0))`, `obp=((x.h+x.bb+x.hbp)/NULLIF(x.ab+x.bb+x.hbp+x.sf+x.sh,0))` (mirrors `fg_batting_career_mlb`); add `r,rbi,sb,bsr` (present); add `position` (join, 2e). `def_runs` present.
- `PIT_SEASON_COLS`: add `ip` (from `x.ip_outs`, formatted `IP.x`), `w,l,sv` (present), `role` (join, 2e). `era,fip,so(K),bb(BB),k_pct,bb_pct,hr_pct` present.
- Extend `columnLabel`/`columnDisplayType` for the new ids.

### 2d. Click-a-header → server-side sort
Pagination means sorting must be global, not just the current page. Every display column gets an allowlisted sort expression so a header click re-queries with that `sort_metric` (order toggled, page→1).
- Expand `BAT_SEASON_SORT` / `PIT_SEASON_SORT` to cover all new columns (`avg,obp,slg,r,rbi,sb,off_runs,bsr,games,pa` and `ip_outs,era,fip,so,bb,w,l,sv,k_pct,bb_pct,hr_pct`) using the same inline expressions. `def_runs` already sortable (season).

### 2e. Filters + per-season position
- **year range**: `season_from`/`season_to` (existing). The UI exposes a from–to range (defaulting both to 2026 = one season).
- **min PA / IP / fielding innings**: `min_pa`, `min_ip_outs` (existing); add `min_field_inn` for the fielding board → `LEFT JOIN LATERAL (SELECT SUM(inn) FROM fg_fielding_season_current f WHERE f.id_fg=x.id_fg AND f.season=x.season AND f.level='MLB') fi ON true` with `fi.sum >= $`.
- **team**: add `team` param → `EXISTS (SELECT 1 FROM fg_batting_season_current/fg_pitching_season_current s WHERE s.id_fg=x.id_fg AND s.season=x.season AND s.level='MLB' AND s.team=$)`.
- **position**: per-season, needed for both the `position` column **and** the position filter. Add a small migration creating a view `fg_batting_season_primary_pos (id_fg, season, pos_key)` that reuses the `V28`/`V29` DISTINCT-ON extraction of `stats_jsonb->>'Position'` (TOT-first, PA-desc) normalized to `C/1B/.../DH`. Join it for batting/fielding boards; for pitching use `mv_fg_pitcher_jaws_primary_role` (SP/RP/SP_RP). Filter with `pos_key = ANY($positions)`.
- Fielding Leaders = `fg_batting_season` sorted by `def_runs desc` (no new dataset) with a fielding column/filter preset.

### 2f. Split vs aggregate seasons
Add a `seasons_mode: 'split' | 'aggregate'` param.
- **split** (default): current per-`(player, season)` datasets — with a year *range* filter, each qualifying season is its own row (Trout 2012, 2013, … 2016 = five rows).
- **aggregate**: one row per player, summed over `[season_from, season_to]`. Implement as a windowed `GROUP BY player_id` subquery over the same consolidated MV, reusing the **exact expressions from the career views** (`fg_batting_career_mlb`/`fg_pitching_career_mlb` in `V30`): counting stats via `SUM`, triple-slash via `SUM(h)/SUM(ab)` etc., wRC+/wOBA via the already-exposed `wrc_plus_pa_num`/`_den`, ERA via `SUM(er)*27/SUM(ip_outs)`, FIP via `SUM(fip_innings_num)/SUM(innings_for_fip)`. So aggregate is career math bounded to the window, not a new formula set.
  - Column/sort ids reuse the career-style set (`career_*` labels shown without the "career" prefix, since the window is user-chosen); build `AGG_BAT_COLS`/`AGG_PIT_COLS` + sort maps and a FROM-builder emitting the windowed `GROUP BY` subquery aliased `x`.
  - Filters in aggregate mode apply to the **aggregated** totals: `min_pa`/`min_ip_outs`/`min_field_inn` on the summed values; `team` = played for team anywhere in the window (same EXISTS); `position` = PA-weighted primary position across the windowed seasons.
- Default view (from=to=2026, split) is unchanged; the toggle only diverges for multi-year ranges.

### 2g. Frontend: self-serve leaderboard page
Rework `apps/web/src/pages/LeaderboardPage.tsx`:
- MUI `Tabs`: **Batting / Pitching / Fielding**, each a preset (dataset + default sort + columns + default mins).
- Controls: **year-range** (from–to, default 2026–2026), **Split / Aggregate** toggle (`ToggleButtonGroup`), **page size** `Select` (20/50/100), **team** select, **position** multiselect, min-PA/IP/Fielding-innings inputs, pager (prev/next + "of N").
- State (tab, season_from/to, seasons_mode, filters, sort_metric, order, page, page_size) drives a new `apps/web/src/api/leaderboardQueries.ts` hook → `/api/leaderboard`; validate with `leaderboardAttachmentSchema`. Switching mode/range resets to page 1.
- Render with an adapted `apps/web/src/features/leaderboard/ChatLeaderboardPanel.tsx`: make sort **controlled** (headers call back to set `sort_metric`/`order` and re-query, instead of the current in-panel client sort) and add pagination props. Keep CSV export (current page). Name cells link to `/players/:player_id`.
- Keep the `location.state` replay path as a fallback for the chat "Full screen" hand-off.

---

## Navigation / app shell

- New `apps/web/src/app/AppShell.tsx` — MUI `AppBar` + `Toolbar` with brand, nav `Link`s (**Chat** `/`, **Leaderboards** `/leaderboards`, and a **Compare** link once that lands) and an inline `PlayerSearchAutocomplete`.
- Wrap the route tree with it via a layout route in `apps/web/src/app/main.tsx` (`<AppShell/>` + `<Outlet/>`). Chat (`App.tsx`) stays at `/`; also place the search box + a Leaderboards link on the chat home so "from the home page" is literally true.

---

## Player Compare — deferred (design agenda, not built this pass)

The user wants to work through what "compare" means before building. Assets that will be reused when we do: pages `CompareCareerPage.tsx`/`CompareStatcastPage.tsx`, `apps/web/src/api/compareQueries.ts`, `features/movement-velo/` SVG plots, `features/pitch-mix/` tables, `features/league-percentiles/` bars, and per-player endpoints that already accept `game_year` (`/players/:id/statcast-summary`, `/statcast-timeseries`, `/league-percentiles`) — so most flows need no new query work.

Open questions to resolve first (the user will add more):
- **Subjects**: two different players vs same player across years vs both; how many at once; pitcher vs batter (different stat sets).
- **Dimensions**: arsenal (velo/movement/release/stuff), plate discipline & percentiles, outcomes (slash/rate/value), batted-ball, defense — which belong in one view vs separate modes.
- **Meta-analysis**: what deltas/insights to auto-surface (e.g. "swinging less, pulling more"), how to normalize/contextualize (raw vs league percentile vs year-adjusted), and whether to flag notable changes.
- **Visuals**: overlay plots vs delta bars vs radar; how to show change direction.

---

## Verification

Run the stack (API 3001, web 5173; Vite proxies `/api`). Use `/run` if unsure how to launch.

1. **Search** — `GET /api/players/search?q=ken` returns Griffey → Kent → Caminiti → McMullen (career-WAR order); `?q=trou`/`?q=sho`/`?q=cy%20y` each surface the expected player first. UI: typing `sho` shows Ohtani; select → `/players/:id`; 2 chars fires nothing.
2. **Leaderboards** — `GET /api/leaderboard?dataset=fg_batting_season&sort_metric=war&order=desc&limit=20&offset=0&season_from=2026&season_to=2026&seasons_mode=split` returns 20 ranked rows + `total_rows`, with the new columns. Verify pagination (`limit=50`, `offset=50`), header re-sort (`sort_metric=obp`), and each filter (`team=`, `position=SS`, `min_pa=`, fielding `min_field_inn=`). **Split vs aggregate**: `season_from=2012&season_to=2016&seasons_mode=split` yields multiple Trout rows; the same with `seasons_mode=aggregate` yields one Trout row whose PA/HR/WAR equal the sum of his 2012–2016 seasons and whose AVG/wRC+ match the PA-weighted values. Pitching (`sort_metric=war`) and fielding (`sort_metric=def_runs`) likewise. UI: tabs, year-range + Split/Aggregate toggle + page-size/filter controls, header-click re-sort, pager, and player-card links all work; spot-check a couple leaders vs a known source.
3. Typecheck/build both workspaces; run existing API tests (leaderboard/catalog coverage) after the catalog/query changes.
