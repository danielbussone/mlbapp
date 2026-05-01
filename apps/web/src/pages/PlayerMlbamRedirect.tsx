import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { getDefaultCardSeasonYear } from '@/lib/cardSeasonYear.js';
import styles from './PlayerMlbamRedirect.module.css';

/**
 * `/players/mlbam/:mlbam` — resolves MLBAM → `dim_player.player_id` via API, then redirects.
 */
export function PlayerMlbamRedirect() {
  const { mlbam: mlbamParam } = useParams<{ mlbam: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const raw = mlbamParam?.trim() ?? '';
    if (!/^\d+$/.test(raw)) {
      setError(`Invalid MLBAM in URL: “${mlbamParam ?? ''}”.`);
      return;
    }
    const key_mlbam = Number(raw);
    let cancelled = false;
    setError(null);
    void (async () => {
      try {
        const res = await fetch(`/api/players/lookup?key_mlbam=${key_mlbam}`);
        const j: unknown = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          const msg =
            res.status === 404
              ? `No player in the database for MLBAM ${key_mlbam}.`
              : res.status === 409
                ? 'Multiple matches for this MLBAM (rare). Use chat resolve_player or SQL for player_id.'
                : typeof (j as { error?: string }).error === 'string'
                  ? (j as { error: string }).error
                  : `Lookup failed (${res.status})`;
          setError(msg);
          return;
        }
        const pid = (j as { player_id?: unknown }).player_id;
        const id = typeof pid === 'number' ? pid : Number(pid);
        if (!Number.isFinite(id) || id < 1) {
          setError('Lookup returned an unexpected payload.');
          return;
        }
        const qs = searchParams.toString();
        navigate(`/players/${id}${qs ? `?${qs}` : ''}`, { replace: true });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mlbamParam, navigate, searchParams]);

  const exampleSeason = getDefaultCardSeasonYear();

  if (error) {
    return (
      <Box className={styles.errorWrap}>
        <Alert severity="error" className={styles.alertSpacing}>
          {error}
        </Alert>
        <Typography variant="body2" color="text.secondary" className={styles.helpText}>
          Path must be <code>/players/mlbam/&lt;number&gt;</code> (MLB Advanced Media id), not FanGraphs id. Example:{' '}
          <Link to={`/players/mlbam/545361?season=${exampleSeason}&role=batting`}>Mike Trout (545361)</Link>.
        </Typography>
        <Button component={Link} to="/">
          ← Chat
        </Button>
      </Box>
    );
  }

  return (
    <Box className={styles.loadingRow}>
      <CircularProgress size={24} />
      <Typography color="text.secondary">Resolving MLBAM…</Typography>
    </Box>
  );
}
