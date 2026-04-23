# HTTP, CSV exports, and official MLB APIs

`mlbapp` does **not** ship a production ETL yet. This document describes **contracts at the HTTP/JSON/CSV layer** when you bypass `pybaseball` / `baseballr` or need to understand what those libraries wrap.

Nothing here is a promise that MLB or FanGraphs will keep URLs or parameters stable — **treat as operational documentation** and verify in a throwaway script before production loads.

---

## 1. Baseball Savant (Statcast) — CSV / search exports

### What you get

- **Representation:** Tabular **CSV-like** data (comma-separated text), one **row per pitch** for Statcast search exports.
- **Semantics:** Column names and units are documented by MLB at [Baseball Savant CSV documentation](https://baseballsavant.mlb.com/csv-docs).
- **Natural key (logical):** **`game_pk` + `at_bat_number` + `pitch_number`**; **`sv_id`** when present can help detect row revisions.

### Behavioral contract (conceptual)

| Input (conceptual) | Output |
|---------------------|--------|
| Date range (`start` / `end`) | All pitches whose `game_date` falls in range (subject to Savant’s own filters). |
| Optional team / player filters | Subset of pitches matching Savant UI / export rules for that filter. |
| Large windows | Responses are effectively **capped** (libraries chunk ~**30,000** rows per request — see [pybaseball statcast notes](./pybaseball.md)); plan the same if you implement raw HTTP. |
| Body | **UTF-8** text; first row header; subsequent rows data. |

### HTTP expectations

- **HTTPS** to `baseballsavant.mlb.com` (and related MLB hosts).
- **Rate limiting:** Use conservative concurrency, backoff on **429/503**, and honor **`robots.txt`** / [MLB Terms of Use](https://www.mlb.com/official-information/terms-of-use).
- **Corrections:** Savant **updates historical rows**; ingest should **UPSERT** on the natural key (see [DATASETS.md](../DATASETS.md)).

There is **no published OpenAPI** for these exports in this repo; pybaseball/baseballr maintain compatibility as Savant changes.

---

## 2. FanGraphs — leaderboard exports (unofficial HTTP)

### What you get

- **Representation:** Typically **HTML tables** or **CSV**-style leaderboard downloads behind the FanGraphs leaderboard UI.
- **Grain:** **Player–season–team** (with **`TOT`** and multi-team splits per FG rules).
- **Query dimensions (conceptual):** season span, league (`al` / `nl` / `all`), qualification (`qual` PA or IP), position filters, “individual seasons” vs rolled-up (`ind`), leaderboard **type** / tab (advanced, statcast, etc.).

### Contract sketch

| Concern | Guidance |
|---------|----------|
| **Stability** | Parameter names and leaderboard `type` ids **change** when the site changes; libraries encode current URLs — **pin library version** or snapshot the exact request in your ETL repo. |
| **Auth** | Public leaderboards are unauthenticated; do not assume the same for premium features. |
| **Terms** | Follow [FanGraphs Terms of Use](https://blogs.fangraphs.com/terms-of-use/) and avoid abusive scrape rates. |

FanGraphs does **not** provide a first-party **versioned public API** documented here; if you negotiate **official** data access, replace this section with your vendor contract.

---

## 3. MLB Stats API — JSON (official, read-only pattern)

### Base URL and versioning

- **Root:** `https://statsapi.mlb.com/api/v1/`
- **Versioning:** Path includes **`v1`**; MLB may introduce new versions — check `Accept` / docs on [MLB developer resources](https://statsapi.mlb.com/) (discovery starts at the root document).

### Request contract (common patterns)

| Pattern | Example | Typical use |
|---------|---------|-------------|
| **GET** JSON | `GET /api/v1/schedule?sportId=1&date=2024-07-04` | Games for a calendar day (`sportId=1` is MLB). |
| **GET** person | `GET /api/v1/people/660271` | Biographical / ids (`people` array with `id`, `fullName`, `birthDate`, `currentTeam`, etc.). |
| **GET** game | `GET /api/v1/game/746789/feed/live` (example) | Live/plays (heavy; not required for static Statcast CSV ingest). |

### Response contract (shape)

Responses are **JSON objects** whose top-level keys vary by endpoint. Common patterns:

- **`copyright`** string on many payloads (retain if you store raw JSON for compliance traceability).
- **Lists** under keys such as **`dates`** → **`games`** (schedule), **`people`**, **`teams`**, **`stats`**.
- **Identifiers:** **`gamePk`** (integer) aligns with Statcast **`game_pk`**; **`id`** on a person is often the **MLBAM** player id.

### Operational rules

| Rule | Detail |
|------|--------|
| **Method** | **GET** for reads; no request body. |
| **Errors** | Non-2xx JSON may include a message; handle **429** / **5xx** with backoff. |
| **Caching** | Responses are cacheable for schedules/rosters; respect freshness needs for live features. |

Use the Stats API when you need **schedule**, **roster**, or **canonical MLB ids** without scraping Savant HTML. Statcast **pitch files** are still usually obtained via **Savant exports** (or pybaseball/baseballr), not the full pitch log in one Stats API call.

---

## 4. Chadwick register (HTTP / file)

The **Chadwick Bureau** publishes a **public player register** as CSV shards under `data/people-*.csv` inside the [`register` repo zip](https://github.com/chadwickbureau/register/archive/refs/heads/master.zip) (not a single `people.csv`). baseballr/pybaseball wrap downloads; this repo’s ETL concatenates every shard so **`key_uuid`** and full crosswalk columns are preserved. Treat each release as a **versioned snapshot** and store **zip URL / `artifact_sha256` / row counts** in `ingest_snapshot.params`.

Terms: follow the [register repository](https://github.com/chadwickbureau/register) license and attribution expectations.

---

## Summary

| Source | Format | Stable contract? |
|--------|--------|------------------|
| Savant Statcast export | CSV columns per [csv-docs](https://baseballsavant.mlb.com/csv-docs) | Column **semantics** stable-ish; **URLs** maintained by libraries |
| FanGraphs leaderboards | CSV/HTML via site | **Low** — use libraries or snapshot exact requests |
| MLB Stats API | JSON `v1` | **Medium** — versioned path; fields still evolve |
| Chadwick register | CSV | **Medium** — schema evolves with releases |
