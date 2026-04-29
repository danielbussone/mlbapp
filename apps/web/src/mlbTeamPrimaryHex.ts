/**
 * Primary brand hex per MLB club (first listed color on
 * https://teamcolorcodes.com/mlb-color-codes/ ).
 * Keys are typical 3-letter abbreviations (FanGraphs / Statcast style).
 */
const ABBR_PRIMARY_HEX: Record<string, string> = {
  ARI: '#A71930',
  ATL: '#CE1141',
  BAL: '#DF4601',
  BOS: '#BD3039',
  CHC: '#0E3386',
  CHW: '#27251F',
  CIN: '#C6011F',
  CLE: '#00385D',
  COL: '#333366',
  DET: '#0C2340',
  HOU: '#002D62',
  KC: '#004687',
  LAA: '#BA0021',
  LAD: '#005A9C',
  MIA: '#00A3E0',
  MIL: '#12284B',
  MIN: '#002B5C',
  NYM: '#002D72',
  NYY: '#003087',
  OAK: '#003831',
  PHI: '#E81828',
  PIT: '#FDB827',
  SDP: '#2F241D',
  SFG: '#FD5A1E',
  SEA: '#005C5C',
  STL: '#C41E3A',
  TBR: '#8FBCE6',
  TEX: '#003278',
  TOR: '#134A8E',
  WSH: '#AB0003',
};

/** Alternate abbreviations seen in feeds. */
const ALIASES: Record<string, string> = {
  TB: 'TBR',
  WAS: 'WSH',
  ATH: 'OAK',
  SF: 'SFG',
  SD: 'SDP',
  AZ: 'ARI',
};

export function mlbTeamPrimaryHex(teamLabel: string | null | undefined): string | null {
  if (teamLabel == null) return null;
  const head = teamLabel.split(/[/+]/)[0]?.trim().toUpperCase();
  if (!head || head === 'TOT') return null;
  const key = ALIASES[head] ?? head;
  return ABBR_PRIMARY_HEX[key] ?? null;
}
