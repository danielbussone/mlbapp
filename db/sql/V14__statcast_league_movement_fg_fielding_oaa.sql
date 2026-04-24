-- League-wide Statcast movement rollup for V2 "expected movement" overlays.
-- Refresh after bulk Statcast loads: REFRESH MATERIALIZED VIEW statcast_league_pitch_movement_rollup;
CREATE MATERIALIZED VIEW statcast_league_pitch_movement_rollup AS
SELECT
  game_year,
  pitch_type,
  COUNT(*)::bigint AS pitches,
  ROUND(AVG(pfx_x::double precision)::numeric, 4) AS avg_pfx_x_ft,
  ROUND(AVG(pfx_z::double precision)::numeric, 4) AS avg_pfx_z_ft,
  ROUND(STDDEV_SAMP(pfx_x::double precision)::numeric, 4) AS std_pfx_x_ft,
  ROUND(STDDEV_SAMP(pfx_z::double precision)::numeric, 4) AS std_pfx_z_ft
FROM statcast_pitch
WHERE pitch_type IS NOT NULL
  AND TRIM(pitch_type) <> ''
  AND pfx_x IS NOT NULL
  AND pfx_z IS NOT NULL
GROUP BY game_year, pitch_type;

CREATE UNIQUE INDEX statcast_league_pitch_movement_rollup_pk
  ON statcast_league_pitch_movement_rollup (game_year, pitch_type);

COMMENT ON MATERIALIZED VIEW statcast_league_pitch_movement_rollup IS
  'League mean/std pfx movement by game_year and pitch_type for player-card overlays; refresh manually or via job.';

-- FanGraphs fielding (player–season–team–position–level), snapshot-bound like fg_batting_season.
CREATE TABLE fg_fielding_season (
  snapshot_id   uuid NOT NULL REFERENCES ingest_snapshot (snapshot_id) ON DELETE CASCADE,
  id_fg         integer NOT NULL,
  season        smallint NOT NULL,
  team          text NOT NULL,
  level         text NOT NULL DEFAULT 'MLB',
  position      text NOT NULL DEFAULT 'ALL',
  player_id     bigint REFERENCES dim_player (player_id),
  age           smallint,
  games         smallint,
  inn           numeric(8, 1),
  po            integer,
  assists       integer,
  errors        smallint,
  drs           numeric(7, 2),
  uzr           numeric(7, 2),
  oaa           numeric(7, 2),
  frv           numeric(7, 2),
  war           numeric(5, 2),
  stats_jsonb   jsonb NOT NULL,
  inserted_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (snapshot_id, id_fg, season, team, level, position)
);

CREATE INDEX fg_fielding_season_player_season_idx ON fg_fielding_season (player_id, season);
CREATE INDEX fg_fielding_season_id_fg_season_idx ON fg_fielding_season (id_fg, season);

CREATE VIEW fg_fielding_season_current AS
SELECT DISTINCT ON (f.id_fg, f.season, f.team, f.level, f.position)
  f.*,
  s.pulled_at AS ingest_pulled_at
FROM fg_fielding_season f
INNER JOIN ingest_snapshot s ON s.snapshot_id = f.snapshot_id
WHERE s.source = 'fangraphs_fielding'
ORDER BY
  f.id_fg,
  f.season,
  f.team,
  f.level,
  f.position,
  s.pulled_at DESC NULLS LAST,
  f.inserted_at DESC NULLS LAST,
  f.snapshot_id DESC;

COMMENT ON VIEW fg_fielding_season_current IS
  'Deduped FanGraphs fielding: one row per (id_fg, season, team, level, position) from latest ingest.';

-- Placeholder for Savant-style OAA-by-cell ingest (compliance + feed TBD). Empty until ETL populates.
CREATE TABLE savant_fielding_oaa_cell (
  player_mlbam integer NOT NULL,
  game_year      smallint NOT NULL,
  cell_id        text NOT NULL,
  oaa            numeric(8, 3),
  attempts       integer,
  ingested_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_mlbam, game_year, cell_id)
);

CREATE INDEX savant_fielding_oaa_cell_year_idx ON savant_fielding_oaa_cell (game_year);

COMMENT ON TABLE savant_fielding_oaa_cell IS
  'Optional grid for OAA field heat maps; populate from an approved Savant/MLB export. See docs/PLAYER_CARDS_V2.md.';
