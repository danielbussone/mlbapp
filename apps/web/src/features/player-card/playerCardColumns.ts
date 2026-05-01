/** Column order for FanGraphs tables (matches API / repo v1 shape). */

export const BATTING_TABLE_KEYS = [
  'season',
  'team',
  'level',
  'id_fg',
  'age',
  'games',
  'pa',
  'hr',
  'r',
  'rbi',
  'sb',
  'bb_pct',
  'k_pct',
  'iso',
  'babip',
  'avg',
  'obp',
  'slg',
  'woba',
  'xwoba',
  'wrc_plus',
  'bsr',
  'off_runs',
  'def_runs',
  'war',
  'rate_stat_qualified',
  'ingest_pulled_at',
] as const;

export const PITCHING_TABLE_KEYS = [
  'season',
  'team',
  'level',
  'id_fg',
  'age',
  'w',
  'l',
  'sv',
  'games',
  'games_started',
  'ip',
  'k_per_9',
  'bb_per_9',
  'hr_per_9',
  'babip',
  'lob_pct',
  'gb_pct',
  'hr_fb_pct',
  'vfa',
  'era',
  'xera',
  'fip',
  'xfip',
  'war',
  'rate_stat_qualified',
  'ingest_pulled_at',
] as const;

const RATE_DECIMAL_KEYS = new Set([
  'bb_pct',
  'k_pct',
  'iso',
  'babip',
  'avg',
  'obp',
  'slg',
  'woba',
  'xwoba',
  'lob_pct',
  'gb_pct',
  'hr_fb_pct',
]);

/** Display label for table header */
export function labelForKey(key: string): string {
  if (key === 'id_fg') return 'FG id';
  if (key === 'wrc_plus') return 'wRC+';
  if (key === 'off_runs') return 'Off';
  if (key === 'def_runs') return 'Def';
  if (key === 'games_started') return 'GS';
  if (key === 'hr_fb_pct') return 'HR/FB';
  if (key === 'ingest_pulled_at') return 'FG pulled';
  return key.replace(/_/g, ' ');
}

export function formatFgCell(key: string, value: unknown): string {
  if (value == null || value === '') return '—';
  if (key === 'rate_stat_qualified') {
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    return String(value);
  }
  if (key === 'wrc_plus' && typeof value === 'number') return value.toFixed(1);
  if (key === 'ingest_pulled_at' && typeof value === 'string') {
    return value.slice(0, 19).replace('T', ' ');
  }
  if (typeof value === 'number' && RATE_DECIMAL_KEYS.has(key)) {
    if (key.endsWith('_pct') || key === 'bb_pct' || key === 'k_pct' || key === 'lob_pct' || key === 'gb_pct' || key === 'hr_fb_pct') {
      return `${(value * 100).toFixed(1)}%`;
    }
    if (key === 'avg' || key === 'obp' || key === 'slg' || key === 'babip' || key === 'iso' || key === 'woba' || key === 'xwoba') {
      return value.toFixed(3);
    }
    return String(value);
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : String(value);
  }
  return String(value);
}
