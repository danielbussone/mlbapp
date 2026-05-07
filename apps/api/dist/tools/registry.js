import { comparePlayersCareer, stripComparePayloadForLlm } from '../repos/comparePlayers.js';
import { compareStatcastSummary } from '../repos/compareStatcastSummary.js';
import { getFgSeasonLines } from '../repos/fangraphsSeason.js';
import { leaderboardSortMetricsDoc } from '../leaderboard/catalog.js';
import { executeLeaderboardQuery } from '../repos/leaderboardQuery.js';
import { resolvePlayer, resolvePlayerIdFromQuery } from '../repos/players.js';
import { statcastBatterBattedBall, statcastPitcherPitchMix, statcastSampleRows, } from '../repos/statcast.js';
import { enrichToolArgs, parseArgs } from './argEnrichment.js';
import { comparePlayersCareerArgsSchema, getFgSeasonLineArgsSchema, resolvePlayerArgsSchema, statcastBatterBattedBallArgsSchema, statcastCompareStatcastArgsSchema, statcastPitcherPitchMixArgsSchema, statcastSampleRowsArgsSchema, leaderboardQueryArgsSchema, } from './schemas.js';
/** Ollama `/api/chat` `tools` array (JSON-schema functions). */
export const ollamaToolDefinitions = [
    {
        type: 'function',
        function: {
            name: 'resolve_player',
            description: 'Resolve a player to internal player_id, MLBAM (key_mlbam), and external ids. Use candidates[0].player_id (integer) with get_fg_season_line for FanGraphs season stats; use key_mlbam for Statcast tools. For two-player FG compare, prefer compare_players_career.',
            parameters: {
                type: 'object',
                properties: {
                    name_query: {
                        type: 'string',
                        description: 'Required unless key_mlbam or id_fangraphs set. Example: "Mike Trout".',
                    },
                    key_mlbam: { type: 'integer', description: 'MLB Advanced Media player id if known' },
                    id_fangraphs: { type: 'integer', description: 'FanGraphs IDfg if known' },
                    limit: { type: 'integer', description: 'Max candidates (default 8, max 25)' },
                },
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_fg_season_line',
            description: 'FanGraphs season lines from fg_batting_season_current or fg_pitching_season_current (deduped by latest ingest). Required: player_id from resolve_player, role batting|pitching. Optional: season (one year), or season_from+season_to, team, level. Omit season/season_from/season_to unless the user asked for a specific year — otherwise you get the most recent rows (ordered by season). Rows include rate_stat_qualified, war, avg, obp, slg, pa, hr, stats_jsonb, etc.',
            parameters: {
                type: 'object',
                required: ['player_id', 'role'],
                properties: {
                    player_id: {
                        type: 'integer',
                        description: 'Integer from resolve_player candidates[0].player_id, not a string placeholder.',
                    },
                    role: { type: 'string', enum: ['batting', 'pitching'] },
                    season: { type: 'integer', description: 'Single season year as integer, e.g. 2024' },
                    season_from: { type: 'integer' },
                    season_to: { type: 'integer' },
                    team: { type: 'string' },
                    level: { type: 'string', description: 'e.g. MLB' },
                    limit: { type: 'integer', description: 'Max rows (default 30)' },
                },
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'compare_players_career',
            description: 'Compare two players: resolves each name query to exactly one dim_player, then returns merged FanGraphs batting and pitching season rows for both (same payload shape as separate get_fg calls). After it returns, summarize the comparison in natural language from those rows; do not answer with code to parse the JSON.',
            parameters: {
                type: 'object',
                required: ['player_a_query', 'player_b_query'],
                properties: {
                    player_a_query: { type: 'string' },
                    player_b_query: { type: 'string' },
                    include_batting: { type: 'boolean', default: true },
                    include_pitching: { type: 'boolean', default: true },
                    season_from: { type: 'integer' },
                    season_to: { type: 'integer' },
                },
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'statcast_pitcher_pitch_mix',
            description: 'Statcast pitch-type usage and average velocity for one pitcher MLBAM in one game_year. Requires pitcher_mlbam from resolve_player.',
            parameters: {
                type: 'object',
                required: ['pitcher_mlbam', 'game_year'],
                properties: {
                    pitcher_mlbam: { type: 'integer' },
                    game_year: { type: 'integer' },
                },
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'statcast_batter_batted_ball',
            description: 'Statcast batted-ball summary for one batter MLBAM and game_year: BBE count, average EV/LA, Tango Tiger contact buckets (barrel/solid/flare/topped/under/weak), bucket percentages, and EV×LA scatter codes.',
            parameters: {
                type: 'object',
                required: ['batter_mlbam', 'game_year'],
                properties: {
                    batter_mlbam: { type: 'integer' },
                    game_year: { type: 'integer' },
                },
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'statcast_sample_rows',
            description: 'Recent Statcast pitch-level rows (speed, movement, batted-ball fields when present). Requires MLBAM and game_year; limit capped at 200.',
            parameters: {
                type: 'object',
                required: ['role', 'mlbam', 'game_year'],
                properties: {
                    role: { type: 'string', enum: ['pitcher', 'batter'] },
                    mlbam: { type: 'integer' },
                    game_year: { type: 'integer' },
                    limit: { type: 'integer' },
                },
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'statcast_compare_statcast_summary',
            description: 'Compare Statcast panels for two players resolved by name in one game_year (pitch mix + sample for pitchers; batted ball + bat path + sample for batters). Prefer after resolve_player when MLBAMs are unknown.',
            parameters: {
                type: 'object',
                required: ['player_a_query', 'player_b_query', 'game_year'],
                properties: {
                    player_a_query: { type: 'string' },
                    player_b_query: { type: 'string' },
                    game_year: { type: 'integer' },
                    role: { type: 'string', enum: ['pitcher', 'batter'] },
                },
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'leaderboard_query',
            description: `Rank MLB players from FanGraphs-backed career or single-season consolidated stats (not Statcast pitch-type leaderboards). **Stuff+, Location+, Pitching+ are not sort_metric values here** — only allowlisted keys (war, era, fip, k_pct, …). If the user asks for Stuff+ rankings, use a proxy (e.g. k_pct desc on fg_pitching_season) and say the API does not expose Stuff+ as a column. If the user did not clearly ask for career totals vs a single-season ranking (e.g. "all time" without which), ask one short clarifying question first — unless they already named a stat and season/year. **Offensive** rankings: fg_batting_* with **war** or **wrc_plus**, order **desc**. Do **not** use tto_rate_sum except for explicit TTO questions (order **desc**). Defense: def_runs / career_def_runs. **Pitching run prevention**: era or fip, order **asc**. **Pitching "stuff" proxies** (no Stuff+ column): **k_pct** order **desc** or **war** order **desc** — not era/fip unless they asked for ERA/FIP. For fg_batting_season use min_pa ≥ ~200 or qualified_only unless small samples are intended. Season filters: season_from/season_to (single year → set both). qualified_only uses FanGraphs qualification flags. Sort metrics per dataset: ${leaderboardSortMetricsDoc()}`,
            parameters: {
                type: 'object',
                required: ['dataset', 'sort_metric'],
                properties: {
                    dataset: {
                        type: 'string',
                        enum: [
                            'fg_batting_career',
                            'fg_pitching_career',
                            'fg_batting_season',
                            'fg_pitching_season',
                        ],
                    },
                    sort_metric: {
                        type: 'string',
                        description: 'Must be an allowed key for the dataset (not Stuff+/Location+/Pitching+). Examples: career_war, war, k_pct, tto_rate_sum, def_runs, career_def_runs, era, fip.',
                    },
                    order: { type: 'string', enum: ['asc', 'desc'] },
                    limit: { type: 'integer', description: 'Max rows 1–100, default 25' },
                    columns: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Optional display columns; omit for defaults.',
                    },
                    season_from: { type: 'integer' },
                    season_to: { type: 'integer' },
                    min_pa: { type: 'integer', description: 'Batting PA floor (career or season)' },
                    min_ip_outs: { type: 'integer', description: 'Pitching IP-outs floor' },
                    min_tbf: { type: 'integer', description: 'Pitching batters faced floor' },
                    qualified_only: { type: 'boolean' },
                    title: { type: 'string', description: 'Short table title for the UI' },
                },
            },
        },
    },
];
export async function executeTool(pool, name, rawArgs, ctx) {
    const merged = ctx ? enrichToolArgs(name, rawArgs, ctx) : rawArgs;
    const args = parseArgs(merged);
    switch (name) {
        case 'resolve_player': {
            const p = resolvePlayerArgsSchema.safeParse(args);
            if (!p.success) {
                return {
                    error: 'invalid_args',
                    details: p.error.flatten(),
                    hint: 'Pass name_query as a string (e.g. "Mike Trout") or key_mlbam / id_fangraphs as integers.',
                };
            }
            return resolvePlayer(pool, {
                name_query: p.data.name_query ?? null,
                key_mlbam: p.data.key_mlbam ?? null,
                id_fangraphs: p.data.id_fangraphs ?? null,
                limit: p.data.limit ?? null,
            });
        }
        case 'get_fg_season_line': {
            const p = getFgSeasonLineArgsSchema.safeParse(args);
            if (!p.success) {
                return {
                    error: 'invalid_args',
                    details: p.error.flatten(),
                    hint: 'player_id must be a positive integer from resolve_player. season must be an integer year (e.g. 2024).',
                };
            }
            const rows = await getFgSeasonLines(pool, {
                player_id: p.data.player_id,
                role: p.data.role,
                season: p.data.season ?? null,
                season_from: p.data.season_from ?? null,
                season_to: p.data.season_to ?? null,
                team: p.data.team ?? null,
                level: p.data.level ?? null,
                limit: p.data.limit ?? null,
            });
            if (rows.length === 0) {
                return {
                    rows,
                    meta: {
                        player_id: p.data.player_id,
                        role: p.data.role,
                        season: p.data.season ?? null,
                        season_from: p.data.season_from ?? null,
                        season_to: p.data.season_to ?? null,
                        note: 'No FanGraphs current-view rows for this filter. The player may still be resolved (see resolve_player); load or widen FG ETL / check id_fg vs player_external_identifier fangraphs id_value.',
                    },
                };
            }
            return { rows };
        }
        case 'compare_players_career': {
            const p = comparePlayersCareerArgsSchema.safeParse(args);
            if (!p.success) {
                return {
                    error: 'invalid_args',
                    details: p.error.flatten(),
                    hint: 'include_batting / include_pitching accept booleans or strings "true"/"false". season_from / season_to accept integers or digit-only year strings; omit or use 0 for full career. Years outside 1900–2032 are clamped.',
                };
            }
            const raw = await comparePlayersCareer(pool, {
                player_a_query: p.data.player_a_query,
                player_b_query: p.data.player_b_query,
                include_batting: p.data.include_batting ?? null,
                include_pitching: p.data.include_pitching ?? null,
                season_from: p.data.season_from ?? null,
                season_to: p.data.season_to ?? null,
            });
            return stripComparePayloadForLlm(raw);
        }
        case 'statcast_pitcher_pitch_mix': {
            const p = statcastPitcherPitchMixArgsSchema.safeParse(args);
            if (!p.success)
                return { error: 'invalid_args', details: p.error.flatten() };
            const rows = await statcastPitcherPitchMix(pool, p.data.pitcher_mlbam, p.data.game_year);
            return { rows };
        }
        case 'statcast_batter_batted_ball': {
            const p = statcastBatterBattedBallArgsSchema.safeParse(args);
            if (!p.success)
                return { error: 'invalid_args', details: p.error.flatten() };
            const summary = await statcastBatterBattedBall(pool, p.data.batter_mlbam, p.data.game_year);
            return { summary };
        }
        case 'statcast_sample_rows': {
            const p = statcastSampleRowsArgsSchema.safeParse(args);
            if (!p.success)
                return { error: 'invalid_args', details: p.error.flatten() };
            const rows = await statcastSampleRows(pool, {
                role: p.data.role,
                mlbam: p.data.mlbam,
                game_year: p.data.game_year,
                limit: p.data.limit ?? null,
            });
            return { rows };
        }
        case 'statcast_compare_statcast_summary': {
            const p = statcastCompareStatcastArgsSchema.safeParse(args);
            if (!p.success)
                return { error: 'invalid_args', details: p.error.flatten() };
            const ra = await resolvePlayerIdFromQuery(pool, p.data.player_a_query.trim());
            if ('error' in ra)
                return { error: ra.error, stage: 'resolve_a' };
            const rb = await resolvePlayerIdFromQuery(pool, p.data.player_b_query.trim());
            if ('error' in rb)
                return { error: rb.error, stage: 'resolve_b' };
            const role = p.data.role ?? 'pitcher';
            return compareStatcastSummary(pool, {
                player_ids: [ra.player_id, rb.player_id],
                role,
                game_year: p.data.game_year,
                enhanced: true,
            });
        }
        case 'leaderboard_query': {
            const p = leaderboardQueryArgsSchema.safeParse(args);
            if (!p.success) {
                return {
                    error: 'invalid_args',
                    details: p.error.flatten(),
                    hint: 'dataset must be fg_batting_career | fg_pitching_career | fg_batting_season | fg_pitching_season; sort_metric must match the dataset allowlist.',
                };
            }
            const out = await executeLeaderboardQuery(pool, {
                dataset: p.data.dataset,
                sort_metric: p.data.sort_metric.trim(),
                order: p.data.order ?? 'desc',
                limit: p.data.limit ?? 25,
                columns: p.data.columns,
                season_from: p.data.season_from,
                season_to: p.data.season_to,
                min_pa: p.data.min_pa,
                min_ip_outs: p.data.min_ip_outs,
                min_tbf: p.data.min_tbf,
                qualified_only: p.data.qualified_only,
                title: p.data.title,
            });
            if (!out.ok) {
                return {
                    error: out.error,
                    ...(out.allowed_sort_metrics != null ? { allowed_sort_metrics: out.allowed_sort_metrics } : {}),
                    ...(out.invalid_columns != null ? { invalid_columns: out.invalid_columns } : {}),
                };
            }
            return { leaderboard: out.leaderboard };
        }
        default:
            return { error: 'unknown_tool', name };
    }
}
/** Rows sent to the model after leaderboard_query (full table still goes to SSE + disk traces). */
const LLM_LEADERBOARD_ROW_CAP = 25;
/**
 * Shrinks leaderboard JSON in tool messages so follow-up Ollama rounds stay under context limits.
 * Does not change SSE or persistFullToolIo (those use the full executeTool payload).
 */
export function slimLeaderboardPayloadForLlm(payload) {
    if (!payload || typeof payload !== 'object')
        return payload;
    const rec = payload;
    if (rec.error != null)
        return payload;
    const lb = rec.leaderboard;
    if (!lb || typeof lb !== 'object')
        return payload;
    const board = lb;
    const rows = board.rows;
    if (!Array.isArray(rows))
        return payload;
    if (rows.length <= LLM_LEADERBOARD_ROW_CAP)
        return payload;
    return {
        ...rec,
        leaderboard: {
            ...board,
            rows: rows.slice(0, LLM_LEADERBOARD_ROW_CAP),
            _llm_truncation: {
                rows_shown: LLM_LEADERBOARD_ROW_CAP,
                rows_total: rows.length,
                note: 'UI shows the full table; summarize from these rows.',
            },
        },
    };
}
export function toolResultString(payload) {
    try {
        return JSON.stringify(payload);
    }
    catch {
        return String(payload);
    }
}
