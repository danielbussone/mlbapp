import FormControlLabel from '@mui/material/FormControlLabel';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useMemo, useState } from 'react';
import { fgCardSeasonRowIsSelected } from './batterFgTables.js';
import {
  buildFieldingCareerAndSeasons,
  buildFieldingCareerExpanded,
  buildFieldingSeasonsExpanded,
  filterSummableFieldingRows,
  fmtFieldingMetric,
  fmtInn,
  type FieldingAggLine,
} from './outfieldFieldingAgg.js';

/** Aligns with card season: one merged row per year, or the season's **All** row in by-position layout. */
function fieldingSeasonRowHighlighted(
  r: FieldingAggLine,
  selectedSeason: number | undefined,
  seasonHighlight: false | 'aggregated' | 'by-position-all'
): boolean {
  if (!seasonHighlight || selectedSeason === undefined) return false;
  if (seasonHighlight === 'aggregated') {
    return fgCardSeasonRowIsSelected(r.seasonLabel, selectedSeason);
  }
  return (
    fgCardSeasonRowIsSelected(r.seasonLabel, selectedSeason) && String(r.position).trim().toUpperCase() === 'ALL'
  );
}

function FieldingRollupTable({
  lines,
  expandedRollupLayout = false,
  selectedSeason,
  seasonHighlight = false,
}: {
  lines: FieldingAggLine[];
  /** When true, rows with Pos = All are rollups; following rows are indented (per-position breakdown). */
  expandedRollupLayout?: boolean;
  /** Card season selector (fielding view). */
  selectedSeason?: number;
  /** `aggregated`: highlight one row per season; `by-position-all`: highlight that season's Pos = All row. */
  seasonHighlight?: false | 'aggregated' | 'by-position-all';
}) {
  if (lines.length === 0) return null;
  return (
    <TableContainer sx={{ mt: 0.5, maxWidth: '100%', overflowX: 'auto' }}>
      <Table size="small" sx={{ '& td, & th': { whiteSpace: 'nowrap', fontSize: '0.75rem' } }}>
      <TableHead>
        <TableRow>
          <TableCell>Season</TableCell>
          <TableCell>Pos</TableCell>
          <TableCell>Team</TableCell>
          <TableCell align="right">G</TableCell>
          <TableCell align="right">Inn</TableCell>
          <TableCell align="right">DRS</TableCell>
          <TableCell align="right">UZR</TableCell>
          <TableCell align="right">OAA</TableCell>
          <TableCell align="right">Err</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {lines.map((r) => {
          const rollupStrong =
            r.key === 'career' || (expandedRollupLayout && r.position === 'All') ? 600 : 400;
          const selected = fieldingSeasonRowHighlighted(r, selectedSeason, seasonHighlight);
          return (
            <TableRow
              key={r.key}
              sx={{
                fontWeight: selected ? 600 : rollupStrong,
                ...(selected
                  ? {
                      bgcolor: 'action.selected',
                      borderLeft: 3,
                      borderLeftColor: 'primary.main',
                      '& .MuiTableCell-root': { fontWeight: 600 },
                    }
                  : {}),
              }}
            >
              <TableCell sx={expandedRollupLayout && r.position !== 'All' ? { pl: 2.5 } : undefined}>
                {r.seasonLabel}
              </TableCell>
              <TableCell>{r.position}</TableCell>
              <TableCell>{r.team}</TableCell>
              <TableCell align="right">{r.games > 0 ? String(r.games) : '—'}</TableCell>
              <TableCell align="right">{fmtInn(r.inn)}</TableCell>
              <TableCell align="right">{fmtFieldingMetric(r.drs, r.drsDefined)}</TableCell>
              <TableCell align="right">{fmtFieldingMetric(r.uzr, r.uzrDefined)}</TableCell>
              <TableCell align="right">{fmtFieldingMetric(r.oaa, r.oaaDefined)}</TableCell>
              <TableCell align="right">{r.errors > 0 ? String(r.errors) : '—'}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
    </TableContainer>
  );
}

/**
 * FanGraphs rolled-up career + by-season fielding (all positions by default).
 * Optional filter to rows matching the card header primary position.
 */
export function OutfieldFieldingTables({
  rows,
  primaryPositionDisplay = null,
  selectedSeason,
}: {
  rows: Record<string, unknown>[];
  /** FanGraphs season primary (`position_display` on batting/pitching season row), e.g. CF or DH/OF. */
  primaryPositionDisplay?: string | null;
  /** Matches the player card season selector for row highlight (By season table only). */
  selectedSeason?: number;
}) {
  const [primaryOnly, setPrimaryOnly] = useState(false);
  /** Shared layout for the Career block and the By season block. */
  const [rollupView, setRollupView] = useState<'aggregated' | 'byPosition'>('aggregated');
  const summableCount = useMemo(() => filterSummableFieldingRows(rows).length, [rows]);
  const hasPrimaryChip = primaryPositionDisplay != null && String(primaryPositionDisplay).trim() !== '';

  const filterOpts = useMemo(
    () => ({
      primaryOnly: primaryOnly && hasPrimaryChip,
      primaryDisplay: primaryPositionDisplay,
    }),
    [primaryOnly, hasPrimaryChip, primaryPositionDisplay]
  );

  const { career, seasons } = useMemo(() => buildFieldingCareerAndSeasons(rows, filterOpts), [rows, filterOpts]);

  const careerExpanded = useMemo(() => buildFieldingCareerExpanded(rows, filterOpts), [rows, filterOpts]);
  const seasonsExpanded = useMemo(() => buildFieldingSeasonsExpanded(rows, filterOpts), [rows, filterOpts]);

  const primaryMismatch =
    summableCount > 0 && primaryOnly && hasPrimaryChip && career == null;

  if (summableCount === 0) {
    return (
      <Typography variant="caption" color="text.secondary">
        No FanGraphs fielding rows for this player (or only non-position totals like ALL).
      </Typography>
    );
  }

  if (primaryMismatch) {
    return (
      <Stack spacing={1}>
        <Stack direction="row" alignItems="center" flexWrap="wrap" gap={1}>
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={primaryOnly}
                onChange={(_, v) => setPrimaryOnly(v)}
                disabled={!hasPrimaryChip}
              />
            }
            label="Primary position only"
          />
        </Stack>
        <Typography variant="caption" color="text.secondary">
          No fielding rows match primary position &quot;{primaryPositionDisplay}&quot;. Turn the filter off to see all
          positions.
        </Typography>
      </Stack>
    );
  }

  return (
    <>
      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
        Career & seasons (FanGraphs, MLB)
      </Typography>
      <Stack direction="row" alignItems="flex-start" flexWrap="wrap" gap={1} sx={{ mb: 0.5 }}>
        <Tooltip
          title={
            hasPrimaryChip
              ? `Uses the primary position chip (${primaryPositionDisplay}) from this card's FanGraphs season row. OF matches LF/CF/RF/OF; DH/OF includes DH plus outfield.`
              : 'FanGraphs did not list a primary position for this season on the batting/pitching card.'
          }
        >
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={primaryOnly}
                onChange={(_, v) => setPrimaryOnly(v)}
                disabled={!hasPrimaryChip}
              />
            }
            label="Primary position only"
          />
        </Tooltip>
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
        {primaryOnly && hasPrimaryChip
          ? `Career and seasonal totals include only positions matching "${primaryPositionDisplay}" (combined when split across teams).`
          : 'Career and seasonal totals include all positions (combined when split across teams or positions).'}
      </Typography>
      <Stack direction="row" alignItems="center" justifyContent="flex-end" flexWrap="wrap" gap={1} sx={{ mb: 0.5 }}>
        <ToggleButtonGroup
          size="small"
          value={rollupView}
          exclusive
          onChange={(_, v) => {
            if (v === 'aggregated' || v === 'byPosition') setRollupView(v);
          }}
          aria-label="Career and season table layout"
        >
          <ToggleButton value="aggregated">One row per season</ToggleButton>
          <ToggleButton value="byPosition">By position</ToggleButton>
        </ToggleButtonGroup>
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
        {rollupView === 'aggregated'
          ? 'Career is one row; each season is one row (Pos lists every position that year).'
          : 'Career starts with All, then one row per position (career innings). Each season starts with All, then one row per position (most innings first in that year).'}
      </Typography>
      <Typography variant="subtitle2" sx={{ fontWeight: 600, mt: 0.5, mb: 0.5 }}>
        Career
      </Typography>
      {career != null && (
        <FieldingRollupTable
          lines={rollupView === 'aggregated' ? [career] : careerExpanded}
          expandedRollupLayout={rollupView === 'byPosition'}
        />
      )}
      <Typography variant="subtitle2" sx={{ fontWeight: 600, mt: 1.5, mb: 0.5 }}>
        By season
      </Typography>
      <FieldingRollupTable
        lines={rollupView === 'aggregated' ? seasons : seasonsExpanded}
        expandedRollupLayout={rollupView === 'byPosition'}
        selectedSeason={selectedSeason}
        seasonHighlight={rollupView === 'aggregated' ? 'aggregated' : 'by-position-all'}
      />
    </>
  );
}
