import ExpandLess from '@mui/icons-material/ExpandLess';
import ExpandMore from '@mui/icons-material/ExpandMore';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Collapse from '@mui/material/Collapse';
import Skeleton from '@mui/material/Skeleton';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Slider from '@mui/material/Slider';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { alpha } from '@mui/material/styles';
import React, { forwardRef, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import type { LeaguePercentilesResponse, PercentileDirection, PercentileSlot } from './leaguePercentilesTypes.js';
import {
  goodnessDisplayPercentile,
  thumbColorForGoodnessPercentile,
} from './percentileGoodnessColor.js';
import { pitchTypeName } from '@/features/pitch-mix/pitchTypeLabels.js';
import styles from './LeaguePercentilesPanel.module.css';

export type LeaguePercentilesCardRole = 'batting' | 'pitching' | 'fielding';

type Props = {
  playerId: number;
  season: number;
  cardRole: LeaguePercentilesCardRole;
  /** @deprecated Fielding percentiles no longer use a single `position` query; kept for call-site compatibility. */
  positionCode?: string;
  /** Pitch-type codes from mix table (e.g. FF, SL). */
  pitchTypes?: string[];
};

/** FanGraphs value runs / WAR (batting card; Value collapsible section). */
const SAVANT_BATTING_VALUE_ORDER = ['fg_season_off', 'fg_season_bsr', 'fg_season_def', 'fg_season_bat_war'] as const;

/** Statcast swing / bat-path tracking (batting card; own collapsible, default collapsed). */
const SAVANT_BATTING_BAT_PATH_ORDER = [
  'swing_avg_bat_speed',
  'swing_avg_attack_angle',
  'swing_avg_attack_direction',
  'swing_avg_path_tilt',
] as const;

/** xwOBA / xBA (batting card; own collapsible, default collapsed). wOBA & wRC+ live in main order for slider visibility. */
const SAVANT_BATTING_EXPECTED_ORDER = ['fg_season_xwoba', 'bip_avg_estimated_ba'] as const;

/** Savant-style row order (batting card; excludes expected-stats and bat-path metrics). */
const SAVANT_BATTING_ORDER = [
  'fg_season_avg',
  'fg_season_slg',
  'fg_season_iso',
  'fg_season_woba',
  'fg_season_wrc_plus',
  'bip_avg_exit_velo',
  'bip_ev90',
  'bip_barrel_pct',
  'bip_hard_hit_pct',
  'bat_chase_pct',
  'bat_whiff_pct',
  'fg_season_k_pct',
  'fg_season_bb_pct',
  'bip_sweet_spot_pct',
  'bip_avg_launch_angle',
] as const;

/** Reserved for extra FG value metrics on the pitching card (collapsible when non-empty). */
const SAVANT_PITCHING_VALUE_ORDER: readonly string[] = [];

/** FIP + RA9 pitching WAR (pitching card; own collapsible, default expanded). */
const SAVANT_PITCHING_WAR_ORDER = ['fg_season_pit_war_fip', 'fg_season_pit_war_ra9'] as const;

/** xERA / xBA allowed (pitching card; own collapsible, default collapsed). */
const SAVANT_PITCHING_EXPECTED_ORDER = ['fg_season_pit_xera', 'fg_season_pit_xfip', 'pitch_avg_estimated_ba_allowed'] as const;

const SAVANT_PITCHING_ORDER = [
  'pitch_ff_avg_velo',
  'pitch_avg_exit_velo_on_bip',
  'pitch_chase_pct',
  'pitch_whiff_pct',
  'pitch_gb_pct',
  'pitch_avg_release_extension',
  'fg_season_pit_k_pct',
  'fg_season_pit_bb_pct',
  'pitch_barrel_pct_allowed',
  'pitch_hard_hit_pct_allowed',
  'pitch_sweet_spot_pct_allowed',
  'pitch_swstr_pct',
  'pitch_zone_pct',
  'pitch_swing_pct',
  'pitch_fb_pct',
  'pitch_hr_pct',
] as const;

const PITCHTYPE_ORDER = [
  'pitch_avg_velo',
  'pitch_avg_spin',
  'pitch_avg_pfx_x',
  'pitch_avg_pfx_z',
  'pitch_zone_pct',
  'pitch_chase_pct',
  'pitch_whiff_pct',
  'pitch_swstr_pct',
  'pitch_gb_pct',
] as const;

const SAVANT_CATCHING_VALUE_ORDER = [
  'catch_blocks_above_avg',
  'catch_cs_above_avg',
  'catch_framing_runs',
  'catch_pop_time_sec',
] as const;

const SAVANT_FIELDING_ORDER = [
  'pos_oaa',
  'pos_drs',
  'pos_uzr',
  'pos_frv',
  'pos_inn',
] as const;

const SAVANT_RUNNING_ORDER = ['running_sprint_speed'] as const;

const LABELS: Record<string, string> = {
  fg_season_bsr: 'BsR',
  fg_season_off: 'Off',
  fg_season_def: 'Def',
  fg_season_bat_war: 'WAR',
  bip_ev90: 'EV90',
  fg_season_pit_war_fip: 'WAR (FIP)',
  fg_season_pit_war_ra9: 'WAR (RA9)',
  catch_blocks_above_avg: 'Blocks above avg',
  catch_cs_above_avg: 'CS above avg',
  catch_framing_runs: 'Framing',
  catch_pop_time_sec: 'Pop time',
  fg_season_xwoba: 'xwOBA',
  fg_season_woba: 'wOBA',
  fg_season_wrc_plus: 'wRC+',
  bip_avg_estimated_ba: 'xBA on contact',
  fg_season_avg: 'AVG',
  fg_season_slg: 'SLG',
  fg_season_iso: 'ISO',
  bip_avg_exit_velo: 'Avg exit velo (mph)',
  bip_barrel_pct: 'Barrel %',
  bip_hard_hit_pct: 'Hard-hit %',
  bip_sweet_spot_pct: 'Sweet-spot %',
  bip_avg_launch_angle: 'Avg launch angle (degrees)',
  swing_avg_bat_speed: 'Bat speed (mph)',
  swing_avg_attack_angle: 'Attack angle (degrees)',
  swing_avg_attack_direction: 'Attack direction (degrees)',
  swing_avg_path_tilt: 'Swing path tilt (degrees)',
  bat_chase_pct: 'Chase %',
  bat_whiff_pct: 'Whiff %',
  fg_season_k_pct: 'K%',
  fg_season_bb_pct: 'BB%',
  fg_season_pit_xera: 'xERA',
  fg_season_pit_xfip: 'xFIP',
  pitch_avg_estimated_ba_allowed: 'xBA allowed',
  pitch_ff_avg_velo: 'Fastball velo (mph)',
  pitch_avg_exit_velo_on_bip: 'Avg exit velo allowed (mph)',
  pitch_chase_pct: 'Chase %',
  pitch_whiff_pct: 'Whiff %',
  pitch_swstr_pct: 'SwStr %',
  pitch_zone_pct: 'Zone %',
  pitch_swing_pct: 'Swing %',
  pitch_gb_pct: 'GB %',
  pitch_fb_pct: 'FB %',
  pitch_hr_pct: 'HR %',
  pitch_avg_release_extension: 'Extension (ft)',
  pitch_barrel_pct_allowed: 'Barrel % allowed',
  pitch_hard_hit_pct_allowed: 'Hard-hit % allowed',
  pitch_sweet_spot_pct_allowed: 'Sweet-spot % allowed',
  fg_season_pit_k_pct: 'K%',
  fg_season_pit_bb_pct: 'BB%',
  pitch_avg_velo: 'Velo (mph)',
  pitch_avg_spin: 'Spin (rpm)',
  pitch_avg_pfx_x: 'Horiz. break (ft)',
  pitch_avg_pfx_z: 'Vert. break (ft)',
  pos_drs: 'DRS',
  pos_uzr: 'UZR',
  pos_oaa: 'OAA',
  pos_frv: 'FRV',
  pos_inn: 'Innings',
  running_sprint_speed: 'Sprint speed (ft/s)',
};

/** One-sentence explainer for hover; “(Lower is better.)” is appended when `slot.direction` is `lower_better`. */
const STAT_TOOLTIPS: Record<string, string> = {
  fg_season_bsr: 'FanGraphs baserunning runs for the season (TOT merge).',
  fg_season_off: 'FanGraphs offensive runs for the season (TOT merge).',
  fg_season_def: 'FanGraphs defensive runs for the season (TOT merge).',
  fg_season_bat_war: 'FanGraphs batting WAR (fWAR-style) for the season.',
  bip_ev90: '90th percentile exit velocity on batted balls (Statcast).',
  fg_season_pit_war_fip: 'FanGraphs pitching WAR based on FIP components.',
  fg_season_pit_war_ra9: 'FanGraphs pitching WAR based on runs allowed (RA9-WAR).',
  catch_blocks_above_avg: 'Blocking value vs peers when FanGraphs publishes it on the catcher row (stats_jsonb keys).',
  catch_cs_above_avg: 'Caught stealing / throwing value vs peers when present on the FG catcher row.',
  catch_framing_runs: 'Framing runs when FanGraphs exposes FrmR/FRM (or similar) on the catcher row.',
  catch_pop_time_sec: 'Pop time to second base when present on the feed (lower is faster).',
  fg_season_xwoba: 'Expected wOBA for the season weighted by plate appearances on contact.',
  fg_season_woba: 'Weighted on-base average (wOBA) for the season (PA-weighted merge).',
  fg_season_wrc_plus: 'wRC+ for the season, park- and league-adjusted (PA-weighted merge).',
  bip_avg_estimated_ba: 'Average estimated batting average on balls in play with tracking.',
  fg_season_avg: 'FanGraphs batting average for the season.',
  fg_season_slg: 'FanGraphs slugging for the season.',
  fg_season_iso: 'Isolated power (SLG − AVG) from merged FanGraphs season rates.',
  bip_avg_exit_velo: 'Average exit velocity on batted balls.',
  bip_barrel_pct: 'Share of batted balls classified as barrels.',
  bip_hard_hit_pct: 'Share of batted balls hit at least 95 mph.',
  bip_sweet_spot_pct: 'Share of batted balls with launch angle between about 8° and 32°.',
  bip_avg_launch_angle: 'Average launch angle on batted balls.',
  swing_avg_bat_speed: 'Average bat speed on tracked swings.',
  swing_avg_attack_angle: 'Average attack angle on tracked swings.',
  swing_avg_attack_direction: 'Average horizontal attack direction on tracked swings.',
  swing_avg_path_tilt: 'Average swing path tilt on tracked swings.',
  bat_chase_pct: 'Share of swings on pitches outside the zone when the zone was known.',
  bat_whiff_pct: 'Share of swings that are misses.',
  fg_season_k_pct: 'Strikeout rate for the season.',
  fg_season_bb_pct: 'Walk rate for the season.',
  fg_season_pit_xera: 'Expected ERA for the season from FanGraphs.',
  fg_season_pit_xfip: 'Expected FIP for the season from FanGraphs (IP-weighted merge).',
  pitch_avg_estimated_ba_allowed: 'Average estimated batting average allowed on balls in play.',
  pitch_ff_avg_velo: 'Average four-seam fastball velocity.',
  pitch_avg_exit_velo_on_bip: 'Average exit velocity allowed on batted balls.',
  pitch_chase_pct: 'Share of swings on pitches outside the zone when the zone was known.',
  pitch_whiff_pct: 'Share of swings that are misses.',
  pitch_swstr_pct: 'Swinging-strike rate per pitch.',
  pitch_zone_pct: 'Share of pitches thrown in the strike zone when zone was known.',
  pitch_swing_pct: 'Share of pitches swung at.',
  pitch_gb_pct: 'Share of batted balls on the ground.',
  pitch_fb_pct: 'Share of batted balls classified as fly balls or popups.',
  pitch_hr_pct: 'Home runs per batted ball allowed.',
  pitch_avg_release_extension: 'Average release extension toward home plate in feet.',
  pitch_barrel_pct_allowed: 'Share of batted balls allowed that are barrels.',
  pitch_hard_hit_pct_allowed: 'Share of batted balls allowed hit at least 95 mph.',
  pitch_sweet_spot_pct_allowed: 'Share of batted balls allowed in the sweet-spot launch band.',
  fg_season_pit_k_pct: 'Strikeout rate for the season.',
  fg_season_pit_bb_pct: 'Walk rate for the season.',
  pitch_avg_velo: 'Average velocity for this pitch type.',
  pitch_avg_spin: 'Average spin rate for this pitch type in rpm.',
  pitch_avg_pfx_x: 'Average horizontal movement in feet for this pitch type.',
  pitch_avg_pfx_z: 'Average vertical movement in feet for this pitch type.',
  pos_drs: 'Defensive runs saved vs average at the position.',
  pos_uzr:
    'FanGraphs UZR (runs vs average). Often missing for recent seasons when FanGraphs does not ship UZR on the fielding download—not an app bug.',
  pos_oaa: 'Outs above average vs peers at the position.',
  pos_frv:
    'Statcast fielding run value (FRV) when FanGraphs exposes it on the fielding row. If the feed uses another column name, re-ingest fielding after ETL alias updates.',
  pos_inn: 'Defensive innings played at the position.',
  running_sprint_speed: 'Peak sprint speed in ft/s for the season.',
};

function statTooltip(metricId: string, slot: PercentileSlot): string {
  const base = STAT_TOOLTIPS[metricId] ?? 'League percentile for this stat vs peers in the cohort.';
  const lower = slotDirection(slot) === 'lower_better' ? ' (Lower is better.)' : '';
  return `${base}${lower}`;
}

function slotDirection(slot: PercentileSlot): PercentileDirection {
  return slot.direction ?? 'higher_better';
}

function formatValue(metricId: string, v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '—';
  if (metricId === 'pos_inn') return v % 1 !== 0 ? v.toFixed(1) : String(Math.round(v));
  if (
    metricId === 'fg_season_bat_war' ||
    metricId === 'fg_season_bsr' ||
    metricId === 'fg_season_off' ||
    metricId === 'fg_season_def' ||
    metricId === 'fg_season_pit_war_fip' ||
    metricId === 'fg_season_pit_war_ra9'
  ) {
    return v.toFixed(1);
  }
  if (metricId === 'bip_ev90') return v.toFixed(1);
  if (metricId === 'catch_pop_time_sec') return v.toFixed(2);
  if (
    metricId === 'catch_blocks_above_avg' ||
    metricId === 'catch_cs_above_avg' ||
    metricId === 'catch_framing_runs'
  ) {
    return v.toFixed(1);
  }
  if (
    metricId === 'fg_season_xwoba' ||
    metricId === 'fg_season_woba' ||
    metricId === 'bip_avg_estimated_ba' ||
    metricId === 'pitch_avg_estimated_ba_allowed'
  ) {
    return v.toFixed(3);
  }
  if (metricId === 'fg_season_wrc_plus') return v.toFixed(0);
  if (metricId === 'fg_season_pit_xera' || metricId === 'fg_season_pit_xfip') return v.toFixed(2);
  if (metricId === 'fg_season_avg') return v.toFixed(3);
  if (metricId === 'fg_season_slg') return v.toFixed(3);
  if (metricId === 'fg_season_iso') return v.toFixed(3);
  if (metricId === 'running_sprint_speed') return v.toFixed(1);
  if (
    metricId.includes('velo') ||
    metricId.includes('exit_velo') ||
    metricId.includes('pfx') ||
    metricId.includes('extension')
  ) {
    return metricId.includes('pfx') ? v.toFixed(2) : v.toFixed(1);
  }
  if (metricId.includes('pct') || metricId.endsWith('_pct')) return `${v.toFixed(1)}%`;
  return v.toFixed(1);
}

/** Slider position: higher = better performance for the player. */
function displayPercentile(slot: PercentileSlot): number | null {
  return goodnessDisplayPercentile(slot);
}

/** Provisional: dashed grey accent outside a solid white ring (see PercentileDialThumb). */
const PROVISIONAL_DASH = '#a3a3a3';

const RAIL_HEIGHT = 10;
const THUMB_SIZE = 25;
/**
 * Each side: half the dial + a little room for dashed provisional outline / hover ring.
 * The slider is laid out in a narrower centered strip (`width: calc(100% - 2×inset)`) so 0%/100%
 * thumb centers sit inside the row instead of padding the MUI root (which skewed the rail badly).
 */
const SLIDER_TRACK_INSET_PX = Math.ceil(THUMB_SIZE / 2);

type DialThumbProps = React.ComponentPropsWithRef<'span'> & {
  dialLabel?: string;
  provisionalDial?: boolean;
  fill?: string;
  /** MUI passes this for non-host thumb slots; must not reach the DOM. */
  ownerState?: unknown;
};

const PercentileDialThumb = forwardRef<HTMLSpanElement, DialThumbProps>(function PercentileDialThumb(
  { dialLabel, provisionalDial, fill, children, style, className, ownerState: _ownerState, ...rest },
  ref
) {
  const label = dialLabel ?? '';
  const base = (style ?? {}) as CSSProperties;
  /** MUI horizontal thumb centers via `.MuiSlider-thumb` + `left: %`; inline fallbacks keep that if classes miss the custom slot. */
  const thumbStyle: CSSProperties = {
    ...base,
    position: base.position ?? 'absolute',
    top: base.top ?? '50%',
    transform: base.transform ?? 'translate(-50%, -50%)',
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: fill ?? 'grey',
    border: '2px solid rgb(220, 220, 220)',
    outline: provisionalDial ? `2px dashed rgb(200, 200, 200)` : undefined,
    outlineOffset: provisionalDial ? 0 : undefined,
    zIndex: 4,
    boxSizing: 'border-box',
    boxShadow: '0 1px 4px rgba(0,0,0,0.22)',
    color: '#fff',
    fontSize: Math.max(9, Math.min(12, THUMB_SIZE * 0.42)),
    fontWeight: 700,
    lineHeight: 1,
    letterSpacing: -0.02,
    textShadow: '0 0 2px rgba(0,0,0,0.35)',
  };
  return (
    <span {...rest} ref={ref} className={className} style={thumbStyle}>
      {children}
      {label ? (
        <span style={{ position: 'relative', zIndex: 1, pointerEvents: 'none' }}>{label}</span>
      ) : null}
    </span>
  );
});

function PercentileRow({ metricId, slot }: { metricId: string; slot: PercentileSlot }) {
  const label = LABELS[metricId] ?? metricId;
  const p = slot.p;
  const dp = displayPercentile(slot);
  const displayPctLabel = dp != null ? String(Math.round(dp)) : '';
  const showSlider = metricId !== 'pos_inn';
  const provisional = p != null && !slot.qualified;
  const thumbFill = dp != null ? thumbColorForGoodnessPercentile(dp) : undefined;
  const tip = statTooltip(metricId, slot);
  return (
    <Box className={styles.percentileRow}>
      <Stack direction="row" justifyContent="space-between" alignItems="baseline" spacing={1}>
        <Tooltip title={tip} arrow enterDelay={300} placement="top">
          <Typography component="span" variant="caption" className={styles.metricLabel}>
            {label}
          </Typography>
        </Tooltip>
        <Typography variant="caption" color="text.secondary" className={styles.valueRight}>
          {formatValue(metricId, slot.value)}
        </Typography>
      </Stack>
      {showSlider && (
        <Box className={styles.sliderBlock}>
          <Box
            className={styles.sliderInner}
            style={{ width: `calc(100% - ${1.5 * SLIDER_TRACK_INSET_PX}px)` }}
          >
            <Slider
              value={dp ?? 0}
              min={0}
              max={100}
              disabled={dp == null}
              slots={{ thumb: PercentileDialThumb }}
              slotProps={{
                thumb: {
                  dialLabel: displayPctLabel,
                  provisionalDial: provisional,
                  fill: thumbFill,
                } as Record<string, unknown>,
              }}
              sx={(theme) => ({
                py: 0.5,
                alignItems: 'center',
                width: '100%',
                position: 'relative',
                isolation: 'isolate',
                height: Math.max(THUMB_SIZE, RAIL_HEIGHT + 4),
                '& .MuiSlider-rail': {
                  opacity: 1,
                  height: RAIL_HEIGHT,
                  borderRadius: RAIL_HEIGHT / 2,
                  zIndex: 0,
                  background:
                    'linear-gradient(90deg, rgb(21,101,192) 0%, rgb(158,158,158) 50%, rgb(198,40,40) 100%)',
                },
                '& .MuiSlider-track': {
                  backgroundColor: 'transparent',
                  border: 'none',
                  zIndex: 1,
                },
                '& .MuiSlider-thumb': {
                  zIndex: 4,
                },
                ...(dp != null && {
                  '&:hover .MuiSlider-thumb, & .MuiSlider-thumb.Mui-focusVisible, & .MuiSlider-thumb.Mui-active': {
                    boxShadow: provisional
                      ? `0 0 0 10px ${alpha(PROVISIONAL_DASH, 0.22)}`
                      : `0 0 0 10px ${thumbFill ? alpha(thumbFill, 0.28) : alpha(theme.palette.primary.main, 0.2)}`,
                  },
                }),
              })}
              aria-label={`${label} percentile (goodness-oriented)`}
              getAriaValueText={() => (dp == null ? '' : `${Math.round(dp)}`)}
            />
          </Box>
        </Box>
      )}
    </Box>
  );
}

function apiRole(cardRole: LeaguePercentilesCardRole): 'batter' | 'pitcher' | 'fielding' {
  if (cardRole === 'batting') return 'batter';
  if (cardRole === 'pitching') return 'pitcher';
  return 'fielding';
}

function renderOrderedRows(
  order: readonly string[],
  slots: Record<string, PercentileSlot> | undefined
): ReactNode[] {
  if (!slots) return [];
  const out: ReactNode[] = [];
  for (const id of order) {
    const slot = slots[id];
    if (!slot) continue;
    out.push(<PercentileRow key={id} metricId={id} slot={slot} />);
  }
  return out;
}

/** Fielding: omit rows with no numeric value for this season (e.g. missing UZR/FRV on FG feed). */
function fieldingSlotHasValue(slot: PercentileSlot | undefined): boolean {
  if (!slot) return false;
  const v = slot.value;
  return v != null && Number.isFinite(v);
}

function renderOrderedFieldingRows(slots: Record<string, PercentileSlot> | undefined): ReactNode[] {
  if (!slots) return [];
  const order = SAVANT_FIELDING_ORDER.filter((id) => fieldingSlotHasValue(slots[id]));
  return renderOrderedRows(order, slots);
}

export function LeaguePercentilesPanel({ playerId, season, cardRole, positionCode: _positionCode, pitchTypes }: Props) {
  const [data, setData] = useState<LeaguePercentilesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  /** Pitch-type breakdown rows: default collapsed. */
  const [pitchTypeOpen, setPitchTypeOpen] = useState<Record<string, boolean>>({});
  /** Fielding per-position rows: default collapsed. */
  const [fieldingPosOpen, setFieldingPosOpen] = useState<Record<string, boolean>>({});
  /** Value section (BsR/WAR/EV90 etc.): default expanded. */
  const [battingValueOpen, setBattingValueOpen] = useState(true);
  /** Bat path (swing tracking): default collapsed. */
  const [battingBatPathOpen, setBattingBatPathOpen] = useState(false);
  /** Expected stats (xwOBA, xBA): default collapsed. */
  const [battingExpectedStatsOpen, setBattingExpectedStatsOpen] = useState(false);
  const [pitchingValueOpen, setPitchingValueOpen] = useState(true);
  /** FIP + RA9 WAR: default expanded, first percentile section. */
  const [pitchingWarOpen, setPitchingWarOpen] = useState(true);
  /** Expected stats (xERA, xBA allowed): default collapsed. */
  const [pitchingExpectedStatsOpen, setPitchingExpectedStatsOpen] = useState(false);
  const [catchingValueOpen, setCatchingValueOpen] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const role = apiRole(cardRole);
    const qs = new URLSearchParams({
      game_year: String(season),
      role,
    });
    void (async () => {
      setLoading(true);
      setErr(null);
      try {
        const r = await fetch(`/api/players/${playerId}/league-percentiles?${qs.toString()}`);
        const j = (await r.json()) as LeaguePercentilesResponse & { error?: string };
        if (cancelled) return;
        if (!r.ok) {
          setData(null);
          setErr(String(j.error ?? r.statusText));
          setLoading(false);
          return;
        }
        setData(j);
      } catch (e) {
        if (!cancelled) {
          setData(null);
          setErr(e instanceof Error ? e.message : 'Request failed');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [playerId, season, cardRole]);

  if (loading) {
    return (
      <Stack spacing={1} aria-busy="true" aria-label="Loading league percentiles">
        <Skeleton variant="text" width="40%" height={20} />
        <Skeleton variant="rounded" width="100%" height={44} />
        <Skeleton variant="rounded" width="100%" height={44} />
        <Skeleton variant="rounded" width="100%" height={44} />
        <Skeleton variant="rounded" width="88%" height={44} />
      </Stack>
    );
  }
  if (err) {
    return (
      <Alert severity="warning" className={styles.alertDense}>
        {err}
      </Alert>
    );
  }
  if (!data || !data.percentiles_available) {
    return (
      <Alert severity="info" className={styles.alertDense}>
        {data?.reason ??
          'League percentiles unavailable (refresh Statcast MVs after migrate: pnpm db:refresh-percentiles).'}
      </Alert>
    );
  }

  if (data.role === 'batter') {
    const bat = data.savant_batting ?? data.percentiles ?? {};
    const run = data.savant_running;
    const battingValueIds = SAVANT_BATTING_VALUE_ORDER.filter((id) => fieldingSlotHasValue(bat[id]));
    const hasBattingValue = battingValueIds.length > 0;
    const battingBatPathIds = SAVANT_BATTING_BAT_PATH_ORDER.filter((id) => fieldingSlotHasValue(bat[id]));
    const hasBattingBatPath = battingBatPathIds.length > 0;
    const battingExpectedIds = SAVANT_BATTING_EXPECTED_ORDER.filter((id) => fieldingSlotHasValue(bat[id]));
    const hasBattingExpected = battingExpectedIds.length > 0;
    return (
      <Box className={styles.panelCard}>
        <Typography variant="subtitle2" className={styles.panelTitle}>
          Percentiles
        </Typography>
        {hasBattingValue && (
          <>
            <Box className={styles.pitchTypeBlock}>
              <Stack direction="row" alignItems="center" spacing={0.25} className={styles.pitchTypeHeader}>
                <IconButton
                  size="small"
                  aria-expanded={battingValueOpen}
                  aria-label={battingValueOpen ? 'Hide Value percentile rows' : 'Show Value percentile rows'}
                  onClick={() => setBattingValueOpen((o) => !o)}
                  className={styles.iconTight}
                >
                  {battingValueOpen ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
                </IconButton>
                <Typography variant="caption" className={styles.pitchTypeLabel}>
                  Value
                </Typography>
              </Stack>
              <Collapse in={battingValueOpen} timeout="auto" unmountOnExit>
                <Box className={styles.indent}>{renderOrderedRows(battingValueIds, bat)}</Box>
              </Collapse>
            </Box>
            <Divider className={styles.sectionDivider} />
          </>
        )}
        {hasBattingExpected && (
          <>
            <Box className={styles.pitchTypeBlock}>
              <Stack direction="row" alignItems="center" spacing={0.25} className={styles.pitchTypeHeader}>
                <IconButton
                  size="small"
                  aria-expanded={battingExpectedStatsOpen}
                  aria-label={
                    battingExpectedStatsOpen
                      ? 'Hide Expected stats percentile rows'
                      : 'Show Expected stats percentile rows'
                  }
                  onClick={() => setBattingExpectedStatsOpen((o) => !o)}
                  className={styles.iconTight}
                >
                  {battingExpectedStatsOpen ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
                </IconButton>
                <Typography variant="caption" className={styles.pitchTypeLabel}>
                  Expected stats
                </Typography>
              </Stack>
              <Collapse in={battingExpectedStatsOpen} timeout="auto" unmountOnExit>
                <Box className={styles.indent}>{renderOrderedRows(battingExpectedIds, bat)}</Box>
              </Collapse>
            </Box>
            <Divider className={styles.sectionDivider} />
          </>
        )}
        {renderOrderedRows(SAVANT_BATTING_ORDER, bat)}
        {hasBattingBatPath && (
          <>
            <Divider className={styles.sectionDivider} />
            <Box className={styles.pitchTypeBlock}>
              <Stack direction="row" alignItems="center" spacing={0.25} className={styles.pitchTypeHeader}>
                <IconButton
                  size="small"
                  aria-expanded={battingBatPathOpen}
                  aria-label={
                    battingBatPathOpen ? 'Hide Bat path percentile rows' : 'Show Bat path percentile rows'
                  }
                  onClick={() => setBattingBatPathOpen((o) => !o)}
                  className={styles.iconTight}
                >
                  {battingBatPathOpen ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
                </IconButton>
                <Typography variant="caption" className={styles.pitchTypeLabel}>
                  Bat path
                </Typography>
              </Stack>
              <Collapse in={battingBatPathOpen} timeout="auto" unmountOnExit>
                <Box className={styles.indent}>{renderOrderedRows(battingBatPathIds, bat)}</Box>
              </Collapse>
            </Box>
          </>
        )}
        {run && SAVANT_RUNNING_ORDER.some((id) => run[id]) && (
          <Box className={styles.runningSection}>
            <Divider className={styles.sectionDivider} />
            <Typography variant="caption" className={styles.sectionCaption}>
              Running
            </Typography>
            {renderOrderedRows(SAVANT_RUNNING_ORDER, run)}
          </Box>
        )}
      </Box>
    );
  }

  if (data.role === 'pitcher' && (data.season?.percentiles || data.savant_pitching)) {
    const byPt = data.by_pitch_type ?? {};
    const types = (pitchTypes ?? []).filter((t) => byPt[t]);
    const pit = data.savant_pitching ?? data.season!.percentiles;
    const pitchingWarIds = SAVANT_PITCHING_WAR_ORDER.filter((id) => fieldingSlotHasValue(pit[id]));
    const hasPitchingWar = pitchingWarIds.length > 0;
    const pitchingValueIds = SAVANT_PITCHING_VALUE_ORDER.filter((id) => fieldingSlotHasValue(pit[id]));
    const hasPitchingValue = pitchingValueIds.length > 0;
    const pitchingExpectedIds = SAVANT_PITCHING_EXPECTED_ORDER.filter((id) => fieldingSlotHasValue(pit[id]));
    const hasPitchingExpected = pitchingExpectedIds.length > 0;
    return (
      <Box className={styles.panelCard}>
        <Typography variant="subtitle2" className={styles.panelTitle}>
          Percentiles
        </Typography>
        {hasPitchingWar && (
          <>
            <Box className={styles.pitchTypeBlock}>
              <Stack direction="row" alignItems="center" spacing={0.25} className={styles.pitchTypeHeader}>
                <IconButton
                  size="small"
                  aria-expanded={pitchingWarOpen}
                  aria-label={pitchingWarOpen ? 'Hide WAR percentile rows' : 'Show WAR percentile rows'}
                  onClick={() => setPitchingWarOpen((o) => !o)}
                  className={styles.iconTight}
                >
                  {pitchingWarOpen ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
                </IconButton>
                <Typography variant="caption" className={styles.pitchTypeLabel}>
                  Value
                </Typography>
              </Stack>
              <Collapse in={pitchingWarOpen} timeout="auto" unmountOnExit>
                <Box className={styles.indent}>{renderOrderedRows(pitchingWarIds, pit)}</Box>
              </Collapse>
            </Box>
            <Divider className={styles.sectionDivider} />
          </>
        )}
        {hasPitchingValue && (
          <>
            <Box className={styles.pitchTypeBlock}>
              <Stack direction="row" alignItems="center" spacing={0.25} className={styles.pitchTypeHeader}>
                <IconButton
                  size="small"
                  aria-expanded={pitchingValueOpen}
                  aria-label={pitchingValueOpen ? 'Hide Value percentile rows' : 'Show Value percentile rows'}
                  onClick={() => setPitchingValueOpen((o) => !o)}
                  className={styles.iconTight}
                >
                  {pitchingValueOpen ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
                </IconButton>
                <Typography variant="caption" className={styles.pitchTypeLabel}>
                  Value
                </Typography>
              </Stack>
              <Collapse in={pitchingValueOpen} timeout="auto" unmountOnExit>
                <Box className={styles.indent}>{renderOrderedRows(pitchingValueIds, pit)}</Box>
              </Collapse>
            </Box>
            <Divider className={styles.sectionDivider} />
          </>
        )}
        {hasPitchingExpected && (
          <>
            <Box className={styles.pitchTypeBlock}>
              <Stack direction="row" alignItems="center" spacing={0.25} className={styles.pitchTypeHeader}>
                <IconButton
                  size="small"
                  aria-expanded={pitchingExpectedStatsOpen}
                  aria-label={
                    pitchingExpectedStatsOpen
                      ? 'Hide Expected stats percentile rows'
                      : 'Show Expected stats percentile rows'
                  }
                  onClick={() => setPitchingExpectedStatsOpen((o) => !o)}
                  className={styles.iconTight}
                >
                  {pitchingExpectedStatsOpen ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
                </IconButton>
                <Typography variant="caption" className={styles.pitchTypeLabel}>
                  Expected stats
                </Typography>
              </Stack>
              <Collapse in={pitchingExpectedStatsOpen} timeout="auto" unmountOnExit>
                <Box className={styles.indent}>{renderOrderedRows(pitchingExpectedIds, pit)}</Box>
              </Collapse>
            </Box>
            <Divider className={styles.sectionDivider} />
          </>
        )}
        {renderOrderedRows(SAVANT_PITCHING_ORDER, pit)}
        {types.length > 0 && (
          <>
            <Divider className={styles.sectionDivider} />
            {types.map((pt) => {
              const expanded = Boolean(pitchTypeOpen[pt]);
              return (
                <Box key={pt} className={styles.pitchTypeBlock}>
                  <Stack direction="row" alignItems="center" spacing={0.25} className={styles.pitchTypeHeader}>
                    <IconButton
                      size="small"
                      aria-expanded={expanded}
                      aria-label={expanded ? `Hide ${pt} percentile rows` : `Show ${pt} percentile rows`}
                      onClick={() => setPitchTypeOpen((o) => ({ ...o, [pt]: !expanded }))}
                      className={styles.iconTight}
                    >
                      {expanded ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
                    </IconButton>
                    <Typography variant="caption" className={styles.pitchTypeLabel}>
                      {pitchTypeName(pt)} ({pt})
                    </Typography>
                  </Stack>
                  <Collapse in={expanded} timeout="auto" unmountOnExit>
                    <Box className={styles.indent}>
                      {PITCHTYPE_ORDER.map((id) => {
                        const slot = byPt[pt]?.[id];
                        if (!slot) return null;
                        return <PercentileRow key={`${pt}-${id}`} metricId={id} slot={slot} />;
                      })}
                    </Box>
                  </Collapse>
                </Box>
              );
            })}
          </>
        )}
      </Box>
    );
  }

  if (data.role === 'fielding' && data.percentiles_available) {
    const run = data.savant_running;
    const catching = data.savant_catching;
    const catchingIds =
      catching != null
        ? SAVANT_CATCHING_VALUE_ORDER.filter((id) => fieldingSlotHasValue(catching[id]))
        : [];
    const hasCatchingValue = catchingIds.length > 0;
    const groups = data.fielding_percentile_groups;
    const totalGroup = groups?.find((g) => g.position_key === 'TOTAL');
    const perPositionGroups = (groups ?? [])
      .filter((g) => g.position_key !== 'TOTAL')
      .filter((g) => SAVANT_FIELDING_ORDER.some((id) => fieldingSlotHasValue(g.percentiles[id])));
    const hasPerPosition = perPositionGroups.length > 0;
    const totalHasRows =
      totalGroup != null && SAVANT_FIELDING_ORDER.some((id) => fieldingSlotHasValue(totalGroup.percentiles[id]));
    return (
      <Box className={styles.panelCard}>
        <Typography variant="subtitle2" className={styles.panelTitle}>
          Percentiles
        </Typography>
        {totalGroup != null ? (
          <>
            {totalHasRows && (
              <Box className={hasPerPosition ? styles.fieldingGroup : styles.fieldingGroupTight}>
                <Typography variant="caption" className={styles.sectionCaptionLoose}>
                  {totalGroup.label}
                </Typography>
                {renderOrderedFieldingRows(totalGroup.percentiles)}
              </Box>
            )}
            {hasPerPosition && (
              <Typography variant="caption" color="text.secondary" className={styles.fieldingSectionLabel}>
                By position
              </Typography>
            )}
            {perPositionGroups.map((g) => {
              const expanded = Boolean(fieldingPosOpen[g.position_key]);
              return (
                <Box key={g.position_key} className={styles.pitchTypeBlock}>
                  <Stack direction="row" alignItems="center" spacing={0.25} className={styles.pitchTypeHeader}>
                    <IconButton
                      size="small"
                      aria-expanded={expanded}
                      aria-label={expanded ? `Hide ${g.label} percentile rows` : `Show ${g.label} percentile rows`}
                      onClick={() => setFieldingPosOpen((o) => ({ ...o, [g.position_key]: !expanded }))}
                      className={styles.iconTight}
                    >
                      {expanded ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
                    </IconButton>
                    <Typography variant="caption" className={styles.pitchTypeLabel}>
                      {g.label}
                    </Typography>
                  </Stack>
                  <Collapse in={expanded} timeout="auto" unmountOnExit>
                    <Box className={styles.indent}>{renderOrderedFieldingRows(g.percentiles)}</Box>
                  </Collapse>
                </Box>
              );
            })}
            {!totalHasRows && !hasPerPosition && (
              <Typography variant="caption" color="text.secondary">
                No fielding metrics with values for this season.
              </Typography>
            )}
          </>
        ) : (
          <>
            {(() => {
              const r = renderOrderedFieldingRows(data.savant_fielding ?? data.percentiles ?? {});
              return r.length > 0 ? (
                r
              ) : (
                <Typography variant="caption" color="text.secondary">
                  No fielding metrics with values for this season.
                </Typography>
              );
            })()}
          </>
        )}
        {hasCatchingValue && catching != null && (
          <>
            <Divider className={styles.sectionDivider} />
            <Box className={styles.pitchTypeBlock}>
              <Stack direction="row" alignItems="center" spacing={0.25} className={styles.pitchTypeHeader}>
                <IconButton
                  size="small"
                  aria-expanded={catchingValueOpen}
                  aria-label={
                    catchingValueOpen ? 'Hide Catching value percentile rows' : 'Show Catching value percentile rows'
                  }
                  onClick={() => setCatchingValueOpen((o) => !o)}
                  className={styles.iconTight}
                >
                  {catchingValueOpen ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
                </IconButton>
                <Typography variant="caption" className={styles.pitchTypeLabel}>
                  Catching value
                </Typography>
              </Stack>
              <Collapse in={catchingValueOpen} timeout="auto" unmountOnExit>
                <Box className={styles.indent}>{renderOrderedRows(catchingIds, catching)}</Box>
              </Collapse>
            </Box>
          </>
        )}
        {run && SAVANT_RUNNING_ORDER.some((id) => run[id]) && (
          <Box className={styles.runningSection}>
            <Divider className={styles.sectionDivider} />
            <Typography variant="caption" className={styles.sectionCaption}>
              Running
            </Typography>
            {renderOrderedRows(SAVANT_RUNNING_ORDER, run)}
          </Box>
        )}
      </Box>
    );
  }

  return null;
}
