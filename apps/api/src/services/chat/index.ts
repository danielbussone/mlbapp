import type { ChatProvider } from './provider.js';
import { OllamaProvider } from './providers/ollama.js';
import { OpenAiProvider } from './providers/openai.js';

export type { ChatProvider, ChatStreamOptions, SseWriter } from './provider.js';
export { streamChatWithTools } from './orchestrator.js';

/**
 * Pick the chat backend from CHAT_PROVIDER (default: ollama).
 * - `ollama` (default): local Ollama at OLLAMA_HOST.
 * - `openai`: OpenAI API (OPENAI_API_KEY, OPENAI_MODEL, optional OPENAI_BASE_URL).
 * - `bedrock`: Amazon Bedrock's OpenAI-compatible endpoint (AWS_BEARER_TOKEN_BEDROCK, AWS_REGION, BEDROCK_MODEL).
 * Unknown values fall back to Ollama so existing deployments are unaffected.
 */
export function selectProvider(): ChatProvider {
  const kind = (process.env.CHAT_PROVIDER ?? 'ollama').trim().toLowerCase();
  switch (kind) {
    case '':
    case 'ollama':
      return new OllamaProvider();
    case 'openai':
      return new OpenAiProvider();
    case 'bedrock':
      return new OpenAiProvider({ bedrock: true });
    default:
      // eslint-disable-next-line no-console
      console.warn(`[chat] unknown CHAT_PROVIDER="${kind}"; falling back to ollama`);
      return new OllamaProvider();
  }
}
