-- V3 views expanded f.* at creation time; V4 added rate_stat_qualified to base tables.
-- Recreate views so fg_*_season_current expose the new column (and any future f.* adds).

DROP VIEW IF EXISTS fg_batting_season_current;
DROP VIEW IF EXISTS fg_pitching_season_current;

CREATE VIEW fg_batting_season_current AS
SELECT DISTINCT ON (f.id_fg, f.season, f.team, f.level)
  f.*,
  s.pulled_at AS ingest_pulled_at
FROM fg_batting_season f
INNER JOIN ingest_snapshot s ON s.snapshot_id = f.snapshot_id
WHERE s.source = 'fangraphs_batting'
ORDER BY
  f.id_fg,
  f.season,
  f.team,
  f.level,
  s.pulled_at DESC NULLS LAST,
  f.inserted_at DESC NULLS LAST,
  f.snapshot_id DESC;

CREATE VIEW fg_pitching_season_current AS
SELECT DISTINCT ON (f.id_fg, f.season, f.team, f.level)
  f.*,
  s.pulled_at AS ingest_pulled_at
FROM fg_pitching_season f
INNER JOIN ingest_snapshot s ON s.snapshot_id = f.snapshot_id
WHERE s.source = 'fangraphs_pitching'
ORDER BY
  f.id_fg,
  f.season,
  f.team,
  f.level,
  s.pulled_at DESC NULLS LAST,
  f.inserted_at DESC NULLS LAST,
  f.snapshot_id DESC;

COMMENT ON VIEW fg_batting_season_current IS
  'Deduped FanGraphs batting: one row per (id_fg, season, team, level) from the snapshot with the latest pulled_at.';

COMMENT ON VIEW fg_pitching_season_current IS
  'Deduped FanGraphs pitching: one row per (id_fg, season, team, level) from the snapshot with the latest pulled_at.';
