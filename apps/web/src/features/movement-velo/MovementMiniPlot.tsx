import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useId, useMemo } from 'react';
import styles from './MovementMiniPlot.module.css';

type Point = { x: number; y: number; pitchType: string };

const TYPE_COLORS: Record<string, string> = {
  FF: '#c62828',
  SI: '#1565c0',
  FC: '#6a1b9a',
  SL: '#ef6c00',
  CH: '#2e7d32',
  CU: '#00838f',
  KC: '#00695c',
  FS: '#5d4037',
  KN: '#455a64',
  EP: '#78909c',
  FO: '#ad1457',
  PO: '#37474f',
  SC: '#827717',
  CS: '#4e342e',
  FA: '#b71c1c',
  ST: '#283593',
  SV: '#1b5e20',
  default: '#546e7a',
};

function colorForType(t: string): string {
  const k = t.trim().toUpperCase();
  return TYPE_COLORS[k] ?? TYPE_COLORS.default;
}

/** Same hex as movement scatter dots — use in pitch-mix tables, etc. */
export function pitchTypeMovementColor(t: string): string {
  return colorForType(t);
}

/**
 * Savant-style movement window: symmetric square [−N, N] on each axis (inches).
 * Polar “outer ring” on Savant is ~24" from the origin — match that here.
 */
export const MOVEMENT_AXIS_HALF_IN = 24;

/** Reference rings from the origin (inches), Savant-style. */
const MOVEMENT_RING_IN = [6, 12, 18, 24] as const;

/** Statcast Search CSV: `pfx_x` / `pfx_z` are in feet (catcher perspective). */
const PFX_FT_TO_IN = 12;

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Induced movement from Savant `pfx_x` / `pfx_z` (stored as **feet** in `statcast_pitch`).
 * Horizontal axis: **−pfx_x** (inches) for pitcher-perspective charts; league averages should use the
 * same handedness cohort (`statcastLeagueMovementByYear(..., 'L'|'R')`) so hollow markers line up with dots.
 */
export type LeagueMovementRow = {
  pitch_type: string;
  avg_pfx_x_ft: number;
  avg_pfx_z_ft: number;
};

export type ArmAngleOverlay = {
  /** Mean direction in x–z release plane (degrees); used for overlay line only. */
  meanDeg: number;
  /** Approximate spread (degrees) for wedge. */
  stdDeg: number;
};

export function MovementMiniPlot({
  rows,
  leagueMovement,
  armAngle,
}: {
  rows: Array<Record<string, unknown>>;
  /** League-average pfx per pitch type (feet); draws open circles behind pitch dots. */
  leagueMovement?: LeagueMovementRow[] | null;
  /** Optional arm-slot direction overlay from release_pos_x/z sample. */
  armAngle?: ArmAngleOverlay | null;
}) {
  const clipUid = useId().replace(/:/g, '');
  const pts = useMemo(() => {
    const out: Point[] = [];
    for (const r of rows) {
      const rawXFt = num(r.pfx_x);
      const rawZFt = num(r.pfx_z);
      if (rawXFt == null || rawZFt == null) continue;
      const x = -rawXFt * PFX_FT_TO_IN;
      const y = rawZFt * PFX_FT_TO_IN;
      out.push({ x, y, pitchType: String(r.pitch_type ?? '') });
    }
    return out;
  }, [rows]);

  const leaguePts = useMemo(() => {
    if (!leagueMovement?.length) return [] as { x: number; y: number; pitchType: string }[];
    return leagueMovement.map((lm) => {
      const x = -Number(lm.avg_pfx_x_ft) * PFX_FT_TO_IN;
      const y = Number(lm.avg_pfx_z_ft) * PFX_FT_TO_IN;
      return { x, y, pitchType: String(lm.pitch_type ?? '') };
    });
  }, [leagueMovement]);

  const armWedge = useMemo(() => {
    if (armAngle == null || !Number.isFinite(armAngle.meanDeg)) return null;
    const L = 16;
    const m = (armAngle.meanDeg * Math.PI) / 180;
    const spread = ((armAngle.stdDeg && armAngle.stdDeg > 0 ? armAngle.stdDeg : 6) * Math.PI) / 180;
    const x1 = Math.cos(m - spread) * L;
    const y1 = Math.sin(m - spread) * L;
    const x2 = Math.cos(m + spread) * L;
    const y2 = Math.sin(m + spread) * L;
    return { x1, y1, x2, y2, xm: Math.cos(m) * L, ym: Math.sin(m) * L };
  }, [armAngle]);

  const bounds = useMemo(
    () => ({
      minX: -MOVEMENT_AXIS_HALF_IN,
      maxX: MOVEMENT_AXIS_HALF_IN,
      minY: -MOVEMENT_AXIS_HALF_IN,
      maxY: MOVEMENT_AXIS_HALF_IN,
    }),
    [],
  );

  if (pts.length === 0) {
    return (
      <Box className={styles.emptyWrap}>
        <Typography variant="subtitle2" className={styles.emptyTitle}>
          Pitch Movement
        </Typography>
        <Typography variant="body2" color="text.secondary">
          No pitches with measured movement in this sample.
        </Typography>
      </Box>
    );
  }

  const { minX, maxX, minY, maxY } = bounds;
  const w = maxX - minX || 1;
  const h = maxY - minY || 1;
  const vb = 100;
  const toSvgX = (x: number) => ((x - minX) / w) * vb;
  const toSvgY = (y: number) => vb - ((y - minY) / h) * vb;
  const cx0 = toSvgX(0);
  const cy0 = toSvgY(0);
  const ringR = (rin: number) => (rin / (2 * MOVEMENT_AXIS_HALF_IN)) * vb;

  return (
    <Box className={styles.movementRoot}>
      <Typography variant="subtitle2" className={styles.gridTitle}>
        Pitch Movement
      </Typography>
      <Box className={styles.yAxis}>
        <Typography variant="caption" color="text.secondary" className={styles.yAxisCaption}>
          Drop ← → Rise
        </Typography>
      </Box>
      <Box className={styles.plotCell}>
        <svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${vb} ${vb}`}
          style={{ display: 'block' }}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="Pitch movement (induced break), pitcher view"
        >
          <defs>
            <clipPath id={clipUid}>
              <rect x={0} y={0} width={vb} height={vb} />
            </clipPath>
            <pattern id={`${clipUid}-hash`} patternUnits="userSpaceOnUse" width={3} height={3}>
              <path d="M0,3 L3,0 M-1,1 L2,-2" stroke="#757575" strokeWidth={0.35} />
            </pattern>
          </defs>
          <rect x={0} y={0} width={vb} height={vb} fill="#fafafa" stroke="#e0e0e0" />
          <g clipPath={`url(#${clipUid})`}>
            {MOVEMENT_RING_IN.map((rin) => {
              const r = ringR(rin);
              const isOuter = rin === MOVEMENT_AXIS_HALF_IN;
              return (
                <circle
                  key={rin}
                  cx={cx0}
                  cy={cy0}
                  r={r}
                  fill="none"
                  stroke="#bdbdbd"
                  strokeWidth={isOuter ? 0.45 : 0.28}
                  strokeDasharray={isOuter ? undefined : '1.6 1.4'}
                  opacity={isOuter ? 1 : 0.85}
                />
              );
            })}
            <line
              x1={toSvgX(0)}
              y1={0}
              x2={toSvgX(0)}
              y2={vb}
              stroke="#9e9e9e"
              strokeWidth={0.35}
              strokeDasharray="2 1.5"
              opacity={0.95}
            />
            <line
              x1={0}
              y1={toSvgY(0)}
              x2={vb}
              y2={toSvgY(0)}
              stroke="#9e9e9e"
              strokeWidth={0.35}
              strokeDasharray="2 1.5"
              opacity={0.95}
            />
            {armWedge && (
              <path
                d={`M ${cx0} ${cy0} L ${toSvgX(armWedge.x1)} ${toSvgY(armWedge.y1)} L ${toSvgX(armWedge.x2)} ${toSvgY(armWedge.y2)} Z`}
                fill="rgba(66, 66, 66, 0.12)"
                stroke="#424242"
                strokeWidth={0.35}
              />
            )}
            {armWedge && (
              <line
                x1={cx0}
                y1={cy0}
                x2={toSvgX(armWedge.xm)}
                y2={toSvgY(armWedge.ym)}
                stroke="#212121"
                strokeWidth={0.55}
              />
            )}
            {leaguePts.map((p, i) => (
              <circle
                key={`lg-${i}`}
                cx={toSvgX(p.x)}
                cy={toSvgY(p.y)}
                r={2.1}
                fill={`url(#${clipUid}-hash)`}
                stroke={colorForType(p.pitchType)}
                strokeWidth={0.4}
                opacity={0.95}
              />
            ))}
            {pts.map((p, i) => (
              <circle
                key={i}
                cx={toSvgX(p.x)}
                cy={toSvgY(p.y)}
                r={1.15}
                fill={colorForType(p.pitchType)}
                opacity={0.88}
              />
            ))}
          </g>
        </svg>
      </Box>
      <Typography variant="caption" color="text.secondary" className={styles.xAxisCaption}>
        1B ← → 3B
      </Typography>
    </Box>
  );
}
