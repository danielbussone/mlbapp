/**
 * Statcast / Savant `pitch_type` abbreviations → short display names.
 * @see https://baseballsavant.mlb.com/csv-docs (pitch_type)
 */
const PITCH_TYPE_NAMES: Record<string, string> = {
  FF: 'Four-seam',
  FA: 'Fastball',
  SI: 'Sinker',
  FC: 'Cutter',
  SL: 'Slider',
  ST: 'Sweeper',
  CH: 'Changeup',
  CU: 'Curveball',
  KC: 'Knuckle curve',
  FS: 'Splitter',
  KN: 'Knuckleball',
  EP: 'Eephus',
  SV: 'Slurve',
  FO: 'Forkball',
  PO: 'Pitch out',
  SC: 'Screwball',
  CS: 'Slow curve',
  UN: 'Unknown',
  XX: 'Unknown',
  STO: 'Sweeper',
  STF: 'Sweeper',
};

export function pitchTypeName(code: string): string {
  const k = code.trim().toUpperCase();
  return PITCH_TYPE_NAMES[k] ?? k;
}
