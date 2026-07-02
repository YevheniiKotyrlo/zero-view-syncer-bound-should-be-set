import {describe, expect, test} from 'bun:test';

import {
  buildExpectations,
  collectLegResults,
  type LegResult,
} from '../scripts/demo.ts';

// The e2e proof, as a test suite. Collecting the leg results runs the full
// five-leg matrix (each leg resets the Docker sandbox, boots zero-cache and
// the query server, drives a real client, applies the UPDATE) — several
// minutes; the per-bug tests below then assert against the recorded results.
const results: LegResult[] = collectLegResults();
const byLeg = (leg: string): LegResult => {
  const result = results.find(candidate => candidate.leg === leg);
  if (!result) {
    throw new Error(`missing leg result: ${leg}`);
  }
  return result;
};

describe('stock reproduces all three bugs', () => {
  test('bug 1 — the forward window after a NULL-sorted anchor hydrates empty', () => {
    expect(byLeg('stock').forwardInitial).toBe(0);
  });

  test('bug 2 — a synced UPDATE past the cursor kills the view-syncer with "Bound should be set"', () => {
    expect(byLeg('stock').serverAssertFired).toBe(true);
    expect(byLeg('stock').forwardGotUpdate).toBe(false);
  });

  test('bug 2 — the blast radius is the poisoned client group; the sanity group still receives the update', () => {
    expect(byLeg('stock').sanityGotUpdate).toBe(true);
  });

  test('bug 3 — the backward walk below a non-NULL bound drops the NULL group', () => {
    expect(byLeg('stock').reverseInitial).toBe(1);
  });
});

describe('each fix resolves its bug in isolation', () => {
  test('take patch alone — the view-syncer survives and surfaces the row as an add', () => {
    const takeOnly = byLeg('take-only');
    expect(takeOnly.serverAssertFired).toBe(false);
    expect(takeOnly.forwardInitial).toBe(0);
    expect(takeOnly.forwardFinal).toBe(1);
    expect(takeOnly.forwardGotUpdate).toBe(true);
  });

  test('zqlite patch alone — both cursor windows hydrate correctly', () => {
    const zqliteOnly = byLeg('zqlite-only');
    expect(zqliteOnly.forwardInitial).toBe(4);
    expect(zqliteOnly.reverseInitial).toBe(4);
    expect(zqliteOnly.serverAssertFired).toBe(false);
  });
});

describe('the fail-closed take candidate (rocicorp/mono#6188)', () => {
  test('survives the update but drops it silently — the forward window stays empty', () => {
    const failClosed = byLeg('fail-closed');
    expect(failClosed.serverAssertFired).toBe(false);
    expect(failClosed.forwardInitial).toBe(0);
    expect(failClosed.forwardFinal).toBe(0);
    expect(failClosed.forwardGotUpdate).toBe(false);
    expect(failClosed.sanityGotUpdate).toBe(true);
  });
});

describe('both fixes together', () => {
  test('windows hydrate correctly and the update lands live with no crash', () => {
    const both = byLeg('both');
    expect(both.forwardInitial).toBe(4);
    expect(both.reverseInitial).toBe(4);
    expect(both.forwardGotUpdate).toBe(true);
    expect(both.serverAssertFired).toBe(false);
  });
});

describe('no regressions', () => {
  test('the non-NULL-anchored sanity window holds 2 rows on every build', () => {
    for (const result of results) {
      expect({leg: result.leg, sanity: result.sanityInitial}).toEqual({
        leg: result.leg,
        sanity: 2,
      });
    }
  });

  test('the full expectation matrix holds', () => {
    for (const [label, passed] of buildExpectations(results)) {
      expect({expectation: label, passed}).toEqual({
        expectation: label,
        passed: true,
      });
    }
  });
});
