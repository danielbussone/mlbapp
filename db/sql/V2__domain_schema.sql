-- Domain schema per docs/SCHEMA_PROPOSAL.md (owner-approved).
-- Depends: V1__extensions.sql (vector).

-- ---------------------------------------------------------------------------
-- dim_player
-- ---------------------------------------------------------------------------
CREATE TABLE dim_player (
  player_id     bigserial PRIMARY KEY,
  key_uuid      uuid UNIQUE,
  key_mlbam     integer UNIQUE,
  name_last     text NOT NULL,
  name_first    text NOT NULL,
  birth_date    date,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX dim_player_name_idx ON dim_player (name_last, name_first);

-- ---------------------------------------------------------------------------
-- player_external_identifier
-- ---------------------------------------------------------------------------
CREATE TABLE player_external_identifier (
  map_id      bigserial PRIMARY KEY,
  player_id   bigint NOT NULL REFERENCES dim_player (player_id) ON DELETE CASCADE,
  id_system   text NOT NULL,
  id_value    text NOT NULL,
  valid_from  timestamptz,
  valid_to    timestamptz,
  UNIQUE (id_system, id_value),
  UNIQUE (player_id, id_system)
);

CREATE INDEX player_external_identifier_player_idx ON player_external_identifier (player_id);

-- ---------------------------------------------------------------------------
-- ingest_snapshot
-- ---------------------------------------------------------------------------
CREATE TABLE ingest_snapshot (
  snapshot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source      text NOT NULL,
  params      jsonb NOT NULL DEFAULT '{}',
  pulled_at   timestamptz NOT NULL DEFAULT now(),
  row_count   bigint,
  notes       text
);

CREATE INDEX ingest_snapshot_source_pulled_idx ON ingest_snapshot (source, pulled_at DESC);

-- ---------------------------------------------------------------------------
-- FanGraphs season facts (snapshot-bound)
-- ---------------------------------------------------------------------------
CREATE TABLE fg_batting_season (
  snapshot_id uuid NOT NULL REFERENCES ingest_snapshot (snapshot_id) ON DELETE CASCADE,
  id_fg       integer NOT NULL,
  season      smallint NOT NULL,
  team        text NOT NULL,
  level       text NOT NULL DEFAULT 'MLB',
  player_id   bigint REFERENCES dim_player (player_id),
  age         smallint,
  games       smallint,
  pa          integer,
  hr          smallint,
  r           smallint,
  rbi         smallint,
  sb          smallint,
  bb_pct      numeric(7, 4),
  k_pct       numeric(7, 4),
  iso         numeric(6, 4),
  babip       numeric(6, 4),
  avg         numeric(6, 4),
  obp         numeric(6, 4),
  slg         numeric(6, 4),
  woba        numeric(6, 4),
  xwoba       numeric(6, 4),
  wrc_plus    numeric(7, 2),
  bsr         numeric(7, 2),
  off_runs    numeric(7, 2),
  def_runs    numeric(7, 2),
  war         numeric(5, 2),
  stats_jsonb jsonb NOT NULL,
  inserted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (snapshot_id, id_fg, season, team, level)
);

CREATE INDEX fg_batting_season_player_season_idx ON fg_batting_season (player_id, season);
CREATE INDEX fg_batting_season_id_fg_season_idx ON fg_batting_season (id_fg, season);
CREATE INDEX fg_batting_season_card_sort_idx ON fg_batting_season (season, war DESC NULLS LAST)
  WHERE player_id IS NOT NULL;

CREATE TABLE fg_pitching_season (
  snapshot_id uuid NOT NULL REFERENCES ingest_snapshot (snapshot_id) ON DELETE CASCADE,
  id_fg       integer NOT NULL,
  season      smallint NOT NULL,
  team        text NOT NULL,
  level       text NOT NULL DEFAULT 'MLB',
  player_id   bigint REFERENCES dim_player (player_id),
  age         smallint,
  w           smallint,
  l           smallint,
  sv          smallint,
  games       smallint,
  games_started smallint,
  ip          numeric(7, 1),
  k_per_9     numeric(6, 2),
  bb_per_9    numeric(6, 2),
  hr_per_9    numeric(6, 2),
  babip       numeric(6, 4),
  lob_pct     numeric(7, 4),
  gb_pct      numeric(7, 4),
  hr_fb_pct   numeric(7, 4),
  vfa         numeric(5, 1),
  era         numeric(5, 2),
  xera        numeric(5, 2),
  fip         numeric(5, 2),
  xfip        numeric(5, 2),
  war         numeric(5, 2),
  stats_jsonb jsonb NOT NULL,
  inserted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (snapshot_id, id_fg, season, team, level)
);

CREATE INDEX fg_pitching_season_player_season_idx ON fg_pitching_season (player_id, season);
CREATE INDEX fg_pitching_season_card_sort_idx ON fg_pitching_season (season, war DESC NULLS LAST)
  WHERE player_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- statcast_pitch (LIST partition by game_year)
-- ---------------------------------------------------------------------------
CREATE TABLE statcast_pitch (
  game_pk           bigint NOT NULL,
  at_bat_number     integer NOT NULL,
  pitch_number      integer NOT NULL,
  sv_id             text,
  game_date         date,
  game_year         smallint NOT NULL,
  pitcher_mlbam     integer NOT NULL,
  batter_mlbam      integer NOT NULL,
  player_id_pitcher bigint REFERENCES dim_player (player_id),
  player_id_batter  bigint REFERENCES dim_player (player_id),
  pitch_type        text,
  release_speed     numeric,
  pfx_x             numeric,
  pfx_z             numeric,
  plate_x           numeric,
  plate_z           numeric,
  launch_speed      numeric,
  launch_angle      numeric,
  events            text,
  description       text,
  payload_jsonb     jsonb,
  snapshot_id       uuid REFERENCES ingest_snapshot (snapshot_id),
  ingested_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (game_year, game_pk, at_bat_number, pitch_number)
) PARTITION BY LIST (game_year);

-- Year partitions (Statcast-era MLB + headroom); DEFAULT catches anything else.
CREATE TABLE statcast_pitch_y2010 PARTITION OF statcast_pitch FOR VALUES IN (2010);
CREATE TABLE statcast_pitch_y2011 PARTITION OF statcast_pitch FOR VALUES IN (2011);
CREATE TABLE statcast_pitch_y2012 PARTITION OF statcast_pitch FOR VALUES IN (2012);
CREATE TABLE statcast_pitch_y2013 PARTITION OF statcast_pitch FOR VALUES IN (2013);
CREATE TABLE statcast_pitch_y2014 PARTITION OF statcast_pitch FOR VALUES IN (2014);
CREATE TABLE statcast_pitch_y2015 PARTITION OF statcast_pitch FOR VALUES IN (2015);
CREATE TABLE statcast_pitch_y2016 PARTITION OF statcast_pitch FOR VALUES IN (2016);
CREATE TABLE statcast_pitch_y2017 PARTITION OF statcast_pitch FOR VALUES IN (2017);
CREATE TABLE statcast_pitch_y2018 PARTITION OF statcast_pitch FOR VALUES IN (2018);
CREATE TABLE statcast_pitch_y2019 PARTITION OF statcast_pitch FOR VALUES IN (2019);
CREATE TABLE statcast_pitch_y2020 PARTITION OF statcast_pitch FOR VALUES IN (2020);
CREATE TABLE statcast_pitch_y2021 PARTITION OF statcast_pitch FOR VALUES IN (2021);
CREATE TABLE statcast_pitch_y2022 PARTITION OF statcast_pitch FOR VALUES IN (2022);
CREATE TABLE statcast_pitch_y2023 PARTITION OF statcast_pitch FOR VALUES IN (2023);
CREATE TABLE statcast_pitch_y2024 PARTITION OF statcast_pitch FOR VALUES IN (2024);
CREATE TABLE statcast_pitch_y2025 PARTITION OF statcast_pitch FOR VALUES IN (2025);
CREATE TABLE statcast_pitch_y2026 PARTITION OF statcast_pitch FOR VALUES IN (2026);
CREATE TABLE statcast_pitch_y2027 PARTITION OF statcast_pitch FOR VALUES IN (2027);
CREATE TABLE statcast_pitch_y2028 PARTITION OF statcast_pitch FOR VALUES IN (2028);
CREATE TABLE statcast_pitch_y2029 PARTITION OF statcast_pitch FOR VALUES IN (2029);
CREATE TABLE statcast_pitch_y2030 PARTITION OF statcast_pitch FOR VALUES IN (2030);
CREATE TABLE statcast_pitch_default PARTITION OF statcast_pitch DEFAULT;

-- Alternate key when sv_id present (includes game_year for partitioned-table uniqueness).
CREATE UNIQUE INDEX statcast_pitch_sv_id_uidx ON statcast_pitch (game_year, sv_id)
  WHERE sv_id IS NOT NULL;

CREATE INDEX statcast_pitch_pitcher_game_date_idx ON statcast_pitch (pitcher_mlbam, game_date);
CREATE INDEX statcast_pitch_batter_game_date_idx ON statcast_pitch (batter_mlbam, game_date);
CREATE INDEX statcast_pitch_game_ab_idx ON statcast_pitch (game_pk, at_bat_number);

-- ---------------------------------------------------------------------------
-- RAG / chat (pgvector)
-- ---------------------------------------------------------------------------
CREATE TABLE rag_document_chunk (
  chunk_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id   bigint REFERENCES dim_player (player_id) ON DELETE SET NULL,
  content     text NOT NULL,
  embedding   vector(1536),
  metadata    jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX rag_document_chunk_embedding_idx
  ON rag_document_chunk
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
