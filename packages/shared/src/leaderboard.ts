import { z } from 'zod';

/** SSE `event: leaderboard` — structured table attachment for chat leaderboards. */
export const leaderboardColumnSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: z.enum(['string', 'number', 'integer']).optional(),
});
export type LeaderboardColumn = z.infer<typeof leaderboardColumnSchema>;

export const leaderboardProvenanceSchema = z.object({
  dataset: z.string(),
  sort_metric: z.string(),
  order: z.enum(['asc', 'desc']),
  season_from: z.number().int().optional(),
  season_to: z.number().int().optional(),
  min_pa: z.number().int().optional(),
  min_ip_outs: z.number().int().optional(),
  min_tbf: z.number().int().optional(),
  qualified_only: z.boolean().optional(),
});
export type LeaderboardProvenance = z.infer<typeof leaderboardProvenanceSchema>;

export const leaderboardAttachmentSchema = z.object({
  version: z.literal(1),
  title: z.string().optional(),
  columns: z.array(leaderboardColumnSchema),
  rows: z.array(z.record(z.string(), z.unknown())),
  sort: z.object({
    columnId: z.string(),
    order: z.enum(['asc', 'desc']),
  }),
  provenance: leaderboardProvenanceSchema,
});
export type LeaderboardAttachment = z.infer<typeof leaderboardAttachmentSchema>;

export const leaderboardEventDataSchema = leaderboardAttachmentSchema;
export type LeaderboardEventData = z.infer<typeof leaderboardEventDataSchema>;
