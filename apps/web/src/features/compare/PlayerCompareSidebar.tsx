import CloseIcon from '@mui/icons-material/Close';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { Link as RouterLink } from 'react-router-dom';
import { useCompareFgCareerQuery, useCompareStatcastSummaryQuery } from '@/api/compareQueries.js';
import styles from './PlayerCompareSidebar.module.css';

function fmt(v: unknown): string {
  if (v == null || v === '') return '—';
  const n = typeof v === 'number' ? v : Number(v);
  if (Number.isFinite(n)) {
    if (Math.abs(n) < 10 && !Number.isInteger(n)) return n.toFixed(3);
    return String(n);
  }
  return String(v);
}

function pickPrimarySeasonRow(rows: Record<string, unknown>[]): Record<string, unknown> | null {
  if (!rows.length) return null;
  return rows.reduce((a, b) => {
    const pa = Number(a.pa ?? a.ip ?? 0);
    const pb = Number(b.pa ?? b.ip ?? 0);
    return pb > pa ? b : a;
  });
}

export function PlayerCompareSidebar({
  playerIds,
  mode,
  gameYear,
  compareFgSeason,
  onClose,
}: {
  playerIds: [number, number];
  mode: 'career' | 'statcast';
  gameYear: number;
  /** When set with `mode === 'career'`, load single-season FanGraphs slice instead of career totals. */
  compareFgSeason?: number | null;
  onClose: () => void;
}) {
  const careerQ = useCompareFgCareerQuery({
    playerIds,
    season: compareFgSeason,
    enabled: mode === 'career',
  });
  const statQ = useCompareStatcastSummaryQuery({
    playerIds,
    role: 'pitcher',
    gameYear,
    enabled: mode === 'statcast',
  });

  const payload = mode === 'career' ? careerQ.data ?? null : statQ.data ?? null;
  const err =
    mode === 'career'
      ? careerQ.isError
        ? careerQ.error instanceof Error
          ? careerQ.error.message
          : 'Request failed'
        : null
      : statQ.isError
        ? statQ.error instanceof Error
          ? statQ.error.message
          : 'Request failed'
        : null;

  const players = (payload?.players as Record<string, unknown>[] | undefined) ?? [];
  const fgSeasonYear = (payload?.meta as { fg_season_year?: number } | undefined)?.fg_season_year;
  const battingFgSeason = payload?.batting_fg_season as
    | { player_id: number; rows: Record<string, unknown>[] }[]
    | undefined;
  const pitchingFgSeason = payload?.pitching_fg_season as
    | { player_id: number; rows: Record<string, unknown>[] }[]
    | undefined;

  return (
    <Paper variant="outlined" className={styles.paper}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" className={styles.headerRow}>
        <Typography variant="subtitle2" className={styles.title}>
          {mode === 'career'
            ? fgSeasonYear != null
              ? `FanGraphs ${fgSeasonYear}`
              : 'Career compare'
            : 'Statcast compare'}
        </Typography>
        <IconButton size="small" aria-label="Close" onClick={onClose}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Stack>
      {err && (
        <Typography color="error" variant="caption" className={styles.errorText}>
          {err}
        </Typography>
      )}
      <Typography variant="caption" color="text.secondary" className={styles.metaText}>
        {players.map((p) => `${p.name_first} ${p.name_last}`).join(' vs ')}
        {mode === 'statcast' && ` · ${gameYear}`}
      </Typography>
      {mode === 'career' && fgSeasonYear != null && battingFgSeason && (
        <Table size="small" className={styles.tableSpaced}>
          <TableHead>
            <TableRow>
              <TableCell>Stat</TableCell>
              {players.map((p) => (
                <TableCell key={String(p.player_id)} align="right">
                  {String(p.name_last)}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {(['war', 'pa', 'hr', 'avg', 'obp', 'slg'] as const).map((k) => (
              <TableRow key={k}>
                <TableCell className={styles.metricKey}>{k}</TableCell>
                {players.map((p) => {
                  const pid = Number(p.player_id);
                  const block = battingFgSeason.find((b) => b.player_id === pid);
                  const row = block ? pickPrimarySeasonRow(block.rows) : null;
                  return (
                    <TableCell key={pid} align="right">
                      {fmt(row?.[k])}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {mode === 'career' && fgSeasonYear != null && pitchingFgSeason && (
        <Typography variant="caption" color="text.secondary" className={styles.sectionLabel}>
          Pitching ({fgSeasonYear})
        </Typography>
      )}
      {mode === 'career' && fgSeasonYear != null && pitchingFgSeason && (
        <Table size="small" className={styles.tableSpaced}>
          <TableHead>
            <TableRow>
              <TableCell>Stat</TableCell>
              {players.map((p) => (
                <TableCell key={String(p.player_id)} align="right">
                  {String(p.name_last)}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {(['ip', 'era', 'fip', 'war', 'k_per_9', 'bb_per_9'] as const).map((k) => (
              <TableRow key={k}>
                <TableCell className={styles.metricKey}>{k.replace(/_/g, '/')}</TableCell>
                {players.map((p) => {
                  const pid = Number(p.player_id);
                  const block = pitchingFgSeason.find((b) => b.player_id === pid);
                  const row = block ? pickPrimarySeasonRow(block.rows) : null;
                  return (
                    <TableCell key={pid} align="right">
                      {fmt(row?.[k])}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {mode === 'career' && fgSeasonYear == null && payload && Array.isArray(payload.batting_careers) && (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Stat</TableCell>
              {players.map((p) => (
                <TableCell key={String(p.player_id)} align="right">
                  {String(p.name_last)}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {['career_war', 'career_pa', 'career_hr', 'career_avg', 'career_obp', 'career_slg'].map((k) => (
              <TableRow key={k}>
                <TableCell className={styles.metricKey}>{k.replace('career_', '')}</TableCell>
                {(payload.batting_careers as { player_id: number; career: Record<string, unknown> | null }[]).map(
                  (c) => (
                    <TableCell key={c.player_id} align="right">
                      {fmt(c.career?.[k])}
                    </TableCell>
                  ),
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {mode === 'statcast' && payload && Array.isArray(payload.summaries) && (
        <Stack spacing={1}>
          {(payload.summaries as Record<string, unknown>[]).map((s) => {
            const pid = s.player_id;
            const pl = players.find((p) => p.player_id === pid);
            return (
              <Box key={String(pid)}>
                <Typography variant="caption" className={styles.yearHeader}>
                  {String(pl?.name_last ?? pid)}
                </Typography>
                <Typography variant="caption" display="block" color="text.secondary">
                  Pitches:{' '}
                  {Array.isArray(s.mix)
                    ? (s.mix as Record<string, unknown>[]).reduce((acc, r) => {
                        const raw = r.pitches;
                        if (raw == null || raw === '') return acc;
                        const n = typeof raw === 'number' ? raw : Number(raw);
                        return acc + (Number.isFinite(n) ? n : 0);
                      }, 0)
                    : 0}
                </Typography>
              </Box>
            );
          })}
        </Stack>
      )}
      <Box className={styles.statcastBlock}>
        <Button
          component={RouterLink}
          to={
            mode === 'career'
              ? `/compare/career?player_ids=${playerIds[0]},${playerIds[1]}${
                  compareFgSeason != null && compareFgSeason > 0 ? `&season=${compareFgSeason}` : ''
                }`
              : `/compare/statcast?player_ids=${playerIds[0]},${playerIds[1]}&role=pitcher&game_year=${gameYear}`
          }
          size="small"
          variant="outlined"
          fullWidth
        >
          Open full page
        </Button>
      </Box>
      <Typography variant="caption" color="text.secondary" className={styles.footerNote}>
        Statcast sidebar compare defaults to <strong>pitcher</strong> role; use the full page to pick batter.
      </Typography>
    </Paper>
  );
}
