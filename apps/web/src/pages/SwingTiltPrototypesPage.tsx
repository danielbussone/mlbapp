import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Container from '@mui/material/Container';
import Paper from '@mui/material/Paper';
import Slider from '@mui/material/Slider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import {
  SwingTiltGraphic,
  type SwingTiltFigureVariant,
} from '@/features/batting-path/BatPathMiniGraphics.js';

const VARIANTS: { id: SwingTiltFigureVariant; cardTitle: string; blurb: string }[] = [
  {
    id: 'stick',
    cardTitle: 'Stick (original)',
    blurb: 'Simple limbs, single elbow line to the hands.',
  },
  {
    id: 'mocap',
    cardTitle: 'Mocap skeleton',
    blurb: 'Segmented arms/legs and joint dots.',
  },
  {
    id: 'silhouette',
    cardTitle: 'Silhouette (contact)',
    blurb: 'Raster figure; right pose from dual-silhouette asset.',
  },
];

const STANDS: { id: 'R' | 'L'; label: string }[] = [
  { id: 'R', label: 'Right-handed (mirrored asset off)' },
  { id: 'L', label: 'Left-handed (mirrored tile)' },
];

/**
 * Compare `SwingTiltGraphic` figure styles with shared tilt / league; RHB + LHB rows.
 * Dev route: `/dev/swing-tilt-prototypes`
 */
export function SwingTiltPrototypesPage() {
  const [tilt, setTilt] = useState(37);
  const [league, setLeague] = useState(28);

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Button component={Link} to="/" size="small" sx={{ mb: 2 }}>
        ← Chat
      </Button>
      <Typography variant="h5" gutterBottom>
        Swing tilt — figure variants
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, maxWidth: 720 }}>
        Same geometry (player tilt, league reference) across three body styles. Two rows exercise RHB vs LHB mirroring
        (silhouette raster mask nudge flips with stand). Adjust sliders for both rows at once.
      </Typography>

      <Paper variant="outlined" sx={{ p: 2, mb: 3, maxWidth: 560 }}>
        <Stack spacing={2}>
          <Box>
            <Typography variant="caption" color="text.secondary">
              Player swing-path tilt (°)
            </Typography>
            <Slider
              value={tilt}
              onChange={(_, v) => setTilt(v as number)}
              min={0}
              max={75}
              valueLabelDisplay="auto"
              size="small"
            />
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              League avg tilt (°)
            </Typography>
            <Slider
              value={league}
              onChange={(_, v) => setLeague(v as number)}
              min={0}
              max={75}
              valueLabelDisplay="auto"
              size="small"
            />
          </Box>
        </Stack>
      </Paper>

      <Stack spacing={4}>
        {STANDS.map((stand) => (
          <Box key={stand.id}>
            <Typography variant="subtitle1" sx={{ mb: 1.5 }}>
              {stand.label}
            </Typography>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' },
                gap: 2,
                alignItems: 'start',
              }}
            >
              {VARIANTS.map((v) => (
                <Box key={v.id}>
                  <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 0.5 }}>
                    {v.blurb}
                  </Typography>
                  <SwingTiltGraphic
                    tiltDeg={tilt}
                    leagueDeg={league}
                    batterStand={stand.id}
                    figureVariant={v.id}
                    cardTitle={`${v.cardTitle} (${stand.id})`}
                  />
                </Box>
              ))}
            </Box>
          </Box>
        ))}
      </Stack>
    </Container>
  );
}
