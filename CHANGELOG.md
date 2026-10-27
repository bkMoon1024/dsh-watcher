# Changelog

## 0.7.2 — 2026-10-27

An adversarial review pass over the whole plugin (host fold, live client, pricing, settings) fixed two crash paths, a wrong-money path, several privacy and lifecycle defects, and the edge cases around streaming time, history paging and keyboard layering.

- Fixed a stack overflow in the fold: a tool call whose arguments nest thousands of levels deep (or a result whose content does) made `stableValue` / `textFromContent` recurse until `RangeError: Maximum call stack size exceeded`. It ran inside the Watcher's render memo, so the panel died with it. Both walks now stop at 32 levels and keep the remaining payload opaque.
- A streaming chunk without a usable `time` wrote `undefined` / `NaN` into `lastContentAt`, which the projection's `nullableTime` rejects — the view then failed validation and the persisted state drifted. Times that are not non-negative safe integers are now ignored, and an abandoned attempt settles at its last content time, so a five-hour pause between turns no longer books five hours of model time.
- Failure evidence no longer disappears for outputs over 64 KB: the fingerprint hashes the whole payload instead of returning `null` past a length cap, which used to reset the repeated-failure chain exactly when the output was big.
- Estimated cost honours the price table's unit: `per_1k_tokens` was charged at the per-million divisor, a 1000× overestimate. An unsupported unit is now Unknown rather than a silently wrong number.
- Estimated cost honours currency: a CNY row rendered as `$1.00`, and rows priced in two currencies were added together. The sign comes from the row (or table) currency, and a mixed-currency scan refuses the total and says so in the footnote.
- A corrupted pricing override can no longer break a render: `__proto__`/`constructor` model ids are skipped, a string `aliases` is dropped instead of throwing `TypeError`, and the effective table falls back to the built-in defaults when merging fails.
- The settings tab cancels its session scan when it is left or refreshed (it kept reading up to 500 sessions into a discarded render), and its two "saved" flashes are cancelled on unmount.
- Saving the alert thresholds clamps them to the range the reader accepts — a cleared number input used to persist `NaN` — and a storage that refuses writes no longer throws out of the click handler.
- Dragging the panel used to keep following the pointer after a release outside the window: the resize now captures the pointer, ends on `pointercancel`, and cleans its window listeners up on unmount.
- The keyboard listener is registered once per open instead of on every render; an Esc pressed during the inspector's exit animation no longer also collapses the path, and the arrow keys are inert while the tools menu is open.
- Following the live path restores itself when the rail is scrolled back to the bottom; the unread badge used to keep counting under a frozen rail. The filtered turn list is memoized.
- Alerts and scans tolerate malformed input (`findings: [null]`, a row that is not an object) instead of throwing, and a missing session binding degrades to an empty panel rather than throwing during render.
- Remote images in recorded markdown render as links, so opening a record no longer makes the browser fetch a third-party URL chosen by the model or a fetched file.
- Calendar buckets step with `setDate`, so a DST time zone no longer duplicates or drops a column, and the 7/30/180-day totals use the same calendar window the chart draws.
- The open panel refolded the whole session on every streaming delta; a 20k-event session folds in ~130 ms, so a long turn spent the main thread re-deriving a picture it had just derived. Live folds now coalesce to a bounded rate that backs off with the measured fold cost, and the settling snapshot is folded immediately.
- The follow rail rebuilt the full occurrence-id list on every republished picture even though only the newest occurrence can add unread progress; that list is now built when the newest occurrence changes, so streaming no longer allocates one string per item per delta.
- Itemized mode computed the grouped-mode projections (clustering every item of the phase, filtering every step for a model trace) on each live tick and then discarded them; both are now grouped-mode only.
- A search filter still unfolds every matching phase, but an explicit collapse now wins: the chevron used to write a fold the filter immediately ignored, so it looked broken until the filter was cleared.
- Durations round consistently: 59.96 s reads `1 分 0 秒` instead of a `60.0 秒` that contradicted the next line.
- CI runs the check job with `permissions: contents: read` and does not leave the checkout token in `.git/config`.

## 0.7.1 — 2026-10-24

- The compatibility note now tracks the 0.2.x line: verified against DeepSeek Harness 0.2.1-rc.3. The peer range is unchanged (`>=0.1.7-rc.1 <0.1.8 || ^0.2.0-rc.1`); both READMEs now state plainly that 0.3.0 and above are refused by the plugin manager as `incompatible-version`.

## 0.7.0 — 2026-10-20

- Fixed the panel shell after the flattening: `Watcher.tsx` composed the readout wrapper, the path section, the timeline body, the empty-readout note and the 执行路径 toggle out of classes that were declared in `panel.module.css` but looked up on `Watcher.module.css`, so they resolved to `undefined` — the readout lost its padding and the toggle rendered as a bare browser button in the middle of the card. The shell layout now lives in the stylesheet of the component that renders it, the toggle is its own `panel/PathToggle` component, and a new contract test binds every `css.<name>` a component reads to a class actually defined in the stylesheet it imports (it caught an unstyled icon path on the first run). Model values show the model name with provider and thinking level as the note instead of truncating the whole route, the compact timing row leads with the duration, and the flat readout keeps a 14px rhythm between its blocks.
- The panel became a reading surface: a 44px status bar (state dot, state word, current action, and search / view-menu buttons), the turn usage readout as the main window, and the execution path as a fold-out below it. The status bar is a plain read-out again — it does not move or click — and the command bar, the permanent path toolbar and the whole-session HUD are gone. The path has its own 执行路径 toggle row between the readout and the timeline: it carries the loaded-turn/step/execution counts and a chevron, starts folded, and the search and view-menu buttons unfold it first. Collapsing it returns the card to its content height instead of leaving the persisted drag height empty.
- The usage readout leads the panel instead of opening in a popover, and it is flat now: the heading is a quiet label instead of an accent bar, the four numbers (模型 / 上下文 / Token / 估算费用) are a label-over-value grid instead of tinted pills, the timing section drops its bordered box for a hairline 8px distribution bar, its status pill becomes a dot plus text, and the alerts are hairline rows with a text action instead of bordered cards with a host button. The path section under it owns the timeline; a record located from an alert unfolds the path before scrolling.
- Timeline rows are single-line: 33px turn headers, 30px phase headers and 26px records. A Step with exactly one record and no model stage flattens into that record row — its step number moves into the meta line — instead of spending a header on one row. Turn total, phase span, record time and live tok/s stay; the phase duration-share bar is gone.
- The client is split into a panel module: new `src/client/panel/` with `panel-model.ts` (filter projection, flattening, meta/signal/cluster copy) plus `PanelHeader`, `SearchRow`, `ViewMenu`, `PathTimeline`, `TurnSection`, `PhaseSection` and `OccurrenceRow`. `Watcher.tsx` keeps only state and composition (830 lines) and `Overview.tsx` is deleted. `Watcher.module.css` dropped from 1992 to 989 lines, keeping only the shell, inspector, model stage and resize handles.
- The presentation contract now pins the new structure (the usage readout before the foldable path section, the 执行路径 toggle as its control with `aria-expanded` and `aria-controls`, two `data-watcher-overlay` regions, exactly one flat `SessionInsights`, which border belongs to the status bar, the stat grid, quiet alert rows, flattened Steps and cluster folding), and `tests/panel-model.test.mjs` covers the new pure view model.
- Fixed the phase and cluster rows: they laid a variable number of chips (parallel / retry / iteration, state tag, counters) into a fixed four-column grid, so the extra chips wrapped onto a second line and the fixed row height painted that line over the next row — in a wide panel the path read as two lists stacked on each other. Those rows are single flex lines again, phase rows are indented under their turn (with their children), a failed phase no longer repeats the turn's 有失败记录 tag, and the contract test keeps fan-out rows off a fixed grid.
- Fixed the sticky turn header: it inherited the host menu token, which is translucent, so a phase row could be read through the header while scrolling. The header now paints an opaque copy of the surface token (the popovers do the same), and the contract test pins it.
- Fixed the usage readout in a narrow panel: the timing header laid its title, live speed, total duration and bottleneck sentence on one nowrap line, so they collided. In the compact layout the header stacks into two rows instead.

- The client got a structure pass without changing behaviour: `Watcher.tsx` went 2029 → 758 lines, and `Insights.tsx` (2142 lines) split into `SessionInsights`, `InsightsSettings`, `Inspector`, `Overview`, `ModelStage`, an `insights-analytics` module and six `insights-sections/` files. The style modules went from three to five, one of them a shared vocabulary. The presentation contract still pins the same icons, labels and wiring strings.
- Every style module now reads one `--ui-*` alias layer (`src/client/ui/tokens.module.css`) instead of picking `--dsw-*` tokens ad hoc: hard-coded hex is at zero, no module touches `--dsw-static-*`, and no `var(--dsw-*, fallback)` pair remains. The layer is mounted as a class on each client root — cross-file `composes` does not survive the plugin's css-modules build — so theme tokens still reach children by inheritance.
- Host primitives replace hand-rolled controls where they exist: `Button` and `Input` from `@deepseek-ai/dsh-client-ui-primitives` now back the settings save/refresh actions and the numeric limits, and a new `ui/SegmentedToggle` reproduces the host segmented-control recipe for the organize/depth, scope, model and range switches. It is a labelled `role="group"` of toggle buttons rather than the host's `SegmentedControl`, because those switches change how the same content renders and own no panel to name in `aria-controls`.
- Depth is one host elevation token and one border again: the local bevel highlight, the stacked contact/main/ambient shadows and the decorative chart glows are gone, hover states use host fills and the focus ring instead of `filter: brightness()` and card lift, and the ring itself comes from `--dsw-focus-ring-*`.
- Accessibility: the HUD's headline cards and the ledger rows are real buttons again — they were clickable `div`s unreachable by keyboard — prose labels sit at the host's 11px floor, small controls grew to a 24px hit target, and the heatmap crosshair is an outline instead of a colour filter.
- The settings page no longer recomputes its analytics inside the render path: aggregation, distributions and the session ledger are derived once per scan and only rebuild when the scan result or the range changes.
- A failed scan now reports itself instead of rendering like an empty ledger, a first scan is told apart from "nothing recorded yet", and sessions the scan left out are named in the totals footnote.
- Removed the dead history-notice and session-timing style blocks plus ~30 unreferenced classes; the panel's drag/resize/clamp logic moved into `panel-geometry.ts` (`usePanelGeometry`), leaving the component to render.

- Work-category colour stays on the path. Every phase owns a hue (plan, investigate, build, verify, activate, desktop, answer, model, wait, failure), now painted only on its marker and the 2px left rail of its phase header; running state and live tok/s use the host business blue, and the brand ink stays reserved for selection. The timing series and chart palette were rebuilt from the host static swatches, because semantic tokens only expose four states and the previous accent-based ramps had collapsed into grey.
- Path search and filtering stayed, moved off the header: the search row carries the query and the 全部/异常/等待 status filter, and history paging walks backwards one page at a time (`loadOlderPage`) with 载入全部历史 kept as the heavier secondary action. Filtering narrows phases to their matching occurrences and auto-expands them, and a search with no hits says so instead of showing an empty rail.
- The inspector no longer repeats the execution path it was opened from. It keeps the header, metrics and 结果/输入/原始 tabs, and gains a record stepper — 上一条 / 下一条 plus a `记录 K/M` position, wired to the arrow keys — so the selected record can be walked without going back to the path. The detail tabs now carry `id`/`aria-controls`/`tabpanel` semantics, which they lacked.
- Escape is layered: with a record open it closes only the inspector and returns focus to the path; with no record open it closes the panel. Arrow keys move between records while the inspector is open, except inside inputs and editable content.
- A panel widened past 980px docks the inspector beside the path instead of covering it, so both stay visible; narrower panels keep the overlay drawer. The threshold is measured with a `ResizeObserver` on the panel, not a viewport media query, because the panel can be dragged wider than the window breakpoints suggest.
- The settings page is four tabs — 概览 / 趋势 / 会话 / 偏好 — instead of one long dashboard. Each tab owns its section, the time-range control hides on 偏好 (it does not apply there), and drilldowns open as a dialog over the page (backdrop, Escape, focus restored to the card that opened it) instead of inserting a block that pushed the rest of the page down.
- The session ledger gained a search box, a 显示更多会话 pager (ten rows at a time) and a total-count footnote; the sort control stays in the header row.
- The path filter lives in component state, so switching sessions resets it with the rest of the panel state; `locateEvidence` clears it before scrolling to the failing record.
- Fixed a dangling selector list in `Watcher.module.css`: the focus-visible rule for the unread button and the disclosure toggles had lost its declaration block (its declarations had been swallowed by `.railViewport`), so those controls had no visible focus ring. The rule is restored and the new stepper and back buttons join it.
- Removed the dead inspector execution-list styles (14 classes: `.executionSection`, `.sectionHeading`, `.executionList`, `.stepBlock`, `.stepHeading`, `.stepSignals`, `.stepDuration`, `.occurrences`, `.occurrence*`, `.occurrenceCopy`, `.occurrenceChevron`) now that the inspector no longer renders that list; the contract test asserts the durations where they actually render (`.overviewStepSignals`, `.overviewOccurrenceDuration`).

## 0.6.3 — 2026-10-18

- The panel is solid now: an opaque body over a 1px scribe border, a top bevel highlight and a layered contact/main/ambient shadow stack, with the chart tooltip and the timing card sharing the same surface. `--watcher-surface`/`--watcher-layer` are redefined solid and the `prefers-reduced-transparency` fallback is gone, because solid is the default.
- The header is a two-row command bar: a status line (dot, state, live action, follow) over a sunken control row (counts and history loader, organize/depth segments). Turns read as chapters with a tabular turn-number block, and the inspector is a covering right drawer that slides over the work path instead of pushing it — the path never reflows and the panel keeps its width — so the work path column widened 720 → 760.
- Phase rows collapsed from an 80–100px two-deck header to one 34px line: marker, chevron, title and badges, right-aligned step/execution/duration counters, with the full wording kept in the aria-label. Each row also carries a 2px duration-share bar at its base (phase elapsed over turn total, 6% floor), so the time distribution reads at a glance without costing row height; the list holds about 2.5× more rows per panel.
- The settings page and HUD were retuned on one token system: four equal metric tiles plus a scan-scope footnote, six insight cards with `data-tone` semantic colour and a promoted metric line, emoji-free drilldowns with plain rank badges and rounded tracks, a single segmented-control recipe for the range/scope/sort/view switches, and hard-coded hex accents replaced with dsw tokens and `color-mix`.
- Collapsed disclosure bodies unmount instead of hiding, so folded content costs no DOM and no reconciliation (measured: 153 nodes in the overview versus 410 in detail). `PhaseOverview` is memoized against callbacks and `now`, each phase owns its live clock so only the executing phase subscribes to the 1Hz tick, turns get `content-visibility: auto`, and the command dot pulse moved off a `box-shadow` animation onto opacity/transform on a pseudo-element.
- Runtime peers now accept the `0.2.0-rc.x` window (`>=0.1.7-rc.1 <0.1.8 || ^0.2.0-rc.1`) alongside the 0.1.7 line; development still tracks 0.1.7-rc.2.
- A resized panel is now a remembered preference: the size persists in `localStorage` (clamped to the current viewport on restore) across reopens, page refreshes, and app restarts. A size restored from storage may be shrunk on its next drag (a restored size is a preference, not a floor), and double-clicking the corner grip returns the panel to its anchored auto layout — previously a resize could never be undone. A shrinking window now pulls the panel and its size back on-screen instead of stranding it off-viewport.
- The settings scan now truncates by recency: `scanSessions` sorts unique sessions by `updatedAt` (descending) before applying the cap, so a capped aggregate always covers the newest sessions instead of an arbitrary list prefix. The settings page raises its scan limit to 500 (the existing internal ceiling) and says so when truncated: the "有统计的对话" line shows `valid / scanned` plus a "仅统计最近 N / 共 M" footnote instead of silently under-reporting.
- Sessions without an `updatedAt` stamp are no longer bucketed into today's column of the daily chart; they now stay out of every day bucket rather than inflating the newest bar.
- The HUD heading no longer labels whole-session totals as "本轮": before the first Turn starts, the heading switches to "全会话" with a "本轮未开始 · 已显示全会话" note. The context line is likewise relabelled "累计输入" in session scope (it is cumulative input, not a context size); "上下文" stays in turn scope.
- The TimingPanel live `t/s` badge is finally wired: the Watcher panel passes the current Turn's measured decode throughput into the HUD, so the speed dot shows while a turn has both output tokens and decode time. Session scope intentionally omits it (no single throughput semantics).
- The header eye button's tooltip now mirrors its live state (`Watcher · 正在执行`), and the settings refresh button explains why it is disabled when the session remote is unavailable.
- The fold got materially cheaper without changing what it produces. A tool item now probes exit code, signal, error flag and domain outcome in one walk of its result tree instead of four independent depth-first searches; the snapshot location table and trajectory node list are built once per fold instead of twice; per-status `some()` scans became one pass; the per-Turn group scan became a single bucketing pass; and the six whole-list `filter()` counters became one counting pass. On a real 3,409-event session the fold is 37% faster (35.4ms → 22.1ms) with byte-identical output across old and new implementations.
- The panel no longer folds while it is closed. The Watcher is mounted in the session header for the whole page lifetime, so folding unconditionally made every streaming delta pay for a picture nobody was looking at; the closed trigger now reads the live session flags directly (`running`, pending interactions, blank) instead of a stale picture, and still reports a failed or interrupted turn by reading the node that closed it.
- The retained-occurrence merge is bounded (4,000 items), so an extremely long page cannot grow the merged picture without limit; it still bridges the sliding official window.
- The projection's stale-`seq` diagnostic set is bounded instead of growing once per session for the process lifetime.
- The ticking clock moved out of the `aria-live` region (only the coarse state is announced now), so screen readers no longer re-announce the panel once per second.
- `presentation-contract` accepts the widened peer window (`>=0.1.7-rc.1 <0.1.8 || ^0.2.0-rc.1`) through one regex instead of pinning the older single range, which had been failing since the compat commit.
- Added a GitHub Actions workflow: typecheck, build and test on Node 22.19 and 24, on pushes to `main` and on pull requests.

## 0.6.2 — 2026-09-28

- The projection fold copies only the state branches an event writes instead of `structuredClone`-ing the whole state per event. The host contract is unchanged: a handled event returns a fresh reference, an ignored one returns the same reference, and previously published states are never mutated (now pinned by a test).
- Oversized payloads are rejected in `fingerprint` before serialization (a cheap structural size pre-check), so multi-MB write/edit arguments no longer pay a full `JSON.stringify` only to be dropped. Hash values are unchanged.
- Usage reports that only carry `totalTokens` are metered as unsplit tokens instead of being dropped; the pricing layer already shows unsplit tokens as 未知, never $0. Partial bucket shapes are still rejected.
- One `tool/result` message can settle several `tool-result` blocks (batched parallel calls); previously only the first block was settled and the rest leaked as pending tool time. The callId fallback also accepts a top-level `callId`.
- Restored projection state keeps each model row's `effort` tag: `stateSchema` declared it for the wire view but stripped it from state, so a restored session could split one model into duplicate rows.
- A stale event `seq` (state regression) now warns once per session via `ctx.logger` instead of silently freezing the fold with no symptom.
- Client render costs that used to run at the 1Hz live clock are memoized: group clustering, per-item position and source-step lookups (was O(n²) per render), the stacked line spline, and the HUD cost estimate. The number formatter is cached instead of rebuilt per call.
- The model scope filter keys on provider/model/effort instead of list position, so a re-sorted model list cannot silently retarget the selection; donut hover state and list keys use model identity for the same reason.
- The work-path follow snapshot reuses its previous object while unchanged, so scrolling no longer re-renders the panel per scroll event. Panel resizing coalesces pointer moves to one commit per frame and flushes the last one on release.
- The picture merge is idempotent per snapshot (StrictMode double renders cannot double-merge), the follow effect tracks the picture instead of only the last-activity key, and the HUD collapse toggle writes `localStorage` outside the state updater.
- The client bundle is minified (448KB → 260KB, gzip 63KB) with the sourcemap kept for debugging; the node-side projection stays unminified and readable. Icon names survive as external property names, and the presentation contract still pins them.
- Fixed the vendored client-build adapter externalizing all local modules on Windows: its "is local" check only recognized `./` and `/` prefixes, while bundler-resolved ids are drive-letter paths, so `lib/dsh-watcher.js` was emitted as a thin wrapper importing an unpublished `./insights/projection.ts`. `isAbsolute()` now covers both.

## 0.6.1 — 2026-09-24

- Prove Watcher on official DeepSeek Harness **0.1.7-rc.2** (`dsh-v0.1.7-rc.2`, `@deepseek-ai/dsh@0.1.7-rc.2`, commit `477b4f420553e8a52c2fbccc464d7561b239c443`). Dev pins are `0.1.7-rc.2`. `@deepseek-ai/dsh-*` peers stay `>=0.1.7-rc.1 <0.1.8`, which already accepts `0.1.7-rc.2` and still rejects `0.1.7-alpha.*`. `@deepseek-ai/cordis` stays `~4.0.4`.
- Keep the rc.1 stroke icons: `IconChevronRightOutlineRegular`, `IconRefreshOutlineRegular`, `IconCheckOutlineRegular`, and `IconCopyOutlineRegular`. rc.2 still does not export `IconChevronRightOutline14`, `IconRefreshOutline14`, `IconCheckOutline16`, or `IconCopyOutline16`.
- The vendored client-build adapter from PR #13 remains the build path. The Watcher client entry, CSS modules, and Regular icon names are the same bytes this release ships.

## 0.6.0 — 2026-09-23

- Target official DeepSeek Harness **0.1.7-rc.1** (`dsh-v0.1.7-rc.1`, `@deepseek-ai/dsh@0.1.7-rc.1`, commit `46a7f68b0922371ce7144b668b90e377d8e799f4`). `@deepseek-ai/dsh-*` peers are `>=0.1.7-rc.1 <0.1.8`, which accepts `0.1.7-rc.1` and rejects `0.1.7-alpha.*`. `@deepseek-ai/cordis` peer is `~4.0.4`.
- Client icons follow the rc.1 stroke set: `IconChevronRightOutlineRegular`, `IconRefreshOutlineRegular`, `IconCheckOutlineRegular`, and `IconCopyOutlineRegular`. rc.1 removed the size-suffixed names (`Outline14` / `Outline16`) with no aliases. Main at 0.5.1 still used those names because 0.1.5-rc.3 still exported them.
- Read, diff, and terminal cards supply the rc.1 toolbar and `noExitCode` labels. The diff card no longer passes the removed `files` label.
- The header utility reads the waiting interaction from `useSessionStatus`. rc.1 no longer passes `useSessionPendingInteraction` into that slot.
- A running tool call in the `preparing` phase has no arguments yet. Only the `start` phase supplies `argsRaw`.

## 0.5.1 — 2026-09-22

- Target official DeepSeek Harness **0.1.5-rc.3** (`dsh-v0.1.5-rc.3`, `@deepseek-ai/dsh@0.1.5-rc.3`). `@deepseek-ai/dsh-*` peers are `^0.1.5-rc.3`, which accepts `0.1.5-rc.3`. The previous `^0.1.2-rc.1` range does not.
- Client icons stay `IconChevronRightOutline14`, `IconRefreshOutline14`, `IconCheckOutline16`, and `IconCopyOutline16`. Those exports still exist on 0.1.5-rc.3.
- `pnpm test` typechecks against the 0.1.5-rc.3 packages. `@types/node` is a devDependency so that check resolves Node types without a Harness checkout.

## 0.5.0 — 2026-09-21

- The panel is resizable from its right edge, bottom edge, and the corner grip. The panel frame stays put while dragging — only the size changes — and the floor is the size it opened at, so it can grow but never shrink below the layout it needs.
- The insights HUD collapses to its one-line top bar via a `▾` toggle next to the scope switch; the choice is remembered in `localStorage`.
- `定位现场` now actually lands on the failing work: it finds the item matching the alert's turn and step, opens the inspector on it, and scrolls the rail to that turn instead of scrolling to a bare turn header with nothing highlighted.
- Repeated-failure cards no longer duplicate: the finding id is anchored on the operation signature instead of the first failing seq, so a chain that grows past the trimmed history updates its single card in place. Titles now name the turn (`第 N 轮 · 同一操作连续失败 N 次`).

## 0.4.5 — 2026-09-21

- Closing the inspector no longer silently re-arms follow. The `←` back control now clears the pinned selection and leaves the rail where the user left it; only the `查看最新` unread pill still jumps to the newest work.
- Insights settings no longer rescans the whole session list on the first manual range pick: `userPickedRange` is a ref now, so the scan effect runs once per `remote` change. The manual refresh button also no longer writes state after the panel unmounts.
- The Host projection state no longer stores a copy of its own wire view. `viewOf` now derives and caches the view by state identity, so every persisted checkpoint and every per-event `structuredClone` stops carrying a redundant snapshot of itself.
- Timing panel hover card stops claiming the non-terminal slice is "文件读写": it is every non-bash tool, so the title, total, per-call average and verdict labels now say what the number actually is.
- Removed the dead auto-load `useEffect` stub in the Watcher panel and the contract test that pinned it; the test now asserts the explicit history-load button instead.
- Removed the unused `PRICING_OVERRIDE_FILE` constant that pointed at a file path nothing ever wrote.
- Projection warm-up failures are logged via `ctx.logger.warn` instead of being silently swallowed.

## 0.4.4 — 2026-09-19

- Fixed the docked detail column having no way back. `返回工作路径` was hidden by CSS at desktop width, so an opened inspector could not be collapsed at all.
- Closing and opening the inspector is one motion instead of an instant mount/unmount: the detail content leaves toward the work path first, then the column narrows, so the closing edge never slices a readable line. Opening runs the same beats in reverse.
- Fixed the whole Watcher panel flicking left and right during that motion. A clamped panel derives its inline `left` from its own width, and the resize observer re-derived it a frame after layout; the measured frame is now pinned for the transition so only the left edge moves.
- Fixed the inspector header's status line (`对话轮次 … · … 个步骤 · …`) slipping under the work-path card: docked children now use `border-box`, and an over-long status or metadata line wraps instead of being covered.
- Contract tests now pin the docked close control, the content-first collapse beat, the header line staying inside the column, and the pinned panel frame.


## 0.4.3 — 2026-09-19

- npm release of the estimated-cost feature set (same as git `0.4.2`). Use this tag on the registry; `0.4.2` was staged but never became installable.

## 0.4.2 — 2026-09-19

- Added **估算费用 / Estimated cost** next to total token usage on the Watcher insights HUD and the settings summary. Input, output, and cache buckets are priced from the matching rate; a missing model or missing bucket shows **未知 / Unknown** and is never treated as $0.
- Default list prices live in `pricing/models.yaml` (USD per 1M tokens). Official preferred rows win for DeepSeek off-peak (2026-09-18), MiniMax-M2.7 / highspeed pay-as-you-go (2026-09-18), and Anthropic flagship (2026-09-19). Other mainstream OpenAI / Gemini / Grok / GLM / Qwen rows are OpenRouter USD/1M as of 2026-09-19 and may differ from vendor list prices. Rates lag official pages. v1 does not fetch live prices.
- Settings hero Token / 估算费用 share one two-column skeleton (caption, same-size number). The caption already says 估算费用, so **估算，非账单** is not repeated under the dollar. Partial estimates keep the known dollar in the main number and add a quiet **含未标价模型 / Some models unpriced** line only when needed — never `$x + 未知`.
- Settings price editor opens with the **currently effective** table (defaults filled in). Save stores only the diff vs defaults in `localStorage['dsh-watcher:pricing-override:v1']`; reset restores defaults in the editor. Missing rates still show 未知, never $0.

## 0.4.1 — 2026-09-18

- Fixed chart hover cards being cut off at the panel edge. Bar, stacked-line, and heatmap popovers are now portalled to the document body and clamped into the viewport, so a card opened on a late bar keeps its model names, token values, and percentages readable instead of losing its right-hand side to the panel's `overflow: hidden`.
- Hover cards are anchored to the measured bar/cell/point rectangle rather than a percentage of the chart width, so they follow their own bar instead of the chart's midpoint.
- The heatmap popover now closes when the pointer leaves the chart area.

- First-turn `本轮` HUD now copies `request/header` into the open `turn.route`, so the tag shows the real model instead of the initial `unknown` snapshot.
- Stock install is `dsh plugin --profile web add github:daha1216/dsh-watcher` (pnpm on PATH, then restart the Host and reload). `dsh.bundle.patch` and committed `lib/` make that git spec boot without a `prepare` script.

- Opening Watcher now restores every older conversation Turn automatically through RC8's public Session paging API. Normal use has no manual "load all" step; paging progress is passive, and a retry appears only when the official loader is busy or cannot advance.
- Added whole-session Turn/Step projections so the progressive UI can show loaded-versus-total evidence while RC8 pages arrive.

- Added independent disclosure for conversation Turns, phases, Steps, and repeated-operation clusters.
- Added `逐项 / 归类` observation modes over the same immutable execution evidence.
- Kept singleton actions direct in grouped mode and made every `×N` summary expandable to its exact source occurrences.
- Restricted grouping so different Bash, Glob, Grep, and search arguments never merge from a shared cwd, path, tool name, or translated label.
- Added evidence-backed grouping for repeated exact calls, mutable operations on one target, and reads of one exact file target.
- Fixed delayed approval/interaction records re-inserting an earlier Step below a later Step; Turn and Step coordinates now own the rail order, while event sequence only orders records inside one Step.
- Replaced the ambiguous mathematical lower-bound label (`≥`) with `已记录 … · 开头未载入` when RC8 omits a Turn's starting boundary.

## 0.3.0 — 2026-08-21

- Added a session wall-clock ledger: complete/current-window span, time inside conversation Turns, and gaps between Turns.
- Added elapsed time at every diagnostic level: conversation Turn, phase, Step, and individual execution.
- Added per-conversation-turn total duration and live elapsed time.
- Added model time, tool time, first-token latency, and measured decode throughput.
- Kept token speed evidence-based: provider output tokens divided by decode time only, with no fallback estimates.
- Fixed live tool results falling into session preparation when Trajectory omitted their location but the official Chat index still had it.
- Replaced the action-implying `需要处理` label with evidence-only `有失败记录`; only a pending approval or question says `等待你`.
- Replaced the game-like Chinese term `回合` with `对话轮次` labels.

## 0.2.0 — 2026-08-20

- First public release under the Watcher name.
- Added a truthful four-level work path: turns, phases, steps, and executions.
- Preserved parallel branches and individual execution evidence.
- Added typed result readers for terminal output, files, diffs, JSON, Markdown, and raw data.
- Added Follow behavior, responsive drill-down, reduced-motion support, and subtle live eye motion.
- Targeted DeepSeek Harness `0.1.0-rc.8` and the dshx external client build contract.
