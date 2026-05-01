import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useMemo } from 'react';

import { IF_OAA_LABEL } from './oaaBreakdownMockData.js';
import {
  IF_OAA_MINI_PIE_ANCHORS,
  INFIELD_DIAMOND_SCALE,
  type IfMiniPieAnchorId,
  ifMiniPieAnchorFromFg,
} from './infieldFieldGeometry.js';
import {
  OAA_DIRECTIONAL_GRAD_EXTENT,
  formatOaaInMark,
  oaaGradientFill,
  wedgePath,
} from './oaaDirectionalFieldGeometry.js';
import { thumbColorForGoodnessPercentile } from '@/features/league-percentiles/percentileGoodnessColor.js';
import { SPRAY_FIELD_VB as VB, sprayFieldImageHref } from '@/features/spray-chart/sprayFieldConstants.js';
import fieldDiagram from './oaaFieldDiagram.module.css';

/** Mini pies at each anchor — sized for legibility vs overlap at SS / 2B (~¾ of full OF pie). */
const PIE_R = 7.25;
const LABEL_FRAC = 0.56;
const MARK_FONT = 1.65;
const CENTER_R = 3.05;
const CENTER_FONT = 1.65;

const IF_DIR_KEYS = ['if_dir_in', 'if_dir_toward_1b', 'if_dir_toward_3b', 'if_dir_behind'] as const;

/**
 * Wedge bisectors at exact 90° steps so four π/2 wedges tile a full circle with no gaps or overlaps
 * (SVG y-down: +y toward home, +x toward 1B, −y toward OF “behind”, −x toward 3B).
 */
function ifDirTheta(cellId: string): number | null {
  switch (cellId) {
    case 'if_dir_in':
      return Math.PI / 2;
    case 'if_dir_toward_1b':
      return 0;
    case 'if_dir_toward_3b':
      return Math.PI;
    case 'if_dir_behind':
      return -Math.PI / 2;
    default:
      return null;
  }
}

const HALF_QUAD = Math.PI / 4;

function finiteNum(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function cellRowToMap(
  cells: Record<string, unknown>[],
): Map<string, { oaa: number | null; att: number | null }> {
  const m = new Map<string, { oaa: number | null; att: number | null }>();
  for (const c of cells) {
    const id = String(c.cell_id ?? '');
    if (!id) continue;
    m.set(id, { oaa: finiteNum(c.oaa), att: finiteNum(c.attempts) });
  }
  return m;
}

function sumIfDirOaa(cells: Record<string, unknown>[]): number | null {
  let sum = 0;
  let any = false;
  for (const id of IF_DIR_KEYS) {
    const row = cells.find((c) => String(c.cell_id ?? '') === id);
    if (row == null) continue;
    const o = finiteNum(row.oaa);
    if (o == null) continue;
    sum += o;
    any = true;
  }
  return any ? sum : null;
}

type DirMark = {
  key: string;
  pathD: string;
  labelX: number;
  labelY: number;
  fill: string;
  textFill: string;
  label: string;
  oaa: number | null;
  att: number | null;
};

function buildDirMarks(
  byId: Map<string, { oaa: number | null; att: number | null }>,
  cx: number,
  cy: number,
): DirMark[] {
  const out: DirMark[] = [];
  for (const key of IF_DIR_KEYS) {
    const thetaMid = ifDirTheta(key);
    if (thetaMid == null) continue;
    const data = byId.get(key);
    const oaaN = data?.oaa ?? null;
    const attN = data?.att ?? null;
    const { fill, textFill } = oaaGradientFill(oaaN);
    const labelR = PIE_R * LABEL_FRAC;
    out.push({
      key,
      pathD: wedgePath(cx, cy, PIE_R, thetaMid, HALF_QUAD),
      labelX: cx + Math.cos(thetaMid) * labelR,
      labelY: cy + Math.sin(thetaMid) * labelR,
      fill,
      textFill,
      label: IF_OAA_LABEL[key] ?? key,
      oaa: oaaN,
      att: attN,
    });
  }
  return out;
}

/**
 * Infield directional OAA: four **if_dir_*** wedges at the player's **primary** IF spot (FG innings among 1B–SS).
 */
export function OaaIfDirectionalField({
  cells,
  gameYear,
  oaaGoodnessDp,
  primaryPosNote,
  /** Which base / hole to draw the mini-pie on — match FanGraphs primary IF for this season. */
  primaryAnchorId,
}: {
  cells: Record<string, unknown>[];
  gameYear: number;
  /** League OAA percentile (goodness scale) for center dial fill — same basis as outfield viz. */
  oaaGoodnessDp?: number | null;
  /** Shown under diagram — explains which IF spot drives percentile when FG splits exist. */
  primaryPosNote?: string;
  primaryAnchorId?: IfMiniPieAnchorId;
}) {
  const byId = useMemo(() => cellRowToMap(cells), [cells]);
  const totalOaa = useMemo(() => sumIfDirOaa(cells), [cells]);
  const centerFill = thumbColorForGoodnessPercentile(oaaGoodnessDp ?? 50);

  const anchors = useMemo(() => {
    const id = primaryAnchorId ?? ifMiniPieAnchorFromFg(null);
    const hit = IF_OAA_MINI_PIE_ANCHORS.filter((a) => a.id === id);
    return hit.length > 0 ? hit : IF_OAA_MINI_PIE_ANCHORS.filter((a) => a.id === 'ss');
  }, [primaryAnchorId]);

  return (
    <Box className={fieldDiagram.wrap560}>
      <Typography variant="caption" color="text.secondary" className={fieldDiagram.caption}>
        Directional OAA (Savant infield buckets) · primary spot <strong>{anchors[0]?.label ?? 'IF'}</strong> (FanGraphs
        innings) · {gameYear}
      </Typography>
      <Box
        className={`${fieldDiagram.svgField} ${fieldDiagram.svgFieldIf}`}
        style={{ aspectRatio: `${VB} / ${VB}` }}
      >
        <svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${VB} ${VB}`}
          style={{ display: 'block' }}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={`Infield directional OAA at ${anchors[0]?.label ?? 'primary'}, ${gameYear}`}
        >
          <image href={sprayFieldImageHref} x={0} y={0} width={VB} height={VB} preserveAspectRatio="xMidYMid meet" />

          {anchors.map((anchor) => {
            const dirMarks = buildDirMarks(byId, anchor.cx, anchor.cy);
            return (
              <g key={anchor.id} aria-label={`OAA pie at ${anchor.label}`}>
                {dirMarks.map((m) => (
                  <path
                    key={`p-${anchor.id}-${m.key}`}
                    d={m.pathD}
                    fill={m.fill}
                    stroke="none"
                    opacity={1}
                  >
                    <title>
                      {anchor.label} · {m.label}: OAA {m.oaa == null ? '—' : m.oaa}
                      {m.att != null ? `, att ${m.att}` : ''}
                    </title>
                  </path>
                ))}
                <circle
                  cx={anchor.cx}
                  cy={anchor.cy}
                  r={CENTER_R}
                  fill={centerFill}
                  stroke="rgb(220, 220, 220)"
                  strokeWidth={0.38}
                  opacity={0.98}
                >
                  <title>
                    {anchor.label} · total (sum of directional slices):{' '}
                    {totalOaa == null ? '—' : formatOaaInMark(totalOaa)}
                    {oaaGoodnessDp != null
                      ? `. League pos OAA percentile (goodness scale): ${Math.round(oaaGoodnessDp)}`
                      : '. League OAA percentile unavailable — dial at 50th (grey).'}
                  </title>
                </circle>
                {dirMarks.map((m) => (
                  <text
                    key={`t-${anchor.id}-${m.key}`}
                    x={m.labelX}
                    y={m.labelY}
                    fontSize={MARK_FONT}
                    fontWeight={700}
                    fontFamily="system-ui, -apple-system, Segoe UI, sans-serif"
                    fill={m.textFill}
                    stroke="rgba(0,0,0,0.2)"
                    strokeWidth={0.09}
                    paintOrder="stroke fill"
                    textAnchor="middle"
                    dominantBaseline="central"
                    pointerEvents="none"
                    style={{ userSelect: 'none' }}
                  >
                    {m.oaa == null ? '—' : formatOaaInMark(m.oaa)}
                  </text>
                ))}
                <text
                  x={anchor.cx}
                  y={anchor.cy}
                  fontSize={CENTER_FONT}
                  fontWeight={700}
                  fontFamily="system-ui, -apple-system, Segoe UI, sans-serif"
                  fill="#fff"
                  textAnchor="middle"
                  dominantBaseline="central"
                  pointerEvents="none"
                  style={{
                    userSelect: 'none',
                    textShadow: '0 0 2px rgba(0,0,0,0.35)',
                  }}
                >
                  {totalOaa == null ? '—' : formatOaaInMark(totalOaa)}
                </text>
              </g>
            );
          })}
        </svg>
      </Box>
      <Typography variant="caption" color="text.secondary" className={fieldDiagram.footerNote}>
        {`Wedge fill: same ramp as outfield (±${OAA_DIRECTIONAL_GRAD_EXTENT} OAA). Center = sum of the four directional slices (Savant infield leaderboard row). `}
        <strong>INFIELD_DIAMOND_SCALE</strong> <code>{INFIELD_DIAMOND_SCALE}</code> aligns bases to the chalk
        diamond on the PNG.
        {primaryPosNote ? ` ${primaryPosNote}` : ''}
      </Typography>
    </Box>
  );
}
