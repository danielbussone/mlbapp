import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Container from '@mui/material/Container';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useCompareStatcastSummaryQuery } from '@/api/compareQueries.js';
import { MovementMiniPlot, pitchTypeMovementColor } from '@/features/movement-velo/MovementMiniPlot.js';
import { pitchTypeName } from '@/features/pitch-mix/pitchTypeLabels.js';

export function CompareStatcastPage() {
  const [sp] = useSearchParams();
  const idsParam = sp.get('player_ids') ?? '';
  const role = (sp.get('role') === 'batter' ? 'batter' : 'pitcher') as 'pitcher' | 'batter';
  const year = Number.parseInt(sp.get('game_year') ?? '', 10);

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

  const { data: payload, isError, error } = useCompareStatcastSummaryQuery({
    playerIds: pair,
    role,
    gameYear: year,
    enabled: pair != null && Number.isFinite(year),
  });

  const err =
    ids.length < 2 || !Number.isFinite(year)
      ? 'Need player_ids=1,2 and game_year=2024 (and optional role=pitcher|batter).'
      : isError
        ? error instanceof Error
          ? error.message
          : 'Request failed'
        : null;

  const players = (payload?.players as Record<string, unknown>[] | undefined) ?? [];
  const summaries = (payload?.summaries as Record<string, unknown>[] | undefined) ?? [];

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Button component={Link} to="/" sx={{ mb: 2 }}>
        ← Chat
      </Button>
      <Typography variant="h5" sx={{ fontWeight: 600, mb: 1 }}>
        Statcast comparison — {role} — {Number.isFinite(year) ? year : '—'}
      </Typography>
      {err && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {err}
        </Alert>
      )}
      {payload && !err && (
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="flex-start">
          {summaries.map((s, idx) => {
            const name =
              players.find((p) => p.player_id === s.player_id) ??
              ({ name_first: '?', name_last: '?' } as Record<string, unknown>);
            const mix = s.mix as Record<string, unknown>[] | undefined;
            const sample = s.sample as Record<string, unknown>[] | undefined;
            return (
              <Paper key={idx} variant="outlined" sx={{ flex: 1, minWidth: 0, p: 2, width: '100%' }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
                  {String(name.name_first)} {String(name.name_last)}
                </Typography>
                {s.statcast_available === false && (
                  <Typography color="text.secondary" variant="body2">
                    {String(s.reason ?? 'No data')}
                  </Typography>
                )}
                {role === 'pitcher' && Array.isArray(mix) && mix.length > 0 && (
                  <Table size="small" sx={{ mb: 1 }}>
                    <TableHead>
                      <TableRow>
                        <TableCell>Pitch</TableCell>
                        <TableCell align="right">%</TableCell>
                        <TableCell align="right">Velo</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {mix.map((row, i) => {
                        const pt = String(row.pitch_type ?? '');
                        return (
                          <TableRow key={i}>
                            <TableCell>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                <Box
                                  sx={{
                                    width: 18,
                                    height: 8,
                                    borderRadius: 99,
                                    bgcolor: pitchTypeMovementColor(pt),
                                    border: 1,
                                    borderColor: 'divider',
                                  }}
                                />
                                <Typography variant="body2">{pitchTypeName(pt)}</Typography>
                              </Box>
                            </TableCell>
                            <TableCell align="right">{String(row.pct ?? '')}</TableCell>
                            <TableCell align="right">{String(row.avg_velo ?? '')}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
                {role === 'pitcher' && Array.isArray(sample) && sample.length > 0 && (
                  <MovementMiniPlot rows={sample} />
                )}
                {role === 'batter' && (
                  <Typography variant="body2" color="text.secondary">
                    BBE {String((s.batted_ball as Record<string, unknown> | undefined)?.bbe ?? '—')} · Sample spray
                    pitches: {Array.isArray(sample) ? sample.length : 0}
                  </Typography>
                )}
              </Paper>
            );
          })}
        </Stack>
      )}
    </Container>
  );
}
