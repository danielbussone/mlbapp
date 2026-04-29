-- Snapshot cache for MLB Stats API `/people/{id}` (read-through TTL on API route).
CREATE TABLE player_bio_cache (
  player_id BIGINT PRIMARY KEY REFERENCES dim_player (player_id) ON DELETE CASCADE,
  key_mlbam INTEGER NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw_person JSONB NOT NULL DEFAULT '{}'::jsonb,
  height TEXT,
  weight INTEGER,
  bat_side_code TEXT,
  pitch_hand_code TEXT,
  birth_city TEXT,
  birth_state_province TEXT,
  birth_country TEXT,
  draft_year INTEGER,
  draft_summary TEXT,
  primary_position_code TEXT,
  primary_position_abbr TEXT,
  primary_position_name TEXT,
  current_team_id INTEGER,
  current_team_name TEXT,
  mlb_debut_date DATE,
  nick_name TEXT
);

CREATE INDEX player_bio_cache_fetched_at_idx ON player_bio_cache (fetched_at);
