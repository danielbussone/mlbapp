import type pg from 'pg';
import {
  battingFgSeasonEarlyQualifiedPa,
  cohortPeerFloorForQualifiedMin,
  PITCH_TYPE_NON_PROVISIONAL_TYPE_PITCHES,
} from './leaguePercentilesQualification.js';
import { buildPercentileSlot } from './leaguePercentilesPayload.js';
import type { PercentileSlot } from './leaguePercentilesTypes.js';
import { directionForMetric } from './leaguePercentilesMetricDirection.js';

function num(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'bigint') return Number(v);
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function int(v: unknown): number | null {
  const n = num(v);
  return n == null ? null : Math.trunc(n);
}

function midrankPercentile(cohortValues: number[], x: number): number | null {
  if (cohortValues.length === 0 || !Number.isFinite(x)) return null;
  let below = 0;
  let tied = 0;
  for (const v of cohortValues) {
    if (v < x) below += 1;
    else if (v === x) tied += 1;
  }
  return Math.round((100 * (below + 0.5 * tied)) / cohortValues.length);
}

function slotFg(
  metricId: string,
  pct: number | null,
  n: number | null,
  qualified: boolean,
  value: number | null
): PercentileSlot {
  const cohortOk = (n ?? 0) > 0;
  return buildPercentileSlot({
    percentile: pct,
    cohortN: n,
    qualified: Boolean(qualified) && value != null && cohortOk,
    value,
    direction: directionForMetric(metricId),
  });
}

/** FanGraphs rate fields are usually 0–1 in JSON; display as 0–100 with one decimal like K%. */
function fgRate01ToDisplayPercent(v: number | null): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  if (Math.abs(v) > 1.5) return Math.round(v * 10) / 10;
  return Math.round(v * 10000) / 100;
}

type FgPitchDiscRow = {
  player_id: unknown;
  fbv: unknown;
  era: unknown;
  fip: unknown;
  babip: unknown;
  gb_pct: unknown;
  hr_fb_pct: unknown;
  o_swing_pct: unknown;
  swstr_pct: unknown;
  zone_pct: unknown;
  iffb_pct: unknown;
  hard_pct: unknown;
  stuff_plus: unknown;
  location_plus: unknown;
  pitching_plus: unknown;
};

function cohortNums(rows: FgPitchDiscRow[], col: keyof Omit<FgPitchDiscRow, 'player_id'>): number[] {
  const out: number[] = [];
  for (const r of rows) {
    const x = num(r[col]);
    if (x != null) out.push(x);
  }
  return out;
}

/**
 * Match ``fg_pitching_season_mlb_merged_stats`` / Flyway merge views: row ``player_id`` is often null
 * until linked; cohort joins must use Fangraphs id → ``player_external_identifier``.
 */
const FG_PITCH_SEASON_RESOLVED_PLAYER_ID = `COALESCE(
  f.player_id,
  (
    SELECT pe.player_id
    FROM player_external_identifier pe
    WHERE pe.id_system = 'fangraphs'
      AND pe.id_value = f.id_fg::text
    ORDER BY pe.player_id
    LIMIT 1
  )
)`;

/** FanGraphs majors API stores season ``Stuff+`` / ``Location+`` / ``Pitching+`` as ``sp_stuff`` / ``sp_location`` / ``sp_pitching`` in ``stats_jsonb``; older rows may use the literal ``+`` column names. */
const FG_JSON_SEASON_STUFF_PLUS = `COALESCE(
  (NULLIF(TRIM(f.stats_jsonb->>'Stuff+'), ''))::float8,
  (NULLIF(TRIM(f.stats_jsonb->>'sp_stuff'), ''))::float8
)`;
const FG_JSON_SEASON_LOCATION_PLUS = `COALESCE(
  (NULLIF(TRIM(f.stats_jsonb->>'Location+'), ''))::float8,
  (NULLIF(TRIM(f.stats_jsonb->>'sp_location'), ''))::float8
)`;
const FG_JSON_SEASON_PITCHING_PLUS = `COALESCE(
  (NULLIF(TRIM(f.stats_jsonb->>'Pitching+'), ''))::float8,
  (NULLIF(TRIM(f.stats_jsonb->>'sp_pitching'), ''))::float8
)`;

async function fetchFgPitchingPlateDisciplineSlots(
  pool: pg.Pool,
  input: { season: number; player_id: number; cohortTbf: number; qualPit: boolean }
): Promise<Record<string, PercentileSlot>> {
  const { season, player_id, cohortTbf, qualPit } = input;
  const discSql = `
    WITH qual AS (
      SELECT player_id
      FROM fg_pitching_season_mlb_merged_stats
      WHERE season = $1 AND tbf >= $2 AND player_id IS NOT NULL
    ),
    rep AS (
      SELECT DISTINCT ON (${FG_PITCH_SEASON_RESOLVED_PLAYER_ID})
        ${FG_PITCH_SEASON_RESOLVED_PLAYER_ID} AS player_id,
        COALESCE(f.vfa::float8, (NULLIF(TRIM(f.stats_jsonb->>'FBv'), ''))::float8) AS fbv,
        f.era::float8 AS era,
        f.fip::float8 AS fip,
        COALESCE(
          f.babip::float8,
          (NULLIF(TRIM(f.stats_jsonb->>'BABIP'), ''))::float8
        ) AS babip,
        COALESCE(
          f.gb_pct::float8,
          (NULLIF(TRIM(f.stats_jsonb->>'GB%'), ''))::float8
        ) AS gb_pct,
        COALESCE(
          f.hr_fb_pct::float8,
          (NULLIF(TRIM(f.stats_jsonb->>'HR/FB'), ''))::float8
        ) AS hr_fb_pct,
        (NULLIF(TRIM(f.stats_jsonb->>'O-Swing%'), ''))::float8 AS o_swing_pct,
        (NULLIF(TRIM(f.stats_jsonb->>'SwStr%'), ''))::float8 AS swstr_pct,
        (NULLIF(TRIM(f.stats_jsonb->>'Zone%'), ''))::float8 AS zone_pct,
        (NULLIF(TRIM(f.stats_jsonb->>'IFFB%'), ''))::float8 AS iffb_pct,
        (NULLIF(TRIM(f.stats_jsonb->>'Hard%'), ''))::float8 AS hard_pct,
        ${FG_JSON_SEASON_STUFF_PLUS} AS stuff_plus,
        ${FG_JSON_SEASON_LOCATION_PLUS} AS location_plus,
        ${FG_JSON_SEASON_PITCHING_PLUS} AS pitching_plus
      FROM fg_pitching_season_current f
      INNER JOIN qual q ON q.player_id = ${FG_PITCH_SEASON_RESOLVED_PLAYER_ID} AND f.season = $1
      WHERE f.level = 'MLB'
      ORDER BY ${FG_PITCH_SEASON_RESOLVED_PLAYER_ID}, CASE WHEN f.team = 'TOT' THEN 0 ELSE 1 END, f.team
    )
    SELECT * FROM rep
  `;
  const [{ rows: cohortRows }, { rows: prow }] = await Promise.all([
    pool.query(discSql, [season, cohortTbf]),
    pool.query(
      `
      SELECT DISTINCT ON (${FG_PITCH_SEASON_RESOLVED_PLAYER_ID})
        COALESCE(f.vfa::float8, (NULLIF(TRIM(f.stats_jsonb->>'FBv'), ''))::float8) AS fbv,
        f.era::float8 AS era,
        f.fip::float8 AS fip,
        COALESCE(
          f.babip::float8,
          (NULLIF(TRIM(f.stats_jsonb->>'BABIP'), ''))::float8
        ) AS babip,
        COALESCE(
          f.gb_pct::float8,
          (NULLIF(TRIM(f.stats_jsonb->>'GB%'), ''))::float8
        ) AS gb_pct,
        COALESCE(
          f.hr_fb_pct::float8,
          (NULLIF(TRIM(f.stats_jsonb->>'HR/FB'), ''))::float8
        ) AS hr_fb_pct,
        (NULLIF(TRIM(f.stats_jsonb->>'O-Swing%'), ''))::float8 AS o_swing_pct,
        (NULLIF(TRIM(f.stats_jsonb->>'SwStr%'), ''))::float8 AS swstr_pct,
        (NULLIF(TRIM(f.stats_jsonb->>'Zone%'), ''))::float8 AS zone_pct,
        (NULLIF(TRIM(f.stats_jsonb->>'IFFB%'), ''))::float8 AS iffb_pct,
        (NULLIF(TRIM(f.stats_jsonb->>'Hard%'), ''))::float8 AS hard_pct,
        ${FG_JSON_SEASON_STUFF_PLUS} AS stuff_plus,
        ${FG_JSON_SEASON_LOCATION_PLUS} AS location_plus,
        ${FG_JSON_SEASON_PITCHING_PLUS} AS pitching_plus
      FROM fg_pitching_season_current f
      WHERE f.season = $1 AND f.level = 'MLB' AND ${FG_PITCH_SEASON_RESOLVED_PLAYER_ID} = $2
      ORDER BY ${FG_PITCH_SEASON_RESOLVED_PLAYER_ID}, CASE WHEN f.team = 'TOT' THEN 0 ELSE 1 END, f.team
      LIMIT 1
      `,
      [season, player_id]
    ),
  ]);
  const cr = cohortRows as FgPitchDiscRow[];
  const p = (prow[0] ?? {}) as FgPitchDiscRow;

  const fbv = num(p.fbv);
  const era = num(p.era);
  const fip = num(p.fip);
  const babip = num(p.babip);
  const gb = num(p.gb_pct);
  const hrfb = num(p.hr_fb_pct);
  const osw = num(p.o_swing_pct);
  const swstr = num(p.swstr_pct);
  const zone = num(p.zone_pct);
  const iffb = num(p.iffb_pct);
  const hard = num(p.hard_pct);
  const stuffPlus = num(p.stuff_plus);
  const locationPlus = num(p.location_plus);
  const pitchingPlus = num(p.pitching_plus);

  const fbvArr = cohortNums(cr, 'fbv');
  const babipArr = cohortNums(cr, 'babip');
  const gbArr = cohortNums(cr, 'gb_pct');
  const hrfbArr = cohortNums(cr, 'hr_fb_pct');
  const oswArr = cohortNums(cr, 'o_swing_pct');
  const swstrArr = cohortNums(cr, 'swstr_pct');
  const zoneArr = cohortNums(cr, 'zone_pct');
  const iffbArr = cohortNums(cr, 'iffb_pct');
  const hardArr = cohortNums(cr, 'hard_pct');
  const eraArr = cohortNums(cr, 'era');
  const fipArr = cohortNums(cr, 'fip');
  const stuffPlusArr = cohortNums(cr, 'stuff_plus');
  const locationPlusArr = cohortNums(cr, 'location_plus');
  const pitchingPlusArr = cohortNums(cr, 'pitching_plus');

  return {
    fg_season_pit_fbv: slotFg(
      'fg_season_pit_fbv',
      fbv != null ? midrankPercentile(fbvArr, fbv) : null,
      fbvArr.length,
      qualPit,
      fbv != null ? Math.round(fbv * 10) / 10 : null
    ),
    fg_season_pit_fg_o_swing_pct: slotFg(
      'fg_season_pit_fg_o_swing_pct',
      osw != null ? midrankPercentile(oswArr, osw) : null,
      oswArr.length,
      qualPit,
      fgRate01ToDisplayPercent(osw)
    ),
    fg_season_pit_fg_swstr_pct: slotFg(
      'fg_season_pit_fg_swstr_pct',
      swstr != null ? midrankPercentile(swstrArr, swstr) : null,
      swstrArr.length,
      qualPit,
      fgRate01ToDisplayPercent(swstr)
    ),
    fg_season_pit_fg_zone_pct: slotFg(
      'fg_season_pit_fg_zone_pct',
      zone != null ? midrankPercentile(zoneArr, zone) : null,
      zoneArr.length,
      qualPit,
      fgRate01ToDisplayPercent(zone)
    ),
    fg_season_pit_fg_gb_pct: slotFg(
      'fg_season_pit_fg_gb_pct',
      gb != null ? midrankPercentile(gbArr, gb) : null,
      gbArr.length,
      qualPit,
      fgRate01ToDisplayPercent(gb)
    ),
    fg_season_pit_fg_iffb_pct: slotFg(
      'fg_season_pit_fg_iffb_pct',
      iffb != null ? midrankPercentile(iffbArr, iffb) : null,
      iffbArr.length,
      qualPit,
      fgRate01ToDisplayPercent(iffb)
    ),
    fg_season_pit_fg_hard_pct: slotFg(
      'fg_season_pit_fg_hard_pct',
      hard != null ? midrankPercentile(hardArr, hard) : null,
      hardArr.length,
      qualPit,
      fgRate01ToDisplayPercent(hard)
    ),
    fg_season_pit_hr_fb_pct: slotFg(
      'fg_season_pit_hr_fb_pct',
      hrfb != null ? midrankPercentile(hrfbArr, hrfb) : null,
      hrfbArr.length,
      qualPit,
      fgRate01ToDisplayPercent(hrfb)
    ),
    fg_season_pit_babip: slotFg(
      'fg_season_pit_babip',
      babip != null ? midrankPercentile(babipArr, babip) : null,
      babipArr.length,
      qualPit,
      babip != null ? Math.round(babip * 1000) / 1000 : null
    ),
    fg_season_pit_era: slotFg(
      'fg_season_pit_era',
      era != null ? midrankPercentile(eraArr, era) : null,
      eraArr.length,
      qualPit,
      era != null ? Math.round(era * 100) / 100 : null
    ),
    fg_season_pit_fip: slotFg(
      'fg_season_pit_fip',
      fip != null ? midrankPercentile(fipArr, fip) : null,
      fipArr.length,
      qualPit,
      fip != null ? Math.round(fip * 100) / 100 : null
    ),
    fg_season_pit_stuff_plus: slotFg(
      'fg_season_pit_stuff_plus',
      stuffPlus != null ? midrankPercentile(stuffPlusArr, stuffPlus) : null,
      stuffPlusArr.length,
      qualPit,
      stuffPlus != null ? Math.round(stuffPlus * 10) / 10 : null
    ),
    fg_season_pit_location_plus: slotFg(
      'fg_season_pit_location_plus',
      locationPlus != null ? midrankPercentile(locationPlusArr, locationPlus) : null,
      locationPlusArr.length,
      qualPit,
      locationPlus != null ? Math.round(locationPlus * 10) / 10 : null
    ),
    fg_season_pit_pitching_plus: slotFg(
      'fg_season_pit_pitching_plus',
      pitchingPlus != null ? midrankPercentile(pitchingPlusArr, pitchingPlus) : null,
      pitchingPlusArr.length,
      qualPit,
      pitchingPlus != null ? Math.round(pitchingPlus * 10) / 10 : null
    ),
  };
}

export async function fetchSavantFgBattingSeason(
  pool: pg.Pool,
  input: { season: number; player_id: number; min_pa: number }
): Promise<Record<string, PercentileSlot>> {
  const { season, player_id, min_pa } = input;
  const minPa = Math.max(1, min_pa);
  const cohortPa = cohortPeerFloorForQualifiedMin(minPa);
  const cohortWhere = `season = $1 AND pa >= ${cohortPa} AND player_id IS NOT NULL`;
  const cohortConsolidatedWhere = `season = $1 AND level = 'MLB' AND pa >= ${cohortPa} AND player_id IS NOT NULL`;
  const kExpr = `COALESCE(k_pct, k_pct_from_so)::float8`;

  const [
    { rows: pr },
    xwC,
    wobaC,
    wrcC,
    kC,
    bbC,
    avgC,
    slgC,
    isoC,
    { rows: consRows },
    bsrC,
    offC,
    defC,
    warBatC,
  ] = await Promise.all([
    pool.query(
      `SELECT xwoba_pa_weighted, woba_pa_weighted, wrc_plus_pa_weighted, pa, k_pct, bb_pct, season_avg, season_slg, k_pct_from_so
       FROM fg_batting_season_mlb_merged_rates
       WHERE player_id = $2 AND season = $1`,
      [season, player_id]
    ),
    pool.query(
      `SELECT xwoba_pa_weighted::float8 AS v FROM fg_batting_season_mlb_merged_rates
       WHERE ${cohortWhere} AND xwoba_pa_weighted IS NOT NULL`,
      [season]
    ),
    pool.query(
      `SELECT woba_pa_weighted::float8 AS v FROM fg_batting_season_mlb_merged_rates
       WHERE ${cohortWhere} AND woba_pa_weighted IS NOT NULL`,
      [season]
    ),
    pool.query(
      `SELECT wrc_plus_pa_weighted::float8 AS v FROM fg_batting_season_mlb_merged_rates
       WHERE ${cohortWhere} AND wrc_plus_pa_weighted IS NOT NULL`,
      [season]
    ),
    pool.query(
      `SELECT ${kExpr} AS v FROM fg_batting_season_mlb_merged_rates
       WHERE ${cohortWhere} AND (k_pct IS NOT NULL OR k_pct_from_so IS NOT NULL)`,
      [season]
    ),
    pool.query(
      `SELECT bb_pct::float8 AS v FROM fg_batting_season_mlb_merged_rates
       WHERE ${cohortWhere} AND bb_pct IS NOT NULL`,
      [season]
    ),
    pool.query(
      `SELECT season_avg::float8 AS v FROM fg_batting_season_mlb_merged_rates
       WHERE ${cohortWhere} AND season_avg IS NOT NULL`,
      [season]
    ),
    pool.query(
      `SELECT season_slg::float8 AS v FROM fg_batting_season_mlb_merged_rates
       WHERE ${cohortWhere} AND season_slg IS NOT NULL`,
      [season]
    ),
    pool.query(
      `SELECT (season_slg::numeric - season_avg::numeric)::float8 AS v
       FROM fg_batting_season_mlb_merged_rates
       WHERE ${cohortWhere} AND season_slg IS NOT NULL AND season_avg IS NOT NULL`,
      [season]
    ),
    pool.query(
      `SELECT pa, bsr, off_runs, def_runs, war
       FROM fg_batting_season_mlb_consolidated
       WHERE player_id = $2 AND season = $1 AND level = 'MLB'`,
      [season, player_id]
    ),
    pool.query(
      `SELECT bsr::float8 AS v FROM fg_batting_season_mlb_consolidated
       WHERE ${cohortConsolidatedWhere} AND bsr IS NOT NULL`,
      [season]
    ),
    pool.query(
      `SELECT off_runs::float8 AS v FROM fg_batting_season_mlb_consolidated
       WHERE ${cohortConsolidatedWhere} AND off_runs IS NOT NULL`,
      [season]
    ),
    pool.query(
      `SELECT def_runs::float8 AS v FROM fg_batting_season_mlb_consolidated
       WHERE ${cohortConsolidatedWhere} AND def_runs IS NOT NULL`,
      [season]
    ),
    pool.query(
      `SELECT war::float8 AS v FROM fg_batting_season_mlb_consolidated
       WHERE ${cohortConsolidatedWhere} AND war IS NOT NULL`,
      [season]
    ),
  ]);

  const pRow = (pr[0] ?? {}) as Record<string, unknown>;
  const pa = int(pRow.pa) ?? 0;
  const xw = num(pRow.xwoba_pa_weighted);
  const woba = num(pRow.woba_pa_weighted);
  const wrcPlus = num(pRow.wrc_plus_pa_weighted);
  const kPct = num(pRow.k_pct) ?? num(pRow.k_pct_from_so);
  const bbPct = num(pRow.bb_pct);
  const avg = num(pRow.season_avg);
  const slg = num(pRow.season_slg);
  const iso = avg != null && slg != null ? slg - avg : null;

  const xwArr = xwC.rows.map((r) => num((r as { v: unknown }).v)).filter((x): x is number => x != null);
  const wobaArr = wobaC.rows.map((r) => num((r as { v: unknown }).v)).filter((x): x is number => x != null);
  const wrcArr = wrcC.rows.map((r) => num((r as { v: unknown }).v)).filter((x): x is number => x != null);
  const kArr = kC.rows.map((r) => num((r as { v: unknown }).v)).filter((x): x is number => x != null);
  const bbArr = bbC.rows.map((r) => num((r as { v: unknown }).v)).filter((x): x is number => x != null);
  const avgArr = avgC.rows.map((r) => num((r as { v: unknown }).v)).filter((x): x is number => x != null);
  const slgArr = slgC.rows.map((r) => num((r as { v: unknown }).v)).filter((x): x is number => x != null);
  const isoArr = isoC.rows.map((r) => num((r as { v: unknown }).v)).filter((x): x is number => x != null);

  const qualBat = pa >= minPa;
  /** Non-provisional once PA ≥ 10% of the prorated full-season bar (`battingFgSeasonEarlyQualifiedPa`). */
  const qualFgEarly = qualBat || pa >= battingFgSeasonEarlyQualifiedPa(minPa);

  const cRow = (consRows[0] ?? {}) as Record<string, unknown>;
  const paC = int(cRow.pa) ?? 0;
  const bsr = num(cRow.bsr);
  const off = num(cRow.off_runs);
  const defR = num(cRow.def_runs);
  const warBat = num(cRow.war);
  const bsrArr = bsrC.rows.map((r) => num((r as { v: unknown }).v)).filter((x): x is number => x != null);
  const offArr = offC.rows.map((r) => num((r as { v: unknown }).v)).filter((x): x is number => x != null);
  const defArr = defC.rows.map((r) => num((r as { v: unknown }).v)).filter((x): x is number => x != null);
  const warBatArr = warBatC.rows.map((r) => num((r as { v: unknown }).v)).filter((x): x is number => x != null);
  const qualFgValue = paC >= minPa || paC >= battingFgSeasonEarlyQualifiedPa(minPa);

  return {
    fg_season_bsr: slotFg(
      'fg_season_bsr',
      bsr != null ? midrankPercentile(bsrArr, bsr) : null,
      bsrArr.length,
      qualFgValue,
      bsr
    ),
    fg_season_off: slotFg(
      'fg_season_off',
      off != null ? midrankPercentile(offArr, off) : null,
      offArr.length,
      qualFgValue,
      off
    ),
    fg_season_def: slotFg(
      'fg_season_def',
      defR != null ? midrankPercentile(defArr, defR) : null,
      defArr.length,
      qualFgValue,
      defR
    ),
    fg_season_bat_war: slotFg(
      'fg_season_bat_war',
      warBat != null ? midrankPercentile(warBatArr, warBat) : null,
      warBatArr.length,
      qualFgValue,
      warBat
    ),
    fg_season_xwoba: slotFg(
      'fg_season_xwoba',
      xw != null ? midrankPercentile(xwArr, xw) : null,
      xwArr.length,
      qualFgEarly,
      xw
    ),
    fg_season_woba: slotFg(
      'fg_season_woba',
      woba != null ? midrankPercentile(wobaArr, woba) : null,
      wobaArr.length,
      qualFgEarly,
      woba
    ),
    fg_season_wrc_plus: slotFg(
      'fg_season_wrc_plus',
      wrcPlus != null ? midrankPercentile(wrcArr, wrcPlus) : null,
      wrcArr.length,
      qualFgEarly,
      wrcPlus != null ? Math.round(wrcPlus * 10) / 10 : null
    ),
    fg_season_k_pct: slotFg(
      'fg_season_k_pct',
      kPct != null ? midrankPercentile(kArr, kPct) : null,
      kArr.length,
      qualFgEarly,
      kPct != null ? Math.round(kPct * 10000) / 100 : null
    ),
    fg_season_bb_pct: slotFg(
      'fg_season_bb_pct',
      bbPct != null ? midrankPercentile(bbArr, bbPct) : null,
      bbArr.length,
      qualFgEarly,
      bbPct != null ? Math.round(bbPct * 10000) / 100 : null
    ),
    fg_season_avg: slotFg(
      'fg_season_avg',
      avg != null ? midrankPercentile(avgArr, avg) : null,
      avgArr.length,
      qualFgEarly,
      avg != null ? Math.round(avg * 1000) / 1000 : null
    ),
    fg_season_slg: slotFg(
      'fg_season_slg',
      slg != null ? midrankPercentile(slgArr, slg) : null,
      slgArr.length,
      qualFgEarly,
      slg != null ? Math.round(slg * 1000) / 1000 : null
    ),
    fg_season_iso: slotFg(
      'fg_season_iso',
      iso != null ? midrankPercentile(isoArr, iso) : null,
      isoArr.length,
      qualFgEarly,
      iso != null ? Math.round(iso * 1000) / 1000 : null
    ),
  };
}

export async function fetchSavantFgPitchingSeason(
  pool: pg.Pool,
  input: { season: number; player_id: number; min_tbf: number }
): Promise<Record<string, PercentileSlot>> {
  const { season, player_id, min_tbf } = input;
  const minTbf = Math.max(1, min_tbf);
  const cohortTbf = cohortPeerFloorForQualifiedMin(minTbf);
  /** Qualification uses minTbf; midrank cohorts use a lower floor (see cohortPeerFloorForQualifiedMin). */
  const cohortWhere = `season = $1 AND tbf >= ${cohortTbf} AND player_id IS NOT NULL`;

  const [{ rows: pr }, xeraC, xfipC, kC, bbC, wfC, wrC] = await Promise.all([
    pool.query(
      `SELECT tbf, k_pct::float8 AS k_pct, bb_pct::float8 AS bb_pct, xera::float8 AS xera, xfip::float8 AS xfip,
              war_fip::float8 AS war_fip, war_ra9::float8 AS war_ra9
       FROM fg_pitching_season_mlb_merged_stats
       WHERE player_id = $2 AND season = $1`,
      [season, player_id]
    ),
    pool.query(
      `SELECT xera::float8 AS v FROM fg_pitching_season_mlb_merged_stats
       WHERE ${cohortWhere} AND xera IS NOT NULL`,
      [season]
    ),
    pool.query(
      `SELECT xfip::float8 AS v FROM fg_pitching_season_mlb_merged_stats
       WHERE ${cohortWhere} AND xfip IS NOT NULL`,
      [season]
    ),
    pool.query(
      `SELECT k_pct::float8 AS v FROM fg_pitching_season_mlb_merged_stats
       WHERE ${cohortWhere} AND k_pct IS NOT NULL`,
      [season]
    ),
    pool.query(
      `SELECT bb_pct::float8 AS v FROM fg_pitching_season_mlb_merged_stats
       WHERE ${cohortWhere} AND bb_pct IS NOT NULL`,
      [season]
    ),
    pool.query(
      `SELECT war_fip::float8 AS v FROM fg_pitching_season_mlb_merged_stats
       WHERE ${cohortWhere} AND war_fip IS NOT NULL`,
      [season]
    ),
    pool.query(
      `SELECT war_ra9::float8 AS v FROM fg_pitching_season_mlb_merged_stats
       WHERE ${cohortWhere} AND war_ra9 IS NOT NULL`,
      [season]
    ),
  ]);

  const pRow = (pr[0] ?? {}) as Record<string, unknown>;
  const tbf = int(pRow.tbf) ?? 0;
  const xera = num(pRow.xera);
  const xfip = num(pRow.xfip);
  const kPct = num(pRow.k_pct);
  const bbPct = num(pRow.bb_pct);
  const warFip = num(pRow.war_fip);
  const warRa9 = num(pRow.war_ra9);

  const xeraArr = xeraC.rows.map((r) => num((r as { v: unknown }).v)).filter((x): x is number => x != null);
  const xfipArr = xfipC.rows.map((r) => num((r as { v: unknown }).v)).filter((x): x is number => x != null);
  const kArr = kC.rows.map((r) => num((r as { v: unknown }).v)).filter((x): x is number => x != null);
  const bbArr = bbC.rows.map((r) => num((r as { v: unknown }).v)).filter((x): x is number => x != null);
  const warFipArr = wfC.rows.map((r) => num((r as { v: unknown }).v)).filter((x): x is number => x != null);
  const warRa9Arr = wrC.rows.map((r) => num((r as { v: unknown }).v)).filter((x): x is number => x != null);

  const qualPit = tbf >= minTbf;

  const discSlots = await fetchFgPitchingPlateDisciplineSlots(pool, {
    season,
    player_id,
    cohortTbf,
    qualPit,
  });

  return {
    ...discSlots,
    fg_season_pit_war_fip: slotFg(
      'fg_season_pit_war_fip',
      warFip != null ? midrankPercentile(warFipArr, warFip) : null,
      warFipArr.length,
      qualPit,
      warFip
    ),
    fg_season_pit_war_ra9: slotFg(
      'fg_season_pit_war_ra9',
      warRa9 != null ? midrankPercentile(warRa9Arr, warRa9) : null,
      warRa9Arr.length,
      qualPit,
      warRa9
    ),
    fg_season_pit_xera: slotFg(
      'fg_season_pit_xera',
      xera != null ? midrankPercentile(xeraArr, xera) : null,
      xeraArr.length,
      qualPit,
      xera
    ),
    fg_season_pit_xfip: slotFg(
      'fg_season_pit_xfip',
      xfip != null ? midrankPercentile(xfipArr, xfip) : null,
      xfipArr.length,
      qualPit,
      xfip
    ),
    fg_season_pit_k_pct: slotFg(
      'fg_season_pit_k_pct',
      kPct != null ? midrankPercentile(kArr, kPct) : null,
      kArr.length,
      qualPit,
      kPct != null ? Math.round(kPct * 10000) / 100 : null
    ),
    fg_season_pit_bb_pct: slotFg(
      'fg_season_pit_bb_pct',
      bbPct != null ? midrankPercentile(bbArr, bbPct) : null,
      bbArr.length,
      qualPit,
      bbPct != null ? Math.round(bbPct * 10000) / 100 : null
    ),
  };
}

/** FanGraphs ``sp_s_*`` / ``sp_l_*`` / ``sp_p_*`` json keys (Statcast pitch-type model). */
function fgPitchTypePlusJsonKeys(statcastPitchType: string): { stuff: string; loc: string; pit: string } | null {
  let s = statcastPitchType.trim().toUpperCase();
  if (s === 'FA') s = 'FF';
  if (!/^[A-Z0-9]{1,4}$/.test(s)) return null;
  return { stuff: `sp_s_${s}`, loc: `sp_l_${s}`, pit: `sp_p_${s}` };
}

type FgPtPlusRow = { player_id: unknown; s: unknown; l: unknown; p: unknown };

function cohortNumsPt(rows: FgPtPlusRow[], col: 's' | 'l' | 'p'): number[] {
  const out: number[] = [];
  for (const r of rows) {
    const x = num(r[col]);
    if (x != null) out.push(x);
  }
  return out;
}

/**
 * Per–pitch-type Stuff+ / Location+ / Pitching+ from FanGraphs ``stats_jsonb`` (`sp_s_*` / `sp_l_*` / `sp_p_*`).
 * Season-level ``sp_stuff`` did not exist until later FG exports; per-type keys appear earlier (e.g. 2016+).
 * Cohort: MLB pitchers meeting merged TBF floor with non-null values for that json field.
 */
export async function fetchFgPitchTypePlusSlots(
  pool: pg.Pool,
  input: {
    season: number;
    player_id: number;
    pitchTypes: string[];
    cohortTbfPeerFloor: number;
    qualPitOverall: boolean;
    /** Statcast pitch counts per type (same rows as ``statcast_pitcher_season_pitchtype_percentile_mv``). */
    pitchesByType: Record<string, number>;
    pitchTypePeerFloor: number;
  }
): Promise<Record<string, Record<string, PercentileSlot>>> {
  const {
    season,
    player_id,
    pitchTypes,
    cohortTbfPeerFloor,
    qualPitOverall,
    pitchesByType,
    pitchTypePeerFloor,
  } = input;
  if (pitchTypes.length === 0) return {};

  const cohortSql = `
    WITH qual AS (
      SELECT player_id
      FROM fg_pitching_season_mlb_merged_stats
      WHERE season = $1 AND tbf >= $2 AND player_id IS NOT NULL
    ),
    rep AS (
      SELECT DISTINCT ON (${FG_PITCH_SEASON_RESOLVED_PLAYER_ID})
        ${FG_PITCH_SEASON_RESOLVED_PLAYER_ID} AS player_id,
        (NULLIF(TRIM(f.stats_jsonb->>$3), ''))::float8 AS s,
        (NULLIF(TRIM(f.stats_jsonb->>$4), ''))::float8 AS l,
        (NULLIF(TRIM(f.stats_jsonb->>$5), ''))::float8 AS p
      FROM fg_pitching_season_current f
      INNER JOIN qual q ON q.player_id = ${FG_PITCH_SEASON_RESOLVED_PLAYER_ID} AND f.season = $1
      WHERE f.level = 'MLB'
      ORDER BY ${FG_PITCH_SEASON_RESOLVED_PLAYER_ID}, CASE WHEN f.team = 'TOT' THEN 0 ELSE 1 END, f.team
    )
    SELECT player_id, s, l, p FROM rep
  `;

  const entries = await Promise.all(
    pitchTypes.map(async (pt) => {
      const keys = fgPitchTypePlusJsonKeys(pt);
      if (!keys) return null;
      const pc = int(pitchesByType[pt]) ?? 0;
      const pitchTypeQualified =
        pc >= pitchTypePeerFloor || pc >= PITCH_TYPE_NON_PROVISIONAL_TYPE_PITCHES;
      const qualRow = qualPitOverall && pitchTypeQualified;

      const { rows } = await pool.query(cohortSql, [
        season,
        cohortTbfPeerFloor,
        keys.stuff,
        keys.loc,
        keys.pit,
      ]);
      const cr = rows as FgPtPlusRow[];
      const prow = cr.find((r) => int(r.player_id) === player_id);
      const pv = (prow ?? {}) as FgPtPlusRow;
      const sVal = num(pv.s);
      const lVal = num(pv.l);
      const pVal = num(pv.p);

      const sArr = cohortNumsPt(cr, 's');
      const lArr = cohortNumsPt(cr, 'l');
      const pArr = cohortNumsPt(cr, 'p');

      return [
        pt,
        {
          pitch_fg_stuff_plus: slotFg(
            'pitch_fg_stuff_plus',
            sVal != null ? midrankPercentile(sArr, sVal) : null,
            sArr.length,
            qualRow,
            sVal != null ? Math.round(sVal * 10) / 10 : null
          ),
          pitch_fg_location_plus: slotFg(
            'pitch_fg_location_plus',
            lVal != null ? midrankPercentile(lArr, lVal) : null,
            lArr.length,
            qualRow,
            lVal != null ? Math.round(lVal * 10) / 10 : null
          ),
          pitch_fg_pitching_plus: slotFg(
            'pitch_fg_pitching_plus',
            pVal != null ? midrankPercentile(pArr, pVal) : null,
            pArr.length,
            qualRow,
            pVal != null ? Math.round(pVal * 10) / 10 : null
          ),
        } satisfies Record<string, PercentileSlot>,
      ] as const;
    })
  );

  const out: Record<string, Record<string, PercentileSlot>> = {};
  for (const e of entries) {
    if (e) out[e[0]] = e[1];
  }
  return out;
}
