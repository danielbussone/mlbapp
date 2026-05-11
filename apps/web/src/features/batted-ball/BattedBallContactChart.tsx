import Box from '@mui/material/Box';
import FormControlLabel from '@mui/material/FormControlLabel';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import {
  SPEED_ANGLE_COLORS,
  speedAngleCode,
  type SpeedAngleCode,
} from '@mlbapp/shared';

import { alpha, useTheme } from '@mui/material/styles';
import { useMuiAppliedDarkMode } from '@/hooks/useMuiAppliedDarkMode.js';

import batterAsset from './batter-contact.png';
import styles from './BattedBallContactChart.module.css';

export type ContactBucketRow = {
  code: number;
  label: string;
  count: number;
  pct: number;
  /** 0–100 vs qualified MLB cohort (50+ EV+LA BBE), same season; null if not qualified / unavailable. */
  leaguePercentile: number | null;
};

export type ContactPoint = { ev: number; la: number; code: number };

export type BattedBallContactViz = {
  denominator: number;
  buckets: ContactBucketRow[];
  points: ContactPoint[];
  contactTruncated: boolean;
  /** Season average exit velocity (mph), when available. */
  avgEv: number | null;
  /** Season average launch angle (deg), when available. */
  avgLa: number | null;
};

export function parseBattedBallContactViz(bb: unknown): BattedBallContactViz | null {
  if (!bb || typeof bb !== 'object') return null;
  const o = bb as Record<string, unknown>;
  const cq = o.contact_quality;
  const pts = o.contact_points;
  if (!cq || typeof cq !== 'object' || !Array.isArray(pts)) return null;
  const denom = Number((cq as { denominator?: unknown }).denominator);
  const bucketsRaw = (cq as { buckets?: unknown }).buckets;
  if (!Number.isFinite(denom) || denom <= 0 || !Array.isArray(bucketsRaw)) return null;
  const buckets: ContactBucketRow[] = [];
  for (const row of bucketsRaw) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const lp = r.league_percentile;
    buckets.push({
      code: Number(r.code),
      label: String(r.label ?? ''),
      count: Number(r.count ?? 0),
      pct: Number(r.pct ?? 0),
      leaguePercentile:
        lp === null || lp === undefined || Number.isNaN(Number(lp)) ? null : Number(lp),
    });
  }
  const points: ContactPoint[] = [];
  for (const row of pts) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    points.push({
      ev: Number(r.ev),
      la: Number(r.la),
      code: Number(r.code),
    });
  }
  const avgEvRaw = o.avg_ev;
  const avgLaRaw = o.avg_la;
  const avgEv =
    avgEvRaw === null || avgEvRaw === undefined || Number.isNaN(Number(avgEvRaw))
      ? null
      : Number(avgEvRaw);
  const avgLa =
    avgLaRaw === null || avgLaRaw === undefined || Number.isNaN(Number(avgLaRaw))
      ? null
      : Number(avgLaRaw);

  return {
    denominator: denom,
    buckets,
    points,
    contactTruncated: Boolean(o.contact_truncated),
    avgEv,
    avgLa,
  };
}

type Props = {
  buckets: ContactBucketRow[];
  denominator: number;
  points: ContactPoint[];
  contactTruncated?: boolean;
  /** Season average EV/LA for highlighted marker; omit or null to hide. */
  avgEv?: number | null;
  avgLa?: number | null;
};

/** Finer EV/LA grid + overlapping brush squares merge into solid-looking fills (see `zoneBrushPx`). */
const LA_STEP = 1;
const EV_STEP = 1;
const LA_GRID_MIN = -82;
const LA_GRID_MAX = 82;
const EV_GRID_MIN = 12;
const EV_GRID_MAX = 120;

/** Canvas CSS width / height for layout (must match `.canvas` aspect-ratio in CSS). */
const CHART_ASPECT_W = 360;
const CHART_ASPECT_H = 360;
/** Prefer at least this CSS height so wide rails get a visibly large fan (height binds polar scale). */
const CHART_MIN_CSS_HEIGHT = 360;

/** Evenly spaced subsample for scatter (same idea as API `contact_points` cap). */
const SCATTER_SAMPLE_CAP = 200;

function ordinalPercentile(n: number): string {
  const v = Math.max(0, Math.min(100, Math.round(n)));
  const k = v % 100;
  const j = v % 10;
  if (k >= 11 && k <= 13) return `${v}th`;
  if (j === 1) return `${v}st`;
  if (j === 2) return `${v}nd`;
  if (j === 3) return `${v}rd`;
  return `${v}th`;
}

function subsampleEvenly<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const out: T[] = [];
  const n = items.length;
  for (let i = 0; i < max; i += 1) {
    const idx = Math.round((i * (n - 1)) / Math.max(max - 1, 1));
    out.push(items[idx]!);
  }
  return out;
}

/** Polar origin X (contact point = bat/ball) from canvas left edge, CSS px. Shifts fan right; space left for batter art. */
const BATT_CONTACT_X = 125;

/**
 * Bat-tip position in `batter-contact.png` (fractions of natural width/height).
 * Tune if the asset changes (contact should sit at the barrel/knob meeting the ball).
 */
const BATT_IMG_ANCHOR_X = 0.98;
const BATT_IMG_ANCHOR_Y = 0.5;

/**
 * With `cssVariables: true`, JS `theme.palette.background.paper` can stay on the default (light) palette
 * while the UI resolves `--mui-palette-background-paper` per color scheme — canvas must use computed values.
 */
function resolvedPaperBackground(panelEl: HTMLElement | null, fallback: string): string {
  if (typeof window === 'undefined' || !panelEl) return fallback;
  const bg = getComputedStyle(panelEl).backgroundColor;
  if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
  return fallback;
}

function resolvedDividerStroke(panelEl: HTMLElement | null, fallback: string): string {
  if (typeof window === 'undefined' || !panelEl) return fallback;
  const c = getComputedStyle(panelEl).borderTopColor;
  if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') return c;
  return fallback;
}

function layoutPlot(cssW: number, cssH: number) {
  const pad = { r: 8, t: 12, b: 12 };
  const ox = BATT_CONTACT_X;
  const plotH = cssH - pad.t - pad.b;
  const oy = pad.t + plotH / 2;
  const plotWRight = cssW - ox - pad.r;
  // Uniform mph→px scale: semicircle uses horizontal reach ≈120 mph and vertical span ≈240 mph at ±90° LA.
  const scale = Math.min(plotWRight / 120, plotH / 240);
  return { ox, oy, scale, plotH };
}

/** Pixel span so adjacent (ev, la) samples overlap on canvas (radial + worst tangential spacing at outer arc). */
function zoneBrushPx(scale: number, evStep: number, laStep: number): number {
  const radialPx = scale * evStep;
  const tangentialPx = scale * EV_GRID_MAX * ((laStep * Math.PI) / 180);
  return Math.max(5, radialPx * 1.25, tangentialPx * 1.2);
}

function lum(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * Keys out flat white / light anti-alias fringes from the silhouette PNG (high luma, near-neutral).
 * Canvas `filter: brightness()` was multiplying those halos on dark backgrounds — we no longer use that.
 */
function buildBatterLayerWithTransparentBackground(img: HTMLImageElement): HTMLCanvasElement | null {
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  if (nw <= 0 || nh <= 0) return null;
  const c = document.createElement('canvas');
  c.width = nw;
  c.height = nh;
  const x = c.getContext('2d', { willReadFrequently: true });
  if (!x) return null;
  x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, nw, nh);
  const data = d.data;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const minc = Math.min(r, g, b);
    const maxc = Math.max(r, g, b);
    const chroma = maxc - minc;
    const L = lum(r, g, b);

    let outA = data[i + 3];
    if (outA === 0) continue;

    // Paper-white and near-white (handles off-by-one export compression).
    if (L >= 249 || (r >= 246 && g >= 246 && b >= 246)) {
      outA = 0;
    } else if (L >= 218 && chroma <= 22) {
      // Light gray anti-alias between white bg and dark silhouette (not strong silhouette body).
      if (L >= 232) {
        outA = 0;
      } else if (L >= 218) {
        outA = Math.round(outA * Math.max(0, (232 - L) / 14));
      }
    }

    data[i + 3] = outA;
  }
  x.putImageData(d, 0, 0);
  return c;
}

function drawBatterAtContact(
  ctx: CanvasRenderingContext2D,
  src: HTMLCanvasElement,
  ox: number,
  oy: number,
  plotH: number,
  dark: boolean
) {
  const nw = src.width;
  const nh = src.height;
  if (nw <= 0 || nh <= 0) return;

  const targetH = Math.min(150, Math.max(88, plotH * 0.44));
  const drawH = targetH;
  const drawW = (nw / nh) * drawH;

  const tipX = drawW * BATT_IMG_ANCHOR_X;
  const tipY = drawH * BATT_IMG_ANCHOR_Y;
  const dx = ox - tipX;
  const dy = oy - tipY;

  ctx.save();
  // No CSS filter: `brightness()` on semi-transparent anti-alias pixels causes visible halos on dark UI.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.globalAlpha = dark ? 0.5 : 0.48;
  ctx.drawImage(src, dx, dy, drawW, drawH);
  ctx.globalAlpha = 1;
  ctx.restore();
}

function project(ev: number, laDeg: number, ox: number, oy: number, scale: number) {
  const rad = (laDeg * Math.PI) / 180;
  const x = ox + ev * Math.cos(rad) * scale;
  const y = oy - ev * Math.sin(rad) * scale;
  return { x, y };
}

function zoneFill(code: SpeedAngleCode, dark: boolean): string {
  const c = SPEED_ANGLE_COLORS[code];
  if (!dark) return `${c}f0`;
  return `${c}e5`;
}

export function BattedBallContactChart({
  buckets,
  denominator,
  points,
  contactTruncated,
  avgEv: avgEvProp,
  avgLa: avgLaProp,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const batterLayerRef = useRef<HTMLCanvasElement | null>(null);
  const [cssSize, setCssSize] = useState({ w: 340, h: CHART_MIN_CSS_HEIGHT });
  const [batterReady, setBatterReady] = useState(0);
  const [scatterSample200, setScatterSample200] = useState(true);
  const dark = useMuiAppliedDarkMode();
  const theme = useTheme();
  const paperBg = theme.palette.background.paper;

  const scatterPoints = useMemo(() => {
    if (!scatterSample200) return points;
    return subsampleEvenly(points, SCATTER_SAMPLE_CAP);
  }, [points, scatterSample200]);

  const avgEv =
    avgEvProp !== undefined && avgEvProp !== null && Number.isFinite(avgEvProp) ? avgEvProp : null;
  const avgLa =
    avgLaProp !== undefined && avgLaProp !== null && Number.isFinite(avgLaProp) ? avgLaProp : null;

  const avgMarkerPx = useMemo(() => {
    if (avgEv === null || avgLa === null) return null;
    const { w, h } = cssSize;
    const { ox, oy, scale } = layoutPlot(w, h);
    return project(avgEv, avgLa, ox, oy, scale);
  }, [cssSize, avgEv, avgLa]);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      batterLayerRef.current = buildBatterLayerWithTransparentBackground(img);
      setBatterReady((n) => n + 1);
    };
    img.src = batterAsset;
  }, []);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const applySize = (rw: number) => {
      const maxW = Math.max(240, Math.floor(rw));
      const aspect = CHART_ASPECT_W / CHART_ASPECT_H;
      let h = Math.max(CHART_MIN_CSS_HEIGHT, Math.round(maxW / aspect));
      let w = Math.round(h * aspect);
      if (w > maxW) {
        w = maxW;
        h = Math.round(maxW / aspect);
      }
      setCssSize({ w, h });
    };
    const ro = new ResizeObserver(() => {
      applySize(el.getBoundingClientRect().width);
    });
    ro.observe(el);
    applySize(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const panelEl = wrapRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { w: cssW, h: cssH } = cssSize;
    const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    const fillBg = resolvedPaperBackground(panelEl, paperBg);
    ctx.fillStyle = fillBg;
    ctx.fillRect(0, 0, cssW, cssH);

    const { ox, oy, scale, plotH } = layoutPlot(cssW, cssH);

    const batterLayer = batterLayerRef.current;
    if (batterLayer && batterLayer.width > 0) {
      drawBatterAtContact(ctx, batterLayer, ox, oy, plotH, dark);
    }

    const brush = zoneBrushPx(scale, EV_STEP, LA_STEP);
    const half = brush / 2;
    for (let la = LA_GRID_MIN; la <= LA_GRID_MAX; la += LA_STEP) {
      for (let ev = EV_GRID_MIN; ev <= EV_GRID_MAX; ev += EV_STEP) {
        const code = speedAngleCode(ev, la);
        const { x, y } = project(ev, la, ox, oy, scale);
        ctx.fillStyle = zoneFill(code, dark);
        ctx.fillRect(x - half, y - half, brush, brush);
      }
    }

    const dividerBase = resolvedDividerStroke(panelEl, theme.palette.divider);
    ctx.strokeStyle = alpha(dividerBase, dark ? 0.38 : 0.45);
    ctx.lineWidth = 1;
    for (const mph of [40, 70, 100, 120]) {
      ctx.beginPath();
      let started = false;
      for (let la = -90; la <= 90; la += 2) {
        const rad = (la * Math.PI) / 180;
        const x = ox + mph * Math.cos(rad) * scale;
        const y = oy - mph * Math.sin(rad) * scale;
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    for (const deg of [-45, 0, 45]) {
      const rad = (deg * Math.PI) / 180;
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(ox + 120 * Math.cos(rad) * scale, oy - 120 * Math.sin(rad) * scale);
      ctx.stroke();
    }

    const dotR = 2.4;
    const strokeOuter = dark ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.28)';
    for (const p of scatterPoints) {
      const pt = project(p.ev, p.la, ox, oy, scale);
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, dotR, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fill();
      ctx.strokeStyle = strokeOuter;
      ctx.lineWidth = 0.65;
      ctx.stroke();
    }

    if (avgEv !== null && avgLa !== null) {
      const apt = project(avgEv, avgLa, ox, oy, scale);
      const rRing = 6.5;
      const rCore = 3.5;
      const prim = theme.palette.primary.main;
      ctx.beginPath();
      ctx.arc(apt.x, apt.y, rRing, 0, Math.PI * 2);
      ctx.strokeStyle = prim;
      ctx.lineWidth = 2.25;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(apt.x, apt.y, rCore, 0, Math.PI * 2);
      ctx.fillStyle = alpha(prim, dark ? 0.62 : 0.42);
      ctx.fill();
      ctx.strokeStyle = dark ? 'rgba(255,255,255,0.88)' : alpha('#000000', 0.32);
      ctx.lineWidth = 0.9;
      ctx.stroke();
    }
  }, [
    avgEv,
    avgLa,
    batterReady,
    cssSize,
    dark,
    paperBg,
    scatterPoints,
    theme.palette.divider,
    theme.palette.primary.main,
  ]);

  const orderedBuckets = [...buckets].sort((a, b) => b.code - a.code);
  const hasAnyPercentile = orderedBuckets.some((b) => b.leaguePercentile != null);

  return (
    <Stack spacing={0.5} className={styles.wrap}>
      <Stack direction="row" flexWrap="wrap" alignItems="center" justifyContent="space-between" gap={1}>
        <Typography variant="caption" color="text.secondary" sx={{ flex: '1 1 200px', minWidth: 0 }}>
          Exit velocity × launch angle (Tango Tiger buckets). Based on {denominator.toLocaleString()} BBE with EV
          and LA.
          {scatterSample200 && points.length > SCATTER_SAMPLE_CAP ? (
            <> Chart dots: {SCATTER_SAMPLE_CAP.toLocaleString()} of {points.length.toLocaleString()}.</>
          ) : null}
        </Typography>
        <FormControlLabel
          sx={{ mr: 0, flexShrink: 0 }}
          control={
            <Switch
              size="small"
              checked={scatterSample200}
              onChange={(_, v) => setScatterSample200(v)}
              inputProps={{ 'aria-label': 'Limit chart to 200 BBE sample' }}
            />
          }
          label={
            <Typography variant="caption" component="span">
              200 BBE sample
            </Typography>
          }
        />
      </Stack>
      <div className={styles.plotWithLegend}>
        <div ref={wrapRef} className={`${styles.canvasWrap} ${styles.plotPanel}`}>
          <canvas ref={canvasRef} className={styles.canvas} aria-hidden />
          {avgMarkerPx != null && avgEv != null && avgLa != null ? (
            <Tooltip
              arrow
              placement="top"
              title={
                <Box component="span" sx={{ display: 'block', maxWidth: 240 }}>
                  <Typography variant="caption" component="span" display="block" fontWeight={600}>
                    Average batted ball for this hitter
                  </Typography>
                  <Typography variant="caption" component="span" display="block" sx={{ opacity: 0.92, mt: 0.35 }}>
                    {avgEv.toFixed(1)} mph EV · {avgLa.toFixed(1)}° LA
                  </Typography>
                </Box>
              }
            >
              <Box
                component="span"
                className={styles.avgMarkerHit}
                sx={{ left: avgMarkerPx.x, top: avgMarkerPx.y }}
                aria-label={`Season average batted ball: ${avgEv.toFixed(1)} mph exit velocity, ${avgLa.toFixed(
                  1,
                )} degrees launch angle`}
              />
            </Tooltip>
          ) : null}
        </div>
        <Box className={styles.legend}>
          <div className={styles.legendGrid}>
            {orderedBuckets.map((b) => (
              <div key={b.code} className={styles.legendRow}>
                <span
                  className={styles.swatch}
                  style={{
                    backgroundColor: SPEED_ANGLE_COLORS[b.code as SpeedAngleCode] ?? '#888',
                  }}
                />
                <Typography variant="caption" component="span">
                  {b.label}: {b.pct}% ({b.count})
                  <br/>
                  {b.leaguePercentile != null ? <> · {ordinalPercentile(b.leaguePercentile)} percentile</> : null}
                </Typography>
              </div>
            ))}
          </div>
        </Box>
      </div>
      {hasAnyPercentile ? (
        <Typography variant="caption" color="text.secondary" className={styles.caption}>
          League pct: qualified same-season hitters (50+ BBE with EV & LA). Better contact (barrel/solid/flare)
          ranks higher; worse outcomes (hit under/topped/weak) rank higher when the share is lower.
        </Typography>
      ) : null}
      {contactTruncated ? (
        <Typography variant="caption" color="warning.main" className={styles.caption}>
          EV/LA rows hit fetch cap; percentages reflect loaded rows only.
        </Typography>
      ) : null}
    </Stack>
  );
}
