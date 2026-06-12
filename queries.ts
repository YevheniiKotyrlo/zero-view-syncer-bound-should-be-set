import {createBuilder, defineQueries, defineQuery} from '@rocicorp/zero';

import {schema} from './schema.ts';

const builder = createBuilder(schema);

export const queries = defineQueries({
  // The cursor-paginated page strictly after a given row — the windowed-list
  // query shape. The demo anchors it on item-2, whose `shelf` sort value is
  // NULL, so the server-side start constraint carries a NULL bound.
  itemsAfter: defineQuery(
    ({args}: {args: {id: string; shelf: string | null}}) =>
      builder.item
        .orderBy('shelf', 'asc')
        .orderBy('id', 'asc')
        .start({id: args.id, shelf: args.shelf})
        .limit(5),
  ),
});
