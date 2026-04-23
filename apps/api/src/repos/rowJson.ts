/** Normalize pg row values for JSON / Ollama tool payloads. */
export function rowToJson(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v instanceof Date) {
      out[k] = v.toISOString().slice(0, 10);
    } else if (typeof v === 'bigint') {
      const n = Number(v);
      out[k] = Number.isSafeInteger(n) ? n : String(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function rowsToJson(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((r) => rowToJson(r));
}
