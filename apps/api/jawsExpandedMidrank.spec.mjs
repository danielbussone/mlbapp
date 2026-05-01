import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { jawsMidrankPercentile } from './dist/repos/jawsExpanded.js';

describe('jawsMidrankPercentile', () => {
  it('returns null p for empty cohort', () => {
    const r = jawsMidrankPercentile([], 5);
    assert.equal(r.n, 0);
    assert.equal(r.p, null);
  });

  it('matches midrank formula for ties at bounds', () => {
    const vals = [1, 2, 3, 4, 5];
    const r = jawsMidrankPercentile(vals, 3);
    assert.equal(r.n, 5);
    assert.equal(r.p, 50);
  });

  it('counts duplicate ties', () => {
    const vals = [1, 2, 2, 2, 10];
    const r = jawsMidrankPercentile(vals, 2);
    assert.equal(r.n, 5);
    assert.equal(r.p, 50);
  });
});
