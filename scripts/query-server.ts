import {mustGetQuery} from '@rocicorp/zero';
import {handleQueryRequest} from '@rocicorp/zero/server';

import {queries} from '../queries.ts';
import {schema} from '../schema.ts';
import {QUERY_PORT} from './env.ts';

// The query API server: zero-cache forwards every named client query here
// (`ZERO_QUERY_URL`), and this endpoint resolves the name + args into the
// query's AST through the shared registry — the synced-query transform step.
Bun.serve({
  port: QUERY_PORT,
  fetch: async request => {
    const response = await handleQueryRequest({
      handler: (name, args) =>
        mustGetQuery(queries, name).fn({args: args as never, ctx: undefined}),
      schema,
      request,
    });
    return Response.json(response);
  },
});

// stderr: unbuffered when piped.
console.error(`query server listening on :${QUERY_PORT}`);
