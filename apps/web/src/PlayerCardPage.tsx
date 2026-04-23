import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Container from '@mui/material/Container';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { CARD_SEASON_YEAR_MAX, getDefaultCardSeasonYear } from './cardSeasonYear.js';
import { inferPrimaryCardRole } from './playerCardPrimaryRole.js';
import { fetchFgRoleHint } from './playerFgRoleHint.js';
import type { CardRole } from './PlayerCardPanel.js';
import { PlayerCardPanel } from './PlayerCardPanel.js';

function parseCardRole(s: string | null): CardRole {
  return s === 'pitching' ? 'pitching' : 'batting';
}

export function PlayerCardPage() {
  const { playerId: playerIdParam } = useParams<{ playerId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const playerId = useMemo(() => {
    const raw = playerIdParam?.trim() ?? '';
    if (raw === '' || !/^\d+$/.test(raw)) return null;
    const n = Number(raw);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  }, [playerIdParam]);

  const seasonParamPresent = useMemo(() => searchParams.has('season'), [searchParams]);

  const season = useMemo(() => {
    const raw = searchParams.get('season');
    if (raw == null || raw === '') return getDefaultCardSeasonYear();
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1900) return getDefaultCardSeasonYear();
    return Math.min(CARD_SEASON_YEAR_MAX, n);
  }, [searchParams]);

  const roleExplicit = useMemo(() => searchParams.has('role'), [searchParams]);
  const [inferredRole, setInferredRole] = useState<CardRole | null>(null);

  useEffect(() => {
    if (roleExplicit) {
      setInferredRole(null);
      return;
    }
    if (playerId == null) return;
    let cancelled = false;
    setInferredRole(null);
    void (async () => {
      try {
        const { batting: bat, pitching: pit } = await fetchFgRoleHint(playerId);
        if (cancelled) return;
        const next = inferPrimaryCardRole(bat, pit);
        setInferredRole(next);
        setSearchParams(
          (prev) => {
            const n = new URLSearchParams(prev);
            if (!n.has('role')) n.set('role', next);
            return n;
          },
          { replace: true }
        );
      } catch {
        if (!cancelled) {
          setInferredRole('batting');
          setSearchParams(
            (prev) => {
              const n = new URLSearchParams(prev);
              if (!n.has('role')) n.set('role', 'batting');
              return n;
            },
            { replace: true }
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [playerId, roleExplicit, setSearchParams]);

  const role = roleExplicit ? parseCardRole(searchParams.get('role')) : (inferredRole ?? 'batting');

  const setSeason = useCallback(
    (y: number) => {
      const next = new URLSearchParams(searchParams);
      next.set('season', String(y));
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  const setRole = useCallback(
    (r: CardRole) => {
      const next = new URLSearchParams(searchParams);
      next.set('role', r);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  const exampleSeason = getDefaultCardSeasonYear();

  if (playerId == null) {
    const shown = playerIdParam === undefined || playerIdParam === '' ? '(missing)' : `“${playerIdParam}”`;
    return (
      <Container maxWidth="md" sx={{ py: 4 }}>
        <Alert severity="error" sx={{ mb: 2 }}>
          Invalid player id in URL: {shown}. The first path segment after <code>/players/</code> must be your
          numeric <code>dim_player.player_id</code> (not FanGraphs id, not MLBAM unless it happens to match the
          surrogate id).
        </Alert>
        <Typography variant="body2" sx={{ mb: 2 }}>
          Use <strong>MLBAM</strong> instead:{' '}
          <Link to={`/players/mlbam/545361?season=${exampleSeason}&role=batting`}>/players/mlbam/545361</Link> (Mike
          Trout) or{' '}
          <Link to={`/players/mlbam/808967?season=${exampleSeason}&role=pitching`}>/players/mlbam/808967</Link>{' '}
          (Yoshinobu Yamamoto — season may match your Statcast load).
        </Typography>
        <Button component={Link} to="/">
          ← Chat
        </Button>
      </Container>
    );
  }

  if (!roleExplicit && inferredRole == null) {
    return (
      <Container maxWidth="lg" sx={{ py: 6 }}>
        <Stack direction="row" spacing={2} alignItems="center" justifyContent="center">
          <CircularProgress size={22} />
          <Typography color="text.secondary">Loading player card…</Typography>
        </Stack>
      </Container>
    );
  }

  return (
    <PlayerCardPanel
      key={playerId}
      playerId={playerId}
      defaultSeason={season}
      defaultRole={role}
      season={season}
      role={role}
      onSeasonChange={setSeason}
      onRoleChange={setRole}
      autoFallbackLatestSeasonIfEmpty={!seasonParamPresent}
      variant="page"
    />
  );
}
