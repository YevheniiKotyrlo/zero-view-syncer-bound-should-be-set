# zero-cache: NULL cursor bounds break sliding windows, and a forwarded edit kills the view-syncer with "Bound should be set"

[![stock — expected failing](https://github.com/YevheniiKotyrlo/zero-view-syncer-bound-should-be-set/actions/workflows/stock.yml/badge.svg)](https://github.com/YevheniiKotyrlo/zero-view-syncer-bound-should-be-set/actions/workflows/stock.yml)
[![fixed — all tests passing](https://github.com/YevheniiKotyrlo/zero-view-syncer-bound-should-be-set/actions/workflows/fixed.yml/badge.svg)](https://github.com/YevheniiKotyrlo/zero-view-syncer-bound-should-be-set/actions/workflows/fixed.yml)
[![fix-isolation matrix](https://github.com/YevheniiKotyrlo/zero-view-syncer-bound-should-be-set/actions/workflows/reproduce.yml/badge.svg)](https://github.com/YevheniiKotyrlo/zero-view-syncer-bound-should-be-set/actions/workflows/reproduce.yml)

> **How to read the lights.** The same four-test correct-behavior spec runs
> twice: against the **stock** build it is RED — the three bug-named tests
> fail while the harness-sanity test passes, so red means "the bugs are
> present", not "the repro is broken" — and against the **fixed** build it
> is GREEN. The third badge is the deep verdict: all four install variants,
> proving each fix resolves exactly its bug with no regressions.

Three related defects in `@rocicorp/zero`'s cursor pagination
(`.start(row)` + `.limit(n)` — the sliding-window shape), all manifesting in
the zero-cache view-syncer. Live in `1.6.2` (latest at the time of writing);
on `rocicorp/mono@main` every affected function is unchanged (the only drift
in the affected files since `v1.6.2` is unrelated `LIKE`-handling churn in
`query-builder.ts`):

1. **A NULL cursor bound hydrates an empty window.**
   `packages/zqlite/src/query-builder.ts` compiles a `.start()` bound row
   with a NULL sort value into `col > NULL` / `col = NULL` — never true — so
   the cursor walk silently restarts as empty. The null-safe branches exist
   but are dead for replica tables: the replica's column specs
   (`packages/zero-cache/src/types/lite.ts`) drop the `|NOT_NULL` attribute
   they're gated on — and even where the gate engages, a NULL bound compiles
   to over-matching SQL that only stays correct by being trimmed row-by-row,
   degrading the cursor into a scan from the top.
2. **A synced UPDATE then kills the view-syncer.** The IVM `Skip` operator
   (the cursor) forwards an edit whenever the old and new rows both sort past
   its bound — judged by the in-memory comparator, which handles NULLs
   correctly and therefore disagrees with the SQL above. The forwarded edit
   lands on the empty `Take` (the limit), whose edit branch is the only
   change branch that does not tolerate an empty window:
   `assert(takeState.bound, 'Bound should be set')` throws, and the
   view-syncer kills the whole client group with an Internal
   `ProtocolError` — every tab of that client disconnects.
3. **A backward walk below a non-NULL bound drops the NULL group.** SQLite
   sorts NULLs first, so the strictly-before set of any non-NULL bound
   includes every NULL-sorted row — but the compiled `col < ?` excludes
   them. Reverse pagination silently loses the whole NULL-valued head of the
   list.

## What this is

A real `@rocicorp/zero@1.6.2` stack — Postgres 17 (Docker) → zero-cache → a
synced-query API server → real `Zero` clients (in-memory kv store, **legacy
ad-hoc queries disabled** — the clients assert it) — driven through one
choreography, four times. Three probes, each its own client (its own client
group): `forward` (the page after a NULL-sorted anchor, should hold 4 rows),
`reverse` (the backward walk below a non-NULL anchor, should hold 4 rows
including the NULL group), `sanity` (the page after a non-NULL anchor — the
regression guard, 2 rows on every build). Then one
`UPDATE item SET name = … WHERE id = 'item-5'` — a row past the forward
cursor.

| Leg | Build | forward | reverse | sanity | After the UPDATE |
| --- | --- | ---: | ---: | ---: | --- |
| `stock` | unpatched | **0** (bug 1) | **1** (bug 3) | 2 | **view-syncer dies: `Bound should be set`** (bug 2); the sanity group keeps syncing — the blast radius is the poisoned group |
| `take-only` | Take fix | 0 → **1** | 1 | 2 | survives; the row surfaces as an add |
| `zqlite-only` | NULL-bound fix | **4** | **4** | 2 | lands live as an edit (the crash precondition is gone) |
| `both` | all fixes | **4** | **4** | 2 | lands live; nothing crashes |

The verdicts read zero-cache's own log for the assert and each client's
materialized view for the window contents — all machine-checked, in
`bun test` form (`tests/repro.test.ts`) and as a narrated demo.

## Quick start

Requires [Bun](https://bun.sh), Docker (Compose v2), Node 22+:

```bash
bun install
bun run demo        # the full four-leg matrix + verdict (also: bun run test)
```

The red/green pair, locally:

```bash
bun run patch:none && bun run test:current-build   # RED — the three bug tests fail on stock
bun run patch:both && bun run test:current-build   # GREEN — the same tests pass when fixed
```

Each bug is individually reproducible against stock:

```bash
bun run bug:empty-window   # bug 1 — forward window hydrates 0 rows (4 exist)
bun run bug:crash          # bug 2 — "Bound should be set" kills the group
bun run bug:reverse-drop   # bug 3 — reverse walk returns 1 row instead of 4
```

Expected `demo` output (abridged from a real run):

```text
=========================== SUMMARY ===========================
stock        forward 0 -> 0 | reverse 1 | sanity 2 | update fwd/sanity: false/true | "Bound should be set": true
take-only    forward 0 -> 1 | reverse 1 | sanity 2 | update fwd/sanity: true/true | "Bound should be set": false
zqlite-only  forward 4 -> 4 | reverse 4 | sanity 2 | update fwd/sanity: true/true | "Bound should be set": false
both         forward 4 -> 4 | reverse 4 | sanity 2 | update fwd/sanity: true/true | "Bound should be set": false

=========================== VERDICT ===========================
PASS  bug 1 (stock): forward window after the NULL-sorted anchor hydrates EMPTY
PASS  bug 1 (fixed by the zqlite patch alone): forward window hydrates the 4 rows
PASS  bug 2 (stock): view-syncer dies with "Bound should be set"
PASS  bug 2 (stock): the update never reaches the dead forward group
PASS  bug 2 (stock): the blast radius is the poisoned group — sanity still receives the update
PASS  bug 2 (fixed by the take patch alone): view-syncer survives the update
PASS  bug 2 (fixed by the take patch alone): the row surfaces as an add (0 -> 1)
PASS  bug 3 (stock): reverse window drops the NULL group (1 row instead of 4)
PASS  bug 3 (fixed by the zqlite patch alone): reverse window holds all 4 rows
PASS  both: forward window hydrates the 4 rows past the bound
PASS  both: reverse window holds all 4 rows
PASS  both: the update lands live with no crash
PASS  sanity: non-NULL-anchored window holds 2 rows on EVERY build
PASS  sanity: the update reaches the sanity window on EVERY build
PASS  sanity: no patched build crashes

Reproduction confirmed: all three bugs visible on stock, each fixed by its patch, no regressions.
```

`.tmp/zero-cache-<leg>.log` holds each leg's zero-cache log — the stock
leg's contains the full stack:

```text
Error: Bound should be set
    at assert (out/shared/src/asserts.js:3:16)
    at #pushEditChange (out/zql/src/ivm/take.js:240:3)
    at Take.push (out/zql/src/ivm/take.js:130:31)
    at maybeSplitAndPushEditChange (out/zql/src/ivm/maybe-split-and-push-edit-change.js:11:51)
    at Skip.push (out/zql/src/ivm/skip.js:58:11)
```

Or drive one leg by hand:

```bash
bun run patch:none          # or patch:take-only / patch:zqlite-only / patch:both
bun run leg stock           # resets the sandbox, runs the choreography, writes .tmp/result-stock.json
```

## The fixes

The patch files under `patches/` are minimal builds of the proposed upstream
fixes (against the published 1.6.2 bundle; the affected functions are
unchanged on `main`):

- `patches/take-only.patch` — `Take.#pushEditChange` treats an empty window
  like the add-, remove-, and child-change branches already do: the new row
  surfaces as an add (the window has room — `size 0 < limit`).
- `patches/zqlite-only.patch` — start-constraint compilation branches on the
  runtime bound value (after a NULL bound = `IS NOT NULL`; before it =
  `FALSE`; tie-break equality = `IS`), and the replica's column specs derive
  `optional` from the `|NOT_NULL` attribute they already record — which
  activates the existing nullable-column guard for backward walks. Non-NULL
  bounds on non-nullable columns keep today's index-friendly forms.
- `patches/both.patch` — both of the above.

Upstream PRs: TAKE_PR_LINK · NULL_PR_LINK
