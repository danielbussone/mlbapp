import { INFIELD_100, secondBasemanFieldPosition, ssFieldPosition } from './infieldFieldGeometry.js';

type Props = {
  /** `frvIf`: white dots on 1B / 2B / 3B bags only. `oaaIf`: SS & 2B shaded holes + bags + micro labels (after pie). */
  variant: 'oaaIf' | 'frvIf';
  /** Unique suffix for gradient ids (pass `useId().replace(/:/g, '')` from parent). */
  uid: string;
};

const BAG_R = 1.85;
const BAG_STROKE = 'rgba(0,0,0,0.48)';

function bagDots() {
  const { firstBag, secondBag, thirdBag } = INFIELD_100;
  return (
    <g pointerEvents="none">
      <circle cx={firstBag.x} cy={firstBag.y} r={BAG_R} fill="#fafafa" stroke={BAG_STROKE} strokeWidth={0.35} />
      <circle cx={thirdBag.x} cy={thirdBag.y} r={BAG_R} fill="#fafafa" stroke={BAG_STROKE} strokeWidth={0.35} />
      <circle cx={secondBag.x} cy={secondBag.y} r={BAG_R} fill="#fafafa" stroke={BAG_STROKE} strokeWidth={0.35} />
    </g>
  );
}

function microLabel(x: number, y: number, text: string) {
  return (
    <text
      x={x}
      y={y}
      textAnchor="middle"
      fontSize={3.4}
      fontWeight={700}
      fill="#fafafa"
      stroke="#1a1a1a"
      strokeWidth={0.2}
      paintOrder="stroke fill"
      fontFamily="system-ui, sans-serif"
      style={{ userSelect: 'none' }}
    >
      {text}
    </text>
  );
}

/**
 * **1B / 2B / 3B** on the bags; **SS** between 2B–3B and **2B (fielder)** between 2B–1B, each shaded toward the 2B bag.
 */
export function InfieldPositionReferenceSvg({ variant, uid }: Props) {
  const gid = `infref-${uid}`;
  const { firstBag, secondBag, thirdBag } = INFIELD_100;

  if (variant === 'frvIf') {
    return <g aria-hidden>{bagDots()}</g>;
  }

  return (
    <g aria-hidden>
      <defs>
        <linearGradient
          id={`${gid}-ss`}
          gradientUnits="userSpaceOnUse"
          x1={ssFieldPosition.x}
          y1={ssFieldPosition.y}
          x2={secondBag.x}
          y2={secondBag.y}
        >
          <stop offset="0%" stopColor="rgb(45, 120, 90)" stopOpacity={0.14} />
          <stop offset="100%" stopColor="rgb(15, 70, 55)" stopOpacity={0.38} />
        </linearGradient>
        <linearGradient
          id={`${gid}-b2`}
          gradientUnits="userSpaceOnUse"
          x1={secondBasemanFieldPosition.x}
          y1={secondBasemanFieldPosition.y}
          x2={secondBag.x}
          y2={secondBag.y}
        >
          <stop offset="0%" stopColor="rgb(45, 120, 90)" stopOpacity={0.14} />
          <stop offset="100%" stopColor="rgb(15, 70, 55)" stopOpacity={0.38} />
        </linearGradient>
      </defs>
      <g style={{ mixBlendMode: 'multiply' }} opacity={0.92}>
        <ellipse
          cx={ssFieldPosition.x}
          cy={ssFieldPosition.y}
          rx={9.2}
          ry={6.8}
          fill={`url(#${gid}-ss)`}
          stroke="none"
        />
        <ellipse
          cx={secondBasemanFieldPosition.x}
          cy={secondBasemanFieldPosition.y}
          rx={9.2}
          ry={6.8}
          fill={`url(#${gid}-b2)`}
          stroke="none"
        />
      </g>
      {bagDots()}
      {microLabel(firstBag.x, firstBag.y - 3.4, '1B')}
      {microLabel(thirdBag.x, thirdBag.y - 3.4, '3B')}
      {microLabel(secondBag.x, secondBag.y - 3.4, '2B')}
      {microLabel(ssFieldPosition.x, ssFieldPosition.y + 5.2, 'SS')}
      {microLabel(secondBasemanFieldPosition.x, secondBasemanFieldPosition.y + 5.2, '2B')}
    </g>
  );
}
