import { comparePlayersCareer } from '../repos/comparePlayers.js';
import { getFgSeasonLines } from '../repos/fangraphsSeason.js';
import { resolvePlayer } from '../repos/players.js';
import { statcastBatterBattedBall, statcastPitcherPitchMix, statcastSampleRows, } from '../repos/statcast.js';
import { enrichToolArgs, parseArgs } from './argEnrichment.js';
import { comparePlayersCareerArgsSchema, getFgSeasonLineArgsSchema, resolvePlayerArgsSchema, statcastBatterBattedBallArgsSchema, statcastPitcherPitchMixArgsSchema, statcastSampleRowsArgsSchema, } from './schemas.js';
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
            description: 'FanGraphs season lines from fg_batting_season_current or fg_pitching_season_current (deduped by latest ingest). Required: player_id from resolve_player, role batting|pitching. Optional: season (one year), or season_from+season_to, team, level. Rows include rate_stat_qualified (MLB rate-stat bar at ingest), war, avg, obp, slg, pa, hr, stats_jsonb, etc.',
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
            description: 'Compare two players: resolves each name query to exactly one dim_player, then returns merged FanGraphs batting and pitching season rows for both (same payload shape as separate get_fg calls).',
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
            description: 'Statcast batted-ball event count and average exit velocity / launch angle for one batter MLBAM in one game_year.',
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
            return comparePlayersCareer(pool, {
                player_a_query: p.data.player_a_query,
                player_b_query: p.data.player_b_query,
                include_batting: p.data.include_batting ?? null,
                include_pitching: p.data.include_pitching ?? null,
                season_from: p.data.season_from ?? null,
                season_to: p.data.season_to ?? null,
            });
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
        default:
            return { error: 'unknown_tool', name };
    }
}
export function toolResultString(payload) {
    try {
        return JSON.stringify(payload);
    }
    catch {
        return String(payload);
    }
}
