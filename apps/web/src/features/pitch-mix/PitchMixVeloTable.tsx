import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableFooter from '@mui/material/TableFooter';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import { type ReactNode, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { pitchTypeMovementColor } from '@/features/movement-velo/MovementMiniPlot.js';
import { pitchTypeName } from './pitchTypeLabels.js';
import { aggregateVeloBins } from './pitchVeloBins.js';
import {
  handednessRowsForMixOrder,
  handednessSideBarPx,
  handednessUsageBarRadiusPx,
} from './pitchMixHandednessModel.js';
import type { HandednessRow } from './pitchMixHandednessModel.js';
import veloStyles from './PitchMixVeloTable.module.css';

const ROW_H = 30;
/** Taller mini-histogram in pitch-mix combo rows (more bar area + bottom-aligned in cell). */
const COMBO_VELO_ROW_SVG_H = 40;
/** Logical chart width (viewBox); row SVG scales to fill the histogram column. */
export const PITCH_VELO_CHART_W = 360;

/**
 * Below this **container** width (player card column, not viewport), combo mix + velo stacks vertically;
 * default table stacks pitch row meta above histograms.
 */
export const PITCH_MIX_STACK_BREAKPOINT_PX = 500;

/** Fixed body row height (both tables) — handedness content is taller than velo SVG+padding alone, so min-height on cells was not enough. */
const COMBO_BODY_ROW_PX = 52;
/** Keep thead rows the same visual height on both sides. */
const COMBO_HEAD_ROW_MIN_PX = 36;

/** Max L/R bar track (px); actual track scales down from max side % in the table (see `handBarTrackPxFromRows`). */
const HAND_BAR_TRACK_PX_MAX = 76;
const HAND_BAR_TRACK_PX_MIN = 28;
const HAND_CENTER_W = 56;
const HAND_BAR_H = 9;

function handBarTrackPxFromRows(rows: readonly HandednessRow[]): number {
  if (!rows.length) return HAND_BAR_TRACK_PX_MAX;
  let m = 0;
  for (const r of rows) m = Math.max(m, r.L, r.R);
  if (!Number.isFinite(m) || m <= 0) return HAND_BAR_TRACK_PX_MAX;
  const span = HAND_BAR_TRACK_PX_MAX - HAND_BAR_TRACK_PX_MIN;
  return Math.round(HAND_BAR_TRACK_PX_MIN + (Math.min(100, m) / 100) * span);
}

/** Matches `minWidth: 2.65rem` on caption + flex `gap: 0.4` + cell padding (approx). */
const HAND_PCT_LABEL_SLOT_PX = 44;
const HAND_WING_INNER_GAP_PX = 5;
const HAND_WING_EDGE_PAD_PX = 8;
/** Two `columnGap: 0.35` (theme 8px unit) between the three grid columns. */
const HAND_GRID_GAP_TOTAL_PX = 6;

/**
 * Fixed L/R wing widths so the center pill column lines up vertically across every row
 * (each row’s bars differ, but the grid tracks must not).
 */
function handednessWingWidthsPx(rows: readonly HandednessRow[], barTrackPx: number): { left: number; right: number } {
  let maxL = 0;
  let maxR = 0;
  for (const r of rows) {
    const lw = handednessSideBarPx(r.L, barTrackPx);
    const rw = handednessSideBarPx(r.R, barTrackPx);
    maxL = Math.max(maxL, HAND_PCT_LABEL_SLOT_PX + HAND_WING_INNER_GAP_PX + lw);
    maxR = Math.max(maxR, rw + HAND_WING_INNER_GAP_PX + HAND_PCT_LABEL_SLOT_PX);
  }
  const l = Math.ceil(maxL + HAND_WING_EDGE_PAD_PX);
  const r = Math.ceil(maxR + HAND_WING_EDGE_PAD_PX);
  /** Same width both sides so the center pill sits in the middle of the usage block, not biased toward a short wing. */
  const wing = Math.max(l, r);
  return { left: wing, right: wing };
}

/** Savant sometimes uses FA vs FF for four-seam; merge lookup only when primary key is missing. */
const LEAGUE_VELO_ALT_KEYS: Record<string, readonly string[]> = {
  FF: ['FA'],
  FA: ['FF'],
  ST: ['STO', 'STF'],
  STO: ['ST'],
  STF: ['ST'],
};

function leagueAvgForPitchType(m: Map<string, number>, ptKey: string): number | null {
  const v0 = m.get(ptKey);
  if (v0 != null && Number.isFinite(v0)) return v0;
  for (const alt of LEAGUE_VELO_ALT_KEYS[ptKey] ?? []) {
    const v = m.get(alt);
    if (v != null && Number.isFinite(v)) return v;
  }
  return null;
}

function mphTicks(lo: number, hi: number): number[] {
  const range = hi - lo;
  if (range <= 0) return [];
  const step = range > 28 ? 5 : range > 16 ? 2 : 1;
  const ticks: number[] = [];
  const start = Math.ceil(lo / step) * step;
  for (let m = start; m < hi; m += step) ticks.push(m);
  if (ticks.length === 0) ticks.push(Math.round((lo + hi) / 2));
  return ticks;
}

function VeloRowSvg(props: {
  pitchType: string;
  mphMin: number;
  mphMax: number;
  maxCount: number;
  bins: { mph: number; c: number }[];
  /** MLB season average release speed for this pitch type (Statcast); vertical line, clamped to chart edges when outside mph range. */
  leagueAvgMph?: number | null;
  /** ViewBox height; default `ROW_H` (legacy table). Combo mix uses a taller chart. */
  chartHeight?: number;
}) {
  const { pitchType, mphMin, mphMax, maxCount, bins, leagueAvgMph, chartHeight } = props;
  const rowH = chartHeight ?? ROW_H;
  const comboTall = chartHeight != null;
  const w = PITCH_VELO_CHART_W;
  const span = mphMax - mphMin || 1;
  const barTop = comboTall ? 3 : 4;
  const baseY = comboTall ? rowH - 2 : ROW_H - 3;
  const barArea = Math.max(1, baseY - barTop - 1);
  /** ViewBox units — combo tall chart only; keeps sparse bins visible. */
  const minBarH = comboTall ? 1.5 : 0;
  const leagueMph =
    leagueAvgMph != null && Number.isFinite(leagueAvgMph) ? leagueAvgMph : null;
  const hasLeague = leagueMph != null && span > 0;
  /** Inset so a ~1px stroke stays inside the viewBox (x=0/x=w often clip entirely). */
  const leagueLineInset = 1.25;
  let xLeague: number | null = null;
  let leagueClamped = false;
  if (hasLeague && leagueMph != null) {
    const raw = ((leagueMph - mphMin) / span) * w;
    leagueClamped = leagueMph < mphMin || leagueMph > mphMax;
    if (leagueClamped) {
      xLeague = leagueMph < mphMin ? leagueLineInset : w - leagueLineInset;
    } else {
      xLeague = Math.max(leagueLineInset, Math.min(w - leagueLineInset, raw));
    }
  }
  const leagueTooltipText =
    xLeague != null && hasLeague && leagueMph != null
      ? `MLB league average: ${leagueMph.toFixed(1)} mph (${pitchTypeName(pitchType)})`
      : '';
  return (
    <svg width="100%" height={rowH} viewBox={`0 0 ${w} ${rowH}`} style={{ display: 'block', maxWidth: '100%' }}>
      <line x1={0} y1={baseY} x2={w} y2={baseY} stroke="#e0e0e0" strokeWidth={0.5} />
      {bins.map(({ mph, c }) => {
        const x0 = ((mph - mphMin) / span) * w;
        const bw = Math.max(0.6, w / span - 0.15);
        const hRaw = 1.5 * (c / maxCount) * barArea;
        const h = c > 0 && minBarH > 0 ? Math.max(minBarH, hRaw) : hRaw;
        return (
          <rect
            key={mph}
            x={x0}
            y={baseY - h}
            width={bw}
            height={h}
            fill={pitchTypeMovementColor(pitchType)}
            opacity={0.88}
          />
        );
      })}
      {xLeague != null && (
        <Tooltip title={leagueTooltipText} placement="top" enterDelay={200}>
          <g style={{ cursor: 'default' }}>
            {/* Wide transparent stroke so the MUI tooltip is easy to trigger on the dashed line. */}
            <line
              x1={xLeague}
              x2={xLeague}
              y1={barTop}
              y2={baseY}
              stroke="transparent"
              strokeWidth={14}
              pointerEvents="stroke"
            />
            <line
              x1={xLeague}
              x2={xLeague}
              y1={barTop}
              y2={baseY}
              stroke="#757575"
              strokeWidth={1.15}
              strokeDasharray="4 3"
              opacity={leagueClamped ? 0.72 : 0.95}
              pointerEvents="none"
            />
          </g>
        </Tooltip>
      )}
    </svg>
  );
}

/** Compact center-pole L / overall / R for one pitch row inside the mix table. */
function HandednessRowCell({
  r,
  barTrackPx,
  leftWingPx,
  rightWingPx,
}: {
  r: HandednessRow;
  barTrackPx: number;
  leftWingPx: number;
  rightWingPx: number;
}) {
  const col = pitchTypeMovementColor(r.pitch_type);
  const lw = handednessSideBarPx(r.L, barTrackPx);
  const rw = handednessSideBarPx(r.R, barTrackPx);
  const label = r.pitch_type.length <= 3 ? r.pitch_type : r.pitch_type.slice(0, 2);
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: `${leftWingPx}px ${HAND_CENTER_W}px ${rightWingPx}px`,
        alignItems: 'center',
        columnGap: 0.35,
        width: 'max-content',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 0.4,
          pr: 0.25,
          minWidth: 0,
          width: '100%',
          borderRight: '2px solid',
          borderColor: 'primary.light',
        }}
      >
        <Typography
          variant="caption"
          sx={{
            fontWeight: 600,
            fontSize: '0.68rem',
            flexShrink: 0,
            minWidth: '2.65rem',
            textAlign: 'right',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {r.L.toFixed(0)}%
        </Typography>
        <Box
          sx={{
            height: HAND_BAR_H,
            width: `${lw}px`,
            maxWidth: `${lw}px`,
            flex: '0 0 auto',
            flexShrink: 0,
            borderRadius: handednessUsageBarRadiusPx(lw, HAND_BAR_H),
            bgcolor: col,
            boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.06)',
          }}
        />
      </Box>
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 0.15,
          width: '100%',
          minWidth: 0,
        }}
      >
        <Tooltip title={pitchTypeName(r.pitch_type)} arrow placement="top">
          <Box
            component="span"
            sx={{
              width: 26,
              height: 26,
              borderRadius: '50%',
              bgcolor: col,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '0.6rem',
              fontWeight: 800,
              color: '#fff',
              textShadow: '0 0 2px rgba(0,0,0,0.45)',
              boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.2)',
              cursor: 'default',
            }}
          >
            {label}
          </Box>
        </Tooltip>
        <Typography variant="caption" sx={{ fontWeight: 700, fontSize: '0.68rem', lineHeight: 1 }}>
          {r.total.toFixed(0)}%
        </Typography>
      </Box>
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'flex-start',
          gap: 0.4,
          pl: 0.25,
          minWidth: 0,
          width: '100%',
          borderLeft: '2px solid',
          borderColor: 'primary.light',
        }}
      >
        <Box
          sx={{
            height: HAND_BAR_H,
            width: `${rw}px`,
            maxWidth: `${rw}px`,
            flex: '0 0 auto',
            flexShrink: 0,
            borderRadius: handednessUsageBarRadiusPx(rw, HAND_BAR_H),
            bgcolor: col,
            opacity: 0.88,
            boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.06)',
          }}
        />
        <Typography
          variant="caption"
          sx={{
            fontWeight: 600,
            fontSize: '0.68rem',
            flexShrink: 0,
            minWidth: '2.65rem',
            textAlign: 'left',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {r.R.toFixed(0)}%
        </Typography>
      </Box>
    </Box>
  );
}

/**
 * Pitch mix + velocity: optional **handedness** column replaces pill / name / % when `byStandRows`
 * is provided; then **mph histogram** and **avg mph** to the right of the chart.
 */
function leagueVeloMapFromRows(rows: Record<string, unknown>[] | undefined): Map<string, number> {
  const m = new Map<string, number>();
  if (!rows?.length) return m;
  for (const raw of rows) {
    const pt = String(raw.pitch_type ?? '')
      .trim()
      .toUpperCase();
    const rawV = raw.avg_velo;
    let v: number;
    if (typeof rawV === 'number' && Number.isFinite(rawV)) v = rawV;
    else if (typeof rawV === 'string' && rawV.trim() !== '') {
      const n = Number.parseFloat(rawV.trim());
      if (!Number.isFinite(n)) continue;
      v = n;
    } else {
      const n = Number(rawV);
      if (!Number.isFinite(n)) continue;
      v = n;
    }
    if (pt) m.set(pt, v);
  }
  return m;
}

export function PitchMixVeloTable({
  mix,
  veloRows,
  byStandRows,
  leagueAvgVeloByPitch,
  stackBreakpointPx = PITCH_MIX_STACK_BREAKPOINT_PX,
}: {
  mix: Record<string, unknown>[];
  veloRows: Record<string, unknown>[];
  /** When non-empty, L/R usage column is shown (same order as `mix`). */
  byStandRows?: Record<string, unknown>[];
  /** From `statcast-summary`: MLB avg release speed per `pitch_type` for the card season. */
  leagueAvgVeloByPitch?: Record<string, unknown>[];
  /** Use stacked/narrow layout when the **component container** is at most this wide (default 927). */
  stackBreakpointPx?: number;
}) {
  const theme = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const [stackMixLayout, setStackMixLayout] = useState(false);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;

    const sync = () => {
      const w = el.getBoundingClientRect().width;
      setStackMixLayout(w > 0 && w <= stackBreakpointPx);
    };

    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, [stackBreakpointPx]);

  const model = useMemo(() => aggregateVeloBins(veloRows), [veloRows]);
  const leagueVeloByPt = useMemo(() => leagueVeloMapFromRows(leagueAvgVeloByPitch), [leagueAvgVeloByPitch]);
  const hasLeagueVelo = leagueVeloByPt.size > 0;
  const ticks = useMemo(() => mphTicks(model.mphMin, model.mphMax), [model.mphMin, model.mphMax]);
  const handRows = useMemo(() => {
    if (!byStandRows?.length) return null;
    return handednessRowsForMixOrder(mix, byStandRows);
  }, [mix, byStandRows]);
  const combo = handRows != null && handRows.length > 0;
  const handBarTrackPx = useMemo(() => (handRows?.length ? handBarTrackPxFromRows(handRows) : HAND_BAR_TRACK_PX_MAX), [handRows]);
  const handWings = useMemo(
    () => (handRows?.length ? handednessWingWidthsPx(handRows, handBarTrackPx) : { left: 96, right: 96 }),
    [handRows, handBarTrackPx]
  );
  const handBlockWidthPx = handWings.left + handWings.right + HAND_CENTER_W + HAND_GRID_GAP_TOTAL_PX;

  const comboVeloFooterTicks =
    ticks.length > 0 ? (
      <Box sx={{ width: '100%', minWidth: 72 }}>
        <svg
          width="100%"
          height={22}
          viewBox={`0 0 ${PITCH_VELO_CHART_W} 22`}
          style={{ display: 'block', maxWidth: '100%' }}
        >
          <line x1={0} y1={2} x2={PITCH_VELO_CHART_W} y2={2} stroke="#9e9e9e" strokeWidth={0.75} />
          {ticks.map((mph) => {
            const x = ((mph - model.mphMin) / (model.mphMax - model.mphMin || 1)) * PITCH_VELO_CHART_W;
            return (
              <g key={mph}>
                <line x1={x} y1={2} x2={x} y2={7} stroke="#616161" strokeWidth={0.55} />
                <text x={x} y={18} fontSize={10} fill="#424242" textAnchor="middle">
                  {mph}
                </text>
              </g>
            );
          })}
        </svg>
      </Box>
    ) : null;

  let body: ReactNode;

  if (combo) {
    body = (
      <TableContainer
        component={Box}
        sx={{
          width: '100%',
          overflow: 'auto',
          height: 'fit-content',
          display: 'block',
          boxShadow: 'none',
          bgcolor: 'transparent',
        }}
      >
        <Box
          sx={{
            display: 'flex',
            flexDirection: stackMixLayout ? 'column' : 'row',
            alignItems: 'flex-start',
            gap: stackMixLayout ? 1.25 : 0,
            width: '100%',
            height: 'fit-content',
          }}
        >
          <TableContainer
            component={Box}
            sx={{
              flexShrink: 0,
              width: stackMixLayout ? '100%' : 'auto',
              maxWidth: '100%',
              height: 'fit-content',
              display: 'block',
              overflow: 'visible',
              boxShadow: 'none',
              bgcolor: 'transparent',
              alignSelf: 'flex-start',
            }}
          >
            <Table
              size="small"
              className={veloStyles.comboHandMerged}
              sx={{
                width: '100%',
                borderCollapse: 'collapse',
              }}
            >
              <TableHead>
                <TableRow sx={{ minHeight: COMBO_HEAD_ROW_MIN_PX }}>
                  <TableCell sx={{ py: 0.75, pr: 0.5, pl: 0.25, verticalAlign: 'bottom', borderRight: 'none' }}>
                    <Box sx={{ width: handBlockWidthPx }}>
                    <Typography variant="caption" color="text.secondary" component="span" sx={{ cursor: 'help' }}>
                    Usage vs L / R
                      </Typography>
                    </Box>
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {mix.map((row, i) => {
                  const pt = String(row.pitch_type ?? '');
                  const hr = handRows![i];
                  return (
                    <TableRow key={`hand-${pt}-${i}`} sx={{ height: COMBO_BODY_ROW_PX }}>
                      <TableCell
                        sx={{
                          py: 0.5,
                          pr: 0.5,
                          pl: 0.25,
                          whiteSpace: 'nowrap',
                          borderRight: 'none',
                          verticalAlign: 'middle',
                          height: COMBO_BODY_ROW_PX,
                          boxSizing: 'border-box',
                        }}
                      >
                        <Box
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            height: '100%',
                            minHeight: 0,
                          }}
                        >
                          {hr ? (
                            <HandednessRowCell
                              r={hr}
                              barTrackPx={handBarTrackPx}
                              leftWingPx={handWings.left}
                              rightWingPx={handWings.right}
                            />
                          ) : null}
                        </Box>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
          <TableContainer
            component={Box}
            sx={{
              flex: stackMixLayout ? 'none' : 1,
              width: stackMixLayout ? '100%' : undefined,
              minWidth: 0,
              height: 'fit-content',
              display: 'block',
              overflow: 'visible',
              boxShadow: 'none',
              bgcolor: 'transparent',
              alignSelf: 'flex-start',
            }}
          >
            <Table
              size="small"
              className={veloStyles.comboVeloMerged}
              sx={{
                tableLayout: 'fixed',
                width: '100%',
                borderCollapse: 'collapse',
              }}
            >
              <TableHead>
                <TableRow sx={{ minHeight: COMBO_HEAD_ROW_MIN_PX }}>
                  <TableCell sx={{ py: 0.75, pl: 0.5, pr: 0.5, verticalAlign: 'bottom', borderLeft: 'none' }}>
                    {hasLeagueVelo ? (
                      <Tooltip
                        arrow
                        placement="top"
                        title="Gray dashed vertical: MLB average release speed for that pitch type (same season). Pinned to the chart edge when the league average is outside the mph range shown."
                      >
                        <Typography variant="caption" color="text.secondary" component="span" sx={{ cursor: 'help' }}>
                          Mph (1 mph bins)
                        </Typography>
                      </Tooltip>
                    ) : (
                      <Typography variant="caption" color="text.secondary" component="span">
                        Mph (1 mph bins)
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell
                    align="right"
                    sx={{
                      width: 52,
                      py: 0.75,
                      pl: 0.25,
                      pr: 0.5,
                      whiteSpace: 'nowrap',
                      verticalAlign: 'bottom',
                      borderLeft: 'none',
                    }}
                  >
                    <Typography variant="caption" color="text.secondary" component="span">
                      Avg
                    </Typography>
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {mix.map((row, i) => {
                  const pt = String(row.pitch_type ?? '');
                  const ptKey = pt.trim().toUpperCase();
                  const bins = model.byType.get(pt) ?? [];
                  const leagueAvg = leagueAvgForPitchType(leagueVeloByPt, ptKey);
                  return (
                    <TableRow key={`velo-${pt}-${i}`} sx={{ height: COMBO_BODY_ROW_PX }}>
                      <TableCell
                        sx={{
                          py: 0.5,
                          pl: 0.5,
                          pr: 0.5,
                          minWidth: 0,
                          borderLeft: 'none',
                          verticalAlign: 'bottom',
                          height: COMBO_BODY_ROW_PX,
                          boxSizing: 'border-box',
                        }}
                      >
                        <Box
                          sx={{
                            display: 'flex',
                            alignItems: 'flex-end',
                            width: '100%',
                            height: '100%',
                            minHeight: 0,
                          }}
                        >
                          {bins.length > 0 ? (
                            <Box sx={{ width: '100%', minWidth: 72, maxWidth: '100%' }}>
                              <VeloRowSvg
                                pitchType={pt}
                                mphMin={model.mphMin}
                                mphMax={model.mphMax}
                                maxCount={model.maxCount}
                                bins={bins}
                                leagueAvgMph={leagueAvg}
                                chartHeight={COMBO_VELO_ROW_SVG_H}
                              />
                            </Box>
                          ) : (
                            <Typography variant="caption" color="text.secondary">
                              —
                            </Typography>
                          )}
                        </Box>
                      </TableCell>
                      <TableCell
                        align="right"
                        sx={{
                          py: 0.5,
                          pl: 0.25,
                          pr: 0.5,
                          whiteSpace: 'nowrap',
                          borderLeft: 'none',
                          verticalAlign: 'middle',
                          height: COMBO_BODY_ROW_PX,
                          boxSizing: 'border-box',
                        }}
                      >
                        <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                          {String(row.avg_velo ?? '—')}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
        {ticks.length > 0 &&
          (stackMixLayout ? (
            <Box
              sx={{
                width: '100%',
                borderTop: 1,
                borderColor: 'divider',
                pl: 0.5,
                pr: 0.5,
                pt: 0.5,
                pb: 0.5,
                boxSizing: 'border-box',
              }}
            >
              {comboVeloFooterTicks}
            </Box>
          ) : (
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'stretch',
                width: '100%',
                borderTop: 1,
                borderColor: 'divider',
              }}
            >
              <Box
                sx={{
                  flexShrink: 0,
                  width: `calc(${handBlockWidthPx}px + ${theme.spacing(0.25)} + ${theme.spacing(0.5)})`,
                  boxSizing: 'border-box',
                }}
              />
              <Box sx={{ flex: 1, minWidth: 0, pl: 0.5, pr: 0.5, pt: 0, pb: 0.5, boxSizing: 'border-box' }}>
                {comboVeloFooterTicks}
              </Box>
              <Box
                sx={{
                  flexShrink: 0,
                  width: 52,
                  pr: 0.5,
                  boxSizing: 'border-box',
                }}
              />
            </Box>
          ))}
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontSize: '0.65rem', mt: 0.5 }}>
          Center: overall usage % for the season. Sides: share of pitches to LHB / RHB (each side sums to 100%).
        </Typography>
      </TableContainer>
    );
  } else if (stackMixLayout) {
    body = (
      <TableContainer component={Box} sx={{ width: '100%', overflow: 'auto' }}>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.25 }}>
          Mph (1 mph bins)
          {hasLeagueVelo ? ' · gray dashed = MLB avg (in range or pinned to edge)' : ''}
        </Typography>
        <Stack spacing={0} sx={{ width: '100%' }}>
          {mix.map((row, i) => {
            const pt = String(row.pitch_type ?? '');
            const ptKey = pt.trim().toUpperCase();
            const bins = model.byType.get(pt) ?? [];
            const leagueAvg = leagueAvgForPitchType(leagueVeloByPt, ptKey);
            return (
              <Box
                key={`${pt}-stack-${i}`}
                sx={{
                  borderBottom: 1,
                  borderColor: 'divider',
                  py: 1.75,
                  '&:first-of-type': { pt: 0 },
                  '&:last-of-type': { borderBottom: 'none', pb: 0 },
                }}
              >
                <Stack
                  direction="row"
                  alignItems="flex-start"
                  justifyContent="space-between"
                  spacing={1}
                  sx={{ mb: 1, flexWrap: 'wrap', rowGap: 0.75 }}
                >
                  <Stack direction="row" alignItems="center" spacing={0.75} sx={{ minWidth: 0, flex: '1 1 140px' }}>
                    <Tooltip title={pitchTypeName(pt)} arrow placement="top">
                      <Box
                        component="span"
                        sx={{
                          minWidth: 22,
                          width: 22,
                          height: 10,
                          borderRadius: 999,
                          bgcolor: pitchTypeMovementColor(pt),
                          flexShrink: 0,
                          border: '1px solid',
                          borderColor: 'divider',
                          cursor: 'default',
                        }}
                      />
                    </Tooltip>
                    <Stack spacing={0} sx={{ minWidth: 0 }}>
                      <Typography component="span" variant="body2" fontWeight={600} sx={{ lineHeight: 1.2 }}>
                        {pitchTypeName(pt)}
                      </Typography>
                      <Typography component="span" variant="caption" color="text.secondary" sx={{ lineHeight: 1.1 }}>
                        {pt}
                      </Typography>
                    </Stack>
                  </Stack>
                  <Stack direction="row" spacing={2} alignItems="baseline" sx={{ flexShrink: 0 }}>
                    <Typography variant="body2" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {String(row.pct ?? '')}
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                      {String(row.avg_velo ?? '')}
                    </Typography>
                  </Stack>
                </Stack>
                {bins.length > 0 ? (
                  <Box sx={{ width: '100%', minWidth: 0 }}>
                    <VeloRowSvg
                      pitchType={pt}
                      mphMin={model.mphMin}
                      mphMax={model.mphMax}
                      maxCount={model.maxCount}
                      bins={bins}
                      leagueAvgMph={leagueAvg}
                    />
                  </Box>
                ) : (
                  <Typography variant="caption" color="text.secondary">
                    —
                  </Typography>
                )}
              </Box>
            );
          })}
        </Stack>
        {ticks.length > 0 && (
          <Box sx={{ width: '100%', borderTop: 1, borderColor: 'divider', pt: 1, mt: 0.5 }}>
            <Box sx={{ width: '100%', minWidth: 72 }}>
              <svg
                width="100%"
                height={22}
                viewBox={`0 0 ${PITCH_VELO_CHART_W} 22`}
                style={{ display: 'block', maxWidth: '100%' }}
              >
                <line x1={0} y1={2} x2={PITCH_VELO_CHART_W} y2={2} stroke="#9e9e9e" strokeWidth={0.75} />
                {ticks.map((mph) => {
                  const x = ((mph - model.mphMin) / (model.mphMax - model.mphMin || 1)) * PITCH_VELO_CHART_W;
                  return (
                    <g key={mph}>
                      <line x1={x} y1={2} x2={x} y2={7} stroke="#616161" strokeWidth={0.55} />
                      <text x={x} y={18} fontSize={8.5} fill="#424242" textAnchor="middle">
                        {mph}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </Box>
          </Box>
        )}
      </TableContainer>
    );
  } else {
    body = (
    <TableContainer sx={{ width: '100%', overflow: 'auto' }}>
      <Table
        size="small"
        sx={{
          tableLayout: 'fixed',
          '& td, & th': { fontSize: '0.8125rem', verticalAlign: 'middle' },
        }}
      >
        <TableHead>
          <TableRow>
            <TableCell sx={{ width: '28%', pr: 0.5 }}>Pitch</TableCell>
            <TableCell align="right" sx={{ width: '5%', whiteSpace: 'nowrap', pl: 0, pr: 0.25, py: 0.75 }}>
              %
            </TableCell>
            <TableCell align="right" sx={{ width: '7%', whiteSpace: 'nowrap', pl: 0, pr: 0.5, py: 0.75 }}>
              Velo
            </TableCell>
            <TableCell sx={{ width: '60%', minWidth: 0, pl: 0.25 }}>
              <Typography variant="caption" color="text.secondary" component="span">
                Mph (1 mph bins)
                {hasLeagueVelo ? ' · gray dashed = MLB avg (in range or pinned to edge)' : ''}
              </Typography>
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {mix.map((row, i) => {
            const pt = String(row.pitch_type ?? '');
            const ptKey = pt.trim().toUpperCase();
            const bins = model.byType.get(pt) ?? [];
            const leagueAvg = leagueAvgForPitchType(leagueVeloByPt, ptKey);
            return (
              <TableRow key={`${pt}-${i}`}>
                <TableCell sx={{ py: 0.75, pr: 0.5, overflow: 'hidden' }}>
                  <Stack direction="row" alignItems="center" spacing={0.5} sx={{ minWidth: 0 }}>
                    <Tooltip title={pitchTypeName(pt)} arrow placement="top">
                      <Box
                        component="span"
                        sx={{
                          minWidth: 22,
                          width: 22,
                          height: 10,
                          borderRadius: 999,
                          bgcolor: pitchTypeMovementColor(pt),
                          flexShrink: 0,
                          border: '1px solid',
                          borderColor: 'divider',
                          cursor: 'default',
                        }}
                      />
                    </Tooltip>
                    <Stack spacing={0} sx={{ minWidth: 0 }}>
                      <Typography component="span" variant="body2" noWrap>
                        {pitchTypeName(pt)}
                      </Typography>
                      <Typography component="span" variant="caption" color="text.secondary" sx={{ lineHeight: 1.1 }}>
                        {pt}
                      </Typography>
                    </Stack>
                  </Stack>
                </TableCell>
                <TableCell align="right" sx={{ py: 0.75, pl: 0, pr: 0.25, whiteSpace: 'nowrap' }}>
                  {String(row.pct ?? '')}
                </TableCell>
                <TableCell align="right" sx={{ py: 0.75, pl: 0, pr: 0.5, whiteSpace: 'nowrap' }}>
                  {String(row.avg_velo ?? '')}
                </TableCell>
                <TableCell sx={{ py: 0.5, pl: 0.25, pr: 0, minWidth: 0 }}>
                  {bins.length > 0 ? (
                    <Box sx={{ width: '100%', minWidth: 120 }}>
                      <VeloRowSvg
                        pitchType={pt}
                        mphMin={model.mphMin}
                        mphMax={model.mphMax}
                        maxCount={model.maxCount}
                        bins={bins}
                        leagueAvgMph={leagueAvg}
                      />
                    </Box>
                  ) : (
                    <Typography variant="caption" color="text.secondary">
                      —
                    </Typography>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
        {ticks.length > 0 && (
          <TableFooter>
            <TableRow>
              <TableCell colSpan={3} sx={{ p: 0, border: 'none' }} />
              <TableCell sx={{ pt: 0, pb: 0.5, pl: 0.25, pr: 0, borderTop: 'none', width: '100%' }}>
                <Box sx={{ width: '100%', minWidth: 120 }}>
                  <svg
                    width="100%"
                    height={22}
                    viewBox={`0 0 ${PITCH_VELO_CHART_W} 22`}
                    style={{ display: 'block', maxWidth: '100%' }}
                  >
                    <line x1={0} y1={2} x2={PITCH_VELO_CHART_W} y2={2} stroke="#9e9e9e" strokeWidth={0.75} />
                    {ticks.map((mph) => {
                      const x = ((mph - model.mphMin) / (model.mphMax - model.mphMin || 1)) * PITCH_VELO_CHART_W;
                      return (
                        <g key={mph}>
                          <line x1={x} y1={2} x2={x} y2={7} stroke="#616161" strokeWidth={0.55} />
                          <text x={x} y={18} fontSize={8.5} fill="#424242" textAnchor="middle">
                            {mph}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                </Box>
              </TableCell>
            </TableRow>
          </TableFooter>
        )}
      </Table>
    </TableContainer>
    );
  }

  return (
    <Box ref={containerRef} sx={{ width: '100%', minWidth: 0 }}>
      {body}
    </Box>
  );
}
