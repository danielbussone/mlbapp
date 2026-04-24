import type pg from 'pg';
import {
  clampGameYear,
  statcastBatterBatPathSummary,
  statcastBatterBattedBall,
  statcastPitcherPitchMix,
  statcastPitcherPitchMixExtended,
  statcastPitcherThrowsHand,
  statcastPitcherVeloHistogram,
  statcastSampleRows,
  statcastSummaryHasRenderableData,
} from './statcast.js';
import { getPlayerById, getPlayersByIds } from './players.js';

const MAX_COMPARE = 3;

export type CompareStatcastInput = {
  player_ids: number[];
  role: 'pitcher' | 'batter';
  game_year: number;
  /** When true, include mix_extended, velo_dist for pitchers. */
  enhanced?: boolean;
};

export async function compareStatcastSummary(
  pool: pg.Pool,
  input: CompareStatcastInput
): Promise<Record<string, unknown>> {
  const ids = [...new Set(input.player_ids)]
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, MAX_COMPARE);
  if (ids.length < 2) {
    return { error: 'Need at least two distinct valid player_ids', max: MAX_COMPARE };
  }

  const y = clampGameYear(input.game_year);
  const enhanced = input.enhanced !== false;
  const players = await getPlayersByIds(pool, ids);

  const blocks: Record<string, unknown>[] = [];
  for (const pid of ids) {
    const player = await getPlayerById(pool, pid);
    if (!player) {
      blocks.push({ player_id: pid, error: 'Player not found' });
      continue;
    }
    const mlbam = player.key_mlbam;
    if (mlbam == null || typeof mlbam !== 'number') {
      blocks.push({
        player_id: pid,
        key_mlbam: null,
        statcast_available: false,
        reason: 'Player has no key_mlbam',
      });
      continue;
    }

    const out: Record<string, unknown> = {
      player_id: pid,
      role: input.role,
      game_year: input.game_year,
      game_year_effective: y,
      key_mlbam: mlbam,
    };

    if (input.role === 'pitcher') {
      const [mixRows, mixExt, veloHist, sampleRows, pitcherThrows] = await Promise.all([
        statcastPitcherPitchMix(pool, mlbam, y),
        enhanced ? statcastPitcherPitchMixExtended(pool, mlbam, y) : Promise.resolve(undefined),
        enhanced ? statcastPitcherVeloHistogram(pool, mlbam, y) : Promise.resolve(undefined),
        statcastSampleRows(pool, { role: 'pitcher', mlbam, game_year: y, limit: 2000 }),
        statcastPitcherThrowsHand(pool, mlbam, y),
      ]);
      out.mix = mixRows;
      if (mixExt !== undefined) out.mix_extended = mixExt;
      if (veloHist !== undefined) out.velo_dist = veloHist;
      out.sample = sampleRows;
      if (pitcherThrows != null) out.pitcher_throws = pitcherThrows;
      const hasData = statcastSummaryHasRenderableData('pitcher', out, {
        mix: true,
        battedBall: false,
        sample: true,
        batPath: false,
        mixExtended: enhanced,
        veloDist: enhanced,
        leagueMovement: false,
      });
      out.statcast_available = hasData;
      if (!hasData) {
        out.reason = 'No Statcast pitch data for this player-year.';
        delete out.mix;
        delete out.sample;
        delete out.mix_extended;
        delete out.velo_dist;
        delete out.pitcher_throws;
      }
    } else {
      const [battedBall, batPath, sampleRows] = await Promise.all([
        statcastBatterBattedBall(pool, mlbam, y),
        statcastBatterBatPathSummary(pool, mlbam, y),
        statcastSampleRows(pool, { role: 'batter', mlbam, game_year: y, limit: 8000 }),
      ]);
      out.batted_ball = battedBall;
      out.bat_path = batPath;
      out.sample = sampleRows;
      const hasData = statcastSummaryHasRenderableData('batter', out, {
        mix: false,
        battedBall: true,
        sample: true,
        batPath: true,
      });
      out.statcast_available = hasData;
      if (!hasData) {
        out.reason = 'No Statcast batter data for this player-year.';
        delete out.batted_ball;
        delete out.bat_path;
        delete out.sample;
      }
    }
    blocks.push(out);
  }

  return { players, summaries: blocks, meta: { game_year_effective: y, role: input.role, enhanced } };
}
