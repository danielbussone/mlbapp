/** Max chars of each `role: tool` message included in `ollama_request.messages` log (LLM input). 0 = omit previews. */
export function chatLogLlmToolChars(): number {
  const raw = process.env.CHAT_LOG_LLM_TOOL_CHARS;
  if (raw === undefined || raw === '') return 4096;
  if (String(raw).trim() === '0') return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 4096;
  return Math.min(Math.floor(n), 256_000);
}

/** Max chars of tool JSON logged under `resultBody` / `argsJson`. 0 = metadata only (sizes, names, keys). */
export function chatLogToolBodyMax(): number {
  const raw = process.env.CHAT_LOG_TOOL_BODY_MAX;
  if (raw === undefined || raw === '') return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.floor(n), 256_000);
}

export type ChatStreamLogger = {
  info: (obj: Record<string, unknown>, msg: string) => void;
};

export function clipForChatLog(s: string, max: number): string {
  if (max <= 0 || s.length <= max) return s;
  return s.slice(0, max) + '…[log truncated]';
}

type ChatMsg = Record<string, unknown>;

export type ChatLogMessageSummaryOpts = {
  /** Per-tool `content` preview cap; 0 skips tool body previews. */
  toolContentMax?: number;
  /** If set, include start of system prompt (still cap length). */
  systemPromptMax?: number;
};

/** Shapes sent to Ollama: roles, sizes, tool names; optional tool/system previews for debugging. */
export function summarizeMessagesForChatLog(
  messages: ChatMsg[],
  opts?: ChatLogMessageSummaryOpts
): Record<string, unknown>[] {
  const toolMax = opts?.toolContentMax ?? 0;
  const sysMax = opts?.systemPromptMax ?? 0;
  return messages.map((m) => {
    const role = String(m.role ?? '?');
    if (role === 'system') {
      const c = m.content;
      const len = typeof c === 'string' ? c.length : 0;
      return {
        role: 'system',
        contentChars: len,
        ...(sysMax > 0 && typeof c === 'string' && c
          ? { contentPreview: clipForChatLog(c, sysMax) }
          : {}),
      };
    }
    if (role === 'user') {
      const c = m.content;
      const s = typeof c === 'string' ? c : '';
      return { role: 'user', contentChars: s.length, preview: clipForChatLog(s, 240) };
    }
    if (role === 'assistant') {
      const tc = m.tool_calls as unknown[] | undefined;
      const names =
        Array.isArray(tc) && tc.length
          ? tc
              .map((x) => {
                const fn = (x as { function?: { name?: string } })?.function;
                return fn?.name ?? null;
              })
              .filter((x): x is string => x != null && x !== '')
          : undefined;
      const content = typeof m.content === 'string' ? m.content : '';
      return {
        role: 'assistant',
        contentChars: content.length,
        contentPreview: content ? clipForChatLog(content, 200) : undefined,
        toolCallNames: names,
      };
    }
    if (role === 'tool') {
      const c = m.content;
      const body = typeof c === 'string' ? c : '';
      return {
        role: 'tool',
        tool_name: m.tool_name,
        contentChars: body.length,
        ...(toolMax > 0 && body ? { contentPreview: clipForChatLog(body, toolMax) } : {}),
      };
    }
    return { role, keys: Object.keys(m) };
  });
}

function chatLogSystemPromptChars(): number {
  const raw = process.env.CHAT_LOG_LLM_SYSTEM_CHARS;
  if (raw === undefined || raw === '') return 0;
  if (String(raw).trim() === '0') return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.floor(n), 32_000);
}

export function logOllamaRoundRequest(
  log: ChatStreamLogger | undefined,
  ctx: {
    phase: string;
    round?: number;
    model: string;
    ollamaHost: string;
    messages: ChatMsg[];
    tools?: Record<string, unknown>[];
  }
): void {
  if (!log) return;
  const toolNames =
    ctx.tools?.map((t) => (t as { function?: { name?: string } }).function?.name).filter(Boolean) ?? [];
  const toolContentMax = chatLogLlmToolChars();
  const systemPromptMax = chatLogSystemPromptChars();
  let transcriptJsonChars: number | undefined;
  try {
    transcriptJsonChars = JSON.stringify(ctx.messages).length;
  } catch {
    transcriptJsonChars = undefined;
  }
  log.info(
    {
      step: 'ollama_request',
      phase: ctx.phase,
      round: ctx.round,
      model: ctx.model,
      ollamaHost: ctx.ollamaHost,
      messageCount: ctx.messages.length,
      transcriptJsonChars,
      messages: summarizeMessagesForChatLog(ctx.messages, {
        toolContentMax,
        systemPromptMax,
      }),
      toolsOffered: toolNames,
      toolCount: toolNames.length,
    },
    'chat ollama request (payload sent to model for this round)'
  );
}

function chatLogLlmAssistantChars(): number {
  const raw = process.env.CHAT_LOG_LLM_ASSISTANT_CHARS;
  if (raw === undefined || raw === '') return 0;
  if (String(raw).trim() === '0') return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.floor(n), 256_000);
}

/**
 * Logs Ollama-reported timings from `/api/chat` (nanoseconds → ms) plus host wall clock for the HTTP round.
 * See also `GET /health/ollama` for reachability + `/api/tags` latency between requests.
 */
export function logOllamaPerformanceMetrics(
  log: ChatStreamLogger | undefined,
  ctx: {
    phase: string;
    round?: number;
    model: string;
    ollamaHost: string;
    wallClockMs: number;
    responseBody: Record<string, unknown>;
  }
): void {
  if (!log) return;
  if (String(process.env.CHAT_LOG_OLLAMA_PERF ?? '').toLowerCase() === 'off' || process.env.CHAT_LOG_OLLAMA_PERF === '0') {
    return;
  }
  const d = ctx.responseBody;
  const nsToMs = (key: string): number | undefined => {
    const v = d[key];
    return typeof v === 'number' && Number.isFinite(v) ? Math.round(v / 1_000_000) : undefined;
  };
  const intField = (key: string): number | undefined => {
    const v = d[key];
    return typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : undefined;
  };
  const evalMs = nsToMs('eval_duration');
  const evalN = intField('eval_count');
  const evalTps =
    evalN != null && evalMs != null && evalMs > 0 ? Math.round((evalN / (evalMs / 1000)) * 100) / 100 : undefined;

  log.info(
    {
      step: 'ollama_performance',
      phase: ctx.phase,
      round: ctx.round,
      model: ctx.model,
      ollamaHost: ctx.ollamaHost,
      wallClockMs: ctx.wallClockMs,
      total_duration_ms: nsToMs('total_duration'),
      load_duration_ms: nsToMs('load_duration'),
      prompt_eval_count: intField('prompt_eval_count'),
      prompt_eval_duration_ms: nsToMs('prompt_eval_duration'),
      eval_count: intField('eval_count'),
      eval_duration_ms: evalMs,
      eval_tokens_per_sec: evalTps,
    },
    'chat ollama round performance (host wall clock + Ollama timings)'
  );
}

export function logOllamaRoundResponse(
  log: ChatStreamLogger | undefined,
  ctx: {
    phase: string;
    round?: number;
    assistantContentChars: number;
    assistantPreview?: string;
    assistantFullText?: string;
    toolCallNames: string[];
  }
): void {
  if (!log) return;
  const amax = chatLogLlmAssistantChars();
  const full =
    amax > 0 && ctx.assistantFullText
      ? clipForChatLog(ctx.assistantFullText, amax)
      : undefined;
  log.info(
    {
      step: 'ollama_response',
      phase: ctx.phase,
      round: ctx.round,
      assistantContentChars: ctx.assistantContentChars,
      assistantPreview: ctx.assistantPreview,
      assistantFull: full,
      toolCallNames: ctx.toolCallNames,
      hadToolCalls: ctx.toolCallNames.length > 0,
    },
    'chat ollama response (model output for this round)'
  );
}

export function logToolRun(
  log: ChatStreamLogger | undefined,
  ctx: {
    source:
      | 'model'
      | 'server_fg_fallback'
      | 'server_compare_inject'
      | 'server_resolve_inject'
      | 'server_active_resolve'
      | 'server_statcast_inject';
    name: string;
    args: unknown;
    resultJson: string;
    sseTruncated: boolean;
  }
): void {
  if (!log) return;
  const max = chatLogToolBodyMax();
  let argsJson: string | undefined;
  try {
    argsJson = JSON.stringify(ctx.args);
  } catch {
    argsJson = String(ctx.args);
  }
  const base: Record<string, unknown> = {
    step: 'tool_run',
    source: ctx.source,
    tool: ctx.name,
    argsChars: argsJson.length,
    resultChars: ctx.resultJson.length,
    sseTruncated: ctx.sseTruncated,
  };
  if (max > 0) {
    base.argsJson = clipForChatLog(argsJson, Math.min(max, 12_000));
    base.resultBody = clipForChatLog(ctx.resultJson, max);
  } else {
    try {
      const o = typeof ctx.args === 'object' && ctx.args != null ? (ctx.args as Record<string, unknown>) : {};
      base.argKeys = Object.keys(o);
    } catch {
      base.argKeys = [];
    }
  }
  log.info(
    base,
    'chat tool finished: JSON below is stored as role=tool content and sent to the model on the next Ollama round'
  );
}
