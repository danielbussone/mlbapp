import { normalizePlayerNameQuery } from '../lib/playerNameQuery.js';
/** Minimal JSON parse for Ollama `function.arguments`. */
export function parseArgs(raw) {
    if (raw == null)
        return {};
    if (typeof raw === 'string') {
        try {
            return JSON.parse(raw);
        }
        catch {
            return {};
        }
    }
    if (typeof raw === 'object')
        return raw;
    return {};
}
/** "Resolve Mike Trout and show ..." → Mike Trout */
export function inferNameQueryFromUserMessage(msg) {
    const r = msg.match(/\bresolve\s+(.+?)\s+\band\b/i);
    if (r)
        return r[1].trim();
    return null;
}
function lastSuccessfulResolvePayload(messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (String(m.role) !== 'tool' || String(m.tool_name) !== 'resolve_player')
            continue;
        const c = m.content;
        if (typeof c !== 'string')
            continue;
        try {
            const j = JSON.parse(c);
            if (j.error)
                continue;
            const candidates = j.candidates;
            if (candidates?.length && candidates[0]?.player_id != null)
                return j;
        }
        catch {
            continue;
        }
    }
    return null;
}
function toPositiveInt(v) {
    if (typeof v === 'number' && Number.isFinite(v) && v > 0)
        return Math.trunc(v);
    if (typeof v === 'string' && /^\d+$/.test(v.trim())) {
        const n = parseInt(v.trim(), 10);
        return Number.isFinite(n) && n > 0 ? n : null;
    }
    return null;
}
/**
 * Repair common small-model mistakes before Zod validation.
 * Uses the user message and prior tool rows already appended to `messages` this round.
 */
export function enrichToolArgs(name, rawArgs, ctx) {
    const base = { ...parseArgs(rawArgs) };
    if (name === 'resolve_player') {
        if (typeof base.name_query === 'string' && base.name_query.trim() !== '') {
            base.name_query = normalizePlayerNameQuery(base.name_query);
        }
        const has = (typeof base.name_query === 'string' && base.name_query.trim() !== '') ||
            toPositiveInt(base.key_mlbam) != null ||
            toPositiveInt(base.id_fangraphs) != null;
        if (!has && ctx.userMessage) {
            const q = inferNameQueryFromUserMessage(ctx.userMessage);
            if (q)
                return { ...base, name_query: normalizePlayerNameQuery(q) };
        }
        return base;
    }
    if (name === 'get_fg_season_line') {
        const r = lastSuccessfulResolvePayload(ctx.messages);
        const resolved = r?.candidates?.length === 1 ? toPositiveInt(r.candidates[0].player_id) : null;
        const got = toPositiveInt(base.player_id);
        // Models often pass a bogus small integer; a lone resolve candidate is authoritative.
        if (resolved != null && got !== resolved) {
            base.player_id = resolved;
        }
        else if (got == null && r?.candidates?.[0]?.player_id != null) {
            const n = toPositiveInt(r.candidates[0].player_id);
            if (n != null)
                base.player_id = n;
        }
        for (const k of ['season', 'season_from', 'season_to']) {
            const v = base[k];
            if (typeof v === 'string' && /^\d{4}$/.test(v.trim())) {
                base[k] = parseInt(v.trim(), 10);
            }
        }
        return base;
    }
    if (name === 'statcast_pitcher_pitch_mix') {
        if (typeof base.game_year === 'string' && /^\d{4}$/.test(base.game_year.trim())) {
            base.game_year = parseInt(base.game_year.trim(), 10);
        }
        return base;
    }
    if (name === 'statcast_batter_batted_ball') {
        if (typeof base.game_year === 'string' && /^\d{4}$/.test(base.game_year.trim())) {
            base.game_year = parseInt(base.game_year.trim(), 10);
        }
        return base;
    }
    if (name === 'statcast_sample_rows') {
        if (typeof base.game_year === 'string' && /^\d{4}$/.test(base.game_year.trim())) {
            base.game_year = parseInt(base.game_year.trim(), 10);
        }
        return base;
    }
    if (name === 'compare_players_career') {
        for (const k of ['season_from', 'season_to']) {
            const v = base[k];
            if (v === 0 || v === '0' || (typeof v === 'string' && v.trim() === '0')) {
                delete base[k];
            }
        }
        if (typeof base.player_a_query === 'string') {
            base.player_a_query = normalizePlayerNameQuery(base.player_a_query);
        }
        if (typeof base.player_b_query === 'string') {
            base.player_b_query = normalizePlayerNameQuery(base.player_b_query);
        }
        return base;
    }
    return rawArgs;
}
