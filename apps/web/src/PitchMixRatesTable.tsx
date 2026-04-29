import Box from '@mui/material/Box';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Tooltip from '@mui/material/Tooltip';
import { pitchTypeMovementColor } from './MovementMiniPlot.js';
import { pitchTypeName } from './pitchTypeLabels.js';

/** Statcast extended pitch-mix process rates (single season). */
export function PitchMixRatesTable({ rows }: { rows: Record<string, unknown>[] }) {
  if (rows.length === 0) return null;
  return (
    <TableContainer sx={{ maxWidth: '100%', overflow: 'auto' }}>
      <Table size="small" sx={{ '& td, & th': { fontSize: '0.68rem', whiteSpace: 'nowrap' } }}>
        <TableHead>
          <TableRow>
            <TableCell>Pitch</TableCell>
            <TableCell align="right">%</TableCell>
            <TableCell align="right">Zone%</TableCell>
            <TableCell align="right">Chase%</TableCell>
            <TableCell align="right">
              <Tooltip title="Swings ÷ all pitches of this type (fouls count as swings)." arrow placement="top">
                <Box component="span" sx={{ cursor: 'help', textDecoration: 'underline dotted' }}>
                  Swing%
                </Box>
              </Tooltip>
            </TableCell>
            <TableCell align="right">
              <Tooltip
                title="Swinging strikes ÷ swings on this pitch type (fouls count as swings). Same as whiff-per-swing."
                arrow
                placement="top"
              >
                <Box component="span" sx={{ cursor: 'help', textDecoration: 'underline dotted' }}>
                  Whiff%
                </Box>
              </Tooltip>
            </TableCell>
            <TableCell align="right">
              <Tooltip
                title="Swinging strikes ÷ all pitches of this type (includes takes). Usually lower than Whiff% because the denominator is larger than swings-only."
                arrow
                placement="top"
              >
                <Box component="span" sx={{ cursor: 'help', textDecoration: 'underline dotted' }}>
                  SwStr%
                </Box>
              </Tooltip>
            </TableCell>
            <TableCell align="right">GB%</TableCell>
            <TableCell align="right">FB%</TableCell>
            <TableCell align="right">HR%</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row, i) => {
            const pt = String(row.pitch_type ?? '');
            return (
              <TableRow key={i}>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Box
                      sx={{
                        width: 16,
                        height: 7,
                        borderRadius: 99,
                        bgcolor: pitchTypeMovementColor(pt),
                        border: '1px solid',
                        borderColor: 'divider',
                      }}
                    />
                    {pitchTypeName(pt)}
                  </Box>
                </TableCell>
                <TableCell align="right">{String(row.pct ?? '')}</TableCell>
                <TableCell align="right">{String(row.zone_pct ?? '—')}</TableCell>
                <TableCell align="right">{String(row.chase_pct ?? '—')}</TableCell>
                <TableCell align="right">{String(row.swing_pct ?? '—')}</TableCell>
                <TableCell align="right">{String(row.whiff_pct ?? '—')}</TableCell>
                <TableCell align="right">{String(row.swstr_pct ?? '—')}</TableCell>
                <TableCell align="right">{String(row.gb_pct ?? '—')}</TableCell>
                <TableCell align="right">{String(row.fb_pct ?? '—')}</TableCell>
                <TableCell align="right">{String(row.hr_pct ?? '—')}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
