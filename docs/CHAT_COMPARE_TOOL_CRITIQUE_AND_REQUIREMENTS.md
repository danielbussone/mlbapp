# Chat compare tool: critique and requirements

This document captures problems observed when asking the chat to **compare two players’ careers** (e.g. Mike Trout vs Ken Griffey Jr.), critiques the **assistant text** and the **current tool payload**, and lists **requirements** for follow-up work. It is intentionally **not** a patch list for one-off prompt tweaks; prefer structured product changes (rollup view, split tools) over whack-a-mole on the model.

---

## 1. What the stack does today

- For prompts matching **“Compare {A} and {B}”**, the API may **server-inject** `compare_players_career`, which:
  - Resolves both names to `dim_player`
  - Loads **FanGraphs batting (and optionally pitching) season rows** from `fg_*_season_current` (many rows per player: multi-team years, partial careers, etc.)
  - Returns a **large JSON** payload (often **20k+ characters** after LLM-oriented stripping) as a single `role: tool` message for Ollama.
- Logs show **~31k `transcriptJsonChars`** on the first Ollama round: system + user + synthetic assistant + tool body. That is a lot of context for a small instruct model to parse faithfully.

---

## 2. Critique of the assistant response (example)

The model produced a readable narrative but **much of it is not grounded in the tool JSON** and some lines are **wrong or nonsensical** relative to baseball facts and to our data contract (“only cite what appears in tools”).

| Issue | Example from chat | Why it matters |
|--------|-------------------|----------------|
| **Invented “career” slash and counting stats** | Stated career AVG / HR pairs as headline facts | Our tool returns **per-season** rows, not a single pre-aggregated career card; any “career” number should be **computed explicitly** from rows or returned from a **rollup** endpoint—not invented. |
| **Wrong or unverifiable totals** | Specific HR / AVG figures for both players | Easy to hallucinate; **All-Star / Gold Glove counts** also do not come from `compare_players_career`. |
| **Fabricated awards** | “6 Platinum Gloves” for Trout | **Platinum Glove** is not a standard six-per-player history like that; in any case **awards are not in the FG compare payload**. |
| **Pitching section is misleading** | Griffey described as “shortstop/pitcher” with weak pitching | Compare may include **pitching rows** (often empty or trivial for position players); the model **invented a pitching narrative** instead of saying “no meaningful pitching lines” or omitting. |
| **Wrong role for the comparison** | **Both** Trout and Griffey are **batters / fielders**, not pitchers—yet the answer includes a **“Pitching”** section | The question is a **hitter-vs-hitter** compare; pitching prose is **off-topic** unless the user or data explicitly raises two-way or mop-up appearances. Supplying `pitching[]` (even empty) nudges models toward padding with irrelevant role content. |
| **Labeling errors** | OBP described in an “AVG” bullet | Suggests the model is **not reading keys carefully** under cognitive load from a huge JSON. |
| **Era / “who is greater” essay** | Long conclusion about eras and peaks | Not forbidden by product rules, but **not tied to cited rows**—violates the spirit of strict grounding when numbers and awards are wrong. |

**Takeaway:** Even when tools succeed, **season-level grids are a poor interface for “career compare” questions** for current LLMs: they invite summarization errors, invented counting stats, and imported priors (awards, reputation).

---

## 3. Critique of the tool response shape (payload / UX for the model)

| Issue | Evidence / effect |
|--------|-------------------|
| **High cardinality** | Dozens of rows × two players × key metrics still yields **very large** `messages[].content` for `compare_players_career`. |
| **Cognitive load** | The model must **aggregate** (sum PA-weighted rates, sum WAR, pick “career” vs “active” seasons) itself—error-prone. |
| **No first-class “career object”** | Payload is **arrays of seasons**, not “career totals + optional peak window + notes”. |
| **Multi-row same season** | Team/level splits mean **row count ≠ seasons played**; easy to mis-explain “career length”. |
| **Pitching block noise** | For two OF/DH-type stars, pitching arrays add **little value** but add tokens and confuse small models. Same in reverse: **batting-heavy payloads for two SPs** can be noise if the user only cares about pitching lines. |
| **No role-aware routing** | `include_batting` / `include_pitching` are generic booleans; server-inject and defaults do not consistently infer **batter vs pitcher** for both players | Product should **route or omit** by primary role so the LLM never sees an irrelevant empty block for a “same role” career compare. |
| **Downstream latency** | Large context + tool JSON increases **time to first token** and timeout risk (mitigated elsewhere with `num_ctx` / HTTP timeouts). |

**Takeaway:** For the question **“compare careers”**, the product probably wants a **career rollup** (or FG “total” concept) as the **primary** artifact, not raw season lists—**unless** the user explicitly wants season-by-season tables.

---

## 4. Requirements (future work)

These are **requirements for design / implementation later**, not commitments in this doc’s version of the codebase.

### R1 — Split “career compare” from “season compare”

- **R1a:** Introduce a dedicated **career rollup** path for chat (new tool, or a `mode` / `granularity` parameter on compare), returning a **small, stable JSON** shape, e.g.:
  - Per player: `display_name`, `player_id`, **batting career** (PA, HR, R, RBI, SB, slash, `wrc_plus` if defined as career-weighted or FG-provided), **WAR** (document whether sum-of-seasons or FG career if available), **first_season`, `last_season`, `season_row_count`**.
  - Optional: **peak window** (best 5y WAR, best single season by WAR) **computed in SQL or TS** from the same source tables.
- **R1b:** Keep a separate **season / span compare** tool (or mode) that returns **bounded** season rows (with explicit `limit`, `season_from` / `season_to`, and clear ordering) when the user asks for years, trends, or side-by-side seasons.

### R2 — Career rollup semantics must be documented and tested

- **R2a:** Document **how** each rolled-up field is computed (e.g. WAR as sum of season WAR vs imported FG career total; rate stats not simple sums).
- **R2b:** Add **automated tests** on rollup outputs for known players (golden fixtures or snapshot tolerances).

### R3 — Grounding and safety in the assistant layer

- **R3a:** System or host rules: **do not cite** All-Star selections, Gold Gloves, or other awards **unless** a tool returned them (future `awards` / `all_star` tool or column).
- **R3b:** If pitching arrays are empty or all-null, the model should **omit pitching** or state “no MLB pitching lines in FanGraphs data” instead of inventing roles. **Prefer fixing this in the payload** (R7): do not send irrelevant role sections for hitter-vs-hitter (or pitcher-vs-pitcher) compares.

### R7 — Role-aware compare: route or omit batting vs pitching

- **R7a — Primary role signal:** Define a deterministic source for “this player is primarily a pitcher vs position player” (e.g. Chadwick `position` / debut role, majority of career PA vs IP, or a maintained flag). Document fallbacks for two-way players.
- **R7b — Batter vs batter:** For **two primary hitters/fielders**, default **`include_pitching: false`** and **omit the `pitching` key** (or send `pitching: null` with `meta.omitted_roles: ['pitching']`) so the model is not prompted to discuss pitching at all. Same for server-injected “Compare A and B” when both resolve as non-pitchers.
- **R7c — Pitcher vs pitcher:** Symmetrically, when both are primary pitchers, default **`include_batting: false`** (or only batting-as-hitter if product wants DH/PH lines) and omit irrelevant empty batting blocks unless the user asks for hitting stats.
- **R7d — Mixed (pitcher vs batter):** Return **both** roles with clear `meta.compare_kind: 'pitcher_vs_batter'` and per-player `primary_role` so the model can structure the answer without inventing a second pitcher narrative for the batter.
- **R7e — User override:** If the user explicitly asks for “pitching too” or “both sides of the ball,” allow tool args to force-include the suppressed role despite defaults.

### R4 — Payload size budgets

- **R4a:** Define **max JSON size** (or max rows) for each tool mode; log when truncation happens.
- **R4b:** Prefer **server-side aggregation** over “send everything and hope the model sums correctly.”

### R5 — Optional follow-on data sources

- **R5a:** If product needs awards / ASG / MVP, add **explicit tools or materialized views** rather than letting the model fill gaps from training data.

### R6 — Observability

- **R6a:** Keep correlating **db_query → tool_run → ollama_request** logs (already improved) to verify that post-rollup payloads shrink `transcriptJsonChars` and improve answer quality.

---

## 5. Follow-up todos (tracking)

Use this list in planning / issue tracker; check off when done.

- [ ] **Design** `compare_players_career_rollup` (or equivalent) JSON schema + SQL/TS aggregation rules.
- [ ] **Implement** rollup tool or compare `granularity=career|seasons` with separate code paths.
- [ ] **Implement** season-span compare with strict limits and clear `meta` (row counts vs seasons).
- [ ] **Tune** server-inject heuristic: inject **rollup** for bare “Compare X and Y”; require explicit wording for full season dumps.
- [ ] **Role-aware compare (R7):** infer `primary_role` per player; omit pitching from payload for two batters / omit batting for two pitchers; mixed compare documented in `meta`.
- [ ] **Prompt / policy** updates tied to schema (awards, pitching-empty behavior)—after rollup + role routing exist, not before.
- [ ] **Tests** for rollup correctness + chat checklist curl for “Compare …” using rollup response size targets.
- [ ] **Docs** update `CHAT_API_TESTING.md` / README when new tools ship.

---

## 6. References

- `apps/api/src/repos/comparePlayers.ts` — compare query assembly and LLM strip.
- `apps/api/src/services/ollama.ts` — server compare inject, Ollama rounds.
- `docs/CHAT_API_TESTING.md` — manual / scripted chat checks.
