import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getPool, hasDatabaseUrl } from '../db/pool.js';
import {
  getFgBattingCardPayload,
  getFgPitchingCardPayload,
  getFgRoleHintPayload,
} from '../repos/fangraphsCareer.js';
import { getFgSeasonLines, type FgRole } from '../repos/fangraphsSeason.js';
import { compareFgCareer } from '../repos/compareFgCareer.js';
import { compareStatcastSummary } from '../repos/compareStatcastSummary.js';
import { getFgFieldingSeasonLines } from '../repos/fangraphsFielding.js';
import { narrowCandidatesByGenerationalHint } from '../lib/playerNameQuery.js';
import { getMlbBioPayload } from '../repos/playerMlbBio.js';
import {
  formatCareerDisambiguationHint,
  getFgCareerHintsForPlayerIds,
  getPlayerById,
  resolvePlayer,
  resolvePlayerIdFromQuery,
} from '../repos/players.js';
import {
  clampGameYear,
  statcastBatterBatPathSummary,
  statcastBatterBatPathTimeseries,
  statcastBatterBattedBall,
  statcastLeagueAvgVeloByPitchType,
  statcastLeagueMovementByYear,
  statcastPitcherMixByYearRange,
  statcastPitcherPitchMix,
  statcastPitcherPitchMixExtended,
  statcastPitcherPitchMixExtendedByBatterStand,
  statcastPitcherVeloHistogram,
  statcastPitcherThrowsHand,
  statcastSampleRows,
  statcastSummaryHasRenderableData,
} from '../repos/statcast.js';
import { statcastFieldingOaaCells } from '../repos/statcastFielding.js';
import { getLeaguePercentilesForPlayer } from '../repos/leaguePercentiles.js';
import { getJawsExpanded } from '../repos/jawsExpanded.js';

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
  panel: z
    .enum(['mix', 'batted_ball', 'sample', 'bat_path', 'mix_extended', 'velo_dist', 'league_movement'])
    .optional(),
  limit: z.coerce.number().int().min(1).max(12_000).optional(),
  /** When `1` (default), pitcher “all panels” includes mix_extended, velo_dist, league_movement. */
  enhanced: z.enum(['0', '1']).optional(),
});

const comparePlayerIdsSchema = z.object({
  player_ids: z
    .string()
    .min(1)
    .transform((s: string) =>
      s
        .split(',')
        .map((x: string) => Number.parseInt(x.trim(), 10))
        .filter((n: number) => Number.isInteger(n) && n > 0)
    )
    .refine((arr: number[]) => arr.length >= 2 && arr.length <= 4, 'player_ids must list 2–4 distinct numeric ids'),
});

const compareFgCareerQuerySchema = comparePlayerIdsSchema.extend({
  season: z.coerce.number().int().min(1900).max(2100).optional(),
});

const compareStatcastQuerySchema = comparePlayerIdsSchema.extend({
  role: z.enum(['pitcher', 'batter']),
  game_year: z.coerce.number().int(),
  enhanced: z.enum(['0', '1']).optional(),
});

const statcastTimeseriesQuerySchema = z.object({
  role: z.enum(['pitcher', 'batter']),
  metric: z.enum(['bat_path', 'pitch_mix']),
  from: z.coerce.number().int().min(1900).max(2100),
  to: z.coerce.number().int().min(1900).max(2100),
});

const fgFieldingQuerySchema = z.object({
  season: z.coerce.number().int().optional(),
  season_from: z.coerce.number().int().optional(),
  season_to: z.coerce.number().int().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const fieldingOaaQuerySchema = z.object({
  game_year: z.coerce.number().int(),
});

const leaguePercentilesQuerySchema = z.object({
  game_year: z.coerce.number().int(),
  role: z.enum(['batter', 'pitcher', 'fielding']),
  /** Ignored for `fielding` (server discovers positions); optional for other roles / legacy clients. */
  position: z.string().max(16).optional(),
});

const mlbBioQuerySchema = z.object({
  /** FanGraphs card season — used with warehouse birth_date for “season age” (July 1). */
  season: z.coerce.number().int().min(1900).max(2100).optional(),
});

const fgBattingCardQuerySchema = z.object({
  /** Consolidated season rows (newest first); capped in repo at 100. */
  last_seasons: z.coerce.number().int().min(1).max(100).optional().default(100),
  for_season: z.coerce.number().int().min(1900).max(2100).optional(),
});

const jawsExpandedQuerySchema = z.object({
  role: z.enum(['batting', 'pitching']),
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
        if (ambiguous) {
          const raw = await resolvePlayer(pool, { name_query: parsed.data.name_query, limit: 8 });
          let candidates = (raw.candidates as Record<string, unknown>[]) ?? [];
          candidates = narrowCandidatesByGenerationalHint(parsed.data.name_query, candidates);
          const pids = candidates
            .map((c) => Number(c.player_id))
            .filter((id) => Number.isFinite(id) && id > 0);
          const hints = await getFgCareerHintsForPlayerIds(pool, pids);
          const hintBy = new Map(hints.map((h) => [h.player_id, h]));
          const withHints = candidates.map((c) => {
            const pid = Number(c.player_id);
            const h = hintBy.get(pid);
            const career_hint = h ? formatCareerDisambiguationHint(h) : 'No FanGraphs MLB seasons on file';
            return { ...c, career_hint };
          });
          reply.code(409).send({ error: resolved.error, candidates: withHints });
          return;
        }
        reply.code(404).send({ error: resolved.error });
        return;
      }
      reply.send({ player_id: resolved.player_id });
    } catch (e) {
      req.log.error(e);
      reply.code(500).send({ error: 'Database error' });
    }
  });

  app.get('/players/compare/fg-career', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!hasDatabaseUrl()) {
      dbUnavailable(reply);
      return;
    }
    const parsed = compareFgCareerQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      reply.code(400).send({ error: 'Invalid query', details: parsed.error.flatten() });
      return;
    }
    try {
      const pool = getPool();
      const payload = await compareFgCareer(pool, {
        player_ids: parsed.data.player_ids,
        season: parsed.data.season ?? null,
      });
      if ('error' in payload) {
        reply.code(400).send(payload);
        return;
      }
      reply.send(payload);
    } catch (e) {
      req.log.error(e);
      reply.code(500).send({ error: 'Database error' });
    }
  });

  app.get('/players/compare/statcast-summary', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!hasDatabaseUrl()) {
      dbUnavailable(reply);
      return;
    }
    const parsed = compareStatcastQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      reply.code(400).send({ error: 'Invalid query', details: parsed.error.flatten() });
      return;
    }
    try {
      const pool = getPool();
      const enhanced = parsed.data.enhanced !== '0';
      const payload = await compareStatcastSummary(pool, {
        player_ids: parsed.data.player_ids,
        role: parsed.data.role,
        game_year: parsed.data.game_year,
        enhanced,
      });
      if ('error' in payload) {
        reply.code(400).send(payload);
        return;
      }
      reply.send(payload);
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

  /**
   * BRef-style JAWS block (fWAR): career / 7yr-peak / JAWS / WAR·162, midrank vs HoF at primary
   * position (materialized view), and mean HoF stats at that position (Lahman HOF table).
   */
  app.get('/players/:playerId/jaws-expanded', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!hasDatabaseUrl()) {
      dbUnavailable(reply);
      return;
    }
    const playerId = parsePlayerId((req.params as { playerId?: string }).playerId);
    if (playerId == null) {
      reply.code(400).send({ error: 'Invalid playerId' });
      return;
    }
    const parsed = jawsExpandedQuerySchema.safeParse(req.query ?? {});
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
      const payload = await getJawsExpanded(pool, {
        player_id: playerId,
        role: parsed.data.role,
      });
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
    const pitcherOnlyPanels = ['mix', 'mix_extended', 'velo_dist', 'league_movement'] as const;
    for (const p of pitcherOnlyPanels) {
      if (q.panel === p && q.role === 'batter') {
        reply.code(400).send({ error: `panel=${p} is only valid with role=pitcher` });
        return;
      }
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
      const enhanced = q.enhanced !== '0';
      const wantMix = wantAll || q.panel === 'mix';
      const wantBatchedMixExt = wantAll && enhanced;
      const wantMixExt = wantBatchedMixExt || q.panel === 'mix_extended';
      const wantVelo = wantBatchedMixExt || q.panel === 'velo_dist';
      const wantLeagueMov = wantBatchedMixExt || q.panel === 'league_movement';
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
        const pitcherThrows = await statcastPitcherThrowsHand(pool, mlbam, effectiveYear);
        if (pitcherThrows != null) out.pitcher_throws = pitcherThrows;

        const [mixRows, mixExt, mixExtByStand, veloHist, leagueVeloByPt, leagueMov, sampleRows] = await Promise.all([
          wantMix ? statcastPitcherPitchMix(pool, mlbam, effectiveYear) : Promise.resolve(undefined),
          wantMixExt ? statcastPitcherPitchMixExtended(pool, mlbam, effectiveYear) : Promise.resolve(undefined),
          wantMixExt
            ? statcastPitcherPitchMixExtendedByBatterStand(pool, mlbam, effectiveYear)
            : Promise.resolve(undefined),
          wantVelo ? statcastPitcherVeloHistogram(pool, mlbam, effectiveYear) : Promise.resolve(undefined),
          wantVelo ? statcastLeagueAvgVeloByPitchType(pool, effectiveYear) : Promise.resolve(undefined),
          wantLeagueMov
            ? statcastLeagueMovementByYear(pool, effectiveYear, pitcherThrows)
            : Promise.resolve(undefined),
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
        if (mixExt !== undefined) out.mix_extended = mixExt;
        if (mixExtByStand !== undefined) out.mix_extended_by_stand = mixExtByStand;
        if (veloHist !== undefined) out.velo_dist = veloHist;
        if (leagueVeloByPt !== undefined) out.league_avg_velo_by_pitch = leagueVeloByPt;
        if (leagueMov !== undefined) out.league_movement = leagueMov;
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
        mixExtended: wantMixExt,
        veloDist: wantVelo,
        leagueMovement: wantLeagueMov,
      });
      out.statcast_available = hasData;
      if (!hasData) {
        out.reason =
          'No Statcast-tracked pitches or batted balls in the database for this player in this season (typical for pre–Statcast careers or years with no ingest).';
        if (wantMix) delete out.mix;
        if (wantMixExt) delete out.mix_extended;
        if (wantMixExt) delete out.mix_extended_by_stand;
        if (wantVelo) delete out.velo_dist;
        if (wantVelo) delete out.league_avg_velo_by_pitch;
        if (wantLeagueMov) delete out.league_movement;
        if (wantSample) delete out.sample;
        delete out.pitcher_throws;
        if (wantBatted) delete out.batted_ball;
        if (wantBatPath) delete out.bat_path;
      }

      reply.send(out);
    } catch (e) {
      req.log.error(e);
      reply.code(500).send({ error: 'Database error' });
    }
  });

  app.get('/players/:playerId/statcast-timeseries', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!hasDatabaseUrl()) {
      dbUnavailable(reply);
      return;
    }
    const playerId = parsePlayerId((req.params as { playerId?: string }).playerId);
    if (playerId == null) {
      reply.code(400).send({ error: 'Invalid playerId' });
      return;
    }
    const parsed = statcastTimeseriesQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      reply.code(400).send({ error: 'Invalid query', details: parsed.error.flatten() });
      return;
    }
    try {
      const pool = getPool();
      const player = await getPlayerById(pool, playerId);
      if (!player) {
        reply.code(404).send({ error: 'Player not found' });
        return;
      }
      const mlbam = player.key_mlbam;
      if (mlbam == null || typeof mlbam !== 'number') {
        reply.code(400).send({ error: 'Player has no key_mlbam' });
        return;
      }
      const { role, metric, from, to } = parsed.data;
      if (role === 'batter' && metric === 'pitch_mix') {
        reply.code(400).send({ error: 'pitch_mix timeseries requires role=pitcher' });
        return;
      }
      if (role === 'pitcher' && metric === 'bat_path') {
        reply.code(400).send({ error: 'bat_path timeseries requires role=batter' });
        return;
      }
      if (role === 'batter' && metric === 'bat_path') {
        const rows = await statcastBatterBatPathTimeseries(pool, mlbam, from, to);
        reply.send({ player_id: playerId, key_mlbam: mlbam, role, metric, from, to, rows });
        return;
      }
      if (role === 'pitcher' && metric === 'pitch_mix') {
        const rows = await statcastPitcherMixByYearRange(pool, mlbam, from, to);
        reply.send({ player_id: playerId, key_mlbam: mlbam, role, metric, from, to, rows });
        return;
      }
      reply.code(400).send({ error: 'metric/role combination not supported' });
    } catch (e) {
      req.log.error(e);
      reply.code(500).send({ error: 'Database error' });
    }
  });

  app.get('/players/:playerId/fg-fielding', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!hasDatabaseUrl()) {
      dbUnavailable(reply);
      return;
    }
    const playerId = parsePlayerId((req.params as { playerId?: string }).playerId);
    if (playerId == null) {
      reply.code(400).send({ error: 'Invalid playerId' });
      return;
    }
    const parsed = fgFieldingQuerySchema.safeParse(req.query ?? {});
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
      const rows = await getFgFieldingSeasonLines(pool, {
        player_id: playerId,
        season: parsed.data.season ?? null,
        season_from: parsed.data.season_from ?? null,
        season_to: parsed.data.season_to ?? null,
        limit: parsed.data.limit ?? null,
      });
      reply.send({ player_id: playerId, rows });
    } catch (e) {
      req.log.error(e);
      reply.code(500).send({ error: 'Database error' });
    }
  });

  app.get('/players/:playerId/fielding-oaa', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!hasDatabaseUrl()) {
      dbUnavailable(reply);
      return;
    }
    const playerId = parsePlayerId((req.params as { playerId?: string }).playerId);
    if (playerId == null) {
      reply.code(400).send({ error: 'Invalid playerId' });
      return;
    }
    const parsed = fieldingOaaQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      reply.code(400).send({ error: 'Invalid query', details: parsed.error.flatten() });
      return;
    }
    try {
      const pool = getPool();
      const player = await getPlayerById(pool, playerId);
      if (!player) {
        reply.code(404).send({ error: 'Player not found' });
        return;
      }
      const mlbam = player.key_mlbam;
      if (mlbam == null || typeof mlbam !== 'number') {
        reply.code(400).send({ error: 'Player has no key_mlbam' });
        return;
      }
      const cells = await statcastFieldingOaaCells(pool, mlbam, parsed.data.game_year);
      reply.send({
        player_id: playerId,
        key_mlbam: mlbam,
        game_year: parsed.data.game_year,
        game_year_effective: clampGameYear(parsed.data.game_year),
        cells,
      });
    } catch (e) {
      req.log.error(e);
      reply.code(500).send({ error: 'Database error' });
    }
  });

  app.get('/players/:playerId/league-percentiles', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!hasDatabaseUrl()) {
      dbUnavailable(reply);
      return;
    }
    const playerId = parsePlayerId((req.params as { playerId?: string }).playerId);
    if (playerId == null) {
      reply.code(400).send({ error: 'Invalid playerId' });
      return;
    }
    const parsed = leaguePercentilesQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      reply.code(400).send({ error: 'Invalid query', details: parsed.error.flatten() });
      return;
    }
    try {
      const pool = getPool();
      const player = await getPlayerById(pool, playerId);
      if (!player) {
        reply.code(404).send({ error: 'Player not found' });
        return;
      }
      const gy = clampGameYear(parsed.data.game_year);
      const mlbam = player.key_mlbam;
      const payload = await getLeaguePercentilesForPlayer(pool, {
        player_id: playerId,
        key_mlbam: typeof mlbam === 'number' && Number.isFinite(mlbam) ? mlbam : null,
        game_year: gy,
        role: parsed.data.role,
        position: parsed.data.position ?? null,
      });
      reply.send({
        player_id: playerId,
        key_mlbam: typeof mlbam === 'number' && Number.isFinite(mlbam) ? mlbam : null,
        ...payload,
      });
    } catch (e) {
      req.log.error(e);
      reply.code(500).send({ error: 'Database error' });
    }
  });

  /**
   * MLB Stats API snapshot bio (read-through `player_bio_cache`, 24h TTL).
   * Requires `dim_player.key_mlbam`; 404 if absent.
   */
  app.get('/players/:playerId/mlb-bio', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!hasDatabaseUrl()) {
      dbUnavailable(reply);
      return;
    }
    const playerId = parsePlayerId((req.params as { playerId?: string }).playerId);
    if (playerId == null) {
      reply.code(400).send({ error: 'Invalid playerId' });
      return;
    }
    const parsed = mlbBioQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      reply.code(400).send({ error: 'Invalid query', details: parsed.error.flatten() });
      return;
    }
    try {
      const pool = getPool();
      const player = await getPlayerById(pool, playerId);
      if (!player) {
        reply.code(404).send({ error: 'Player not found' });
        return;
      }
      const mlbam = player.key_mlbam;
      const birth =
        player.birth_date != null && player.birth_date !== ''
          ? String(player.birth_date).slice(0, 10)
          : null;
      const seasonYear =
        parsed.data.season != null ? parsed.data.season : new Date().getFullYear();
      const r = await getMlbBioPayload(
        pool,
        playerId,
        typeof mlbam === 'number' ? mlbam : null,
        birth,
        seasonYear
      );
      if (!r.ok) {
        if (r.reason === 'no_mlbam') {
          reply.code(404).send({ error: 'Player has no MLBAM id' });
          return;
        }
        if (r.reason === 'fetch_failed') {
          reply.code(503).send({ error: 'MLB Stats API unavailable' });
          return;
        }
        reply.code(500).send({ error: 'Unexpected bio error' });
        return;
      }
      reply.send(r.payload);
    } catch (e) {
      req.log.error(e);
      reply.code(500).send({ error: 'Database error' });
    }
  });

  /** Register after all `/players/:playerId/...` routes so the router prefers concrete paths. */
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
}
