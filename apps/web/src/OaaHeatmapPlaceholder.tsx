import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useEffect, useState } from 'react';

/**
 * Renders Savant-style OAA grid when `savant_fielding_oaa_cell` has rows; otherwise explains ingest.
 */
export function OaaHeatmapPlaceholder({ playerId, gameYear }: { playerId: number; gameYear: number }) {
  const [cells, setCells] = useState<Record<string, unknown>[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch(`/api/players/${playerId}/fielding-oaa?game_year=${gameYear}`);
        const j = (await r.json()) as { cells?: unknown[] };
        if (cancelled) return;
        setCells(Array.isArray(j.cells) ? (j.cells as Record<string, unknown>[]) : []);
      } catch {
        if (!cancelled) setCells([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [playerId, gameYear]);

  if (cells.length === 0) {
    return (
      <Alert severity="info" sx={{ mt: 1, py: 0.5 }}>
        <Typography variant="body2">
          OAA field grid is not loaded yet. After you have an approved fielding export, ingest it into{' '}
          <code>savant_fielding_oaa_cell</code>. See <code>docs/PLAYER_CARDS_V2.md</code> for the workflow.
        </Typography>
      </Alert>
    );
  }

  const maxA = Math.max(
    1,
    ...cells.map((c) => Number(c.attempts ?? 0)).filter((n) => Number.isFinite(n))
  );

  return (
    <Box sx={{ mt: 1 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
        OAA by field cell
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, maxWidth: 360 }}>
        {cells.map((c, i) => {
          const oaa = Number(c.oaa ?? 0);
          const att = Number(c.attempts ?? 0);
          const t = Math.max(0.35, Math.sqrt(att / maxA) * 1.4);
          const hue = oaa >= 0 ? 0 : 220;
          const sat = Math.min(90, 30 + Math.abs(oaa) * 12);
          return (
            <Box
              key={i}
              title={`${String(c.cell_id)}: OAA ${oaa}, att ${att}`}
              sx={{
                width: `${t * 14}px`,
                height: `${t * 14}px`,
                bgcolor: `hsl(${hue} ${sat}% 88%)`,
                border: '1px solid',
                borderColor: 'divider',
              }}
            />
          );
        })}
      </Box>
    </Box>
  );
}
