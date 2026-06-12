import {execSync, spawn, type ChildProcess} from 'node:child_process';
import {mkdirSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';

import postgres from 'postgres';

import {QUERY_URL, UPSTREAM_DB, ZERO_PORT, ZERO_SERVER} from './env.ts';

// Runs ONE leg of the demo against whatever @rocicorp/zero build is
// currently installed (select with scripts/toggle-patch.mjs):
//
//   1. reset the world — fresh Postgres (docker compose down -v / up), seed,
//      deploy the repro's permissions
//   2. start zero-cache (capturing its log)
//   3. start a real Zero client that registers the cursor query anchored on
//      a NULL-sorted row (its page should hold item-3..6)
//   4. UPDATE a non-sort column of item-5 — a row whose old and new
//      positions both sort past the cursor bound
//   5. verdicts: what did the window hydrate to, did the update reach the
//      client, and did the view-syncer die with "Bound should be set"?
const leg = process.argv[2];
if (!leg) {
  console.error('Usage: bun scripts/run-leg.ts <leg-name>');
  process.exit(1);
}

const ASSERT_MESSAGE = 'Bound should be set';
const UPDATED_NAME = 'shelved b (updated)';
mkdirSync('.tmp', {recursive: true});
const zeroCacheLogFile = resolve(`.tmp/zero-cache-${leg}.log`);
const replicaFile = resolve(`.tmp/replica-${leg}.db`);

console.log(`[${leg}] resetting the sandbox (docker compose down -v / up)…`);
execSync('docker compose down -v', {stdio: 'pipe'});
execSync('docker compose up -d --wait', {stdio: 'pipe'});
execSync('bun scripts/seed.ts', {stdio: 'inherit'});
console.log(`[${leg}] deploying permissions…`);
execSync(
  `node node_modules/@rocicorp/zero/out/zero/src/deploy-permissions.js --schema-path=schema.ts --upstream-db=${UPSTREAM_DB}`,
  {stdio: 'pipe'},
);

let zeroCacheLog = '';
const children: ChildProcess[] = [];
const spawnChild = (
  label: string,
  command: string,
  args: string[],
  onLine: (line: string) => void,
): ChildProcess => {
  const child = spawn(command, args, {
    env: {
      ...process.env,
      ['ZERO_UPSTREAM_DB']: UPSTREAM_DB,
      ['ZERO_REPLICA_FILE']: replicaFile,
      ['ZERO_PORT']: String(ZERO_PORT),
      ['ZERO_LOG_LEVEL']: 'info',
      ['ZERO_ADMIN_PASSWORD']: 'repro-admin',
      // The default (one syncer per core) overruns the upstream connection
      // budget on many-core machines; two is plenty for one client.
      ['ZERO_NUM_SYNC_WORKERS']: '2',
      // The synced-query transform endpoint (scripts/query-server.ts).
      ['ZERO_QUERY_URL']: QUERY_URL,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  for (const stream of [child.stdout, child.stderr]) {
    stream?.setEncoding('utf8');
    stream?.on('data', (chunk: string) => {
      for (const line of chunk.split(/\r?\n/u)) {
        if (line.trim().length > 0) {
          onLine(line);
        }
      }
    });
  }
  child.on('exit', code => console.log(`[${leg}] ${label} exited (${code})`));
  return child;
};

const stopChildren = (): void => {
  for (const child of children) {
    if (child.pid !== undefined && child.exitCode === null) {
      // zero-cache forks workers; kill the whole tree on Windows.
      try {
        if (process.platform === 'win32') {
          execSync(`taskkill /PID ${child.pid} /T /F`, {stdio: 'pipe'});
        } else {
          child.kill('SIGKILL');
        }
      } catch {
        /* already gone */
      }
    }
  }
};

console.log(`[${leg}] starting the query server…`);
spawnChild('query-server', 'bun', ['scripts/query-server.ts'], line =>
  console.log(`[${leg}] query-server: ${line}`),
);

console.log(`[${leg}] starting zero-cache…`);
spawnChild(
  'zero-cache',
  'node',
  ['node_modules/@rocicorp/zero/out/zero/src/cli.js'],
  line => {
    zeroCacheLog += `${line}\n`;
  },
);

const waitForReady = async (): Promise<void> => {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${ZERO_SERVER}/keepalive`);
      if (response.ok) {
        return;
      }
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  // Persist whatever zero-cache said so a failed boot is diagnosable.
  writeFileSync(zeroCacheLogFile, zeroCacheLog);
  throw new Error(
    `zero-cache did not become ready within 90s — see ${zeroCacheLogFile}`,
  );
};
await waitForReady();
console.log(`[${leg}] zero-cache ready; starting the client…`);

interface WindowReport {
  type: 'window';
  count: number;
  names: string[];
}
const windowReports: WindowReport[] = [];
spawnChild('client', 'bun', ['scripts/client.ts'], line => {
  try {
    const parsed = JSON.parse(line) as WindowReport;
    if (parsed.type === 'window') {
      windowReports.push(parsed);
      console.log(`[${leg}] client window: ${parsed.count} rows`);
      return;
    }
  } catch {
    /* not a JSON report — fall through to logging */
  }
  console.log(`[${leg}] client: ${line}`);
});

// Let the query register + hydrate + settle.
const hydrateDeadline = Date.now() + 30_000;
while (windowReports.length === 0 && Date.now() < hydrateDeadline) {
  await sleep(250);
}
await sleep(2_000);
const initialWindow = windowReports.at(-1)?.count ?? -1;

console.log(`[${leg}] updating item-5 (sorts past the cursor bound)…`);
const sql = postgres(UPSTREAM_DB, {max: 1});
await sql`UPDATE item SET name = ${UPDATED_NAME} WHERE id = 'item-5'`;
await sql.end();

// Give replication + the pipelines time to react (or crash).
await sleep(8_000);

const finalReport = windowReports.at(-1);
const result = {
  leg,
  initialWindow,
  finalWindow: finalReport?.count ?? -1,
  updateReachedClient: finalReport?.names.includes(UPDATED_NAME) ?? false,
  serverAssertFired: zeroCacheLog.includes(ASSERT_MESSAGE),
};
writeFileSync(`.tmp/result-${leg}.json`, JSON.stringify(result, null, 2));
writeFileSync(zeroCacheLogFile, zeroCacheLog);
console.log(`[${leg}] result: ${JSON.stringify(result)}`);

stopChildren();
await sleep(500);
process.exit(0);
