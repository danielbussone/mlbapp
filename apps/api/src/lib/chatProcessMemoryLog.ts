import type { ChatStreamLogger } from './chatStreamLog.js';
import { getNodeProcessMemoryMb } from './processMemory.js';

export function chatProcessMemoryLogEnabled(): boolean {
  const v = String(process.env.CHAT_LOG_PROCESS_MEMORY ?? '').toLowerCase();
  return v === '1' || v === 'true' || v === 'on';
}

export function logChatProcessMemory(
  log: ChatStreamLogger | undefined,
  label: 'stream_start' | 'stream_end'
): void {
  if (!log || !chatProcessMemoryLogEnabled()) return;
  log.info(
    { step: 'chat_process_memory', label, ...getNodeProcessMemoryMb() },
    'chat API process memory (Node); Ollama RAM/VRAM is on the Ollama host — use GET /health/ollama runningModels'
  );
}
