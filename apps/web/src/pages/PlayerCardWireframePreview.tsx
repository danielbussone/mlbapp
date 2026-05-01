import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Container from '@mui/material/Container';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { Link } from 'react-router-dom';
import styles from './PlayerCardWireframePreview.module.css';

/**
 * Static layout prototype for player cards (v0). No API calls.
 * Dev route: `/dev/cards-wireframe`
 */
export function PlayerCardWireframePreview() {
  return (
    <Container maxWidth="lg" className={styles.container}>
      <Button component={Link} to="/" size="small" className={styles.backLink}>
        ← Chat
      </Button>
      <Typography variant="h5" gutterBottom className={styles.pageTitle}>
        Player card wireframes (dev only)
      </Typography>
      <Typography variant="body2" color="text.secondary" className={styles.intro}>
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
    <Paper variant="outlined" className={styles.wirePaper}>
      <Typography variant="subtitle1" className={styles.wireHeader}>
        {title}
      </Typography>
      <Box className={styles.wireGrid}>
        <Box className={styles.wireLeft}>
          <Typography variant="body2" color="text.secondary">
            LEFT — bio + FG table
          </Typography>
          <Typography variant="h6" className={styles.nameBlock}>
            Player Name
          </Typography>
          <Typography variant="body2" className={styles.roleLine}>
            {roleLine}
          </Typography>
          <Stack direction="row" spacing={1} className={styles.chipRow}>
            <Chip size="small" label="Age 32" />
            <Chip size="small" color="primary" variant="outlined" label="rate_stat_qualified" />
          </Stack>
          <Paper variant="outlined" className={styles.fgPlaceholder}>
            <Typography variant="caption" color="text.secondary">
              FanGraphs season line (typed v1 columns)
            </Typography>
            <Typography variant="body2" className={styles.fgMono}>
              PA · HR · AVG / OBP / SLG · wRC+ · WAR …
            </Typography>
          </Paper>
          <Typography variant="caption" color="text.secondary" className={styles.wireCaption}>
            Optional: BBE / avg EV / avg LA strip (avoid duplicating right column)
          </Typography>
        </Box>
        <Box className={styles.wireRight}>
          <Typography variant="body2" color="text.secondary">
            RIGHT — Statcast dataviz
          </Typography>
          <Box className={styles.placeholderPlot}>
            <Typography variant="body2" color="text.secondary">
              Spray / zone / pitch mix / movement plot (placeholder)
            </Typography>
          </Box>
        </Box>
      </Box>
    </Paper>
  );
}
