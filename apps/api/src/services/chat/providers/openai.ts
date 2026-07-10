import OpenAI from 'openai';
import type { ChatStreamLogger } from '../../../lib/chatStreamLog.js';
import type {
  ChatMessage,
  ChatProvider,
  ChatRoundContext,
  ChatRoundResult,
  ProviderToolCall,
  SseWriter,
} from '../provider.js';

type OpenAiMessage = Record<string, unknown>;

function readIntEnv(name: string, fallback: number, min = 0): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= min ? Math.trunc(n) : fallback;
}

function argsToJsonString(raw: string | Record<string, unknown> | undefined): string {
  if (typeof raw === 'string') return raw;
  try {
    return JSON.stringify(raw ?? {});
  } catch {
    return '{}';
  }
}

/**
 * gpt-oss models use OpenAI's "harmony" response format; some OpenAI-compatible endpoints
 * (notably Amazon Bedrock's gpt-oss serving) leak its channel markers into the tool-call name,
 * e.g. "resolve_player<|channel|>commentary". Keep only the real function name so tool dispatch
 * doesn't fail with unknown_tool. No-op for well-formed names (they contain no "<|").
 */
function sanitizeToolName(raw: string | undefined): string {
  return (raw ?? '').split('<|')[0].trim();
}

function argsToObject(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const o = JSON.parse(raw);
    return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Translate the provider-neutral transcript into OpenAI Chat Completions messages.
 *
 * The neutral transcript stores tool results as `{ role:'tool', tool_name, content }` with no id,
 * but OpenAI requires each tool message to carry a `tool_call_id` matching an id on the preceding
 * assistant `tool_calls`. Because the orchestrator always emits tool results immediately after the
 * assistant turn that requested them, in order, we can pair them deterministically here: assign an
 * id to every assistant tool call (reusing model-provided ids when present) and pop them, in order,
 * as we walk the following tool messages.
 */
export function toOpenAiMessages(messages: ChatMessage[]): OpenAiMessage[] {
  const out: OpenAiMessage[] = [];
  let pendingIds: string[] = [];
  let genCounter = 0;

  for (const m of messages) {
    const role = String(m.role ?? '');
    const content = typeof m.content === 'string' ? m.content : '';

    if (role === 'assistant') {
      const rawCalls = Array.isArray(m.tool_calls) ? (m.tool_calls as ProviderToolCall[]) : [];
      if (rawCalls.length > 0) {
        pendingIds = [];
        const toolCalls = rawCalls.map((tc) => {
          const id = tc.id && String(tc.id) ? String(tc.id) : `call_${genCounter++}`;
          pendingIds.push(id);
          return {
            id,
            type: 'function' as const,
            function: {
              name: tc.function?.name ?? '',
              arguments: argsToJsonString(tc.function?.arguments),
            },
          };
        });
        out.push({
          role: 'assistant',
          content: content || null,
          tool_calls: toolCalls,
        });
      } else {
        out.push({ role: 'assistant', content });
      }
      continue;
    }

    if (role === 'tool') {
      const toolCallId = pendingIds.shift() ?? `call_${genCounter++}`;
      out.push({ role: 'tool', tool_call_id: toolCallId, content });
      continue;
    }

    // system | user (and any other simple role) pass through as-is.
    out.push({ role, content });
  }

  return out;
}

/** Translate an OpenAI assistant reply back into the neutral shape the orchestrator consumes. */
export function fromOpenAiMessage(message: {
  content?: string | null;
  tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }> | null;
}): { assistantMessage: ChatMessage; hadToolCalls: boolean; content: string } {
  const content = typeof message.content === 'string' ? message.content : '';
  const rawCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  const neutralCalls: ProviderToolCall[] = rawCalls.map((tc) => ({
    id: tc.id,
    type: 'function',
    // Object args match what the Ollama path returns, so the orchestrator's tool loop is identical.
    function: { name: sanitizeToolName(tc.function?.name), arguments: argsToObject(tc.function?.arguments) },
  }));
  const hadToolCalls = neutralCalls.length > 0;
  const assistantMessage: ChatMessage = {
    role: 'assistant',
    content,
    ...(hadToolCalls ? { tool_calls: neutralCalls } : {}),
  };
  return { assistantMessage, hadToolCalls, content };
}

type OpenAiProviderOptions = { bedrock?: boolean };

/**
 * OpenAI-compatible chat backend. Covers the OpenAI API directly and — with `{ bedrock: true }` —
 * Amazon Bedrock's OpenAI-compatible Chat Completions endpoint (base URL + bearer token). Both speak
 * the same wire format, so a single adapter serves both; only client config differs.
 */
export class OpenAiProvider implements ChatProvider {
  readonly name: string;
  private readonly client: OpenAI | null;
  private readonly model: string;
  private readonly configured: boolean;

  constructor(opts: OpenAiProviderOptions = {}) {
    const bedrock = opts.bedrock === true;
    this.name = bedrock ? 'bedrock' : 'openai';

    let apiKey: string | undefined;
    let baseURL: string | undefined;
    if (bedrock) {
      const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1';
      baseURL =
        process.env.BEDROCK_BASE_URL ??
        `https://bedrock-runtime.${region}.amazonaws.com/openai/v1`;
      apiKey = process.env.AWS_BEARER_TOKEN_BEDROCK ?? process.env.OPENAI_API_KEY;
      this.model = process.env.BEDROCK_MODEL ?? process.env.OPENAI_MODEL ?? 'openai.gpt-oss-120b-1:0';
    } else {
      baseURL = process.env.OPENAI_BASE_URL;
      apiKey = process.env.OPENAI_API_KEY;
      this.model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
    }

    this.configured = Boolean(apiKey);
    this.client = this.configured
      ? new OpenAI({
          apiKey,
          ...(baseURL ? { baseURL } : {}),
          timeout: readIntEnv('OPENAI_TIMEOUT_MS', 120_000, 1_000),
          maxRetries: readIntEnv('OPENAI_MAX_RETRIES', 2),
        })
      : null;
  }

  /**
   * Cheap, no-network readiness: true when an API key/token is configured. Transport or auth
   * failures surface as thrown errors from `chatRound` (the route reports them as an SSE error),
   * which carry a more actionable message than a generic "unreachable" stub would.
   */
  async reachable(): Promise<boolean> {
    return this.configured;
  }

  async chatRound(
    messages: ChatMessage[],
    tools: Record<string, unknown>[] | undefined,
    write: SseWriter,
    log: ChatStreamLogger | undefined,
    ctx: ChatRoundContext
  ): Promise<ChatRoundResult> {
    if (!this.client) {
      throw new Error(
        `${this.name} provider is not configured (missing API key). Set ${
          this.name === 'bedrock' ? 'AWS_BEARER_TOKEN_BEDROCK' : 'OPENAI_API_KEY'
        }.`
      );
    }

    const oaiMessages = toOpenAiMessages(messages);
    log?.info(
      {
        step: 'openai_chat_request',
        provider: this.name,
        phase: ctx.phase,
        round: ctx.round,
        model: this.model,
        messageCount: oaiMessages.length,
        toolCount: tools?.length ?? 0,
      },
      'POST chat.completions'
    );

    const started = Date.now();
    const resp = await this.client.chat.completions.create({
      model: this.model,
      // Neutral messages/tools already match the OpenAI wire shape; cast past the SDK's strict unions.
      messages: oaiMessages as never,
      ...(tools && tools.length > 0 ? { tools: tools as never } : {}),
      stream: false,
    });

    const choice = resp.choices?.[0];
    const { assistantMessage, hadToolCalls, content } = fromOpenAiMessage(choice?.message ?? {});

    if (content && !ctx.suppressAssistantTokens) write('token', { text: content });

    log?.info(
      {
        step: 'openai_chat_response',
        provider: this.name,
        phase: ctx.phase,
        round: ctx.round,
        elapsedMs: Date.now() - started,
        finishReason: choice?.finish_reason,
        assistantContentChars: content.length,
        toolCallNames: hadToolCalls
          ? (assistantMessage.tool_calls as ProviderToolCall[]).map((c) => c.function?.name ?? '')
          : [],
        usage: resp.usage,
      },
      'chat.completions response'
    );

    return { assistantMessage, hadToolCalls };
  }
}
