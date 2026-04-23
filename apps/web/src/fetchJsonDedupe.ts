/** Coalesce identical in-flight GET+JSON parses (e.g. React Strict Mode double effects). */
const inflight = new Map<string, Promise<unknown>>();

export async function fetchJsonDedupe(url: string): Promise<unknown> {
  const hit = inflight.get(url);
  if (hit) return hit;
  const p = (async () => {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`${url} failed (${res.status})`);
    }
    const text = await res.text();
    if (!text) return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return { raw: text };
    }
  })().finally(() => {
    inflight.delete(url);
  });
  inflight.set(url, p);
  return p;
}
