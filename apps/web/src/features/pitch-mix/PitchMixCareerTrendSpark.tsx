import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useMemo } from 'react';
import {
  parseStatcastTimeseriesNumber as num,
  useStatcastTimeseriesQuery,
} from '@/api/statcastTimeseriesQueries.js';
import { pitchTypeMovementColor } from '@/features/movement-velo/MovementMiniPlot.js';
import { pitchTypeName } from './pitchTypeLabels.js';
import styles from './PitchMixCareerTrendSpark.module.css';

type Row = { game_year: number; pitch_type?: unknown; pct?: unknown; pitches?: unknown };

function normPt(s: string): string {
  return s.trim().toUpperCase();
}

const MAX_TYPES = 5;

/** Multi-line usage % by season from `statcast-timeseries` (`metric=pitch_mix`). */
export function PitchMixCareerTrendSpark({
  playerId,
  season,
  fromYear,
}: {
  playerId: number;
  season: number;
  fromYear: number;
}) {
  const { data: rawRows = [], isPending, isError, error } = useStatcastTimeseriesQuery({
    playerId,
    role: 'pitcher',
    metric: 'pitch_mix',
    fromYear,
    toYear: season,
  });
  const rows = rawRows as Row[];
  const err = isError ? (error instanceof Error ? error.message : 'Request failed') : null;

  const { years, topTypes, seriesByType } = useMemo(() => {
    const byYearType = new Map<string, number>();
    const typePitches = new Map<string, number>();
    const yearSet = new Set<number>();
    for (const r of rows) {
      const y = r.game_year;
      const pt = normPt(String(r.pitch_type ?? ''));
      const pct = num(r.pct);
      const pitches = num(r.pitches);
      if (!Number.isFinite(y) || !pt || pct == null) continue;
      yearSet.add(y);
      const k = `${y}|${pt}`;
      byYearType.set(k, pct);
      // Volume ranking: do not treat missing `pitches` as 0 (distinct from "zero pitches").
      if (pitches != null) typePitches.set(pt, (typePitches.get(pt) ?? 0) + pitches);
    }
    const years = [...yearSet].sort((a, b) => a - b);
    const topTypes = [...typePitches.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_TYPES)
      .map(([pt]) => pt);
    const seriesByType = new Map<string, { x: number; yv: number }[]>();
    for (const pt of topTypes) {
      const pts: { x: number; yv: number }[] = [];
      for (const gy of years) {
        const pct = byYearType.get(`${gy}|${pt}`);
        if (pct != null) pts.push({ x: gy, yv: pct });
      }
      if (pts.length) seriesByType.set(pt, pts);
    }
    return { years, topTypes, seriesByType };
  }, [rows]);

  if (isPending) {
    return (
      <Typography variant="body2" color="text.secondary">
        Loading…
      </Typography>
    );
  }
  if (err) {
    return (
      <Typography variant="body2" color="error">
        {err}
      </Typography>
    );
  }
  if (years.length === 0 || topTypes.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No Statcast pitch-mix rows in this season range.
      </Typography>
    );
  }

  const yFirst = years[0];
  const yLast = years[years.length - 1];
  const minX = yFirst;
  const maxX = yLast;
  const W = 320;
  const H = 120;
  const padL = 36;
  const padR = 8;
  const padT = 10;
  const padB = 22;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const minY = 0;
  const maxY = 100;
  const sx = (gx: number) => padL + ((gx - minX) / (maxX - minX || 1)) * plotW;
  const sy = (gy: number) => padT + plotH - ((gy - minY) / (maxY - minY || 1)) * plotH;

  return (
    <Box className={styles.wrap}>
      <Typography variant="subtitle2" className={styles.title}>
        Pitch mix by season (usage %)
      </Typography>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        {[0, 25, 50, 75, 100].map((yv) => (
          <g key={yv}>
            <line
              x1={padL}
              x2={W - padR}
              y1={sy(yv)}
              y2={sy(yv)}
              stroke="#eeeeee"
              strokeDasharray="3 3"
              strokeWidth={0.75}
            />
            <text x={padL - 4} y={sy(yv)} textAnchor="end" dominantBaseline="middle" fontSize="8" fill="#757575">
              {yv}
            </text>
          </g>
        ))}
        {topTypes.map((pt) => {
          const pts = seriesByType.get(pt);
          if (!pts?.length) return null;
          const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${sx(p.x)} ${sy(p.yv)}`).join(' ');
          const stroke = pitchTypeMovementColor(pt);
          return (
            <g key={pt}>
              <path d={d} fill="none" stroke={stroke} strokeWidth={1.5} />
              {pts.map((p) => (
                <circle key={`${pt}-${p.x}`} cx={sx(p.x)} cy={sy(p.yv)} r={2.5} fill={stroke} />
              ))}
            </g>
          );
        })}
        <text x={padL + plotW / 2} y={H - 4} textAnchor="middle" fontSize="9" fill="#757575">
          Season
        </text>
        <text
          x={4}
          y={padT + plotH / 2}
          textAnchor="middle"
          fontSize="9"
          fill="#757575"
          transform={`rotate(-90 4 ${padT + plotH / 2})`}
        >
          Usage %
        </text>
      </svg>
      <Stack direction="row" spacing={1} flexWrap="wrap" className={styles.legend}>
        {topTypes.map((pt) => (
          <Typography key={pt} variant="caption" className={styles.legendItem}>
            <Box
              component="span"
              className={styles.legendSwatch}
              style={{ backgroundColor: pitchTypeMovementColor(pt) }}
            />
            {pitchTypeName(pt)}
          </Typography>
        ))}
      </Stack>
    </Box>
  );
}
