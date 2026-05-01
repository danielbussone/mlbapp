import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildPercentileSlot } from './dist/repos/leaguePercentilesPayload.js';

describe('buildPercentileSlot', () => {
  it('keeps p when unqualified but value present (provisional display)', () => {
    const s = buildPercentileSlot({
      percentile: 91,
      cohortN: 400,
      qualified: false,
      value: 97.4,
    });
    assert.equal(s.p, 91);
    assert.equal(s.qualified, false);
    assert.equal(s.value, 97.4);
    assert.equal(s.n, 400);
    assert.equal(s.direction, 'higher_better');
  });

  it('clamps p to 0–100 when qualified', () => {
    const s = buildPercentileSlot({
      percentile: 100.7,
      cohortN: 10,
      qualified: true,
      value: 2.3,
      direction: 'lower_better',
    });
    assert.equal(s.p, 100);
    assert.equal(s.qualified, true);
    assert.equal(s.direction, 'lower_better');
  });

  it('null value forces p null and qualified false', () => {
    const s = buildPercentileSlot({
      percentile: 50,
      cohortN: 100,
      qualified: true,
      value: undefined,
    });
    assert.equal(s.value, null);
    assert.equal(s.p, null);
    assert.equal(s.qualified, false);
  });
});
