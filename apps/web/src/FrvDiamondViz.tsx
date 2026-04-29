import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useId } from 'react';

import { INFIELD_100, ssFieldPosition } from './infieldFieldGeometry.js';
import { InfieldPositionReferenceSvg } from './InfieldPositionReferenceSvg.js';
import { SPRAY_FIELD_VB as VB, sprayFieldImageHref } from './sprayFieldConstants.js';

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** Same 100×100 user space as {@link OaaDirectionalField} / spray charts. */
const HOME = { x: 50, y: 86 };

/** Bad range → smaller radius; good range → larger; ~0 runs → medium (linear in runs/8). */
function rangeRadius(rangeRuns: number): number {
  const u = clamp(rangeRuns / 8, -1.2, 1.2);
  const rMid = 7.5;
  const gain = 9.5;
  return clamp(rMid + u * gain, 3.4, 16.5);
}

function rangeFill(rangeRuns: number): string {
  const u = clamp(rangeRuns / 8, -1, 1);
  if (Math.abs(u) < 0.07) return 'hsla(0 0% 52% / 0.62)';
  if (u > 0) {
    const sat = 55 + u * 35;
    const light = 52 - u * 10;
    return `hsla(0 ${sat}% ${light}% / 0.72)`;
  }
  const sat = 50 + Math.abs(u) * 35;
  const light = 52 - Math.abs(u) * 8;
  return `hsla(220 ${sat}% ${light}% / 0.72)`;
}

const ARM_NEUTRAL_LEN = 9;

/** Positive runs: long red arrow. Negative: short blue stub (|runs| ≥ ~5 plateaus ~5). Zero: medium grey arrow. */
function armLength(armRuns: number): number {
  if (armRuns === 0) return ARM_NEUTRAL_LEN;
  const m = Math.abs(armRuns);
  if (armRuns > 0) return clamp(4 + m * 5.5, 4, 22);
  return clamp(2.4 + m * 0.42, 2.4, 5);
}

/** Darker than {@link rangeFill} so vectors stay visible on top of same-hue circles. */
function armStroke(armRuns: number): string {
  if (armRuns > 0) return 'hsl(0 86% 26%)';
  if (armRuns < 0) return 'hsl(222 92% 24%)';
  return 'hsl(220 6% 22%)';
}

export type FrvDiamondRole = 'OF_CF' | 'IF_SS' | 'IF_1B';

const LAYOUT: Record<
  FrvDiamondRole,
  {
    label: string;
    fx: number;
    fy: number;
    showArm: boolean;
    showDp: boolean;
    tx: number;
    ty: number;
    /** DP badge position (2B area). */
    dpX: number;
    dpY: number;
  }
> = {
  OF_CF: {
    label: 'CF — arm toward home (Dodger Stadium diagram)',
    fx: 50,
    fy: 28,
    showArm: true,
    showDp: false,
    tx: HOME.x,
    ty: HOME.y,
    dpX: 50,
    dpY: 48,
  },
  IF_SS: {
    label: 'SS — arm toward 1B',
    fx: ssFieldPosition.x,
    fy: ssFieldPosition.y,
    showArm: true,
    showDp: true,
    tx: INFIELD_100.firstBag.x,
    ty: INFIELD_100.firstBag.y,
    dpX: INFIELD_100.secondBag.x,
    dpY: INFIELD_100.secondBag.y + 4,
  },
  IF_1B: {
    label: '1B — range + DP',
    fx: INFIELD_100.firstBag.x,
    fy: INFIELD_100.firstBag.y,
    showArm: false,
    showDp: true,
    tx: HOME.x,
    ty: HOME.y,
    dpX: INFIELD_100.secondBag.x,
    dpY: INFIELD_100.secondBag.y + 4,
  },
};

function armEnd(
  fx: number,
  fy: number,
  tx: number,
  ty: number,
  armRuns: number
): { x2: number; y2: number } {
  const len = armLength(armRuns);
  const dx = tx - fx;
  const dy = ty - fy;
  const n = Math.hypot(dx, dy) || 1;
  return {
    x2: fx + (dx / n) * len,
    y2: fy + (dy / n) * len,
  };
}

/**
 * Exploratory **FRV** overlay on **`/spray/dodger-stadium-dimensions.png`** (100×100 viewBox, same as OAA field).
 * **Range** = fielder circle (small blue → big red through medium grey at ~0). **Arm** → home (OF) or 1B (IF): red long,
 * blue stub (short for bad arm), medium grey at 0.
 * **DP** badge near 2B when non-zero.
 */
export function FrvDiamondViz({
  role,
  rangeRuns,
  armRuns,
  dpRuns,
}: {
  role: FrvDiamondRole;
  rangeRuns: number;
  armRuns: number;
  dpRuns: number | null;
}) {
  const uid = useId().replace(/:/g, '');
  const L = LAYOUT[role];
  const r = rangeRadius(rangeRuns);
  const fill = rangeFill(rangeRuns);
  const arm = L.showArm ? armEnd(L.fx, L.fy, L.tx, L.ty, armRuns) : null;
  const strokeArm = L.showArm ? armStroke(armRuns) : 'transparent';
  const strokeW = (() => {
    if (armRuns === 0) return 0.82;
    if (armRuns < 0) return clamp(0.36 + Math.abs(armRuns) * 0.04, 0.34, 0.58);
    return clamp(0.55 + armRuns * 0.22, 0.45, 2.1);
  })();
  const showDpBadge = L.showDp && dpRuns != null && dpRuns !== 0;
  const dpFill = (dpRuns ?? 0) >= 0 ? 'hsla(0 65% 36% / 0.8)' : 'hsla(220 60% 38% / 0.8)';

  return (
    <Box sx={{ width: '100%', maxWidth: 320 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
        {L.label}
      </Typography>
      <Box
        sx={{
          width: '100%',
          aspectRatio: `${VB} / ${VB}`,
          maxHeight: 360,
          borderRadius: 1,
          border: 1,
          borderColor: 'divider',
          overflow: 'hidden',
          bgcolor: 'grey.900',
        }}
      >
        <svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${VB} ${VB}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={`FRV on stadium diagram, ${role}, range ${rangeRuns}, arm ${armRuns}`}
        >
          <image href={sprayFieldImageHref} x={0} y={0} width={VB} height={VB} preserveAspectRatio="xMidYMid meet" />
          {(role === 'IF_SS' || role === 'IF_1B') && <InfieldPositionReferenceSvg variant="frvIf" uid={uid} />}

          <circle
            cx={L.fx}
            cy={L.fy}
            r={r}
            fill={fill}
            stroke="rgba(0,0,0,0.45)"
            strokeWidth={0.4}
          />

          {arm != null && (
            <g>
              <defs>
                <marker id={`arr-${uid}`} markerWidth={4} markerHeight={4} refX={3.6} refY={2} orient="auto">
                  <path d="M0,0 L4,2 L0,4 z" fill={strokeArm} />
                </marker>
              </defs>
              <line
                x1={L.fx}
                y1={L.fy}
                x2={arm.x2}
                y2={arm.y2}
                stroke={strokeArm}
                strokeWidth={strokeW}
                strokeOpacity={armRuns === 0 ? 0.88 : 1}
                strokeLinecap="round"
                markerEnd={`url(#arr-${uid})`}
              />
            </g>
          )}

          {showDpBadge && (
            <g transform={`translate(${L.dpX}, ${L.dpY})`}>
              <rect x={-7.5} y={0} width={15} height={7.5} rx={1.25} fill={dpFill} />
              <text
                x={0}
                y={4}
                textAnchor="middle"
                dominantBaseline="central"
                fill="#fff"
                fontSize={4}
                fontWeight={700}
                stroke="rgba(0,0,0,0.22)"
                strokeWidth={0.12}
              >
                DP {dpRuns! > 0 ? '+' : ''}
                {dpRuns}
              </text>
            </g>
          )}

          <text x={3} y={97} fill="#fafafa" fontSize={5.5} stroke="#212121" strokeWidth={0.35} paintOrder="stroke">
            R {rangeRuns > 0 ? '+' : ''}
            {rangeRuns}
          </text>
          {L.showArm && (
            <text x={3} y={91} fill="#fafafa" fontSize={5.5} stroke="#212121" strokeWidth={0.35} paintOrder="stroke">
              Arm {armRuns > 0 ? '+' : ''}
              {armRuns}
            </text>
          )}
        </svg>
      </Box>
    </Box>
  );
}
