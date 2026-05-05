import DownloadIcon from '@mui/icons-material/Download';
import OpenInFullIcon from '@mui/icons-material/OpenInFull';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TableSortLabel from '@mui/material/TableSortLabel';
import Typography from '@mui/material/Typography';
import type { LeaderboardAttachment, LeaderboardColumn } from '@mlbapp/shared';
import { useMemo, useState } from 'react';

function formatCell(raw: unknown, col: LeaderboardColumn): string {
  if (raw == null) return '—';
  if (col.type === 'string') return String(raw);
  if (typeof raw === 'number') {
    if (col.type === 'integer') return String(Math.round(raw));
    if (Number.isInteger(raw)) return String(raw);
    return Number(raw.toFixed(3)).toString();
  }
  if (typeof raw === 'string' && raw.trim() !== '' && !Number.isNaN(Number(raw))) {
    const n = Number(raw);
    if (col.type === 'integer') return String(Math.round(n));
    return Number(n.toFixed(4)).toString();
  }
  return String(raw);
}

function leaderboardToCsv(att: LeaderboardAttachment): string {
  const header = att.columns.map((c) => c.label).join(',');
  const lines = att.rows.map((row) =>
    att.columns
      .map((c) => {
        const v = row[c.id];
        const s = v == null ? '' : String(v);
        if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
        return s;
      })
      .join(',')
  );
  return [header, ...lines].join('\n');
}

export type ChatLeaderboardPanelProps = {
  attachment: LeaderboardAttachment;
  /** `sidebar`: chat rail beside thread (no top margin, taller scroll). `inline`: below chat / full page. */
  variant?: 'inline' | 'sidebar';
  onExpand?: () => void;
  onDismiss?: () => void;
};

export function ChatLeaderboardPanel({
  attachment,
  variant = 'inline',
  onExpand,
  onDismiss,
}: ChatLeaderboardPanelProps) {
  const inSidebar = variant === 'sidebar';
  const [orderBy, setOrderBy] = useState(attachment.sort.columnId);
  const [order, setOrder] = useState<'asc' | 'desc'>(attachment.sort.order);

  const sortedRows = useMemo(() => {
    const col = attachment.columns.find((c) => c.id === orderBy);
    const mul = order === 'asc' ? 1 : -1;
    const rows = [...attachment.rows];
    rows.sort((a, b) => {
      const va = a[orderBy];
      const vb = b[orderBy];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (col?.type === 'string') {
        return mul * String(va).localeCompare(String(vb), undefined, { numeric: true });
      }
      const na = typeof va === 'number' ? va : Number(va);
      const nb = typeof vb === 'number' ? vb : Number(vb);
      if (Number.isNaN(na) && Number.isNaN(nb)) return 0;
      if (Number.isNaN(na)) return 1;
      if (Number.isNaN(nb)) return -1;
      return mul * (na - nb);
    });
    return rows;
  }, [attachment.columns, attachment.rows, order, orderBy]);

  const exportCsv = () => {
    const csv = leaderboardToCsv({ ...attachment, rows: sortedRows });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `leaderboard-${attachment.provenance.dataset}-${attachment.provenance.sort_metric}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleSort = (id: string) => {
    if (orderBy === id) {
      setOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    } else {
      setOrderBy(id);
      setOrder('desc');
    }
  };

  return (
    <Paper
      variant="outlined"
      sx={{
        mt: inSidebar ? 0 : 2,
        p: 1.5,
        ...(inSidebar
          ? {
              flex: '1 1 auto',
              minHeight: 0,
              maxHeight: 'calc(100vh - 5rem)',
              display: 'flex',
              flexDirection: 'column',
            }
          : {}),
      }}
    >
      <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1} sx={{ mb: 1 }}>
        <Typography variant="subtitle1" component="h2">
          {attachment.title ?? 'Leaderboard'}
        </Typography>
        <Stack direction="row" spacing={1} flexWrap="wrap">
          {onExpand && (
            <Button size="small" startIcon={<OpenInFullIcon />} onClick={onExpand}>
              Full screen
            </Button>
          )}
          <Button size="small" startIcon={<DownloadIcon />} onClick={exportCsv}>
            Export CSV
          </Button>
          {onDismiss && (
            <Button size="small" color="inherit" onClick={onDismiss}>
              Dismiss
            </Button>
          )}
        </Stack>
      </Stack>
      <TableContainer
        sx={{
          maxHeight: inSidebar ? 'min(560px, calc(100vh - 14rem))' : 360,
          flex: inSidebar ? '1 1 auto' : undefined,
          minHeight: 0,
        }}
      >
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              {attachment.columns.map((col) => (
                <TableCell key={col.id} sortDirection={orderBy === col.id ? order : false}>
                  <TableSortLabel
                    active={orderBy === col.id}
                    direction={orderBy === col.id ? order : 'asc'}
                    onClick={() => toggleSort(col.id)}
                  >
                    {col.label}
                  </TableSortLabel>
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {sortedRows.map((row, i) => (
              <TableRow key={i}>
                {attachment.columns.map((col) => (
                  <TableCell key={col.id}>{formatCell(row[col.id], col)}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <Box sx={{ mt: 1 }}>
        <Typography variant="caption" color="text.secondary">
          {attachment.provenance.dataset} · sort {attachment.provenance.sort_metric} {attachment.provenance.order}
          {attachment.provenance.season_from != null || attachment.provenance.season_to != null
            ? ` · seasons ${attachment.provenance.season_from ?? '…'}–${attachment.provenance.season_to ?? '…'}`
            : ''}
        </Typography>
      </Box>
    </Paper>
  );
}
