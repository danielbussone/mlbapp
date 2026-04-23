import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Container from '@mui/material/Container';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { Link } from 'react-router-dom';

/**
 * Static layout prototype for player cards (v0). No API calls.
 * Dev route: `/dev/cards-wireframe`
 */
export function PlayerCardWireframePreview() {
  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Button component={Link} to="/" size="small" sx={{ mb: 2 }}>
        ← Chat
      </Button>
      <Typography variant="h5" gutterBottom sx={{ fontWeight: 600 }}>
        Player card wireframes (dev only)
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Placeholder copy — layout matches docs/PLAYER_CARDS_REQUIREMENTS.md §13. Use{' '}
        <Link to="/players/mlbam/545361?season=2024&role=batting">live player card (MLBAM)</Link> with Postgres + ETL.
      </Typography>

      <Stack spacing={4}>
        <WireCard title="Hitter (example)" roleLine="Angels · 2024 · MLBAM 660271" />
        <WireCard title="Pitcher (example)" roleLine="Dodgers · 2024 · MLBAM 808967" />
      </Stack>
    </Container>
  );
}

function WireCard({ title, roleLine }: { title: string; roleLine: string }) {
  return (
    <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
      <Typography variant="subtitle1" sx={{ px: 2, py: 1, bgcolor: 'grey.100', fontWeight: 600 }}>
        {title}
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: 'minmax(280px, 1fr) minmax(320px, 1.1fr)' },
          gap: 0,
          minHeight: 280,
        }}
      >
        <Box sx={{ p: 2, borderRight: { md: 1 }, borderColor: 'divider' }}>
          <Typography variant="body2" color="text.secondary">
            LEFT — bio + FG table
          </Typography>
          <Typography variant="h6" sx={{ mt: 1 }}>
            Player Name
          </Typography>
          <Typography variant="body2" sx={{ mb: 1 }}>
            {roleLine}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
            <Chip size="small" label="Age 32" />
            <Chip size="small" color="primary" variant="outlined" label="rate_stat_qualified" />
          </Stack>
          <Paper variant="outlined" sx={{ p: 1.5, bgcolor: 'grey.50' }}>
            <Typography variant="caption" color="text.secondary">
              FanGraphs season line (typed v1 columns)
            </Typography>
            <Typography variant="body2" sx={{ mt: 1, fontFamily: 'monospace' }}>
              PA · HR · AVG / OBP / SLG · wRC+ · WAR …
            </Typography>
          </Paper>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            Optional: BBE / avg EV / avg LA strip (avoid duplicating right column)
          </Typography>
        </Box>
        <Box sx={{ p: 2, bgcolor: 'action.hover' }}>
          <Typography variant="body2" color="text.secondary">
            RIGHT — Statcast dataviz
          </Typography>
          <Box
            sx={{
              mt: 2,
              height: 200,
              borderRadius: 1,
              border: '1px dashed',
              borderColor: 'divider',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Typography variant="body2" color="text.secondary">
              Spray / zone / pitch mix / movement plot (placeholder)
            </Typography>
          </Box>
        </Box>
      </Box>
    </Paper>
  );
}
