import type { ChatProvider } from './provider.js';
import { OllamaProvider } from './providers/ollama.js';

export type { ChatProvider, ChatStreamOptions, SseWriter } from './provider.js';
export { streamChatWithTools } from './orchestrator.js';

/**
 * Pick the chat backend from CHAT_PROVIDER (default: ollama). OpenAI/Bedrock adapters are added
 * in a later step; unknown values fall back to Ollama so existing deployments are unaffected.
 */
export function selectProvider(): ChatProvider {
  const kind = (process.env.CHAT_PROVIDER ?? 'ollama').trim().toLowerCase();
  switch (kind) {
    case '':
    case 'ollama':
      return new OllamaProvider();
    default:
      // eslint-disable-next-line no-console
      console.warn(`[chat] unknown CHAT_PROVIDER="${kind}"; falling back to ollama`);
      return new OllamaProvider();
  }
}
