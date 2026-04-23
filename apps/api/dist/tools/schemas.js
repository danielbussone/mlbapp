import { z } from 'zod';
const SEASON_YEAR_MIN = 1900;
const SEASON_YEAR_MAX = 2032;
function clampSeasonYear(n) {
    return Math.min(SEASON_YEAR_MAX, Math.max(SEASON_YEAR_MIN, n));
}
const seasonYear = z.number().int().min(1900).max(2032).nullable().optional();
/** Ollama often sends "true"/"false" strings for booleans. */
const optionalLooseBoolean = z.preprocess((v) => {
    if (v === null || v === undefined)
        return undefined;
    if (typeof v === 'boolean')
        return v;
    if (typeof v === 'string') {
        const s = v.trim().toLowerCase();
        if (s === 'true' || s === '1')
            return true;
        if (s === 'false' || s === '0')
            return false;
    }
    if (typeof v === 'number') {
        if (v === 1)
            return true;
        if (v === 0)
            return false;
    }
    return v;
}, z.boolean().optional());
/**
 * Ollama often sends four-digit years as strings; "0" means "omit".
 * Absurd years (e.g. 99999) are clamped to 1900–2032 so tools still run.
 */
const optionalLooseSeasonYear = z.preprocess((v) => {
    if (v === null || v === undefined)
        return undefined;
    if (typeof v === 'string') {
        const t = v.trim();
        if (t === '' || t === '0')
            return undefined;
        if (/^\d+$/.test(t)) {
            const n = parseInt(t, 10);
            if (n === 0)
                return undefined;
            return clampSeasonYear(n);
        }
        return v;
    }
    if (typeof v === 'number' && Number.isFinite(v)) {
        const n = Math.trunc(v);
        if (n === 0)
            return undefined;
        return clampSeasonYear(n);
    }
    return v;
}, z.number().int().min(1900).max(2032).optional());
export const resolvePlayerArgsSchema = z
    .object({
    name_query: z.string().nullable().optional(),
    key_mlbam: z.coerce.number().int().positive().nullable().optional(),
    id_fangraphs: z.coerce.number().int().positive().nullable().optional(),
    limit: z.number().int().min(1).max(25).nullable().optional(),
})
    .refine((v) => (v.name_query != null && String(v.name_query).trim() !== '') ||
    (v.key_mlbam != null && Number.isFinite(v.key_mlbam)) ||
    (v.id_fangraphs != null && Number.isFinite(v.id_fangraphs)), { message: 'Provide name_query, key_mlbam, or id_fangraphs' });
export const getFgSeasonLineArgsSchema = z.object({
    player_id: z.coerce.number().int().positive(),
    role: z.enum(['batting', 'pitching']),
    season: seasonYear,
    season_from: seasonYear,
    season_to: seasonYear,
    team: z.string().max(8).nullable().optional(),
    level: z.string().max(32).nullable().optional(),
    limit: z.number().int().min(1).max(30).nullable().optional(),
});
export const comparePlayersCareerArgsSchema = z.object({
    player_a_query: z.string().min(1).max(200),
    player_b_query: z.string().min(1).max(200),
    include_batting: optionalLooseBoolean,
    include_pitching: optionalLooseBoolean,
    season_from: optionalLooseSeasonYear,
    season_to: optionalLooseSeasonYear,
});
export const statcastPitcherPitchMixArgsSchema = z.object({
    pitcher_mlbam: z.coerce.number().int().positive(),
    game_year: z.coerce.number().int().min(2010).max(2030),
});
export const statcastBatterBattedBallArgsSchema = z.object({
    batter_mlbam: z.coerce.number().int().positive(),
    game_year: z.coerce.number().int().min(2010).max(2030),
});
export const statcastSampleRowsArgsSchema = z.object({
    role: z.enum(['pitcher', 'batter']),
    mlbam: z.coerce.number().int().positive(),
    game_year: z.coerce.number().int().min(2010).max(2030),
    limit: z.number().int().min(1).max(200).nullable().optional(),
});
