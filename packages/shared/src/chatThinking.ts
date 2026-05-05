import { z } from 'zod';

/** SSE `event: thinking` — model reasoning trace (Ollama `message.thinking`). */
export const thinkingEventDataSchema = z.object({
  text: z.string(),
  /** Optional label for multi-round tool loops (e.g. tool_loop vs summarize). */
  phase: z.string().optional(),
});
export type ThinkingEventData = z.infer<typeof thinkingEventDataSchema>;
