/**
 * Bat-tracking mini graphics (SVG). Styling follows MUI theme (transparent cards).
 *
 * **Exports (player card tiles)** — each uses `MiniCard` unless noted:
 * - `BatSpeedGauge` — semicircle mph dial, zone fills, tick labels, league + player needles.
 * - `AttackAngleGraphic` — side view: horizontal ref, wedge, attack-angle arrow, league dashed, pivot hub.
 * - `AttackDirectionGraphic` — top-down plate + boxes, bat toward plate, ball “aim” arrow vs pull/oppo.
 * - `SwingTiltGraphic` — catcher view: stick figure, 0° plate line, bat tilt, wedge, FLAT/STEEP gutter; LHB mirrored.
 *
 * **Shared helpers**: `mphToArcUnit` / `mphToAngle` / `polar` / `sectorAnnulus` (bat speed);
 * `DirectionScaleLabels` + `normalizeStand` (attack direction + swing tilt alignment).
 */

import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { lighten, useTheme, type SxProps, type Theme } from '@mui/material/styles';

/**
 * Non-linear mph → fraction u ∈ [0,1] along semicircle (0 mph = left, 80 mph = right):
 * 0–50 → 1/8, 50–60 → 1/8, 60–70 → 1/4, 70–75 → 1/4, 75–80 → 1/4 of arc.
 */
function mphToArcUnit(mph: number): number {
  const m = Math.max(0, Math.min(80, mph));
  if (m <= 50) return (1 / 8) * (m / 50);
  if (m <= 60) return 1 / 8 + (1 / 8) * ((m - 50) / 10);
  if (m <= 70) return 1 / 4 + (1 / 4) * ((m - 60) / 10);
  if (m <= 75) return 1 / 2 + (1 / 4) * ((m - 70) / 5);
  return 3 / 4 + (1 / 4) * ((m - 75) / 5);
}

/** Angle on upper semicircle: π (0 mph) → 0 (80 mph). */
function mphToAngle(mph: number): number {
  return Math.PI * (1 - mphToArcUnit(mph));
}

/** Upper semicircle: θ from π (left) → 0 (right), y-up math with SVG y flip. */
function polar(cx: number, cy: number, r: number, rad: number): { x: number; y: number } {
  return { x: cx + r * Math.cos(rad), y: cy - r * Math.sin(rad) };
}

/**
 * Annular sector between angles t1 → t2 (t1 > t2, both on upper semicircle).
 * SVG y-down: sweep=1 traces the arc that stays on the bowl side (upper) for these endpoints;
 * sweep=0 takes the lower semicircle and causes inward “spiderweb” scallops.
 */
function sectorAnnulus(
  cx: number,
  cy: number,
  rInner: number,
  rOuter: number,
  t1: number,
  t2: number
): string {
  const o1 = polar(cx, cy, rOuter, t1);
  const o2 = polar(cx, cy, rOuter, t2);
  const i2 = polar(cx, cy, rInner, t2);
  const i1 = polar(cx, cy, rInner, t1);
  return `M ${i1.x} ${i1.y} L ${o1.x} ${o1.y} A ${rOuter} ${rOuter} 0 0 1 ${o2.x} ${o2.y} L ${i2.x} ${i2.y} A ${rInner} ${rInner} 0 0 0 ${i1.x} ${i1.y} Z`;
}

type MiniCardProps = {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Merged into the main content flex wrapper (e.g. stretch for a filling SVG column). */
  contentSx?: SxProps<Theme>;
  /** Merged into the footer Typography (e.g. tighter margin for compact cards). */
  footerSx?: SxProps<Theme>;
  /** Merged into the outer card Box (e.g. minHeight for compact tiles). */
  cardSx?: SxProps<Theme>;
  /** Merged into the title caption Typography. */
  titleSx?: SxProps<Theme>;
};

function MiniCard({ title, children, footer, contentSx, footerSx, cardSx, titleSx }: MiniCardProps) {
  return (
    <Box
      sx={{
        bgcolor: 'transparent',
        borderRadius: 1,
        px: 1,
        pt: 0.75,
        pb: 0.5,
        minHeight: 168,
        display: 'flex',
        flexDirection: 'column',
        border: '1px solid',
        borderColor: 'divider',
        ...cardSx,
      }}
    >
      {/* Tile title (caption weight) */}
      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, textAlign: 'center', mb: 0.25, ...titleSx }}>
        {title}
      </Typography>
      {/* Main graphic + headline area; override with `contentSx` per tile (e.g. stretch, no minHeight) */}
      <Box
        sx={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 118,
          ...contentSx,
        }}
      >
        {children}
      </Box>
      {/* Optional “MLB avg: …” row */}
      {footer ? (
        <Typography variant="caption" color="text.secondary" textAlign="center" sx={{ display: 'block', mt: 0.25, ...footerSx }}>
          {footer}
        </Typography>
      ) : null}
    </Box>
  );
}

/** Full 180° semicircular gauge 0–80 mph; non-linear scale; annular sectors (smooth arc). */
export function BatSpeedGauge({ mph, leagueMph }: { mph: number | null; leagueMph: number | null }) {
  const theme = useTheme();
  /** Bowl center; `rOuter`/`rInner` define the mph annulus. */
  const cx = 70;
  const cy = 82;
  const rOuter = 56;
  const rInner = 44;
  const needleMph = mph != null ? Math.max(0, Math.min(80, mph)) : null;
  const needle = needleMph != null ? mphToAngle(needleMph) : null;
  const needleEnd = needle != null ? polar(cx, cy, rInner - 4, needle) : null;

  const redLight = theme.palette.error.light;
  const zones: { lo: number; hi: number; color: string }[] = [
    { lo: 0, hi: 50, color: theme.palette.grey[600] },
    { lo: 50, hi: 60, color: theme.palette.grey[500] },
    { lo: 60, hi: 70, color: lighten(redLight, 0.22) },
    { lo: 70, hi: 75, color: redLight },
    { lo: 75, hi: 80, color: theme.palette.error.dark },
  ];

  const ticks = [0, 50, 60, 70, 75, 80];
  const leagueAng = leagueMph != null ? mphToAngle(Math.max(0, Math.min(80, leagueMph))) : null;
  const lg = leagueAng != null ? polar(cx, cy, rInner - 6, leagueAng) : null;

  const rimLo = polar(cx, cy, rOuter, Math.PI);
  const rimHi = polar(cx, cy, rOuter, 0);
  const rimPath = `M ${rimLo.x} ${rimLo.y} A ${rOuter} ${rOuter} 0 0 1 ${rimHi.x} ${rimHi.y}`;

  return (
    <MiniCard
      title="Bat Speed"
      footer={
        leagueMph != null ? (
          <>
            MLB avg:{' '}
            <Box component="span" sx={{ color: 'primary.main', fontWeight: 700 }}>
              {leagueMph} mph
            </Box>
          </>
        ) : null
      }
    >
      <Box sx={{ position: 'relative', width: 140, height: 102 }}>
        {/* Big mph readout over the gauge */}
        <Typography
          variant="h6"
          sx={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            textAlign: 'center',
            color: 'text.primary',
            fontWeight: 700,
            fontSize: '1.1rem',
          }}
        >
          {mph != null ? `${mph} mph` : '—'}
        </Typography>
        <svg viewBox="0 0 140 100" width="140" height="100" style={{ marginTop: 16 }}>
          {/* Speed zone annuli (non-linear mph bands) */}
          {zones.map((z) => {
            const t1 = mphToAngle(z.lo);
            const t2 = mphToAngle(z.hi);
            return (
              <path
                key={`${z.lo}-${z.hi}`}
                d={sectorAnnulus(cx, cy, rInner, rOuter, t1, t2)}
                fill={z.color}
                stroke="none"
              />
            );
          })}
          {/* Outer semicircle rim */}
          <path
            d={rimPath}
            fill="none"
            stroke={theme.palette.divider}
            strokeWidth={1}
            opacity={0.95}
          />
          {/* Diameter baseline (flat bottom of the “bowl”) */}
          <line
            x1={cx - rOuter}
            y1={cy}
            x2={cx + rOuter}
            y2={cy}
            stroke={theme.palette.text.disabled}
            strokeWidth={1}
            opacity={0.5}
          />
          {/* mph tick marks + numeric labels */}
          {ticks.map((t) => {
            const rad = mphToAngle(t);
            const outer = polar(cx, cy, rOuter + 2, rad);
            const inner = polar(cx, cy, rInner - 2, rad);
            const lab = polar(cx, cy, rInner - 14, rad);
            return (
              <g key={t}>
                <line
                  x1={inner.x}
                  y1={inner.y}
                  x2={outer.x}
                  y2={outer.y}
                  stroke={theme.palette.text.secondary}
                  strokeWidth={1}
                />
                <text
                  x={lab.x}
                  y={lab.y}
                  fill={theme.palette.text.secondary}
                  fontSize="9"
                  textAnchor="middle"
                  dominantBaseline="middle"
                >
                  {t}
                </text>
              </g>
            );
          })}
          {/* League average needle (dashed, shorter) */}
          {lg && (
            <line
              x1={cx}
              y1={cy}
              x2={lg.x}
              y2={lg.y}
              stroke={theme.palette.text.secondary}
              strokeWidth={1}
              strokeDasharray="4 3"
            />
          )}
          {/* Player needle (solid warning) */}
          {needleEnd && needle != null && (
            <line
              x1={cx}
              y1={cy}
              x2={needleEnd.x}
              y2={needleEnd.y}
              stroke={theme.palette.warning.main}
              strokeWidth={2.5}
              strokeLinecap="round"
            />
          )}
          {/* Pivot cap */}
          <circle cx={cx} cy={cy} r={5} fill={theme.palette.background.paper} stroke={theme.palette.divider} strokeWidth={1} />
        </svg>
      </Box>
    </MiniCard>
  );
}

/** Side view: level 0°, wedge + player arrow, dashed MLB avg. */
export function AttackAngleGraphic({
  playerDeg,
  leagueDeg,
}: {
  playerDeg: number | null;
  leagueDeg: number | null;
}) {
  const theme = useTheme();
  /** Pivot (`ox`,`oy`): horizontal ref runs left to `refX`; player + league rays use `arrowLen`. */
  const ox = 118;
  const oy = 78;
  const refLen = 100;
  const arrowLen = 100;
  const toRad = (deg: number) => ((180 - deg) * Math.PI) / 180;
  const refX = ox - refLen;
  const refY = oy;
  const hasPlayer = playerDeg != null;
  /** Only consumed when `hasPlayer`; dummy avoids trig when headline already shows "—". */
  const p = hasPlayer ? playerDeg : 0;
  const px = ox + arrowLen * Math.cos(toRad(p));
  const py = oy - arrowLen * Math.sin(toRad(p));
  const wedge = hasPlayer ? `M ${ox} ${oy} L ${refX} ${refY} L ${px} ${py} Z` : '';
  const lx = leagueDeg != null ? ox + arrowLen * Math.cos(toRad(leagueDeg)) : null;
  const ly = leagueDeg != null ? oy - arrowLen * Math.sin(toRad(leagueDeg)) : null;

  const err = theme.palette.error.main;
  const errFill = theme.palette.mode === 'dark' ? 'rgba(239,83,80,0.2)' : 'rgba(211,47,47,0.12)';

  return (
    <MiniCard
      title="Attack Angle"
      footer={
        leagueDeg != null ? (
          <>
            MLB avg:{' '}
            <Box component="span" sx={{ color: 'primary.main', fontWeight: 700 }}>
              {leagueDeg}°
            </Box>
          </>
        ) : null
      }
    >
      <Box sx={{ width: '100%', maxWidth: 168, height: 132, position: 'relative', mx: 'auto' }}>
        {/* Degree headline */}
        <Typography
          variant="h6"
          sx={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            textAlign: 'center',
            color: 'text.primary',
            fontWeight: 700,
            fontSize: '1.1rem',
          }}
        >
          {playerDeg != null ? `${playerDeg}°` : '—'}
        </Typography>
        <svg
          viewBox="0 0 140 118"
          width="100%"
          height={98}
          preserveAspectRatio="xMidYMid meet"
          style={{ marginTop: 22, display: 'block' }}
        >
          {/* Wedge between horizontal ref and player ray */}
          {hasPlayer && wedge ? <path d={wedge} fill={errFill} stroke="none" /> : null}
          {/* Level / 0° reference (left from pivot `ox,oy`) */}
          <line x1={ox} y1={oy} x2={refX} y2={refY} stroke={theme.palette.text.primary} strokeWidth={2.4} />
          {/* Player attack-angle ray */}
          {hasPlayer && <line x1={ox} y1={oy} x2={px} y2={py} stroke={err} strokeWidth={3} strokeLinecap="round" />}
          {/* League average ray */}
          {lx != null && ly != null && (
            <line
              x1={ox}
              y1={oy}
              x2={lx}
              y2={ly}
              stroke={theme.palette.text.secondary}
              strokeWidth={1.6}
              strokeDasharray="4 3"
            />
          )}
          {/* Pivot / ball contact */}
          <circle cx={ox} cy={oy} r={6} fill={theme.palette.warning.light} stroke={theme.palette.warning.dark} strokeWidth={1.2} />
        </svg>
      </Box>
    </MiniCard>
  );
}

function DirectionScaleLabels({
  highlight,
  /** RHB: pull is toward the left side of this top-down view; swap labels vs LHB. */
  swapSides,
}: {
  highlight: 'pull' | 'oppo' | 'neutral';
  swapSides?: boolean;
}) {
  const leftIsPull = Boolean(swapSides);
  const leftColor =
    leftIsPull && highlight === 'pull'
      ? 'success.main'
      : !leftIsPull && highlight === 'oppo'
        ? 'primary.main'
        : 'text.secondary';
  const rightColor =
    leftIsPull && highlight === 'oppo'
      ? 'primary.main'
      : !leftIsPull && highlight === 'pull'
        ? 'success.main'
        : 'text.secondary';
  return (
    /* Top-down pull/oppo captions; `swapSides` flips for RHB vs LHB box side. */
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'center',
        columnGap: 1.25,
        px: 0.25,
        width: '100%',
        flexShrink: 0,
        mb: 0,
      }}
    >
      <Typography variant="caption" sx={{ fontSize: '0.65rem', fontWeight: 600, color: leftColor }}>
        {leftIsPull ? '← PULL' : '← OPPO'}
      </Typography>
      <Typography variant="caption" sx={{ fontSize: '0.65rem', fontWeight: 600, color: rightColor }}>
        {leftIsPull ? 'OPPO →' : 'PULL →'}
      </Typography>
    </Box>
  );
}

/** `batterStand` from API: `"R"` / `"L"` only; anything else → `null` (defaults elsewhere). */
function normalizeStand(raw: unknown): 'R' | 'L' | null {
  if (raw == null || typeof raw !== 'string') return null;
  const u = raw.trim().toUpperCase();
  if (u === 'L' || u === 'R') return u;
  return null;
}

/**
 * Top-down attack direction (reference proportions: plate narrow vs tall boxes, gap ≈ ¼ plate width, boxes
 * ~2.2× plate width; plate vertically centered in boxes). Bat: box **midpoint** at plate **center** height,
 * length = distance from that midpoint to the **far vertical edge** of the plate; 0° parallel to the plate mouth;
 * **+° pull** tilts toward the field (−y); **−° oppo** toward the catcher (+y). Ball arrow: perpendicular to the
 * bat from where the bat crosses **plate centerline** `x = cx`.
 */
export function AttackDirectionGraphic({
  playerDeg,
  leagueDeg,
  batterStand,
}: {
  playerDeg: number | null;
  leagueDeg: number | null;
  batterStand?: unknown;
}) {
  const theme = useTheme();
  /** Clamp only when a value exists; `0` here would conflate missing with true 0°. */
  const p =
    playerDeg != null && Number.isFinite(Number(playerDeg))
      ? Math.max(-45, Math.min(45, playerDeg))
      : 0;
  /**
   * Bat direction in the top-down plane: `theta` from Statcast sign (+ = pull → −y after `yB` squash).
   * Bat segment: box midpoint `hx,hy` toward far plate edge; ball arrow perpendicular from plate centerline `cx`.
   */
  const theta = (p * Math.PI) / 180;
  const aimLen = 40;
  /** 30% vertical compression baked into Y coords (same as former `scale(1, 0.7)` about mid-bbox). */
  const yScale = 0.7;

  const highlight: 'pull' | 'oppo' | 'neutral' =
    playerDeg == null || !Number.isFinite(Number(playerDeg))
      ? 'neutral'
      : Number(playerDeg) > 0
        ? 'pull'
        : Number(playerDeg) < 0
          ? 'oppo'
          : 'neutral';

  const vbW = 108;
  /** Plate mouth centerline (vertical line through plate for ball/bat intersection math). */
  const cx = vbW / 2;
  const plateMouthHalf = 7.5;
  const gap = 3;
  const boxW = 27;
  const plateL = cx - plateMouthHalf;
  const plateR = cx + plateMouthHalf;
  /** Batter’s boxes: inner vertical edges (`boxLr`/`boxRx`) and outer (`boxLx`/`boxRr`). */
  const boxLr = cx - plateMouthHalf - gap;
  const boxLx = boxLr - boxW;
  const boxRx = cx + plateMouthHalf + gap;
  const boxRr = boxRx + boxW;

  /** Canonical Y (design space) before vertical compression. */
  const mouthY0 = 32;
  const sideY0 = 46;
  const tipY0 = 58;
  const boxH0 = 80;
  const foulDiagRun0 = 14;
  const foulDown0 = 16;
  const foulD0 = foulDiagRun0 / Math.SQRT2;
  const plateCy0 = (mouthY0 * 2 + sideY0 * 2 + tipY0) / 5;
  const boxY0 = plateCy0 - boxH0 / 2;
  const boxB0 = boxY0 + boxH0;

  const stand = normalizeStand(batterStand) ?? 'R';
  /** Bat root: midpoint of the batter’s box (R = left box, L = right box). */
  const boxMidX = stand === 'R' ? (boxLx + boxLr) / 2 : (boxRx + boxRr) / 2;
  const hx = boxMidX;
  const hy0 = plateCy0;
  const farEdgeX = stand === 'R' ? plateR : plateL;
  const lenBat = Math.abs(farEdgeX - boxMidX);
  const towardSign = stand === 'R' ? 1 : -1;
  const dirx = towardSign * Math.cos(theta);
  const diry = -Math.sin(theta);
  const by0 = hy0;
  const by1 = hy0 + lenBat * diry;
  let tOn = 0;
  if (Math.abs(dirx) > 1e-6) {
    const tLine = (cx - hx) / dirx;
    if (Number.isFinite(tLine)) tOn = Math.max(0, Math.min(lenBat, tLine));
  }
  const oy0 = hy0 + tOn * diry;
  let nx = diry;
  let ny = -dirx;
  if (ny > 0) {
    nx = -diry;
    ny = dirx;
  }
  const nLen = Math.hypot(nx, ny) || 1;
  nx /= nLen;
  ny /= nLen;
  const ay0 = oy0 + aimLen * ny;

  const bboxTop0 = Math.min(boxY0 - foulD0, mouthY0, by0, by1, oy0, ay0);
  const bboxBottom0 = Math.max(boxB0 + foulDown0, tipY0, by0, by1, oy0, ay0);
  const pivotY = (bboxTop0 + bboxBottom0) / 2;
  const yB = (y: number) => pivotY + (y - pivotY) * yScale;

  const plateMouthY = yB(mouthY0);
  const plateSideY = yB(sideY0);
  const plateTipY = yB(tipY0);
  const plate = `M ${plateL} ${plateMouthY} L ${plateR} ${plateMouthY} L ${plateR} ${plateSideY} L ${cx} ${plateTipY} L ${plateL} ${plateSideY} Z`;
  const boxH = (boxB0 - boxY0) * yScale;
  const boxY = yB(boxY0);
  const boxB = boxY + boxH;
  const foulStroke = theme.palette.divider;
  const foulOpacity = 0.95;
  const foulDownRun = foulDown0 * yScale;
  const foulDiagDx = foulD0;
  const foulDiagDy = foulD0 * yScale;
  const bx0 = hx;
  const by0d = yB(by0);
  const bx1 = hx + lenBat * dirx;
  const by1d = yB(by1);
  const ox = hx + tOn * dirx;
  const oy = yB(oy0);
  const ax = ox + aimLen * nx;
  const ay = yB(ay0);

  const bboxTop = Math.min(boxY - foulDiagDy, plateMouthY, by0d, by1d, oy, ay);
  const bboxBottom = Math.max(boxB + foulDownRun, plateTipY, by0d, by1d, oy, ay);
  const vbPad = 3;
  /** Dynamic viewBox height from ink + padding; `yMargin` shifts `<g>` so content isn’t clipped at y=0. */
  const vbH = bboxBottom - bboxTop + 2 * vbPad;
  const yMargin = vbPad - bboxTop;

  return (
    <MiniCard
      title="Attack Direction"
      cardSx={{ minHeight: 0, pt: 0.5, pb: 0.375 }}
      titleSx={{ mb: 0.125 }}
      contentSx={{ alignItems: 'stretch', justifyContent: 'flex-start', minHeight: 0, flex: '0 1 auto' }}
      footerSx={{ mt: 0 }}
      footer={
        leagueDeg != null ? (
          <>
            MLB avg:{' '}
            <Box component="span" sx={{ color: 'primary.main', fontWeight: 700 }}>
              {leagueDeg}°
            </Box>
          </>
        ) : null
      }
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', width: '100%', alignSelf: 'stretch' }}>
        {/* Pull / oppo captions (field vs catcher in this top-down convention) */}
        <DirectionScaleLabels highlight={highlight} swapSides={stand === 'R'} />
        {/* Attack direction headline ° */}
        <Typography
          variant="h6"
          sx={{
            textAlign: 'center',
            color: 'text.primary',
            fontWeight: 700,
            fontSize: '1.05rem',
            flexShrink: 0,
            lineHeight: 1.05,
            py: 0,
            mt: 0,
          }}
        >
          {playerDeg != null ? `${playerDeg}°` : '—'}
        </Typography>
        {/* Plate + bat SVG (`vbH` fits ink; inner `<g>` applies `yMargin`) */}
        <Box sx={{ width: '100%', flexShrink: 0, display: 'flex', justifyContent: 'center', mt: 0 }}>
          <svg
            viewBox={`0 0 ${vbW} ${vbH}`}
            width="100%"
            height="auto"
            preserveAspectRatio="xMidYMid meet"
            style={{ display: 'block', aspectRatio: `${vbW} / ${vbH}`, maxWidth: '100%' }}
          >
            <g transform={`translate(0, ${yMargin})`}>
              {/* Left / right batter’s boxes (filled) */}
              <rect
                x={boxLx}
                y={boxY}
                width={boxW}
                height={boxH}
                fill={theme.palette.action.hover}
                stroke={theme.palette.divider}
                strokeWidth={1}
              />
              <rect
                x={boxRx}
                y={boxY}
                width={boxW}
                height={boxH}
                fill={theme.palette.action.hover}
                stroke={theme.palette.divider}
                strokeWidth={1}
              />
              {/* Home plate polygon */}
              <path d={plate} fill={theme.palette.action.hover} stroke={theme.palette.divider} strokeWidth={1} />
              {/* Foul-territory tick marks at box corners */}
              <g fill="none" stroke={foulStroke} strokeWidth={1.15} strokeLinecap="square" opacity={foulOpacity}>
                <line x1={boxLx} y1={boxY} x2={boxLx - foulDiagDx} y2={boxY - foulDiagDy} />
                <line x1={boxRr} y1={boxY} x2={boxRr + foulDiagDx} y2={boxY - foulDiagDy} />
                <line x1={boxLr} y1={boxB} x2={boxLr} y2={boxB + foulDownRun} />
                <line x1={boxRx} y1={boxB} x2={boxRx} y2={boxB + foulDownRun} />
              </g>
              {/* Bat segment (box midpoint → far plate edge, tilted by attack direction) */}
              <line x1={bx0} y1={by0} x2={bx1} y2={by1} stroke={theme.palette.warning.light} strokeWidth={4} strokeLinecap="round" />
              {/* Ball “aim” arrow + ball (white disc at plate crossing) */}
              <line x1={ox} y1={oy} x2={ax} y2={ay} stroke={theme.palette.error.main} strokeWidth={2.4} strokeLinecap="round" />
              <circle
                cx={ox}
                cy={oy - 2}
                r={3.5}
                fill={theme.palette.common.white}
                stroke={theme.palette.divider}
                strokeWidth={1}
              />
            </g>
          </svg>
        </Box>
      </Box>
    </MiniCard>
  );
}

/**
 * Catcher-view **swing-path tilt** vs horizontal 0° at the plate (`hipY`).
 * RHB: stick + bat drawn left of center; LHB: same primitives under `translate(vbW,0) scale(-1,1)`.
 * `vbViewWidth` / `vbMinX` differ by handedness so the viewBox matches ink (see block comment on those constants).
 */
export function SwingTiltGraphic({
  tiltDeg,
  leagueDeg,
  batterStand,
}: {
  tiltDeg: number | null;
  leagueDeg: number | null;
  batterStand?: unknown;
}) {
  const theme = useTheme();
  const stand = normalizeStand(batterStand);
  const mirror = stand === 'L';
  const vbW = 120;
  const cxPlate = vbW / 2;

  // --- Stick figure: scale & batter’s box (RHB sits left of plate; LHB = mirror) ---
  const figS = 1.25;
  const boxShift = -40;

  // --- Hips / midline (hipY = 0° plate line height in this view) ---
  const hipY = 40;
  const hipX = cxPlate - 5 + boxShift;

  // --- Shoulders & hands (grip = bat handle; same y as hips here) ---
  const shoulderY = hipY - 14 * figS;
  const gripX = cxPlate + 15 + boxShift;
  const gripY = hipY + 2;

  // --- Head (centered on midline above shoulders) ---
  const headCx = hipX;
  const headCy = hipY - 24 * figS;
  const headR = 6.5 * figS;
  const neckY = headCy + headR * 0.85;

  // --- Tilt vs horizontal 0° (bat axis at hipY; +tilt = bat below horizontal in this y-down SVG) ---
  const hasTilt = tiltDeg != null;
  const t = hasTilt ? Math.max(0, Math.min(75, tiltDeg as number)) : 0;
  const rad = (-t * Math.PI) / 180;
  const len = 40;
  const bx = gripX + len * Math.cos(rad);
  const by = gripY - len * Math.sin(rad);

  /**
   * Wedge (soft orange fill): plane between **horizontal 0°** and the **bat segment** (attack / swing-path tilt).
   * Polygon: plate center on the 0° line → along 0° toward foul space → **grip** (handle) → **bat tip** → close.
   * The grip vertex keeps the shaded region hugging the bat from the hands; a direct 0°-tick→tip chord would
   * cut through the stick figure.
   */
  const wedge = hasTilt ? `M ${cxPlate + 8} ${hipY} L ${cxPlate} ${hipY} L ${gripX} ${gripY} L ${bx} ${by} Z` : '';

  const leagueRad = leagueDeg != null ? (-Math.max(0, Math.min(75, leagueDeg)) * Math.PI) / 180 : null;
  const lbx = leagueRad != null ? gripX + len * 0.88 * Math.cos(leagueRad) : null;
  const lby = leagueRad != null ? gripY - len * 0.88 * Math.sin(leagueRad) : null;

  const accent = theme.palette.warning.main;
  const accentSoft = theme.palette.mode === 'dark' ? 'rgba(255,167,38,0.22)' : 'rgba(255,152,0,0.18)';
  const fig = theme.palette.secondary.main;
  /** Grey vertical scale inside SVG (gutter side: LHB left `x≈10`, RHB right `x≈vbW-10`). */
  const axisLineX = mirror ? 10 : vbW - 10;
  /** Place the “0°” label on the open side of the plate (same convention as the FLAT/STEEP gutter). */
  const zeroLabelOnLeft = mirror;

  // --- Legs (stance width and length from hip, design units × figS) ---
  const legDown = 35;
  const legSpread = 10 * figS;
  const figFootY = hipY + legDown * figS;
  const headTop = headCy - headR;
  /**
   * `viewBox` = `${vbMinX} ${vbMinY} ${vbViewWidth} ${vbHeight}` (third arg is **width**, not max-x).
   * LHB: `vbMinX = 0` trims mirrored empty space on the drawn left; `vbViewWidth = vbW + 10` gives extra room
   * past `x = vbW` for mirrored bat/stroke. RHB: small negative min-x for the left foot; width `vbW`.
   */
  const vbMinX = mirror ? 0 : -10;
  const vbViewWidth = mirror ? vbW + 10 : vbW;
  const vbMinY = Math.min(-8, headTop - 6);
  const footPad = 6 + (2.9 * figS) / 2;
  const vbMaxY = Math.max(figFootY + footPad, 92);
  const vbHeight = vbMaxY - vbMinY;

  const stick = (
    <>
      {/* Head */}
      <circle cx={headCx} cy={headCy} r={headR} fill={fig} opacity={0.95} />

      {/* Torso — upper: neck → shoulders */}
      <line
        x1={hipX}
        y1={neckY}
        x2={hipX}
        y2={shoulderY}
        stroke={fig}
        strokeWidth={3.4 * figS}
        strokeLinecap="round"
      />
      {/* Torso — spine: shoulders → hips (midline; legs attach at hipY) */}
      <line
        x1={hipX}
        y1={shoulderY}
        x2={hipX}
        y2={hipY}
        stroke={fig}
        strokeWidth={2.6 * figS}
        strokeLinecap="round"
      />

      {/* Arm — bat side: shoulder → hands (meets bat at grip) */}
      <line
        x1={hipX}
        y1={shoulderY}
        x2={gripX}
        y2={gripY}
        stroke={fig}
        strokeWidth={2.9 * figS}
        strokeLinecap="round"
      />
      {/* Arm — trail / back: shoulder → away from plate */}
      <line
        x1={hipX}
        y1={shoulderY}
        x2={hipX + 13 * figS}
        y2={shoulderY + 7 * figS}
        stroke={fig}
        strokeWidth={2.9 * figS}
        strokeLinecap="round"
      />

      {/* Leg — side toward −x from hip */}
      <line
        x1={hipX}
        y1={hipY}
        x2={hipX - legSpread}
        y2={hipY + legDown * figS}
        stroke={fig}
        strokeWidth={2.9 * figS}
        strokeLinecap="round"
      />
      {/* Leg — side toward +x from hip */}
      <line
        x1={hipX}
        y1={hipY}
        x2={hipX + legSpread}
        y2={hipY + legDown * figS}
        stroke={fig}
        strokeWidth={2.9 * figS}
        strokeLinecap="round"
      />
    </>
  );

  const gTransform = mirror ? `translate(${vbW},0) scale(-1,1)` : undefined;

  return (
    <MiniCard
      title="Swing Tilt"
      cardSx={{ minHeight: 0, pt: 0.5, pb: 0.375 }}
      titleSx={{ mb: 0.125 }}
      contentSx={{ alignItems: 'stretch', justifyContent: 'flex-start', minHeight: 0, flex: '0 1 auto' }}
      footerSx={{ mt: 0 }}
      footer={
        leagueDeg != null ? (
          <>
            MLB avg:{' '}
            <Box component="span" sx={{ color: 'warning.main', fontWeight: 700 }}>
              {leagueDeg}°
            </Box>
          </>
        ) : null
      }
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', width: '100%', alignSelf: 'stretch' }}>
        {/* Invisible pull/oppo row: matches `AttackDirectionGraphic` height so the headline ° lines up across tiles */}
        <Box sx={{ opacity: 0, pointerEvents: 'none' }} aria-hidden>
          <DirectionScaleLabels highlight="neutral" swapSides={false} />
        </Box>
        {/* Swing tilt headline ° */}
        <Typography
          variant="h6"
          sx={{
            textAlign: 'center',
            color: 'text.primary',
            fontWeight: 700,
            fontSize: '1.05rem',
            flexShrink: 0,
            lineHeight: 1.05,
            py: 0,
            mt: 0,
          }}
        >
          {tiltDeg != null ? `${tiltDeg}°` : '—'}
        </Typography>
        {/* FLAT/STEEP gutter + chart row (`row`: LHB labels left of SVG; `row-reverse`: RHB labels right of SVG) */}
        <Box
          sx={{
            width: '100%',
            flexShrink: 0,
            display: 'flex',
            justifyContent: 'center',
            mt: 0,
            alignItems: 'stretch',
          }}
        >
          <Box
            sx={{
              display: 'flex',
              flexDirection: mirror ? 'row' : 'row-reverse',
              alignItems: 'stretch',
              gap: 0.25,
              flex: 1,
              minWidth: 0,
            }}
          >
            {/* Vertical FLAT / STEEP captions (outside SVG) */}
            <Box
              sx={{
                width: 14,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                py: 0.5,
                flexShrink: 0,
              }}
            >
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.55rem', lineHeight: 1.1, writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
                FLAT
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.55rem', lineHeight: 1.1, writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
                STEEP
              </Typography>
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <svg
                viewBox={`${vbMinX} ${vbMinY} ${vbViewWidth} ${vbHeight}`}
                width="100%"
                height="auto"
                preserveAspectRatio="xMidYMid meet"
                style={{ display: 'block', aspectRatio: `${vbViewWidth} / ${vbHeight}`, maxWidth: '100%' }}
              >
            {/* Grey vertical scale (gutter side: LHB left, RHB right) */}
            <line
              x1={axisLineX}
              y1={vbMinY + 16}
              x2={axisLineX}
              y2={vbMaxY - 8}
              stroke={theme.palette.divider}
              strokeWidth={1}
            />
            {/* Horizontal 0° = plate plane at `hipY`; segment `cxPlate ± 28`. Theme warning (orange). Outside mirror so plate stays fixed for LHB/RHB. */}
            <line
              x1={cxPlate - 28}
              y1={hipY}
              x2={cxPlate + 28}
              y2={hipY}
              stroke={accent}
              strokeWidth={1.5}
            />
            {/* “0°” on open side of plate (same side as FLAT/STEEP gutter) */}
            <text
              x={zeroLabelOnLeft ? cxPlate - 42 : cxPlate + 42}
              y={hipY + 3.5}
              fill={accent}
              fontSize="7"
              textAnchor={zeroLabelOnLeft ? 'start' : 'end'}
            >
              0°
            </text>
            {/* Wedge + stick + league + bat: mirrored for LHB (`translate(vbW,0) scale(-1,1)`). Plate / 0° stay outside. */}
            <g transform={gTransform}>
              {/* Wedge: see path doc above — fill between 0° line and bat (mirrors with batter for LHB). */}
              {hasTilt && wedge ? <path d={wedge} fill={accentSoft} stroke="none" /> : null}
              {stick}
              {/* League tilt reference (dashed) */}
              {lbx != null && lby != null && (
                <line
                  x1={gripX}
                  y1={gripY}
                  x2={lbx}
                  y2={lby}
                  stroke={theme.palette.text.secondary}
                  strokeWidth={1.2}
                  strokeDasharray="4 3"
                />
              )}
              {/* Player bat shaft */}
              {hasTilt && (
                <line x1={gripX} y1={gripY} x2={bx} y2={by} stroke={theme.palette.warning.light} strokeWidth={4} strokeLinecap="round" />
              )}
            </g>
              </svg>
            </Box>
          </Box>
        </Box>
      </Box>
    </MiniCard>
  );
}
