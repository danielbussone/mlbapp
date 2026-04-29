-- 90 ft running splits from Baseball Savant (pybaseball statcast_running_splits).
-- Complements player_season_sprint_speed (V16) from statcast_sprint_speed leaderboard.

CREATE TABLE player_season_running_splits (
  key_mlbam     integer NOT NULL,
  game_year     smallint NOT NULL,
  split_variant text NOT NULL,
  payload_jsonb jsonb NOT NULL,
  inserted_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (key_mlbam, game_year, split_variant),
  CONSTRAINT player_season_running_splits_variant_chk
    CHECK (split_variant IN ('raw', 'percent'))
);

CREATE INDEX player_season_running_splits_year_idx
  ON player_season_running_splits (game_year);

COMMENT ON TABLE player_season_running_splits IS
  'Savant 90 ft split CSV per player-season: raw = seconds at 5 ft markers; percent = percentile at each marker. Ingest: pnpm etl:sprint.';

COMMENT ON COLUMN player_season_running_splits.split_variant IS
  'raw: seconds_since_hit_* from Savant type=raw; percent: same column names from type=percent.';
