import SendIcon from '@mui/icons-material/Send';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Container from '@mui/material/Container';
import LinearProgress from '@mui/material/LinearProgress';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useCallback, useEffect, useState } from 'react';
import { healthResponseSchema } from '@mlbapp/shared';
import { getDefaultCardSeasonYear } from './cardSeasonYear.js';
import { extractCompareChatIntent, extractPlayerCardChatIntent } from './chatPlayerQuery.js';
import { PlayerCardPanel } from './PlayerCardPanel.js';
import { PlayerCompareSidebar } from './PlayerCompareSidebar.js';
import { consumeSse } from './sse.js';

type ChatRole = 'user' | 'assistant';

interface ChatLine {
  role: ChatRole;
  text: string;
}

export function App() {
  const [apiOk, setApiOk] = useState<boolean | null>(null);
  const [input, setInput] = useState('');
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Chat phrasing matched {@link extractPlayerCardChatIntent}; show card beside thread. */
  const [sidebarPlayerId, setSidebarPlayerId] = useState<number | null>(null);
  const [sidebarExplicitSeason, setSidebarExplicitSeason] = useState<number | null>(null);
  const [sidebarResolveError, setSidebarResolveError] = useState<string | null>(null);
  /** Two-player compare sidebar (FanGraphs career or Statcast). */
  const [compareIds, setCompareIds] = useState<[number, number] | null>(null);
  const [compareMode, setCompareMode] = useState<'career' | 'statcast'>('career');
  const [compareYear, setCompareYear] = useState(() => getDefaultCardSeasonYear());

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch('/api/health');
        const j: unknown = await r.json();
        const p = healthResponseSchema.safeParse(j);
        setApiOk(p.success);
      } catch {
        setApiOk(false);
      }
    })();
  }, []);

  const send = useCallback(async () => {
    const msg = input.trim();
    if (!msg || streaming) return;
    setError(null);
    const cmp = extractCompareChatIntent(msg);
    if (cmp) {
      setSidebarPlayerId(null);
      setSidebarExplicitSeason(null);
      setCompareIds(null);
      setSidebarResolveError(null);
      void (async () => {
        try {
          const resolveName = async (nameQuery: string) => {
            const q = new URLSearchParams({ name_query: nameQuery });
            const r = await fetch(`/api/players/named?${q.toString()}`);
            const j: unknown = await r.json().catch(() => null);
            const rec = j && typeof j === 'object' ? (j as Record<string, unknown>) : {};
            const pid = rec.player_id;
            if (r.ok && typeof pid === 'number' && Number.isFinite(pid)) return Math.trunc(pid);
            const err =
              typeof rec.error === 'string'
                ? rec.error
                : !r.ok
                  ? `Player lookup failed (${r.status})`
                  : 'Player lookup failed';
            throw new Error(err);
          };
          const a = await resolveName(cmp.playerAQuery);
          const b = await resolveName(cmp.playerBQuery);
          setCompareMode(cmp.mode);
          setCompareYear(cmp.explicitSeason ?? getDefaultCardSeasonYear());
          setCompareIds([a, b]);
          setSidebarResolveError(null);
        } catch (e) {
          setCompareIds(null);
          setSidebarResolveError(e instanceof Error ? e.message : 'Compare lookup failed');
        }
      })();
    } else {
      setCompareIds(null);
      const cardIntent = extractPlayerCardChatIntent(msg);
      if (!cardIntent) {
        setSidebarPlayerId(null);
        setSidebarExplicitSeason(null);
        setSidebarResolveError(null);
      } else {
        setSidebarResolveError(null);
        void (async () => {
          try {
            const q = new URLSearchParams({ name_query: cardIntent.nameQuery });
            const r = await fetch(`/api/players/named?${q.toString()}`);
            const j: unknown = await r.json().catch(() => null);
            const rec = j && typeof j === 'object' ? (j as Record<string, unknown>) : {};
            const pid = rec.player_id;
            if (r.ok && typeof pid === 'number' && Number.isFinite(pid)) {
              setSidebarPlayerId(Math.trunc(pid));
              setSidebarExplicitSeason(cardIntent.explicitSeason);
              setSidebarResolveError(null);
            } else {
              setSidebarPlayerId(null);
              setSidebarExplicitSeason(null);
              const err =
                typeof rec.error === 'string'
                  ? rec.error
                  : !r.ok
                    ? `Player lookup failed (${r.status})`
                    : 'Player lookup failed';
              setSidebarResolveError(err);
            }
          } catch {
            setSidebarPlayerId(null);
            setSidebarExplicitSeason(null);
            setSidebarResolveError('Player lookup failed (network)');
          }
        })();
      }
    }

    setLines((prev) => [...prev, { role: 'user', text: msg }]);
    setStreaming(true);
    let assistant = '';

    setLines((prev) => [...prev, { role: 'assistant', text: '' }]);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg }),
      });
      const sse = res.headers.get('content-type')?.includes('text/event-stream');
      if (!res.ok && !sse) {
        const t = await res.text();
        throw new Error(t || res.statusText);
      }

      await consumeSse(res, (event, data) => {
        if (event === 'token' && data && typeof data === 'object' && 'text' in data) {
          const piece = String((data as { text: string }).text);
          assistant += piece;
          setLines((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last?.role === 'assistant') next[next.length - 1] = { role: 'assistant', text: assistant };
            return next;
          });
        } else if (event === 'error' && data && typeof data === 'object' && 'message' in data) {
          setError(String((data as { message: string }).message));
        }
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLines((prev) => prev.slice(0, -1));
    } finally {
      setStreaming(false);
    }
  }, [input, streaming]);

  const defaultCardSeason =
    sidebarExplicitSeason ?? getDefaultCardSeasonYear();

  return (
    <Container maxWidth={sidebarPlayerId != null || compareIds != null ? false : 'md'} sx={{ py: 4 }}>
      <Typography variant="h4" component="h1" gutterBottom sx={{ fontWeight: 600 }}>
        mlbapp
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Local baseball chat — SSE streaming from first boot. Start Postgres + Ollama with{' '}
        <code>docker compose up -d db ollama</code>, pull a model, then chat. Ask “Tell me about …” or “Who is …” to
        open the player card beside the thread.
      </Typography>

      <Box sx={{ mb: 2, display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="body2">API</Typography>
        {apiOk === null && <Chip size="small" label="checking…" />}
        {apiOk === true && <Chip size="small" color="success" label="healthy" />}
        {apiOk === false && <Chip size="small" color="error" label="down" />}
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {sidebarResolveError && (
        <Alert severity="warning" sx={{ mb: 2 }} onClose={() => setSidebarResolveError(null)}>
          {sidebarResolveError}
        </Alert>
      )}

      <Box
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column', lg: 'row' },
          gap: 2,
          alignItems: 'flex-start',
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0, width: '100%' }}>
          <Paper variant="outlined" sx={{ p: 2, mb: 2, minHeight: 240, bgcolor: 'grey.50' }}>
            {lines.length === 0 ? (
              <Typography color="text.secondary">Messages appear here.</Typography>
            ) : (
              lines.map((line, i) => (
                <Box key={i} sx={{ mb: 1.5 }}>
                  <Typography variant="caption" color="text.secondary">
                    {line.role === 'user' ? 'You' : 'Assistant'}
                  </Typography>
                  <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>
                    {line.text || (streaming && i === lines.length - 1 ? '…' : '')}
                  </Typography>
                </Box>
              ))
            )}
            {streaming && <LinearProgress sx={{ mt: 1 }} />}
          </Paper>

          <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
            <TextField
              fullWidth
              multiline
              minRows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send();
              }}
              placeholder="Ask about players or stats…"
              disabled={streaming}
            />
            <Button
              variant="contained"
              endIcon={<SendIcon />}
              onClick={() => void send()}
              disabled={streaming || !input.trim()}
              sx={{ minWidth: 120, height: 56 }}
            >
              Send
            </Button>
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            Cmd/Ctrl+Enter to send
          </Typography>
        </Box>

        {compareIds != null && (
          <Box
            sx={{
              flex: 1,
              minWidth: 0,
              width: '100%',
              position: { lg: 'sticky' },
              top: { lg: 16 },
              alignSelf: 'stretch',
            }}
          >
            <PlayerCompareSidebar
              playerIds={compareIds}
              mode={compareMode}
              gameYear={compareYear}
              onClose={() => {
                setCompareIds(null);
                setSidebarResolveError(null);
              }}
            />
          </Box>
        )}
        {sidebarPlayerId != null && compareIds == null && (
          <Box
            sx={{
              flex: 1,
              minWidth: 0,
              width: '100%',
              position: { lg: 'sticky' },
              top: { lg: 16 },
              alignSelf: 'stretch',
            }}
          >
            <PlayerCardPanel
              key={sidebarPlayerId}
              playerId={sidebarPlayerId}
              variant="sidebar"
              defaultSeason={defaultCardSeason}
              autoFallbackLatestSeasonIfEmpty={sidebarExplicitSeason == null}
              onClose={() => {
                setSidebarPlayerId(null);
                setSidebarExplicitSeason(null);
                setSidebarResolveError(null);
              }}
            />
          </Box>
        )}
      </Box>
    </Container>
  );
}
