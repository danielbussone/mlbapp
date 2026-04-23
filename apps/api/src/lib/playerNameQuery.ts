/** Last name tokens that are not part of dim_player.name_last (Chadwick-style split). */
const GEN_SUFFIX = /^(jr\.?|sr\.?|ii|iii|iv|v|vi|vii|viii|ix)$/i;

export function stripTrailingGenerationalSuffixes(parts: string[]): string[] {
  const out = [...parts];
  while (out.length > 1 && GEN_SUFFIX.test(out[out.length - 1] ?? '')) {
    out.pop();
  }
  return out;
}

/** Drop trailing Jr./Sr./roman numerals so "Ronald Acuña Jr." matches name_last "Acuña". */
export function stripGenerationalSuffixFromQuery(q: string): string {
  const parts = stripTrailingGenerationalSuffixes(q.trim().split(/\s+/).filter(Boolean));
  return parts.join(' ');
}

/**
 * Normalize free-text player names from users or LLM tool args before DB resolve.
 * Idempotent for well-formed names.
 */
export function normalizePlayerNameQuery(q: string): string {
  let s = q.trim();
  if (!s) return s;
  // Small models often misplace the tilde: "Acuáa" instead of "Acuña".
  s = s.replace(/Acuáa/gi, 'Acuña');
  // Tilde on wrong letter: "Acuán" instead of "Acuña".
  s = s.replace(/Acuán/gi, 'Acuña');
  return s;
}

function parseBirthDate(v: unknown): Date | null {
  if (v == null) return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v;
  const s = String(v).trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Chadwick stores Jr/Sr outside `name_last`, so "Ken Griffey Jr." strips to "Ken Griffey" and
 * matches both Sr and Jr. When the user suffix is Jr. or Sr., prefer youngest / oldest by birth_date.
 */
export function narrowCandidatesByGenerationalHint(
  rawNameQuery: string,
  candidates: Record<string, unknown>[]
): Record<string, unknown>[] {
  if (candidates.length <= 1) return candidates;
  const q = rawNameQuery.trim();
  const hasJr = /\bjr\.?\s*$/i.test(q);
  const hasSr = /\bsr\.?\s*$/i.test(q);
  if (!hasJr && !hasSr) return candidates;

  const dated = candidates
    .map((c) => ({ c, ts: parseBirthDate(c.birth_date) }))
    .filter((x): x is { c: Record<string, unknown>; ts: Date } => x.ts != null);
  if (dated.length === 0) return candidates;

  if (hasJr) {
    const maxTime = Math.max(...dated.map((x) => x.ts.getTime()));
    const picked = dated.filter((x) => x.ts.getTime() === maxTime).map((x) => x.c);
    if (picked.length === 1) return picked;
    return candidates;
  }
  const minTime = Math.min(...dated.map((x) => x.ts.getTime()));
  const picked = dated.filter((x) => x.ts.getTime() === minTime).map((x) => x.c);
  if (picked.length === 1) return picked;
  return candidates;
}
