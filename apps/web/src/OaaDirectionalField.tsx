import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useMemo } from 'react';

import {
  anchorCoords,
  formatOaaInMark,
  OAA_DIRECTIONAL_GRAD_EXTENT,
  oaaGradientFill,
  sliceDirectionForAnchor,
  sliceHumanLabel,
  wedgePath,
  type OutfieldAnchor,
} from './oaaDirectionalFieldGeometry.js';
import { thumbColorForGoodnessPercentile } from './percentileGoodnessColor.js';
import { SPRAY_FIELD_VB as VB, sprayFieldImageHref } from './sprayFieldConstants.js';

/** Outer radius of the six-slice pie (SVG user units, same scale as spray field). */
const PIE_R = 10.75;
/** Label sits along bisector at this fraction of radius. */
const LABEL_FRAC = 0.58;
const MARK_FONT = 2.05;
/** Center “dial” matches `LeaguePercentilesPanel` thumb size proportionally in SVG units. */
const CENTER_R = 4.35;
const CENTER_FONT = 2.15;

function finiteNum(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function sliceSuffix(cellId: string): string | null {
  const p = 'of_dir_';
  if (!cellId.startsWith(p)) return null;
  return cellId.slice(p.length);
}

export function OaaDirectionalField({
  cells,
  gameYear,
  anchor,
  anchorResolvedFromFg,
  totalOaa,
  oaaGoodnessDp,
}: {
  cells: Record<string, unknown>[];
  gameYear: number;
  anchor: OutfieldAnchor;
  /** False when FG had no LF/CF/RF split for this season — we defaulted to CF for layout. */
  anchorResolvedFromFg: boolean;
  /** Sum of `of_dir_*` slice OAA (Savant directional total). */
  totalOaa: number | null;
  /** Goodness-oriented 0–100 from `pos_oaa` league percentile (same basis as fielding slider thumb). */
  oaaGoodnessDp: number | null;
}) {
  const marks = useMemo(() => {
    const out: {
      key: string;
      pathD: string;
      labelX: number;
      labelY: number;
      fill: string;
      textFill: string;
      label: string;
      oaa: number | null;
      att: number | null;
    }[] = [];
    const { x: ax, y: ay } = anchorCoords(anchor);
    for (const c of cells) {
      const id = String(c.cell_id ?? '');
      const suf = sliceSuffix(id);
      if (!suf) continue;
      const dir = sliceDirectionForAnchor(anchor, suf);
      if (!dir) continue;
      const oaaN = finiteNum(c.oaa);
      const attN = finiteNum(c.attempts);
      const thetaMid = Math.atan2(dir.y, dir.x);
      const { fill, textFill } = oaaGradientFill(oaaN);
      const labelR = PIE_R * LABEL_FRAC;
      out.push({
        key: id,
        pathD: wedgePath(ax, ay, PIE_R, thetaMid),
        labelX: ax + Math.cos(thetaMid) * labelR,
        labelY: ay + Math.sin(thetaMid) * labelR,
        fill,
        textFill,
        label: sliceHumanLabel(suf),
        oaa: oaaN,
        att: attN,
      });
    }
    return out;
  }, [cells, anchor]);

  const { x: ax, y: ay } = anchorCoords(anchor);
  const centerFill = thumbColorForGoodnessPercentile(oaaGoodnessDp ?? 50);

  return (
    <Box sx={{ width: '100%', maxWidth: 560 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
        Directional OAA (Savant six slices), anchored at <strong>{anchor}</strong>
        {!anchorResolvedFromFg ? ' (no LF/CF/RF innings split for this season — default CF)' : ''} · {gameYear}
      </Typography>
      <Box
        sx={{
          width: '100%',
          aspectRatio: `${VB} / ${VB}`,
          maxHeight: 560,
          mx: 'auto',
          borderRadius: 1,
          overflow: 'hidden',
          border: 1,
          borderColor: 'divider',
          bgcolor: 'transparent',
        }}
      >
        <svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${VB} ${VB}`}
          style={{ display: 'block' }}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={`Directional OAA pie, ${gameYear}, anchor ${anchor}`}
        >
          <image href={sprayFieldImageHref} x={0} y={0} width={VB} height={VB} preserveAspectRatio="xMidYMid meet" />
          {marks.map((m) => (
            <path
              key={`p-${m.key}`}
              d={m.pathD}
              fill={m.fill}
              stroke="rgba(0,0,0,0.35)"
              strokeWidth={0.14}
              strokeLinejoin="round"
              opacity={0.96}
            >
              <title>
                {m.label}: OAA {m.oaa == null ? '—' : m.oaa}
                {m.att != null ? `, att ${m.att}` : ''}
              </title>
            </path>
          ))}
          <circle
            cx={ax}
            cy={ay}
            r={CENTER_R}
            fill={centerFill}
            stroke="rgb(220, 220, 220)"
            strokeWidth={0.38}
            opacity={0.98}
          >
            <title>
              Total directional OAA (sum of slices): {totalOaa == null ? '—' : formatOaaInMark(totalOaa)}
              {oaaGoodnessDp != null
                ? `. League pos OAA percentile (goodness scale): ${Math.round(oaaGoodnessDp)}`
                : '. League OAA percentile unavailable — color at 50th (grey).'}
            </title>
          </circle>
          {marks.map((m) => (
            <text
              key={`t-${m.key}`}
              x={m.labelX}
              y={m.labelY}
              fontSize={MARK_FONT}
              fontWeight={700}
              fontFamily="system-ui, -apple-system, Segoe UI, sans-serif"
              fill={m.textFill}
              stroke="rgba(0,0,0,0.22)"
              strokeWidth={0.12}
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
            x={ax}
            y={ay}
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
        </svg>
      </Box>
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mt: 0.75, flexWrap: 'wrap' }}>
        <Typography variant="caption" color="text.secondary">
          {`Slice color: deep blue at −${OAA_DIRECTIONAL_GRAD_EXTENT} OAA → grey at 0 → deep red at +${OAA_DIRECTIONAL_GRAD_EXTENT} (clamped beyond ±${OAA_DIRECTIONAL_GRAD_EXTENT}). Center: sum of slice OAA; fill matches the league OAA percentile dial (blue → grey → red) when that percentile loads, otherwise 50th-grey.`}
        </Typography>
      </Stack>
    </Box>
  );
}
