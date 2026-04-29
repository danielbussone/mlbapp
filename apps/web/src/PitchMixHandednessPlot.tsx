import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useMemo } from 'react';
import { pitchTypeMovementColor } from './MovementMiniPlot.js';
import { pitchTypeName } from './pitchTypeLabels.js';
import {
  handednessRowsSortedByTotal,
  handednessSideBarPx,
  handednessUsageBarRadiusPx,
} from './pitchMixHandednessModel.js';

type Row = Record<string, unknown>;

const BAR_TRACK_PX = 104;
const BAR_H = 11;

/**
 * Full-width center-pole layout (supplemental page): rows sorted by overall usage.
 */
export function PitchMixHandednessPlot({
  byStandRows,
  overallMixRows,
  title,
}: {
  byStandRows: Row[];
  overallMixRows: Row[];
  /** e.g. "2026 pitch usage" */
  title?: string;
}) {
  const rows = useMemo(
    () => handednessRowsSortedByTotal(overallMixRows, byStandRows),
    [byStandRows, overallMixRows]
  );

  if (rows.length === 0) return null;

  return (
    <Box sx={{ mt: 1 }}>
      <Typography
        variant="subtitle2"
        sx={{
          fontWeight: 600,
          mb: 1,
          textAlign: 'center',
          textDecoration: 'underline',
          textDecorationStyle: 'dotted',
          textUnderlineOffset: 4,
        }}
      >
        {title ?? 'Pitch usage vs handedness'}
      </Typography>
      <Stack spacing={0.85}>
        {rows.map((r) => {
          const col = pitchTypeMovementColor(r.pitch_type);
          const lw = handednessSideBarPx(r.L, BAR_TRACK_PX);
          const rw = handednessSideBarPx(r.R, BAR_TRACK_PX);
          const label = r.pitch_type.length <= 3 ? r.pitch_type : r.pitch_type.slice(0, 2);
          return (
            <Box
              key={r.pitch_type}
              sx={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1fr) 76px minmax(0, 1fr)',
                alignItems: 'center',
                columnGap: 0.5,
                minHeight: 36,
              }}
            >
              <Box
                sx={{
                  display: 'flex',
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  gap: 0.75,
                  pr: 0.5,
                  borderRight: '2px solid',
                  borderColor: 'primary.light',
                  minWidth: 0,
                }}
              >
                <Typography variant="caption" sx={{ fontWeight: 600, flexShrink: 0 }}>
                  {r.L.toFixed(0)}%
                </Typography>
                <Box
                  sx={{
                    height: BAR_H,
                    width: `${lw}px`,
                    maxWidth: `${lw}px`,
                    flex: '0 0 auto',
                    flexShrink: 0,
                    borderRadius: handednessUsageBarRadiusPx(lw, BAR_H),
                    bgcolor: col,
                    boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.06)',
                  }}
                />
              </Box>
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.25 }}>
                <Tooltip title={pitchTypeName(r.pitch_type)} arrow placement="top">
                  <Box
                    component="span"
                    sx={{
                      width: 30,
                      height: 30,
                      borderRadius: '50%',
                      bgcolor: col,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '0.65rem',
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
                <Typography variant="caption" sx={{ fontWeight: 700, lineHeight: 1 }}>
                  {r.total.toFixed(0)}%
                </Typography>
              </Box>
              <Box
                sx={{
                  display: 'flex',
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'flex-start',
                  gap: 0.75,
                  pl: 0.5,
                  borderLeft: '2px solid',
                  borderColor: 'primary.light',
                  minWidth: 0,
                }}
              >
                <Box
                  sx={{
                    height: BAR_H,
                    width: `${rw}px`,
                    maxWidth: `${rw}px`,
                    flex: '0 0 auto',
                    flexShrink: 0,
                    borderRadius: handednessUsageBarRadiusPx(rw, BAR_H),
                    bgcolor: col,
                    opacity: 0.88,
                    boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.06)',
                  }}
                />
                <Typography variant="caption" sx={{ fontWeight: 600, flexShrink: 0 }}>
                  {r.R.toFixed(0)}%
                </Typography>
              </Box>
            </Box>
          );
        })}
      </Stack>
      <Stack direction="row" justifyContent="space-between" sx={{ mt: 1, px: { xs: 0, sm: 1 } }}>
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
          vs LHB
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
          vs RHB
        </Typography>
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
        Center: overall Statcast usage % for the season. Left / right: share of pitches to LHB / RHB only
        (each side sums to 100% across pitch types).
      </Typography>
    </Box>
  );
}
