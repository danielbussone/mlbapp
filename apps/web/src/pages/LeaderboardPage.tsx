import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import Button from '@mui/material/Button';
import Container from '@mui/material/Container';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { leaderboardAttachmentSchema, type LeaderboardAttachment } from '@mlbapp/shared';
import { useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChatLeaderboardPanel } from '@/features/leaderboard/ChatLeaderboardPanel.js';

export function LeaderboardPage() {
  const location = useLocation();

  const attachment = useMemo((): LeaderboardAttachment | null => {
    const raw = (location.state as { leaderboard?: unknown } | null)?.leaderboard;
    const p = leaderboardAttachmentSchema.safeParse(raw);
    return p.success ? p.data : null;
  }, [location.state]);

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 2 }}>
        <Button startIcon={<ArrowBackIcon />} component={Link} to="/" variant="outlined" size="small">
          Back to chat
        </Button>
        <Typography variant="h5" component="h1">
          Leaderboard
        </Typography>
      </Stack>
      {attachment ? (
        <ChatLeaderboardPanel attachment={attachment} />
      ) : (
        <Typography color="text.secondary">
          No leaderboard loaded. Run a ranking question in chat, then use <strong>Full screen</strong> on the table.
        </Typography>
      )}
    </Container>
  );
}
