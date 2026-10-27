# dsh-watcher — agent notes

Read-only DSH client plugin. It renders the recorded work path, usage and estimated cost of the current session in a header panel, plus a session-insights settings page. It never steers a session and never makes a network request.

## Commands

- `pnpm install --frozen-lockfile` — installs dev deps and links the harness packages. If the pnpm store stalls, retry with `--ignore-scripts --network-concurrency=4`; `pnpm build` still works afterwards.
- `pnpm typecheck` — `tsc -p tsconfig.json --noEmit`.
- `pnpm test` — compiles `lib/types/` first, then `node --test tests/*.test.mjs`. Most suites import the compiled `../lib/types/...`, so run this instead of a bare `node --test`.
- `pnpm build` — `tsc` + `tsdown`. The committed `lib/` bundles are the plugin entry (`lib/dsh-watcher.js`) and the client bundle (`lib/client.js`); rebuild before every commit that touches `src/`.

## Stack

TypeScript strict, React 18, zod 4. The host entry `src/dsh-watcher.ts` registers the `watcherInsights` session projection; the client entry `src/client/index.tsx` fills `settings.section` and `conversation.session.header.utilities`. Bundles come from tsdown, client CSS modules from lightningcss (`tools/client-build.js`). Node `^22.19.0 || >=24.0.0` (tests rely on built-in type stripping).

## Layout

- `src/insights/` — host projection. `engine.mjs` folds recorded events into usage, tool and failure stats; `projection.ts` validates state/view with zod; `pricing.mjs` prices token buckets; `presentation.mjs` scans sessions for the settings page; `i18n.mjs` holds host copy.
- `src/observation/` — `fold.ts` turns a client snapshot into `WorkPicture` (turns → phases/steps → items), `model-trace.ts` folds per-step model attempts, `performance.ts` derives turn intervals.
- `src/hub/` — pure view model: aggregation, follow/pin state, overview phrases, history paging.
- `src/client/` — panel (`panel/`), inspector, settings sections, geometry and display helpers.
- `tests/` — node:test behavior and contract suites. `tests/presentation-contract.test.mjs` pins the host primitives the client is required to use.

## Conventions

- Comments explain why a decision exists; never restate the line.
- Raw evidence stays exact. The `原始` tab shows recorded bytes and previews may truncate; recorded output is untrusted, so render it through host primitives, rewrite remote images to links, and never use `dangerouslySetInnerHTML`.
- Every user-visible string is localized (zh/en); host-side copy lives in `src/insights/i18n.mjs`.
- Behavior changes update `DESIGN.md`, `CHANGELOG.md` and both READMEs in the same commit.

## Status

0.7.2 hardens what 0.7.1 assumed: tool results settle on the real `message.isError` / `message.toolCallId` shape, deep nesting no longer overflows the fold stack, pricing honours `unit`/`currency` and refuses mixed totals, live folds coalesce, and day buckets are calendar-correct across DST. Known open items: reasoning-text concatenation is O(n²) per delta, a running row that scrolls out of the snapshot window keeps a stale status, and `tsdown.config.ts` imports the harness from `DSHX_HARNESS`.
