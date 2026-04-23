-- One logical row per FanGraphs grain across all loads: pick the row whose
-- ingest_snapshot is newest by pulled_at (then inserted_at, snapshot_id).
-- Use these views for app / ad hoc queries; base tables keep full lineage.

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
