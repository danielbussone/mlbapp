# pybaseball (Python)

[pybaseball](https://github.com/jldbc/pybaseball) scrapes **FanGraphs**, **Baseball Savant (Statcast)**, Baseball Reference, Chadwick, and related sources. It returns **pandas `DataFrame`** objects unless otherwise noted.

Upstream reference: [function docs folder](https://github.com/jldbc/pybaseball/tree/master/docs) (markdown per function; authoritative for argument names).

---

## FanGraphs — season leaderboards

### `batting_stats(start_season, end_season=None, league='all', qual=None, ind=1)`

| Aspect | Detail |
|--------|--------|
| **Grain** | One row per **player–season** (and team split when `ind=1` across years); with `ind=1` within a single season you get one row per player per **team** plus `TOT` where applicable. |
| **Arguments** | `start_season` / `end_season` (integers); `league`: `"all"`, `"nl"`, `"al"`, `"mnl"` (Negro Leagues); `qual`: min PA (`None` = FG “qualified” threshold); `ind`: `1` = per-season rows, `0` = aggregate across span. |
| **Expected output** | `DataFrame` with **`IDfg`** (FanGraphs player id), **`Season`**, **`Name`**, **`Team`**, **`Age`**, **`Pos`**, counting stats, slash, `wOBA`, `wRC+`, `WAR`, hundreds of optional columns depending on season. Column names match FG exports (e.g. `BB%`, `K%` with `%` in the name — normalize in ETL for SQL). |
| **Joins** | Map **`IDfg`** → `player_external_identifier(id_system='fangraphs')`; optional MLBAM from **`playerid_lookup`** / Chadwick, not always present on every FG row. |

### `pitching_stats(start_season, end_season=None, league='all', qual=None, ind=1)`

Same pattern as `batting_stats` for **pitcher** season leaderboards (`W`, `L`, `ERA`, `IP`, `FIP`, `xFIP`, `WAR`, etc.). See [pitching_stats.md](https://github.com/jldbc/pybaseball/blob/master/docs/pitching_stats.md) upstream.

### `batting_stats_range(start_dt, end_dt)` / `pitching_stats_range(start_dt, end_dt)`

| Aspect | Detail |
|--------|--------|
| **Grain** | FG stats aggregated over a **calendar date range** (not necessarily full seasons). |
| **Arguments** | `YYYY-MM-DD` strings. |
| **Expected output** | Similar wide `DataFrame` to season leaderboards; confirm column parity in your ETL if you mix range and season pulls. |

---

## Statcast — pitch-level

### `statcast(start_dt=None, end_dt=None, team=None, verbose=True, parallel=True)`

| Aspect | Detail |
|--------|--------|
| **Grain** | **One row per pitch**. |
| **Arguments** | `start_dt` / `end_dt` (`YYYY-MM-DD`); optional `team` (MLB abbrev, e.g. `TEX`); `parallel` splits large HTTP fan-out. |
| **Row cap** | Savant returns **at most ~30,000 rows per underlying request**; pybaseball **chunks** date ranges and concatenates into one `DataFrame`. Full seasons still need sensible chunking + dedupe on `(game_pk, at_bat_number, pitch_number)`. |
| **Expected output** | Wide `DataFrame`; column definitions in [Baseball Savant CSV documentation](https://baseballsavant.mlb.com/csv-docs). Includes `game_pk`, `at_bat_number`, `pitch_number`, `sv_id`, `pitcher`, `batter` (MLBAM ints), `game_date`, `game_year`, movement, spin, launch speed/angle when applicable, run-value fields, etc. |
| **Availability** | Pitch-level data back to **2008**; many batted-ball / spin fields only from **2015+**. |

See upstream [statcast.md](https://github.com/jldbc/pybaseball/blob/master/docs/statcast.md).

### `statcast_pitcher(start_dt, end_dt, player_id)` / `statcast_batter(start_dt, end_dt, player_id)`

| Aspect | Detail |
|--------|--------|
| **Grain** | Same as `statcast`, filtered to one **pitcher** or **batter** MLBAM id. |
| **`player_id`** | Integer **MLBAM** id (from `playerid_lookup` or Chadwick). |

---

## Player ID crosswalk — Chadwick / lookup

### `chadwick_register()`

| Aspect | Detail |
|--------|--------|
| **Grain** | One row per register person (many columns of ids and names). |
| **Expected output** | `DataFrame` including **`key_uuid`**, **`key_mlbam`**, **`key_fangraphs`**, **`key_bbref`**, **`key_retro`**, name keys, career span fields (exact set evolves with Chadwick releases). |

### `playerid_lookup(last_name, first_name=None)`

| Aspect | Detail |
|--------|--------|
| **Grain** | Zero or more rows (name collisions possible). |
| **Expected output** | Typically includes **`key_mlbam`**, **`key_fangraphs`**, **`key_bbref`**, **`key_retro`**, etc., for disambiguation. |

---

## Caching

```python
from pybaseball import cache
cache.enable()
```

Caches HTTP responses on disk; see upstream README for **purge** if you see empty results after bad date queries.

---

## Practical expectations for ETL

1. **Dtypes:** pandas may infer floats for integer-like ids; coerce **`game_pk`**, **`batter`**, **`pitcher`** to integers before load.
2. **Column drift:** New FG / Savant columns appear without notice — keep **`stats_jsonb` / `payload_jsonb`** and promote columns when the card needs them ([SCHEMA_PROPOSAL.md](../SCHEMA_PROPOSAL.md)).
3. **Percent columns:** FG often uses strings with `%` in column names; normalize to numeric fractions or consistent percent scale in the database.
