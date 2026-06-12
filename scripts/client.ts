import {Zero} from '@rocicorp/zero';

import {queries} from '../queries.ts';
import {schema} from '../schema.ts';

// The zero-cache endpoint comes from the leg's port block (scripts/env.ts).
const ZERO_SERVER = process.env['REPRO_ZERO_SERVER'] ?? 'http://127.0.0.1:4990';

// A real Zero client (in-memory kv store — no IndexedDB needed) registering
// ONE synced query, selected by argv. Each probe runs as its own client so
// the probes cannot contaminate each other: a Zero client evaluates queries
// over its whole local store, so rows synced for one query would otherwise
// mask another query's wrong (empty) server window. Separate clients also
// demonstrate the crash's blast radius — the view-syncer kills the client
// GROUP that owns the poisoned query; other groups keep syncing.
const PROBES = {
  forward: () => queries.itemsAfter({id: 'item-2', shelf: null}),
  reverse: () => queries.itemsBefore({id: 'item-5', shelf: 'B'}),
  sanity: () => queries.shelvedAfter(),
} as const;

const probe = process.argv[2] as keyof typeof PROBES | undefined;
if (!probe || !(probe in PROBES)) {
  console.error('Usage: bun scripts/client.ts <forward|reverse|sanity>');
  process.exit(1);
}

const zero = new Zero({
  server: ZERO_SERVER,
  schema,
  kvStore: 'mem',
});

// This repro deliberately uses ONLY synced queries. Legacy ad-hoc queries
// stay disabled (no `enableLegacyQueries` anywhere) — assert it so a future
// edit can't silently reintroduce them.
if ((zero as unknown as {query?: unknown}).query !== undefined) {
  throw new Error('legacy queries are enabled — this repro must not use them');
}

const view = zero.materialize(PROBES[probe]());

// Poll the materialized data rather than relying on listener timing, and
// report on stderr: Bun block-buffers piped stdout, so stdout reports would
// sit in the buffer until exit.
let lastReport = '';
setInterval(() => {
  const rows = view.data as readonly {name: string}[];
  const report = JSON.stringify({
    type: 'window',
    probe,
    names: rows.map(row => row.name),
  });
  if (report !== lastReport) {
    lastReport = report;
    console.error(report);
  }
}, 500);
