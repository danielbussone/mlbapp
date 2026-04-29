import { narrowCandidatesByGenerationalHint, normalizePlayerNameQuery, stripGenerationalSuffixFromQuery, } from '../lib/playerNameQuery.js';
import { rowsToJson } from './rowJson.js';
const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 25;
const EXTERNEALS_SUB = `
  COALESCE(
    (SELECT json_agg(json_build_object('id_system', e.id_system, 'id_value', e.id_value) ORDER BY e.id_system)
     FROM player_external_identifier e WHERE e.player_id = p.player_id),
    '[]'::json
  ) AS externals
`;
const DOLLAR_TAG = 'xcmb';
/** Unicode combining marks U+0300–U+036F (built in TS so the SQL text stays ASCII-safe). */
const COMBINING_MARK_CLASS = `[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036f)}]`;
/**
 * Case- and accent-insensitive fold without the `unaccent` extension (UTF-8 DB, PG 13+).
 * `normalize(text, NFD)` — string first; `NFD` is a keyword, not `'NFD'`.
 * Dollar-quote the regex class so U+0300… never sit inside SQL `'…'` literals.
 */
function foldLowerSql(expr) {
    return `lower(regexp_replace(normalize(${expr}, NFD), $${DOLLAR_TAG}$${COMBINING_MARK_CLASS}$${DOLLAR_TAG}$, '', 'g'))`;
}
async function baseSelect(pool, whereSql, params, limit) {
    const q = `
    SELECT p.player_id, p.key_mlbam, p.name_first, p.name_last, p.birth_date,
           ${EXTERNEALS_SUB}
    FROM dim_player p
    WHERE ${whereSql}
    ORDER BY p.name_last, p.name_first, p.player_id
    LIMIT $${params.length + 1}
  `;
    const { rows } = await pool.query(q, [...params, limit]);
    return rowsToJson(rows);
}
export async function resolvePlayer(pool, input) {
    const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    if (input.key_mlbam != null && input.key_mlbam !== undefined) {
        const rows = await baseSelect(pool, 'p.key_mlbam = $1', [input.key_mlbam], limit);
        return { candidates: rows, match_type: 'key_mlbam' };
    }
    if (input.id_fangraphs != null && input.id_fangraphs !== undefined) {
        const rows = await baseSelect(pool, `EXISTS (
        SELECT 1 FROM player_external_identifier e
        WHERE e.player_id = p.player_id
          AND e.id_system = 'fangraphs'
          AND e.id_value = $1::text
      )`, [String(input.id_fangraphs)], limit);
        return { candidates: rows, match_type: 'id_fangraphs' };
    }
    const q = normalizePlayerNameQuery((input.name_query ?? '').trim());
    if (!q) {
        return {
            error: 'Provide name_query, key_mlbam, or id_fangraphs',
            candidates: [],
        };
    }
    const qMatch = stripGenerationalSuffixFromQuery(q) || q;
    const parts = qMatch.split(/\s+/).filter(Boolean);
    let rows = [];
    if (parts.length >= 2) {
        const a = `%${parts[0]}%`;
        const b = `%${parts.slice(1).join(' ')}%`;
        const f1 = foldLowerSql(`COALESCE(p.name_first, '')`);
        const f2 = foldLowerSql(`COALESCE(p.name_last, '')`);
        const p1 = foldLowerSql('$1::text');
        const p2 = foldLowerSql('$2::text');
        const { rows: r1 } = await pool.query(`
      SELECT p.player_id, p.key_mlbam, p.name_first, p.name_last, p.birth_date,
             ${EXTERNEALS_SUB}
      FROM dim_player p
      WHERE (
        ${f1} LIKE ${p1}
        AND ${f2} LIKE ${p2}
      )
         OR (
        ${f1} LIKE ${p2}
        AND ${f2} LIKE ${p1}
      )
      ORDER BY p.name_last, p.name_first, p.player_id
      LIMIT $3
      `, [a, b, limit]);
        rows = rowsToJson(r1);
    }
    if (rows.length === 0) {
        const t = `%${qMatch}%`;
        const fl = foldLowerSql(`COALESCE(p.name_last, '')`);
        const ff = foldLowerSql(`COALESCE(p.name_first, '')`);
        const pt = foldLowerSql('$1::text');
        const { rows: r2 } = await pool.query(`
      SELECT p.player_id, p.key_mlbam, p.name_first, p.name_last, p.birth_date,
             ${EXTERNEALS_SUB}
      FROM dim_player p
      WHERE ${fl} LIKE ${pt}
         OR ${ff} LIKE ${pt}
      ORDER BY p.name_last, p.name_first, p.player_id
      LIMIT $2
      `, [t, limit]);
        rows = rowsToJson(r2);
    }
    return { candidates: rows, match_type: 'name_query' };
}
/** Pick a single player_id when the model already resolved to one row. */
export async function getPlayerById(pool, playerId) {
    const rows = await getPlayersByIds(pool, [playerId]);
    return rows[0] ?? null;
}
export async function getPlayersByIds(pool, playerIds) {
    if (playerIds.length === 0)
        return [];
    const { rows } = await pool.query(`
    SELECT p.player_id, p.key_mlbam, p.name_first, p.name_last, p.birth_date,
           COALESCE(
             (SELECT json_agg(json_build_object('id_system', e.id_system, 'id_value', e.id_value) ORDER BY e.id_system)
              FROM player_external_identifier e WHERE e.player_id = p.player_id),
             '[]'::json
           ) AS externals
    FROM dim_player p
    WHERE p.player_id = ANY($1::bigint[])
    ORDER BY p.player_id
    `, [playerIds]);
    return rowsToJson(rows);
}
/**
 * FanGraphs-backed hints for UI disambiguation (season count + familiar team codes).
 */
export async function getFgCareerHintsForPlayerIds(pool, playerIds) {
    const ids = [...new Set(playerIds)].filter((n) => Number.isInteger(n) && n > 0);
    if (ids.length === 0)
        return [];
    const { rows } = await pool.query(`
    WITH seasons AS (
      SELECT DISTINCT s.player_id, s.season
      FROM (
        SELECT b.player_id, b.season::integer AS season
        FROM fg_batting_season_current b
        WHERE b.player_id = ANY($1::bigint[])
        UNION
        SELECT f.player_id, f.season::integer AS season
        FROM fg_pitching_season_current f
        WHERE f.player_id = ANY($1::bigint[])
      ) s
    ),
    season_counts AS (
      SELECT player_id, COUNT(*)::integer AS fg_seasons
      FROM seasons
      GROUP BY player_id
    ),
    team_games AS (
      SELECT player_id, TRIM(team) AS team, SUM(games)::bigint AS g
      FROM (
        SELECT player_id, team, games
        FROM fg_batting_season_current
        WHERE player_id = ANY($1::bigint[])
          AND team IS NOT NULL AND TRIM(team) <> ''
        UNION ALL
        SELECT player_id, team, games
        FROM fg_pitching_season_current
        WHERE player_id = ANY($1::bigint[])
          AND team IS NOT NULL AND TRIM(team) <> ''
      ) u
      GROUP BY player_id, team
    ),
    team_ranked AS (
      SELECT player_id, team,
             ROW_NUMBER() OVER (PARTITION BY player_id ORDER BY g DESC NULLS LAST) AS rn
      FROM team_games
    ),
    team_pick AS (
      SELECT player_id, string_agg(team, ', ' ORDER BY rn) AS teams_display
      FROM team_ranked
      WHERE rn <= 5
      GROUP BY player_id
    )
    SELECT
      pid.player_id::bigint AS player_id,
      COALESCE(sc.fg_seasons, 0)::integer AS fg_seasons,
      COALESCE(tp.teams_display, '') AS teams_display
    FROM unnest($1::bigint[]) AS pid(player_id)
    LEFT JOIN season_counts sc ON sc.player_id = pid.player_id
    LEFT JOIN team_pick tp ON tp.player_id = pid.player_id
    `, [ids]);
    return rowsToJson(rows).map((r) => ({
        player_id: Number(r.player_id),
        fg_seasons: Number(r.fg_seasons ?? 0),
        teams_display: String(r.teams_display ?? ''),
    }));
}
/** One-line copy for pick lists (e.g. “14 seasons with SEA and NYY”). */
export function formatCareerDisambiguationHint(h) {
    const n = h.fg_seasons;
    const raw = h.teams_display.trim();
    const parts = raw
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
    if (n <= 0) {
        return 'No FanGraphs MLB seasons on file';
    }
    const sez = n === 1 ? '1 season' : `${n} seasons`;
    if (parts.length === 0) {
        return `${sez} in database`;
    }
    let teamsPhrase;
    if (parts.length === 1) {
        teamsPhrase = parts[0];
    }
    else if (parts.length === 2) {
        teamsPhrase = `${parts[0]} and ${parts[1]}`;
    }
    else {
        teamsPhrase = `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
    }
    return `${sez} with ${teamsPhrase}`;
}
export async function resolvePlayerIdFromQuery(pool, name_query) {
    const r = await resolvePlayer(pool, { name_query, limit: 8 });
    let candidates = r.candidates;
    if (!candidates?.length) {
        return { error: `No player found for query: ${name_query}` };
    }
    candidates = narrowCandidatesByGenerationalHint(name_query, candidates);
    if (candidates.length > 1) {
        const detail = candidates
            .map((c) => `${String(c.name_first ?? '')} ${String(c.name_last ?? '')} (b. ${String(c.birth_date ?? '?')})`)
            .join('; ');
        return {
            error: `Ambiguous player query "${name_query}": ${candidates.length} matches (${detail}). Use key_mlbam or id_fangraphs, or add Sr/Jr/career hint.`,
        };
    }
    return { player_id: Number(candidates[0].player_id) };
}
