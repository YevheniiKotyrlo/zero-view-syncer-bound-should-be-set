import {execSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';

// Selects which build of @rocicorp/zero is installed, via Bun's native patch
// mechanism (`patchedDependencies` + `bun install`):
//   none      — stock 1.5.0 (the bug is visible)
//   take-only — only the Take operator fix (the crash is gone; the cursor
//               window still hydrates empty)
//   both      — Take fix + the zqlite NULL-bound start-constraint fix (the
//               window hydrates correctly and nothing crashes)
const PACKAGE_JSON = resolve('package.json');
const VARIANTS = {
  'none': undefined,
  'take-only': {'@rocicorp/zero@1.5.0': 'patches/take-only.patch'},
  'both': {'@rocicorp/zero@1.5.0': 'patches/both.patch'},
};

const variant = process.argv[2];
if (!(variant in VARIANTS)) {
  console.error('Usage: bun scripts/toggle-patch.mjs <none|take-only|both>');
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
