import { useQuery } from '@tanstack/react-query';
import { HttpError } from '@/api/queryClient.js';

export const statcastTimeseriesKeys = {
  range: (
    playerId: number,
    params: { role: 'batter' | 'pitcher'; metric: string; from: number; to: number },
  ) => ['player', playerId, 'statcast-timeseries', params] as const,
};

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export { num as parseStatcastTimeseriesNumber };

export async function fetchStatcastTimeseries(
  playerId: number,
  params: { role: 'batter' | 'pitcher'; metric: string; from: number; to: number },
): Promise<unknown[]> {
  const q = new URLSearchParams({
    role: params.role,
    metric: params.metric,
    from: String(params.from),
    to: String(params.to),
  });
  const r = await fetch(`/api/players/${playerId}/statcast-timeseries?${q}`);
  const j = (await r.json()) as { rows?: unknown[]; error?: string };
  if (!r.ok) {
    throw new HttpError(String(j.error ?? (r.statusText || 'Request failed')), r.status);
  }
  return Array.isArray(j.rows) ? j.rows : [];
}

export function useStatcastTimeseriesQuery(opts: {
  playerId: number;
  role: 'batter' | 'pitcher';
  metric: string;
  fromYear: number;
  toYear: number;
  enabled?: boolean;
}) {
  const { playerId, role, metric, fromYear, toYear, enabled = true } = opts;
  const lo = Math.min(fromYear, toYear);
  const hi = Math.max(fromYear, toYear);
  const params = { role, metric, from: lo, to: hi };
  return useQuery({
    queryKey: statcastTimeseriesKeys.range(playerId, params),
    queryFn: () => fetchStatcastTimeseries(playerId, params),
    enabled:
      enabled && Number.isFinite(playerId) && playerId > 0 && Number.isFinite(lo) && Number.isFinite(hi),
  });
}
