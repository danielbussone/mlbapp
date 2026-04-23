import { z } from 'zod';

/** API GET /health */
export const healthResponseSchema = z.object({
  ok: z.literal(true),
  service: z.string(),
  version: z.string(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

/** POST /chat request body */
export const chatRequestSchema = z.object({
  message: z.string().default(''),
  conversationId: z.string().optional(),
});
export type ChatRequest = z.infer<typeof chatRequestSchema>;

/** SSE `data:` payloads (event name is separate in SSE wire format) */
export const tokenEventDataSchema = z.object({
  text: z.string(),
});
export type TokenEventData = z.infer<typeof tokenEventDataSchema>;

export const toolLifecycleDataSchema = z.object({
  name: z.string(),
  args: z.record(z.string(), z.unknown()).optional(),
});
export type ToolLifecycleData = z.infer<typeof toolLifecycleDataSchema>;

/** SSE `event: tool_start` */
export const toolStartEventDataSchema = z.object({
  name: z.string(),
  args: z.record(z.string(), z.unknown()).optional(),
});
export type ToolStartEventData = z.infer<typeof toolStartEventDataSchema>;

/** SSE `event: tool_result` (payload may be truncated for the wire) */
export const toolResultEventDataSchema = z.object({
  name: z.string(),
  truncated: z.boolean(),
  result_preview: z.string(),
  result_chars: z.number(),
});
export type ToolResultEventData = z.infer<typeof toolResultEventDataSchema>;

export const errorEventDataSchema = z.object({
  message: z.string(),
});
export type ErrorEventData = z.infer<typeof errorEventDataSchema>;
