import { z } from 'zod';
export { extractExplicitSeasonYearFromMessage, extractPlayerCardChatIntentFromMessage, inferPlayerNameQueryFromUserMessageShared, PLAYER_CHAT_SEASON_YEAR_MAX, stripPossessiveRoleSuffixFromName, type PlayerCardChatIntentPayload, } from './playerChatIntent.js';
/** API GET /health */
export declare const healthResponseSchema: z.ZodObject<{
    ok: z.ZodLiteral<true>;
    service: z.ZodString;
    version: z.ZodString;
}, "strip", z.ZodTypeAny, {
    ok: true;
    service: string;
    version: string;
}, {
    ok: true;
    service: string;
    version: string;
}>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
/** POST /chat request body */
export declare const chatRequestSchema: z.ZodObject<{
    message: z.ZodDefault<z.ZodString>;
    conversationId: z.ZodOptional<z.ZodString>;
    /** When set, the user has this player's card open in the UI; model should prefer this identity. */
    active_player_id: z.ZodOptional<z.ZodNumber>;
    /** Season year shown on the card (optional; host may default). */
    active_season: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    message: string;
    conversationId?: string | undefined;
    active_player_id?: number | undefined;
    active_season?: number | undefined;
}, {
    message?: string | undefined;
    conversationId?: string | undefined;
    active_player_id?: number | undefined;
    active_season?: number | undefined;
}>;
export type ChatRequest = z.infer<typeof chatRequestSchema>;
/** SSE `data:` payloads (event name is separate in SSE wire format) */
export declare const tokenEventDataSchema: z.ZodObject<{
    text: z.ZodString;
}, "strip", z.ZodTypeAny, {
    text: string;
}, {
    text: string;
}>;
export type TokenEventData = z.infer<typeof tokenEventDataSchema>;
export declare const toolLifecycleDataSchema: z.ZodObject<{
    name: z.ZodString;
    args: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    name: string;
    args?: Record<string, unknown> | undefined;
}, {
    name: string;
    args?: Record<string, unknown> | undefined;
}>;
export type ToolLifecycleData = z.infer<typeof toolLifecycleDataSchema>;
/** SSE `event: tool_start` */
export declare const toolStartEventDataSchema: z.ZodObject<{
    name: z.ZodString;
    args: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    name: string;
    args?: Record<string, unknown> | undefined;
}, {
    name: string;
    args?: Record<string, unknown> | undefined;
}>;
export type ToolStartEventData = z.infer<typeof toolStartEventDataSchema>;
/** SSE `event: tool_result` (payload may be truncated for the wire) */
export declare const toolResultEventDataSchema: z.ZodObject<{
    name: z.ZodString;
    truncated: z.ZodBoolean;
    result_preview: z.ZodString;
    result_chars: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    name: string;
    truncated: boolean;
    result_preview: string;
    result_chars: number;
}, {
    name: string;
    truncated: boolean;
    result_preview: string;
    result_chars: number;
}>;
export type ToolResultEventData = z.infer<typeof toolResultEventDataSchema>;
export declare const errorEventDataSchema: z.ZodObject<{
    message: z.ZodString;
}, "strip", z.ZodTypeAny, {
    message: string;
}, {
    message: string;
}>;
export type ErrorEventData = z.infer<typeof errorEventDataSchema>;
//# sourceMappingURL=index.d.ts.map