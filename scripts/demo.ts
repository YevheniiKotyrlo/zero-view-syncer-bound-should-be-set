import {execSync} from 'node:child_process';
import {readFileSync} from 'node:fs';

// Runs the four legs back to back and checks the full expectation matrix —
// each bug visible on stock, fixed by its own patch in isolation, everything
// correct with both patches, and the non-NULL sanity probe identical on
// every build (no regressions). Each probe runs as its own client (its own
// client group), so the crash's blast radius is visible too: on stock, only
// the group owning the poisoned forward query dies — the sanity group keeps
// syncing and still receives the update.
//
//                forward  reverse  sanity  crash  update reaches forward / sanity
//   stock          0        1        2     YES    no  / yes
//   take-only      0 -> 1   1        2     no     yes / yes
//   zqlite-only    4        4        2     no     yes / yes
//   both           4        4        2     no     yes / yes
export interface LegResult {
  leg: string;
  forwardInitial: number;
  reverseInitial: number;
  sanityInitial: number;
  forwardFinal: number;
  forwardGotUpdate: boolean;
  sanityGotUpdate: boolean;
  serverAssertFired: boolean;
}

export const LEGS = [
  {variant: 'none', leg: 'stock'},
  {variant: 'take-only', leg: 'take-only'},
  {variant: 'zqlite-only', leg: 'zqlite-only'},
  {variant: 'both', leg: 'both'},
] as const;

export const collectLegResults = (): LegResult[] => {
  const results: LegResult[] = [];
  for (const {variant, leg} of LEGS) {
    console.log(`\n=== LEG: ${leg} (variant: ${variant}) ===`);
    execSync(`bun scripts/toggle-patch.mjs ${variant}`, {stdio: 'inherit'});
    execSync(`bun scripts/run-leg.ts ${leg}`, {stdio: 'inherit'});
    results.push(JSON.parse(readFileSync(`.tmp/result-${leg}.json`, 'utf8')));
  }
  // Restore the committed (stock) install state.
  execSync('bun scripts/toggle-patch.mjs none', {stdio: 'pipe'});
  return results;
};

export const buildExpectations = (
  results: LegResult[],
): [string, boolean][] => {
  const [stock, takeOnly, zqliteOnly, both] = results;
  return [
    // Bug 1 — a NULL cursor bound hydrates an empty forward window.
    ['bug 1 (stock): forward window after the NULL-sorted anchor hydrates EMPTY', stock.forwardInitial === 0],
    ['bug 1 (fixed by the zqlite patch alone): forward window hydrates the 4 rows', zqliteOnly.forwardInitial === 4],
    // Bug 2 — the forwarded edit kills the view-syncer on an empty window.
    ['bug 2 (stock): view-syncer dies with "Bound should be set"', stock.serverAssertFired],
    ['bug 2 (stock): the update never reaches the dead forward group', !stock.forwardGotUpdate],
    ['bug 2 (stock): the blast radius is the poisoned group — sanity still receives the update', stock.sanityGotUpdate],
    ['bug 2 (fixed by the take patch alone): view-syncer survives the update', !takeOnly.serverAssertFired],
    ['bug 2 (fixed by the take patch alone): the row surfaces as an add (0 -> 1)', takeOnly.forwardInitial === 0 && takeOnly.forwardFinal === 1 && takeOnly.forwardGotUpdate],
    // Bug 3 — a backward walk below a non-NULL bound drops the NULL group.
    ['bug 3 (stock): reverse window drops the NULL group (1 row instead of 4)', stock.reverseInitial === 1],
    ['bug 3 (fixed by the zqlite patch alone): reverse window holds all 4 rows', zqliteOnly.reverseInitial === 4],
    // Both patches together — everything correct.
    ['both: forward window hydrates the 4 rows past the bound', both.forwardInitial === 4],
    ['both: reverse window holds all 4 rows', both.reverseInitial === 4],
    ['both: the update lands live with no crash', both.forwardGotUpdate && !both.serverAssertFired],
    // Regression sanity — the non-NULL anchor behaves identically everywhere.
    ['sanity: non-NULL-anchored window holds 2 rows on EVERY build', results.every(result => result.sanityInitial === 2)],
    ['sanity: the update reaches the sanity window on EVERY build', results.every(result => result.sanityGotUpdate)],
    ['sanity: no patched build crashes', !takeOnly.serverAssertFired && !zqliteOnly.serverAssertFired && !both.serverAssertFired],
  ];
};

if (import.meta.main) {
  const results = collectLegResults();

  console.log('\n=========================== SUMMARY ===========================');
  for (const result of results) {
    console.log(
      `${result.leg.padEnd(12)} forward ${String(result.forwardInitial)} -> ${String(result.forwardFinal)}` +
        ` | reverse ${String(result.reverseInitial)} | sanity ${String(result.sanityInitial)}` +
        ` | update fwd/sanity: ${String(result.forwardGotUpdate)}/${String(result.sanityGotUpdate)}` +
        ` | "Bound should be set": ${String(result.serverAssertFired)}`,
    );
  }

  const expectations = buildExpectations(results);
  let reproduced = true;
  console.log('\n=========================== VERDICT ===========================');
  for (const [label, passed] of expectations) {
    console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}`);
    reproduced &&= passed;
  }
  console.log(
    reproduced
      ? '\nReproduction confirmed: all three bugs visible on stock, each fixed by its patch, no regressions.'
      : '\nReproduction did NOT match expectations — inspect .tmp/result-*.json and .tmp/zero-cache-*.log.',
  );
  process.exit(reproduced ? 0 : 1);
}
