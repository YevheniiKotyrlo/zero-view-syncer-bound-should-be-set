import postgres from 'postgres';

import {UPSTREAM_DB} from './env.ts';

// Six rows: three with a NULL shelf (the head of the walk under NULLS-first
// ordering) and three shelved. The demo anchors a cursor on item-2 (NULL
// shelf) and later updates item-5 ('B'), which sorts past that bound.
const sql = postgres(UPSTREAM_DB, {max: 1});

await sql`DROP TABLE IF EXISTS item CASCADE`;
await sql`CREATE TABLE item (
  id TEXT PRIMARY KEY,
  shelf TEXT,
  name TEXT NOT NULL
)`;
await sql`INSERT INTO item (id, shelf, name) VALUES
  ('item-1', NULL, 'unshelved one'),
  ('item-2', NULL, 'unshelved two'),
  ('item-3', NULL, 'unshelved three'),
  ('item-4', 'A',  'shelved a'),
  ('item-5', 'B',  'shelved b'),
  ('item-6', 'C',  'shelved c')`;

const [{count}] = await sql<[{count: string}]>`SELECT count(*) FROM item`;
console.log(`seeded item table with ${count} rows`);
await sql.end();
