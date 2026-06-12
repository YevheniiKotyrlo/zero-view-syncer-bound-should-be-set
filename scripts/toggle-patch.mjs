import {execSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';

// Selects which build of @rocicorp/zero is installed, via Bun's native patch
// mechanism (`patchedDependencies` + `bun install`):
//   none        — stock (all three bugs visible)
//   take-only   — only the Take operator fix (the crash is gone; both cursor
//                 windows still hydrate wrong)
//   zqlite-only — only the NULL-bound start-constraint fix + the replica
//                 optional derivation (both windows hydrate correctly; the
//                 crash precondition disappears with them)
//   both        — all fixes together
const PACKAGE_JSON = resolve('package.json');
const ZERO_VERSION = '1.6.2';
const VARIANTS = {
  'none': undefined,
  'take-only': {[`@rocicorp/zero@${ZERO_VERSION}`]: 'patches/take-only.patch'},
  'zqlite-only': {
    [`@rocicorp/zero@${ZERO_VERSION}`]: 'patches/zqlite-only.patch',
  },
  'both': {[`@rocicorp/zero@${ZERO_VERSION}`]: 'patches/both.patch'},
};

const variant = process.argv[2];
if (!(variant in VARIANTS)) {
  console.error(
    'Usage: bun scripts/toggle-patch.mjs <none|take-only|zqlite-only|both>',
  );
  process.exit(1);
}

const packageJson = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8'));
const wanted = VARIANTS[variant];
if (wanted === undefined) {
  delete packageJson.patchedDependencies;
} else {
  packageJson.patchedDependencies = wanted;
}
writeFileSync(PACKAGE_JSON, `${JSON.stringify(packageJson, null, 2)}\n`);
execSync('bun install', {stdio: 'inherit'});
console.log(`installed variant: ${variant}`);
