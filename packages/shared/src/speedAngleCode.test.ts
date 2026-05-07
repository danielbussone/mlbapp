import { describe, expect, it } from 'vitest';

import { speedAngleCode } from './speedAngleCode.js';

describe('speedAngleCode', () => {
  it('classifies barrel (6)', () => {
    expect(speedAngleCode(100, 30)).toBe(6);
    expect(speedAngleCode(99, 25)).toBe(6);
    expect(speedAngleCode(98, 26)).toBe(6);
  });

  it('classifies solid contact (5)', () => {
    expect(speedAngleCode(95, 25)).toBe(5);
    expect(speedAngleCode(96, 24)).toBe(5);
    expect(speedAngleCode(109, 52)).toBe(5);
  });

  it('classifies weak (1)', () => {
    expect(speedAngleCode(59, 0)).toBe(1);
    expect(speedAngleCode(50, 45)).toBe(1);
  });

  it('classifies flare/burner branches (4)', () => {
    expect(speedAngleCode(70, 15)).toBe(4);
    expect(speedAngleCode(80, 10)).toBe(4);
    expect(speedAngleCode(90, 5)).toBe(4);
    expect(speedAngleCode(96, 10)).toBe(4);
  });

  it('classifies hit under (3) vs topped (2) via speed + 2*angle vs 116', () => {
    expect(speedAngleCode(70, 40)).toBe(3);
    expect(speedAngleCode(70, -10)).toBe(2);
    expect(speedAngleCode(88, -5)).toBe(2);
    expect(speedAngleCode(100, 40)).toBe(3);
  });

  it('returns unclassified (0) for non-finite inputs', () => {
    expect(speedAngleCode(Number.NaN, 0)).toBe(0);
  });

  it('barrel wins before solid when both could apply', () => {
    expect(speedAngleCode(99, 30)).toBe(6);
  });

  it('weak wins before flare when speed <= 59', () => {
    expect(speedAngleCode(59, 10)).toBe(1);
  });
});
