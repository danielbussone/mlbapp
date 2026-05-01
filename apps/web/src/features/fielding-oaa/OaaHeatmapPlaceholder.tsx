import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useEffect, useMemo, useState } from 'react';

import type { LeaguePercentilesResponse } from '@/features/league-percentiles/leaguePercentilesTypes.js';
import { ifMiniPieAnchorFromFg } from './infieldFieldGeometry.js';
import { OaaDirectionalField } from './OaaDirectionalField.js';
import { OaaIfDirectionalField } from './OaaIfDirectionalField.js';
import type { OutfieldAnchor } from './oaaDirectionalFieldGeometry.js';
import type { FieldingOaaPrimaryPos } from '@/features/league-percentiles/percentileGoodnessColor.js';
import { fieldingOaaGoodnessDp } from '@/features/league-percentiles/percentileGoodnessColor.js';
import {
  fieldingInningsOfVsIf,
  primaryInfieldByInnings,
  primaryOutfieldByInnings,
} from '@/features/fielding-frv/primaryOutfield.js';
import styles from './OaaHeatmapPlaceholder.module.css';

/**
 * Renders Savant directional OAA on the shared field diagram when `savant_fielding_oaa_cell` has rows;
 * otherwise explains ingest.
 */
export function OaaHeatmapPlaceholder({
  playerId,
  gameYear,
  fieldingRows,
  /** When false, the viz stays on a skeleton so anchors / OF vs IF routing do not use empty FG rows (avoids SS→2B jumps). */
  fieldingRowsReady,
}: {
  playerId: number;
  gameYear: number;
  /** FanGraphs fielding lines (same shape as `GET …/fg-fielding`) — used to pick LF/CF/RF by innings. */
  fieldingRows?: Record<string, unknown>[];
  fieldingRowsReady: boolean;
}) {
  const [cells, setCells] = useState<Record<string, unknown>[]>([]);
  const [percentilePayload, setPercentilePayload] = useState<LeaguePercentilesResponse | null>(null);
  const [oaaCellsSettled, setOaaCellsSettled] = useState(false);
  const [percentilesSettled, setPercentilesSettled] = useState(false);

  function finiteNum(v: unknown): number | null {
    if (v == null || v === '') return null;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  }

  useEffect(() => {
    let cancelled = false;
    setOaaCellsSettled(false);
    void (async () => {
      try {
        const r = await fetch(`/api/players/${playerId}/fielding-oaa?game_year=${gameYear}`);
        const j = (await r.json()) as { cells?: unknown[] };
        if (cancelled) return;
        setCells(Array.isArray(j.cells) ? (j.cells as Record<string, unknown>[]) : []);
      } catch {
        if (!cancelled) setCells([]);
      } finally {
        if (!cancelled) setOaaCellsSettled(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [playerId, gameYear]);

  useEffect(() => {
    let cancelled = false;
    setPercentilesSettled(false);
    const qs = new URLSearchParams({
      game_year: String(gameYear),
      role: 'fielding',
    });
    void (async () => {
      try {
        const r = await fetch(`/api/players/${playerId}/league-percentiles?${qs.toString()}`);
        const j = (await r.json()) as LeaguePercentilesResponse & { error?: string };
        if (cancelled) return;
        if (r.ok && j.percentiles_available) setPercentilePayload(j);
        else setPercentilePayload(null);
      } catch {
        if (!cancelled) setPercentilePayload(null);
      } finally {
        if (!cancelled) setPercentilesSettled(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [playerId, gameYear]);

  const primaryAnchor = useMemo(() => {
    const p = primaryOutfieldByInnings(fieldingRows ?? [], gameYear);
    return { anchor: (p ?? 'CF') as OutfieldAnchor, fromFg: p != null };
  }, [fieldingRows, gameYear]);

  const primaryIf = useMemo(
    () => primaryInfieldByInnings(fieldingRows ?? [], gameYear),
    [fieldingRows, gameYear],
  );

  const ofVsIfInn = useMemo(
    () => fieldingInningsOfVsIf(fieldingRows ?? [], gameYear),
    [fieldingRows, gameYear],
  );

  const hasOfDir = useMemo(
    () => cells.some((c) => String(c.cell_id ?? '').startsWith('of_dir_')),
    [cells],
  );

  const hasIfDir = useMemo(
    () => cells.some((c) => String(c.cell_id ?? '').startsWith('if_dir_')),
    [cells],
  );

  const directionalKind = useMemo((): 'of' | 'if' | null => {
    if (hasOfDir && !hasIfDir) return 'of';
    if (hasIfDir && !hasOfDir) return 'if';
    if (!hasOfDir && !hasIfDir) return null;
    const { ofInn, ifInn } = ofVsIfInn;
    if (ifInn > ofInn) return 'if';
    if (ofInn > ifInn) return 'of';
    if (primaryIf && !primaryAnchor.fromFg) return 'if';
    if (primaryAnchor.fromFg && !primaryIf) return 'of';
    return 'of';
  }, [
    hasOfDir,
    hasIfDir,
    ofVsIfInn.ifInn,
    ofVsIfInn.ofInn,
    primaryAnchor.fromFg,
    primaryIf,
  ]);

  const primaryForGoodness: FieldingOaaPrimaryPos = useMemo(() => {
    if (directionalKind === 'if') return primaryIf ?? 'SS';
    return primaryAnchor.anchor;
  }, [directionalKind, primaryAnchor.anchor, primaryIf]);

  const totalDirectionalOaa = useMemo(() => {
    let sum = 0;
    let any = false;
    const prefix = directionalKind === 'if' ? 'if_dir_' : 'of_dir_';
    for (const c of cells) {
      if (!String(c.cell_id ?? '').startsWith(prefix)) continue;
      const n = finiteNum(c.oaa);
      if (n == null) continue;
      any = true;
      sum += n;
    }
    return any ? sum : null;
  }, [cells, directionalKind]);

  const oaaGoodnessDp = useMemo(
    () => fieldingOaaGoodnessDp(percentilePayload, primaryForGoodness),
    [percentilePayload, primaryForGoodness],
  );

  const depsReady = fieldingRowsReady && oaaCellsSettled && percentilesSettled;

  if (!depsReady) {
    return (
      <Stack spacing={1} className={`${styles.section} ${styles.skeletonBlock}`} aria-busy="true" aria-label="Loading OAA grid">
        <Skeleton variant="text" width="55%" height={24} />
        <Skeleton variant="rounded" width="100%" height={160} />
        <Stack direction="row" spacing={1}>
          <Skeleton variant="rounded" width={72} height={20} />
          <Skeleton variant="rounded" width={72} height={20} />
        </Stack>
      </Stack>
    );
  }

  if (cells.length === 0) {
    return (
      <Alert severity="info" className={styles.alertTight}>
        <Typography variant="body2">
          OAA field grid is not loaded yet. After you have an approved fielding export, ingest it into{' '}
          <code>savant_fielding_oaa_cell</code>. See <code>docs/PLAYER_CARDS_V2.md</code> for the workflow.
        </Typography>
      </Alert>
    );
  }

  const maxA = Math.max(
    1,
    ...cells.map((c) => finiteNum(c.attempts)).filter((n): n is number => n != null && n > 0)
  );

  if (directionalKind === 'if') {
    return (
      <Box className={styles.section}>
        <Typography variant="subtitle2" className={styles.sectionTitle}>
          OAA by direction (infield)
        </Typography>
        <OaaIfDirectionalField
          cells={cells}
          gameYear={gameYear}
          primaryAnchorId={ifMiniPieAnchorFromFg(primaryIf)}
          oaaGoodnessDp={oaaGoodnessDp}
          primaryPosNote={
            primaryIf != null
              ? `Percentile dial uses ${primaryIf} (most innings among 1B–SS this season).`
              : 'No 1B–SS innings split on FanGraphs for this season — percentile dial defaults to SS cohort.'
          }
        />
      </Box>
    );
  }

  if (directionalKind === 'of') {
    return (
      <Box className={styles.section}>
        <Typography variant="subtitle2" className={styles.sectionTitle}>
          OAA by direction (outfield)
        </Typography>
        <OaaDirectionalField
          cells={cells}
          gameYear={gameYear}
          anchor={primaryAnchor.anchor}
          anchorResolvedFromFg={primaryAnchor.fromFg}
          totalOaa={totalDirectionalOaa}
          oaaGoodnessDp={oaaGoodnessDp}
        />
      </Box>
    );
  }

  return (
    <Box className={styles.section}>
      <Typography variant="subtitle2" className={styles.sectionTitle}>
        OAA by field cell
      </Typography>
      <Stack direction="row" spacing={1.5} alignItems="center" className={styles.legendRow}>
        <Typography variant="caption" color="text.secondary">
          Square size ∝ attempts (rough sample weight). Colors:
        </Typography>
        <Stack direction="row" spacing={0.75} alignItems="center">
          <Box className={`${styles.legendSwatch} ${styles.legendPos}`} />
          <Typography variant="caption" color="text.secondary">
            OAA &gt; 0
          </Typography>
        </Stack>
        <Stack direction="row" spacing={0.75} alignItems="center">
          <Box className={`${styles.legendSwatch} ${styles.legendZero}`} />
          <Typography variant="caption" color="text.secondary">
            OAA = 0
          </Typography>
        </Stack>
        <Stack direction="row" spacing={0.75} alignItems="center">
          <Box className={`${styles.legendSwatch} ${styles.legendNeg}`} />
          <Typography variant="caption" color="text.secondary">
            OAA &lt; 0
          </Typography>
        </Stack>
        <Stack direction="row" spacing={0.75} alignItems="center">
          <Box className={`${styles.legendSwatch} ${styles.legendNone}`} />
          <Typography variant="caption" color="text.secondary">
            No OAA
          </Typography>
        </Stack>
      </Stack>
      <Box className={styles.cellGrid}>
        {cells.map((c, i) => {
          const oaaN = finiteNum(c.oaa);
          const attN = finiteNum(c.attempts);
          const att = attN ?? 0;
          const t = Math.max(0.35, Math.sqrt(att / maxA) * 1.4);
          let bgcolor: string;
          if (oaaN == null) bgcolor = 'hsl(40 8% 88%)';
          else if (oaaN === 0) bgcolor = 'hsl(0 0% 86%)';
          else if (oaaN > 0) {
            const sat = Math.min(90, 30 + Math.abs(oaaN) * 12);
            bgcolor = `hsl(0 ${sat}% 88%)`;
          } else {
            const sat = Math.min(90, 30 + Math.abs(oaaN) * 12);
            bgcolor = `hsl(220 ${sat}% 88%)`;
          }
          const id = String(c.cell_id ?? '');
          return (
            <Box
              key={id ? `${gameYear}-${playerId}-${id}` : `cell-${i}`}
              title={`${id}: OAA ${oaaN == null ? '—' : oaaN}, att ${attN == null ? '—' : attN}`}
              sx={{
                width: `${t * 14}px`,
                height: `${t * 14}px`,
                bgcolor,
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
