import { inferExplicitSeasonYearFromUserMessage, inferPlayerNameQueryFromUserMessage } from '../lib/chatUserIntentArgs.js';
import { normalizePlayerNameQuery } from '../lib/playerNameQuery.js';

/** Minimal JSON parse for Ollama `function.arguments`. */
export function parseArgs(raw: unknown): unknown {
  if (raw == null) return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return {};
    }
  }
  if (typeof raw === 'object') return raw;
  return {};
}

export type ToolMessage = {
  role?: unknown;
  tool_name?: unknown;
  content?: unknown;
};

export type ToolContext = {
  userMessage: string;
  messages: ToolMessage[];
};

function lastSuccessfulResolvePayload(messages: ToolMessage[]): { candidates?: Array<{ player_id?: unknown }> } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (String(m.role) !== 'tool' || String(m.tool_name) !== 'resolve_player') continue;
    const c = m.content;
    if (typeof c !== 'string') continue;
    try {
      const j = JSON.parse(c) as Record<string, unknown>;
      if (j.error) continue;
      const candidates = j.candidates as Array<{ player_id?: unknown }> | undefined;
      if (candidates?.length && candidates[0]?.player_id != null) return j as { candidates: Array<{ player_id?: unknown }> };
    } catch {
      continue;
    }
  }
  return null;
}

function toPositiveInt(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.trunc(v);
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
export function enrichToolArgs(name: string, rawArgs: unknown, ctx: ToolContext): unknown {
  const base = { ...(parseArgs(rawArgs) as Record<string, unknown>) };

  if (name === 'resolve_player') {
    if (typeof base.name_query === 'string' && base.name_query.trim() !== '') {
      base.name_query = normalizePlayerNameQuery(base.name_query);
    }
    const has =
      (typeof base.name_query === 'string' && base.name_query.trim() !== '') ||
      toPositiveInt(base.key_mlbam) != null ||
      toPositiveInt(base.id_fangraphs) != null;
    if (!has && ctx.userMessage) {
      const q = inferPlayerNameQueryFromUserMessage(ctx.userMessage);
      if (q) return { ...base, name_query: q };
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
    } else if (got == null && r?.candidates?.[0]?.player_id != null) {
      const n = toPositiveInt(r.candidates[0].player_id);
      if (n != null) base.player_id = n;
    }
    for (const k of ['season', 'season_from', 'season_to'] as const) {
      const v = base[k];
      if (typeof v === 'string' && /^\d{4}$/.test(v.trim())) {
        base[k] = parseInt(v.trim(), 10);
      }
    }
    const explicitY = inferExplicitSeasonYearFromUserMessage(ctx.userMessage);
    if (explicitY != null) {
      base.season = explicitY;
      delete base.season_from;
      delete base.season_to;
    } else {
      delete base.season;
      delete base.season_from;
      delete base.season_to;
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
    const r = lastSuccessfulResolvePayload(ctx.messages);
    const mlbam = (r?.candidates?.[0] as Record<string, unknown> | undefined)?.key_mlbam;
    const mGot = toPositiveInt(base.batter_mlbam);
    const mResolved = toPositiveInt(mlbam);
    if (mResolved != null && mGot !== mResolved) {
      base.batter_mlbam = mResolved;
    } else if (mGot == null && mResolved != null) {
      base.batter_mlbam = mResolved;
    }
    const explicitY = inferExplicitSeasonYearFromUserMessage(ctx.userMessage);
    const cy = new Date().getFullYear();
    base.game_year = explicitY != null ? explicitY : Math.min(2032, Math.max(2010, cy));
    return base;
  }

  if (name === 'statcast_sample_rows') {
    if (typeof base.game_year === 'string' && /^\d{4}$/.test(base.game_year.trim())) {
      base.game_year = parseInt(base.game_year.trim(), 10);
    }
    const r = lastSuccessfulResolvePayload(ctx.messages);
    const cand0 = r?.candidates?.[0] as Record<string, unknown> | undefined;
    const mlbam = cand0?.key_mlbam;
    const mGot = toPositiveInt(base.mlbam);
    const mResolved = toPositiveInt(mlbam);
    if (base.role === 'batter') {
      if (mResolved != null && mGot !== mResolved) {
        base.mlbam = mResolved;
      } else if (mGot == null && mResolved != null) {
        base.mlbam = mResolved;
      }
      const explicitY = inferExplicitSeasonYearFromUserMessage(ctx.userMessage);
      const cy = new Date().getFullYear();
      base.game_year = explicitY != null ? explicitY : Math.min(2032, Math.max(2010, cy));
    }
    return base;
  }

  if (name === 'compare_players_career') {
    for (const k of ['season_from', 'season_to'] as const) {
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
