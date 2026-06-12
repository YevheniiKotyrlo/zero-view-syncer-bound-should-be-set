# zero-cache view-syncer dies with "Bound should be set" on a cursor query whose page hydrated empty

A synced `UPDATE` can kill the `@rocicorp/zero` view-syncer — every client in
the group is disconnected with
`{"kind":"Internal","message":"Bound should be set","origin":"zeroCache"}` —
when it reaches a cursor-paginated query whose current page is empty. Two
stock defects chain to get there:

1. **A NULL-valued cursor bound compiles into start constraints that never
   match** (`packages/zqlite/src/query-builder.ts` +
   `packages/zero-cache/src/types/lite.ts`). SQLite sorts NULLs first, but
   `.start(row)` with a NULL sort value compiles to `col > NULL` /
   `col = NULL` — never true — because the replica's column specs drop the
   `|NOT_NULL` attribute, leaving the null-safe branches dead. The "next
   page" silently returns nothing: the view-syncer hydrates an **empty
   window while rows past the bound exist**.
2. **The IVM `Take` operator's edit branch is the only change branch that
   does not tolerate an empty window**
   (`packages/zql/src/ivm/take.ts`). `Skip` (the `.start()` cursor) forwards
   an edit whenever the old and new rows both sort past its bound — per the
   in-memory comparator, which handles NULLs correctly and therefore
   disagrees with the SQL above. The forwarded edit hits
   `assert(takeState.bound, 'Bound should be set')` and the view-syncer dies.

Both defects are live from `@rocicorp/zero@1.5.0` (this repro's pin) through
`1.6.2` (latest at the time of writing) and on `rocicorp/mono@main` — the two
affected sources are byte-identical across all three.

## What this is

A real `@rocicorp/zero@1.5.0` stack — Postgres 17 (Docker) → zero-cache → a
real `Zero` client (in-memory kv store) — driven through one choreography,
three times:

1. seed six rows; three have a NULL `shelf` (the first sort key)
2. the client registers `item.orderBy('shelf').orderBy('id').start({id: 'item-2', shelf: null}).limit(5)`
   — the page strictly after a NULL-sorted row, which should hold 4 rows
3. `UPDATE item SET name = … WHERE id = 'item-5'` — a row whose old and new
   positions both sort past the cursor bound

| Leg | Build | Window hydrates | After the UPDATE |
| --- | --- | --- | --- |
| `stock` | unpatched 1.5.0 | **0 rows** (defect 1) | **view-syncer dies: `Bound should be set`** (defect 2) |
| `take-only` | Take fix only | 0 rows (defect 1 still) | survives; the row surfaces as an add (0 → 1) |
| `both` | Take fix + NULL-bound fix | **4 rows** (correct) | the update lands live in the window |

The verdict reads zero-cache's own log for the assert and the client's
materialized view for the window contents — both machine-checked.

## Quick start

Requires [Bun](https://bun.sh), Docker (Compose v2), Node 22+:

```bash
bun install
bun run demo    # runs all three legs (each resets the sandbox), prints the verdict
```

Expected output (abridged from a real run):

```text
================= SUMMARY =================
stock      window 0 -> 0 | update reached client: false | "Bound should be set": true
take-only  window 0 -> 1 | update reached client: true | "Bound should be set": false
both       window 4 -> 4 | update reached client: true | "Bound should be set": false

================= VERDICT =================
PASS  stock: cursor window hydrates EMPTY (NULL-bound defect)
PASS  stock: view-syncer dies with "Bound should be set"
PASS  take-only: view-syncer survives the update
PASS  take-only: updated row surfaces as an add (0 -> 1)
PASS  both: cursor window hydrates the 4 rows past the bound
PASS  both: update lands live in the window

Reproduction confirmed: stock crashes + hydrates empty; the fixes restore both.
```

Or step through one leg at a time:

```bash
bun run patch:none        # or patch:take-only / patch:both
bun run leg stock         # resets the sandbox, runs the choreography, writes .tmp/result-stock.json
```

`.tmp/zero-cache-<leg>.log` holds each leg's zero-cache log — the stock leg's
contains the full `Bound should be set` stack:

```text
Error: Bound should be set
    at assert (out/shared/src/asserts.js:3:16)
    at #pushEditChange (out/zql/src/ivm/take.js:240:3)
    at Take.push (out/zql/src/ivm/take.js:130:31)
    at maybeSplitAndPushEditChange (out/zql/src/ivm/maybe-split-and-push-edit-change.js:11:51)
    at Skip.push (out/zql/src/ivm/skip.js:58:11)
```

## The fixes

The two patch files under `patches/` are minimal builds of the proposed
upstream fixes (against the published 1.5.0 bundle; the affected sources are
unchanged through 1.6.2 and `main`):

- `patches/take-only.patch` — `Take.#pushEditChange` treats an empty window
  like the add-, remove-, and child-change branches already do: the new row
  surfaces as an add (the window has room — `size 0 < limit`).
- `patches/both.patch` — additionally compiles NULL cursor bounds into
  null-safe start constraints (after a NULL bound = `IS NOT NULL`; before it
  = `FALSE`; tie-break equality = `IS`).

Upstream PRs: TAKE_PR_LINK · NULL_PR_LINK
