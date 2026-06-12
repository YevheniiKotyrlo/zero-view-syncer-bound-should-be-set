import {execSync} from 'node:child_process';
import {readFileSync} from 'node:fs';

// Reproduces ONE bug in isolation against the stock build, printing just
// that bug's verdict. Each bug is independently observable from a single
// stock leg:
//
//   empty-window — the forward cursor window after a NULL-sorted anchor
//                  hydrates empty (4 rows exist past the bound)
//   crash        — a synced UPDATE of a row past that cursor kills the
//                  view-syncer with "Bound should be set"
//   reverse-drop — the backward walk below a non-NULL bound drops the
//                  NULL-sorted group (returns 1 row instead of 4)
const BUGS = {
  'empty-window': {
    check: (result: LegResult) => result.forwardInitial === 0,
    describe: (result: LegResult) =>
      `forward window hydrated ${String(result.forwardInitial)} rows (expected by the bug: 0; correct behavior: 4 — sanity window holds ${String(result.sanityInitial)} rows, so the data is there)`,
  },
  'crash': {
    check: (result: LegResult) => result.serverAssertFired,
    describe: (result: LegResult) =>
      `view-syncer ${result.serverAssertFired ? 'DIED with "Bound should be set" (see .tmp/zero-cache-stock.log)' : 'did not crash'}`,
  },
  'reverse-drop': {
    check: (result: LegResult) => result.reverseInitial === 1,
    describe: (result: LegResult) =>
      `reverse window hydrated ${String(result.reverseInitial)} rows (expected by the bug: 1 — only the non-NULL neighbour; correct behavior: 4)`,
  },
} as const;

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

const bug = process.argv[2] as keyof typeof BUGS | undefined;
if (!bug || !(bug in BUGS)) {
  console.error('Usage: bun scripts/bug.ts <empty-window|crash|reverse-drop>');
  process.exit(1);
}

execSync('bun scripts/toggle-patch.mjs none', {stdio: 'inherit'});
execSync('bun scripts/run-leg.ts stock', {stdio: 'inherit'});
const result = JSON.parse(
  readFileSync('.tmp/result-stock.json', 'utf8'),
) as LegResult;

const reproduced = BUGS[bug].check(result);
console.log(`\nbug ${bug}: ${BUGS[bug].describe(result)}`);
console.log(reproduced ? 'REPRODUCED' : 'NOT REPRODUCED');
process.exit(reproduced ? 0 : 1);
