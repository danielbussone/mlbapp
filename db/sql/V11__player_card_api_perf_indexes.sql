-- Indexes for slow player-card API paths:
--   GET .../fg-batting-card  (FanGraphs season rows)
--   GET .../statcast-summary (statcast_pitch: spray sample, EV, bat path, pitcher pfx)
--
-- Statcast: only PARTIAL indexes here — full btree on (game_year, mlbam, …) for all pitches
-- duplicates existing (batter_mlbam, game_date) / (pitcher_mlbam, game_date) from V2 and can
-- exhaust disk on large installs. If Flyway still fails with “no space left on device”, free
-- disk on the Postgres volume or build indexes manually with CREATE INDEX CONCURRENTLY outside
-- a transaction after increasing space.

-- ---------------------------------------------------------------------------
-- FanGraphs: faster player_id branch of fg_*_season_current / consolidated
-- ---------------------------------------------------------------------------
CREATE INDEX fg_batting_season_mlb_player_season_desc_idx
  ON fg_batting_season (player_id, season DESC)
  WHERE level = 'MLB' AND player_id IS NOT NULL;

CREATE INDEX fg_pitching_season_mlb_player_season_desc_idx
  ON fg_pitching_season (player_id, season DESC)
  WHERE level = 'MLB' AND player_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Statcast: partial only (V2 already has batter/pitcher + game_date for full samples)
-- ---------------------------------------------------------------------------

-- Batter spray sample (hc_x / hc_y in payload_jsonb)
CREATE INDEX statcast_pitch_batter_spray_partial_idx
  ON statcast_pitch (batter_mlbam, game_date DESC NULLS LAST)
  WHERE NULLIF(TRIM(payload_jsonb->>'hc_x'), '') IS NOT NULL
    AND NULLIF(TRIM(payload_jsonb->>'hc_y'), '') IS NOT NULL;

-- Batted-ball summary (launch_speed present)
CREATE INDEX statcast_pitch_batter_ev_partial_idx
  ON statcast_pitch (batter_mlbam, game_year)
  WHERE launch_speed IS NOT NULL;

-- Bat path: player leg (bat_speed in JSON); pairs with query filter game_year + batter_mlbam
CREATE INDEX statcast_pitch_batter_battrack_partial_idx
  ON statcast_pitch (batter_mlbam, game_year)
  WHERE NULLIF(TRIM(payload_jsonb->>'bat_speed'), '') IS NOT NULL;

-- Bat path: league leg (all bat-tracked swings in partition; much smaller than full heap)
CREATE INDEX statcast_pitch_battrack_league_game_pk_partial_idx
  ON statcast_pitch (game_pk)
  WHERE NULLIF(TRIM(payload_jsonb->>'bat_speed'), '') IS NOT NULL;

-- Pitcher movement sample (pfx present)
CREATE INDEX statcast_pitch_pitcher_pfx_partial_idx
  ON statcast_pitch (pitcher_mlbam, game_date DESC NULLS LAST)
  WHERE pfx_x IS NOT NULL AND pfx_z IS NOT NULL;
