import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Container from '@mui/material/Container';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { CARD_SEASON_YEAR_MAX, getDefaultCardSeasonYear } from '@/lib/cardSeasonYear.js';
import { PitchMixHandednessPlot } from '@/features/pitch-mix/PitchMixHandednessPlot.js';
import { PitchMixRatesTable } from '@/features/pitch-mix/PitchMixRatesTable.js';
import { PitchMixVeloTable } from '@/features/pitch-mix/PitchMixVeloTable.js';
import {
  parseStatcastSummaryPayload,
  type StatcastJsonRow,
  type StatcastSummaryPayload,
} from '@/lib/statcastSummaryPayload.js';

const MIN_USAGE_PCT = 1;

function mixUsagePct(row: StatcastJsonRow): number {
  const raw = row.pct;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const n = Number.parseFloat(raw.trim().replace(/%$/, ''));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function filterMixRowsMinPct(rows: StatcastJsonRow[] | undefined, minPct: number): StatcastJsonRow[] {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const f = rows.filter((r) => mixUsagePct(r) >= minPct);
  return f.length > 0 ? f : rows;
}

export function PlayerPitchMixSupplementPage() {
  const { playerId: playerIdParam } = useParams<{ playerId: string }>();
  const [searchParams] = useSearchParams();

  const playerId = useMemo(() => {
    const raw = playerIdParam?.trim() ?? '';
    if (raw === '' || !/^\d+$/.test(raw)) return null;
    const n = Number(raw);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  }, [playerIdParam]);

  const season = useMemo(() => {
    const raw = searchParams.get('season');
    const n = raw != null && raw !== '' ? Number(raw) : getDefaultCardSeasonYear();
    if (!Number.isInteger(n) || n < 1900) return getDefaultCardSeasonYear();
    return Math.min(CARD_SEASON_YEAR_MAX, n);
  }, [searchParams]);

  const [playerName, setPlayerName] = useState<string | null>(null);
  const [statcast, setStatcast] = useState<StatcastSummaryPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (playerId == null) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setErr(null);
      try {
        const [pr, sr] = await Promise.all([
          fetch(`/api/players/${playerId}`),
          fetch(
            `/api/players/${playerId}/statcast-summary?role=pitcher&game_year=${season}&limit=4000&enhanced=1`
          ),
        ]);
        const pj = (await pr.json()) as {
          name_first?: string;
          name_last?: string;
          error?: string;
        };
        const sj = (await sr.json()) as { error?: string } & Record<string, unknown>;
        if (cancelled) return;
        const pe = !pr.ok ? (pj.error ?? String(pr.status)) : null;
        const se = !sr.ok ? (sj.error ?? String(sr.status)) : null;
        let errOut = pe ?? se;
        if (pr.ok) {
          const fn = pj.name_first ?? '';
          const ln = pj.name_last ?? '';
          setPlayerName(`${fn} ${ln}`.trim() || null);
        } else {
          setPlayerName(null);
        }
        if (sr.ok) {
          const parsed = parseStatcastSummaryPayload(sj);
          if (parsed.ok) setStatcast(parsed.value);
          else {
            setStatcast(null);
            errOut = errOut ? `${errOut}; ${parsed.error}` : parsed.error;
          }
        } else setStatcast(null);
        setErr(errOut);
      } catch {
        if (!cancelled) setErr('network');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [playerId, season]);

  const mixExt = useMemo(
    () => filterMixRowsMinPct(statcast?.mix_extended, MIN_USAGE_PCT),
    [statcast?.mix_extended]
  );
  const mixByStand = useMemo(() => {
    const rows = statcast?.mix_extended_by_stand;
    if (!Array.isArray(rows) || rows.length === 0) return [];
    const keep = new Set(mixExt.map((r) => String(r.pitch_type ?? '').trim().toUpperCase()));
    if (keep.size === 0) return rows;
    return rows.filter((r) => keep.has(String(r.pitch_type ?? '').trim().toUpperCase()));
  }, [statcast?.mix_extended_by_stand, mixExt]);

  const mixForVelo = useMemo(
    () => filterMixRowsMinPct(statcast?.mix, MIN_USAGE_PCT),
    [statcast?.mix]
  );
  const veloDist = statcast?.velo_dist;
  const showVeloHandCombo =
    Array.isArray(veloDist) &&
    veloDist.length > 0 &&
    mixForVelo.length > 0 &&
    mixByStand.length > 0;

  if (playerId == null) {
    return (
      <Container maxWidth="md" sx={{ py: 4 }}>
        <Typography>Invalid player id.</Typography>
        <Button component={Link} to="/">
          ← Chat
        </Button>
      </Container>
    );
  }

  const available = statcast?.statcast_available === true;

  return (
    <Container maxWidth="md" sx={{ py: 3 }}>
      <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }} flexWrap="wrap">
        <Button
          component={Link}
          to={`/players/${playerId}?season=${season}&role=pitching`}
          size="small"
          variant="text"
        >
          ← Player card
        </Button>
        <Typography variant="h6" sx={{ fontWeight: 600 }}>
          Pitch usage & process rates
        </Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {playerName != null ? `${playerName} · ` : ''}Player #{playerId} · season {season}
      </Typography>
      {loading && <Typography color="text.secondary">Loading…</Typography>}
      {err != null && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {err}
        </Alert>
      )}
      {!loading && statcast && !available && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {String(statcast.reason ?? 'No Statcast pitcher data for this season.')}
        </Alert>
      )}
      {!loading && available && (
        <Stack spacing={2}>
          <Box sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 1, bgcolor: 'background.paper' }}>
            {showVeloHandCombo ? (
              <>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                  {season} pitch mix & velocity
                </Typography>
                <PitchMixVeloTable
                  mix={mixForVelo}
                  veloRows={veloDist}
                  byStandRows={mixByStand}
                  leagueAvgVeloByPitch={statcast.league_avg_velo_by_pitch}
                />
              </>
            ) : (
              <PitchMixHandednessPlot
                title={`${season} pitch usage`}
                byStandRows={mixByStand}
                overallMixRows={mixExt.length > 0 ? mixExt : (statcast.mix ?? [])}
              />
            )}
          </Box>
          {mixExt.length > 0 && (
            <Box sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 1, bgcolor: 'background.paper' }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                Process rates (Statcast)
              </Typography>
              <PitchMixRatesTable rows={mixExt} />
            </Box>
          )}
          <Button
            component={Link}
            size="small"
            variant="text"
            to={`/players/${playerId}/trends?metric=pitch_mix&role=pitching&to=${season}&from=${Math.max(2015, season - 7)}`}
            sx={{ alignSelf: 'flex-start' }}
          >
            Career pitch-mix trends →
          </Button>
        </Stack>
      )}
    </Container>
  );
}
