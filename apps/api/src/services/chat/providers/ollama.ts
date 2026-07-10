import { Agent, fetch as undiciFetch } from 'undici';
import {
  clipForChatLog,
  logOllamaPerformanceMetrics,
  logOllamaRoundRequest,
  logOllamaRoundResponse,
  type ChatStreamLogger,
} from '../../../lib/chatStreamLog.js';
import type {
  ChatMessage,
  ChatProvider,
  ChatRoundContext,
  ChatRoundResult,
  ProviderToolCall,
  SseWriter,
} from '../provider.js';

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

function normalizeToolCallBatches(batches: ProviderToolCall[][]): ProviderToolCall[] {
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
function toolCallsForOllamaReplay(calls: ProviderToolCall[]): Record<string, unknown>[] {
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

/** Non-streaming round: reliable full `tool_calls` + `arguments` JSON from Ollama. */
async function chatRoundNonStreaming(
  messages: ChatMessage[],
  tools: Record<string, unknown>[] | undefined,
  write: SseWriter,
  log: ChatStreamLogger | undefined,
  ctx: ChatRoundContext
): Promise<ChatRoundResult> {
  logOllamaRoundRequest(log, {
    phase: ctx.phase,
    round: ctx.round,
    model: OLLAMA_MODEL,
    ollamaHost: OLLAMA_HOST,
    messages,
    tools,
  });

  const wallStart = Date.now();
  const primaryPayload = buildOllamaChatPayload(messages, tools, OLLAMA_NUM_CTX, true);

  let res = await postOllamaChat(primaryPayload, log, ctx);

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
        phase: ctx.phase,
        round: ctx.round,
        prior_num_ctx: OLLAMA_NUM_CTX,
        retry_num_ctx: retryCtx,
        omit_think: true,
      },
      'Ollama runner crashed; retrying chat round with smaller num_ctx and without think'
    );
    const retryPayload = buildOllamaChatPayload(messages, tools, retryCtx, false);
    res = await postOllamaChat(retryPayload, log, {
      ...ctx,
      phase: `${ctx.phase}_runner_retry`,
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
    phase: ctx.phase,
    round: ctx.round,
    model: OLLAMA_MODEL,
    ollamaHost: OLLAMA_HOST,
    wallClockMs,
    responseBody: data,
  });

  const msg = data.message as Record<string, unknown> | undefined;
  const contentAcc = typeof msg?.content === 'string' ? msg.content : '';
  const thinkingAcc = typeof msg?.thinking === 'string' ? msg.thinking : '';
  if (thinkingAcc) {
    write('thinking', { text: thinkingAcc, phase: ctx.phase });
  }
  if (contentAcc && !ctx.suppressAssistantTokens) write('token', { text: contentAcc });

  const rawCalls = msg?.tool_calls as ProviderToolCall[] | undefined;
  const mergedCalls = Array.isArray(rawCalls) ? normalizeToolCallBatches([rawCalls]) : [];
  const hadToolCalls = mergedCalls.length > 0;

  const assistantMessage: ChatMessage = {
    role: 'assistant',
    content: contentAcc,
    ...(thinkingAcc ? { thinking: thinkingAcc } : {}),
    ...(hadToolCalls ? { tool_calls: toolCallsForOllamaReplay(mergedCalls) } : {}),
  };

  logOllamaRoundResponse(log, {
    phase: ctx.phase,
    round: ctx.round,
    assistantContentChars: contentAcc.length,
    assistantPreview: contentAcc ? clipForChatLog(contentAcc, 400) : undefined,
    assistantFullText: contentAcc || undefined,
    toolCallNames: mergedCalls.map((c) => c.function?.name ?? '').filter(Boolean),
  });

  return { assistantMessage, hadToolCalls };
}

/** Local Ollama (/api/chat) backend for the chat orchestrator. */
export class OllamaProvider implements ChatProvider {
  readonly name = 'ollama';

  reachable(): Promise<boolean> {
    return ollamaReachable();
  }

  chatRound(
    messages: ChatMessage[],
    tools: Record<string, unknown>[] | undefined,
    write: SseWriter,
    log: ChatStreamLogger | undefined,
    ctx: ChatRoundContext
  ): Promise<ChatRoundResult> {
    return chatRoundNonStreaming(messages, tools, write, log, ctx);
  }
}
