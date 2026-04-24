import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useEffect, useMemo, useState } from 'react';

type Row = { game_year: number; player_avg_bat_speed?: unknown };

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Fetches yearly bat-path summary and draws a simple mph sparkline across seasons. */
export function BatSpeedSeasonSpark({
  playerId,
  season,
  fromYear,
}: {
  playerId: number;
  /** Current card season (spark runs up to this year). */
  season: number;
  /** Earliest season on the chart (inclusive). */
  fromYear: number;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const lo = Math.min(fromYear, season);
    const hi = Math.max(fromYear, season);
    void (async () => {
      try {
        const q = new URLSearchParams({
          role: 'batter',
          metric: 'bat_path',
          from: String(lo),
          to: String(hi),
        });
        const r = await fetch(`/api/players/${playerId}/statcast-timeseries?${q}`);
        const j = (await r.json()) as { rows?: Row[]; error?: string };
        if (cancelled) return;
        if (!r.ok) {
          setErr(j.error ?? String(r.status));
          setRows([]);
          return;
        }
        setErr(null);
        setRows(Array.isArray(j.rows) ? j.rows : []);
      } catch {
        if (!cancelled) setErr('network');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [playerId, season, fromYear]);

  const pts = useMemo(() => {
    const out: { x: number; y: number; yv: number }[] = [];
    for (const r of rows) {
      const yv = num(r.player_avg_bat_speed);
      if (yv == null) continue;
      out.push({ x: r.game_year, y: yv, yv });
    }
    return out.sort((a, b) => a.x - b.x);
  }, [rows]);

  if (err || pts.length === 0) return null;

  const minX = pts[0]!.x;
  const maxX = pts[pts.length - 1]!.x;
  const speeds = pts.map((p) => p.yv);
  const minY = Math.min(...speeds) - 1;
  const maxY = Math.max(...speeds) + 1;
  const W = 280;
  const H = 72;
  const pad = 8;

  const sx = (gx: number) => pad + ((gx - minX) / (maxX - minX || 1)) * (W - 2 * pad);
  const sy = (gy: number) => H - pad - ((gy - minY) / (maxY - minY || 1)) * (H - 2 * pad);

  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${sx(p.x)} ${sy(p.yv)}`).join(' ');

  return (
    <Box sx={{ mt: 1 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
        Bat speed by season
      </Typography>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        <path d={d} fill="none" stroke="#00838f" strokeWidth={1.5} />
        {pts.map((p) => (
          <circle key={p.x} cx={sx(p.x)} cy={sy(p.yv)} r={2.5} fill="#00838f" />
        ))}
      </svg>
      <Typography variant="caption" color="text.secondary">
        Avg bat speed (mph) where Hawk-Eye tracked swings exist per year.
      </Typography>
    </Box>
  );
}
