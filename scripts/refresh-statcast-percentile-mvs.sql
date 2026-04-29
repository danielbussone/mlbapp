-- Refresh Statcast league percentile + Savant BIP materialized views (Flyway V15–V16).
-- Run after bulk Statcast ingest, e.g.:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/refresh-statcast-percentile-mvs.sql

REFRESH MATERIALIZED VIEW statcast_batter_season_percentile_mv;
REFRESH MATERIALIZED VIEW statcast_pitcher_season_totals_percentile_mv;
REFRESH MATERIALIZED VIEW statcast_pitcher_season_pitchtype_percentile_mv;
REFRESH MATERIALIZED VIEW statcast_batter_season_savant_bip_mv;
REFRESH MATERIALIZED VIEW statcast_pitcher_season_savant_bip_mv;
