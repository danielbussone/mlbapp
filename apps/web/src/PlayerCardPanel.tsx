import ChevronLeft from '@mui/icons-material/ChevronLeft';
import ChevronRight from '@mui/icons-material/ChevronRight';
import CloseIcon from '@mui/icons-material/Close';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Chip from '@mui/material/Chip';
import Container from '@mui/material/Container';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BATTING_CARD_HEADERS,
  type BattingCardLine,
  type FgBattingCardApi,
  battingCardLinesFromCareerViews,
  FG_CARD_SEASON_ROW_LIMIT,
  fgSeasonHasConsolidatedRow,
  formatBattingCardCell,
  normalizeFgCardPayload,
} from './batterFgTables.js';
import { CARD_SEASON_YEAR_MAX, getDefaultCardSeasonYear } from './cardSeasonYear.js';
import {
  MovementMiniPlot,
  pitchTypeMovementColor,
  type ArmAngleOverlay,
  type LeagueMovementRow,
} from './MovementMiniPlot.js';
import { pitchTypeName } from './pitchTypeLabels.js';
import {
  PitchingCardTable,
  pitchingCardLinesFromCareerViews,
} from './pitcherFgTables.js';
import {
  getCachedFgBatting,
  getCachedFgPitching,
  getCachedPlayer,
  getCachedStatcast,
  setCachedFgBatting,
  setCachedFgPitching,
  setCachedPlayer,
  setCachedStatcast,
  type CachedPlayerRow,
} from './playerCardRequestCache.js';
import { BatPathSummary, type BatPathApiRow } from './BatPathSummary.js';
import { inferPrimaryCardRole } from './playerCardPrimaryRole.js';
import { fetchFgRoleHint } from './playerFgRoleHint.js';
import { SprayChart } from './SprayChart.js';
import { BatSpeedSeasonSpark } from './BatSpeedSeasonSpark.js';
import { FieldingTable } from './FieldingTable.js';
import { OaaHeatmapPlaceholder } from './OaaHeatmapPlaceholder.js';
import { PitchMixVeloTable } from './PitchMixVeloTable.js';

export type CardRole = 'batting' | 'pitching';

const ARM_ANGLE_MIN_SAMPLE = 8;

/** OLS on pitcher-season aggregates (nz≥80): arm ≈ b0 + b1·|release_x| + b2·release_z (feet). */
const ARM_ANGLE_REG_INTERCEPT = -54.6857;
const ARM_ANGLE_REG_COEF_ABS_X = -4.2083;
const ARM_ANGLE_REG_COEF_Z = 17.5145;
const ARM_ANGLE_REG_CLIP_MIN = 0;
const ARM_ANGLE_REG_CLIP_MAX = 95;

/**
 * Arm-slot overlay for `MovementMiniPlot`:
 * 1. Prefer Statcast **`arm_angle`** when ≥`ARM_ANGLE_MIN_SAMPLE` pitches have a **non-zero** value (pre-2020 often `0`).
 * 2. Else **regression** on `release_pos_x` / `release_pos_z` (feet): `b0 + b1·|x| + b2·z` fit on league pitcher-seasons.
 * 3. LHP: mirror measured/estimated Savant degrees with **`180 − θ`** before mapping to the plot.
 */
function computeArmOverlay(
  rows: Record<string, unknown>[] | undefined,
  throwsLeft: boolean
): ArmAngleOverlay | null {
  if (!rows?.length) return null;

  const armAngles: number[] = [];
  for (const r of rows) {
    const a = typeof r.arm_angle === 'number' ? r.arm_angle : Number(r.arm_angle);
    if (!Number.isFinite(a) || Math.abs(a) < 1e-6) continue;
    armAngles.push(a);
  }
  if (armAngles.length >= ARM_ANGLE_MIN_SAMPLE) {
    const mean = armAngles.reduce((x, y) => x + y, 0) / armAngles.length;
    const v =
      armAngles.reduce((s, a) => s + (a - mean) ** 2, 0) / Math.max(1, armAngles.length - 1);
    const meanPlot = throwsLeft ? 180 - mean : mean;
    return { meanDeg: meanPlot, stdDeg: Math.sqrt(v) };
  }

  const estArms: number[] = [];
  for (const r of rows) {
    const x = typeof r.release_pos_x === 'number' ? r.release_pos_x : Number(r.release_pos_x);
    const z = typeof r.release_pos_z === 'number' ? r.release_pos_z : Number(r.release_pos_z);
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
    estArms.push(
      ARM_ANGLE_REG_INTERCEPT +
        ARM_ANGLE_REG_COEF_ABS_X * Math.abs(x) +
        ARM_ANGLE_REG_COEF_Z * z
    );
  }
  if (estArms.length < ARM_ANGLE_MIN_SAMPLE) return null;
  const meanEst = estArms.reduce((a, b) => a + b, 0) / estArms.length;
  const vEst =
    estArms.reduce((s, a) => s + (a - meanEst) ** 2, 0) / Math.max(1, estArms.length - 1);
  const meanSavant = Math.min(
    ARM_ANGLE_REG_CLIP_MAX,
    Math.max(ARM_ANGLE_REG_CLIP_MIN, meanEst)
  );
  const meanPlot = throwsLeft ? 180 - meanSavant : meanSavant;
  return { meanDeg: meanPlot, stdDeg: Math.sqrt(vEst) };
}

function leagueMovementFromPayload(raw: unknown): LeagueMovementRow[] | null {
  if (!Array.isArray(raw)) return null;
  const out: LeagueMovementRow[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const pt = String(o.pitch_type ?? '');
    const ax = Number(o.avg_pfx_x_ft);
    const az = Number(o.avg_pfx_z_ft);
    if (!pt || !Number.isFinite(ax) || !Number.isFinite(az)) continue;
    out.push({ pitch_type: pt, avg_pfx_x_ft: ax, avg_pfx_z_ft: az });
  }
  return out.length ? out : null;
}

function normPitchCode(s: string): string {
  return s.trim().toUpperCase();
}

/** Usage % from `mix` / `mix_extended` row (`pct` is 0–100 from API). */
function mixUsagePct(row: Record<string, unknown>): number {
  const raw = row.pct;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const n = Number.parseFloat(raw.trim().replace(/%$/, ''));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

const PITCH_CARD_MIN_USAGE_PCT = 1;

/** Drop pitch types below `minPct` usage; if that removes everything, keep original rows. */
function filterMixRowsMinPct(
  rows: Record<string, unknown>[] | undefined,
  minPct: number
): Record<string, unknown>[] {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const f = rows.filter((r) => mixUsagePct(r) >= minPct);
  return f.length > 0 ? f : rows;
}

/**
 * Pitch types with usage ≥ `minPct` for league/movement overlays (prefer `mix_extended`, then `mix`,
 * then any pitch type seen in `sample`).
 */
function pitchTypesAtLeastPctFromStatcast(
  statcast: Record<string, unknown> | null,
  minPct: number
): Set<string> | null {
  if (!statcast) return null;
  const mixExt = statcast.mix_extended as Record<string, unknown>[] | undefined;
  if (Array.isArray(mixExt) && mixExt.length > 0) {
    const out = new Set<string>();
    for (const r of mixExt) {
      if (mixUsagePct(r) < minPct) continue;
      const c = normPitchCode(String(r.pitch_type ?? ''));
      if (c) out.add(c);
    }
    if (out.size) return out;
  }
  const mix = statcast.mix as Record<string, unknown>[] | undefined;
  if (Array.isArray(mix) && mix.length > 0) {
    const out = new Set<string>();
    for (const r of mix) {
      if (mixUsagePct(r) < minPct) continue;
      const c = normPitchCode(String(r.pitch_type ?? ''));
      if (c) out.add(c);
    }
    if (out.size) return out;
  }
  const sample = statcast.sample as Record<string, unknown>[] | undefined;
  if (Array.isArray(sample) && sample.length > 0) {
    const out = new Set<string>();
    for (const r of sample) {
      const c = normPitchCode(String(r.pitch_type ?? ''));
      if (c) out.add(c);
    }
    return out.size ? out : null;
  }
  return null;
}

function filterMovementSampleByPitchTypes(
  sample: Record<string, unknown>[] | undefined,
  types: Set<string> | null
): Record<string, unknown>[] {
  if (!sample?.length) return [];
  if (!types?.size) return sample;
  const out = sample.filter((r) => types.has(normPitchCode(String(r.pitch_type ?? ''))));
  return out.length > 0 ? out : sample;
}

function filterLeagueMovementForPitcher(
  league: LeagueMovementRow[] | null,
  pitcherTypes: Set<string> | null
): LeagueMovementRow[] | null {
  if (!league?.length) return league;
  if (!pitcherTypes?.size) return league;
  const filtered = league.filter((r) => pitcherTypes.has(normPitchCode(String(r.pitch_type ?? ''))));
  return filtered.length > 0 ? filtered : league;
}

export type PlayerRow = {
  player_id: number;
  key_mlbam: number | null;
  name_first: string;
  name_last: string;
  birth_date?: string | null;
  externals?: Array<{ id_system: string; id_value: string }>;
};

function statcastRole(r: CardRole): 'pitcher' | 'batter' {
  return r === 'pitching' ? 'pitcher' : 'batter';
}

const EMPTY_FG_BATTING_CARD: FgBattingCardApi = {
  career: null,
  seasons: [],
  max_season: null,
  has_row_for_season: null,
};

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text };
  }
}

function BattingCardTable({
  lines,
  variant,
}: {
  lines: BattingCardLine[];
  variant: 'page' | 'sidebar';
}) {
  if (lines.length === 0) return null;
  const fs = variant === 'sidebar' ? '0.68rem' : '0.75rem';
  return (
    <TableContainer sx={{ maxWidth: '100%', overflow: 'auto', mb: 1 }}>
      <Table size="small" sx={{ '& td, & th': { whiteSpace: 'nowrap', fontSize: fs } }}>
        <TableHead>
          <TableRow>
            <TableCell>Season</TableCell>
            {BATTING_CARD_HEADERS.map((h) => (
              <TableCell key={h.key} align="right">
                {h.label}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {lines.map((line) => (
            <TableRow key={line.seasonLabel}>
              <TableCell
                component="th"
                scope="row"
                sx={{ fontWeight: line.seasonLabel === 'Career' ? 700 : 500 }}
              >
                {line.seasonLabel}
              </TableCell>
              {BATTING_CARD_HEADERS.map(({ key }) => (
                <TableCell key={key} align="right">
                  {formatBattingCardCell(key, line[key])}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

export type PlayerCardPanelProps = {
  playerId: number;
  /** Defaults when uncontrolled, or when `playerId` changes while uncontrolled. */
  defaultSeason?: number;
  defaultRole?: CardRole;
  /** Controlled mode (full page + URL): pass both season and onSeasonChange. */
  season?: number;
  role?: CardRole;
  onSeasonChange?: (y: number) => void;
  onRoleChange?: (r: CardRole) => void;
  /** Sidebar: dismiss control (e.g. chat layout). */
  onClose?: () => void;
  /**
   * When true and the active season is the default calendar year with no FG rows,
   * fetch recent seasons and jump to the latest MLB season with data (retired players).
   */
  autoFallbackLatestSeasonIfEmpty?: boolean;
  variant?: 'page' | 'sidebar';
};

export function PlayerCardPanel({
  playerId,
  defaultSeason = getDefaultCardSeasonYear(),
  defaultRole = 'batting',
  season: seasonProp,
  role: roleProp,
  onSeasonChange,
  onRoleChange,
  onClose,
  autoFallbackLatestSeasonIfEmpty = false,
  variant = 'page',
}: PlayerCardPanelProps) {
  const controlled =
    typeof seasonProp === 'number' &&
    typeof onSeasonChange === 'function' &&
    typeof roleProp !== 'undefined' &&
    typeof onRoleChange === 'function';

  const [seasonUncontrolled, setSeasonUncontrolled] = useState(defaultSeason);
  const [roleUncontrolled, setRoleUncontrolled] = useState<CardRole>(defaultRole);

  useEffect(() => {
    if (!controlled) {
      setSeasonUncontrolled(defaultSeason);
      setRoleUncontrolled(defaultRole);
    }
  }, [playerId, defaultSeason, defaultRole, controlled]);

  const season = controlled ? seasonProp! : seasonUncontrolled;
  const role = controlled ? roleProp! : roleUncontrolled;
  const setSeason = controlled ? onSeasonChange! : setSeasonUncontrolled;
  const setRole = controlled ? onRoleChange! : setRoleUncontrolled;

  const theme = useTheme();
  const isMdUp = useMediaQuery(theme.breakpoints.up('md'));
  const [fetchingPlayer, setFetchingPlayer] = useState(true);
  const [fetchingFg, setFetchingFg] = useState(true);
  const [fetchingSc, setFetchingSc] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [player, setPlayer] = useState<PlayerRow | null>(null);
  const [fgPitchingCard, setFgPitchingCard] = useState<FgBattingCardApi>(EMPTY_FG_BATTING_CARD);
  const [fgBattingCard, setFgBattingCard] = useState<FgBattingCardApi>(EMPTY_FG_BATTING_CARD);
  const [statcast, setStatcast] = useState<Record<string, unknown> | null>(null);
  /** Desktop-only: narrow Statcast rail when Savant has nothing for this player/year. */
  const [statcastCollapsed, setStatcastCollapsed] = useState(false);
  const [fieldingRows, setFieldingRows] = useState<Record<string, unknown>[]>([]);

  const battingCard = useMemo(() => battingCardLinesFromCareerViews(fgBattingCard), [fgBattingCard]);
  const pitchingCard = useMemo(() => pitchingCardLinesFromCareerViews(fgPitchingCard), [fgPitchingCard]);

  const pitchingMixDisplay = useMemo(
    () => filterMixRowsMinPct(statcast?.mix as Record<string, unknown>[] | undefined, PITCH_CARD_MIN_USAGE_PCT),
    [statcast?.mix]
  );
  const pitchingMixExtendedDisplay = useMemo(
    () =>
      filterMixRowsMinPct(statcast?.mix_extended as Record<string, unknown>[] | undefined, PITCH_CARD_MIN_USAGE_PCT),
    [statcast?.mix_extended]
  );
  const pitchingVeloDisplay = useMemo(() => {
    const v = statcast?.velo_dist as Record<string, unknown>[] | undefined;
    if (!Array.isArray(v) || !pitchingMixDisplay.length) return v;
    const codes = new Set(pitchingMixDisplay.map((r) => normPitchCode(String(r.pitch_type ?? ''))));
    const f = v.filter((row) => codes.has(normPitchCode(String(row.pitch_type ?? ''))));
    return f.length > 0 ? f : v;
  }, [statcast?.velo_dist, pitchingMixDisplay]);
  const pitchTypesMovementFilter = useMemo(
    () =>
      role === 'pitching' ? pitchTypesAtLeastPctFromStatcast(statcast, PITCH_CARD_MIN_USAGE_PCT) : null,
    [role, statcast]
  );
  const statcastSampleMovement = useMemo(() => {
    const s = statcast?.sample as Record<string, unknown>[] | undefined;
    if (role !== 'pitching' || !s?.length) return s;
    return filterMovementSampleByPitchTypes(s, pitchTypesMovementFilter);
  }, [role, statcast?.sample, pitchTypesMovementFilter]);

  const throwsLeftPitcher = useMemo(
    () => role === 'pitching' && String(statcast?.pitcher_throws ?? '').toUpperCase() === 'L',
    [role, statcast?.pitcher_throws]
  );

  const armOverlay = useMemo(
    () =>
      computeArmOverlay(
        (role === 'pitching' ? statcastSampleMovement : statcast?.sample) as Record<string, unknown>[] | undefined,
        throwsLeftPitcher
      ),
    [role, statcast?.sample, statcastSampleMovement, throwsLeftPitcher]
  );
  const leagueMovement = useMemo(
    () => leagueMovementFromPayload(statcast?.league_movement),
    [statcast?.league_movement]
  );
  const leagueMovementForPlot = useMemo(
    () =>
      filterLeagueMovementForPitcher(
        leagueMovement,
        role === 'pitching' ? pitchTypesMovementFilter : null
      ),
    [leagueMovement, role, pitchTypesMovementFilter]
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch(`/api/players/${playerId}/fg-fielding?season=${season}`);
        const j = (await r.json()) as { rows?: unknown };
        if (cancelled) return;
        if (r.ok && Array.isArray(j.rows)) setFieldingRows(j.rows as Record<string, unknown>[]);
        else setFieldingRows([]);
      } catch {
        if (!cancelled) setFieldingRows([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [playerId, season]);

  /** No Savant payload for this player/year → narrow the Statcast rail on desktop; otherwise use full column. */
  useEffect(() => {
    if (fetchingSc) return;
    const available = statcast?.statcast_available === true;
    if (available) setStatcastCollapsed(false);
    else setStatcastCollapsed(true);
  }, [fetchingSc, statcast?.statcast_available, playerId, season, role]);

  /** Sidebar (uncontrolled): pick batting vs pitching from cheap FG career hints so pitchers don’t default to batting. */
  useEffect(() => {
    if (controlled) return;
    let cancelled = false;
    void (async () => {
      try {
        const { batting: bat, pitching: pit } = await fetchFgRoleHint(playerId);
        if (cancelled) return;
        setRoleUncontrolled(inferPrimaryCardRole(bat, pit));
      } catch {
        /* ignore hint failures */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [playerId, controlled]);

  useEffect(() => {
    let cancelled = false;
    const base = `/api/players/${playerId}`;
    const fgSeasonsQ = new URLSearchParams({ last_seasons: String(FG_CARD_SEASON_ROW_LIMIT) });
    const scQ = new URLSearchParams({
      role: statcastRole(role),
      game_year: String(season),
      limit: role === 'batting' ? '8000' : '4000',
    });

    const fgUrl =
      role === 'batting'
        ? `${base}/fg-batting-card?${fgSeasonsQ}`
        : `${base}/fg-pitching-card?${fgSeasonsQ}`;
    const statcastUrl = `${base}/statcast-summary?${scQ}`;

    const cachedPlayer = getCachedPlayer(playerId);
    const cachedFg = role === 'batting' ? getCachedFgBatting(playerId) : getCachedFgPitching(playerId);
    const cachedStatcast = getCachedStatcast(playerId, role, season);

    const needPlayer = cachedPlayer === undefined;
    const needFg = cachedFg === undefined;
    const needSc = cachedStatcast === undefined;

    if (needPlayer) {
      setPlayer(null);
    }

    const cacheComplete = !needPlayer && !needFg && !needSc;

    if (cacheComplete) {
      setError(null);
      setPlayer(cachedPlayer as PlayerRow);
      if (role === 'batting') {
        setFgBattingCard(cachedFg);
        setFgPitchingCard(EMPTY_FG_BATTING_CARD);
      } else {
        setFgPitchingCard(cachedFg);
        setFgBattingCard(EMPTY_FG_BATTING_CARD);
      }
      setStatcast(cachedStatcast);
      setFetchingPlayer(false);
      setFetchingFg(false);
      setFetchingSc(false);
      return () => {
        cancelled = true;
      };
    }

    setFetchingPlayer(needPlayer);
    setFetchingFg(needFg);
    setFetchingSc(needSc);
    setError(null);

    void (async () => {
      try {
        let combinedErr: string | null = null;
        const pushErr = (msg: string) => {
          combinedErr = combinedErr ? `${combinedErr}; ${msg}` : msg;
        };

        let p: PlayerRow | undefined = cachedPlayer as PlayerRow | undefined;
        if (needPlayer) {
          const r0 = await fetch(`${base}`);
          if (cancelled) return;

          if (!r0.ok) {
            const j = (await readJson(r0)) as { error?: string };
            setError(j?.error ?? `Player request failed (${r0.status})`);
            setPlayer(null);
            setFgPitchingCard(EMPTY_FG_BATTING_CARD);
            setFgBattingCard(EMPTY_FG_BATTING_CARD);
            setStatcast(null);
            setFetchingPlayer(false);
            setFetchingFg(false);
            setFetchingSc(false);
            return;
          }

          p = (await readJson(r0)) as PlayerRow;
          if (!cancelled) setCachedPlayer(playerId, p as CachedPlayerRow);
        }

        if (cancelled) return;
        setPlayer(p ?? null);
        if (!cancelled) setFetchingPlayer(false);

        const applyFgFromCache = () => {
          if (role === 'batting') {
            setFgBattingCard(cachedFg!);
            setFgPitchingCard(EMPTY_FG_BATTING_CARD);
          } else {
            setFgPitchingCard(cachedFg!);
            setFgBattingCard(EMPTY_FG_BATTING_CARD);
          }
        };

        const fgPromise = (async () => {
          if (!needFg) {
            applyFgFromCache();
            if (!cancelled) setFetchingFg(false);
            return;
          }
          try {
            const r1 = await fetch(fgUrl);
            if (cancelled) return;
            if (role === 'batting') {
              if (!r1.ok) {
                const j = (await readJson(r1)) as { error?: string };
                pushErr(j?.error ?? `FG batting card failed (${r1.status})`);
                setFgBattingCard(EMPTY_FG_BATTING_CARD);
              } else {
                const payload = (await readJson(r1)) as FgBattingCardApi;
                const normalized = normalizeFgCardPayload(payload);
                setFgBattingCard(normalized);
                setFgPitchingCard(EMPTY_FG_BATTING_CARD);
                if (!cancelled) setCachedFgBatting(playerId, normalized);
              }
            } else {
              if (!r1.ok) {
                const j = (await readJson(r1)) as { error?: string };
                pushErr(j?.error ?? `FG pitching card failed (${r1.status})`);
                setFgPitchingCard(EMPTY_FG_BATTING_CARD);
              } else {
                const payload = (await readJson(r1)) as FgBattingCardApi;
                const normalized = normalizeFgCardPayload(payload);
                setFgPitchingCard(normalized);
                if (!cancelled) setCachedFgPitching(playerId, normalized);
              }
              setFgBattingCard(EMPTY_FG_BATTING_CARD);
            }
          } finally {
            if (!cancelled) setFetchingFg(false);
          }
        })();

        const scPromise = (async () => {
          if (!needSc) {
            if (!cancelled) {
              setStatcast(cachedStatcast!);
              setFetchingSc(false);
            }
            return;
          }
          try {
            const r2 = await fetch(statcastUrl);
            if (cancelled) return;
            if (!r2.ok) {
              const j = (await readJson(r2)) as { error?: string };
              pushErr(j?.error ?? `Statcast request failed (${r2.status})`);
              setStatcast(null);
            } else {
              const scPayload = (await readJson(r2)) as Record<string, unknown>;
              setStatcast(scPayload);
              if (!cancelled) setCachedStatcast(playerId, role, season, scPayload);
            }
          } finally {
            if (!cancelled) setFetchingSc(false);
          }
        })();

        await Promise.all([fgPromise, scPromise]);

        if (cancelled) return;
        setError(combinedErr);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setFetchingFg(false);
        setFetchingSc(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [playerId, season, role]);

  const yearChoices = useMemo(() => {
    const cy = getDefaultCardSeasonYear();
    const top = Math.min(CARD_SEASON_YEAR_MAX, cy + 2);
    const ys: number[] = [];
    for (let y = top; y >= 1985; y--) ys.push(y);
    return ys;
  }, []);

  useEffect(() => {
    if (!autoFallbackLatestSeasonIfEmpty) return;
    const cy = getDefaultCardSeasonYear();
    if (season !== cy) return;
    if (fetchingFg) return;
    if (!player) return;
    if (role === 'batting') {
      if (fgSeasonHasConsolidatedRow(fgBattingCard.seasons, season)) return;
      const ms = fgBattingCard.max_season;
      if (ms != null && Number.isFinite(ms) && ms > 0 && ms !== season) {
        setSeason(Math.min(CARD_SEASON_YEAR_MAX, ms));
      }
      return;
    }

    if (fgSeasonHasConsolidatedRow(fgPitchingCard.seasons, season)) return;
    const msP = fgPitchingCard.max_season;
    if (msP != null && Number.isFinite(msP) && msP > 0 && msP !== season) {
      setSeason(Math.min(CARD_SEASON_YEAR_MAX, msP));
    }
  }, [
    autoFallbackLatestSeasonIfEmpty,
    season,
    fetchingFg,
    player,
    fgPitchingCard.seasons,
    fgPitchingCard.max_season,
    fgBattingCard.seasons,
    fgBattingCard.max_season,
    playerId,
    role,
    setSeason,
  ]);

  const collapseStatcastLayout = isMdUp && statcastCollapsed;
  const statcastAvailable = statcast?.statcast_available === true;

  const toolbar = (
    <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }} flexWrap="wrap" gap={1}>
      {variant === 'page' ? (
        <Button component={Link} to="/" variant="text" size="small">
          ← Chat
        </Button>
      ) : (
        <Stack direction="row" alignItems="center" spacing={0.5}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
            Player card
          </Typography>
          {onClose != null && (
            <IconButton aria-label="Close player card" size="small" onClick={onClose} edge="end">
              <CloseIcon fontSize="small" />
            </IconButton>
          )}
        </Stack>
      )}
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
        {variant === 'sidebar' && (
          <Button component={Link} to={`/players/${playerId}?season=${season}&role=${role}`} size="small" variant="outlined">
            Full page
          </Button>
        )}
        <FormControl size="small" sx={{ minWidth: 110 }}>
          <InputLabel id={`season-${variant}`}>Season</InputLabel>
          <Select
            labelId={`season-${variant}`}
            label="Season"
            value={season}
            onChange={(e) => setSeason(Number(e.target.value))}
          >
            {yearChoices.map((y) => (
              <MenuItem key={y} value={y}>
                {y}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={role}
          onChange={(_, v) => {
            if (v === 'batting' || v === 'pitching') setRole(v);
          }}
        >
          <ToggleButton value="batting">Batting</ToggleButton>
          <ToggleButton value="pitching">Pitching</ToggleButton>
        </ToggleButtonGroup>
      </Stack>
    </Stack>
  );

  const inner = (
    <>
      {error && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {fetchingPlayer && !player && <Typography color="text.secondary">Loading player…</Typography>}
      {player && (
        <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: {
                xs: '1fr',
                md: collapseStatcastLayout ? 'minmax(0, 1fr) 44px' : 'minmax(260px, 1fr) minmax(260px, 1fr)',
              },
              gap: 0,
            }}
          >
            <Box
              sx={{
                p: variant === 'sidebar' ? 1.5 : 2,
                minWidth: 0,
                borderRight: { md: collapseStatcastLayout ? 0 : 1 },
                borderColor: 'divider',
              }}
            >
              <Typography variant="overline" color="text.secondary">
                Player
              </Typography>
              <Typography variant={variant === 'sidebar' ? 'h6' : 'h5'} sx={{ fontWeight: 600 }}>
                {player.name_first} {player.name_last}
              </Typography>
              <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ mt: 1, mb: 1 }}>
                {player.birth_date != null && player.birth_date !== '' && (
                  <Chip size="small" variant="outlined" label={`Born ${String(player.birth_date)}`} />
                )}
                {player.key_mlbam != null && (
                  <Chip size="small" variant="outlined" label={`MLBAM ${player.key_mlbam}`} />
                )}
              </Stack>
              <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
                FanGraphs (MLB)
              </Typography>
              {fetchingFg ? (
                <Typography color="text.secondary" variant="body2">
                  Loading FanGraphs…
                </Typography>
              ) : role === 'batting' ? (
                battingCard.career ? (
                  <>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
                      Career stats
                    </Typography>
                    <BattingCardTable lines={[battingCard.career]} variant={variant} />
                    <Typography variant="subtitle2" sx={{ fontWeight: 600, mt: 1.5, mb: 0.5 }}>
                      By season (MLB)
                    </Typography>
                    <BattingCardTable lines={battingCard.lastSeasons} variant={variant} />
                  </>
                ) : (
                  <Typography variant="caption" color="text.secondary">
                    No FanGraphs batting rows for this player.
                  </Typography>
                )
              ) : pitchingCard.career ? (
                <>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
                    Career stats
                  </Typography>
                  <PitchingCardTable lines={[pitchingCard.career]} variant={variant} />
                  <Typography variant="subtitle2" sx={{ fontWeight: 600, mt: 1.5, mb: 0.5 }}>
                    By season (MLB)
                  </Typography>
                  <PitchingCardTable lines={pitchingCard.lastSeasons} variant={variant} />
                </>
              ) : (
                <Typography variant="caption" color="text.secondary">
                  No FanGraphs pitching rows for this player.
                </Typography>
              )}
              <Typography variant="subtitle2" sx={{ fontWeight: 600, mt: 2, mb: 0.5 }}>
                Fielding (FanGraphs)
              </Typography>
              <FieldingTable rows={fieldingRows} />
              <OaaHeatmapPlaceholder playerId={playerId} gameYear={season} />
            </Box>
            {collapseStatcastLayout ? (
              <Box
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  py: 1,
                  px: 0.25,
                  bgcolor: 'action.hover',
                  borderLeft: 1,
                  borderColor: 'divider',
                }}
              >
                <IconButton
                  size="small"
                  aria-label="Expand Statcast panel"
                  onClick={() => setStatcastCollapsed(false)}
                  sx={{ my: 'auto' }}
                >
                  <ChevronLeft fontSize="small" />
                </IconButton>
              </Box>
            ) : (
              <Box
                sx={{
                  p: variant === 'sidebar' ? 1.5 : 2,
                  bgcolor: 'action.hover',
                  minWidth: 0,
                }}
              >
                <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                    Statcast
                  </Typography>
                  {isMdUp && (
                    <IconButton
                      size="small"
                      aria-label="Collapse Statcast panel"
                      onClick={() => setStatcastCollapsed(true)}
                      edge="end"
                    >
                      <ChevronRight fontSize="small" />
                    </IconButton>
                  )}
                </Stack>
                {fetchingSc ? (
                  <Typography color="text.secondary" variant="body2">
                    Loading Statcast…
                  </Typography>
                ) : (
                  <>
                    {!statcast && (
                      <Typography color="text.secondary">No Statcast payload.</Typography>
                    )}
                    {statcast && statcast.statcast_available === false && (
                      <Alert severity="info" sx={{ py: 0.5 }}>
                        {String(statcast.reason ?? 'Statcast unavailable')}
                      </Alert>
                    )}
                    {statcast && statcastAvailable && role === 'pitching' && (
                      <Stack spacing={1}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                          Pitch Mix
                        </Typography>
                        {pitchingMixDisplay.length > 0 &&
                          (Array.isArray(statcast.velo_dist) && (statcast.velo_dist as unknown[]).length > 0 ? (
                            <PitchMixVeloTable
                              mix={pitchingMixDisplay}
                              veloRows={(pitchingVeloDisplay ?? statcast.velo_dist) as Record<string, unknown>[]}
                            />
                          ) : (
                            <Table size="small" sx={{ width: '100%', maxWidth: 420 }}>
                              <TableHead>
                                <TableRow>
                                  <TableCell>Pitch</TableCell>
                                  <TableCell align="right">%</TableCell>
                                  <TableCell align="right">Velo</TableCell>
                                </TableRow>
                              </TableHead>
                              <TableBody>
                                {pitchingMixDisplay.map((row, i) => {
                                  const pt = String(row.pitch_type ?? '');
                                  return (
                                    <TableRow key={i}>
                                      <TableCell>
                                        <Stack direction="row" alignItems="center" spacing={0.75}>
                                          <Box
                                            component="span"
                                            sx={{
                                              minWidth: 22,
                                              width: 22,
                                              height: 10,
                                              borderRadius: 999,
                                              bgcolor: pitchTypeMovementColor(pt),
                                              flexShrink: 0,
                                              border: '1px solid',
                                              borderColor: 'divider',
                                            }}
                                          />
                                          <Stack spacing={0} sx={{ minWidth: 0 }}>
                                            <Typography component="span" variant="body2" noWrap>
                                              {pitchTypeName(pt)}
                                            </Typography>
                                            <Typography
                                              component="span"
                                              variant="caption"
                                              color="text.secondary"
                                              sx={{ lineHeight: 1.1 }}
                                            >
                                              {pt}
                                            </Typography>
                                          </Stack>
                                        </Stack>
                                      </TableCell>
                                      <TableCell align="right">{String(row.pct ?? '')}</TableCell>
                                      <TableCell align="right">{String(row.avg_velo ?? '')}</TableCell>
                                    </TableRow>
                                  );
                                })}
                              </TableBody>
                            </Table>
                          ))}
                        {pitchingMixExtendedDisplay.length > 0 && (
                          <>
                            <Typography variant="subtitle2" sx={{ fontWeight: 600, mt: 1 }}>
                              Pitch mix (rates)
                            </Typography>
                            <TableContainer sx={{ maxWidth: '100%', overflow: 'auto' }}>
                              <Table size="small" sx={{ '& td, & th': { fontSize: '0.68rem', whiteSpace: 'nowrap' } }}>
                                <TableHead>
                                  <TableRow>
                                    <TableCell>Pitch</TableCell>
                                    <TableCell align="right">%</TableCell>
                                    <TableCell align="right">Zone%</TableCell>
                                    <TableCell align="right">Chase%</TableCell>
                                    <TableCell align="right">
                                      <Tooltip
                                        title="Swinging strikes ÷ swings on this pitch type (fouls count as swings). Same as whiff-per-swing."
                                        arrow
                                        placement="top"
                                      >
                                        <Box component="span" sx={{ cursor: 'help', textDecoration: 'underline dotted' }}>
                                          Whiff%
                                        </Box>
                                      </Tooltip>
                                    </TableCell>
                                    <TableCell align="right">
                                      <Tooltip
                                        title="Swinging strikes ÷ all pitches of this type (includes takes). Usually lower than Whiff% because the denominator is larger than swings-only."
                                        arrow
                                        placement="top"
                                      >
                                        <Box component="span" sx={{ cursor: 'help', textDecoration: 'underline dotted' }}>
                                          SwStr%
                                        </Box>
                                      </Tooltip>
                                    </TableCell>
                                    <TableCell align="right">GB%</TableCell>
                                    <TableCell align="right">FB%</TableCell>
                                    <TableCell align="right">HR%</TableCell>
                                  </TableRow>
                                </TableHead>
                                <TableBody>
                                  {pitchingMixExtendedDisplay.map((row, i) => {
                                    const pt = String(row.pitch_type ?? '');
                                    return (
                                      <TableRow key={i}>
                                        <TableCell>
                                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                            <Box
                                              sx={{
                                                width: 16,
                                                height: 7,
                                                borderRadius: 99,
                                                bgcolor: pitchTypeMovementColor(pt),
                                                border: 1,
                                                borderColor: 'divider',
                                              }}
                                            />
                                            {pitchTypeName(pt)}
                                          </Box>
                                        </TableCell>
                                        <TableCell align="right">{String(row.pct ?? '')}</TableCell>
                                        <TableCell align="right">{String(row.zone_pct ?? '—')}</TableCell>
                                        <TableCell align="right">{String(row.chase_pct ?? '—')}</TableCell>
                                        <TableCell align="right">{String(row.whiff_pct ?? '—')}</TableCell>
                                        <TableCell align="right">{String(row.swstr_pct ?? '—')}</TableCell>
                                        <TableCell align="right">{String(row.gb_pct ?? '—')}</TableCell>
                                        <TableCell align="right">{String(row.fb_pct ?? '—')}</TableCell>
                                        <TableCell align="right">{String(row.hr_pct ?? '—')}</TableCell>
                                      </TableRow>
                                    );
                                  })}
                                </TableBody>
                              </Table>
                            </TableContainer>
                          </>
                        )}
                        {Array.isArray(statcast.sample) && (statcast.sample as unknown[]).length > 0 && (
                          <MovementMiniPlot
                            rows={
                              (role === 'pitching'
                                ? (statcastSampleMovement ?? (statcast.sample as Record<string, unknown>[]))
                                : (statcast.sample as Record<string, unknown>[])) as Record<string, unknown>[]
                            }
                            leagueMovement={leagueMovementForPlot ?? undefined}
                            armAngle={armOverlay ?? undefined}
                          />
                        )}
                      </Stack>
                    )}
                    {statcast && statcastAvailable && role === 'batting' && (
                      <Stack spacing={1}>
                        <Stack direction="row" spacing={0.5} flexWrap="wrap">
                          <Chip size="small" label={`BBE ${String((statcast.batted_ball as Record<string, unknown>)?.bbe ?? '—')}`} />
                          <Chip size="small" label={`EV ${String((statcast.batted_ball as Record<string, unknown>)?.avg_ev ?? '—')}`} />
                          <Chip size="small" label={`LA ${String((statcast.batted_ball as Record<string, unknown>)?.avg_la ?? '—')}`} />
                        </Stack>
                        {statcast.bat_path != null && typeof statcast.bat_path === 'object' && (
                          <BatPathSummary batPath={statcast.bat_path as BatPathApiRow} />
                        )}
                        <BatSpeedSeasonSpark playerId={playerId} season={season} fromYear={season - 5} />
                        {Array.isArray(statcast.sample) && (
                          <SprayChart rows={statcast.sample as Record<string, unknown>[]} gameYear={season} />
                        )}
                      </Stack>
                    )}
                  </>
                )}
              </Box>
            )}
          </Box>
        </Paper>
      )}
    </>
  );

  if (variant === 'sidebar') {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
        {toolbar}
        <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>{inner}</Box>
      </Box>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      {toolbar}
      {inner}
    </Container>
  );
}
