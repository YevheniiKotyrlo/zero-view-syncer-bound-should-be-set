import {execSync} from 'node:child_process';
import {readFileSync} from 'node:fs';

import {describe, expect, test} from 'bun:test';

// Correct-behavior spec for WHATEVER @rocicorp/zero build is currently
// installed — it does NOT toggle patches. The same four tests are the red
// and the green pipeline:
//
//   - against the stock build the three bug tests FAIL (the red light) while
//     the harness-sanity test passes, proving the failures are the bugs and
//     not a broken reproduction;
//   - against the fully patched build (`bun run patch:both`) all four pass
//     (the green light).
//
// Select the build first: `bun run patch:none` (stock) or
// `bun run patch:both` (fixed), then `bun run test:current-build`.
interface LegResult {
  leg: string;
  forwardInitial: number;
  reverseInitial: number;
  sanityInitial: number;
  forwardFinal: number;
  forwardGotUpdate: boolean;
  sanityGotUpdate: boolean;
  serverAssertFired: boolean;
}

execSync('bun scripts/run-leg.ts current', {stdio: 'inherit'});
const result = JSON.parse(
  readFileSync('.tmp/result-current.json', 'utf8'),
) as LegResult;

describe('cursor pagination behaves correctly on the installed build', () => {
  test('bug 1 — the forward window after a NULL-sorted anchor hydrates its 4 rows', () => {
    expect(result.forwardInitial).toBe(4);
  });

  test('bug 2 — a synced UPDATE past the cursor reaches the client and the view-syncer survives', () => {
    expect(result.serverAssertFired).toBe(false);
    expect(result.forwardGotUpdate).toBe(true);
  });

  test('bug 3 — the backward walk below a non-NULL bound includes the NULL group (4 rows)', () => {
    expect(result.reverseInitial).toBe(4);
  });

  test('harness sanity — the non-NULL-anchored window holds its 2 rows and receives the update (passes even on stock)', () => {
    expect(result.sanityInitial).toBe(2);
    expect(result.sanityGotUpdate).toBe(true);
  });
});
