import type pg from 'pg';
import { basename } from 'node:path';
import { leaderboardAttachmentSchema } from '@mlbapp/shared';
import { Agent, fetch as undiciFetch } from 'undici';
import {
  inferExplicitSeasonYearFromUserMessage,
  inferPlayerNameQueryFromUserMessage,
} from '../lib/chatUserIntentArgs.js';
import { inferTwoPlayerCompareFromUserMessage } from '../lib/compareUserIntent.js';
import { inferStatcastHostInject } from '../lib/statcastChatIntent.js';
import { narrowCandidatesByGenerationalHint } from '../lib/playerNameQuery.js';
import { getPlayerById, NAME_QUERY_CANDIDATE_LIMIT, resolvePlayer } from '../repos/players.js';
import {
  clipForChatLog,
  logOllamaPerformanceMetrics,
  logOllamaRoundRequest,
  logOllamaRoundResponse,
  logToolRun,
  type ChatStreamLogger,
} from '../lib/chatStreamLog.js';
import { logChatProcessMemory } from '../lib/chatProcessMemoryLog.js';
import { persistChatToolTrace, type ChatToolTraceRecord } from '../lib/chatToolTrace.js';
import { enrichToolArgs } from '../tools/argEnrichment.js';
import {
  executeTool,
  ollamaToolDefinitions,
  slimLeaderboardPayloadForLlm,
  toolResultString,
} from '../tools/registry.js';

const OLLAMA_HOST = (process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434').replace(/\/$/, '');
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'llama3.2';
/** Context window for /api/chat; large tool JSON (e.g. career compare) exceeds many models' defaults and yields refusals or garbage. */
const OLLAMA_NUM_CTX = (() => {
  const raw = process.env.OLLAMA_NUM_CTX;
  if (raw === undefined || raw === '') return 32_768;
  const n = parseInt(String(raw), 10);
  if (!Number.isFinite(n)) return 32_768;
  return Math.min(131_072, Math.max(4096, n));
})();

/**
 * Ollama thinking traces: set OLLAMA_THINK=true (or 1/yes) for boolean, or low|medium|high for gpt-oss.
 * Omit or OLLAMA_THINK=false|0|off|no to leave the key unset (default model behavior).
 */
function ollamaThinkRequestFields(): Record<string, unknown> {
  const raw = (process.env.OLLAMA_THINK ?? '').trim();
  if (raw === '') return {};
  const t = raw.toLowerCase();
  if (t === 'false' || t === '0' || t === 'off' || t === 'no') return {};
  if (t === 'true' || t === '1' || t === 'yes') return { think: true };
  if (t === 'low' || t === 'medium' || t === 'high') return { think: t };
  return {};
}

/** After a 500 runner crash, retry once with a smaller context window and without `think` (saves RAM on small GPUs). */
const OLLAMA_RUNNER_CRASH_RETRY_DISABLED =
  String(process.env.OLLAMA_RUNNER_CRASH_RETRY ?? 'true').toLowerCase() === 'false';
const OLLAMA_RUNNER_RETRY_NUM_CTX = (() => {
  const raw = process.env.OLLAMA_RUNNER_RETRY_NUM_CTX;
  if (raw === undefined || raw === '') return 8192;
  const n = parseInt(String(raw), 10);
  return Number.isFinite(n) && n >= 2048 ? Math.min(131_072, n) : 8192;
})();

function isOllamaRunnerCrash(status: number, body: string): boolean {
  return status === 500 && /runner process has terminated|llama runner|exited unexpectedly/i.test(body);
}

function buildOllamaChatPayload(
  messages: ChatMessage[],
  tools: Record<string, unknown>[] | undefined,
  numCtx: number,
  includeThinkFromEnv: boolean
): Record<string, unknown> {
  return {
    model: OLLAMA_MODEL,
    messages,
    ...(tools && tools.length > 0 ? { tools } : {}),
    stream: false,
    options: { num_ctx: numCtx },
    ...(includeThinkFromEnv ? ollamaThinkRequestFields() : {}),
  };
}

/**
 * Hard cap for a single /api/chat round (tools + non-streaming completion). Undici’s body timeout
 * defaults to 30m — without this, a stuck small model can appear to hang for 20m+ with no further logs.
 * Set OLLAMA_CHAT_ROUND_TIMEOUT_MS=0 to disable (rely on OLLAMA_FETCH_* only).
 */
const OLLAMA_CHAT_ROUND_TIMEOUT_MS = (() => {
  const raw = process.env.OLLAMA_CHAT_ROUND_TIMEOUT_MS;
  if (raw === undefined || raw === '') return 600_000; // 10 min
  const n = Number(raw);
  if (!Number.isFinite(n)) return 600_000;
  if (n <= 0) return 0;
  return Math.min(7_200_000, Math.max(5_000, Math.floor(n)));
})();

function isAbortLike(e: unknown): boolean {
  if (e instanceof Error && e.name === 'AbortError') return true;
  const msg = e instanceof Error ? e.message : String(e);
  return /abort/i.test(msg);
}

/** POST /api/chat with optional per-round timeout (see OLLAMA_CHAT_ROUND_TIMEOUT_MS). */
async function postOllamaChat(
  payload: Record<string, unknown>,
  log: ChatStreamLogger | undefined,
  roundCtx: { phase: string; round?: number }
): Promise<Awaited<ReturnType<typeof undiciFetch>>> {
  const url = `${OLLAMA_HOST}/api/chat`;
  const started = Date.now();
  const baseInit = {
    method: 'POST' as const,
    headers: { 'Content-Type': 'application/json' },
    dispatcher: ollamaChatDispatcher,
    body: JSON.stringify(payload),
  };

  if (OLLAMA_CHAT_ROUND_TIMEOUT_MS <= 0) {
    log?.info(
      {
        step: 'ollama_chat_fetch_start',
        phase: roundCtx.phase,
        round: roundCtx.round,
        timeoutMs: null,
      },
      'POST /api/chat (no OLLAMA_CHAT_ROUND_TIMEOUT_MS; may wait up to OLLAMA_FETCH_* timeouts)'
    );
    const res = await undiciFetch(url, baseInit);
    log?.info(
      {
        step: 'ollama_chat_fetch_headers',
        phase: roundCtx.phase,
        round: roundCtx.round,
        elapsedMs: Date.now() - started,
        status: res.status,
      },
      'Ollama /api/chat response headers received'
    );
    return res;
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), OLLAMA_CHAT_ROUND_TIMEOUT_MS);
  log?.info(
    {
      step: 'ollama_chat_fetch_start',
      phase: roundCtx.phase,
      round: roundCtx.round,
      timeoutMs: OLLAMA_CHAT_ROUND_TIMEOUT_MS,
    },
    'POST /api/chat (waiting for Ollama; aborts at timeoutMs if hung)'
  );
  try {
    const res = await undiciFetch(url, { ...baseInit, signal: ac.signal });
    log?.info(
      {
        step: 'ollama_chat_fetch_headers',
        phase: roundCtx.phase,
        round: roundCtx.round,
        elapsedMs: Date.now() - started,
        status: res.status,
      },
      'Ollama /api/chat response headers received'
    );
    return res;
  } catch (e) {
    if (isAbortLike(e)) {
      throw new Error(
        `Ollama chat round timed out after ${OLLAMA_CHAT_ROUND_TIMEOUT_MS}ms (phase=${roundCtx.phase}). On CPU, the first tool round (large system prompt + many tools) often exceeds 5m for small models. Raise OLLAMA_CHAT_ROUND_TIMEOUT_MS (e.g. 600000–1200000), or set 0 to disable this cap. You can also try a faster model, native Ollama w/ GPU, or lower OLLAMA_NUM_CTX.`
      );
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

const MAX_TOOL_ROUNDS = 10;
const TOOL_RESULT_SSE_MAX = 4000;

/** Ollama /api/chat can sit on CPU for many minutes (large num_ctx + tool JSON + slow local GPU). */
const OLLAMA_FETCH_TIMEOUT_MAX_MS = 7_200_000; // 2h cap via env
const OLLAMA_FETCH_HEADERS_BODY_DEFAULT_MS = 1_800_000; // 30m default (15m was tight; seen ~903s failures)

function readTimeoutMs(envVar: string, fallback: number, max = OLLAMA_FETCH_TIMEOUT_MAX_MS): number {
  const raw = process.env[envVar];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(Math.max(n, 5_000), max);
}

/** Long /api/chat runs exceed Node default ~300s; tune with OLLAMA_FETCH_*_TIMEOUT_MS. */
const ollamaChatDispatcher = new Agent({
  headersTimeout: readTimeoutMs(
    'OLLAMA_FETCH_HEADERS_TIMEOUT_MS',
    OLLAMA_FETCH_HEADERS_BODY_DEFAULT_MS
  ),
  bodyTimeout: readTimeoutMs('OLLAMA_FETCH_BODY_TIMEOUT_MS', OLLAMA_FETCH_HEADERS_BODY_DEFAULT_MS),
  connectTimeout: readTimeoutMs('OLLAMA_FETCH_CONNECT_TIMEOUT_MS', 15_000, 120_000),
});

const ollamaHealthDispatcher = new Agent({
  headersTimeout: 8_000,
  bodyTimeout: 8_000,
  connectTimeout: 5_000,
});

export type SseWriter = (event: string, data: unknown) => void;

export type ChatStreamOptions = {
  /** When set with `CHAT_TOOL_TRACE_DIR`, full tool args + result JSON are written per invocation. */
  traceId?: string;
  /** Player card `player_id` from the UI when the user did not name someone else in this message. */
  active_player_id?: number | null;
  active_season?: number | null;
};

function persistFullToolIo(
  traceId: string | undefined,
  source: ChatToolTraceRecord['source'],
  name: string,
  args: unknown,
  fullJson: string,
  log: ChatStreamLogger | undefined,
  userMessage: string
): void {
  const filepath = persistChatToolTrace({
    traceId,
    tool: name,
    source,
    args,
    resultJson: fullJson,
    userMessagePreview: userMessage.slice(0, 500),
  });
  if (filepath && log) {
    log.info(
      { step: 'tool_trace_persisted', tool: name, source, file: basename(filepath) },
      'chat full tool I/O written to disk (see CHAT_TOOL_TRACE_DIR)'
    );
  }
}

const SYSTEM_PROMPT = `You are a baseball statistics assistant backed by database tools.

Allowed tools (use these exact names only; never invent other tool names):
resolve_player, get_fg_season_line, compare_players_career, leaderboard_query, statcast_pitcher_pitch_mix, statcast_batter_batted_ball, statcast_sample_rows, statcast_compare_statcast_summary.

Workflow:
- FanGraphs season lines (WAR, slash, counting stats): call resolve_player if you need player_id, then call get_fg_season_line with player_id (integer from candidates), role batting or pitching, and season or season_from/season_to. Do not claim FanGraphs data is missing until get_fg_season_line has returned.
- Statcast (velo, pitch mix, batted balls): use key_mlbam from resolve_player as pitcher_mlbam or batter_mlbam plus game_year.
- resolve_player: when resolving by name, pass name_query as the player name from the user (e.g. "Mookie Betts"). The host may fill it from phrasing like "Tell me about …" if you omit it.
- statcast_batter_batted_ball: **bbe** counts BBE with measured exit velocity; season **avg_ev**, **avg_la**, **ev90** (90th percentile EV among those BBE), **max_ev**; **ideal_contact_pct** is barrel + solid + flares & burners share among **bbe_classified** (EV+LA rows); **bbe_classified** counts rows with both EV and LA used for Tango Tiger contact buckets (**contact_quality** percentages and **contact_points** for EV×LA). It is **not** PA-based slash stats. If bbe is 0 or avg_ev is null, say Statcast has little or no batted-ball data for that batter-year, not a made-up slash line.
- Two-player comparisons: compare_players_career (FanGraphs career rows for both players).
- Rankings / leaderboards (FanGraphs career or season consolidated stats): leaderboard_query. Use the dataset and sort_metric allowlist from the tool schema. If the user wants a ranked list but did **not** clearly say career totals vs best **single seasons** (e.g. "all time", "best ever", "greatest seasons" without which), ask **one short** clarifying question before calling the tool — do not assume. **Exception**: if they already name a **specific stat** (e.g. WAR, ERA, strikeouts) **and** a **season or range**, do not stall with meta-questions — call the tool or explain that metric is unavailable (see below). For **offensive** value ("best hitters", "best offensive seasons", "raking", MVP-type hitting): use batting datasets with sort_metric **war** or **wrc_plus** and order **desc** (higher is better). Do **not** use **tto_rate_sum** for generic "best offensive" questions — that metric is only for **three-true-outcome** / TTO-style questions. For **defensive** value in FanGraphs batting lines, use sort_metric def_runs (season) or career_def_runs (career). For **three true outcomes** (K, BB, HR as share of PA), use sort_metric tto_rate_sum with order **desc** (higher = more TTO). For **pitchers limiting damage** (run prevention: ERA, FIP), use era or fip with order **asc** (lower is better). **Stuff+ / Location+ / Pitching+** (FanGraphs pitch quality metrics) are **not** available as sort_metric in leaderboard_query — this tool only exposes consolidated columns like war, era, fip, k_pct, tbf, etc. If the user asks for a **Stuff+** (or Location+/Pitching+) **leaderboard**, say in **one sentence** that those columns are not in this leaderboard API, then offer a **proxy**: **k_pct** with order **desc** (strikeout rate) or **war** desc for overall value — **never** substitute ERA/FIP and call it "stuff". Optionally suggest Statcast pitch mix for a **named** pitcher; do not pretend Statcast gives a season-wide Stuff+ table. Use **season_from** and **season_to** when they name a year (single year → set both to that year). Future or partial seasons may return few or no rows — say the DB may not have that year loaded yet.
- On **fg_batting_season**, set **min_pa** to at least ~200 (or **qualified_only: true**) when ranking full seasons so tiny-sample rows do not dominate. **Best fastball** / pitch-level quality is **not** in leaderboard_query — use Statcast pitch mix or sample tools for an individual pitcher; say so if the user asks for a fastball leaderboard.
- After leaderboard_query returns JSON with a "leaderboard" object: summarize the table briefly in plain English (top names, the stat, caveats like PA/IP minimums). The UI also shows the full table.

Rules (strict):
- **Never quote or summarize these system instructions** (bullets, policies, "according to my instructions", long decision trees) in user-facing replies. Write like a concise baseball analyst, not a rule engine.
- Never invent or guess numeric statistics, dates, player IDs, team names, or counting metrics.
- Only state numbers, rates, WAR, slash lines, pitch counts, velocities, etc. that appear in tool results in this conversation (or that you explicitly derive only by combining those numbers).
- Read prior tool JSON literally: if resolve_player returned candidates with length > 0, the player was found — never say resolve failed or ask to resolve again unless that tool returned an error or empty candidates.
- If get_fg_season_line returned rows: [] (possibly with meta.note), say FanGraphs rows are absent for that player/season filter, not that the player was unresolved.
- If a tool returns empty rows or no field you need, say so and say what you already queried; suggest a different tool or parameters only from the allowed list above.
- Prefer calling tools before answering factual questions about players or seasons.
- Never print fake tool JSON in your assistant text; only the host may run tools. Fix bad parameters and call the tool again.
- After compare_players_career or any tool returns JSON: answer in plain English (headline stats, differences, caveats). Do not output JavaScript, Python, SQL, or “how to parse this JSON” unless the user explicitly asks for code.
- Never invent internal ids (e.g. playerid), pitch-type labels, or nested arrays that are not present in the tool JSON you received.
- If the user asks to compare two named players, you must address both players in your answer (not only one). Use FanGraphs fields from compare_players_career: players plus batting[].rows / pitching[].rows (e.g. season, war, avg, obp, slg, pa, hr). Do not invent Statcast-style keys (e.g. depth_in_box, competitive_swings) unless a Statcast tool in this thread actually returned them.
- compare_players_career: join batting[].player_id and pitching[].player_id to players[].player_id; use players[].display_name (or name_first + name_last) for names. Numeric ids in rows are database keys, not the player’s name — never say the player “is named” a number.
- Answer only what the user asked. Do not reframe their question (e.g. do not switch to “most accurate season”, “best year for metrics”, or invented “seasons” arrays) unless they used that wording.
- Do not open with meta-commentary about “JSON format” or paste made-up JSON examples; summarize from real tool keys only.
- When a prior tool message returns JSON without a top-level "error" key, you must answer from that data (names, seasons, stats). Never reply with a generic refusal such as “I can't provide that information” or “I cannot help with that” for grounded baseball stats.
- Keep prose concise unless the user asks for detail.
- If resolve_player returns multiple candidates, list their names and birth years and ask which player to use; never pick candidates[0] without user confirmation.
- Do not state current MLB team, league MVP, or awards unless that information appears in tool JSON from this conversation.`;

async function ollamaReachable(): Promise<boolean> {
  try {
    const r = await undiciFetch(`${OLLAMA_HOST}/api/tags`, {
      method: 'GET',
      dispatcher: ollamaHealthDispatcher,
    });
    return r.ok;
  } catch {
    return false;
  }
}

type OllamaFunction = {
  index?: number;
  name?: string;
  arguments?: string | Record<string, unknown>;
};

type OllamaToolCall = {
  type?: string;
  function?: OllamaFunction;
};

/** Run resolve_player before tools that depend on its JSON (same Ollama round). */
const TOOL_RUN_PRIORITY: Record<string, number> = {
  resolve_player: 0,
  get_fg_season_line: 10,
  compare_players_career: 10,
  leaderboard_query: 12,
  statcast_pitcher_pitch_mix: 20,
  statcast_batter_batted_ball: 20,
  statcast_sample_rows: 25,
};

function emitLeaderboardSse(write: SseWriter, toolName: string, resultPayload: unknown): void {
  if (toolName !== 'leaderboard_query') return;
  if (!resultPayload || typeof resultPayload !== 'object') return;
  const rec = resultPayload as Record<string, unknown>;
  if (rec.error != null) return;
  const parsed = leaderboardAttachmentSchema.safeParse(rec.leaderboard);
  if (parsed.success) write('leaderboard', parsed.data);
}

function normalizeToolCallBatches(batches: OllamaToolCall[][]): OllamaToolCall[] {
  const flat = batches.flat();
  const byIndex = new Map<number, { name: string; args: string }>();
  flat.forEach((tc, seq) => {
    const fn = tc.function;
    if (!fn) return;
    const idx = typeof fn.index === 'number' ? fn.index : seq;
    const name = fn.name ?? byIndex.get(idx)?.name ?? '';
    const argPiece =
      typeof fn.arguments === 'string'
        ? fn.arguments
        : fn.arguments != null
          ? JSON.stringify(fn.arguments)
          : '';
    const cur = byIndex.get(idx);
    if (!cur) {
      byIndex.set(idx, { name, args: argPiece });
    } else {
      byIndex.set(idx, {
        name: name || cur.name,
        args: cur.args + argPiece,
      });
    }
  });
  return Array.from(byIndex.entries())
    .map(([index, v]) => ({
      index,
      name: v.name,
      args: v.args,
      pri: TOOL_RUN_PRIORITY[v.name] ?? 50,
    }))
    .sort((a, b) => (a.pri !== b.pri ? a.pri - b.pri : a.index - b.index))
    .map(({ index, name, args }) => ({
      type: 'function' as const,
      function: { index, name, arguments: args },
    }));
}

/** Ollama rejects replayed history when `function.arguments` is a JSON string; use objects. */
function toolCallsForOllamaReplay(calls: OllamaToolCall[]): Record<string, unknown>[] {
  return calls.map((tc) => {
    const fn = tc.function;
    const raw = fn?.arguments;
    let argsObj: Record<string, unknown> = {};
    if (typeof raw === 'string') {
      const t = raw.trim();
      if (t) {
        try {
          argsObj = JSON.parse(t) as Record<string, unknown>;
        } catch {
          argsObj = {};
        }
      }
    } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      argsObj = raw as Record<string, unknown>;
    }
    return {
      type: 'function',
      function: {
        name: fn?.name ?? '',
        arguments: argsObj,
      },
    };
  });
}

function sseSafeArgs(raw: unknown): Record<string, unknown> | undefined {
  try {
    const obj = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw;
    const s = JSON.stringify(obj);
    if (s.length > 2000) {
      return { _truncated: true, preview: s.slice(0, 2000) + '…' };
    }
    return obj as Record<string, unknown>;
  } catch {
    return { _raw: String(raw).slice(0, 500) };
  }
}

function truncateForSse(json: string): { preview: string; truncated: boolean } {
  if (json.length <= TOOL_RESULT_SSE_MAX) return { preview: json, truncated: false };
  return { preview: json.slice(0, TOOL_RESULT_SSE_MAX) + '…', truncated: true };
}

type ChatMessage = Record<string, unknown>;

/** Short generic refusals after a tool payload (context overflow or mis-tuned safety). */
function looksLikeGenericRefusal(content: string): boolean {
  const t = content.trim().toLowerCase();
  if (t.length > 180) return false;
  if (!/\b(can't|cannot|unable to|not able to|couldn't)\b/.test(t)) return false;
  if (!/\b(help|provide|information|assist|share|answer|discuss|that)\b/.test(t)) return false;
  return true;
}

/** Non-streaming round: reliable full `tool_calls` + `arguments` JSON from Ollama. */
async function chatRoundNonStreaming(
  messages: ChatMessage[],
  tools: Record<string, unknown>[] | undefined,
  write: SseWriter,
  log: ChatStreamLogger | undefined,
  roundCtx: { phase: string; round?: number },
  opts?: { suppressAssistantTokens?: boolean }
): Promise<{ assistantMessage: ChatMessage; hadToolCalls: boolean }> {
  logOllamaRoundRequest(log, {
    phase: roundCtx.phase,
    round: roundCtx.round,
    model: OLLAMA_MODEL,
    ollamaHost: OLLAMA_HOST,
    messages,
    tools,
  });

  const wallStart = Date.now();
  const primaryPayload = buildOllamaChatPayload(messages, tools, OLLAMA_NUM_CTX, true);

  let res = await postOllamaChat(primaryPayload, log, roundCtx);

  let errText = !res.ok ? await res.text().catch(() => '') : '';
  const retried =
    !res.ok &&
    !OLLAMA_RUNNER_CRASH_RETRY_DISABLED &&
    isOllamaRunnerCrash(res.status, errText);

  if (retried) {
    const retryCtx = Math.min(OLLAMA_RUNNER_RETRY_NUM_CTX, OLLAMA_NUM_CTX);
    log?.info(
      {
        step: 'ollama_runner_crash_retry',
        phase: roundCtx.phase,
        round: roundCtx.round,
        prior_num_ctx: OLLAMA_NUM_CTX,
        retry_num_ctx: retryCtx,
        omit_think: true,
      },
      'Ollama runner crashed; retrying chat round with smaller num_ctx and without think'
    );
    const retryPayload = buildOllamaChatPayload(messages, tools, retryCtx, false);
    res = await postOllamaChat(retryPayload, log, {
      ...roundCtx,
      phase: `${roundCtx.phase}_runner_retry`,
    });
    errText = !res.ok ? await res.text().catch(() => '') : '';
  }

  if (!res.ok) {
    let msg = `Ollama error ${res.status}: ${errText.slice(0, 500)}`;
    if (res.status === 500 && /runner process has terminated|llama runner|exited unexpectedly/i.test(errText)) {
      msg +=
        ' — Ollama’s model process crashed (often OOM or too-large context). Try OLLAMA_NUM_CTX=8192, set OLLAMA_THINK=false, or check `ollama ps` / host RAM. See Ollama server logs for the real exit reason.';
    }
    throw new Error(msg);
  }

  const data = (await res.json()) as Record<string, unknown>;
  const wallClockMs = Date.now() - wallStart;
  logOllamaPerformanceMetrics(log, {
    phase: roundCtx.phase,
    round: roundCtx.round,
    model: OLLAMA_MODEL,
    ollamaHost: OLLAMA_HOST,
    wallClockMs,
    responseBody: data,
  });

  const msg = data.message as Record<string, unknown> | undefined;
  const contentAcc = typeof msg?.content === 'string' ? msg.content : '';
  const thinkingAcc = typeof msg?.thinking === 'string' ? msg.thinking : '';
  if (thinkingAcc) {
    write('thinking', { text: thinkingAcc, phase: roundCtx.phase });
  }
  if (contentAcc && !opts?.suppressAssistantTokens) write('token', { text: contentAcc });

  const rawCalls = msg?.tool_calls as OllamaToolCall[] | undefined;
  const mergedCalls = Array.isArray(rawCalls) ? normalizeToolCallBatches([rawCalls]) : [];
  const hadToolCalls = mergedCalls.length > 0;

  const assistantMessage: ChatMessage = {
    role: 'assistant',
    content: contentAcc,
    ...(thinkingAcc ? { thinking: thinkingAcc } : {}),
    ...(hadToolCalls ? { tool_calls: toolCallsForOllamaReplay(mergedCalls) } : {}),
  };

  logOllamaRoundResponse(log, {
    phase: roundCtx.phase,
    round: roundCtx.round,
    assistantContentChars: contentAcc.length,
    assistantPreview: contentAcc ? clipForChatLog(contentAcc, 400) : undefined,
    assistantFullText: contentAcc || undefined,
    toolCallNames: mergedCalls.map((c) => c.function?.name ?? '').filter(Boolean),
  });

  return { assistantMessage, hadToolCalls };
}

function userAskedFanGraphsSeasonLine(userMessage: string): boolean {
  const p = userMessage.toLowerCase();
  return (
    /\bfangraphs\b/.test(p) ||
    /\b(batting|pitching)\s+line\b/.test(p) ||
    (/\bwar\b/.test(p) && /\b(season|year|\d{4})\b/.test(p))
  );
}

/** Broaden server FG injection beyond explicit FG phrasing (small models stall after resolve). */
function shouldServerInjectFgSeasonLine(userMessage: string): boolean {
  if (userAskedFanGraphsSeasonLine(userMessage)) return true;
  return inferPlayerNameQueryFromUserMessage(userMessage) != null;
}

function transcriptHasGetFgTool(messages: ChatMessage[]): boolean {
  return messages.some((m) => m.role === 'tool' && String(m.tool_name) === 'get_fg_season_line');
}

function transcriptHasCompareTool(messages: ChatMessage[]): boolean {
  return messages.some((m) => m.role === 'tool' && String(m.tool_name) === 'compare_players_career');
}

function lastSuccessfulResolvePayload(messages: ChatMessage[]): Record<string, unknown> | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'tool' || String(m.tool_name) !== 'resolve_player') continue;
    const c = m.content;
    if (typeof c !== 'string') continue;
    try {
      const j = JSON.parse(c) as Record<string, unknown>;
      if (j.error) continue;
      const cand = j.candidates as unknown[] | undefined;
      if (cand?.length) return j;
    } catch {
      continue;
    }
  }
  return null;
}

function transcriptHasResolvePlayer(messages: ChatMessage[]): boolean {
  return messages.some((m) => m.role === 'tool' && String(m.tool_name) === 'resolve_player');
}

async function appendSyntheticResolvePlayerRound(
  messages: ChatMessage[],
  write: SseWriter,
  log: ChatStreamLogger | undefined,
  traceId: string | undefined,
  userMessage: string,
  name_query: string,
  resolveResult: Record<string, unknown>,
  source: 'server_resolve_inject' | 'server_active_resolve'
): Promise<void> {
  const toolName = 'resolve_player';
  const args = { name_query };
  messages.push({
    role: 'assistant',
    content: '',
    tool_calls: [
      {
        type: 'function',
        function: { name: toolName, arguments: args },
      },
    ],
  });
  write('tool_start', { name: toolName, args: sseSafeArgs(args) });
  const fullJson = toolResultString(resolveResult);
  const { preview, truncated } = truncateForSse(fullJson);
  write('tool_result', {
    name: toolName,
    truncated,
    result_preview: preview,
    result_chars: fullJson.length,
  });
  messages.push({
    role: 'tool',
    tool_name: toolName,
    content: fullJson,
  });
  logToolRun(log, {
    source,
    name: toolName,
    args,
    resultJson: fullJson,
    sseTruncated: truncated,
  });
  persistFullToolIo(traceId, source, toolName, args, fullJson, log, userMessage);
}

/**
 * Host runs resolve before the first model turn when the message names a player (bio/search phrasing),
 * so small models cannot skip tools and hallucinate FanGraphs lines.
 */
async function maybeServerDrivenResolveByNameAtStart(
  pool: pg.Pool,
  userMessage: string,
  messages: ChatMessage[],
  write: SseWriter,
  log: ChatStreamLogger | undefined,
  traceId?: string
): Promise<void> {
  if (inferTwoPlayerCompareFromUserMessage(userMessage)) return;
  if (transcriptHasResolvePlayer(messages)) return;
  const nameQ = inferPlayerNameQueryFromUserMessage(userMessage);
  if (!nameQ) return;

  const raw = await resolvePlayer(pool, { name_query: nameQ, limit: NAME_QUERY_CANDIDATE_LIMIT });
  let candidates = (raw.candidates as Record<string, unknown>[]) ?? [];
  candidates = narrowCandidatesByGenerationalHint(nameQ, candidates);
  const resolveResult = { ...raw, candidates };
  await appendSyntheticResolvePlayerRound(
    messages,
    write,
    log,
    traceId,
    userMessage,
    nameQ,
    resolveResult,
    'server_resolve_inject'
  );
}

async function maybeServerDrivenSyntheticActivePlayerResolve(
  pool: pg.Pool,
  userMessage: string,
  messages: ChatMessage[],
  write: SseWriter,
  log: ChatStreamLogger | undefined,
  traceId: string | undefined,
  playerId: number
): Promise<void> {
  if (transcriptHasResolvePlayer(messages)) return;
  const row = await getPlayerById(pool, playerId);
  if (!row) return;
  const fn = String(row.name_first ?? '').trim();
  const ln = String(row.name_last ?? '').trim();
  const name_query = `${fn} ${ln}`.trim() || String(playerId);
  const resolveResult = { candidates: [row], match_type: 'active_ui_card' };
  await appendSyntheticResolvePlayerRound(
    messages,
    write,
    log,
    traceId,
    userMessage,
    name_query,
    resolveResult,
    'server_active_resolve'
  );
}

/** Model sometimes echoes resolve JSON instead of calling get_fg — drop that assistant turn. */
function stripTrailingResolveJsonEcho(messages: ChatMessage[]): void {
  const last = messages[messages.length - 1];
  if (last?.role !== 'assistant') return;
  const content = typeof last.content === 'string' ? last.content.trim() : '';
  if (!content.startsWith('{')) return;
  if (content.includes('"candidates"') || content.includes("'candidates'")) {
    messages.pop();
  }
}

/**
 * After resolve_player, some models reply with text ("I'll get his 2023 line") and no tools.
 * Drop that turn so the transcript ends with the resolve tool message before server-injected get_fg.
 */
function stripTrailingAssistantStallAfterResolve(messages: ChatMessage[]): void {
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'assistant') return;
  const hasToolCalls = Array.isArray(last.tool_calls) && last.tool_calls.length > 0;
  if (hasToolCalls) return;
  const prev = messages[messages.length - 2];
  if (!prev || prev.role !== 'tool' || String(prev.tool_name) !== 'resolve_player') return;
  const raw = typeof prev.content === 'string' ? prev.content : '';
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    if (j.error) return;
    const cand = j.candidates as unknown[] | undefined;
    if (!cand || cand.length !== 1) return;
  } catch {
    return;
  }
  messages.pop();
}

function inferSeasonFromPrompt(userMessage: string): number | null {
  const m = userMessage.match(/\b(19|20)\d{2}\b/);
  if (!m) return null;
  const y = parseInt(m[0], 10);
  return y >= 1900 && y <= 2100 ? y : null;
}

function inferFgInjectionRoles(userMessage: string): Array<'batting' | 'pitching'> {
  const p = userMessage.toLowerCase();
  const pitchOnly = /\bpitching\b/.test(p) && !/\bbatting\b/.test(p);
  const batOnly = /\bbatting\b/.test(p) && !/\bpitching\b/.test(p);
  if (pitchOnly) return ['pitching'];
  if (batOnly) return ['batting'];
  return ['batting', 'pitching'];
}

/**
 * If the user wanted season-style context (explicit FG phrasing, or player bio phrasing like
 * "tell me about …") and resolve succeeded but get_fg was never run, fetch FG once server-side.
 */
async function maybeServerDrivenFgSeasonLine(
  pool: pg.Pool,
  userMessage: string,
  messages: ChatMessage[],
  write: SseWriter,
  log: ChatStreamLogger | undefined,
  traceId?: string,
  streamOptions?: ChatStreamOptions
): Promise<void> {
  if (!shouldServerInjectFgSeasonLine(userMessage)) return;
  if (transcriptHasGetFgTool(messages)) return;
  const resolvePayload = lastSuccessfulResolvePayload(messages);
  if (!resolvePayload) return;

  stripTrailingResolveJsonEcho(messages);
  stripTrailingAssistantStallAfterResolve(messages);

  const cands = resolvePayload.candidates as unknown[] | undefined;
  if (!Array.isArray(cands) || cands.length !== 1) return;

  const cand0 = cands[0] as Record<string, unknown>;
  const rawPid = cand0?.player_id;
  const player_id =
    typeof rawPid === 'number' && Number.isFinite(rawPid)
      ? Math.trunc(rawPid)
      : typeof rawPid === 'string' && /^\d+$/.test(rawPid)
        ? parseInt(rawPid, 10)
        : NaN;
  if (!Number.isFinite(player_id) || player_id <= 0) return;

  const roles = inferFgInjectionRoles(userMessage);
  const season =
    inferExplicitSeasonYearFromUserMessage(userMessage) ??
    inferSeasonFromPrompt(userMessage) ??
    (streamOptions?.active_season != null && streamOptions.active_season > 0
      ? Math.trunc(streamOptions.active_season)
      : null);

  const name = 'get_fg_season_line';
  const toolCtx = { userMessage, messages };

  for (const role of roles) {
    const args: Record<string, unknown> = {
      player_id,
      role,
      limit: 12,
      ...(season != null ? { season } : {}),
    };

    messages.push({
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          type: 'function',
          function: { name, arguments: args },
        },
      ],
    });

    write('tool_start', { name, args: sseSafeArgs(args) });
    let resultPayload: unknown;
    try {
      resultPayload = await executeTool(pool, name, args, toolCtx);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      resultPayload = { error: 'tool_execution_failed', message: msg };
    }
    const fullJson = toolResultString(resultPayload);
    const { preview, truncated } = truncateForSse(fullJson);
    write('tool_result', {
      name,
      truncated,
      result_preview: preview,
      result_chars: fullJson.length,
    });
    messages.push({
      role: 'tool',
      tool_name: name,
      content: fullJson,
    });

    logToolRun(log, {
      source: 'server_fg_fallback',
      name,
      args,
      resultJson: fullJson,
      sseTruncated: truncated,
    });
    persistFullToolIo(traceId, 'server_fg_fallback', name, args, fullJson, log, userMessage);
  }
}

/**
 * Small models often skip compare_players_career or call unrelated Statcast tools. When the
 * prompt matches "Compare X and Y", run compare once before the first model turn.
 */
function toPositiveMlbam(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.trunc(v);
  if (typeof v === 'string' && /^\d+$/.test(v.trim())) {
    const n = parseInt(v.trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

function transcriptHasStatcastPitchOrBatterTool(messages: ChatMessage[]): boolean {
  return messages.some(
    (m) =>
      m.role === 'tool' &&
      (String(m.tool_name) === 'statcast_pitcher_pitch_mix' ||
        String(m.tool_name) === 'statcast_batter_batted_ball')
  );
}

async function appendExecutedToolRound(
  pool: pg.Pool,
  messages: ChatMessage[],
  write: SseWriter,
  log: ChatStreamLogger | undefined,
  traceId: string | undefined,
  userMessage: string,
  toolName: string,
  args: Record<string, unknown>,
  source: ChatToolTraceRecord['source']
): Promise<void> {
  messages.push({
    role: 'assistant',
    content: '',
    tool_calls: [
      {
        type: 'function',
        function: { name: toolName, arguments: args },
      },
    ],
  });
  write('tool_start', { name: toolName, args: sseSafeArgs(args) });
  const toolCtx = { userMessage, messages };
  let resultPayload: unknown;
  try {
    resultPayload = await executeTool(pool, toolName, args, toolCtx);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    resultPayload = { error: 'tool_execution_failed', message: msg };
  }
  const fullJson = toolResultString(resultPayload);
  const { preview, truncated } = truncateForSse(fullJson);
  write('tool_result', {
    name: toolName,
    truncated,
    result_preview: preview,
    result_chars: fullJson.length,
  });
  messages.push({
    role: 'tool',
    tool_name: toolName,
    content: fullJson,
  });
  logToolRun(log, {
    source,
    name: toolName,
    args,
    resultJson: fullJson,
    sseTruncated: truncated,
  });
  persistFullToolIo(traceId, source, toolName, args, fullJson, log, userMessage);
}

async function maybeServerDrivenStatcastInject(
  pool: pg.Pool,
  userMessage: string,
  messages: ChatMessage[],
  write: SseWriter,
  log: ChatStreamLogger | undefined,
  traceId?: string
): Promise<void> {
  const spec = inferStatcastHostInject(userMessage);
  if (!spec) return;
  if (transcriptHasStatcastPitchOrBatterTool(messages)) return;
  if (transcriptHasResolvePlayer(messages)) return;

  const raw = await resolvePlayer(pool, { name_query: spec.name_query, limit: NAME_QUERY_CANDIDATE_LIMIT });
  let cands = (raw.candidates as Record<string, unknown>[]) ?? [];
  cands = narrowCandidatesByGenerationalHint(spec.name_query, cands);
  const resolveResult = { ...raw, candidates: cands };
  await appendSyntheticResolvePlayerRound(
    messages,
    write,
    log,
    traceId,
    userMessage,
    spec.name_query,
    resolveResult,
    'server_resolve_inject'
  );
  if (cands.length !== 1) return;
  const mlbam = toPositiveMlbam(cands[0]?.key_mlbam);
  if (mlbam == null) return;

  const toolName =
    spec.kind === 'pitcher_mix' ? 'statcast_pitcher_pitch_mix' : 'statcast_batter_batted_ball';
  const args =
    spec.kind === 'pitcher_mix'
      ? { pitcher_mlbam: mlbam, game_year: spec.game_year }
      : { batter_mlbam: mlbam, game_year: spec.game_year };

  await appendExecutedToolRound(
    pool,
    messages,
    write,
    log,
    traceId,
    userMessage,
    toolName,
    args,
    'server_statcast_inject'
  );
}

async function maybeServerDrivenCompareCareer(
  pool: pg.Pool,
  userMessage: string,
  messages: ChatMessage[],
  write: SseWriter,
  log: ChatStreamLogger | undefined,
  traceId?: string
): Promise<void> {
  const inferred = inferTwoPlayerCompareFromUserMessage(userMessage);
  if (!inferred) return;
  if (transcriptHasCompareTool(messages)) return;

  const name = 'compare_players_career';
  const toolCtx = { userMessage, messages };
  const y = inferExplicitSeasonYearFromUserMessage(userMessage);
  const seasonSlice =
    y != null && y >= 1900 && y <= 2100 ? { season_from: y, season_to: y } : {};
  // Omit pitching for host-injected compare: smaller payload; both players are overwhelmingly hitters in typical “compare X and Y” prompts.
  const effectiveArgs = enrichToolArgs(
    name,
    { ...inferred, include_pitching: false, ...seasonSlice },
    toolCtx
  );

  messages.push({
    role: 'assistant',
    content: '',
    tool_calls: [
      {
        type: 'function',
        function: { name, arguments: effectiveArgs as Record<string, unknown> },
      },
    ],
  });

  write('tool_start', { name, args: sseSafeArgs(effectiveArgs) });
  let resultPayload: unknown;
  try {
    resultPayload = await executeTool(pool, name, effectiveArgs, toolCtx);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    resultPayload = { error: 'tool_execution_failed', message: msg };
  }
  const fullJson = toolResultString(resultPayload);
  const { preview, truncated } = truncateForSse(fullJson);
  write('tool_result', {
    name,
    truncated,
    result_preview: preview,
    result_chars: fullJson.length,
  });
  messages.push({
    role: 'tool',
    tool_name: name,
    content: fullJson,
  });

  logToolRun(log, {
    source: 'server_compare_inject',
    name,
    args: effectiveArgs,
    resultJson: fullJson,
    sseTruncated: truncated,
  });
  persistFullToolIo(traceId, 'server_compare_inject', name, effectiveArgs, fullJson, log, userMessage);
}

export async function streamOllamaChatWithTools(
  pool: pg.Pool,
  userMessage: string,
  write: SseWriter,
  log?: ChatStreamLogger,
  streamOptions?: ChatStreamOptions
): Promise<void> {
  const traceId = streamOptions?.traceId;
  const prompt = userMessage.trim() || 'Say hello in one short sentence.';

  if (!(await ollamaReachable())) {
    log?.info({ step: 'ollama_unreachable', ollamaHost: OLLAMA_HOST }, 'chat ollama unreachable; stub response');
    write('token', { text: '[Ollama unreachable at ' + OLLAMA_HOST + '] ' });
    write('token', {
      text: 'Stub: connect Ollama to use tools. You said: ' + JSON.stringify(prompt),
    });
    return;
  }

  logChatProcessMemory(log, 'stream_start');

  try {
    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ];

    await maybeServerDrivenCompareCareer(pool, prompt, messages, write, log, traceId);

    await maybeServerDrivenStatcastInject(pool, prompt, messages, write, log, traceId);

    const nameInMessage = inferPlayerNameQueryFromUserMessage(prompt);
    if (nameInMessage) {
      await maybeServerDrivenResolveByNameAtStart(pool, prompt, messages, write, log, traceId);
    } else if (
      streamOptions?.active_player_id != null &&
      Number.isFinite(streamOptions.active_player_id) &&
      streamOptions.active_player_id > 0
    ) {
      await maybeServerDrivenSyntheticActivePlayerResolve(
        pool,
        prompt,
        messages,
        write,
        log,
        traceId,
        Math.trunc(streamOptions.active_player_id)
      );
    }

    const toolsAll = ollamaToolDefinitions as Record<string, unknown>[];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const toolsThisRound = transcriptHasCompareTool(messages)
        ? toolsAll.filter(
            (t) =>
              ((t as { function?: { name?: string } }).function?.name ?? '') !== 'compare_players_career'
          )
        : toolsAll;
      const trailingTool = messages[messages.length - 1]?.role === 'tool';
      let { assistantMessage, hadToolCalls } = await chatRoundNonStreaming(
        messages,
        toolsThisRound,
        write,
        log,
        { phase: 'tool_loop', round },
        { suppressAssistantTokens: Boolean(trailingTool) }
      );
      messages.push(assistantMessage);

      if (trailingTool) {
        let text = typeof assistantMessage.content === 'string' ? assistantMessage.content : '';
        let refusalRetried = false;
        if (!hadToolCalls && (looksLikeGenericRefusal(text) || text.trim() === '')) {
          log?.info(
            {
              step: 'ollama_refusal_retry',
              round,
              preview: clipForChatLog(text, 200),
            },
            'chat dropped assistant reply after tool; retrying without tools'
          );
          messages.pop();
          ({ assistantMessage, hadToolCalls } = await chatRoundNonStreaming(
            messages,
            undefined,
            write,
            log,
            { phase: 'tool_loop_refusal_retry', round }
          ));
          messages.push(assistantMessage);
          refusalRetried = true;
          text = typeof assistantMessage.content === 'string' ? assistantMessage.content : '';
        }
        if (text && !refusalRetried) write('token', { text });
      }

      if (!hadToolCalls) break;

      const toolCalls = assistantMessage.tool_calls as OllamaToolCall[];
      for (const tc of toolCalls) {
        const fn = tc.function;
        const name = fn?.name;
        if (!name) continue;

        const toolCtx = { userMessage: prompt, messages };
        const effectiveArgs = enrichToolArgs(name, fn?.arguments, toolCtx);
        write('tool_start', { name, args: sseSafeArgs(effectiveArgs) });

        let resultPayload: unknown;
        try {
          resultPayload = await executeTool(pool, name, effectiveArgs, toolCtx);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          resultPayload = { error: 'tool_execution_failed', message: msg };
        }

        const fullJson = toolResultString(resultPayload);
        const llmPayload =
          name === 'leaderboard_query' ? slimLeaderboardPayloadForLlm(resultPayload) : resultPayload;
        const llmJson = toolResultString(llmPayload);
        const { preview, truncated } = truncateForSse(fullJson);
        emitLeaderboardSse(write, name, resultPayload);
        write('tool_result', {
          name,
          truncated,
          result_preview: preview,
          result_chars: fullJson.length,
          ...(llmJson.length !== fullJson.length
            ? { result_chars_for_model: llmJson.length }
            : {}),
        });

        messages.push({
          role: 'tool',
          tool_name: name,
          content: llmJson,
        });

        logToolRun(log, {
          source: 'model',
          name,
          args: effectiveArgs,
          resultJson: llmJson,
          sseTruncated: truncated,
        });
        persistFullToolIo(traceId, 'model', name, effectiveArgs, fullJson, log, prompt);
      }
    }

    await maybeServerDrivenFgSeasonLine(pool, prompt, messages, write, log, traceId, streamOptions);

    const last = messages[messages.length - 1];
    if (last && last.role === 'tool') {
      const { assistantMessage } = await chatRoundNonStreaming(
        messages,
        undefined,
        write,
        log,
        {
          phase: 'summarize_after_tools',
        },
        {}
      );
      messages.push(assistantMessage);
    }
  } finally {
    logChatProcessMemory(log, 'stream_end');
  }
}
