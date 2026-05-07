/**
 * Bat-tracking mini graphics (SVG). Theme-aware via `useMuiAppliedDarkMode` + literal SVG colors (see module CSS for card chrome).
 *
 * **Exports (player card tiles)** — each uses `MiniCard` unless noted:
 * - `BatSpeedGauge` — semicircle mph dial, zone fills, tick labels, league + player needles.
 * - `AttackAngleGraphic` — side view: horizontal ref, wedge, attack-angle arrow, league dashed, pivot hub.
 * - `AttackDirectionGraphic` — top-down plate + boxes, bat toward plate, ball “aim” arrow vs pull/oppo.
 * - `SwingTiltGraphic` — catcher view: figure (`stick` | `mocap` | `silhouette`), 0° reference line, bat tilt, wedge; LHB mirrored.
 *
 * **Shared helpers**: `mphToArcUnit` / `mphToAngle` / `polar` / `sectorAnnulus` (bat speed);
 * `DirectionScaleLabels` + `normalizeStand` (attack direction + swing tilt alignment).
 */

import { useId, type CSSProperties, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { lighten, useTheme, type SxProps, type Theme } from '@mui/material/styles';
import styles from './BatPathMiniGraphics.module.css';
import swingTiltSilhouetteSrc from './assets/swing-tilt-silhouette.png';
import { useMuiAppliedDarkMode } from '@/hooks/useMuiAppliedDarkMode.js';

/** Hex/rgba only (no CSS variables) for SVG presentation attributes. */
const DIAGRAM_SVG_DARK = {
  white: '#ffffff',
  whiteMuted: 'rgba(255,255,255,0.38)',
  whiteSoft: 'rgba(255,255,255,0.28)',
  plateFill: 'rgba(255,255,255,0.09)',
  plateStroke: 'rgba(255,255,255,0.5)',
  /** Aligns with MUI dark `warning.main` / Swing Tilt 0° line. */
  warningMain: '#ffb74d',
  warningLight: '#ffcc80',
  warningDark: '#f57c00',
} as const;

const DIAGRAM_SVG_LIGHT_INK = '#212121';
const DIAGRAM_SVG_LIGHT_MUTED = '#424242';

/** Body renderer for `SwingTiltGraphic` (bat/plate geometry is shared). */
export type SwingTiltFigureVariant = 'stick' | 'mocap' | 'silhouette';

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

/** Full width at the barrel (outer half); grip half uses half this width — matches former `strokeWidth` bat lines. */
const BAT_BARREL_FULL_WIDTH = 4;

/**
 * Closed SVG path for a bat from grip `(x0,y0)` to tip `(x1,y1)`.
 * Along the shaft (grip → tip): first 1/3 constant handle width (`barrelFullWidth/2`), middle 1/3 linear taper,
 * last 1/3 constant barrel width (`barrelFullWidth`). Tip closes with a semicircle (radius = half-width at tip)
 * centered on the tip, convex outward along the shaft. Grip end adds a small knob (second subpath, same fill).
 */
function taperedBatPathD(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  barrelFullWidth: number = BAT_BARREL_FULL_WIDTH
): string {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return '';
  const vx = dx / len;
  const vy = dy / len;
  const nx = -vy;
  const ny = vx;
  const hHandle = barrelFullWidth / 4;
  const hBarrel = barrelFullWidth / 2;
  const px = (s: number) => x0 + s * dx;
  const py = (s: number) => y0 + s * dy;
  const xL0 = x0 + nx * hHandle;
  const yL0 = y0 + ny * hHandle;
  const xLa = px(1 / 3) + nx * hHandle;
  const yLa = py(1 / 3) + ny * hHandle;
  const xLb = px(2 / 3) + nx * hBarrel;
  const yLb = py(2 / 3) + ny * hBarrel;
  const xLc = x1 + nx * hBarrel;
  const yLc = y1 + ny * hBarrel;
  const xRc = x1 - nx * hBarrel;
  const yRc = y1 - ny * hBarrel;
  const xRb = px(2 / 3) - nx * hBarrel;
  const yRb = py(2 / 3) - ny * hBarrel;
  const xRa = px(1 / 3) - nx * hHandle;
  const yRa = py(1 / 3) - ny * hHandle;
  const xR0 = x0 - nx * hHandle;
  const yR0 = y0 - ny * hHandle;
  const bulgeX = x1 + vx * hBarrel;
  const bulgeY = y1 + vy * hBarrel;
  /** Outward semicircle: use the sweep opposite the inward (concave) choice from a signed-area test. */
  const signed = (xRc - xLc) * (bulgeY - yLc) - (yRc - yLc) * (bulgeX - xLc);
  const sweep: 0 | 1 = signed > 0 ? 0 : 1;
  const shaft = `M ${xL0} ${yL0} L ${xLa} ${yLa} L ${xLb} ${yLb} L ${xLc} ${yLc} A ${hBarrel} ${hBarrel} 0 0 ${sweep} ${xRc} ${yRc} L ${xRb} ${yRb} L ${xRa} ${yRa} L ${xR0} ${yR0} Z`;
  /** Slightly wider than handle half-width; center sits back along −v so it overlaps the grip cap. */
  const knobR = Math.max(1.15, barrelFullWidth * 0.36);
  const kcx = x0 - vx * knobR * 0.58;
  const kcy = y0 - vy * knobR * 0.58;
  const knob = `M ${kcx + knobR} ${kcy} A ${knobR} ${knobR} 0 1 0 ${kcx - knobR} ${kcy} A ${knobR} ${knobR} 0 1 0 ${kcx + knobR} ${kcy} Z`;
  return `${shaft} ${knob}`;
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
    <Box className={styles.miniCard} sx={cardSx}>
      {/* Tile title (caption weight) */}
      <Typography variant="caption" color="text.secondary" className={styles.miniCardTitle} sx={titleSx}>
        {title}
      </Typography>
      {/* Main graphic + headline area; override with `contentSx` per tile (e.g. stretch, no minHeight) */}
      <Box className={styles.miniCardContent} sx={contentSx}>
        {children}
      </Box>
      {/* Optional “MLB avg: …” row */}
      {footer ? (
        <Typography
          variant="caption"
          color="text.secondary"
          textAlign="center"
          className={styles.miniCardFooter}
          sx={footerSx}
        >
          {footer}
        </Typography>
      ) : null}
    </Box>
  );
}

/** Full 180° semicircular gauge 0–80 mph; non-linear scale; annular sectors (smooth arc). */
export function BatSpeedGauge({ mph, leagueMph }: { mph: number | null; leagueMph: number | null }) {
  const theme = useTheme();
  const isDark = useMuiAppliedDarkMode();
  /** Bowl center; `rOuter`/`rInner` define the mph annulus. */
  const cx = 70;
  const cy = 82;
  const rOuter = 56;
  const rInner = 44;
  const needleMph = mph != null ? Math.max(0, Math.min(80, mph)) : null;
  const needle = needleMph != null ? mphToAngle(needleMph) : null;
  const needleEnd = needle != null ? polar(cx, cy, rInner - 4, needle) : null;

  const redLight = theme.palette.error.light;
  /** Dark: lift grey bands so white/light ink reads; light: original mid-greys + heat. */
  const zones: { lo: number; hi: number; color: string }[] = isDark
    ? [
        { lo: 0, hi: 50, color: theme.palette.grey[800] },
        { lo: 50, hi: 60, color: theme.palette.grey[700] },
        { lo: 60, hi: 70, color: lighten(redLight, 0.08) },
        { lo: 70, hi: 75, color: redLight },
        { lo: 75, hi: 80, color: theme.palette.error.dark },
      ]
    : [
        { lo: 0, hi: 50, color: theme.palette.grey[600] },
        { lo: 50, hi: 60, color: theme.palette.grey[500] },
        { lo: 60, hi: 70, color: lighten(redLight, 0.22) },
        { lo: 70, hi: 75, color: redLight },
        { lo: 75, hi: 80, color: theme.palette.error.dark },
      ];

  /** Literals only — `theme.palette.grey[*]` is often `var(--mui-palette-*)` and is ignored by SVG. */
  const gaugeMarkColor = isDark ? DIAGRAM_SVG_DARK.white : DIAGRAM_SVG_LIGHT_INK;
  const gaugeLeagueDash = isDark ? DIAGRAM_SVG_DARK.white : DIAGRAM_SVG_LIGHT_MUTED;
  const gaugeRimStroke = isDark ? DIAGRAM_SVG_DARK.whiteMuted : theme.palette.divider;
  const gaugeBaseLine = isDark ? DIAGRAM_SVG_DARK.whiteSoft : theme.palette.text.disabled;

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
            <Box component="span" className={styles.empPrimary}>
              {leagueMph} mph
            </Box>
          </>
        ) : null
      }
    >
      <Box className={styles.gaugeSvgWrap}>
        {/* Big mph readout over the gauge */}
        <Typography variant="h6" className={styles.gaugeOverlayTitle} sx={{ color: 'text.primary' }}>
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
            stroke={gaugeRimStroke}
            strokeWidth={1}
            opacity={0.95}
          />
          {/* Diameter baseline (flat bottom of the “bowl”) */}
          <line
            x1={cx - rOuter}
            y1={cy}
            x2={cx + rOuter}
            y2={cy}
            stroke={gaugeBaseLine}
            strokeWidth={1}
            opacity={isDark ? 0.85 : 0.5}
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
                  stroke={gaugeMarkColor}
                  strokeWidth={1}
                />
                <text
                  x={lab.x}
                  y={lab.y}
                  fill={gaugeMarkColor}
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
              stroke={gaugeLeagueDash}
              strokeWidth={isDark ? 1.35 : 1}
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
              stroke={isDark ? DIAGRAM_SVG_DARK.warningMain : theme.palette.warning.main}
              strokeWidth={2.5}
              strokeLinecap="round"
            />
          )}
          {/* Pivot cap */}
          <circle cx={cx} cy={cy} r={5} fill={theme.palette.background.paper} stroke={gaugeRimStroke} strokeWidth={1} />
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
  const isDark = useMuiAppliedDarkMode();
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
  const errFill = isDark ? 'rgba(239,83,80,0.2)' : 'rgba(211,47,47,0.12)';
  /** Match Swing Tilt 0° — SVG literals in dark mode (palette tokens are often CSS vars). */
  const refStroke = isDark ? DIAGRAM_SVG_DARK.warningMain : DIAGRAM_SVG_LIGHT_INK;
  const leagueStroke = isDark ? DIAGRAM_SVG_DARK.white : DIAGRAM_SVG_LIGHT_MUTED;

  return (
    <MiniCard
      title="Attack Angle"
      footer={
        leagueDeg != null ? (
          <>
            MLB avg:{' '}
            <Box component="span" className={styles.empPrimary}>
              {leagueDeg}°
            </Box>
          </>
        ) : null
      }
    >
      <Box className={styles.attackPlateBox}>
        {/* Degree headline */}
        <Typography variant="h6" className={styles.gaugeOverlayTitle} sx={{ color: 'text.primary' }}>
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
          {/* Level / 0° reference (left from pivot `ox,oy`) — gold in dark mode like Swing Tilt */}
          <line
            x1={ox}
            y1={oy}
            x2={refX}
            y2={refY}
            stroke={refStroke}
            strokeWidth={isDark ? 1.5 : 2.4}
          />
          {/* Player attack-angle ray */}
          {hasPlayer && <line x1={ox} y1={oy} x2={px} y2={py} stroke={err} strokeWidth={3} strokeLinecap="round" />}
          {/* League average ray */}
          {lx != null && ly != null && (
            <line
              x1={ox}
              y1={oy}
              x2={lx}
              y2={ly}
              stroke={leagueStroke}
              strokeWidth={isDark ? 1.85 : 1.6}
              strokeDasharray="4 3"
            />
          )}
          {/* Pivot / ball contact */}
          <circle
            cx={ox}
            cy={oy}
            r={6}
            fill={isDark ? DIAGRAM_SVG_DARK.warningLight : theme.palette.warning.light}
            stroke={isDark ? DIAGRAM_SVG_DARK.warningDark : theme.palette.warning.dark}
            strokeWidth={1.2}
          />
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
    <Box className={styles.pullOppoRow}>
      <Typography variant="caption" className={styles.scaleCaption} sx={{ color: leftColor }}>
        {leftIsPull ? '← PULL' : '← OPPO'}
      </Typography>
      <Typography variant="caption" className={styles.scaleCaption} sx={{ color: rightColor }}>
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
 * Axis-aligned rect in silhouette `<image>` objectBoundingBox (0–1) that covers the stat bat segment (grip→tip),
 * so erasing the raster bat overlaps where the orange overlay draws. Padding widens the crop perpendicular to the thin barrel.
 */
function silhouetteRasterBatMaskRect(
  sil: { silW: number; silH: number; silX: number; silY: number },
  gripX: number,
  gripY: number,
  bx: number,
  by: number,
  /** From Statcast `stand`: **LHB → +5 px**, **RHB (or unknown) → −5 px** in this grip→bitmap‑U mapping. */
  batterStand: 'R' | 'L' | null,
  padU = 0.1,
  padV = 0.1
): { x: number; y: number; w: number; h: number } {
  void batterStand;
  const { silW, silH, silX, silY } = sil;
  const uAdjPx = -5;
  /** Local image coords: `<image>` uses flip `translate(silX+silW,silY) scale(-1,1)`. */
  const ug = (silX + silW - gripX + uAdjPx) / silW;
  const vg = (gripY - silY) / silH;
  const ut = (silX + silW - bx + uAdjPx) / silW;
  const vt = (by - silY) / silH;

  let u0 = Math.min(ug, ut) - padU;
  let u1 = Math.max(ug, ut) + padU;
  let v0 = Math.min(vg, vt) - padV;
  let v1 = Math.max(vg, vt) + padV;

  const minSpan = 0.16;
  if (u1 - u0 < minSpan) {
    const m = (u0 + u1) / 2;
    u0 = m - minSpan / 2;
    u1 = m + minSpan / 2;
  }
  if (v1 - v0 < minSpan) {
    const m = (v0 + v1) / 2;
    v0 = m - minSpan / 2;
    v1 = m + minSpan / 2;
  }

  u0 = Math.max(0, u0);
  u1 = Math.min(1, u1);
  v0 = Math.max(0, v0);
  v1 = Math.min(1, v1);

  return {
    x: u0,
    y: v0,
    w: Math.max(1e-6, u1 - u0),
    h: Math.max(1e-6, v1 - v0),
  };
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
  const isDark = useMuiAppliedDarkMode();
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
  /** SVG literals in dark mode — `alpha(theme.palette.common.white, …)` becomes invalid `var()` in attributes. */
  const geomFill = isDark ? DIAGRAM_SVG_DARK.plateFill : theme.palette.action.hover;
  const geomStroke = isDark ? DIAGRAM_SVG_DARK.plateStroke : theme.palette.divider;
  const foulStroke = geomStroke;
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
            <Box component="span" className={styles.empPrimary}>
              {leagueDeg}°
            </Box>
          </>
        ) : null
      }
    >
      <Box className={styles.columnStretch}>
        {/* Pull / oppo captions (field vs catcher in this top-down convention) */}
        <DirectionScaleLabels highlight={highlight} swapSides={stand === 'R'} />
        {/* Attack direction headline ° */}
        <Typography variant="h6" className={styles.attackDegHeadline} sx={{ color: 'text.primary' }}>
          {playerDeg != null ? `${playerDeg}°` : '—'}
        </Typography>
        {/* Plate + bat SVG (`vbH` fits ink; inner `<g>` applies `yMargin`) */}
        <Box className={styles.scaleFooter}>
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
                fill={geomFill}
                stroke={geomStroke}
                strokeWidth={isDark ? 1.25 : 1}
              />
              <rect
                x={boxRx}
                y={boxY}
                width={boxW}
                height={boxH}
                fill={geomFill}
                stroke={geomStroke}
                strokeWidth={isDark ? 1.25 : 1}
              />
              {/* Home plate polygon */}
              <path d={plate} fill={geomFill} stroke={geomStroke} strokeWidth={isDark ? 1.25 : 1} />
              {/* Foul-territory tick marks at box corners */}
              <g fill="none" stroke={foulStroke} strokeWidth={1.15} strokeLinecap="square" opacity={foulOpacity}>
                <line x1={boxLx} y1={boxY} x2={boxLx - foulDiagDx} y2={boxY - foulDiagDy} />
                <line x1={boxRr} y1={boxY} x2={boxRr + foulDiagDx} y2={boxY - foulDiagDy} />
                <line x1={boxLr} y1={boxB} x2={boxLr} y2={boxB + foulDownRun} />
                <line x1={boxRx} y1={boxB} x2={boxRx} y2={boxB + foulDownRun} />
              </g>
              {/* Bat: tapered shaft (grip at box midpoint → barrel toward plate) */}
              <path
                d={taperedBatPathD(bx0, by0d, bx1, by1d)}
                fill={isDark ? DIAGRAM_SVG_DARK.warningLight : theme.palette.warning.light}
                stroke="none"
              />
              {/* Ball “aim” arrow + ball (white disc at plate crossing) */}
              <line x1={ox} y1={oy} x2={ax} y2={ay} stroke={theme.palette.error.main} strokeWidth={2.4} strokeLinecap="round" />
              <circle
                cx={ox}
                cy={oy - 2}
                r={3.5}
                fill={isDark ? DIAGRAM_SVG_DARK.white : theme.palette.common.white}
                stroke={geomStroke}
                strokeWidth={1}
              />
            </g>
          </svg>
        </Box>
      </Box>
    </MiniCard>
  );
}

type SwingTiltLayout = {
  figS: number;
  hipY: number;
  hipX: number;
  shoulderY: number;
  gripX: number;
  gripY: number;
  headCx: number;
  headCy: number;
  headR: number;
  neckY: number;
  legDown: number;
  legSpread: number;
  vbMinY: number;
  vbMaxY: number;
  /** Precomputed image bounds when drawing the silhouette (bat grip uses hand anchor on this box). */
  silhouetteBox?: { silW: number; silH: number; silX: number; silY: number };
};

function swingTiltFigureContent(
  variant: SwingTiltFigureVariant,
  L: SwingTiltLayout,
  fig: string,
  jointFill: string,
  jointStroke: string,
  /** SVG mask id — hides baked-in bat on silhouette raster so only the vector overlay shows the bat. */
  silhouetteBatMaskId?: string,
  /** Dark mode: e.g. `mixBlendMode` to remove residual light fringe on the raster. */
  silhouetteImageStyle?: CSSProperties
): ReactNode {
  const { figS, hipY, hipX, shoulderY, gripX, gripY, headCx, headCy, headR, neckY, legDown, legSpread } = L;
  const stroke = 2.8 * figS;
  const strokeTorso = 2.5 * figS;
  const jointR = 2.35 * figS;

  const joint = (cx: number, cy: number, k: string) => (
    <circle key={k} cx={cx} cy={cy} r={jointR} fill={jointFill} stroke={jointStroke} strokeWidth={0.9} />
  );

  // Mocap-style: bent trail arm, bat arm with elbow; knees; white joint markers (Savant-style).
  const batElbowX = hipX + 6.5 * figS;
  const batElbowY = shoulderY + 10.5 * figS;
  const trailElbowX = hipX + 16 * figS;
  const trailElbowY = shoulderY + 4.5 * figS;
  const trailHandX = hipX + 13 * figS;
  const trailHandY = shoulderY + 7 * figS;
  const kneeLX = hipX - legSpread * 0.52;
  const kneeLY = hipY + legDown * 0.5 * figS;
  const kneeRX = hipX + legSpread * 0.52;
  const kneeRY = kneeLY;
  const ankleLX = hipX - legSpread;
  const ankleLY = hipY + legDown * figS;
  const ankleRX = hipX + legSpread;
  const ankleRY = ankleLY;

  if (variant === 'silhouette') {
    const box = L.silhouetteBox;
    if (!box) return null;
    const { silW, silH, silX, silY } = box;
    const maskRef = silhouetteBatMaskId ? `url(#${silhouetteBatMaskId})` : undefined;
    /** Asset faces the opposite way from stick/mocap; flip in local space so RHB matches vector figures (LHB still uses parent mirror). */
    return (
      <g transform={`translate(${silX + silW}, ${silY}) scale(-1, 1)`}>
        <image
          href={swingTiltSilhouetteSrc}
          x={0}
          y={0}
          width={silW}
          height={silH}
          preserveAspectRatio="xMaxYMid slice"
          opacity={0.92}
          mask={maskRef}
          style={silhouetteImageStyle}
        />
      </g>
    );
  }

  if (variant === 'mocap') {
    return (
      <>
        {/* Head */}
        <circle cx={headCx} cy={headCy} r={headR} fill={fig} opacity={0.95} />
        {joint(headCx, headCy, 'j-head')}
        {/* Neck → shoulders hub */}
        <line
          x1={hipX}
          y1={neckY}
          x2={hipX}
          y2={shoulderY}
          stroke={fig}
          strokeWidth={3.2 * figS}
          strokeLinecap="round"
        />
        {/* Spine */}
        <line
          x1={hipX}
          y1={shoulderY}
          x2={hipX}
          y2={hipY}
          stroke={fig}
          strokeWidth={strokeTorso}
          strokeLinecap="round"
        />
        {joint(hipX, shoulderY, 'j-shoulder')}
        {joint(hipX, hipY, 'j-hip')}
        {/* Bat-side arm */}
        <polyline
          points={`${hipX},${shoulderY} ${batElbowX},${batElbowY} ${gripX},${gripY}`}
          fill="none"
          stroke={fig}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {joint(batElbowX, batElbowY, 'j-ebat')}
        {joint(gripX, gripY, 'j-grip')}
        {/* Trail arm */}
        <polyline
          points={`${hipX},${shoulderY} ${trailElbowX},${trailElbowY} ${trailHandX},${trailHandY}`}
          fill="none"
          stroke={fig}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {joint(trailElbowX, trailElbowY, 'j-et')}
        {joint(trailHandX, trailHandY, 'j-handt')}
        {/* Legs */}
        <polyline
          points={`${hipX},${hipY} ${kneeLX},${kneeLY} ${ankleLX},${ankleLY}`}
          fill="none"
          stroke={fig}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <polyline
          points={`${hipX},${hipY} ${kneeRX},${kneeRY} ${ankleRX},${ankleRY}`}
          fill="none"
          stroke={fig}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {joint(kneeLX, kneeLY, 'j-knL')}
        {joint(kneeRX, kneeRY, 'j-knR')}
        {joint(ankleLX, ankleLY, 'j-aL')}
        {joint(ankleRX, ankleRY, 'j-aR')}
      </>
    );
  }

  // `stick` — original simple figure
  return (
    <>
      <circle cx={headCx} cy={headCy} r={headR} fill={fig} opacity={0.95} />
      <line
        x1={hipX}
        y1={neckY}
        x2={hipX}
        y2={shoulderY}
        stroke={fig}
        strokeWidth={3.4 * figS}
        strokeLinecap="round"
      />
      <line
        x1={hipX}
        y1={shoulderY}
        x2={hipX}
        y2={hipY}
        stroke={fig}
        strokeWidth={2.6 * figS}
        strokeLinecap="round"
      />
      <line
        x1={hipX}
        y1={shoulderY}
        x2={gripX}
        y2={gripY}
        stroke={fig}
        strokeWidth={2.9 * figS}
        strokeLinecap="round"
      />
      <line
        x1={hipX}
        y1={shoulderY}
        x2={hipX + 13 * figS}
        y2={shoulderY + 7 * figS}
        stroke={fig}
        strokeWidth={2.9 * figS}
        strokeLinecap="round"
      />
      <line
        x1={hipX}
        y1={hipY}
        x2={hipX - legSpread}
        y2={hipY + legDown * figS}
        stroke={fig}
        strokeWidth={2.9 * figS}
        strokeLinecap="round"
      />
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
}

/**
 * Catcher-view **swing-path tilt** vs horizontal 0° at the plate (`plate0LineY`, slightly above hip line).
 * RHB: figure + bat drawn left of center; LHB: same primitives under `translate(vbW,0) scale(-1,1)`.
 * `vbViewWidth` / `vbMinX` differ by handedness so the viewBox matches ink (see block comment on those constants).
 */
export function SwingTiltGraphic({
  tiltDeg,
  leagueDeg,
  batterStand,
  figureVariant = 'stick',
  cardTitle = 'Swing Tilt',
}: {
  tiltDeg: number | null;
  leagueDeg: number | null;
  batterStand?: unknown;
  /** `mocap` — joints + segmented limbs; `silhouette` — contact pose from bundled dual-silhouette art (right figure). */
  figureVariant?: SwingTiltFigureVariant;
  /** Tile caption (default `Swing Tilt`; set per variant on prototype pages). */
  cardTitle?: string;
}) {
  const theme = useTheme();
  /** Stable id for SVG mask (must not contain `:` from `useId`). */
  const silhouetteBatMaskDomId = `swbat-${useId().replace(/:/g, '')}`;
  const stand = normalizeStand(batterStand);
  const mirror = stand === 'L';
  const vbW = 120;
  const cxPlate = vbW / 2;

  // --- Stick figure: scale & batter’s box (RHB sits left of plate; LHB = mirror) ---
  const figS = 1.25;
  const boxShift = -40;

  // --- Hips / midline (`hipY` = stance); orange 0° reference sits slightly above hips for clearer read vs legs ---
  const hipY = 40;
  const plate0LineY = hipY - 3;
  const hipX = cxPlate - 5 + boxShift;

  // --- Shoulders & hands (vector figures: grip = bat handle at hips; silhouette overrides to bitmap hands) ---
  const shoulderY = hipY - 14 * figS;
  const baseGripX = cxPlate + 15 + boxShift;
  const baseGripY = hipY + 2;

  // --- Head (centered on midline above shoulders) ---
  const headCx = hipX;
  const headCy = hipY - 24 * figS;
  const headR = 6.5 * figS;
  const neckY = headCy + headR * 0.85;

  const isDark = useMuiAppliedDarkMode();
  const accent = isDark ? DIAGRAM_SVG_DARK.warningMain : theme.palette.warning.main;
  const accentSoft = isDark ? 'rgba(255,167,38,0.22)' : 'rgba(255,152,0,0.18)';
  const fig = theme.palette.secondary.main;
  const jointFill = isDark ? DIAGRAM_SVG_DARK.white : theme.palette.common.white;
  const jointStroke = isDark ? 'rgba(255,255,255,0.38)' : 'rgba(0,0,0,0.18)';
  const leagueTiltStroke = isDark ? DIAGRAM_SVG_DARK.white : theme.palette.text.secondary;
  const axisGutterStroke = isDark ? DIAGRAM_SVG_DARK.whiteMuted : theme.palette.divider;
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

  /**
   * Silhouette: `xMaxYMid slice` shows the contact figure; horizontal flip aligns with RHB/LHB mirror.
   * Hand anchor = bitmap coords from top-left of the image viewport (post-slice): move bat hinge to hands, not hips.
   * (If `SIL_HAND_FROM_TOP` equals `SIL_IMAGE_ALIGN_Y`, then gripY === baseGripY — i.e. waist — so keep them distinct.)
   */
  const SIL_W = 54;
  /** ~horizontal center of the contact figure in the sliced viewport (smaller → bat grip further toward +x). */
  const SIL_HAND_FROM_LEFT = 0.3;
  /** Hands sit above the hips on the contact pose; ~upper chest / lead shoulder height in the crop. */
  const SIL_HAND_FROM_TOP = 0.29;
  /** Places the sprite vertically vs `baseGripY`; tuned with hand row so feet stay in frame. */
  const SIL_IMAGE_ALIGN_Y = 0.41;
  /** Push grip + bat shaft slightly downward (SVG user units; scales with tile size). */
  const SIL_BAT_GRIP_Y_DOWN = 7;

  let silhouetteBox: SwingTiltLayout['silhouetteBox'];
  let gripX = baseGripX;
  let gripY = baseGripY;
  if (figureVariant === 'silhouette') {
    const silH = Math.max(52, vbMaxY - vbMinY - 6);
    const silX = baseGripX - SIL_W * 0.58;
    const silY = baseGripY - silH * SIL_IMAGE_ALIGN_Y;
    silhouetteBox = { silW: SIL_W, silH, silX, silY };
    gripX = silX + SIL_W * (1 - SIL_HAND_FROM_LEFT);
    gripY = silY + SIL_HAND_FROM_TOP * silH + SIL_BAT_GRIP_Y_DOWN;
  }

  // --- Tilt vs horizontal 0° at `plate0LineY` (+tilt = bat below horizontal in this y-down SVG) ---
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
  const wedge = hasTilt
    ? `M ${cxPlate + 15} ${plate0LineY} L ${cxPlate} ${plate0LineY} L ${gripX} ${gripY} L ${bx} ${by} Z`
    : '';

  const leagueRad = leagueDeg != null ? (-Math.max(0, Math.min(75, leagueDeg)) * Math.PI) / 180 : null;
  const lbx = leagueRad != null ? gripX + len * 0.88 * Math.cos(leagueRad) : null;
  const lby = leagueRad != null ? gripY - len * 0.88 * Math.sin(leagueRad) : null;

  const silRasterBatMaskRect =
    figureVariant === 'silhouette' && silhouetteBox
      ? silhouetteRasterBatMaskRect(silhouetteBox, gripX, gripY, bx, by, stand)
      : null;

  const layout: SwingTiltLayout = {
    figS,
    hipY,
    hipX,
    shoulderY,
    gripX,
    gripY,
    headCx,
    headCy,
    headR,
    neckY,
    legDown,
    legSpread,
    vbMinY,
    vbMaxY,
    silhouetteBox,
  };

  const silhouetteImageStyle: CSSProperties | undefined =
    figureVariant === 'silhouette' && isDark ? { mixBlendMode: 'multiply' } : undefined;

  const figureBody = swingTiltFigureContent(
    figureVariant,
    layout,
    fig,
    jointFill,
    jointStroke,
    figureVariant === 'silhouette' ? silhouetteBatMaskDomId : undefined,
    silhouetteImageStyle
  );

  const gTransform = mirror ? `translate(${vbW},0) scale(-1,1)` : undefined;

  return (
    <MiniCard
      title={cardTitle}
      cardSx={{ minHeight: 0, pt: 0.5, pb: 0.375 }}
      titleSx={{ mb: 0.125 }}
      contentSx={{ alignItems: 'stretch', justifyContent: 'flex-start', minHeight: 0, flex: '0 1 auto' }}
      footerSx={{ mt: 0 }}
      footer={
        leagueDeg != null ? (
          <>
            MLB avg:{' '}
            <Box component="span" className={styles.empPrimary}>
              {leagueDeg}°
            </Box>
          </>
        ) : null
      }
    >
      <Box className={styles.columnStretch}>
        {/* Invisible pull/oppo row: matches `AttackDirectionGraphic` height so the headline ° lines up across tiles */}
        <Box className={styles.measureHidden} aria-hidden>
          <DirectionScaleLabels highlight="neutral" swapSides={false} />
        </Box>
        {/* Swing tilt headline ° */}
        <Typography variant="h6" className={styles.attackDegHeadline} sx={{ color: 'text.primary' }}>
          {tiltDeg != null ? `${tiltDeg}°` : '—'}
        </Typography>
        {/* FLAT/STEEP gutter + chart row (`row`: LHB labels left of SVG; `row-reverse`: RHB labels right of SVG) */}
        <Box className={styles.swingTiltChartRow}>
          <Box
            className={styles.swingTiltInnerRow}
            sx={{ flexDirection: mirror ? 'row' : 'row-reverse' }}
          >
            {/* Vertical FLAT / STEEP captions (outside SVG) */}
            <Box className={styles.swingTiltLabelCol}>
              <Typography variant="caption" color="text.secondary" className={styles.swingTiltCaption}>
                FLAT
              </Typography>
              <Typography variant="caption" color="text.secondary" className={styles.swingTiltCaption}>
                STEEP
              </Typography>
            </Box>
            <Box className={styles.swingTiltRail}>
              <svg
                viewBox={`${vbMinX} ${vbMinY} ${vbViewWidth} ${vbHeight}`}
                width="100%"
                height="auto"
                preserveAspectRatio="xMidYMid meet"
                style={{ display: 'block', aspectRatio: `${vbViewWidth} / ${vbHeight}`, maxWidth: '100%' }}
              >
            {figureVariant === 'silhouette' && silRasterBatMaskRect ? (
              <defs>
                <mask
                  id={silhouetteBatMaskDomId}
                  maskUnits="objectBoundingBox"
                  maskContentUnits="objectBoundingBox"
                >
                  <rect width="1" height="1" fill="white" />
                  <rect
                    x={silRasterBatMaskRect.x}
                    y={silRasterBatMaskRect.y}
                    width={silRasterBatMaskRect.w}
                    height={silRasterBatMaskRect.h}
                    fill="black"
                  />
                </mask>
              </defs>
            ) : null}
            {/* Grey vertical scale (gutter side: LHB left, RHB right) */}
            <line
              x1={axisLineX}
              y1={vbMinY + 16}
              x2={axisLineX}
              y2={vbMaxY - 8}
              stroke={axisGutterStroke}
              strokeWidth={1}
            />
            {/* Horizontal 0° reference (`plate0LineY`); segment `cxPlate ± 28`. Theme warning (orange). Outside mirror so plate stays fixed for LHB/RHB. */}
            <line
              x1={cxPlate - 28}
              y1={plate0LineY}
              x2={cxPlate + 28}
              y2={plate0LineY}
              stroke={accent}
              strokeWidth={1.5}
            />
            {/* “0°” on open side of plate (same side as FLAT/STEEP gutter) */}
            <text
              x={zeroLabelOnLeft ? cxPlate - 42 : cxPlate + 42}
              y={plate0LineY + 3.5}
              fill={accent}
              fontSize="7"
              textAnchor={zeroLabelOnLeft ? 'start' : 'end'}
            >
              0°
            </text>
            {/* Wedge + figure + league + bat: mirrored for LHB (`translate(vbW,0) scale(-1,1)`). Plate / 0° stay outside. */}
            <g transform={gTransform}>
              {/* Wedge: see path doc above — fill between 0° line and bat (mirrors with batter for LHB). */}
              {hasTilt && wedge ? <path d={wedge} fill={accentSoft} stroke="none" /> : null}
              {figureBody}
              {/* League tilt reference (dashed) */}
              {lbx != null && lby != null && (
                <line
                  x1={gripX}
                  y1={gripY}
                  x2={lbx}
                  y2={lby}
                  stroke={leagueTiltStroke}
                  strokeWidth={isDark ? 1.45 : 1.2}
                  strokeDasharray="4 3"
                />
              )}
              {/* Player bat (tapered: thin handle at grip, full width at barrel) */}
              {hasTilt && (
                <path
                  d={taperedBatPathD(gripX, gripY, bx, by)}
                  fill={isDark ? DIAGRAM_SVG_DARK.warningLight : theme.palette.warning.light}
                  stroke="none"
                />
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
