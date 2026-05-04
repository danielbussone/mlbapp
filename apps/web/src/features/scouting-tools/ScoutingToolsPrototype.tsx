import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useEffect, useState } from 'react';
import type { LeaguePercentilesResponse, PercentileSlot } from '@/features/league-percentiles/leaguePercentilesTypes.js';
import type { LeaguePercentilesCardRole } from '@/features/league-percentiles/LeaguePercentilesPanel.js';
import {
  battingScoutingLines,
  fieldingScoutingLines,
  mergeSlotsForScouting,
  pitchingScoutingLines,
  type ScoutingGradeBreakdown,
  type ScoutingToolLine,
} from '@/features/scouting-tools/scoutingToolsFromPercentiles.js';
import styles from './ScoutingToolsPrototype.module.css';

type Props = {
  playerId: number;
  season: number;
  cardRole: LeaguePercentilesCardRole;
};

function apiRole(cardRole: LeaguePercentilesCardRole): 'batter' | 'pitcher' | 'fielding' {
  if (cardRole === 'batting') return 'batter';
  if (cardRole === 'pitching') return 'pitcher';
  return 'fielding';
}

async function fetchPercentiles(
  playerId: number,
  season: number,
  role: 'batter' | 'pitcher' | 'fielding'
): Promise<{ ok: boolean; json: LeaguePercentilesResponse & { error?: string } }> {
  const qs = new URLSearchParams({ game_year: String(season), role });
  const r = await fetch(`/api/players/${playerId}/league-percentiles?${qs.toString()}`);
  const json = (await r.json()) as LeaguePercentilesResponse & { error?: string };
  return { ok: r.ok, json };
}

function formatGrade(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return String(v);
}

const TOOLTIP_SX = { maxWidth: 440 };

function GradeBreakdownDialog({
  open,
  onClose,
  title,
  breakdown,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  breakdown: ScoutingGradeBreakdown;
}) {
  const { formulaLines, metrics, selectionNote, meanGoodness, grade20_80 } = breakdown;
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth aria-labelledby="scouting-grade-dialog-title">
      <DialogTitle id="scouting-grade-dialog-title">{title}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          League percentile (p) from the cohort, adjusted to a goodness scale (0–100, higher = better), averaged for
          this cell, then mapped to a 20–80 scouting-style grade in steps of 5.
        </Typography>
        {selectionNote ? (
          <Typography variant="body2" sx={{ mb: 1.5 }}>
            {selectionNote}
          </Typography>
        ) : null}
        {meanGoodness != null && grade20_80 != null ? (
          <Typography variant="body2" sx={{ mb: 1 }}>
            <span className={styles.gradeMono}>mean_goodness = {meanGoodness.toFixed(2)}</span>
            {' → '}
            <span className={styles.gradeMono}>grade = {grade20_80}</span>
          </Typography>
        ) : null}
        <Typography component="h3" variant="subtitle2" sx={{ mt: 1, mb: 0.5 }}>
          Steps
        </Typography>
        <Box component="ol" sx={{ m: 0, pl: 2.25, mb: 0 }}>
          {formulaLines.map((line, i) => (
            <Typography key={`${i}-${line.slice(0, 48)}`} component="li" variant="body2" sx={{ py: 0.2 }}>
              {line}
            </Typography>
          ))}
        </Box>
        {metrics.length > 0 ? (
          <>
            <Typography component="h3" variant="subtitle2" sx={{ mt: 2, mb: 0.75 }}>
              Inputs
            </Typography>
            <Table size="small" sx={{ '& .MuiTableCell-root': { py: 0.5, px: 1 } }}>
              <TableHead>
                <TableRow>
                  <TableCell>Metric</TableCell>
                  <TableCell align="right">League p</TableCell>
                  <TableCell>Dir.</TableCell>
                  <TableCell align="right">Goodness</TableCell>
                  <TableCell align="center">In mean</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {metrics.map((m) => (
                  <TableRow key={m.metricId}>
                    <TableCell>
                      <Typography variant="body2" component="code" className={styles.metricCode}>
                        {m.metricId}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      {m.leaguePercentile != null && Number.isFinite(m.leaguePercentile)
                        ? `${Math.round(m.leaguePercentile)}`
                        : '—'}
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary">
                        {m.direction === 'lower_better' ? 'low+ good' : 'high+ good'}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      {m.goodnessPercentile != null && Number.isFinite(m.goodnessPercentile)
                        ? m.goodnessPercentile.toFixed(1)
                        : '—'}
                    </TableCell>
                    <TableCell align="center">{m.used ? 'Yes' : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} variant="contained" size="small">
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function GradeCell({
  value,
  note,
  explainer,
  toolLabel,
  columnLabel,
  breakdown,
  onOpenDetail,
}: {
  value: number | null;
  note?: string;
  explainer: string;
  toolLabel: string;
  columnLabel: string;
  breakdown: ScoutingGradeBreakdown;
  onOpenDetail: (payload: { title: string; breakdown: ScoutingGradeBreakdown }) => void;
}) {
  const display = formatGrade(value);
  const placeholder = value == null && note != null ? `\n\n${note} when wired.` : '';
  const tip = `${explainer || '—'}${placeholder}\n\n(Click for calculation.)`;

  const body =
    value == null && note != null ? (
      <span className={styles.muted}>—</span>
    ) : (
      <>
        <span className={styles.gradeMono}>{display}</span>
        {value != null && note != null ? (
          <Typography component="span" variant="caption" color="text.secondary" className={styles.gradeHint}>
            {' '}
            ({note})
          </Typography>
        ) : null}
      </>
    );

  return (
    <TableCell align="center" className={styles.gradeCell}>
      <Tooltip title={tip} placement="top" enterDelay={400} slotProps={{ tooltip: { sx: TOOLTIP_SX } }}>
        <Box
          component="button"
          type="button"
          onClick={() => onOpenDetail({ title: `${toolLabel} · ${columnLabel}`, breakdown })}
          aria-label={`Show calculation for ${toolLabel} ${columnLabel}`}
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            minHeight: 32,
            px: 0.75,
            py: 0.25,
            m: 0,
            border: 'none',
            borderRadius: 1,
            bgcolor: 'transparent',
            font: 'inherit',
            color: 'inherit',
            cursor: 'pointer',
            textAlign: 'center',
            '&:hover': { bgcolor: 'action.hover' },
          }}
        >
          {body}
        </Box>
      </Tooltip>
    </TableCell>
  );
}

const COL_TIP_PROCESS =
  'Process stats—each cell averages league percentiles for the stats listed; missing inputs drop out.';
const COL_TIP_RESULT = 'Result stats—same averaging when multiple apply.';
const COL_TIP_GRADE =
  '20–80 grade from mean goodness percentile of the stats in the tooltip (missing stats drop out).';

function ScoutingTable({
  lines,
  showResultColumn = true,
}: {
  lines: ScoutingToolLine[];
  /** Pitching uses one grade column (no separate result tier in prototype). */
  showResultColumn?: boolean;
}) {
  const [detail, setDetail] = useState<{ title: string; breakdown: ScoutingGradeBreakdown } | null>(null);
  const processColLabel = showResultColumn ? 'Process' : 'Grade';
  return (
    <>
    <Table size="small" className={styles.table}>
      <TableHead>
        <TableRow>
          <TableCell>Tool</TableCell>
          <TableCell align="center">
            <Tooltip
              title={showResultColumn ? COL_TIP_PROCESS : COL_TIP_GRADE}
              enterDelay={400}
              slotProps={{ tooltip: { sx: TOOLTIP_SX } }}
            >
              <span className={styles.headerTip}>{showResultColumn ? 'Process' : 'Grade'}</span>
            </Tooltip>
          </TableCell>
          {showResultColumn && (
            <TableCell align="center">
              <Tooltip title={COL_TIP_RESULT} enterDelay={400} slotProps={{ tooltip: { sx: TOOLTIP_SX } }}>
                <span className={styles.headerTip}>Result</span>
              </Tooltip>
            </TableCell>
          )}
        </TableRow>
      </TableHead>
      <TableBody>
        {lines.map((row) => (
          <TableRow key={row.key}>
            <TableCell component="th" scope="row">
              <Tooltip
                title={
                  showResultColumn ? (
                    <Box component="span" sx={{ display: 'block', maxWidth: 440 }}>
                      <Typography component="span" variant="body2" display="block" sx={{ mb: 0.75 }}>
                        <strong>Process:</strong> {row.processTooltip}
                      </Typography>
                      <Typography component="span" variant="body2" display="block">
                        <strong>Result:</strong> {row.resultTooltip || '—'}
                      </Typography>
                    </Box>
                  ) : (
                    <Typography component="span" variant="body2" sx={{ display: 'block', maxWidth: 440 }}>
                      {row.processTooltip}
                    </Typography>
                  )
                }
                enterDelay={400}
                slotProps={{ tooltip: { sx: TOOLTIP_SX } }}
              >
                <span className={styles.toolLabel}>{row.label}</span>
              </Tooltip>
            </TableCell>
            <GradeCell
              value={row.process}
              note={row.processNote}
              explainer={row.processTooltip}
              toolLabel={row.label}
              columnLabel={processColLabel}
              breakdown={row.processBreakdown}
              onOpenDetail={setDetail}
            />
            {showResultColumn && (
              <GradeCell
                value={row.result}
                note={row.resultNote}
                explainer={row.resultTooltip || '—'}
                toolLabel={row.label}
                columnLabel="Result"
                breakdown={row.resultBreakdown}
                onOpenDetail={setDetail}
              />
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
    {detail ? (
      <GradeBreakdownDialog
        open
        onClose={() => setDetail(null)}
        title={detail.title}
        breakdown={detail.breakdown}
      />
    ) : null}
    </>
  );
}

function Section({
  title,
  data,
  linesFn,
  season,
  showResultColumn = true,
}: {
  title: string;
  data: LeaguePercentilesResponse | null;
  linesFn: (slots: Record<string, PercentileSlot>, season: number) => ScoutingToolLine[];
  season: number;
  showResultColumn?: boolean;
}) {
  if (!data?.percentiles_available) {
    return (
      <Typography variant="caption" color="text.secondary">
        {data?.reason ?? 'Percentiles unavailable.'}
      </Typography>
    );
  }
  const slots = mergeSlotsForScouting(data);
  const lines = linesFn(slots, season);
  return (
    <>
      <Typography variant="caption" className={styles.sectionTitle}>
        {title}
      </Typography>
      <ScoutingTable lines={lines} showResultColumn={showResultColumn} />
    </>
  );
}

export function ScoutingToolsPrototype({ playerId, season, cardRole }: Props) {
  const [primary, setPrimary] = useState<LeaguePercentilesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setErr(null);
      try {
        const r1 = await fetchPercentiles(playerId, season, apiRole(cardRole));
        if (cancelled) return;
        if (!r1.ok || r1.json.error) {
          setPrimary(null);
          setErr(String(r1.json.error ?? 'League percentiles request failed'));
          setLoading(false);
          return;
        }
        setPrimary(r1.json);
      } catch (e) {
        if (!cancelled) {
          setPrimary(null);
          setErr(e instanceof Error ? e.message : 'Request failed');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [playerId, season, cardRole]);

  if (loading) {
    return (
      <Stack spacing={1} aria-busy="true" aria-label="Loading scouting grades">
        <Skeleton variant="text" width="50%" height={18} />
        <Skeleton variant="rounded" width="100%" height={120} />
      </Stack>
    );
  }

  if (err) {
    return (
      <Alert severity="warning" className={styles.alertDense}>
        {err}
      </Alert>
    );
  }

  return (
    <Box className={styles.root}>
      <Typography variant="caption" color="text.secondary" className={styles.blurb}>
        {cardRole === 'pitching'
          ? '20–80 grades (nearest 5): era-based rows (pre-2002: three tools; 2002+: Stuff, Command, Control, Limit damage, Overall).'
          : '20–80 style grades from league percentiles (nearest 5). Prototype weights — see docs/plan.'}{' '}
        Click any grade to open the formula and per-metric inputs.
      </Typography>

      {cardRole === 'batting' && (
        <Section title="Batting" data={primary} season={season} linesFn={battingScoutingLines} />
      )}

      {cardRole === 'pitching' && (
        <Section
          title="Pitching"
          data={primary}
          season={season}
          linesFn={pitchingScoutingLines}
          showResultColumn={false}
        />
      )}

      {cardRole === 'fielding' && (
        <Section title="Fielding" data={primary} season={season} linesFn={fieldingScoutingLines} />
      )}
    </Box>
  );
}
