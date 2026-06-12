import {Zero} from '@rocicorp/zero';

import {queries} from '../queries.ts';
import {schema} from '../schema.ts';
import {ZERO_SERVER} from './env.ts';

// A real Zero client (in-memory kv store — no IndexedDB needed) that
// registers ONE synced cursor-paginated query: the page strictly after
// item-2, whose `shelf` sort value is NULL. It reports every distinct
// materialized state as a JSON line; the orchestrator reads those lines for
// its verdicts.
const zero = new Zero({
  server: ZERO_SERVER,
  schema,
  kvStore: 'mem',
});

const view = zero.materialize(queries.itemsAfter({id: 'item-2', shelf: null}));

// Poll the materialized data rather than relying on listener timing, and
// report on stderr: Bun block-buffers piped stdout, so stdout reports would
// sit in the buffer until exit.
let lastReport = '';
setInterval(() => {
  const rows = view.data as readonly {name: string}[];
  const report = JSON.stringify({
    type: 'window',
    count: rows.length,
    names: rows.map(row => row.name),
  });
  if (report !== lastReport) {
    lastReport = report;
    console.error(report);
  }
}, 500);
