import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
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

function GradeCell({
  value,
  note,
  explainer,
}: {
  value: number | null;
  note?: string;
  explainer: string;
}) {
  const display = formatGrade(value);
  const placeholder = value == null && note != null ? `\n\n${note} when wired.` : '';
  const tip = `${explainer || '—'}${placeholder}`;

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
        <span className={styles.tooltipHit}>{body}</span>
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
  return (
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
            <GradeCell value={row.process} note={row.processNote} explainer={row.processTooltip} />
            {showResultColumn && (
              <GradeCell value={row.result} note={row.resultNote} explainer={row.resultTooltip || '—'} />
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function Section({
  title,
  data,
  linesFn,
  showResultColumn = true,
}: {
  title: string;
  data: LeaguePercentilesResponse | null;
  linesFn: (slots: Record<string, PercentileSlot>) => ScoutingToolLine[];
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
  const lines = linesFn(slots);
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
          ? '20–80 grades (nearest 5): one tier per tool; Overall blends xERA + xFIP.'
          : '20–80 style grades from league percentiles (nearest 5). Prototype weights — see docs/plan.'}
      </Typography>

      {cardRole === 'batting' && <Section title="Batting" data={primary} linesFn={battingScoutingLines} />}

      {cardRole === 'pitching' && (
        <Section title="Pitching" data={primary} linesFn={pitchingScoutingLines} showResultColumn={false} />
      )}

      {cardRole === 'fielding' && <Section title="Fielding" data={primary} linesFn={fieldingScoutingLines} />}
    </Box>
  );
}
