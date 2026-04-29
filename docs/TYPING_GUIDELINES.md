# Typing guidelines (TypeScript)

This document describes how we want to use TypeScript’s type system in this repo: **stricter modeling where it pays off**, especially at **boundaries** and anywhere **“missing” must not be confused with a numeric zero** (or other sentinel values). It is **guidance only**—no requirement to refactor existing code unless you are already touching an area.

## Goals

- Catch invalid states at **compile time** when practical.
- Make **impossible states** harder to represent (e.g. “we have a total but no definition flag”).
- Keep patterns **readable** for contributors who do not use heavy functional libraries daily.

## Baseline

- Prefer **`"strict": true`** (and related strict flags) in `tsconfig` for application and library code.
- Rely on **`strictNullChecks`**: `T` and `T | null` / `T | undefined` are different types; narrow before use.
- Avoid **`any`**. Prefer **`unknown`** at JSON/DB boundaries, then parse or narrow into concrete types.
- Use **`noImplicitReturns`**, **`noUnusedLocals`**, and **`noFallthroughCasesInSwitch`** where enabled.

## Missing data vs real zeros (and similar sentinels)

Scala’s `Option[Int]` separates **`None`** from **`Some(0)`**. TypeScript does not provide this automatically; **`number | null`** (or a small tagged union) is the usual encoding.

**Principles**

1. **Do not conflate** “no value” with “value is zero” in the **type** you pass around when the distinction matters for UX or correctness (e.g. defensive rates, optional metrics).
2. **Do not erase** distinction with blanket helpers such as “`null` → `0` then sum” unless the **domain** truly treats missing as zero and callers are documented to that effect.
3. For display logic, **dashes vs numeric output** should follow an explicit rule: e.g. “dash only when no source cell had the metric,” not “dash when sum is 0.”

**Lightweight patterns (no extra libraries)**

- **`number | null`** (or `undefined`) for a single optional scalar, with narrowing at use sites.
- **Companion flag** on aggregates when you already store a numeric sum: e.g. `total` + `defined` / `hasData`, when you want to avoid `null` on every field in a large row shape.
- **Tagged unions** for richer “some / none” without `fp-ts`:

  ```ts
  type OaaAgg = { kind: 'none' } | { kind: 'some'; value: number };
  ```

**Library patterns (optional, for new modules only)**

- **`fp-ts`** `Option`, **`oxide`**, **`ts-results`**, etc., when a module is heavily combinator-based and the team agrees to the dependency and style.

Prefer **small, local** representations over forcing every file into a single abstraction.

## Boundaries: HTTP, JSON, and database rows

- Responses from `fetch` / Fastify / `pg` rows are **`unknown` or `Record<string, unknown>`** until validated.
- Prefer **one** narrowing step: **Zod** (or similar) at the API client, or a **narrowing function** that returns a typed result / error.
- Avoid casting **`as MyType`** on untrusted payloads unless the value was produced by a validator immediately above.

Internal code should consume **named types** or **interfaces**, not raw `Record<string, unknown>`.

## Domain types vs primitives

- Prefer **`type PlayerId = number & { readonly __brand: unique symbol }`** (or a plain `number` alias documented as MLB surrogate) **only** where mistaken argument order has caused bugs; otherwise avoid noise.
- Use **string literal unions** for enums that are closed and stable (`'aggregated' | 'byPosition'`).
- Prefer **`const` assertions** on small config objects so literals infer as narrowly as possible.

## Functions and returns

- Prefer **explicit return types** on **public** exports and on functions whose inferred type is wide or fragile.
- For “parse or fail,” return **`Result`** / **`{ ok: true, value } | { ok: false, error }`** instead of throwing from deep helpers, when it improves call-site clarity (optional; match existing module style).

## React and UI

- Props: **required vs optional** should match runtime reality; avoid optional props that are effectively required for half the modes.
- Prefer **`undefined` for “omit prop”** and reserve **`null`** for APIs that distinguish null if you need both; pick one convention per surface and document it.
- Event handlers: narrow **`unknown`** errors in `catch` if you surface messages to users.

## Anti-patterns to avoid

- **`value ?? 0`** on optional metrics when “missing” and “zero” mean different things to users or downstream logic.
- **`!` non-null assertions** to silence the compiler without a real invariant comment nearby.
- **Wide `object` or `{}`** in public APIs.
- **Display helpers** that map **`0` → “empty”** for metrics where zero is meaningful (rates, counts after aggregation, etc.).

## Code review checklist (short)

- Does this API **`any`** or **`as`** away validation?
- Could **`null`/missing** be confused with **`0`** or default values?
- Are union variants **discriminated** where multiple shapes exist?
- Would a **new contributor** see the type and know valid states without reading implementation?

## Scope and evolution

- **Greenfield** code and **touched** modules should lean toward these guidelines first.
- **Wide refactors** “for typing only” are not required; prefer incremental tightening when behavior is already under test or manual verification.

## Related in-repo examples

- Fielding rollups use explicit **“metric defined?”** flags alongside sums so UI can show **“—”** vs **`0.0`** intentionally (`outfieldFieldingAgg.ts` / `OutfieldFieldingTables.tsx`). That pattern is an example of **encoding presence** without pulling in `Option` types everywhere.

---

*This is a living document. Propose changes via PR when team conventions shift (e.g. adopting Zod everywhere or standardizing on a small `Option` helper).*
