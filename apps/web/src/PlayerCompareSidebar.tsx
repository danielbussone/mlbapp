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
import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
function fmt(v: unknown): string {
  if (v == null || v === '') return '—';
  const n = typeof v === 'number' ? v : Number(v);
  if (Number.isFinite(n)) {
    if (Math.abs(n) < 10 && !Number.isInteger(n)) return n.toFixed(3);
    return String(n);
  }
  return String(v);
}

export function PlayerCompareSidebar({
  playerIds,
  mode,
  gameYear,
  onClose,
}: {
  playerIds: [number, number];
  mode: 'career' | 'statcast';
  gameYear: number;
  onClose: () => void;
}) {
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const q = new URLSearchParams({ player_ids: `${playerIds[0]},${playerIds[1]}` });
        const path =
          mode === 'career'
            ? `/api/players/compare/fg-career?${q}`
            : `/api/players/compare/statcast-summary?${q}&role=pitcher&game_year=${gameYear}`;
        const r = await fetch(path);
        const j = (await r.json()) as Record<string, unknown>;
        if (cancelled) return;
        if (!r.ok) {
          setErr(String(j.error ?? r.status));
          setPayload(null);
          return;
        }
        setErr(null);
        setPayload(j);
      } catch {
        if (!cancelled) setErr('Network error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [playerIds, mode, gameYear]);

  const players = (payload?.players as Record<string, unknown>[] | undefined) ?? [];

  return (
    <Paper variant="outlined" sx={{ p: 1.5, position: 'relative', maxHeight: '92vh', overflow: 'auto' }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
          {mode === 'career' ? 'Career compare' : 'Statcast compare'}
        </Typography>
        <IconButton size="small" aria-label="Close" onClick={onClose}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Stack>
      {err && (
        <Typography color="error" variant="caption" sx={{ display: 'block', mb: 1 }}>
          {err}
        </Typography>
      )}
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        {players.map((p) => `${p.name_first} ${p.name_last}`).join(' vs ')}
        {mode === 'statcast' && ` · ${gameYear}`}
      </Typography>
      {mode === 'career' && payload && Array.isArray(payload.batting_careers) && (
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
                <TableCell sx={{ textTransform: 'uppercase', fontSize: '0.65rem' }}>{k.replace('career_', '')}</TableCell>
                {(payload.batting_careers as { player_id: number; career: Record<string, unknown> | null }[]).map(
                  (c) => (
                    <TableCell key={c.player_id} align="right">
                      {fmt(c.career?.[k])}
                    </TableCell>
                  )
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
                <Typography variant="caption" sx={{ fontWeight: 600 }}>
                  {String(pl?.name_last ?? pid)}
                </Typography>
                <Typography variant="caption" display="block" color="text.secondary">
                  Pitches:{' '}
                  {Array.isArray(s.mix)
                    ? (s.mix as Record<string, unknown>[]).reduce(
                        (acc, r) => acc + Number(r.pitches ?? 0),
                        0
                      )
                    : 0}
                </Typography>
              </Box>
            );
          })}
        </Stack>
      )}
      <Box sx={{ mt: 1.5 }}>
        <Button
          component={RouterLink}
          to={
            mode === 'career'
              ? `/compare/career?player_ids=${playerIds[0]},${playerIds[1]}`
              : `/compare/statcast?player_ids=${playerIds[0]},${playerIds[1]}&role=pitcher&game_year=${gameYear}`
          }
          size="small"
          variant="outlined"
          fullWidth
        >
          Open full page
        </Button>
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
        Statcast sidebar compare defaults to <strong>pitcher</strong> role; use the full page to pick batter.
      </Typography>
    </Paper>
  );
}
