import type pg from 'pg';
import {
  getFgBattingCardPayload,
  getFgPitchingCardPayload,
  pitcherJawsCohortRoleKey,
  playerFgPredicate,
} from './fangraphsCareer.js';
import { JAWS_BATTER_PRIMARY_POSITION_SCOPED_SQL } from './jawsBattingPrimaryPositionScoped.sql.js';

export const JAWS_EXPANDED_SPEC_VERSION = '2026.7';

export type JawsExpandedRole = 'batting' | 'pitching';

export type JawsExpandedResponse = {
  jaws_expanded_spec_version: typeof JAWS_EXPANDED_SPEC_VERSION;
  war_basis: 'fwar';
  role: JawsExpandedRole;
  position_key: string | null;
  position_label: string | null;
  player: {
    career_war: number | null;
    peak_war_fwar: number | null;
    jaws_fwar: number | null;
    war_per_162: number | null;
    /** UI label for ``war_per_162`` (batting: ``WAR/162``; pitching: IP-normalized e.g. ``WAR/200 IP``). */
    war_per_rate_suffix: string;
    career_pa: number | null;
    career_games: number | null;
  };
  cohort: {
    /** Players at this position/bucket with JAWS in the cohort matview. */
    cohort_n: number | null;
    /** 1 = highest JAWS among ``cohort_n`` (competition rank: 1 + count with strictly higher JAWS). */
    rank: number | null;
    /** Ordinal label for ``rank`` (e.g. ``22nd``). */
    rank_display: string | null;
    qualified: boolean;
    /** When qualified is false, a short human reason (UI); null when qualified. */
    unavailable_reason: string | null;
  };
  hof_average: {
    n: number;
    career_war: number | null;
    peak_war_fwar: number | null;
    jaws_fwar: number | null;
    war_per_162: number | null;
  } | null;
  notes: string[];
};

const BATTER_POS_LABEL: Record<string, string> = {
  C: 'Catcher',
  '1B': 'First Base',
  '2B': 'Second Base',
  '3B': 'Third Base',
  SS: 'Shortstop',
  LF: 'Left Field',
  CF: 'Center Field',
  RF: 'Right Field',
  DH: 'Designated Hitter',
};

const PITCHER_POS_LABEL: Record<string, string> = {
  SP: 'Starting Pitcher',
  RP: 'Relief Pitcher',
  SP_RP: 'SP/RP',
};

function num(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'bigint') return Number(v);
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** English ordinal for rank display (1 → ``1st``, 22 → ``22nd``). */
function ordinalRankLabel(r: number): string {
  if (!Number.isFinite(r) || r < 1) return String(r);
  const n = Math.floor(r);
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

function positionLabel(role: JawsExpandedRole, key: string | null): string | null {
  if (key == null) return null;
  if (role === 'batting') return BATTER_POS_LABEL[key] ?? key;
  return PITCHER_POS_LABEL[key] ?? key;
}

/** MLB Stats API ``primary_position_abbr`` → JAWS cohort key (fWAR matviews). */
function mapMlbPrimaryAbbrToJawsKey(abbr: unknown): string | null {
  if (abbr == null) return null;
  const u = String(abbr).trim().toUpperCase();
  if (!u) return null;
  if (u === 'P' || u === 'TWP' || u === 'PR' || u === 'UT' || u === 'IF' || u === 'UTIL') return null;
  if (u === 'OF') return 'CF';
  const allowed = new Set(['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH']);
  return allowed.has(u) ? u : null;
}

/**
 * HoF peer bucket for pitchers: many inductees are ``SP_RP`` in the FG heuristic; include them with
 * strict ``RP`` / ``SP`` subjects so percentiles and HoF averages are non-empty.
 */
function pitcherCohortRoleMatchSql(): string {
  return `(
    ($1::text = 'RP' AND m.jaws_position_key IN ('RP', 'SP_RP'))
    OR ($1::text = 'SP' AND m.jaws_position_key IN ('SP', 'SP_RP'))
    OR ($1::text = 'SP_RP' AND m.jaws_position_key = 'SP_RP')
  )`;
}

async function resolveBatterPositionFallbacks(pool: pg.Pool, playerId: number): Promise<string | null> {
  const { rows: bioRows } = await pool.query(
    `SELECT primary_position_abbr FROM player_bio_cache WHERE player_id = $1`,
    [playerId]
  );
  const fromBio = mapMlbPrimaryAbbrToJawsKey(bioRows[0]?.primary_position_abbr);
  if (fromBio != null) return fromBio;
  try {
    const { rows } = await pool.query(JAWS_BATTER_PRIMARY_POSITION_SCOPED_SQL, [playerId]);
    const k = rows[0]?.k;
    if (typeof k === 'string' && k.trim() !== '') return k.trim();
  } catch {
    // Missing tables (e.g. fresh env) — ignore
  }
  return null;
}

function warPer162(careerWar: number | null, careerGames: number | null): number | null {
  if (careerWar == null || careerGames == null || careerGames <= 0) return null;
  return (careerWar * 162) / careerGames;
}

/** IP target for pitcher WAR rate (fWAR × target / career IP); ``SP_RP`` uses midpoint of SP/RP workloads. */
const PITCHER_WAR_NORM_IP_SP = 200;
const PITCHER_WAR_NORM_IP_RP = 60;
const PITCHER_WAR_NORM_IP_SP_RP = (PITCHER_WAR_NORM_IP_SP + PITCHER_WAR_NORM_IP_RP) / 2;

function pitcherWarNormIpTarget(roleKey: string | null): number | null {
  if (roleKey === 'SP') return PITCHER_WAR_NORM_IP_SP;
  if (roleKey === 'RP') return PITCHER_WAR_NORM_IP_RP;
  if (roleKey === 'SP_RP') return PITCHER_WAR_NORM_IP_SP_RP;
  return null;
}

/** Display suffix for the pitcher rate column (matches ``pitcherWarNormIpTarget``). */
function pitcherWarPerRateSuffix(roleKey: string | null): string {
  if (roleKey === 'SP') return 'WAR/200 IP';
  if (roleKey === 'RP') return 'WAR/60 IP';
  if (roleKey === 'SP_RP') return 'WAR/130 IP';
  return 'WAR/162';
}

/**
 * Pitcher WAR rate: ``careerWAR × targetIP / careerIP`` (career IP from outs ÷ 3).
 * Falls back to games-based ``warPer162`` when IP or role bucket is missing.
 */
function pitcherWarPerIpNorm(
  careerWar: number | null,
  careerIpOuts: number | null,
  roleKey: string | null,
  fallbackGamesRate: number | null
): number | null {
  const targetIp = pitcherWarNormIpTarget(roleKey);
  if (careerWar == null || targetIp == null) return fallbackGamesRate;
  if (careerIpOuts == null || careerIpOuts <= 0) return fallbackGamesRate;
  const ipInn = careerIpOuts / 3.0;
  if (ipInn <= 0) return fallbackGamesRate;
  return (careerWar * targetIp) / ipInn;
}

/** Exported for unit tests (midrank CDF percentile, 0–100). */
export function jawsMidrankPercentile(values: number[], x: number): { n: number; p: number | null } {
  const sorted = [...values].filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return { n: 0, p: null };
  let below = 0;
  for (const v of sorted) {
    if (v < x) below += 1;
    else break;
  }
  let tied = 0;
  for (let i = below; i < n && sorted[i] === x; i += 1) tied += 1;
  return { n, p: Math.round((100 * (below + 0.5 * tied)) / n) };
}

async function mvExists(pool: pg.Pool, name: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM pg_matviews WHERE schemaname = 'public' AND matviewname = $1`,
    [name]
  );
  return rows.length > 0;
}

async function hofTableExists(pool: pg.Pool): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'hall_of_fame_player'`
  );
  return rows.length > 0;
}

/** When matviews omit a row (e.g. pre-V29 peak join), derive SP/RP/SP_RP from career GS/G only. */
async function resolvePitcherJawsRoleFromCareer(pool: pg.Pool, playerId: number): Promise<string | null> {
  const pred = playerFgPredicate('c');
  const { rows } = await pool.query(
    `SELECT c.career_games, c.career_games_started FROM fg_pitching_career_mlb c WHERE ${pred} LIMIT 1`,
    [playerId]
  );
  const r = rows[0] as { career_games: unknown; career_games_started: unknown } | undefined;
  if (r == null) return null;
  return pitcherJawsCohortRoleKey(r.career_games_started, r.career_games);
}

export async function getJawsExpanded(
  pool: pg.Pool,
  input: { player_id: number; role: JawsExpandedRole }
): Promise<JawsExpandedResponse> {
  const notes: string[] = [
    'JAWS uses FanGraphs WAR (fWAR), not Baseball-Reference rWAR; layout is BRef-style only.',
    'JAWS rank at the same primary position (batting) or SP/RP bucket (pitching) is among all cohort-qualified players in the FanGraphs matviews (1st = highest JAWS). Averages below are mean Hall of Famer stats at that spot when HoF data is loaded.',
    'Pitching WAR rate uses career IP: SP = fWAR per 200 IP, RP = per 60 IP, SP/RP = per 130 IP (midpoint); falls back to WAR/162 games when IP or role bucket is missing.',
  ];

  const [mvBat, mvPit, mvBatPrimaryPos, mvPitPrimaryRole, hofOk] = await Promise.all([
    mvExists(pool, 'mv_fg_batter_jaws_cohort'),
    mvExists(pool, 'mv_fg_pitcher_jaws_cohort'),
    mvExists(pool, 'mv_fg_batter_jaws_primary_pos'),
    mvExists(pool, 'mv_fg_pitcher_jaws_primary_role'),
    hofTableExists(pool),
  ]);
  if (input.role === 'batting' && !mvBat) {
    notes.push('mv_fg_batter_jaws_cohort is missing — run Flyway V26+ and REFRESH after FanGraphs ETL.');
    return buildFallbackFromCardOnly(pool, input, notes);
  }
  if (input.role === 'pitching' && !mvPit) {
    notes.push('mv_fg_pitcher_jaws_cohort is missing — run Flyway V26+ and REFRESH after FanGraphs ETL.');
    return buildFallbackFromCardOnly(pool, input, notes);
  }

  if (input.role === 'batting') {
    if (!mvBatPrimaryPos) {
      notes.push(
        'mv_fg_batter_jaws_primary_pos is missing (Flyway V28+): primary position falls back to the PA-filtered JAWS cohort row when present.'
      );
    }
    return getJawsExpandedBatting(pool, input.player_id, hofOk, notes, mvBatPrimaryPos);
  }
  if (!mvPitPrimaryRole) {
    notes.push(
      'mv_fg_pitcher_jaws_primary_role is missing (Flyway V28+): SP/RP bucket falls back to the games-filtered JAWS cohort row when present.'
    );
  }
  return getJawsExpandedPitching(pool, input.player_id, hofOk, notes, mvPitPrimaryRole);
}

async function buildFallbackFromCardOnly(
  pool: pg.Pool,
  input: { player_id: number; role: JawsExpandedRole },
  notes: string[]
): Promise<JawsExpandedResponse> {
  const stub = { lastSeasons: 1, forSeason: null as number | null, careerOnly: true as const };
  const card =
    input.role === 'pitching'
      ? await getFgPitchingCardPayload(pool, input.player_id, stub)
      : await getFgBattingCardPayload(pool, input.player_id, stub);
  const career = card.career as Record<string, unknown> | null;
  const cw = num(career?.career_war);
  const cg = num(career?.career_games);
  const pa = input.role === 'batting' ? num(career?.career_pa) : null;
  const jaws = card.jaws_fwar;
  const peak = card.peak_war_fwar;
  let fallbackWarPer: number | null = warPer162(cw, cg);
  let fallbackSuffix = 'WAR/162';
  if (input.role === 'pitching') {
    const ipo = num(career?.career_ip_outs);
    const rk = await resolvePitcherJawsRoleFromCareer(pool, input.player_id);
    fallbackWarPer = pitcherWarPerIpNorm(cw, ipo, rk, fallbackWarPer);
    fallbackSuffix = pitcherWarPerRateSuffix(rk);
  }
  return {
    jaws_expanded_spec_version: JAWS_EXPANDED_SPEC_VERSION,
    war_basis: 'fwar',
    role: input.role,
    position_key: null,
    position_label: null,
    player: {
      career_war: cw,
      peak_war_fwar: peak,
      jaws_fwar: jaws,
      war_per_162: fallbackWarPer,
      war_per_rate_suffix: fallbackSuffix,
      career_pa: pa,
      career_games: cg,
    },
    cohort: {
      cohort_n: null,
      rank: null,
      rank_display: null,
      qualified: false,
      unavailable_reason:
        'Cohort materialized views are missing — run Flyway V26+ and REFRESH after FanGraphs ETL.',
    },
    hof_average: null,
    notes,
  };
}

async function getJawsExpandedBatting(
  pool: pg.Pool,
  playerId: number,
  hofOk: boolean,
  notes: string[],
  hasPrimaryPosMv: boolean
): Promise<JawsExpandedResponse> {
  const { rows: subjRows } = await pool.query(
    `
    SELECT id_fg, career_pa, career_games, career_war, peak_war_fwar, jaws_fwar, war_per_162, jaws_position_key
    FROM mv_fg_batter_jaws_cohort
    WHERE player_id = $1
    ORDER BY career_pa DESC NULLS LAST
    LIMIT 1
    `,
    [playerId]
  );
  const subj = subjRows[0] as
    | {
        id_fg: number;
        career_pa: unknown;
        career_games: unknown;
        career_war: unknown;
        peak_war_fwar: unknown;
        jaws_fwar: unknown;
        war_per_162: unknown;
        jaws_position_key: string;
      }
    | undefined;

  let posKey: string | null = null;
  if (hasPrimaryPosMv) {
    const { rows: posRows } = await pool.query(
      `SELECT jaws_position_key AS k FROM mv_fg_batter_jaws_primary_pos WHERE player_id = $1 LIMIT 1`,
      [playerId]
    );
    const k = posRows[0]?.k;
    if (typeof k === 'string' && k.trim() !== '') posKey = k.trim();
  }
  if (posKey == null && subj?.jaws_position_key != null) {
    const k = String(subj.jaws_position_key).trim();
    if (k !== '') posKey = k;
  }
  if (posKey == null) {
    posKey = await resolveBatterPositionFallbacks(pool, playerId);
  }

  const stub = { lastSeasons: 1, forSeason: null as number | null, careerOnly: true as const };
  const card = await getFgBattingCardPayload(pool, playerId, stub);
  const career = card.career as Record<string, unknown> | null;
  const cw = num(career?.career_war);
  const cg = num(career?.career_games);
  const pa = num(career?.career_pa);
  const jawsCard = card.jaws_fwar;
  const peakCard = card.peak_war_fwar;

  const careerWar = subj != null ? num(subj.career_war) : cw;
  const careerGames = subj != null ? num(subj.career_games) : cg;
  const careerPa = subj != null ? num(subj.career_pa) : pa;
  const peakWar = subj != null ? num(subj.peak_war_fwar) : peakCard;
  const jaws = subj != null ? num(subj.jaws_fwar) : jawsCard;
  const w162 = subj != null ? num(subj.war_per_162) : warPer162(cw, cg);

  let cohortN: number | null = null;
  let rank: number | null = null;
  let qualified = false;

  if (posKey != null && jaws != null) {
    const { rows: rankRows } = await pool.query(
      `
      SELECT
        COUNT(*)::integer AS cohort_n,
        (COUNT(*) FILTER (WHERE m.jaws_fwar > $2::double precision)::integer + 1) AS rank
      FROM mv_fg_batter_jaws_cohort m
      WHERE m.jaws_position_key = $1
        AND m.jaws_fwar IS NOT NULL
      `,
      [posKey, jaws]
    );
    const rr = rankRows[0] as { cohort_n: number; rank: number } | undefined;
    cohortN = rr != null ? Number(rr.cohort_n) : null;
    rank = rr != null ? Number(rr.rank) : null;
    qualified = cohortN != null && cohortN > 0 && rank != null && Number.isFinite(rank);
  }

  let unavailableReason: string | null = null;
  if (!qualified) {
    if (posKey == null) {
      unavailableReason =
        'No primary fielding position mapped — check FanGraphs batting seasons (Pos), player_bio_cache after MLB bio fetch, Flyway V29+ matviews, and pnpm db:refresh-fg-mviews.';
    } else if (jaws == null) {
      unavailableReason = 'JAWS (fWAR) is missing; position rank cannot be computed.';
    } else if (cohortN === 0) {
      unavailableReason =
        'No players at this position with JAWS data in the cohort matview — run Flyway V26+ and pnpm db:refresh-fg-mviews after FanGraphs ETL.';
    } else {
      unavailableReason = 'JAWS rank at this position could not be computed.';
    }
  }

  const rankDisp = rank != null && Number.isFinite(rank) ? ordinalRankLabel(rank) : null;

  let hofAvg: JawsExpandedResponse['hof_average'] = null;
  if (hofOk && posKey != null) {
    const { rows: hRows } = await pool.query(
      `
      SELECT
        COUNT(*)::integer AS n,
        AVG(m.career_war)::float8 AS avg_cw,
        AVG(m.peak_war_fwar)::float8 AS avg_pk,
        AVG(m.jaws_fwar)::float8 AS avg_j,
        AVG(m.war_per_162)::float8 AS avg_w162
      FROM mv_fg_batter_jaws_cohort m
      INNER JOIN hall_of_fame_player h ON h.player_id = m.player_id
      WHERE m.jaws_position_key = $1
        AND m.jaws_fwar IS NOT NULL
      `,
      [posKey]
    );
    const hr = hRows[0] as {
      n: number;
      avg_cw: unknown;
      avg_pk: unknown;
      avg_j: unknown;
      avg_w162: unknown;
    };
    const hn = Number(hr?.n ?? 0);
    if (hn > 0) {
      hofAvg = {
        n: hn,
        career_war: num(hr.avg_cw),
        peak_war_fwar: num(hr.avg_pk),
        jaws_fwar: num(hr.avg_j),
        war_per_162: num(hr.avg_w162),
      };
    }
  } else if (!hofOk) {
    notes.push('hall_of_fame_player table missing — run Flyway V25 and pnpm etl:hall-of-fame.');
  }

  return {
    jaws_expanded_spec_version: JAWS_EXPANDED_SPEC_VERSION,
    war_basis: 'fwar',
    role: 'batting',
    position_key: posKey,
    position_label: positionLabel('batting', posKey),
    player: {
      career_war: careerWar,
      peak_war_fwar: peakWar,
      jaws_fwar: jaws,
      war_per_162: w162,
      war_per_rate_suffix: 'WAR/162',
      career_pa: careerPa,
      career_games: careerGames,
    },
    cohort: {
      cohort_n: cohortN,
      rank,
      rank_display: rankDisp,
      qualified,
      unavailable_reason: unavailableReason,
    },
    hof_average: hofAvg,
    notes,
  };
}

async function getJawsExpandedPitching(
  pool: pg.Pool,
  playerId: number,
  hofOk: boolean,
  notes: string[],
  hasPrimaryRoleMv: boolean
): Promise<JawsExpandedResponse> {
  const { rows: subjRows } = await pool.query(
    `
    SELECT id_fg, career_games, career_war, peak_war_fwar, jaws_fwar, war_per_162, jaws_position_key
    FROM mv_fg_pitcher_jaws_cohort
    WHERE player_id = $1
    ORDER BY career_games DESC NULLS LAST
    LIMIT 1
    `,
    [playerId]
  );
  const subj = subjRows[0] as
    | {
        career_games: unknown;
        career_war: unknown;
        peak_war_fwar: unknown;
        jaws_fwar: unknown;
        war_per_162: unknown;
        jaws_position_key: string;
      }
    | undefined;

  let posKey: string | null = null;
  if (hasPrimaryRoleMv) {
    const { rows: posRows } = await pool.query(
      `SELECT jaws_position_key AS k FROM mv_fg_pitcher_jaws_primary_role WHERE player_id = $1 LIMIT 1`,
      [playerId]
    );
    const k = posRows[0]?.k;
    if (typeof k === 'string' && k.trim() !== '') posKey = k.trim();
  }
  if (posKey == null && subj?.jaws_position_key != null) {
    const k = String(subj.jaws_position_key).trim();
    if (k !== '') posKey = k;
  }
  if (posKey == null) {
    posKey = await resolvePitcherJawsRoleFromCareer(pool, playerId);
  }

  const stub = { lastSeasons: 1, forSeason: null as number | null, careerOnly: true as const };
  const card = await getFgPitchingCardPayload(pool, playerId, stub);
  const career = card.career as Record<string, unknown> | null;
  const cw = num(career?.career_war);
  const cg = num(career?.career_games);
  const jawsCard = card.jaws_fwar;
  const peakCard = card.peak_war_fwar;

  const careerWar = subj != null ? num(subj.career_war) : cw;
  const careerGames = subj != null ? num(subj.career_games) : cg;
  const peakWar = subj != null ? num(subj.peak_war_fwar) : peakCard;
  const jaws = subj != null ? num(subj.jaws_fwar) : jawsCard;
  const ipOuts = num(career?.career_ip_outs);
  const fallbackGamesRate = subj != null ? num(subj.war_per_162) : warPer162(cw, cg);
  const w162 = pitcherWarPerIpNorm(careerWar, ipOuts, posKey, fallbackGamesRate);
  const warPerSuffix = pitcherWarPerRateSuffix(posKey);

  let cohortN: number | null = null;
  let rank: number | null = null;
  let qualified = false;
  if (posKey != null && jaws != null) {
    const { rows: rankRows } = await pool.query(
      `
      SELECT
        COUNT(*)::integer AS cohort_n,
        (COUNT(*) FILTER (WHERE m.jaws_fwar > $2::double precision)::integer + 1) AS rank
      FROM mv_fg_pitcher_jaws_cohort m
      WHERE ${pitcherCohortRoleMatchSql()}
        AND m.jaws_fwar IS NOT NULL
      `,
      [posKey, jaws]
    );
    const rr = rankRows[0] as { cohort_n: number; rank: number } | undefined;
    cohortN = rr != null ? Number(rr.cohort_n) : null;
    rank = rr != null ? Number(rr.rank) : null;
    qualified = cohortN != null && cohortN > 0 && rank != null && Number.isFinite(rank);
  }

  let unavailableReasonP: string | null = null;
  if (!qualified) {
    if (posKey == null) {
      unavailableReasonP =
        'No SP/RP bucket from career games/starts (heuristic needs enough MLB games). Apply Flyway V29 (role matview without peak-WAR gate), run pnpm db:refresh-fg-mviews, or check fg_pitching_career_mlb.';
    } else if (jaws == null) {
      unavailableReasonP = 'JAWS (fWAR) is missing; role rank cannot be computed.';
    } else if (cohortN === 0) {
      unavailableReasonP =
        'No pitchers in this SP/RP bucket with JAWS data in the cohort matview — run Flyway V26+ and pnpm db:refresh-fg-mviews after FanGraphs ETL.';
    } else {
      unavailableReasonP = 'JAWS rank in this role bucket could not be computed.';
    }
  }

  const rankDispP = rank != null && Number.isFinite(rank) ? ordinalRankLabel(rank) : null;

  let hofAvg: JawsExpandedResponse['hof_average'] = null;
  if (hofOk && posKey != null) {
    const { rows: hRows } = await pool.query(
      `
      SELECT
        COUNT(*)::integer AS n,
        AVG(m.career_war)::float8 AS avg_cw,
        AVG(m.peak_war_fwar)::float8 AS avg_pk,
        AVG(m.jaws_fwar)::float8 AS avg_j,
        AVG(
          CASE
            WHEN c.career_ip_outs IS NULL OR c.career_ip_outs <= 0 THEN NULL::float8
            WHEN m.jaws_position_key = 'SP' THEN (m.career_war::float8 * 200.0) / (c.career_ip_outs::float8 / 3.0)
            WHEN m.jaws_position_key = 'RP' THEN (m.career_war::float8 * 60.0) / (c.career_ip_outs::float8 / 3.0)
            WHEN m.jaws_position_key = 'SP_RP'
              THEN (m.career_war::float8 * 130.0) / (c.career_ip_outs::float8 / 3.0)
            ELSE NULL::float8
          END
        )::float8 AS avg_w162
      FROM mv_fg_pitcher_jaws_cohort m
      INNER JOIN hall_of_fame_player h ON h.player_id = m.player_id
      INNER JOIN fg_pitching_career_mlb c ON c.id_fg = m.id_fg
      WHERE ${pitcherCohortRoleMatchSql()}
        AND m.jaws_fwar IS NOT NULL
      `,
      [posKey]
    );
    const hr = hRows[0] as {
      n: number;
      avg_cw: unknown;
      avg_pk: unknown;
      avg_j: unknown;
      avg_w162: unknown;
    };
    const hn = Number(hr?.n ?? 0);
    if (hn > 0) {
      hofAvg = {
        n: hn,
        career_war: num(hr.avg_cw),
        peak_war_fwar: num(hr.avg_pk),
        jaws_fwar: num(hr.avg_j),
        war_per_162: num(hr.avg_w162),
      };
    }
  } else if (!hofOk) {
    notes.push('hall_of_fame_player table missing — run Flyway V25 and pnpm etl:hall-of-fame.');
  }

  return {
    jaws_expanded_spec_version: JAWS_EXPANDED_SPEC_VERSION,
    war_basis: 'fwar',
    role: 'pitching',
    position_key: posKey,
    position_label: positionLabel('pitching', posKey),
    player: {
      career_war: careerWar,
      peak_war_fwar: peakWar,
      jaws_fwar: jaws,
      war_per_162: w162,
      war_per_rate_suffix: warPerSuffix,
      career_pa: null,
      career_games: careerGames,
    },
    cohort: {
      cohort_n: cohortN,
      rank,
      rank_display: rankDispP,
      qualified,
      unavailable_reason: unavailableReasonP,
    },
    hof_average: hofAvg,
    notes,
  };
}
