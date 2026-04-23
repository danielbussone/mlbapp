import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getPool, hasDatabaseUrl } from '../db/pool.js';
import {
  getFgBattingCardPayload,
  getFgPitchingCardPayload,
  getFgRoleHintPayload,
} from '../repos/fangraphsCareer.js';
import { getFgSeasonLines, type FgRole } from '../repos/fangraphsSeason.js';
import { getPlayerById, resolvePlayer, resolvePlayerIdFromQuery } from '../repos/players.js';
import {
  clampGameYear,
  statcastBatterBatPathSummary,
  statcastBatterBattedBall,
  statcastPitcherPitchMix,
  statcastSampleRows,
  statcastSummaryHasRenderableData,
} from '../repos/statcast.js';

const fgSeasonQuerySchema = z.object({
  role: z.enum(['batting', 'pitching']),
  season: z.coerce.number().int().optional(),
  season_from: z.coerce.number().int().optional(),
  season_to: z.coerce.number().int().optional(),
  team: z.string().optional(),
  level: z.string().optional(),
  /** With `compare=1`, up to 120 rows (long careers + multi-team seasons). Otherwise max 30. */
  limit: z.coerce.number().int().min(1).max(120).optional(),
  compare: z.enum(['0', '1']).optional(),
});

const statcastSummaryQuerySchema = z.object({
  role: z.enum(['pitcher', 'batter']),
  game_year: z.coerce.number().int(),
  panel: z.enum(['mix', 'batted_ball', 'sample', 'bat_path']).optional(),
  limit: z.coerce.number().int().min(1).max(12_000).optional(),
});

const fgBattingCardQuerySchema = z.object({
  /** Consolidated season rows (newest first); capped in repo at 100. */
  last_seasons: z.coerce.number().int().min(1).max(100).optional().default(100),
  for_season: z.coerce.number().int().min(1900).max(2100).optional(),
});

function parsePlayerId(raw: string | undefined): number | null {
  if (raw == null) return null;
  const t = raw.trim();
  if (t === '' || !/^\d+$/.test(t)) return null;
  const n = Number(t);
  if (!Number.isSafeInteger(n) || n < 1) return null;
  return n;
}

const lookupMlbamQuerySchema = z.object({
  key_mlbam: z.coerce.number().int().positive(),
});

const namedPlayerQuerySchema = z.object({
  name_query: z.string().trim().min(1).max(200),
});

function dbUnavailable(reply: FastifyReply) {
  reply.code(503).send({ error: 'Database not configured', detail: 'Set DATABASE_URL' });
}

export function registerPlayersRoutes(app: FastifyInstance) {
  /** Resolve `dim_player` row by MLBAM (must be registered before `/players/:playerId`). */
  app.get('/players/lookup', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!hasDatabaseUrl()) {
      dbUnavailable(reply);
      return;
    }
    const parsed = lookupMlbamQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      reply.code(400).send({ error: 'Invalid query', details: parsed.error.flatten() });
      return;
    }
    try {
      const pool = getPool();
      const r = await resolvePlayer(pool, { key_mlbam: parsed.data.key_mlbam, limit: 8 });
      const candidates = (r.candidates as Record<string, unknown>[]) ?? [];
      if (candidates.length === 0) {
        reply.code(404).send({ error: 'No player found for key_mlbam' });
        return;
      }
      if (candidates.length > 1) {
        reply.code(409).send({
          error: 'Multiple players share this MLBAM; narrow with player_id from resolve_player',
          candidates,
        });
        return;
      }
      reply.send(candidates[0]);
    } catch (e) {
      req.log.error(e);
      reply.code(500).send({ error: 'Database error' });
    }
  });

  /** Resolve `dim_player.player_id` from a name string (must be before `/players/:playerId`). */
  app.get('/players/named', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!hasDatabaseUrl()) {
      dbUnavailable(reply);
      return;
    }
    const parsed = namedPlayerQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      reply.code(400).send({ error: 'Invalid query', details: parsed.error.flatten() });
      return;
    }
    try {
      const pool = getPool();
      const resolved = await resolvePlayerIdFromQuery(pool, parsed.data.name_query);
      if ('error' in resolved) {
        const ambiguous = resolved.error.startsWith('Ambiguous player query');
        reply.code(ambiguous ? 409 : 404).send({ error: resolved.error });
        return;
      }
      reply.send({ player_id: resolved.player_id });
    } catch (e) {
      req.log.error(e);
      reply.code(500).send({ error: 'Database error' });
    }
  });

  app.get('/players/:playerId', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!hasDatabaseUrl()) {
      dbUnavailable(reply);
      return;
    }
    const playerId = parsePlayerId((req.params as { playerId?: string }).playerId);
    if (playerId == null) {
      reply.code(400).send({ error: 'Invalid playerId' });
      return;
    }
    try {
      const pool = getPool();
      const row = await getPlayerById(pool, playerId);
      if (!row) {
        reply.code(404).send({ error: 'Player not found' });
        return;
      }
      reply.send(row);
    } catch (e) {
      req.log.error(e);
      reply.code(500).send({ error: 'Database error' });
    }
  });

  app.get('/players/:playerId/fg-season', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!hasDatabaseUrl()) {
      dbUnavailable(reply);
      return;
    }
    const playerId = parsePlayerId((req.params as { playerId?: string }).playerId);
    if (playerId == null) {
      reply.code(400).send({ error: 'Invalid playerId' });
      return;
    }
    const parsed = fgSeasonQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      reply.code(400).send({ error: 'Invalid query', details: parsed.error.flatten() });
      return;
    }
    const q = parsed.data;
    const compareMode = q.compare === '1';
    const cap = compareMode ? 120 : 30;
    const limitArg = q.limit != null ? Math.min(q.limit, cap) : null;
    try {
      const pool = getPool();
      const exists = await getPlayerById(pool, playerId);
      if (!exists) {
        reply.code(404).send({ error: 'Player not found' });
        return;
      }
      const rows = await getFgSeasonLines(pool, {
        player_id: playerId,
        role: q.role as FgRole,
        season: q.season ?? null,
        season_from: q.season_from ?? null,
        season_to: q.season_to ?? null,
        team: q.team ?? null,
        level: q.level ?? null,
        limit: limitArg,
        compare_mode: compareMode,
      });
      reply.send(rows);
    } catch (e) {
      req.log.error(e);
      reply.code(500).send({ error: 'Database error' });
    }
  });

  /**
   * FanGraphs batting career (`fg_batting_career_mlb`) + recent consolidated seasons
   * (`fg_batting_season_mlb_consolidated`). See docs/FG_CAREER_AGGREGATE_VIEWS.md.
   */
  app.get('/players/:playerId/fg-batting-card', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!hasDatabaseUrl()) {
      dbUnavailable(reply);
      return;
    }
    const playerId = parsePlayerId((req.params as { playerId?: string }).playerId);
    if (playerId == null) {
      reply.code(400).send({ error: 'Invalid playerId' });
      return;
    }
    const parsed = fgBattingCardQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      reply.code(400).send({ error: 'Invalid query', details: parsed.error.flatten() });
      return;
    }
    try {
      const pool = getPool();
      const exists = await getPlayerById(pool, playerId);
      if (!exists) {
        reply.code(404).send({ error: 'Player not found' });
        return;
      }
      const payload = await getFgBattingCardPayload(pool, playerId, {
        lastSeasons: parsed.data.last_seasons,
        forSeason: parsed.data.for_season ?? null,
      });
      reply.send(payload);
    } catch (e) {
      req.log.error(e);
      reply.code(500).send({ error: 'Database error' });
    }
  });

  /**
   * FanGraphs pitching career (`fg_pitching_career_mlb`) + recent consolidated seasons
   * (`fg_pitching_season_mlb_consolidated`). Same query params as fg-batting-card.
   */
  app.get('/players/:playerId/fg-pitching-card', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!hasDatabaseUrl()) {
      dbUnavailable(reply);
      return;
    }
    const playerId = parsePlayerId((req.params as { playerId?: string }).playerId);
    if (playerId == null) {
      reply.code(400).send({ error: 'Invalid playerId' });
      return;
    }
    const parsed = fgBattingCardQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      reply.code(400).send({ error: 'Invalid query', details: parsed.error.flatten() });
      return;
    }
    try {
      const pool = getPool();
      const exists = await getPlayerById(pool, playerId);
      if (!exists) {
        reply.code(404).send({ error: 'Player not found' });
        return;
      }
      const payload = await getFgPitchingCardPayload(pool, playerId, {
        lastSeasons: parsed.data.last_seasons,
        forSeason: parsed.data.for_season ?? null,
      });
      reply.send(payload);
    } catch (e) {
      req.log.error(e);
      reply.code(500).send({ error: 'Database error' });
    }
  });

  /**
   * Cheap FanGraphs career rows only (no consolidated season table scan) for batting vs pitching tab.
   * Prefer this over two `fg-*-card?last_seasons=1` calls from the client.
   */
  app.get('/players/:playerId/fg-card-role-hint', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!hasDatabaseUrl()) {
      dbUnavailable(reply);
      return;
    }
    const playerId = parsePlayerId((req.params as { playerId?: string }).playerId);
    if (playerId == null) {
      reply.code(400).send({ error: 'Invalid playerId' });
      return;
    }
    try {
      const pool = getPool();
      const exists = await getPlayerById(pool, playerId);
      if (!exists) {
        reply.code(404).send({ error: 'Player not found' });
        return;
      }
      const payload = await getFgRoleHintPayload(pool, playerId);
      reply.send(payload);
    } catch (e) {
      req.log.error(e);
      reply.code(500).send({ error: 'Database error' });
    }
  });

  app.get('/players/:playerId/statcast-summary', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!hasDatabaseUrl()) {
      dbUnavailable(reply);
      return;
    }
    const playerId = parsePlayerId((req.params as { playerId?: string }).playerId);
    if (playerId == null) {
      reply.code(400).send({ error: 'Invalid playerId' });
      return;
    }
    const parsed = statcastSummaryQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      reply.code(400).send({ error: 'Invalid query', details: parsed.error.flatten() });
      return;
    }
    const q = parsed.data;
    if (q.panel === 'batted_ball' && q.role === 'pitcher') {
      reply.code(400).send({ error: 'panel=batted_ball is only valid with role=batter' });
      return;
    }
    if (q.panel === 'mix' && q.role === 'batter') {
      reply.code(400).send({ error: 'panel=mix is only valid with role=pitcher' });
      return;
    }
    if (q.panel === 'bat_path' && q.role === 'pitcher') {
      reply.code(400).send({ error: 'panel=bat_path is only valid with role=batter' });
      return;
    }
    try {
      const pool = getPool();
      const player = await getPlayerById(pool, playerId);
      if (!player) {
        reply.code(404).send({ error: 'Player not found' });
        return;
      }
      const effectiveYear = clampGameYear(q.game_year);
      const mlbam = player.key_mlbam;
      if (mlbam == null || typeof mlbam !== 'number') {
        reply.send({
          player_id: playerId,
          role: q.role,
          game_year: q.game_year,
          game_year_effective: effectiveYear,
          key_mlbam: null,
          statcast_available: false,
          reason: 'Player has no key_mlbam (Chadwick / etl:chadwick)',
        });
        return;
      }

      const wantAll = q.panel == null;
      const wantMix = wantAll || q.panel === 'mix';
      const wantBatted = wantAll || q.panel === 'batted_ball';
      const wantSample = wantAll || q.panel === 'sample';
      const wantBatPath = wantAll || q.panel === 'bat_path';

      const out: Record<string, unknown> = {
        player_id: playerId,
        role: q.role,
        game_year: q.game_year,
        game_year_effective: effectiveYear,
        key_mlbam: mlbam,
      };

      if (q.role === 'pitcher') {
        const [mixRows, sampleRows] = await Promise.all([
          wantMix ? statcastPitcherPitchMix(pool, mlbam, effectiveYear) : Promise.resolve(undefined),
          wantSample
            ? statcastSampleRows(pool, {
                role: 'pitcher',
                mlbam,
                game_year: effectiveYear,
                limit: q.limit ?? null,
              })
            : Promise.resolve(undefined),
        ]);
        if (mixRows !== undefined) out.mix = mixRows;
        if (sampleRows !== undefined) out.sample = sampleRows;
      } else {
        const [battedBall, batPath, sampleRows] = await Promise.all([
          wantBatted ? statcastBatterBattedBall(pool, mlbam, effectiveYear) : Promise.resolve(undefined),
          wantBatPath ? statcastBatterBatPathSummary(pool, mlbam, effectiveYear) : Promise.resolve(undefined),
          wantSample
            ? statcastSampleRows(pool, {
                role: 'batter',
                mlbam,
                game_year: effectiveYear,
                limit: q.limit ?? null,
              })
            : Promise.resolve(undefined),
        ]);
        if (battedBall !== undefined) out.batted_ball = battedBall;
        if (batPath !== undefined) out.bat_path = batPath;
        if (sampleRows !== undefined) out.sample = sampleRows;
      }

      const hasData = statcastSummaryHasRenderableData(q.role, out, {
        mix: wantMix,
        battedBall: wantBatted,
        sample: wantSample,
        batPath: wantBatPath,
      });
      out.statcast_available = hasData;
      if (!hasData) {
        out.reason =
          'No Statcast-tracked pitches or batted balls in the database for this player in this season (typical for pre–Statcast careers or years with no ingest).';
        if (wantMix) delete out.mix;
        if (wantSample) delete out.sample;
        if (wantBatted) delete out.batted_ball;
        if (wantBatPath) delete out.bat_path;
      }

      reply.send(out);
    } catch (e) {
      req.log.error(e);
      reply.code(500).send({ error: 'Database error' });
    }
  });
}
