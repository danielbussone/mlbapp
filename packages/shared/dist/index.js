import { z } from 'zod';
/** API GET /health */
export const healthResponseSchema = z.object({
    ok: z.literal(true),
    service: z.string(),
    version: z.string(),
});
/** POST /chat request body */
export const chatRequestSchema = z.object({
    message: z.string().default(''),
    conversationId: z.string().optional(),
});
/** SSE `data:` payloads (event name is separate in SSE wire format) */
export const tokenEventDataSchema = z.object({
    text: z.string(),
});
export const toolLifecycleDataSchema = z.object({
    name: z.string(),
    args: z.record(z.string(), z.unknown()).optional(),
});
/** SSE `event: tool_start` */
export const toolStartEventDataSchema = z.object({
    name: z.string(),
    args: z.record(z.string(), z.unknown()).optional(),
});
/** SSE `event: tool_result` (payload may be truncated for the wire) */
export const toolResultEventDataSchema = z.object({
    name: z.string(),
    truncated: z.boolean(),
    result_preview: z.string(),
    result_chars: z.number(),
});
export const errorEventDataSchema = z.object({
    message: z.string(),
});
