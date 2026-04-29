-- MLB Stats API GET /people/{id}/awards — cached alongside bio (same app TTL).
ALTER TABLE player_bio_cache
  ADD COLUMN awards_raw jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN awards_all_star integer,
  ADD COLUMN awards_mvp integer,
  ADD COLUMN awards_cy_young integer,
  ADD COLUMN awards_fetched_at timestamptz;
