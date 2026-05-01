import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import styles from './FieldingTable.module.css';

function fmt(v: unknown): string {
  if (v == null || v === '') return '—';
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return String(v);
}

export function FieldingTable({ rows }: { rows: Record<string, unknown>[] }) {
  if (rows.length === 0) {
    return (
      <Typography variant="caption" color="text.secondary">
        No FanGraphs fielding rows (run <code>pnpm etl:fg --fielding-only</code> after Flyway V14).
      </Typography>
    );
  }
  return (
    <Table size="small" className={styles.table}>
      <TableHead>
        <TableRow>
          <TableCell>Year</TableCell>
          <TableCell>Pos</TableCell>
          <TableCell>Team</TableCell>
          <TableCell align="right">Inn</TableCell>
          <TableCell align="right">DRS</TableCell>
          <TableCell align="right">UZR</TableCell>
          <TableCell align="right">OAA</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((r, i) => (
          <TableRow key={i}>
            <TableCell>{fmt(r.season)}</TableCell>
            <TableCell>{fmt(r.position)}</TableCell>
            <TableCell>{fmt(r.team)}</TableCell>
            <TableCell align="right">{fmt(r.inn)}</TableCell>
            <TableCell align="right">{fmt(r.drs)}</TableCell>
            <TableCell align="right">{fmt(r.uzr)}</TableCell>
            <TableCell align="right">{fmt(r.oaa)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
