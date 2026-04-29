-- More MLB honors from Stats API GET /people/{id}/awards (stable ids).
ALTER TABLE player_bio_cache
  ADD COLUMN awards_gold_glove integer,
  ADD COLUMN awards_silver_slugger integer,
  ADD COLUMN awards_platinum_glove integer,
  ADD COLUMN awards_reliever_of_year integer;
