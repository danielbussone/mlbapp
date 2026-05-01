-- Lahman / pybaseball Hall of Fame inductees (player category only).
-- Join to dim_player via player_external_identifier (id_system = 'baseball_reference', id_value = lahman_player_id).
-- Ingest: pnpm etl:hall-of-fame

CREATE TABLE hall_of_fame_player (
  lahman_player_id  text PRIMARY KEY,
  player_id         bigint REFERENCES dim_player (player_id) ON DELETE SET NULL,
  inducted_year     smallint,
  voted_by          text,
  category          text NOT NULL,
  source            text NOT NULL DEFAULT 'lahman_hall_of_fame',
  ingested_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX hall_of_fame_player_player_id_idx ON hall_of_fame_player (player_id)
  WHERE player_id IS NOT NULL;

COMMENT ON TABLE hall_of_fame_player IS
  'Cooperstown inductees (Lahman hall_of_fame, inducted=Y, category=Player). player_id backfilled from Chadwick key_bbref.';
