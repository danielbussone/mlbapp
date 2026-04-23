import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useId, useMemo } from 'react';

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
 * Horizontal axis uses **pitcher's perspective** (−pfx_x in feet, then ×12 → inches for plotting).
 */
export function MovementMiniPlot({ rows }: { rows: Array<Record<string, unknown>> }) {
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
      <Box sx={{ width: '100%', maxWidth: 720, mx: 'auto', py: 1 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
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
    <Box
      sx={{
        display: 'grid',
        width: '100%',
        maxWidth: 720,
        mx: 'auto',
        gridTemplateColumns: 'auto minmax(0, 1fr)',
        gridTemplateRows: 'auto auto auto',
        columnGap: 1,
        rowGap: 0.75,
      }}
    >
      <Typography variant="subtitle2" sx={{ gridColumn: '1 / -1', gridRow: 1, fontWeight: 600 }}>
        Pitch Movement
      </Typography>
      <Box
        sx={{
          gridColumn: 1,
          gridRow: 2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          alignSelf: 'stretch',
          minWidth: 0,
        }}
      >
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{
            writingMode: 'vertical-rl',
            transform: 'rotate(180deg)',
            lineHeight: 1.25,
            letterSpacing: 0.01,
          }}
        >
          Drop ← → Rise
        </Typography>
      </Box>
      <Box
        sx={{
          gridColumn: 2,
          gridRow: 2,
          width: '100%',
          minWidth: 0,
          aspectRatio: '1',
          minHeight: { xs: 280, sm: 340, md: 400 },
          maxHeight: { xs: 'min(92vw, 520px)', md: 580 },
        }}
      >
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
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ gridColumn: 2, gridRow: 3, textAlign: 'center', justifySelf: 'stretch' }}
      >
        1B ← → 3B
      </Typography>
    </Box>
  );
}
