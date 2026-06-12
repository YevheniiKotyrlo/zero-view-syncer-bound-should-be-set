import {createBuilder, defineQueries, defineQuery} from '@rocicorp/zero';

import {schema} from './schema.ts';

const builder = createBuilder(schema);

// Three synced queries — one per probe:
//
// - `itemsAfter` (bug 1 + bug 2): the forward page strictly after item-2,
//   whose `shelf` sort value is NULL, so the server-side start constraint
//   carries a NULL bound. Should hold item-3..6 (4 rows).
// - `itemsBefore` (bug 3): the backward walk strictly after item-5 in
//   descending order — the strictly-before set, which includes the whole
//   NULL-shelf group. Should hold item-4, item-3, item-2, item-1 (4 rows).
// - `shelvedAfter` (regression sanity): the same forward shape anchored on a
//   non-NULL row. Should hold item-5, item-6 (2 rows) on EVERY build —
//   stock and patched alike.
export const queries = defineQueries({
  itemsAfter: defineQuery(
    ({args}: {args: {id: string; shelf: string | null}}) =>
      builder.item
        .orderBy('shelf', 'asc')
        .orderBy('id', 'asc')
        .start({id: args.id, shelf: args.shelf})
        .limit(5),
  ),
  itemsBefore: defineQuery(
    ({args}: {args: {id: string; shelf: string | null}}) =>
      builder.item
        .orderBy('shelf', 'desc')
        .orderBy('id', 'desc')
        .start({id: args.id, shelf: args.shelf})
        .limit(5),
  ),
  shelvedAfter: defineQuery(() =>
    builder.item
      .orderBy('shelf', 'asc')
      .orderBy('id', 'asc')
      .start({id: 'item-4', shelf: 'A'})
      .limit(5),
  ),
});
