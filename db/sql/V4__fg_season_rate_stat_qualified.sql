-- Computed at FanGraphs ETL ingest: meets MLB PA / IP thresholds for that season's
-- schedule length (3.1 PA per team game batting; 1 IP per team game pitching).
-- NULL = unknown (legacy rows) or non-MLB level where rule does not apply.

ALTER TABLE fg_batting_season
  ADD COLUMN rate_stat_qualified boolean;

ALTER TABLE fg_pitching_season
  ADD COLUMN rate_stat_qualified boolean;

COMMENT ON COLUMN fg_batting_season.rate_stat_qualified IS
  'MLB batting: PA >= ceil(schedule_games * 3.1) for that season; NULL if non-MLB level or legacy row.';

COMMENT ON COLUMN fg_pitching_season.rate_stat_qualified IS
  'MLB pitching: IP outs >= schedule_games * 3 for that season; NULL if non-MLB level or legacy row.';
