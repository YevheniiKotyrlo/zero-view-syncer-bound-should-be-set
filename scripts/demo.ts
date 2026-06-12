import {execSync} from 'node:child_process';
import {readFileSync} from 'node:fs';

// Runs the three legs back to back and prints the comparison:
//
//   stock     — the cursor window hydrates EMPTY (defect 1) and the UPDATE
//               kills the view-syncer with "Bound should be set" (defect 2)
//   take-only — the window still hydrates empty, but the view-syncer
//               survives and surfaces the updated row as an add
//   both      — the window hydrates correctly AND the update lands live
interface LegResult {
  leg: string;
  initialWindow: number;
  finalWindow: number;
  updateReachedClient: boolean;
  serverAssertFired: boolean;
}

const LEGS = [
  {variant: 'none', leg: 'stock'},
  {variant: 'take-only', leg: 'take-only'},
  {variant: 'both', leg: 'both'},
] as const;

const results: LegResult[] = [];
for (const {variant, leg} of LEGS) {
  console.log(`\n=== LEG: ${leg} (variant: ${variant}) ===`);
  execSync(`bun scripts/toggle-patch.mjs ${variant}`, {stdio: 'inherit'});
  execSync(`bun scripts/run-leg.ts ${leg}`, {stdio: 'inherit'});
  results.push(JSON.parse(readFileSync(`.tmp/result-${leg}.json`, 'utf8')));
}

// Restore the committed (stock) install state.
execSync('bun scripts/toggle-patch.mjs none', {stdio: 'pipe'});

const [stock, takeOnly, both] = results;
console.log('\n================= SUMMARY =================');
for (const result of results) {
  console.log(
    `${result.leg.padEnd(10)} window ${String(result.initialWindow)} -> ${String(result.finalWindow)}` +
      ` | update reached client: ${String(result.updateReachedClient)}` +
      ` | "Bound should be set": ${String(result.serverAssertFired)}`,
  );
}

const expectations: [string, boolean][] = [
  ['stock: cursor window hydrates EMPTY (NULL-bound defect)', stock.initialWindow === 0],
  ['stock: view-syncer dies with "Bound should be set"', stock.serverAssertFired],
  ['take-only: view-syncer survives the update', !takeOnly.serverAssertFired],
  ['take-only: updated row surfaces as an add (0 -> 1)', takeOnly.finalWindow === 1 && takeOnly.updateReachedClient],
  ['both: cursor window hydrates the 4 rows past the bound', both.initialWindow === 4],
  ['both: update lands live in the window', both.updateReachedClient && !both.serverAssertFired],
];

let reproduced = true;
console.log('\n================= VERDICT =================');
for (const [label, passed] of expectations) {
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}`);
  reproduced &&= passed;
}
console.log(
  reproduced
    ? '\nReproduction confirmed: stock crashes + hydrates empty; the fixes restore both.'
    : '\nReproduction did NOT match expectations — inspect .tmp/result-*.json and .tmp/zero-cache-*.log.',
);
process.exit(reproduced ? 0 : 1);
