import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useMemo } from 'react';
import { pitchTypeMovementColor } from './MovementMiniPlot.js';
import { aggregateVeloBins } from '@/features/pitch-mix/pitchVeloBins.js';
import styles from './VeloHistogram.module.css';

type BinRow = { pitch_type: string; mph_floor: number; bin_count: number };

/**
 * Stacked horizontal bars: one row per pitch type, mph on x, density from binned counts.
 * `embedded`: tighter spacing when shown beside the pitch-mix table.
 */
export function VeloHistogram({
  rows,
  embedded = false,
}: {
  rows: BinRow[] | Record<string, unknown>[];
  embedded?: boolean;
}) {
  const { byType, mphMin, mphMax, maxCount } = useMemo(
    () => aggregateVeloBins(rows as Record<string, unknown>[]),
    [rows]
  );

  const types = useMemo(() => [...byType.keys()].sort(), [byType]);

  const mphTicks = useMemo(() => {
    const range = mphMax - mphMin;
    if (range <= 0) return [] as number[];
    const step = range > 28 ? 5 : range > 16 ? 2 : 1;
    const ticks: number[] = [];
    const start = Math.ceil(mphMin / step) * step;
    for (let m = start; m < mphMax; m += step) ticks.push(m);
    if (ticks.length === 0) ticks.push(Math.round((mphMin + mphMax) / 2));
    return ticks;
  }, [mphMin, mphMax]);

  if (types.length === 0) {
    return (
      <Box className={styles.sectionPad}>
        <Typography variant="subtitle2" className={styles.title}>
          Pitch velocity distribution
        </Typography>
        <Typography variant="body2" color="text.secondary">
          No binned velocity data (run Statcast ingest for this season).
        </Typography>
      </Box>
    );
  }

  const rowH = 36;
  const w = 320;
  const axisH = 26;
  const chartTop = 18;
  const axisY = chartTop + types.length * rowH + 6;
  const svgH = axisY + axisH;

  return (
    <Box
      className={`${styles.root} ${embedded ? styles.rootEmbedded : styles.rootStandalone}`}
    >
      <Typography
        variant="subtitle2"
        className={embedded ? styles.titleEmbedded : styles.titleStandalone}
      >
        Pitch velocity distribution
      </Typography>
      <Typography
        variant="caption"
        color="text.secondary"
        className={`${styles.subLead} ${embedded ? styles.subLeadEmbedded : styles.subLeadStandalone}`}
      >
        Mph (1 mph bins). Bar height ∝ count within pitch type.
      </Typography>
      <svg width="100%" height={svgH} viewBox={`0 0 ${w + 40} ${svgH}`}>
        <text x={0} y={12} fontSize={9} fill="#666">
          mph →
        </text>
        {types.map((pt, ti) => {
          const y0 = chartTop + ti * rowH;
          const bins = byType.get(pt) ?? [];
          return (
            <g key={pt}>
              <text x={0} y={y0 + rowH / 2 + 3} fontSize={10} fill="#333" fontWeight={600}>
                {pt}
              </text>
              <g transform={`translate(36, ${y0})`}>
                <line x1={0} y1={rowH - 4} x2={w} y2={rowH - 4} stroke="#e0e0e0" strokeWidth={0.5} />
                {bins.map(({ mph, c }) => {
                  const x0 = ((mph - mphMin) / (mphMax - mphMin || 1)) * w;
                  const bw = Math.max(0.8, w / (mphMax - mphMin || 1) - 0.2);
                  const h = (c / maxCount) * (rowH - 10);
                  return (
                    <rect
                      key={mph}
                      x={x0}
                      y={rowH - 4 - h}
                      width={bw}
                      height={h}
                      fill={pitchTypeMovementColor(pt)}
                      opacity={0.85}
                    />
                  );
                })}
              </g>
            </g>
          );
        })}
        <g transform={`translate(36, 0)`}>
          <line x1={0} y1={axisY} x2={w} y2={axisY} stroke="#9e9e9e" strokeWidth={0.75} />
          {mphTicks.map((mph) => {
            const x = ((mph - mphMin) / (mphMax - mphMin || 1)) * w;
            return (
              <g key={`tick-${mph}`}>
                <line x1={x} y1={axisY} x2={x} y2={axisY + 5} stroke="#616161" strokeWidth={0.6} />
                <text x={x} y={axisY + 16} fontSize={9} fill="#424242" textAnchor="middle">
                  {mph}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </Box>
  );
}
