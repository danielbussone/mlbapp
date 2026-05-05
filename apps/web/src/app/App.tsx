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
import { Link, useNavigate } from 'react-router-dom';
import {
  healthResponseSchema,
  leaderboardEventDataSchema,
  thinkingEventDataSchema,
  type LeaderboardAttachment,
} from '@mlbapp/shared';
import { getDefaultCardSeasonYear } from '@/lib/cardSeasonYear.js';
import { extractCompareChatIntent, extractPlayerCardChatIntent } from '@/lib/chatPlayerQuery.js';
import { ChatLeaderboardPanel } from '@/features/leaderboard/ChatLeaderboardPanel.js';
import { PlayerCardPanel } from '@/features/player-card/PlayerCardPanel.js';
import { PlayerCompareSidebar } from '@/features/compare/PlayerCompareSidebar.js';
import { consumeSse } from '@/lib/sse.js';
import styles from './App.module.css';

type ChatRole = 'user' | 'assistant';

interface ChatLine {
  role: ChatRole;
  text: string;
  /** Ollama `message.thinking` when OLLAMA_THINK is enabled (may span multiple SSE chunks). */
  thinking?: string;
}

type NamedPlayerCandidate = {
  player_id?: unknown;
  name_first?: unknown;
  name_last?: unknown;
  birth_date?: unknown;
  /** FanGraphs-backed line from API, e.g. “14 seasons with SEA and NYY”. */
  career_hint?: unknown;
};

function candidateDisambiguationLabel(c: NamedPlayerCandidate): string {
  const name = `${String(c.name_first ?? '').trim()} ${String(c.name_last ?? '').trim()}`.trim();
  const hint =
    typeof c.career_hint === 'string' && c.career_hint.trim() !== '' ? c.career_hint.trim() : null;
  const b = c.birth_date != null && String(c.birth_date).trim() !== '' ? `b. ${String(c.birth_date)}` : '';
  const parts = [name, hint, b].filter(Boolean);
  return parts.join(' · ');
}

function parseNamedResponse(j: unknown): Record<string, unknown> {
  return j && typeof j === 'object' ? (j as Record<string, unknown>) : {};
}

export function App() {
  const navigate = useNavigate();
  const [apiOk, setApiOk] = useState<boolean | null>(null);
  const [input, setInput] = useState('');
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Chat phrasing matched {@link extractPlayerCardChatIntent}; show card beside thread. */
  const [sidebarPlayerId, setSidebarPlayerId] = useState<number | null>(null);
  const [sidebarExplicitSeason, setSidebarExplicitSeason] = useState<number | null>(null);
  const [sidebarResolveError, setSidebarResolveError] = useState<string | null>(null);
  const [namePickCandidates, setNamePickCandidates] = useState<NamedPlayerCandidate[] | null>(null);
  const [pendingCardExplicitSeason, setPendingCardExplicitSeason] = useState<number | null>(null);
  /** Two-player compare sidebar (FanGraphs career or Statcast). */
  const [compareIds, setCompareIds] = useState<[number, number] | null>(null);
  const [compareMode, setCompareMode] = useState<'career' | 'statcast'>('career');
  const [compareYear, setCompareYear] = useState(() => getDefaultCardSeasonYear());
  /** When set with career compare, sidebar loads FanGraphs rows for this season only. */
  const [compareFgSeason, setCompareFgSeason] = useState<number | null>(null);
  const [leaderboardAttachment, setLeaderboardAttachment] = useState<LeaderboardAttachment | null>(null);

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
      setNamePickCandidates(null);
      setPendingCardExplicitSeason(null);
      setCompareFgSeason(null);
      void (async () => {
        try {
          const resolveName = async (nameQuery: string) => {
            const q = new URLSearchParams({ name_query: nameQuery });
            const r = await fetch(`/api/players/named?${q.toString()}`);
            const j: unknown = await r.json().catch(() => null);
            const rec = parseNamedResponse(j);
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
          setCompareFgSeason(cmp.explicitSeason ?? null);
          setCompareIds([a, b]);
          setSidebarResolveError(null);
        } catch (e) {
          setCompareIds(null);
          setCompareFgSeason(null);
          setSidebarResolveError(e instanceof Error ? e.message : 'Compare lookup failed');
        }
      })();
    } else {
      setCompareIds(null);
      setCompareFgSeason(null);
      const cardIntent = extractPlayerCardChatIntent(msg);
      if (!cardIntent) {
        setSidebarResolveError(null);
        setNamePickCandidates(null);
        setPendingCardExplicitSeason(null);
      } else {
        setSidebarResolveError(null);
        void (async () => {
          try {
            const q = new URLSearchParams({ name_query: cardIntent.nameQuery });
            const r = await fetch(`/api/players/named?${q.toString()}`);
            const j: unknown = await r.json().catch(() => null);
            const rec = parseNamedResponse(j);
            const pid = rec.player_id;
            if (r.ok && typeof pid === 'number' && Number.isFinite(pid)) {
              setSidebarPlayerId(Math.trunc(pid));
              setSidebarExplicitSeason(cardIntent.explicitSeason);
              setSidebarResolveError(null);
              setNamePickCandidates(null);
              setPendingCardExplicitSeason(null);
            } else if (r.status === 409) {
              const raw = rec.candidates;
              const candidates = Array.isArray(raw)
                ? (raw as NamedPlayerCandidate[]).filter(
                    (c) => c != null && typeof c === 'object' && c.player_id != null
                  )
                : [];
              if (candidates.length > 0) {
                setSidebarPlayerId(null);
                setSidebarExplicitSeason(null);
                setNamePickCandidates(candidates);
                setPendingCardExplicitSeason(cardIntent.explicitSeason);
                setSidebarResolveError(null);
              } else {
                setSidebarPlayerId(null);
                setSidebarExplicitSeason(null);
                setNamePickCandidates(null);
                setPendingCardExplicitSeason(null);
                const err =
                  typeof rec.error === 'string'
                    ? rec.error
                    : 'Multiple matches; no candidate list returned';
                setSidebarResolveError(err);
              }
            } else {
              setSidebarPlayerId(null);
              setSidebarExplicitSeason(null);
              setNamePickCandidates(null);
              setPendingCardExplicitSeason(null);
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
            setNamePickCandidates(null);
            setPendingCardExplicitSeason(null);
            setSidebarResolveError('Player lookup failed (network)');
          }
        })();
      }
    }

    setLeaderboardAttachment(null);
    setLines((prev) => [...prev, { role: 'user', text: msg }]);
    setStreaming(true);
    let assistant = '';
    let thinkingAccum = '';

    setLines((prev) => [...prev, { role: 'assistant', text: '' }]);

    const activeSeasonForChat =
      sidebarPlayerId != null ? (sidebarExplicitSeason ?? getDefaultCardSeasonYear()) : undefined;

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: msg,
          ...(sidebarPlayerId != null ? { active_player_id: sidebarPlayerId } : {}),
          ...(activeSeasonForChat != null ? { active_season: activeSeasonForChat } : {}),
        }),
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
            if (last?.role === 'assistant')
              next[next.length - 1] = {
                role: 'assistant',
                text: assistant,
                ...(thinkingAccum ? { thinking: thinkingAccum } : {}),
              };
            return next;
          });
        } else if (event === 'thinking') {
          const parsed = thinkingEventDataSchema.safeParse(data);
          if (!parsed.success) return;
          thinkingAccum += (thinkingAccum ? '\n\n---\n\n' : '') + parsed.data.text;
          setLines((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last?.role === 'assistant')
              next[next.length - 1] = {
                role: 'assistant',
                text: assistant,
                thinking: thinkingAccum,
              };
            return next;
          });
        } else if (event === 'leaderboard') {
          const p = leaderboardEventDataSchema.safeParse(data);
          if (p.success) setLeaderboardAttachment(p.data);
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
  }, [input, streaming, sidebarPlayerId, sidebarExplicitSeason]);

  const defaultCardSeason =
    sidebarExplicitSeason ?? getDefaultCardSeasonYear();

  return (
    <Container
      maxWidth={
        sidebarPlayerId != null || compareIds != null || leaderboardAttachment != null ? false : 'md'
      }
      className={styles.container}
    >
      <Typography variant="h4" component="h1" gutterBottom className={styles.title}>
        mlbapp
      </Typography>
      <Typography variant="body2" color="text.secondary" className={styles.intro}>
        Local baseball chat — SSE streaming from first boot. Start Postgres + Ollama with{' '}
        <code>docker compose up -d db ollama</code>, pull a model, then chat.         Type a player name, “Tell me about …”,
        “Talk about …”, or “Who is …” to open the player card on the right; ranking tables from chat appear there too.
        {import.meta.env.DEV && (
          <>
            {' '}
            <Link to="/dev/frv-prototype">FRV prototype (OF · IF · 1B · C)</Link>
            {' · '}
            <Link to="/dev/oaa-breakdown-prototype">OAA breakdown (OF + IF)</Link>
          </>
        )}
      </Typography>

      <Box className={styles.apiRow}>
        <Typography variant="body2">API</Typography>
        {apiOk === null && <Chip size="small" label="checking…" />}
        {apiOk === true && <Chip size="small" color="success" label="healthy" />}
        {apiOk === false && <Chip size="small" color="error" label="down" />}
      </Box>

      {error && (
        <Alert severity="error" className={styles.alertSpacing}>
          {error}
        </Alert>
      )}

      {namePickCandidates != null && namePickCandidates.length > 0 && (
        <Alert
          severity="info"
          className={styles.alertSpacing}
          onClose={() => {
            setNamePickCandidates(null);
            setPendingCardExplicitSeason(null);
          }}
        >
          <Typography variant="body2" className={styles.namePickLead}>
            Multiple players match. Pick one for the card:
          </Typography>
          <Box className={styles.candidateRow}>
            {namePickCandidates.map((c) => {
              const rawId = c.player_id;
              const id =
                typeof rawId === 'number' && Number.isFinite(rawId)
                  ? Math.trunc(rawId)
                  : typeof rawId === 'string' && /^\d+$/.test(rawId)
                    ? parseInt(rawId, 10)
                    : NaN;
              if (!Number.isFinite(id)) return null;
              const label = candidateDisambiguationLabel(c);
              return (
                <Button
                  key={id}
                  size="small"
                  variant="outlined"
                  onClick={() => {
                    setSidebarPlayerId(id);
                    setSidebarExplicitSeason(pendingCardExplicitSeason);
                    setNamePickCandidates(null);
                    setPendingCardExplicitSeason(null);
                  }}
                >
                  {label || `player_id ${id}`}
                </Button>
              );
            })}
          </Box>
        </Alert>
      )}

      {sidebarResolveError && (
        <Alert severity="warning" className={styles.alertSpacing} onClose={() => setSidebarResolveError(null)}>
          {sidebarResolveError}
        </Alert>
      )}

      <Box className={styles.mainRow}>
        <Box className={styles.chatColumn}>
          <Paper variant="outlined" className={styles.chatPaper}>
            {lines.length === 0 ? (
              <Typography color="text.secondary">Messages appear here.</Typography>
            ) : (
              lines.map((line, i) => (
                <Box key={i} className={styles.messageLine}>
                  <Typography variant="caption" color="text.secondary">
                    {line.role === 'user' ? 'You' : 'Assistant'}
                  </Typography>
                  {line.role === 'assistant' && line.thinking ? (
                    <details className={styles.thinkingDetails}>
                      <summary className={styles.thinkingSummary}>
                        Reasoning trace (model internals — can be long; thinking models may take minutes)
                      </summary>
                      <pre className={styles.thinkingPre}>{line.thinking}</pre>
                    </details>
                  ) : null}
                  <Typography variant="body1" className={styles.messageBody}>
                    {line.text || (streaming && i === lines.length - 1 ? '…' : '')}
                  </Typography>
                </Box>
              ))
            )}
            {streaming && <LinearProgress className={styles.streamingProgress} />}
          </Paper>

          <Box className={styles.composerRow}>
            <TextField
              fullWidth
              multiline
              minRows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                if (e.shiftKey) return;
                if (e.nativeEvent.isComposing) return;
                e.preventDefault();
                if (!streaming && input.trim()) void send();
              }}
              placeholder="Ask about players or stats…"
              disabled={streaming}
            />
            <Button
              variant="contained"
              endIcon={<SendIcon />}
              onClick={() => void send()}
              disabled={streaming || !input.trim()}
              className={styles.sendButton}
            >
              Send
            </Button>
          </Box>
          <Typography variant="caption" color="text.secondary" className={styles.inputHint}>
            Enter to send · Shift+Enter for a new line · Cmd/Ctrl+Enter also sends
          </Typography>
        </Box>

        {(compareIds != null ||
          sidebarPlayerId != null ||
          leaderboardAttachment != null) && (
          <Box className={styles.sidebarColumn}>
            {compareIds != null && (
              <PlayerCompareSidebar
                playerIds={compareIds}
                mode={compareMode}
                gameYear={compareYear}
                compareFgSeason={compareFgSeason}
                onClose={() => {
                  setCompareIds(null);
                  setCompareFgSeason(null);
                  setSidebarResolveError(null);
                }}
              />
            )}
            {sidebarPlayerId != null && compareIds == null && (
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
            )}
            {leaderboardAttachment != null && (
              <ChatLeaderboardPanel
                variant="sidebar"
                attachment={leaderboardAttachment}
                onExpand={() =>
                  navigate('/leaderboards', { state: { leaderboard: leaderboardAttachment } })
                }
                onDismiss={() => setLeaderboardAttachment(null)}
              />
            )}
          </Box>
        )}
      </Box>
    </Container>
  );
}
