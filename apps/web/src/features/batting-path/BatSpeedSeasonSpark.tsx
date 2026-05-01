import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useEffect, useMemo, useState } from 'react';
import styles from './BatSpeedSeasonSpark.module.css';

type Row = { game_year: number; player_avg_bat_speed?: unknown; league_avg_bat_speed?: unknown };

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Fetches yearly bat-path summary and draws mph sparkline + league reference + y-axis ticks. */
export function BatSpeedSeasonSpark({
  playerId,
  season,
  fromYear,
  showLeagueAxis = true,
}: {
  playerId: number;
  /** Current card season (spark runs up to this year). */
  season: number;
  /** Earliest season on the chart (inclusive). */
  fromYear: number;
  /** Taller chart with left mph ticks (default true). */
  showLeagueAxis?: boolean;
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

  const { pts, leaguePts } = useMemo(() => {
    const out: { x: number; yv: number }[] = [];
    const lg: { x: number; yv: number }[] = [];
    for (const r of rows) {
      const yv = num(r.player_avg_bat_speed);
      const lv = num(r.league_avg_bat_speed);
      if (yv != null) out.push({ x: r.game_year, yv });
      if (lv != null) lg.push({ x: r.game_year, yv: lv });
    }
    out.sort((a, b) => a.x - b.x);
    lg.sort((a, b) => a.x - b.x);
    return { pts: out, leaguePts: lg };
  }, [rows]);

  if (err || pts.length === 0) return null;

  const firstPt = pts[0];
  const lastPt = pts[pts.length - 1];
  const minX = firstPt.x;
  const maxX = lastPt.x;
  const allY = [...pts.map((p) => p.yv), ...leaguePts.map((p) => p.yv)];
  const minY = Math.floor(Math.min(...allY) - 1);
  const maxY = Math.ceil(Math.max(...allY) + 1);

  const W = showLeagueAxis ? 300 : 280;
  const H = showLeagueAxis ? 100 : 72;
  const padL = showLeagueAxis ? 34 : 8;
  const padR = 8;
  const padT = 8;
  const padB = showLeagueAxis ? 22 : 8;

  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const sx = (gx: number) => padL + ((gx - minX) / (maxX - minX || 1)) * plotW;
  const sy = (gy: number) => padT + plotH - ((gy - minY) / (maxY - minY || 1)) * plotH;

  const dPlayer = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${sx(p.x)} ${sy(p.yv)}`).join(' ');
  const dLeague =
    leaguePts.length > 0
      ? leaguePts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${sx(p.x)} ${sy(p.yv)}`).join(' ')
      : '';

  const yTicks: number[] = [];
  const step = maxY - minY <= 6 ? 1 : 2;
  for (let t = minY; t <= maxY; t += step) yTicks.push(t);

  return (
    <Box className={styles.wrap}>
      <Typography variant="subtitle2" className={styles.title}>
        Bat speed by season
      </Typography>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        {showLeagueAxis &&
          yTicks.map((mph) => (
            <g key={mph}>
              <line
                x1={padL}
                x2={W - padR}
                y1={sy(mph)}
                y2={sy(mph)}
                stroke="#e0e0e0"
                strokeDasharray="4 3"
                strokeWidth={0.75}
              />
              <text x={padL - 4} y={sy(mph)} textAnchor="end" dominantBaseline="middle" fontSize="9" fill="#757575">
                {mph}
              </text>
            </g>
          ))}
        {dLeague && (
          <path
            d={dLeague}
            fill="none"
            stroke="#9e9e9e"
            strokeWidth={1.25}
            strokeDasharray="4 3"
            opacity={0.95}
          />
        )}
        <path d={dPlayer} fill="none" stroke="#00838f" strokeWidth={1.75} />
        {pts.map((p) => (
          <circle key={p.x} cx={sx(p.x)} cy={sy(p.yv)} r={3} fill="#00838f" />
        ))}
        {showLeagueAxis && (
          <text x={padL + plotW / 2} y={H - 4} textAnchor="middle" fontSize="9" fill="#757575">
            Season
          </text>
        )}
        {showLeagueAxis && (
          <text
            x={4}
            y={padT + plotH / 2}
            textAnchor="middle"
            fontSize="9"
            fill="#757575"
            transform={`rotate(-90 4 ${padT + plotH / 2})`}
          >
            mph
          </text>
        )}
      </svg>
      <Typography variant="caption" color="text.secondary" className={styles.footer}>
        Teal: player avg bat speed where tracked. Gray dashed: league avg (same season, all bat-tracked swings).
      </Typography>
    </Box>
  );
}
