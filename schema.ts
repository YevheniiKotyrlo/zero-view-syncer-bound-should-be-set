import {
  ANYONE_CAN_DO_ANYTHING,
  createSchema,
  definePermissions,
  string,
  table,
} from '@rocicorp/zero';

// One table is enough. `shelf` is nullable and is the first sort key of the
// cursor query — rows with a NULL shelf form the head of the walk under
// SQLite's NULLS-first ordering, so a cursor anchored on one of them carries
// a NULL bound value.
const item = table('item')
  .columns({
    id: string(),
    shelf: string().optional(),
    name: string(),
  })
  .primaryKey('id');

export const schema = createSchema({tables: [item]});

export type Schema = typeof schema;

export const permissions = definePermissions<unknown, Schema>(schema, () => ({
  item: ANYONE_CAN_DO_ANYTHING,
}));
