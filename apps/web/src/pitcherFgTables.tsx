/**
 * Maps API payloads from `fg_pitching_career_mlb` and `fg_pitching_season_mlb_consolidated`
 * into player-card table rows (mirrors batterFgTables for batting).
 */

import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import { fgCardSeasonRowIsSelected, type FgBattingCardApi } from './batterFgTables.js';

export type PitchingCardLine = {
  seasonLabel: string;
  teamAbbr: string | null;
  w: number;
  l: number;
  sv: number;
  games: number;
  gs: number;
  ip: string;
  so: number;
  bb: number;
  era: number | null;
  fip: number | null;
  kPct: number | null;
  bbPct: number | null;
  hrPct: number | null;
  fwar: number | null;
};

export const PITCHING_CARD_HEADERS: { key: keyof Omit<PitchingCardLine, 'seasonLabel'>; label: string }[] = [
  { key: 'teamAbbr', label: 'Tm' },
  { key: 'w', label: 'W' },
  { key: 'l', label: 'L' },
  { key: 'sv', label: 'SV' },
  { key: 'games', label: 'G' },
  { key: 'gs', label: 'GS' },
  { key: 'ip', label: 'IP' },
  { key: 'so', label: 'SO' },
  { key: 'bb', label: 'BB' },
  { key: 'era', label: 'ERA' },
  { key: 'fip', label: 'FIP' },
  { key: 'kPct', label: 'K%' },
  { key: 'bbPct', label: 'BB%' },
  { key: 'hrPct', label: 'HR%' },
  { key: 'fwar', label: 'fWAR' },
];

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function nn(v: unknown, fallback = 0): number {
  return num(v) ?? fallback;
}

/** IP display from outs (Statcast / consolidated views use thirds). */
export function formatIpFromOuts(outs: unknown): string {
  const o = num(outs);
  if (o == null || o < 0) return '—';
  const whole = Math.floor(o / 3);
  const third = Math.round(o % 3);
  return third === 0 ? String(whole) : `${whole}.${third}`;
}

export function mapCareerViewToPitchingLine(c: Record<string, unknown>): PitchingCardLine {
  return {
    seasonLabel: 'Career',
    teamAbbr: null,
    w: nn(c.career_w),
    l: nn(c.career_l),
    sv: nn(c.career_sv),
    games: nn(c.career_games),
    gs: nn(c.career_games_started),
    ip: formatIpFromOuts(c.career_ip_outs),
    so: nn(c.career_so),
    bb: nn(c.career_bb) + nn(c.career_ibb),
    era: num(c.career_era),
    fip: num(c.career_fip),
    kPct: num(c.career_k_pct),
    bbPct: num(c.career_bb_pct),
    hrPct: num(c.career_hr_pct),
    fwar: num(c.career_war),
  };
}

export function mapConsolidatedSeasonToPitchingLine(s: Record<string, unknown>): PitchingCardLine {
  const td = s.team_display;
  const teamAbbr =
    typeof td === 'string' && td.trim() !== '' ? td.trim() : null;
  return {
    seasonLabel: String(s.season ?? ''),
    teamAbbr,
    w: nn(s.w),
    l: nn(s.l),
    sv: nn(s.sv),
    games: nn(s.games),
    gs: nn(s.games_started),
    ip: formatIpFromOuts(s.ip_outs),
    so: nn(s.so),
    bb: nn(s.bb) + nn(s.ibb),
    era: num(s.era),
    fip: num(s.fip_innings_weighted),
    kPct: num(s.k_pct),
    bbPct: num(s.bb_pct),
    hrPct: num(s.hr_pct),
    fwar: num(s.war),
  };
}

export function pitchingCardLinesFromCareerViews(api: FgBattingCardApi): {
  career: PitchingCardLine | null;
  lastSeasons: PitchingCardLine[];
} {
  const career = api.career ? mapCareerViewToPitchingLine(api.career) : null;
  const lastSeasons = (api.seasons ?? []).map(mapConsolidatedSeasonToPitchingLine);
  return { career, lastSeasons };
}

export function formatPitchingCardCell(
  key: keyof Omit<PitchingCardLine, 'seasonLabel'>,
  value: string | number | null
): string {
  if (key === 'teamAbbr') {
    if (value == null || value === '') return '—';
    return String(value);
  }
  if (value == null || (typeof value === 'number' && !Number.isFinite(value))) return '—';
  if (key === 'ip') return typeof value === 'string' ? value : String(value);
  if (key === 'w' || key === 'l' || key === 'sv' || key === 'games' || key === 'gs' || key === 'so' || key === 'bb') {
    return String(Math.round(Number(value)));
  }
  if (key === 'era' || key === 'fip' || key === 'fwar') return Number(value).toFixed(2);
  if (key === 'kPct' || key === 'bbPct' || key === 'hrPct') return `${(Number(value) * 100).toFixed(1)}%`;
  return String(value);
}

export function PitchingCardTable({
  lines,
  variant,
  selectedSeason,
}: {
  lines: PitchingCardLine[];
  variant: 'page' | 'sidebar';
  /** When set, the matching MLB season row is subtly highlighted (not Career). */
  selectedSeason?: number;
}) {
  if (lines.length === 0) return null;
  const fs = variant === 'sidebar' ? '0.68rem' : '0.75rem';
  return (
    <TableContainer sx={{ maxWidth: '100%', overflow: 'auto', mb: 1 }}>
      <Table size="small" sx={{ '& td, & th': { whiteSpace: 'nowrap', fontSize: fs } }}>
        <TableHead>
          <TableRow>
            <TableCell>Season</TableCell>
            {PITCHING_CARD_HEADERS.map((h) => (
              <TableCell key={h.key} align="right">
                {h.label}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {lines.map((line) => {
            const selected = fgCardSeasonRowIsSelected(line.seasonLabel, selectedSeason);
            return (
              <TableRow
                key={line.seasonLabel}
                sx={
                  selected
                    ? {
                        bgcolor: 'action.selected',
                        borderLeft: 3,
                        borderLeftColor: 'primary.main',
                        '& .MuiTableCell-root': { fontWeight: 600 },
                      }
                    : undefined
                }
              >
                <TableCell
                  component="th"
                  scope="row"
                  sx={{ fontWeight: line.seasonLabel === 'Career' ? 700 : selected ? 600 : 500 }}
                >
                  {line.seasonLabel}
                </TableCell>
                {PITCHING_CARD_HEADERS.map(({ key }) => (
                  <TableCell key={key} align={key === 'teamAbbr' ? 'left' : 'right'}>
                    {formatPitchingCardCell(key, line[key])}
                  </TableCell>
                ))}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
