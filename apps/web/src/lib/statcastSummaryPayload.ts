/** One row from Statcast summary arrays (`mix`, `sample`, `velo_dist`, …). */
export type StatcastJsonRow = Record<string, unknown>;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isRole(v: unknown): v is 'pitcher' | 'batter' {
  return v === 'pitcher' || v === 'batter';
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function optionalRowArray(v: unknown): StatcastJsonRow[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) return undefined;
  for (const x of v) {
    if (!isPlainObject(x)) return undefined;
  }
  return v as StatcastJsonRow[];
}

function optionalRow(v: unknown): StatcastJsonRow | undefined {
  if (v === undefined) return undefined;
  if (!isPlainObject(v)) return undefined;
  return v;
}

/**
 * `/players/:id/statcast-summary` success body (see API `registerPlayersRoutes`).
 * Unknown extra keys from the API are preserved via spread from the parsed object.
 */
export type StatcastSummaryPayload = Record<string, unknown> & {
  player_id: number;
  role: 'pitcher' | 'batter';
  game_year: number;
  game_year_effective: number;
  key_mlbam: number | null;
  statcast_available: boolean;
  reason?: string;
  pitcher_throws?: string;
  mix?: StatcastJsonRow[];
  mix_extended?: StatcastJsonRow[];
  mix_extended_by_stand?: StatcastJsonRow[];
  velo_dist?: StatcastJsonRow[];
  league_avg_velo_by_pitch?: StatcastJsonRow[];
  league_movement?: StatcastJsonRow[];
  sample?: StatcastJsonRow[];
  batted_ball?: StatcastJsonRow;
  bat_path?: StatcastJsonRow;
};

export function parseStatcastSummaryPayload(
  raw: unknown
): { ok: true; value: StatcastSummaryPayload } | { ok: false; error: string } {
  if (!isPlainObject(raw)) {
    return { ok: false, error: 'expected object' };
  }
  const o = raw;
  if (!isFiniteNumber(o.player_id)) {
    return { ok: false, error: 'player_id must be a finite number' };
  }
  if (!isRole(o.role)) {
    return { ok: false, error: 'role must be pitcher | batter' };
  }
  if (!isFiniteNumber(o.game_year)) {
    return { ok: false, error: 'game_year must be a finite number' };
  }
  if (!isFiniteNumber(o.game_year_effective)) {
    return { ok: false, error: 'game_year_effective must be a finite number' };
  }
  const km = o.key_mlbam;
  if (!(km === null || isFiniteNumber(km))) {
    return { ok: false, error: 'key_mlbam must be number | null' };
  }
  if (o.statcast_available !== true && o.statcast_available !== false) {
    return { ok: false, error: 'statcast_available must be boolean' };
  }

  const mix = optionalRowArray(o.mix);
  const mix_extended = optionalRowArray(o.mix_extended);
  const mix_extended_by_stand = optionalRowArray(o.mix_extended_by_stand);
  const velo_dist = optionalRowArray(o.velo_dist);
  const league_avg_velo_by_pitch = optionalRowArray(o.league_avg_velo_by_pitch);
  const league_movement = optionalRowArray(o.league_movement);
  const sample = optionalRowArray(o.sample);
  const batted_ball = optionalRow(o.batted_ball);
  const bat_path = optionalRow(o.bat_path);

  if (mix === undefined && o.mix !== undefined) return { ok: false, error: 'mix must be array of objects' };
  if (mix_extended === undefined && o.mix_extended !== undefined) {
    return { ok: false, error: 'mix_extended must be array of objects' };
  }
  if (mix_extended_by_stand === undefined && o.mix_extended_by_stand !== undefined) {
    return { ok: false, error: 'mix_extended_by_stand must be array of objects' };
  }
  if (velo_dist === undefined && o.velo_dist !== undefined) {
    return { ok: false, error: 'velo_dist must be array of objects' };
  }
  if (league_avg_velo_by_pitch === undefined && o.league_avg_velo_by_pitch !== undefined) {
    return { ok: false, error: 'league_avg_velo_by_pitch must be array of objects' };
  }
  if (league_movement === undefined && o.league_movement !== undefined) {
    return { ok: false, error: 'league_movement must be array of objects' };
  }
  if (sample === undefined && o.sample !== undefined) {
    return { ok: false, error: 'sample must be array of objects' };
  }
  if (batted_ball === undefined && o.batted_ball !== undefined) {
    return { ok: false, error: 'batted_ball must be object' };
  }
  if (bat_path === undefined && o.bat_path !== undefined) {
    return { ok: false, error: 'bat_path must be object' };
  }

  return { ok: true, value: o as StatcastSummaryPayload };
}
