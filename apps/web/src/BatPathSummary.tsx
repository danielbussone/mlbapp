import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import {
  AttackAngleGraphic,
  AttackDirectionGraphic,
  BatSpeedGauge,
  SwingTiltGraphic,
} from './BatPathMiniGraphics.js';

function fmtInt(v: unknown): string {
  if (v == null || v === '') return '—';
  if (typeof v === 'bigint') return v.toString();
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? String(Math.trunc(n)) : '—';
}

function toNum(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export type BatPathApiRow = {
  player_tracked_swings?: unknown;
  league_tracked_swings?: unknown;
  player_avg_bat_speed?: unknown;
  league_avg_bat_speed?: unknown;
  player_avg_attack_angle?: unknown;
  league_avg_attack_angle?: unknown;
  player_avg_attack_direction?: unknown;
  league_avg_attack_direction?: unknown;
  player_avg_swing_path_tilt?: unknown;
  league_avg_swing_path_tilt?: unknown;
  /** Most common Statcast `stand` among tracked swings (`R` / `L`); tilt mirroring + attack-direction bat anchor. */
  batter_stand?: unknown;
};

export function BatPathSummary({ batPath }: { batPath: BatPathApiRow }) {
  const leagueN = batPath.league_tracked_swings;
  const playerN = batPath.player_tracked_swings;
  const leagueTracked =
    typeof leagueN === 'bigint' ? Number(leagueN) : typeof leagueN === 'number' ? leagueN : Number(leagueN);

  if (!Number.isFinite(leagueTracked) || leagueTracked <= 0) {
    return (
      <Typography variant="caption" color="text.secondary">
        No bat-tracking rows for this season (no bat_speed in Statcast payload). Use a 2024+ season
        after ETL ingest.
      </Typography>
    );
  }

  return (
    <Box>
      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
        Bat path (tracked swings)
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        Averages among pitches with bat speed in Statcast; league uses the same season pool (
        {fmtInt(playerN)} player / {fmtInt(leagueN)} league swings).
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
          gap: 1,
        }}
      >
        <BatSpeedGauge
          mph={toNum(batPath.player_avg_bat_speed)}
          leagueMph={toNum(batPath.league_avg_bat_speed)}
        />
        <AttackAngleGraphic
          playerDeg={toNum(batPath.player_avg_attack_angle)}
          leagueDeg={toNum(batPath.league_avg_attack_angle)}
        />
        <AttackDirectionGraphic
          playerDeg={toNum(batPath.player_avg_attack_direction)}
          leagueDeg={toNum(batPath.league_avg_attack_direction)}
          batterStand={batPath.batter_stand}
        />
        <SwingTiltGraphic
          tiltDeg={toNum(batPath.player_avg_swing_path_tilt)}
          leagueDeg={toNum(batPath.league_avg_swing_path_tilt)}
          batterStand={batPath.batter_stand}
        />
      </Box>
    </Box>
  );
}
