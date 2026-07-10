import type { ChatStreamLogger } from '../../lib/chatStreamLog.js';

/** SSE emitter passed down from the /api/chat route (see routes/chat.ts). */
export type SseWriter = (event: string, data: unknown) => void;

/**
 * Provider-neutral chat message. Kept as an open record because each provider adds
 * its own replay fields (e.g. Ollama `thinking`, tool `tool_name`, OpenAI `tool_call_id`).
 * Shared roles: system | user | assistant | tool.
 */
export type ChatMessage = Record<string, unknown>;

export type ChatStreamOptions = {
  /** When set with `CHAT_TOOL_TRACE_DIR`, full tool args + result JSON are written per invocation. */
  traceId?: string;
  /** Player card `player_id` from the UI when the user did not name someone else in this message. */
  active_player_id?: number | null;
  active_season?: number | null;
};

/**
 * One tool call as seen on an assistant turn. Matches the OpenAI function-call shape
 * (`{ type:'function', function:{ name, arguments } }`), which Ollama also emits, so a
 * single shape crosses both providers. `arguments` may be a JSON string or an object.
 */
export type ProviderToolCallFunction = {
  index?: number;
  name?: string;
  arguments?: string | Record<string, unknown>;
};

export type ProviderToolCall = {
  type?: string;
  function?: ProviderToolCallFunction;
};

/** Context for a single non-streaming chat round. */
export type ChatRoundContext = {
  phase: string;
  round?: number;
  /** Suppress emitting assistant `token` events for this round (host is about to run tools). */
  suppressAssistantTokens?: boolean;
};

export type ChatRoundResult = {
  assistantMessage: ChatMessage;
  hadToolCalls: boolean;
};

/**
 * A chat backend (Ollama, OpenAI, Bedrock, …). The provider owns wire-format translation
 * and its own timeouts/retries; the orchestrator (orchestrator.ts) owns the provider-neutral
 * tool loop and all server-driven tool injection.
 */
export interface ChatProvider {
  /** Short id for logs/errors, e.g. "ollama" or "openai". */
  readonly name: string;
  /** Cheap liveness probe; when false the orchestrator emits a stub reply. */
  reachable(): Promise<boolean>;
  /** Run one non-streaming round: send `messages` (+ optional `tools`), return the assistant turn. */
  chatRound(
    messages: ChatMessage[],
    tools: Record<string, unknown>[] | undefined,
    write: SseWriter,
    log: ChatStreamLogger | undefined,
    ctx: ChatRoundContext
  ): Promise<ChatRoundResult>;
}
