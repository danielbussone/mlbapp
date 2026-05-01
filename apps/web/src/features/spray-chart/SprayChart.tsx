import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useMemo } from 'react';

import {
  SPRAY_FIELD_VB as VB,
  SPRAY_FIELD_VIEW_HEIGHT as VB_HEIGHT,
  SPRAY_FIELD_Y_MIN as VB_Y_MIN,
  sprayFieldImageHref as fieldImg,
} from './sprayFieldConstants.js';
import styles from './SprayChart.module.css';

type HitKind = 'single' | 'double' | 'triple' | 'home_run' | 'other';

const HIT_COLORS: Record<HitKind, string> = {
  single: '#ff8f00',
  double: '#7b1fa2',
  triple: '#00acc1',
  home_run: '#e91e63',
  other: '#78909c',
};

function classifyHit(events: string): HitKind {
  const e = events.trim().toLowerCase();
  if (e.includes('home_run') || e === 'home run') return 'home_run';
  if (e.includes('triple')) return 'triple';
  if (e.includes('double')) return 'double';
  if (e.includes('single')) return 'single';
  return 'other';
}

export type SprayRow = Record<string, unknown>;

/**
 * Statcast in-park hit coordinates (feet).
 * `hc_x`: horizontal in the Savant plane (smaller ≈ LF side in catcher view).
 * `hc_y`: **decreases** toward CF — farther from home (e.g. ~400′ toward the wall) is **smaller**
 * `hc_y` (see spray-angle use of `(198.27 - hc_y)` in pybaseball). We map that so smaller `hc_y`
 * lands toward the top of the diagram (CF).
 * @see https://baseballsavant.mlb.com/csv-docs
 */
/** Savant `hc_x` / `hc_y` clamp band tuned to match the Dodger overlay (tweak as you validate samples). */
const HC_X_MIN = 0;
const HC_X_MAX = 252;
/** Smaller `hc_y` ≈ deeper toward CF in Savant’s diagram. */
const HC_Y_MIN = 0;
const HC_Y_MAX = 230;

/** Horizontal inset keeps dots off foul lines; bottom inset keeps dots off plate. `T` sits in headroom above y=0. */
const M = 3;
const PLOT = { L: M, R: VB - M, T: VB_Y_MIN + 1, B: VB - M * 1.2 };

/** 1 = linear depth. Below 1 nudges mid/deep balls slightly up within [PLOT.T, PLOT.B]. */
const Y_DEPTH_GAMMA = 1;

/**
 * Depth-gated **fan** on X: linear `hc_x`/`hc_y` maps a rectangle, but the diamond widens with distance from
 * home, so deep pulls can look pinched vs Savant. We scale horizontal offset from the plot centerline by a
 * factor that ramps from 1 (shallow) toward `1 + SPRAY_FAN_MAX_EXTRA` (deepest).
 *
 * Tune (Savant-aligned defaults below):
 * - **`SPRAY_FAN_MAX_EXTRA`**: lateral spread at max depth = `1 + this` vs centerline (try ~0.1–0.8).
 * - **`SPRAY_FAN_TNY_START`**: depth (0–1) where fan starts; lower → sooner fan (try ~0.08–0.35).
 * - **`SPRAY_FAN_POWER`**: >1 concentrates extra spread in the deepest band; 1 = linear ramp in depth.
 */
const SPRAY_FAN_MAX_EXTRA = 1;
const SPRAY_FAN_TNY_START = 0.2;
const SPRAY_FAN_POWER = 1.7;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function projectStatcastToSvg(hcX: number, hcY: number): { px: number; py: number } {
  const x = clamp(hcX, HC_X_MIN, HC_X_MAX);
  const y = clamp(hcY, HC_Y_MIN, HC_Y_MAX);
  const tnx = (x - HC_X_MIN) / (HC_X_MAX - HC_X_MIN || 1);
  const ySpan = HC_Y_MAX - HC_Y_MIN || 1;
  /** Smaller `hc_y` = farther from home toward CF → larger t → toward top of SVG. */
  const tny = (HC_Y_MAX - y) / ySpan;
  const tnyPlot = Y_DEPTH_GAMMA >= 0.999 ? tny : Math.pow(tny, Y_DEPTH_GAMMA);
  const pxLin = PLOT.L + tnx * (PLOT.R - PLOT.L);
  const plotCx = (PLOT.L + PLOT.R) / 2;
  let fan = 1;
  if (SPRAY_FAN_MAX_EXTRA > 0 && SPRAY_FAN_TNY_START < 0.999) {
    const ramp = clamp((tnyPlot - SPRAY_FAN_TNY_START) / (1 - SPRAY_FAN_TNY_START), 0, 1);
    fan = 1 + SPRAY_FAN_MAX_EXTRA * Math.pow(ramp, SPRAY_FAN_POWER);
  }
  const px = plotCx + (pxLin - plotCx) * fan;
  const py = PLOT.B - tnyPlot * (PLOT.B - PLOT.T);
  return { px, py };
}

/**
 * Batter spray chart: Statcast `hc_x` / `hc_y` (feet) on Dodger Stadium dimensions diagram.
 * Catcher view — LF toward smaller `hc_x`.
 */
export function SprayChart({ rows, gameYear }: { rows: SprayRow[]; gameYear: number }) {
  const pts = useMemo(() => {
    const out: { px: number; py: number; kind: HitKind }[] = [];
    for (const r of rows) {
      const hcX = Number(r.hc_x);
      const hcY = Number(r.hc_y);
      if (!Number.isFinite(hcX) || !Number.isFinite(hcY)) continue;
      const ev = String(r.events ?? '');
      const kind = classifyHit(ev);
      if (kind === 'other') continue;
      const { px, py } = projectStatcastToSvg(hcX, hcY);
      out.push({ px, py, kind });
    }
    return out;
  }, [rows]);

  if (pts.length === 0) {
    return (
      <Box>
        <Typography variant="body2" color="text.secondary" className={styles.emptyLead}>
          No chartable batted balls (need <code>hc_x</code> / <code>hc_y</code> plus a single/double/triple/home run
          event). Re-run Statcast ETL so Savant fields are in <code>payload_jsonb</code>.
        </Typography>
      </Box>
    );
  }

  return (
    <Box className={styles.wrap560}>
      <Typography variant="subtitle2" className={styles.title}>
        Hits Spray Chart
      </Typography>
      <Box className={styles.svgField} style={{ aspectRatio: `${VB} / ${VB_HEIGHT}` }}>
        <svg
          width="100%"
          height="100%"
          viewBox={`0 ${VB_Y_MIN} ${VB} ${VB_HEIGHT}`}
          style={{ display: 'block' }}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={`Hits spray chart, ${gameYear}`}
        >
          <image
            href={fieldImg}
            x={0}
            y={0}
            width={VB}
            height={VB}
            preserveAspectRatio="xMidYMid meet"
          />
          {pts.map((p, i) => (
            <circle
              key={i}
              cx={p.px}
              cy={p.py}
              r={1.35}
              fill={HIT_COLORS[p.kind]}
              opacity={0.9}
              stroke="#212121"
              strokeWidth={0.12}
            />
          ))}
        </svg>
      </Box>
      <Stack direction="row" flexWrap="wrap" gap={1.25} className={styles.legendRow} alignItems="center">
        {(
          [
            ['single', 'Single'],
            ['double', 'Double'],
            ['triple', 'Triple'],
            ['home_run', 'HR'],
          ] as const
        ).map(([k, label]) => (
          <Stack key={k} direction="row" alignItems="center" spacing={0.5}>
            <Box className={styles.legendDot} style={{ backgroundColor: HIT_COLORS[k] }} />
            <Typography variant="caption" color="text.secondary">
              {label}
            </Typography>
          </Stack>
        ))}
      </Stack>
    </Box>
  );
}
