import ChevronLeft from '@mui/icons-material/ChevronLeft';
import ChevronRight from '@mui/icons-material/ChevronRight';
import CloseIcon from '@mui/icons-material/Close';
import ExpandMore from '@mui/icons-material/ExpandMore';
import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
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
import Skeleton from '@mui/material/Skeleton';
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
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BATTING_CARD_HEADERS,
  type BattingCardLine,
  type FgBattingCardApi,
  battingCardLinesFromCareerViews,
  FG_CARD_SEASON_ROW_LIMIT,
  fgCardHasAnyRows,
  fgCardSeasonRowIsSelected,
  fgSeasonHasConsolidatedRow,
  formatBattingCardCell,
  normalizeFgCardPayload,
} from '@/lib/batterFgTables.js';
import { CARD_SEASON_YEAR_MAX, getDefaultCardSeasonYear } from '@/lib/cardSeasonYear.js';
import {
  MovementMiniPlot,
  pitchTypeMovementColor,
  type ArmAngleOverlay,
  type LeagueMovementRow,
} from '@/features/movement-velo/MovementMiniPlot.js';
import { mlbTeamPrimaryHex } from '@/lib/mlbTeamPrimaryHex.js';
import { pitchTypeName } from '@/features/pitch-mix/pitchTypeLabels.js';
import { OutfieldFieldingTables } from '@/features/fielding-frv/OutfieldFieldingTables.js';
import {
  PitchingCardTable,
  pitchingCardLinesFromCareerViews,
} from '@/features/pitch-mix/pitcherFgTables.js';
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
} from '@/features/player-card/playerCardRequestCache.js';
import { BatPathSummary, type BatPathApiRow } from '@/features/batting-path/BatPathSummary.js';
import { inferPrimaryCardRole } from '@/features/player-card/playerCardPrimaryRole.js';
import { fetchFgRoleHint } from '@/lib/playerFgRoleHint.js';
import { SprayChart } from '@/features/spray-chart/SprayChart.js';
import { OaaHeatmapPlaceholder } from '@/features/fielding-oaa/OaaHeatmapPlaceholder.js';
import { PitchMixVeloTable } from '@/features/pitch-mix/PitchMixVeloTable.js';
import { LeaguePercentilesPanel } from '@/features/league-percentiles/LeaguePercentilesPanel.js';
import { ScoutingToolsPrototype } from '@/features/scouting-tools/ScoutingToolsPrototype.js';
import { JawsExpandedBlock } from '@/features/player-card/JawsExpandedBlock.js';
import {
  parseStatcastSummaryPayload,
  type StatcastJsonRow,
  type StatcastSummaryPayload,
} from '@/lib/statcastSummaryPayload.js';
import fgTableShell from '@/styles/fgTableShell.module.css';
import styles from './PlayerCardPanel.module.css';

export type CardRole = 'batting' | 'pitching' | 'fielding';

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
  rows: StatcastJsonRow[] | undefined,
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
function mixUsagePct(row: StatcastJsonRow): number {
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
  rows: StatcastJsonRow[] | undefined,
  minPct: number
): StatcastJsonRow[] {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const f = rows.filter((r) => mixUsagePct(r) >= minPct);
  return f.length > 0 ? f : rows;
}

/**
 * Pitch types with usage ≥ `minPct` for league/movement overlays (prefer `mix_extended`, then `mix`,
 * then any pitch type seen in `sample`).
 */
function pitchTypesAtLeastPctFromStatcast(
  statcast: StatcastSummaryPayload | null,
  minPct: number
): Set<string> | null {
  if (!statcast) return null;
  const mixExt = statcast.mix_extended;
  if (Array.isArray(mixExt) && mixExt.length > 0) {
    const out = new Set<string>();
    for (const r of mixExt) {
      if (mixUsagePct(r) < minPct) continue;
      const c = normPitchCode(String(r.pitch_type ?? ''));
      if (c) out.add(c);
    }
    if (out.size) return out;
  }
  const mix = statcast.mix;
  if (Array.isArray(mix) && mix.length > 0) {
    const out = new Set<string>();
    for (const r of mix) {
      if (mixUsagePct(r) < minPct) continue;
      const c = normPitchCode(String(r.pitch_type ?? ''));
      if (c) out.add(c);
    }
    if (out.size) return out;
  }
  const sample = statcast.sample;
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
  sample: StatcastJsonRow[] | undefined,
  types: Set<string> | null
): StatcastJsonRow[] {
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

/** Wire payload from `GET /api/players/:id/mlb-bio` (MLB Stats API snapshot cache). */
type MlbBioWirePayload = {
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
  awards?: {
    all_star: number;
    mvp: number;
    cy_young: number;
    gold_glove: number;
    silver_slugger: number;
    platinum_glove: number;
    reliever_of_year: number;
  } | null;
  awards_stale?: boolean;
};

function formatMlbBirthplace(bio: MlbBioWirePayload): string | null {
  const city = bio.birth_city?.trim();
  const st = bio.birth_state_province?.trim();
  const ctry = bio.birth_country?.trim();
  if (!city && !st && !ctry) return null;
  const us = ctry === 'USA' || ctry === 'United States';
  if (us && city && st) return `${city}, ${st}`;
  if (city && ctry) return `${city}, ${ctry}`;
  if (city && st) return `${city}, ${st}`;
  return city ?? ctry ?? st ?? null;
}

function headerLinePosTeam(
  fg: { position: string | null; team: string | null },
  bio: MlbBioWirePayload | null
): string {
  const pos = fg.position ?? bio?.primary_position_abbr ?? bio?.primary_position_name ?? null;
  const team = fg.team ?? bio?.current_team_name ?? null;
  const parts = [pos, team].filter((x): x is string => x != null && String(x).trim() !== '');
  return parts.join(' | ');
}

/** Honors line from MLB Stats API `/people/{id}/awards`; each segment only if count ≥ 1. */
function formatMlbAwardsBioLine(bio: MlbBioWirePayload): string | null {
  const a = bio.awards;
  if (!a) return null;
  const parts: string[] = [];
  if (a.all_star > 0) parts.push(`${a.all_star}× All-Star`);
  if (a.mvp > 0) parts.push(`${a.mvp}× MVP`);
  if (a.cy_young > 0) parts.push(`${a.cy_young}× Cy Young`);
  if (a.gold_glove > 0) parts.push(`${a.gold_glove}× Gold Glove`);
  if (a.silver_slugger > 0) parts.push(`${a.silver_slugger}× Silver Slugger`);
  if (a.platinum_glove > 0) parts.push(`${a.platinum_glove}× Platinum Glove`);
  if (a.reliever_of_year > 0) parts.push(`${a.reliever_of_year}× Reliever of the Year`);
  return parts.length ? parts.join(' · ') : null;
}

function headerLinePhysical(bio: MlbBioWirePayload | null, loading: boolean): string | null {
  if (loading) return 'Loading bio…';
  if (!bio) return null;
  const chunks: string[] = [];
  if (bio.bat_side && bio.pitch_hand) {
    chunks.push(`Bats ${bio.bat_side} / Throws ${bio.pitch_hand}`);
  } else if (bio.bat_side) {
    chunks.push(`Bats ${bio.bat_side}`);
  } else if (bio.pitch_hand) {
    chunks.push(`Throws ${bio.pitch_hand}`);
  }
  const hw: string[] = [];
  if (bio.height) hw.push(bio.height);
  if (bio.weight != null && Number.isFinite(bio.weight)) hw.push(`${bio.weight} lb`);
  if (hw.length) chunks.push(hw.join(', '));
  if (bio.age_season != null) chunks.push(`Age ${bio.age_season} (${bio.season_year})`);
  return chunks.length ? chunks.join(' · ') : null;
}

function statcastRole(r: CardRole): 'pitcher' | 'batter' {
  if (r === 'pitching') return 'pitcher';
  return 'batter';
}

function fgSeasonMetaForYear(
  seasons: Record<string, unknown>[],
  year: number
): { team: string | null; position: string | null } {
  const row = seasons.find((s) => Number(s.season) === year);
  if (!row || typeof row !== 'object') return { team: null, position: null };
  const o = row as Record<string, unknown>;
  const t = o.team_display;
  const p = o.position_display;
  return {
    team: typeof t === 'string' && t.trim() !== '' ? t.trim() : null,
    position: typeof p === 'string' && p.trim() !== '' ? p.trim() : null,
  };
}

const EMPTY_FG_BATTING_CARD: FgBattingCardApi = {
  career: null,
  seasons: [],
  max_season: null,
  has_row_for_season: null,
  jaws_fwar: null,
  peak_war_fwar: null,
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
  selectedSeason,
}: {
  lines: BattingCardLine[];
  variant: 'page' | 'sidebar';
  /** When set, the matching MLB season row is subtly highlighted (not Career). */
  selectedSeason?: number;
}) {
  if (lines.length === 0) return null;
  return (
    <TableContainer
      className={`${fgTableShell.fgTableWrap} ${fgTableShell.fgTableWrapMb}`}
    >
      <Table
        size="small"
        className={
          variant === 'sidebar'
            ? fgTableShell.fgTableDense
            : fgTableShell.fgTableNormal
        }
      >
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
          {lines.map((line) => {
            const selected = fgCardSeasonRowIsSelected(line.seasonLabel, selectedSeason);
            return (
              <TableRow
                key={line.seasonLabel}
                sx={
                  selected
                    ? {
                        bgcolor: 'action.selected',
                        borderLeft: 3,
                        borderLeftColor: 'primary.main',
                        '& .MuiTableCell-root': { fontWeight: 600 },
                      }
                    : undefined
                }
              >
                <TableCell
                  component="th"
                  scope="row"
                  sx={{ fontWeight: line.seasonLabel === 'Career' ? 700 : selected ? 600 : 500 }}
                >
                  {line.seasonLabel}
                </TableCell>
                {BATTING_CARD_HEADERS.map(({ key }) => (
                  <TableCell key={key} align={key === 'teamAbbr' ? 'left' : 'right'}>
                    {formatBattingCardCell(key, line[key])}
                  </TableCell>
                ))}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function StatcastCollapsibleSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Accordion defaultExpanded disableGutters elevation={0} className={styles.statcastAccordion}>
      <AccordionSummary expandIcon={<ExpandMore fontSize="small" />}>
        <Typography variant="subtitle2" className={styles.subtitleStrong}>
          {title}
        </Typography>
      </AccordionSummary>
      <AccordionDetails className={styles.accordionDetailsFlush}>{children}</AccordionDetails>
    </Accordion>
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
  const [statcast, setStatcast] = useState<StatcastSummaryPayload | null>(null);
  /** Desktop-only: narrow Statcast rail when Savant has nothing for this player/year. */
  const [statcastCollapsed, setStatcastCollapsed] = useState(false);
  const [fieldingHistoryRows, setFieldingHistoryRows] = useState<Record<string, unknown>[]>([]);
  /** `fg-fielding` fetch is async from main FG card; gate fielding tables + OAA on this so empty rows do not imply “no FG fielding”. */
  const [fieldingHistoryLoading, setFieldingHistoryLoading] = useState(() => defaultRole === 'fielding');
  const [mlbBio, setMlbBio] = useState<MlbBioWirePayload | null>(null);
  const [mlbBioLoading, setMlbBioLoading] = useState(false);

  const battingCard = useMemo(() => battingCardLinesFromCareerViews(fgBattingCard), [fgBattingCard]);
  const pitchingCard = useMemo(() => pitchingCardLinesFromCareerViews(fgPitchingCard), [fgPitchingCard]);

  const hasFgBatting = useMemo(() => fgCardHasAnyRows(fgBattingCard), [fgBattingCard]);
  const hasFgPitching = useMemo(() => fgCardHasAnyRows(fgPitchingCard), [fgPitchingCard]);

  useLayoutEffect(() => {
    if (fetchingFg) return;
    if (role === 'batting' && !hasFgBatting) {
      setRole(hasFgPitching ? 'pitching' : 'fielding');
    } else if (role === 'pitching' && !hasFgPitching) {
      setRole(hasFgBatting ? 'batting' : 'fielding');
    }
  }, [fetchingFg, role, hasFgBatting, hasFgPitching, setRole]);

  const pitchingMixDisplay = useMemo(
    () => filterMixRowsMinPct(statcast?.mix, PITCH_CARD_MIN_USAGE_PCT),
    [statcast?.mix]
  );
  const pitchingMixExtendedDisplay = useMemo(
    () => filterMixRowsMinPct(statcast?.mix_extended, PITCH_CARD_MIN_USAGE_PCT),
    [statcast?.mix_extended]
  );
  /** L/R splits aligned to `pitchingMixDisplay` pitch types for the velo + handedness combo table. */
  const pitchingMixByStandForVelo = useMemo(() => {
    const rows = statcast?.mix_extended_by_stand;
    if (!Array.isArray(rows) || rows.length === 0) return undefined;
    const base =
      pitchingMixExtendedDisplay.length > 0
        ? pitchingMixExtendedDisplay
        : filterMixRowsMinPct(statcast?.mix, PITCH_CARD_MIN_USAGE_PCT);
    const keep = new Set(base.map((r: StatcastJsonRow) => normPitchCode(String(r.pitch_type ?? ''))));
    if (keep.size === 0) return rows;
    return rows.filter((r: StatcastJsonRow) => keep.has(normPitchCode(String(r.pitch_type ?? ''))));
  }, [statcast?.mix_extended_by_stand, statcast?.mix, pitchingMixExtendedDisplay]);
  const pitchingVeloDisplay = useMemo(() => {
    const v = statcast?.velo_dist;
    if (!Array.isArray(v) || !pitchingMixDisplay.length) return v;
    const codes = new Set(
      pitchingMixDisplay.map((r: StatcastJsonRow) => normPitchCode(String(r.pitch_type ?? '')))
    );
    const f = v.filter((row: StatcastJsonRow) => codes.has(normPitchCode(String(row.pitch_type ?? ''))));
    return f.length > 0 ? f : v;
  }, [statcast?.velo_dist, pitchingMixDisplay]);
  const pitchTypesMovementFilter = useMemo(
    () =>
      role === 'pitching' ? pitchTypesAtLeastPctFromStatcast(statcast, PITCH_CARD_MIN_USAGE_PCT) : null,
    [role, statcast]
  );
  const statcastSampleMovement = useMemo(() => {
    const s = statcast?.sample;
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
        role === 'pitching' ? statcastSampleMovement : statcast?.sample,
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

  useLayoutEffect(() => {
    if (role !== 'fielding') {
      setFieldingHistoryLoading(false);
      return;
    }
    setFieldingHistoryLoading(true);
    setFieldingHistoryRows([]);
  }, [playerId, role]);

  useEffect(() => {
    if (role !== 'fielding') return;
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch(`/api/players/${playerId}/fg-fielding?limit=200`);
        const j = (await r.json()) as { rows?: unknown };
        if (cancelled) return;
        if (r.ok && Array.isArray(j.rows)) setFieldingHistoryRows(j.rows as Record<string, unknown>[]);
        else setFieldingHistoryRows([]);
      } catch {
        if (!cancelled) setFieldingHistoryRows([]);
      } finally {
        if (!cancelled) setFieldingHistoryLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [playerId, role]);

  /** No Savant payload for this player/year → narrow the Statcast rail on desktop; otherwise use full column. */
  useEffect(() => {
    if (role === 'fielding') return;
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
    if (player?.key_mlbam == null) {
      setMlbBio(null);
      setMlbBioLoading(false);
      return;
    }
    let cancelled = false;
    setMlbBioLoading(true);
    void (async () => {
      try {
        const r = await fetch(`/api/players/${playerId}/mlb-bio?season=${season}`);
        if (cancelled) return;
        if (r.ok) {
          setMlbBio((await r.json()) as MlbBioWirePayload);
        } else {
          setMlbBio(null);
        }
      } catch {
        if (!cancelled) setMlbBio(null);
      } finally {
        if (!cancelled) setMlbBioLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [playerId, season, player?.key_mlbam]);

  useEffect(() => {
    let cancelled = false;
    const base = `/api/players/${playerId}`;
    const fgSeasonsQ = new URLSearchParams({ last_seasons: String(FG_CARD_SEASON_ROW_LIMIT) });
    const fgBatUrl = `${base}/fg-batting-card?${fgSeasonsQ}`;
    const fgPitUrl = `${base}/fg-pitching-card?${fgSeasonsQ}`;

    const scRole = statcastRole(role === 'fielding' ? 'batting' : role);
    const scQ = new URLSearchParams({
      role: scRole,
      game_year: String(season),
      limit: scRole === 'batter' ? '8000' : '4000',
    });
    const statcastUrl = `${base}/statcast-summary?${scQ}`;

    const cachedPlayer = getCachedPlayer(playerId);
    const fgBatCached = getCachedFgBatting(playerId);
    const fgPitCached = getCachedFgPitching(playerId);
    const cachedStatcast =
      role === 'fielding' ? undefined : getCachedStatcast(playerId, role, season);

    const needPlayer = cachedPlayer === undefined;
    /** Always hydrate both FG cards so we can hide Batting/Pitching tabs and correct an invalid `role` from the URL. */
    const needFg = fgBatCached === undefined || fgPitCached === undefined;
    const needSc = role !== 'fielding' && cachedStatcast === undefined;

    if (needPlayer) {
      setPlayer(null);
    }

    const cacheComplete = !needPlayer && !needFg && !needSc;

    if (cacheComplete) {
      setError(null);
      setPlayer(cachedPlayer as PlayerRow);
      setFgBattingCard(fgBatCached ?? EMPTY_FG_BATTING_CARD);
      setFgPitchingCard(fgPitCached ?? EMPTY_FG_BATTING_CARD);
      if (role === 'fielding') {
        setStatcast(null);
      } else {
        setStatcast(cachedStatcast ?? null);
      }
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

        const fgPromise = (async () => {
          if (!needFg) {
            setFgBattingCard(fgBatCached ?? EMPTY_FG_BATTING_CARD);
            setFgPitchingCard(fgPitCached ?? EMPTY_FG_BATTING_CARD);
            if (!cancelled) setFetchingFg(false);
            return;
          }
          try {
            const [rb, rp] = await Promise.all([fetch(fgBatUrl), fetch(fgPitUrl)]);
            if (cancelled) return;
            if (rb.ok) {
              const payload = (await readJson(rb)) as FgBattingCardApi;
              const normalized = normalizeFgCardPayload(payload);
              setFgBattingCard(normalized);
              if (!cancelled) setCachedFgBatting(playerId, normalized);
            } else {
              const j = (await readJson(rb)) as { error?: string };
              pushErr(j?.error ?? `FG batting card failed (${rb.status})`);
              setFgBattingCard(EMPTY_FG_BATTING_CARD);
            }
            if (rp.ok) {
              const payload = (await readJson(rp)) as FgBattingCardApi;
              const normalized = normalizeFgCardPayload(payload);
              setFgPitchingCard(normalized);
              if (!cancelled) setCachedFgPitching(playerId, normalized);
            } else {
              const j = (await readJson(rp)) as { error?: string };
              pushErr(j?.error ?? `FG pitching card failed (${rp.status})`);
              setFgPitchingCard(EMPTY_FG_BATTING_CARD);
            }
          } finally {
            if (!cancelled) setFetchingFg(false);
          }
        })();

        const scPromise = (async () => {
          if (role === 'fielding') {
            if (!cancelled) {
              setStatcast(null);
              setFetchingSc(false);
            }
            return;
          }
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
              const rawSc = await readJson(r2);
              const scPayload = parseStatcastSummaryPayload(rawSc);
              if (!scPayload.ok) {
                pushErr(`Statcast response invalid (${scPayload.error})`);
                setStatcast(null);
              } else {
                setStatcast(scPayload.value);
                if (!cancelled)
                  setCachedStatcast(playerId, role as 'batting' | 'pitching', season, scPayload.value);
              }
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
    if (role === 'fielding') return;
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

  const headerFgMeta = useMemo(() => {
    if (role === 'pitching') return fgSeasonMetaForYear(fgPitchingCard.seasons, season);
    if (role === 'batting') return fgSeasonMetaForYear(fgBattingCard.seasons, season);
    const b = fgSeasonMetaForYear(fgBattingCard.seasons, season);
    if (b.team || b.position) return b;
    return fgSeasonMetaForYear(fgPitchingCard.seasons, season);
  }, [role, season, fgBattingCard.seasons, fgPitchingCard.seasons]);

  const teamPrimaryHex = useMemo(() => mlbTeamPrimaryHex(headerFgMeta.team), [headerFgMeta.team]);

  const toolbar = (
    <Stack
      direction="row"
      justifyContent="space-between"
      alignItems="center"
      className={styles.toolbarStack}
      flexWrap="wrap"
      gap={1}
    >
      {variant === 'page' ? (
        <Button component={Link} to="/" variant="text" size="small">
          ← Chat
        </Button>
      ) : (
        <Stack direction="row" alignItems="center" spacing={0.5}>
          <Typography variant="subtitle2" className={styles.subtitleStrong}>
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
        <FormControl size="small" className={styles.seasonSelect}>
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
        {fetchingFg ? (
          <Stack direction="row" spacing={0.75} alignItems="center" aria-busy="true" aria-label="Loading card role tabs">
            <Skeleton variant="rounded" width={78} height={32} />
            <Skeleton variant="rounded" width={86} height={32} />
            <Skeleton variant="rounded" width={80} height={32} />
          </Stack>
        ) : (
          <ToggleButtonGroup
            exclusive
            size="small"
            value={role}
            onChange={(_, v) => {
              if (v === 'batting' || v === 'pitching' || v === 'fielding') setRole(v);
            }}
          >
            {hasFgBatting && <ToggleButton value="batting">Batting</ToggleButton>}
            {hasFgPitching && <ToggleButton value="pitching">Pitching</ToggleButton>}
            <ToggleButton value="fielding">Fielding</ToggleButton>
          </ToggleButtonGroup>
        )}
      </Stack>
    </Stack>
  );

  const inner = (
    <>
      {error && (
        <Alert severity="warning" className={styles.alertStackMargin}>
          {error}
        </Alert>
      )}
      {fetchingPlayer && !player && <Typography color="text.secondary">Loading player…</Typography>}
      {player && (
        <Paper variant="outlined" className={styles.cardPaper}>
          <Box
            className={`${styles.cardGrid} ${
              collapseStatcastLayout ? styles.cardGridCollapsed : styles.cardGridExpanded
            }`}
          >
            <Box
              className={`${styles.gridCellLeft} ${
                variant === 'sidebar' ? styles.gridPadSidebar : styles.gridPadPage
              }`}
            >
              <Typography variant="overline" color="text.secondary">
                Player
              </Typography>
              <Typography variant={variant === 'sidebar' ? 'h6' : 'h5'} className={styles.playerName}>
                {player.name_first} {player.name_last}
              </Typography>
              {(() => {
                const posTeam = headerLinePosTeam(headerFgMeta, mlbBio);
                const showPosTeamLine = !fetchingFg && posTeam !== '';
                const phys =
                  player.key_mlbam != null ? headerLinePhysical(mlbBio, mlbBioLoading) : null;
                const bornRich = mlbBio ? formatMlbBirthplace(mlbBio) : null;
                const bornFallback =
                  player.birth_date != null && player.birth_date !== ''
                    ? String(player.birth_date)
                    : null;
                const bornLine = bornRich ?? bornFallback;
                const honorsLine = mlbBio != null ? formatMlbAwardsBioLine(mlbBio) : null;
                return (
                  <Stack spacing={0.35} className={styles.bioStack}>
                    {fetchingFg && (
                      <Skeleton
                        variant="rounded"
                        width={280}
                        height={22}
                        sx={{ my: 0.25 }}
                        aria-label="Loading position and team"
                      />
                    )}
                    {showPosTeamLine && (
                      <Tooltip
                        title={`Position & team: FanGraphs (${season}) when available; MLB current roster when not.`}
                      >
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          sx={
                            teamPrimaryHex && headerFgMeta.team
                              ? { color: teamPrimaryHex, fontWeight: 600 }
                              : undefined
                          }
                        >
                          {posTeam}
                        </Typography>
                      </Tooltip>
                    )}
                    {phys != null && phys !== '' && (
                      <Typography variant="body2" color="text.secondary">
                        {phys}
                      </Typography>
                    )}
                    {bornLine != null && (
                      <Typography variant="body2" color="text.secondary">
                        Born {bornLine}
                      </Typography>
                    )}
                    {honorsLine != null && (
                      <Typography variant="caption" color="text.secondary" display="block">
                        {honorsLine}
                      </Typography>
                    )}
                    {mlbBio?.draft_summary != null && mlbBio.draft_summary.trim() !== '' && (
                      <Typography variant="caption" color="text.secondary" display="block">
                        {mlbBio.draft_summary}
                      </Typography>
                    )}
                    {mlbBio?.mlb_debut_date != null && (
                      <Typography variant="caption" color="text.secondary" display="block">
                        MLB debut {mlbBio.mlb_debut_date}
                      </Typography>
                    )}
                    {mlbBio?.nick_name != null && mlbBio.nick_name.trim() !== '' && (
                      <Typography variant="caption" color="text.secondary" display="block">
                        “{mlbBio.nick_name}”
                      </Typography>
                    )}
                    {(() => {
                      const j =
                        role === 'pitching' ? fgPitchingCard.jaws_fwar : fgBattingCard.jaws_fwar;
                      if (j == null || typeof j !== 'number' || !Number.isFinite(j)) return null;
                      const fgRole = role === 'pitching' ? 'pitching' : 'batting';
                      return (
                        <JawsExpandedBlock playerId={playerId} fgRole={fgRole} summaryJaws={j} />
                      );
                    })()}
                    {mlbBio?.stale === true && (
                      <Typography variant="caption" color="warning.main">
                        Bio may be stale (MLB Stats API unavailable when refreshing cache).
                      </Typography>
                    )}
                    {mlbBio?.awards_stale === true && mlbBio?.awards != null && (
                      <Typography variant="caption" color="warning.main">
                        Honors may be stale (awards refresh failed).
                      </Typography>
                    )}
                    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap className={styles.chipRowPad}>
                      {player.key_mlbam != null && (
                        <Chip size="small" variant="outlined" label={`MLBAM ${player.key_mlbam}`} />
                      )}
                    </Stack>
                  </Stack>
                );
              })()}
              <Stack spacing={0.75} sx={{ mt: 1.5, mb: 1 }}>
                <Typography variant="subtitle2" className={styles.sectionSubtitle}>
                  Scouting (prototype)
                </Typography>
                <ScoutingToolsPrototype playerId={playerId} season={season} cardRole={role} />
              </Stack>
              {role === 'fielding' ? (
                <>
                  <Typography variant="subtitle2" className={styles.sectionSubtitle}>
                    Fielding (FanGraphs)
                  </Typography>
                  {fetchingFg || fieldingHistoryLoading ? (
                    <Stack spacing={0.75} sx={{ mt: 0.5 }} aria-busy="true" aria-label="Loading fielding tables">
                      <Skeleton variant="rounded" width="100%" height={28} />
                      <Skeleton variant="rounded" width="100%" height={28} />
                      <Skeleton variant="rounded" width="92%" height={28} />
                    </Stack>
                  ) : (
                    <OutfieldFieldingTables
                      rows={fieldingHistoryRows}
                      primaryPositionDisplay={headerFgMeta.position}
                      selectedSeason={season}
                    />
                  )}
                </>
              ) : (
                <>
                  <Typography variant="subtitle2" className={styles.sectionSubtitle}>
                    FanGraphs (MLB)
                  </Typography>
                  {fetchingFg ? (
                    <Stack spacing={0.75} sx={{ mt: 0.5 }} aria-busy="true" aria-label="Loading FanGraphs tables">
                      <Skeleton variant="rounded" width="100%" height={28} />
                      <Skeleton variant="rounded" width="100%" height={28} />
                      <Skeleton variant="rounded" width="100%" height={28} />
                      <Skeleton variant="rounded" width="88%" height={28} />
                    </Stack>
                  ) : role === 'batting' ? (
                    battingCard.career ? (
                      <>
                        <Typography variant="subtitle2" className={styles.sectionSubtitle}>
                          Career stats
                        </Typography>
                        <BattingCardTable lines={[battingCard.career]} variant={variant} />
                        <Typography variant="subtitle2" className={styles.sectionSubtitleGrouped}>
                          By season (MLB)
                        </Typography>
                        <BattingCardTable lines={battingCard.lastSeasons} variant={variant} selectedSeason={season} />
                      </>
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        No FanGraphs batting rows for this player.
                      </Typography>
                    )
                  ) : pitchingCard.career ? (
                    <>
                      <Typography variant="subtitle2" className={styles.sectionSubtitle}>
                        Career stats
                      </Typography>
                      <PitchingCardTable lines={[pitchingCard.career]} variant={variant} />
                      <Typography variant="subtitle2" className={styles.sectionSubtitleGrouped}>
                        By season (MLB)
                      </Typography>
                      <PitchingCardTable lines={pitchingCard.lastSeasons} variant={variant} selectedSeason={season} />
                    </>
                  ) : (
                    <Typography variant="caption" color="text.secondary">
                      No FanGraphs pitching rows for this player.
                    </Typography>
                  )}
                </>
              )}
            </Box>
            {collapseStatcastLayout ? (
              <Box className={styles.statcastRailCollapsed}>
                <IconButton
                  size="small"
                  aria-label={
                    role === 'fielding' ? 'Expand OAA and percentiles panel' : 'Expand Statcast panel'
                  }
                  onClick={() => setStatcastCollapsed(false)}
                  className={styles.railChevron}
                >
                  <ChevronLeft fontSize="small" />
                </IconButton>
              </Box>
            ) : (
              <Box
                className={`${styles.gridCellRight} ${
                  variant === 'sidebar' ? styles.gridPadSidebar : styles.gridPadPage
                }`}
              >
                <Stack
                  direction="row"
                  alignItems="center"
                  justifyContent="space-between"
                  className={styles.statcastHeaderRow}
                >
                  <Typography variant="subtitle2" className={styles.subtitleStrong}>
                    {role === 'fielding' ? 'OAA & percentiles' : 'Statcast'}
                  </Typography>
                  {isMdUp && (
                    <IconButton
                      size="small"
                      aria-label={role === 'fielding' ? 'Collapse OAA and percentiles panel' : 'Collapse Statcast panel'}
                      onClick={() => setStatcastCollapsed(true)}
                      edge="end"
                    >
                      <ChevronRight fontSize="small" />
                    </IconButton>
                  )}
                </Stack>
                {role === 'fielding' ? (
                  <Stack spacing={1}>
                    <StatcastCollapsibleSection title="OAA field grid">
                      <OaaHeatmapPlaceholder
                        playerId={playerId}
                        gameYear={season}
                        fieldingRows={fieldingHistoryRows}
                        fieldingRowsReady={!fieldingHistoryLoading}
                      />
                    </StatcastCollapsibleSection>
                    <StatcastCollapsibleSection title="League percentiles">
                      <LeaguePercentilesPanel playerId={playerId} season={season} cardRole="fielding" />
                    </StatcastCollapsibleSection>
                  </Stack>
                ) : fetchingSc ? (
                  <Stack spacing={1.25} sx={{ mt: 0.5 }} aria-busy="true" aria-label="Loading Statcast">
                    <Skeleton variant="rounded" width="100%" height={36} />
                    <Skeleton variant="rounded" width="100%" height={120} />
                    <Skeleton variant="rounded" width="95%" height={80} />
                  </Stack>
                ) : (
                  <>
                    {!statcast && (
                      <Typography color="text.secondary">No Statcast payload.</Typography>
                    )}
                    {statcast && statcast.statcast_available === false && (
                      <Alert severity="info" className={styles.alertDense}>
                        {String(statcast.reason ?? 'Statcast unavailable')}
                      </Alert>
                    )}
                    {statcast && statcastAvailable && role === 'pitching' && (
                      <Stack spacing={1}>
                        <StatcastCollapsibleSection title="Pitch mix">
                          {pitchingMixDisplay.length > 0 &&
                            (statcast.velo_dist != null && statcast.velo_dist.length > 0 ? (
                              <PitchMixVeloTable
                                mix={pitchingMixDisplay}
                                veloRows={pitchingVeloDisplay ?? statcast.velo_dist}
                                byStandRows={
                                  pitchingMixByStandForVelo != null && pitchingMixByStandForVelo.length > 0
                                    ? pitchingMixByStandForVelo
                                    : undefined
                                }
                                leagueAvgVeloByPitch={statcast.league_avg_velo_by_pitch}
                              />
                            ) : (
                              <Table size="small" className={styles.mixTable}>
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
                                              className={styles.pitchTypeSwatch}
                                              sx={{ bgcolor: pitchTypeMovementColor(pt) }}
                                            />
                                            <Stack spacing={0} className={styles.stackMinW0}>
                                              <Typography component="span" variant="body2" noWrap>
                                                {pitchTypeName(pt)}
                                              </Typography>
                                              <Typography
                                                component="span"
                                                variant="caption"
                                                color="text.secondary"
                                                className={styles.pitchMetaCaption}
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
                          {(pitchingMixDisplay.length > 0 || pitchingMixExtendedDisplay.length > 0) && (
                            <Button
                              component={Link}
                              size="small"
                              variant="text"
                              to={`/players/${playerId}/pitch-mix?season=${season}`}
                              className={styles.trendLinkBtn}
                            >
                              Pitch usage & process rates →
                            </Button>
                          )}
                        </StatcastCollapsibleSection>
                        {statcast.sample != null && statcast.sample.length > 0 && (
                          <StatcastCollapsibleSection title="Pitch movement">
                            <MovementMiniPlot
                              rows={
                                role === 'pitching'
                                  ? (statcastSampleMovement ?? statcast.sample)
                                  : statcast.sample
                              }
                              leagueMovement={leagueMovementForPlot ?? undefined}
                              armAngle={armOverlay ?? undefined}
                            />
                          </StatcastCollapsibleSection>
                        )}
                        <StatcastCollapsibleSection title="League percentiles">
                          <LeaguePercentilesPanel
                            playerId={playerId}
                            season={season}
                            cardRole="pitching"
                            pitchTypes={pitchingMixDisplay.map((r) => String(r.pitch_type ?? ''))}
                          />
                        </StatcastCollapsibleSection>
                      </Stack>
                    )}
                    {statcast && statcastAvailable && role === 'batting' && (
                      <Stack spacing={1}>
                        <StatcastCollapsibleSection title="Batted ball">
                          <Stack direction="row" spacing={0.5} flexWrap="wrap">
                            <Chip size="small" label={`BBE ${String(statcast.batted_ball?.bbe ?? '—')}`} />
                            <Chip size="small" label={`EV ${String(statcast.batted_ball?.avg_ev ?? '—')}`} />
                            <Chip size="small" label={`LA ${String(statcast.batted_ball?.avg_la ?? '—')}`} />
                          </Stack>
                        </StatcastCollapsibleSection>
                        <StatcastCollapsibleSection title="Bat tracking">
                          {statcast.bat_path != null && typeof statcast.bat_path === 'object' && (
                            <BatPathSummary batPath={statcast.bat_path as BatPathApiRow} />
                          )}
                          <Button
                            component={Link}
                            size="small"
                            variant="text"
                            to={`/players/${playerId}/trends?to=${season}&from=${Math.max(2015, season - 7)}`}
                            className={`${styles.batTrendLinkBtn}${
                              statcast.bat_path != null ? ` ${styles.batTrendLinkBtnSpaced}` : ''
                            }`}
                          >
                            Career bat-tracking trends →
                          </Button>
                        </StatcastCollapsibleSection>
                        {statcast.sample != null && statcast.sample.length > 0 && (
                          <StatcastCollapsibleSection title="Spray chart">
                            <SprayChart rows={statcast.sample} gameYear={season} />
                          </StatcastCollapsibleSection>
                        )}
                        <StatcastCollapsibleSection title="League percentiles">
                          <LeaguePercentilesPanel playerId={playerId} season={season} cardRole="batting" />
                        </StatcastCollapsibleSection>
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
      <Box className={styles.sidebarShell}>
        {toolbar}
        <Box className={styles.sidebarScroll}>{inner}</Box>
      </Box>
    );
  }

  return (
    <Container maxWidth="lg" className={styles.pageContainer}>
      {toolbar}
      {inner}
    </Container>
  );
}
