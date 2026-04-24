import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableFooter from '@mui/material/TableFooter';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { useMemo } from 'react';
import { pitchTypeName } from './pitchTypeLabels.js';
import { pitchTypeMovementColor } from './MovementMiniPlot.js';
import { aggregateVeloBins } from './pitchVeloBins.js';

const ROW_H = 30;
/** Logical chart width (viewBox); row SVG scales to fill the histogram column. */
const CHART_W = 360;

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
}) {
  const { pitchType, mphMin, mphMax, maxCount, bins } = props;
  const w = CHART_W;
  const span = mphMax - mphMin || 1;
  const barTop = 4;
  const baseY = ROW_H - 3;
  return (
    <svg width="100%" height={ROW_H} viewBox={`0 0 ${w} ${ROW_H}`} style={{ display: 'block', maxWidth: '100%' }}>
      <line x1={0} y1={baseY} x2={w} y2={baseY} stroke="#e0e0e0" strokeWidth={0.5} />
      {bins.map(({ mph, c }) => {
        const x0 = ((mph - mphMin) / span) * w;
        const bw = Math.max(0.6, w / span - 0.15);
        const h = (c / maxCount) * (baseY - barTop - 1);
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
    </svg>
  );
}

/**
 * Single table: pitch mix columns + one velocity micro-histogram per row (same order as `mix`).
 * Shared mph scale across rows; axis ticks once in the footer.
 */
export function PitchMixVeloTable({
  mix,
  veloRows,
}: {
  mix: Record<string, unknown>[];
  veloRows: Record<string, unknown>[];
}) {
  const model = useMemo(() => aggregateVeloBins(veloRows), [veloRows]);
  const ticks = useMemo(() => mphTicks(model.mphMin, model.mphMax), [model.mphMin, model.mphMax]);

  return (
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
            <TableCell
              align="right"
              sx={{ width: '5%', whiteSpace: 'nowrap', pl: 0, pr: 0.25, py: 0.75 }}
            >
              %
            </TableCell>
            <TableCell
              align="right"
              sx={{ width: '7%', whiteSpace: 'nowrap', pl: 0, pr: 0.5, py: 0.75 }}
            >
              Velo
            </TableCell>
            <TableCell sx={{ width: '60%', minWidth: 0, pl: 0.25 }}>
              <Typography variant="caption" color="text.secondary" component="span">
                Mph (1 mph bins)
              </Typography>
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {mix.map((row, i) => {
            const pt = String(row.pitch_type ?? '');
            const bins = model.byType.get(pt) ?? [];
            return (
              <TableRow key={`${pt}-${i}`}>
                <TableCell sx={{ py: 0.75, pr: 0.5, overflow: 'hidden' }}>
                  <Stack direction="row" alignItems="center" spacing={0.5} sx={{ minWidth: 0 }}>
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
                      }}
                    />
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
                  <svg width="100%" height={22} viewBox={`0 0 ${CHART_W} 22`} style={{ display: 'block', maxWidth: '100%' }}>
                    <line x1={0} y1={2} x2={CHART_W} y2={2} stroke="#9e9e9e" strokeWidth={0.75} />
                    {ticks.map((mph) => {
                      const x = ((mph - model.mphMin) / (model.mphMax - model.mphMin || 1)) * CHART_W;
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
