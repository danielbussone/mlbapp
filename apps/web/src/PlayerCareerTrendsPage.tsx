import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Container from '@mui/material/Container';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useMemo } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { BatSpeedSeasonSpark } from './BatSpeedSeasonSpark.js';
import { CARD_SEASON_YEAR_MAX, getDefaultCardSeasonYear } from './cardSeasonYear.js';
import { PitchMixCareerTrendSpark } from './PitchMixCareerTrendSpark.js';

/** Multi-year Statcast / FG trends (bat path + pitcher pitch mix). */
export function PlayerCareerTrendsPage() {
  const { playerId: playerIdParam } = useParams<{ playerId: string }>();
  const [searchParams] = useSearchParams();

  const playerId = useMemo(() => {
    const raw = playerIdParam?.trim() ?? '';
    if (raw === '' || !/^\d+$/.test(raw)) return null;
    const n = Number(raw);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  }, [playerIdParam]);

  const toYear = useMemo(() => {
    const raw = searchParams.get('to');
    const n = raw != null && raw !== '' ? Number(raw) : getDefaultCardSeasonYear();
    if (!Number.isInteger(n) || n < 1900) return getDefaultCardSeasonYear();
    return Math.min(CARD_SEASON_YEAR_MAX, n);
  }, [searchParams]);

  const fromYear = useMemo(() => {
    const raw = searchParams.get('from');
    const n = raw != null && raw !== '' ? Number(raw) : toYear - 7;
    if (!Number.isInteger(n) || n < 1900) return Math.max(2015, toYear - 7);
    return Math.min(n, toYear);
  }, [searchParams, toYear]);

  const metric = searchParams.get('metric') === 'pitch_mix' ? 'pitch_mix' : 'bat_path';
  const cardRole = metric === 'pitch_mix' ? 'pitching' : 'batting';

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

  return (
    <Container maxWidth="md" sx={{ py: 3 }}>
      <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }} flexWrap="wrap">
        <Button
          component={Link}
          to={`/players/${playerId}?season=${toYear}&role=${cardRole}`}
          size="small"
          variant="text"
        >
          ← Player card
        </Button>
        <Typography variant="h6" sx={{ fontWeight: 600 }}>
          Career trends
        </Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Player #{playerId} · seasons {fromYear}–{toYear}.
        {metric === 'pitch_mix'
          ? ' Pitch-type usage % from Statcast by season.'
          : ' Expand with WAR, wRC+, EV, EV90, OAA, ERA, FIP, K%, BB% once timeseries endpoints land.'}
      </Typography>
      {metric === 'bat_path' && (
        <Box sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 1, bgcolor: 'background.paper' }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
            Bat tracking (Hawk-Eye)
          </Typography>
          <BatSpeedSeasonSpark playerId={playerId} season={toYear} fromYear={fromYear} showLeagueAxis />
        </Box>
      )}
      {metric === 'pitch_mix' && (
        <Box sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 1, bgcolor: 'background.paper' }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
            Pitch mix (Statcast)
          </Typography>
          <PitchMixCareerTrendSpark playerId={playerId} season={toYear} fromYear={fromYear} />
        </Box>
      )}
    </Container>
  );
}
