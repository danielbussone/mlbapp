import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Container from '@mui/material/Container';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { Link } from 'react-router-dom';

import { FrvDiamondViz, type FrvDiamondRole } from './FrvDiamondViz.js';

/** Mock Savant-shaped FRV row (runs). */
type FrvMockRow = {
  playerName: string;
  positionFilter: 'OF' | 'IF' | 'C';
  /** FanGraphs-style primary for IF row shape (e.g. SS vs 1B). */
  primaryPos: string;
  season: number;
  total_runs: number;
  range_runs: number;
  arm_runs: number;
  inf_of_runs: number;
  dp_runs: number;
  framing_runs: number;
  throwing_runs: number;
  blocking_runs: number;
};

const MOCK_CF: FrvMockRow = {
  playerName: 'Example Center Fielder',
  positionFilter: 'OF',
  primaryPos: 'CF',
  season: 2025,
  total_runs: 7,
  range_runs: 6,
  arm_runs: 1,
  inf_of_runs: 0,
  dp_runs: 0,
  framing_runs: 0,
  throwing_runs: 0,
  blocking_runs: 0,
};

const MOCK_SS: FrvMockRow = {
  playerName: 'Example Shortstop',
  positionFilter: 'IF',
  primaryPos: 'SS',
  season: 2025,
  total_runs: 8,
  range_runs: 6,
  arm_runs: 1,
  inf_of_runs: 2,
  dp_runs: -1,
  framing_runs: 0,
  throwing_runs: 0,
  blocking_runs: 0,
};

const MOCK_1B: FrvMockRow = {
  playerName: 'Example First Baseman',
  positionFilter: 'IF',
  primaryPos: '1B',
  season: 2025,
  total_runs: 4,
  range_runs: 2,
  arm_runs: 1,
  inf_of_runs: 0,
  dp_runs: 1,
  framing_runs: 0,
  throwing_runs: 0,
  blocking_runs: 0,
};

const MOCK_C: FrvMockRow = {
  playerName: 'Example Catcher',
  positionFilter: 'C',
  primaryPos: 'C',
  season: 2025,
  total_runs: 8,
  range_runs: 0,
  arm_runs: 0,
  inf_of_runs: 0,
  dp_runs: 0,
  framing_runs: 5,
  throwing_runs: 2,
  blocking_runs: 1,
};

const BAR_MAX = 10;

function barFill(value: number): { neg: string; pos: string } {
  if (value < 0) return { neg: 'hsl(220 70% 42%)', pos: 'transparent' };
  if (value > 0) return { neg: 'transparent', pos: 'hsl(0 65% 42%)' };
  return { neg: 'transparent', pos: 'transparent' };
}

/** 1B-primary IF cards: Range + DP only (no Arm bar). */
function isFirstBasePrimary(row: FrvMockRow): boolean {
  const p = row.primaryPos.trim();
  return p === '1B' || p === 'DH/1B' || p.startsWith('1B/');
}

function FrvDivergingBar({
  label,
  value,
  hint,
  valueDetail,
}: {
  label: string;
  value: number;
  hint?: string;
  valueDetail?: string;
}) {
  const v = Number.isFinite(value) ? value : 0;
  const cap = BAR_MAX;
  const pct = Math.min(50, (Math.abs(v) / cap) * 50);
  const { neg, pos } = barFill(v);

  return (
    <Stack spacing={0.25}>
      <Stack direction="row" justifyContent="space-between" alignItems="baseline">
        <Typography variant="caption" color="text.secondary" title={hint}>
          {label}
        </Typography>
        <Typography variant="caption" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
          {v > 0 ? `+${v}` : String(v)}
        </Typography>
      </Stack>
      <Box
        sx={{
          position: 'relative',
          height: 10,
          borderRadius: 1,
          bgcolor: 'grey.200',
          overflow: 'hidden',
        }}
        aria-label={`${label}: ${v} runs`}
      >
        <Box
          sx={{
            position: 'absolute',
            left: '50%',
            top: 0,
            bottom: 0,
            width: 2,
            ml: '-1px',
            bgcolor: 'grey.500',
            zIndex: 1,
          }}
        />
        {v < 0 && (
          <Box
            sx={{
              position: 'absolute',
              right: '50%',
              top: 0,
              bottom: 0,
              width: `${pct}%`,
              bgcolor: neg,
              borderRadius: '4px 0 0 4px',
            }}
          />
        )}
        {v > 0 && (
          <Box
            sx={{
              position: 'absolute',
              left: '50%',
              top: 0,
              bottom: 0,
              width: `${pct}%`,
              bgcolor: pos,
              borderRadius: '0 4px 4px 0',
            }}
          />
        )}
        {v === 0 && (
          <Typography
            variant="caption"
            sx={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
              color: 'text.secondary',
              fontSize: '0.65rem',
            }}
          >
            0
          </Typography>
        )}
      </Box>
      {valueDetail != null && valueDetail !== '' && (
        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem', pl: 0.25 }}>
          {valueDetail}
        </Typography>
      )}
    </Stack>
  );
}

function catchingVisible(row: FrvMockRow): boolean {
  return row.framing_runs !== 0 || row.throwing_runs !== 0 || row.blocking_runs !== 0;
}

function rowToDiamondRole(row: FrvMockRow): FrvDiamondRole | null {
  if (row.positionFilter === 'OF') return 'OF_CF';
  if (row.positionFilter === 'C') return null;
  if (isFirstBasePrimary(row)) return 'IF_1B';
  return 'IF_SS';
}

function FrvCard({ row }: { row: FrvMockRow }) {
  const isOF = row.positionFilter === 'OF';
  const isIF = row.positionFilter === 'IF';
  const isC = row.positionFilter === 'C';
  const is1B = isIF && isFirstBasePrimary(row);
  const showCatching = isC || catchingVisible(row);
  const showFieldingBlock = !isC;
  const showArmBar = isOF || (isIF && !is1B);

  const fieldingOverline = (() => {
    if (isOF) return 'Range · Arm';
    if (is1B) return 'Range · DP';
    if (isIF) return 'Range · Arm · DP';
    return '';
  })();

  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardContent sx={{ pt: 2 }}>
        <Stack spacing={1.25}>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" gap={1}>
            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                {row.playerName}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Mock Savant FRV · {row.season} · filter <code>{row.positionFilter}</code> · primary{' '}
                <strong>{row.primaryPos}</strong>
              </Typography>
            </Box>
            <Chip
              size="small"
              label={`Total ${row.total_runs > 0 ? '+' : ''}${row.total_runs} runs`}
              color={row.total_runs >= 0 ? 'default' : 'error'}
              variant="outlined"
              sx={{ fontWeight: 600 }}
            />
          </Stack>

          <Divider />

          {showFieldingBlock && (
            <>
              <Typography variant="overline" sx={{ letterSpacing: 0.08, color: 'text.secondary' }}>
                {fieldingOverline}
              </Typography>
              {isIF && !is1B && row.inf_of_runs !== 0 && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: -0.5 }}>
                  Savant <code>inf_of_runs</code> ({row.inf_of_runs > 0 ? '+' : ''}
                  {row.inf_of_runs}) on row — not a separate bar (plan §6.2).
                </Typography>
              )}
              {is1B && row.arm_runs !== 0 && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: -0.5 }}>
                  Savant <code>arm_runs</code> ({row.arm_runs > 0 ? '+' : ''}
                  {row.arm_runs}) on row — no Arm bar for 1B primary (plan §6.2).
                </Typography>
              )}
              <Stack spacing={1}>
                <FrvDivergingBar
                  label="Range"
                  value={row.range_runs}
                  hint="range_runs — OAA-derived range contribution in runs"
                />
                {showArmBar && <FrvDivergingBar label="Arm" value={row.arm_runs} hint="arm_runs" />}
                {isIF && <FrvDivergingBar label="DP" value={row.dp_runs} hint="dp_runs" />}
              </Stack>
            </>
          )}

          {showCatching && (
            <>
              <Divider sx={{ pt: showFieldingBlock ? 0.5 : 0 }} />
              <Typography variant="overline" sx={{ letterSpacing: 0.08, color: 'text.secondary' }}>
                Catching
              </Typography>
              {isC && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                  Catcher card: framing + throwing + blocking only; chip = headline total.
                </Typography>
              )}
              <Stack spacing={1}>
                <FrvDivergingBar label="Framing" value={row.framing_runs} hint="framing_runs" />
                <FrvDivergingBar label="Throwing" value={row.throwing_runs} hint="throwing_runs" />
                <FrvDivergingBar label="Blocking" value={row.blocking_runs} hint="blocking_runs" />
              </Stack>
            </>
          )}

          {!isC && !showCatching && (
            <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
              No catching breakdown (all zero).
            </Typography>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}

/**
 * Dev-only Savant FRV breakdown: **OF** (Range+Arm), **IF / SS** (Range+Arm+DP), **IF / 1B** (Range+DP), **C**
 * (catching only). **`/dev/frv-prototype`**
 */
export function FrvBreakdownPrototype() {
  return (
    <Container maxWidth={false} sx={{ py: 3, px: { xs: 2, sm: 3 } }}>
      <Button component={Link} to="/" startIcon={<ArrowBackIcon />} size="small" sx={{ mb: 2 }}>
        Back to chat
      </Button>
      <Typography variant="h5" component="h1" gutterBottom sx={{ fontWeight: 700 }}>
        FRV breakdown prototype
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Per <code>docs/SAVANT_INFIELD_OAA_AND_FRV_PLAN.md</code> §6.2: <strong>OF</strong> → Range + Arm ·{' '}
        <strong>IF (SS/2B/3B…)</strong> → Range + Arm + DP · <strong>IF (1B)</strong> → Range + DP only ·{' '}
        <strong>C</strong> → Framing + Throwing + Blocking. Diverging scale ±{BAR_MAX} runs. Mock data only.
      </Typography>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(4, 1fr)' },
          gap: 2,
          alignItems: 'stretch',
        }}
      >
        <Stack spacing={0.75}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
            OF
          </Typography>
          <FrvCard row={MOCK_CF} />
        </Stack>
        <Stack spacing={0.75}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
            IF · SS
          </Typography>
          <FrvCard row={MOCK_SS} />
        </Stack>
        <Stack spacing={0.75}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
            IF · 1B
          </Typography>
          <FrvCard row={MOCK_1B} />
        </Stack>
        <Stack spacing={0.75}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
            C
          </Typography>
          <FrvCard row={MOCK_C} />
        </Stack>
      </Box>

      <Typography variant="h6" sx={{ mt: 4, mb: 1, fontWeight: 600 }}>
        Diamond exploration (FRV)
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, maxWidth: 900 }}>
        Over <code>spray/dodger-stadium-dimensions.png</code> (100×100, same as OAA field): <strong>Range</strong> =
        circle at the fielder — <strong>small blue</strong> when runs are negative, <strong>medium grey</strong> near
        zero, <strong>large red</strong> when positive (size and hue). <strong>Arm</strong> = arrow toward{' '}
        <strong>home</strong> (OF) or <strong>1B</strong> (IF): <strong>long red</strong> when positive,{' '}
        <strong>short blue</strong> when negative, <strong>medium grey</strong> at 0. <strong>DP</strong> = badge near
        2B when non-zero (IF). Catcher row: no range/arm diamond in this pass.
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(4, 1fr)' },
          gap: 2,
          alignItems: 'flex-start',
        }}
      >
        {[MOCK_CF, MOCK_SS, MOCK_1B, MOCK_C].map((row) => {
          const dr = rowToDiamondRole(row);
          return (
            <Stack key={row.playerName} spacing={1}>
              <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                {row.primaryPos} diamond
              </Typography>
              {dr != null ? (
                <FrvDiamondViz
                  role={dr}
                  rangeRuns={row.range_runs}
                  armRuns={row.arm_runs}
                  dpRuns={row.dp_runs}
                />
              ) : (
                <Typography variant="caption" color="text.secondary">
                  No range/arm/DP diamond for primary catcher in this exploration — use the catching bars above.
                </Typography>
              )}
            </Stack>
          );
        })}
      </Box>

      <Typography variant="h6" sx={{ mt: 4, mb: 1, fontWeight: 600 }}>
        Range vs arm (split profiles)
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, maxWidth: 900 }}>
        Stress examples: <strong>R −6, Arm +5</strong> → small blue circle, long red arrow · <strong>R +6, Arm −5</strong>{' '}
        → large red circle, short blue arrow · <strong>R 0, Arm 0</strong> → medium grey circle and medium grey arrow.
        Direction is always toward <strong>home</strong> (OF) or <strong>1B</strong> (IF).
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' },
          gap: 3,
          alignItems: 'flex-start',
        }}
      >
        <Stack spacing={1.5}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
            Bad range · good arm
          </Typography>
          <Typography variant="caption" color="text.secondary">
            R −6, Arm +5 (mock).
          </Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="flex-start">
            <FrvDiamondViz role="OF_CF" rangeRuns={-6} armRuns={5} dpRuns={0} />
            <FrvDiamondViz role="IF_SS" rangeRuns={-6} armRuns={5} dpRuns={0} />
          </Stack>
        </Stack>
        <Stack spacing={1.5}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
            Neutral range · neutral arm
          </Typography>
          <Typography variant="caption" color="text.secondary">
            R 0, Arm 0 (mock).
          </Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="flex-start">
            <FrvDiamondViz role="OF_CF" rangeRuns={0} armRuns={0} dpRuns={0} />
            <FrvDiamondViz role="IF_SS" rangeRuns={0} armRuns={0} dpRuns={0} />
          </Stack>
        </Stack>
        <Stack spacing={1.5}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
            Good range · bad arm
          </Typography>
          <Typography variant="caption" color="text.secondary">
            R +6, Arm −5 (mock).
          </Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="flex-start">
            <FrvDiamondViz role="OF_CF" rangeRuns={6} armRuns={-5} dpRuns={0} />
            <FrvDiamondViz role="IF_SS" rangeRuns={6} armRuns={-5} dpRuns={0} />
          </Stack>
        </Stack>
      </Box>
    </Container>
  );
}
