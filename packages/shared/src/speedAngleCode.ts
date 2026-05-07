/**
 * Tango Tiger / Statcast-style contact bucket from exit velocity (mph) and launch angle (degrees).
 * Mirrors SQL CASE evaluation order (first match wins).
 */
export type SpeedAngleCode = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const SPEED_ANGLE_LABELS: Record<SpeedAngleCode, string> = {
  0: 'Unclassified',
  1: 'Weak contact',
  2: 'Topped',
  3: 'Hit under',
  4: 'Flares & burners',
  5: 'Solid contact',
  6: 'Barrel',
};

/**
 * @param speed Exit velocity (mph)
 * @param angle Launch angle (degrees)
 */
export function speedAngleCode(speed: number, angle: number): SpeedAngleCode {
  if (
    speed * 1.5 - angle >= 117 &&
    speed + angle >= 124 &&
    speed >= 98 &&
    angle >= 4 &&
    angle <= 50
  ) {
    return 6;
  }

  if (
    speed * 1.5 - angle >= 111 &&
    speed + angle >= 119 &&
    speed >= 95 &&
    angle >= 0 &&
    angle <= 52
  ) {
    return 5;
  }

  if (speed <= 59) {
    return 1;
  }

  if (
    speed * 2 - angle >= 87 &&
    angle <= 41 &&
    speed * 2 + angle <= 175 &&
    speed + angle * 1.3 >= 89 &&
    speed >= 59 &&
    speed <= 72
  ) {
    return 4;
  }

  if (
    speed + angle * 1.3 <= 112 &&
    speed + angle * 1.55 >= 92 &&
    speed >= 72 &&
    speed <= 86
  ) {
    return 4;
  }

  if (angle <= 20 && speed + angle * 2.4 >= 98 && speed >= 86 && speed <= 95) {
    return 4;
  }

  if (
    speed - angle >= 76 &&
    speed + angle * 2.4 >= 98 &&
    speed >= 95 &&
    angle <= 30
  ) {
    return 4;
  }

  if (speed + angle * 2 >= 116) {
    return 3;
  }

  if (speed + angle * 2 <= 116) {
    return 2;
  }

  return 0;
}

/** Hex colors aligned with Savant-style EV×LA charts (light UI); use opacity for dark mode overlays. */
export const SPEED_ANGLE_COLORS: Record<SpeedAngleCode, string> = {
  0: '#546e7a',
  1: '#ffeb3b',
  2: '#8bc34a',
  3: '#64b5f6',
  4: '#ff9800',
  5: '#f48fb1',
  6: '#e53935',
};
