import { z } from 'zod';
export { extractExplicitSeasonYearFromMessage, extractPlayerCardChatIntentFromMessage, inferPlayerNameQueryFromUserMessageShared, PLAYER_CHAT_SEASON_YEAR_MAX, stripPossessiveRoleSuffixFromName, } from './playerChatIntent.js';
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
    /** When set, the user has this player's card open in the UI; model should prefer this identity. */
    active_player_id: z.coerce.number().int().positive().optional(),
    /** Season year shown on the card (optional; host may default). */
    active_season: z.coerce.number().int().min(1900).max(2100).optional(),
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
export { leaderboardAttachmentSchema, leaderboardColumnSchema, leaderboardEventDataSchema, leaderboardProvenanceSchema, } from './leaderboard.js';
export { thinkingEventDataSchema } from './chatThinking.js';
export { SPEED_ANGLE_COLORS, SPEED_ANGLE_LABELS, speedAngleCode, } from './speedAngleCode.js';
