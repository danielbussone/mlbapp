import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useMemo } from 'react';
import { pitchTypeMovementColor } from '@/features/movement-velo/MovementMiniPlot.js';
import { pitchTypeName } from './pitchTypeLabels.js';
import {
  handednessRowsSortedByTotal,
  handednessSideBarPx,
  handednessUsageBarRadiusPx,
} from './pitchMixHandednessModel.js';
import styles from './PitchMixHandednessPlot.module.css';

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
    <Box className={styles.wrap}>
      <Typography variant="subtitle2" className={styles.plotTitle}>
        {title ?? 'Pitch usage vs handedness'}
      </Typography>
      <Stack spacing={0.85}>
        {rows.map((r) => {
          const col = pitchTypeMovementColor(r.pitch_type);
          const lw = handednessSideBarPx(r.L, BAR_TRACK_PX);
          const rw = handednessSideBarPx(r.R, BAR_TRACK_PX);
          const label = r.pitch_type.length <= 3 ? r.pitch_type : r.pitch_type.slice(0, 2);
          return (
            <Box key={r.pitch_type} className={styles.rowGrid}>
              <Box className={styles.wingLeft}>
                <Typography variant="caption" className={styles.axisLabel}>
                  {r.L.toFixed(0)}%
                </Typography>
                <Box
                  className={styles.usageBar}
                  style={{
                    height: BAR_H,
                    width: `${lw}px`,
                    maxWidth: `${lw}px`,
                    borderRadius: handednessUsageBarRadiusPx(lw, BAR_H),
                    backgroundColor: col,
                  }}
                />
              </Box>
              <Box className={styles.barColumn}>
                <Tooltip title={pitchTypeName(r.pitch_type)} arrow placement="top">
                  <Box component="span" className={styles.pitchPill} style={{ backgroundColor: col }}>
                    {label}
                  </Box>
                </Tooltip>
                <Typography variant="caption" className={styles.pctStrong}>
                  {r.total.toFixed(0)}%
                </Typography>
              </Box>
              <Box className={styles.wingRight}>
                <Box
                  className={`${styles.usageBar} ${styles.usageBarDim}`}
                  style={{
                    height: BAR_H,
                    width: `${rw}px`,
                    maxWidth: `${rw}px`,
                    borderRadius: handednessUsageBarRadiusPx(rw, BAR_H),
                    backgroundColor: col,
                  }}
                />
                <Typography variant="caption" className={styles.axisLabel}>
                  {r.R.toFixed(0)}%
                </Typography>
              </Box>
            </Box>
          );
        })}
      </Stack>
      <Stack direction="row" justifyContent="space-between" className={styles.axisFooter}>
        <Typography variant="caption" color="text.secondary" className={styles.axisFooterLabel}>
          vs LHB
        </Typography>
        <Typography variant="caption" color="text.secondary" className={styles.axisFooterLabel}>
          vs RHB
        </Typography>
      </Stack>
      <Typography variant="caption" color="text.secondary" className={styles.note}>
        Center: overall Statcast usage % for the season. Left / right: share of pitches to LHB / RHB only
        (each side sums to 100% across pitch types).
      </Typography>
    </Box>
  );
}
