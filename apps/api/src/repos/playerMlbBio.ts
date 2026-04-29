import type pg from 'pg';
import { rowsToJson } from './rowJson.js';

const MLB_PEOPLE_URL = (keyMlbam: number) =>
  `https://statsapi.mlb.com/api/v1/people/${keyMlbam}?hydrate=currentTeam`;

/** MLB Stats API — league honors use stable award ids (see GET /api/v1/awards). */
const MLB_AWARDS_URL = (keyMlbam: number) =>
  `https://statsapi.mlb.com/api/v1/people/${keyMlbam}/awards`;

const ALL_STAR_AWARD_IDS = new Set(['ALAS', 'NLAS']);
const LEAGUE_MVP_AWARD_IDS = new Set(['ALMVP', 'NLMVP']);
const CY_YOUNG_AWARD_IDS = new Set(['ALCY', 'NLCY']);
const GOLD_GLOVE_AWARD_IDS = new Set(['ALGG', 'NLGG', 'MLGG']);
const SILVER_SLUGGER_AWARD_IDS = new Set(['ALSS', 'NLSS']);
const PLATINUM_GLOVE_AWARD_IDS = new Set(['ALPG', 'NLPG']);
const RELIEVER_OF_YEAR_AWARD_IDS = new Set(['ALREL', 'NLREL']);

/** Read-through cache: refresh when older than this. */
export const PLAYER_MLB_BIO_TTL_MS = 24 * 60 * 60 * 1000;

const FETCH_TIMEOUT_MS = 12_000;

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string' && v.trim() !== '') return v.trim();
  return null;
}

function pickInt(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number.parseInt(v, 10);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** Baseball “season age”: years complete as of July 1 of `seasonYear` (warehouse `birth_date`). */
export function baseballAgeOnJuly1(
  birthDateStr: string | null | undefined,
  seasonYear: number
): number | null {
  if (!birthDateStr || typeof birthDateStr !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(birthDateStr.trim());
  if (!m) return null;
  const by = Number(m[1]);
  const bm = Number(m[2]);
  const bd = Number(m[3]);
  if (!Number.isFinite(by) || !Number.isFinite(bm) || !Number.isFinite(bd)) return null;
  const ref = new Date(Date.UTC(seasonYear, 6, 1));
  const birth = new Date(Date.UTC(by, bm - 1, bd));
  if (birth.getTime() > ref.getTime()) return null;
  let age = ref.getUTCFullYear() - birth.getUTCFullYear();
  if (
    ref.getUTCMonth() < birth.getUTCMonth() ||
    (ref.getUTCMonth() === birth.getUTCMonth() && ref.getUTCDate() < birth.getUTCDate())
  ) {
    age -= 1;
  }
  return age;
}

function sideCode(o: unknown): string | null {
  if (!o || typeof o !== 'object') return null;
  const c = (o as { code?: unknown }).code;
  const s = pickStr(c);
  if (!s) return null;
  return s.slice(0, 1).toUpperCase();
}

function parseMlbDebut(v: unknown): string | null {
  const s = pickStr(v);
  if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m ? m[1]! : s;
}

function teamNameFromCurrentTeam(o: unknown): { id: number | null; name: string | null } {
  if (!o || typeof o !== 'object') return { id: null, name: null };
  const t = o as { id?: unknown; name?: unknown };
  const id = pickInt(t.id);
  const name = pickStr(t.name);
  return { id: id ?? null, name };
}

function primaryPosFromPerson(p: Record<string, unknown>): {
  code: string | null;
  abbr: string | null;
  name: string | null;
} {
  const pp = p.primaryPosition;
  if (!pp || typeof pp !== 'object') return { code: null, abbr: null, name: null };
  const o = pp as Record<string, unknown>;
  return {
    code: pickStr(o.code),
    abbr: pickStr(o.abbreviation),
    name: pickStr(o.name),
  };
}

function buildDraftSummary(p: Record<string, unknown>): string | null {
  const drafts = p.drafts;
  if (Array.isArray(drafts) && drafts.length > 0) {
    const d0 = drafts[0];
    if (d0 && typeof d0 === 'object') {
      const o = d0 as Record<string, unknown>;
      const round = pickStr(o.pickRound) ?? pickStr(o.round);
      const pickNum = pickInt(o.pickNumber);
      const year = pickInt(o.year) ?? pickInt(p.draftYear);
      const parts: string[] = [];
      if (year != null) parts.push(String(year));
      if (round != null && pickNum != null) {
        parts.push(`Rd ${round} · Pick ${pickNum}`);
      } else if (round != null) {
        parts.push(`Rd ${round}`);
      }
      return parts.length ? `Draft: ${parts.join(' · ')}` : null;
    }
  }
  const y = pickInt(p.draftYear);
  if (y != null) return `Draft: ${y}`;
  return null;
}

export type MlbBioNormalized = {
  raw_person: Record<string, unknown>;
  height: string | null;
  weight: number | null;
  bat_side_code: string | null;
  pitch_hand_code: string | null;
  birth_city: string | null;
  birth_state_province: string | null;
  birth_country: string | null;
  draft_year: number | null;
  draft_summary: string | null;
  primary_position_code: string | null;
  primary_position_abbr: string | null;
  primary_position_name: string | null;
  current_team_id: number | null;
  current_team_name: string | null;
  mlb_debut_date: string | null;
  nick_name: string | null;
};

function normalizeFromPerson(person: Record<string, unknown>): MlbBioNormalized {
  const pos = primaryPosFromPerson(person);
  const ct = teamNameFromCurrentTeam(person.currentTeam);
  return {
    raw_person: person,
    height: pickStr(person.height),
    weight: pickInt(person.weight),
    bat_side_code: sideCode(person.batSide),
    pitch_hand_code: sideCode(person.pitchHand),
    birth_city: pickStr(person.birthCity),
    birth_state_province: pickStr(person.birthStateProvince),
    birth_country: pickStr(person.birthCountry),
    draft_year: pickInt(person.draftYear),
    draft_summary: buildDraftSummary(person),
    primary_position_code: pos.code,
    primary_position_abbr: pos.abbr,
    primary_position_name: pos.name,
    current_team_id: ct.id,
    current_team_name: ct.name,
    mlb_debut_date: parseMlbDebut(person.mlbDebutDate),
    nick_name: pickStr(person.nickName),
  };
}

async function fetchMlbPerson(keyMlbam: number): Promise<Record<string, unknown> | null> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(MLB_PEOPLE_URL(keyMlbam), {
      signal: ac.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { people?: unknown };
    const list = j.people;
    if (!Array.isArray(list) || list.length === 0) return null;
    const p = list[0];
    if (!p || typeof p !== 'object') return null;
    return p as Record<string, unknown>;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export type MlbAwardsSummary = {
  all_star: number;
  mvp: number;
  cy_young: number;
  gold_glove: number;
  silver_slugger: number;
  platinum_glove: number;
  reliever_of_year: number;
};

/**
 * Count MLB honors from Stats API award rows (stable `id`s only).
 * Excludes WS MVP, ASG MVP, MiLB Gold Glove (`MILBGG`), etc.
 */
export function summarizeMlbAwardsList(awards: unknown[]): MlbAwardsSummary {
  let all_star = 0;
  let mvp = 0;
  let cy_young = 0;
  let gold_glove = 0;
  let silver_slugger = 0;
  let platinum_glove = 0;
  let reliever_of_year = 0;
  for (const a of awards) {
    if (!a || typeof a !== 'object') continue;
    const id = String((a as { id?: unknown }).id ?? '').trim();
    if (ALL_STAR_AWARD_IDS.has(id)) all_star += 1;
    else if (LEAGUE_MVP_AWARD_IDS.has(id)) mvp += 1;
    else if (CY_YOUNG_AWARD_IDS.has(id)) cy_young += 1;
    else if (GOLD_GLOVE_AWARD_IDS.has(id)) gold_glove += 1;
    else if (SILVER_SLUGGER_AWARD_IDS.has(id)) silver_slugger += 1;
    else if (PLATINUM_GLOVE_AWARD_IDS.has(id)) platinum_glove += 1;
    else if (RELIEVER_OF_YEAR_AWARD_IDS.has(id)) reliever_of_year += 1;
  }
  return {
    all_star,
    mvp,
    cy_young,
    gold_glove,
    silver_slugger,
    platinum_glove,
    reliever_of_year,
  };
}

async function fetchMlbAwardsList(keyMlbam: number): Promise<unknown[] | null> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(MLB_AWARDS_URL(keyMlbam), {
      signal: ac.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { awards?: unknown };
    const list = j.awards;
    if (!Array.isArray(list)) return [];
    return list;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

type CacheRow = {
  player_id: number;
  key_mlbam: number;
  fetched_at: string;
  raw_person: Record<string, unknown>;
  height: string | null;
  weight: number | null;
  bat_side_code: string | null;
  pitch_hand_code: string | null;
  birth_city: string | null;
  birth_state_province: string | null;
  birth_country: string | null;
  draft_year: number | null;
  draft_summary: string | null;
  primary_position_code: string | null;
  primary_position_abbr: string | null;
  primary_position_name: string | null;
  current_team_id: number | null;
  current_team_name: string | null;
  mlb_debut_date: string | null;
  nick_name: string | null;
  awards_raw?: unknown;
  awards_all_star?: number | null;
  awards_mvp?: number | null;
  awards_cy_young?: number | null;
  awards_gold_glove?: number | null;
  awards_silver_slugger?: number | null;
  awards_platinum_glove?: number | null;
  awards_reliever_of_year?: number | null;
  awards_fetched_at?: string | null;
};

function rowToNormalized(r: CacheRow): MlbBioNormalized {
  const raw = r.raw_person;
  const rp = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    raw_person: rp,
    height: r.height ?? null,
    weight: r.weight ?? null,
    bat_side_code: r.bat_side_code ?? null,
    pitch_hand_code: r.pitch_hand_code ?? null,
    birth_city: r.birth_city ?? null,
    birth_state_province: r.birth_state_province ?? null,
    birth_country: r.birth_country ?? null,
    draft_year: r.draft_year ?? null,
    draft_summary: r.draft_summary ?? null,
    primary_position_code: r.primary_position_code ?? null,
    primary_position_abbr: r.primary_position_abbr ?? null,
    primary_position_name: r.primary_position_name ?? null,
    current_team_id: r.current_team_id ?? null,
    current_team_name: r.current_team_name ?? null,
    mlb_debut_date: r.mlb_debut_date ?? null,
    nick_name: r.nick_name ?? null,
  };
}

async function upsertCache(
  pool: pg.Pool,
  playerId: number,
  keyMlbam: number,
  norm: MlbBioNormalized
): Promise<void> {
  await pool.query(
    `
    INSERT INTO player_bio_cache (
      player_id, key_mlbam, fetched_at, raw_person,
      height, weight, bat_side_code, pitch_hand_code,
      birth_city, birth_state_province, birth_country,
      draft_year, draft_summary,
      primary_position_code, primary_position_abbr, primary_position_name,
      current_team_id, current_team_name, mlb_debut_date, nick_name
    ) VALUES (
      $1, $2, now(), $3::jsonb,
      $4, $5, $6, $7,
      $8, $9, $10,
      $11, $12,
      $13, $14, $15,
      $16, $17, $18, $19
    )
    ON CONFLICT (player_id) DO UPDATE SET
      key_mlbam = EXCLUDED.key_mlbam,
      fetched_at = EXCLUDED.fetched_at,
      raw_person = EXCLUDED.raw_person,
      height = EXCLUDED.height,
      weight = EXCLUDED.weight,
      bat_side_code = EXCLUDED.bat_side_code,
      pitch_hand_code = EXCLUDED.pitch_hand_code,
      birth_city = EXCLUDED.birth_city,
      birth_state_province = EXCLUDED.birth_state_province,
      birth_country = EXCLUDED.birth_country,
      draft_year = EXCLUDED.draft_year,
      draft_summary = EXCLUDED.draft_summary,
      primary_position_code = EXCLUDED.primary_position_code,
      primary_position_abbr = EXCLUDED.primary_position_abbr,
      primary_position_name = EXCLUDED.primary_position_name,
      current_team_id = EXCLUDED.current_team_id,
      current_team_name = EXCLUDED.current_team_name,
      mlb_debut_date = EXCLUDED.mlb_debut_date,
      nick_name = EXCLUDED.nick_name
    `,
    [
      playerId,
      keyMlbam,
      JSON.stringify(norm.raw_person),
      norm.height,
      norm.weight,
      norm.bat_side_code,
      norm.pitch_hand_code,
      norm.birth_city,
      norm.birth_state_province,
      norm.birth_country,
      norm.draft_year,
      norm.draft_summary,
      norm.primary_position_code,
      norm.primary_position_abbr,
      norm.primary_position_name,
      norm.current_team_id,
      norm.current_team_name,
      norm.mlb_debut_date,
      norm.nick_name,
    ]
  );
}

async function upsertAwardsPatch(
  pool: pg.Pool,
  playerId: number,
  keyMlbam: number,
  rawList: unknown[],
  summary: MlbAwardsSummary
): Promise<void> {
  await pool.query(
    `
    UPDATE player_bio_cache SET
      awards_raw = $2::jsonb,
      awards_all_star = $3,
      awards_mvp = $4,
      awards_cy_young = $5,
      awards_gold_glove = $6,
      awards_silver_slugger = $7,
      awards_platinum_glove = $8,
      awards_reliever_of_year = $9,
      awards_fetched_at = now()
    WHERE player_id = $1 AND key_mlbam = $10
    `,
    [
      playerId,
      JSON.stringify(rawList),
      summary.all_star,
      summary.mvp,
      summary.cy_young,
      summary.gold_glove,
      summary.silver_slugger,
      summary.platinum_glove,
      summary.reliever_of_year,
      keyMlbam,
    ]
  );
}

function staleByFetchedAt(iso: string | null | undefined): boolean {
  if (!iso) return true;
  return Date.now() - new Date(iso).getTime() > PLAYER_MLB_BIO_TTL_MS;
}

function cacheRowHasCompleteAwardsCounts(c: CacheRow): boolean {
  return (
    c.awards_all_star != null &&
    c.awards_mvp != null &&
    c.awards_cy_young != null &&
    c.awards_gold_glove != null &&
    c.awards_silver_slugger != null &&
    c.awards_platinum_glove != null &&
    c.awards_reliever_of_year != null
  );
}

function awardsSummaryFromCacheRow(c: CacheRow): MlbAwardsSummary {
  return {
    all_star: c.awards_all_star!,
    mvp: c.awards_mvp!,
    cy_young: c.awards_cy_young!,
    gold_glove: c.awards_gold_glove!,
    silver_slugger: c.awards_silver_slugger!,
    platinum_glove: c.awards_platinum_glove!,
    reliever_of_year: c.awards_reliever_of_year!,
  };
}

function shouldRefreshAwards(cached: CacheRow | undefined, keyMlbam: number): boolean {
  if (!cached || cached.key_mlbam !== keyMlbam) return true;
  if (!cacheRowHasCompleteAwardsCounts(cached)) return true;
  return staleByFetchedAt(cached.awards_fetched_at);
}

export type MlbBioWirePayload = {
  player_id: number;
  key_mlbam: number;
  birth_date: string | null;
  season_year: number;
  age_season: number | null;
  fetched_at: string;
  stale: boolean;
  height: string | null;
  weight: number | null;
  bat_side: string | null;
  pitch_hand: string | null;
  birth_city: string | null;
  birth_state_province: string | null;
  birth_country: string | null;
  draft_year: number | null;
  draft_summary: string | null;
  primary_position_code: string | null;
  primary_position_abbr: string | null;
  primary_position_name: string | null;
  current_team_name: string | null;
  mlb_debut_date: string | null;
  nick_name: string | null;
  /** League ASG / MVP / Cy Young counts from MLB Stats API; null if never successfully loaded. */
  awards: MlbAwardsSummary | null;
  /** Awards fetch failed but cached counts may still be shown. */
  awards_stale: boolean;
};

function toWire(
  playerId: number,
  keyMlbam: number,
  birthDate: string | null | undefined,
  seasonYear: number,
  norm: MlbBioNormalized,
  fetchedAtIso: string,
  stale: boolean,
  awards: MlbAwardsSummary | null,
  awardsStale: boolean
): MlbBioWirePayload {
  const bd =
    birthDate != null && birthDate !== ''
      ? String(birthDate).slice(0, 10)
      : pickStr(norm.raw_person.birthDate)?.slice(0, 10) ?? null;
  return {
    player_id: playerId,
    key_mlbam: keyMlbam,
    birth_date: bd,
    season_year: seasonYear,
    age_season: baseballAgeOnJuly1(bd, seasonYear),
    fetched_at: fetchedAtIso,
    stale,
    height: norm.height,
    weight: norm.weight,
    bat_side: norm.bat_side_code,
    pitch_hand: norm.pitch_hand_code,
    birth_city: norm.birth_city,
    birth_state_province: norm.birth_state_province,
    birth_country: norm.birth_country,
    draft_year: norm.draft_year,
    draft_summary: norm.draft_summary,
    primary_position_code: norm.primary_position_code,
    primary_position_abbr: norm.primary_position_abbr,
    primary_position_name: norm.primary_position_name,
    current_team_name: norm.current_team_name,
    mlb_debut_date: norm.mlb_debut_date,
    nick_name: norm.nick_name,
    awards,
    awards_stale: awardsStale,
  };
}

export async function getMlbBioPayload(
  pool: pg.Pool,
  playerId: number,
  keyMlbam: number | null | undefined,
  birthDate: string | null | undefined,
  seasonYear: number
): Promise<
  | { ok: false; reason: 'no_mlbam' }
  | { ok: true; payload: MlbBioWirePayload }
  | { ok: false; reason: 'fetch_failed' }
> {
  if (keyMlbam == null || !Number.isFinite(keyMlbam) || keyMlbam < 1) {
    return { ok: false, reason: 'no_mlbam' };
  }
  const km = Math.trunc(keyMlbam);

  const { rows } = await pool.query(
    `SELECT * FROM player_bio_cache WHERE player_id = $1`,
    [playerId]
  );
  const cached = rowsToJson(rows as Record<string, unknown>[])[0] as CacheRow | undefined;

  const staleByTime = (iso: string) =>
    Date.now() - new Date(iso).getTime() > PLAYER_MLB_BIO_TTL_MS;

  let norm: MlbBioNormalized | null = null;
  let fetchedAtIso = new Date().toISOString();
  let staleFlag = false;

  if (cached && cached.key_mlbam === km && !staleByTime(cached.fetched_at)) {
    norm = rowToNormalized(cached);
    fetchedAtIso = new Date(cached.fetched_at).toISOString();
  } else {
    const person = await fetchMlbPerson(km);
    if (person) {
      norm = normalizeFromPerson(person);
      await upsertCache(pool, playerId, km, norm);
      fetchedAtIso = new Date().toISOString();
    } else if (cached && cached.key_mlbam === km) {
      norm = rowToNormalized(cached);
      fetchedAtIso = new Date(cached.fetched_at).toISOString();
      staleFlag = true;
    } else {
      return { ok: false, reason: 'fetch_failed' };
    }
  }

  if (!norm) return { ok: false, reason: 'fetch_failed' };

  let awardsSummary: MlbAwardsSummary | null = null;
  let awardsStaleFlag = false;

  if (shouldRefreshAwards(cached, km)) {
    const list = await fetchMlbAwardsList(km);
    if (list != null) {
      const summary = summarizeMlbAwardsList(list);
      await upsertAwardsPatch(pool, playerId, km, list, summary);
      awardsSummary = summary;
      awardsStaleFlag = false;
    } else if (cached && cached.key_mlbam === km && cacheRowHasCompleteAwardsCounts(cached)) {
      awardsSummary = awardsSummaryFromCacheRow(cached);
      awardsStaleFlag = true;
    } else {
      awardsSummary = null;
      awardsStaleFlag = true;
    }
  } else if (cached && cached.key_mlbam === km && cacheRowHasCompleteAwardsCounts(cached)) {
    awardsSummary = awardsSummaryFromCacheRow(cached);
    awardsStaleFlag = false;
  } else {
    awardsSummary = null;
    awardsStaleFlag = true;
  }

  return {
    ok: true,
    payload: toWire(
      playerId,
      km,
      birthDate,
      seasonYear,
      norm,
      fetchedAtIso,
      staleFlag,
      awardsSummary,
      awardsStaleFlag
    ),
  };
}
