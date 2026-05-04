import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Container from '@mui/material/Container';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useCompareFgCareerQuery } from '@/api/compareQueries.js';

type PlayerRow = { player_id: number; name_first?: string; name_last?: string; key_mlbam?: number | null };

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmt(v: unknown): string {
  const n = num(v);
  if (n == null) return '—';
  if (Math.abs(n) >= 1000) return n.toFixed(0);
  if (Math.abs(n) < 10 && !Number.isInteger(n)) return n.toFixed(3);
  if (Math.abs(n) < 100) return n.toFixed(1);
  return String(n);
}

/** Higher is better for hitter career compare (Stathead-style). */
const BATTING_METRICS: { key: string; label: string; higherWins: boolean }[] = [
  { key: 'career_war', label: 'WAR', higherWins: true },
  { key: 'career_games', label: 'G', higherWins: true },
  { key: 'career_pa', label: 'PA', higherWins: true },
  { key: 'career_h', label: 'H', higherWins: true },
  { key: 'career_hr', label: 'HR', higherWins: true },
  { key: 'career_rbi', label: 'RBI', higherWins: true },
  { key: 'career_sb', label: 'SB', higherWins: true },
  { key: 'career_avg', label: 'AVG', higherWins: true },
  { key: 'career_obp', label: 'OBP', higherWins: true },
  { key: 'career_slg', label: 'SLG', higherWins: true },
];

export function CompareCareerPage() {
  const [sp] = useSearchParams();
  const idsParam = sp.get('player_ids') ?? '';
  const seasonRaw = sp.get('season');
  const season =
    seasonRaw != null && Number.isFinite(Number.parseInt(seasonRaw, 10)) && Number.parseInt(seasonRaw, 10) > 0
      ? Number.parseInt(seasonRaw, 10)
      : null;

  const ids = useMemo(
    () =>
      idsParam
        .split(',')
        .map((s) => Number.parseInt(s.trim(), 10))
        .filter((n) => Number.isInteger(n) && n > 0),
    [idsParam],
  );

  const pair = useMemo((): readonly [number, number] | null => {
    if (ids.length < 2) return null;
    return [ids[0]!, ids[1]!];
  }, [ids]);

  const { data: payload, isError, error } = useCompareFgCareerQuery({
    playerIds: pair,
    season,
    enabled: pair != null,
  });

  const err =
    ids.length < 2
      ? 'Pass at least two player_ids (comma-separated), e.g. ?player_ids=1,2'
      : isError
        ? error instanceof Error
          ? error.message
          : 'Request failed'
        : null;

  const players = (payload?.players as PlayerRow[] | undefined) ?? [];
  const careers =
    (payload?.batting_careers as { player_id: number; career: Record<string, unknown> | null }[] | undefined) ?? [];

  const byId = useMemo(() => {
    const m = new Map<number, Record<string, unknown> | null>();
    for (const c of careers) m.set(c.player_id, c.career);
    return m;
  }, [careers]);

  return (
    <Container maxWidth="md" sx={{ py: 3 }}>
      <Button component={Link} to="/" sx={{ mb: 2 }}>
        ← Chat
      </Button>
      <Typography variant="h5" sx={{ fontWeight: 600, mb: 1 }}>
        Career comparison (FanGraphs)
      </Typography>
      {err && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {err}
        </Alert>
      )}
      {payload && !err && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
            Overall stats (MLB career aggregates)
          </Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell align="center">Metric</TableCell>
                {players.map((p) => (
                  <TableCell key={p.player_id} align="right">
                    {p.name_first} {p.name_last}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {BATTING_METRICS.map(({ key, label, higherWins }) => {
                const vals = players.map((p) => num(byId.get(p.player_id)?.[key]));
                const best =
                  higherWins && vals.some((v) => v != null)
                    ? Math.max(...vals.filter((v): v is number => v != null))
                    : null;
                const worst =
                  !higherWins && vals.some((v) => v != null)
                    ? Math.min(...vals.filter((v): v is number => v != null))
                    : null;
                const target = higherWins ? best : worst;
                return (
                  <TableRow key={key}>
                    <TableCell align="center" sx={{ fontWeight: 600 }}>
                      {label}
                    </TableCell>
                    {players.map((p) => {
                      const raw = byId.get(p.player_id)?.[key];
                      const v = num(raw);
                      const wins =
                        v != null && target != null && v === target && vals.filter((x) => x === v).length === 1;
                      const tieHighlight =
                        v != null && target != null && v === target && vals.filter((x) => x === v).length > 1;
                      const highlight = wins || tieHighlight;
                      return (
                        <TableCell
                          key={p.player_id}
                          align="right"
                          sx={{
                            fontWeight: highlight ? 700 : 400,
                            bgcolor: highlight ? 'rgba(76, 175, 80, 0.15)' : undefined,
                          }}
                        >
                          {fmt(raw)}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            Pitching career rows are in the API payload as <code>pitching_careers</code>; this page focuses on
            batting totals. Green highlights the leader per row (ties highlight both).
          </Typography>
        </Paper>
      )}
      <Box sx={{ mt: 2 }}>
        <Typography variant="body2" color="text.secondary">
          Example: <code>/compare/career?player_ids=1,2</code> (use your <code>dim_player.player_id</code> values).
        </Typography>
      </Box>
    </Container>
  );
}
