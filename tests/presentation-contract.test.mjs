import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const clientDir = new URL('../src/client/', import.meta.url)
const watcherSource = new URL('../src/client/Watcher.tsx', import.meta.url)
const clientStyles = new URL('../src/client/Watcher.module.css', import.meta.url)
const panelStylesSource = new URL('../src/client/panel/panel.module.css', import.meta.url)
const timingStylesSource = new URL('../src/client/TimingPanel.module.css', import.meta.url)
const settingsStyles = new URL('../src/client/Insights.module.css', import.meta.url)

/**
 * The client UI is split across several files; these contracts describe the
 * rendered surface, not one module, so they read the whole directory. Ordering
 * follows the directory listing, which keeps a single-file layout stable.
 */
async function readClientTree(extension) {
  const names = (await readdir(clientDir, { recursive: true }))
    .filter(name => name.endsWith(extension))
    .sort()
  const parts = await Promise.all(
    names.map(name => readFile(new URL(name.split(path.sep).join('/'), clientDir), 'utf8')),
  )
  return parts.join('\n')
}

const clientSource = await readClientTree('.tsx')
/** Labels and helpers live in plain `.ts` modules; contracts read those too. */
const clientModules = await readClientTree('.ts')
const clientCode = `${clientSource}\n${clientModules}`
const performanceSource = new URL('../src/observation/performance.ts', import.meta.url)
const modelTraceSource = new URL('../src/observation/model-trace.ts', import.meta.url)
const modelDefinitionSource = new URL('../src/client/model-trace-definition.ts', import.meta.url)
const clientIndexSource = new URL('../src/client/index.tsx', import.meta.url)
const overviewSource = new URL('../src/hub/overview.ts', import.meta.url)
const packageSource = new URL('../package.json', import.meta.url)

test('text results use the official semantic reader while raw evidence stays exact', async () => {
  const source = await clientSource

  assert.match(source, /<MarkdownText text=\{safeMarkdown\(presentation\.text\)\}/)
  assert.match(source, /data-watcher-document=""/)
  assert.doesNotMatch(source, /<pre className=\{css\.textResult\}>/)
  assert.match(source, /<pre>\{raw \|\| '没有原始数据'\}<\/pre>/)
  assert.match(source, /<CopyRawButton text=\{raw\} \/>/)
})

test('the Markdown reader is supplied through the declared RC1 client injection', async () => {
  const pkg = JSON.parse(await readFile(packageSource, 'utf8'))
  const source = clientCode
  const bundle = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-primitives'))
  // The compat window is deliberately wider than the RC1 line: it also admits
  // the 0.2.0-rc.x runtimes. Move this one regex when the window moves.
  const compatRange = /^>=0\.1\.7-rc\.1 <0\.1\.8(?: \|\| \^0\.2\.0-rc\.1)?$/
  for (const [name, range] of Object.entries(pkg.peerDependencies)) {
    if (name.startsWith('@deepseek-ai/dsh-')) assert.match(range, compatRange, name)
  }
  for (const [name, version] of Object.entries(pkg.devDependencies)) {
    if (name.startsWith('@deepseek-ai/dsh-')) assert.equal(version, '0.1.7-rc.2', name)
  }
  assert.equal(pkg.peerDependencies['@deepseek-ai/cordis'], '~4.0.4')
  assert.equal(pkg.devDependencies['@deepseek-ai/cordis'], '4.0.4')
  for (const icon of [
    'IconChevronRightOutlineRegular',
    'IconChevronLeftOutlineRegular',
    'IconCheckOutlineRegular',
    'IconCopyOutlineRegular',
    'IconChevronDownOutlineRegular',
    'IconEllipsisOutlineRegular',
    'IconSearchOutlineRegular',
  ]) {
    assert.match(source, new RegExp(`\\b${icon}\\b`))
    assert.match(bundle, new RegExp(`\\b${icon}\\b`))
  }
  for (const retired of [
    'IconChevronRightOutline14',
    'IconRefreshOutlineRegular',
    'IconRefreshOutline14',
    'IconCheckOutline16',
    'IconCopyOutline16',
  ]) {
    assert.doesNotMatch(source, new RegExp(`\\b${retired}\\b`))
    assert.doesNotMatch(bundle, new RegExp(`\\b${retired}\\b`))
  }
  assert.match(source, /noExitCode: '未正常退出'/)
  assert.match(source, /codeLabel: '代码块'/)
  assert.match(source, /useSessionStatus/)
  assert.doesNotMatch(source, /useSessionPendingInteraction/)
})

test('the overview keeps every Step and occurrence reachable through folding and reversible grouping', async () => {
  const [source, panelStyles, watcherStyles] = await Promise.all([
    clientSource,
    readFile(panelStylesSource, 'utf8'),
    readFile(clientStyles, 'utf8'),
  ])

  // Turns stay full-width headers; the phase header is the reversible grouping
  // control, and every record below it is a real button.
  assert.match(source, /className=\{css\.turnToggle\}/)
  assert.match(source, /aria-expanded=\{turnOpen\}/)
  assert.match(source, /className=\{css\.phaseToggle\}/)
  assert.match(source, /aria-expanded=\{effectiveOpen\}/)
  assert.match(source, /data-overview-state=\{state\}/)
  assert.match(source, /className=\{css\.phaseMarker\}/)
  assert.match(source, /className=\{css\.itemRow\}/)
  assert.match(source, /className=\{css\.itemIndex\}/)
  assert.match(source, /className=\{css\.itemDuration\}/)

  // The two view switches are the shared segmented toggle, moved out of the
  // permanent toolbar and into the view menu: labelled toggle buttons, not tabs.
  assert.match(source, /<SegmentedToggle/)
  assert.match(source, /label="路径组织方式"/)
  assert.match(source, /label="路径展开深度"/)
  assert.match(source, /label: '概览'/)
  assert.match(source, /label: '详情'/)
  assert.match(source, /label: '逐项'/)
  assert.match(source, /label: '归类'/)

  // Steps render a merged timeline (occurrences interleaved with the model
  // stage); a single-record Step flattens into one row instead of a header.
  assert.match(clientCode, /stepTimelineEntries\(step\)/)
  assert.match(source, /entry\.kind === 'model'/)
  assert.match(source, /className=\{css\.stepToggle\}/)
  assert.match(source, /layerDisclosureOpen\(disclosure, 'step', step\.id\)/)

  // Grouping is still reversible: the same cluster helper runs over the group's
  // work items, narrowed by the path filter when one is active.
  assert.match(source, /clusterWorkItems\(/)
  assert.match(clientCode, /visibleItemIds\.has\(entry\.item\.id\)/)
  assert.match(source, /className=\{css\.clusterToggle\}/)
  assert.match(source, /layerDisclosureOpen\(disclosure, 'cluster', cluster\.id\)/)
  assert.match(source, /onSelectItem\(item\)/)
  assert.match(source, /aria-label="返回工作路径"/)
  assert.match(source, /picture\.stepCount/)
  assert.doesNotMatch(source, /<StatusMark status=\{turn\.status\}/)
  assert.doesNotMatch(source, /className=\{css\.groupDot\}/)
  assert.doesNotMatch(source, /<span>现在<\/span>/)
  assert.doesNotMatch(source, /phaseDurBar/)

  // Marker colours, open chevrons and the live-append motion are the only
  // decoration left on the path.
  assert.match(panelStyles, /\.phaseMarker\[data-state='active'\]/)
  assert.match(panelStyles, /\.phaseMarker\[data-state='failure'\]/)
  assert.match(panelStyles, /\.turnToggle\[aria-expanded='true'\] \.turnChevron/)
  assert.match(panelStyles, /\.phaseToggle\[aria-expanded='true'\] \.phaseChevron/)
  assert.match(panelStyles, /\.stepToggle\[aria-expanded='true'\] \.stepChevron/)
  assert.match(panelStyles, /\.itemRow\[data-ud-motion='watcher-live-append'\]/)
  assert.match(panelStyles, /@keyframes watcher-row-in/)
  assert.match(panelStyles, /\.itemTitle\s*\{[^}]*font-size:\s*13px/s)
  assert.match(watcherStyles, /@keyframes watcher-panel-enter/)
  assert.match(watcherStyles, /\.menu:not\(:has\(\.inspector\)\)/)
  assert.match(watcherStyles, /\.menu:has\(\.inspector\) \.workPicture\s*\{\s*display:\s*none;/)
  assert.doesNotMatch(watcherStyles, /max-height:\s*48vh/)
  assert.doesNotMatch(watcherStyles, /\.groupDot|\.nowTag|\.commandBar/)
})

test('the panel opens on the usage readout and unfolds the path on demand', async () => {
  const [source, panelStyles, timingStyles, watcherStyles, insightsStyles] = await Promise.all([
    clientSource,
    readFile(panelStylesSource, 'utf8'),
    readFile(timingStylesSource, 'utf8'),
    readFile(clientStyles, 'utf8'),
    readFile(settingsStyles, 'utf8'),
  ])

  // The old command bar, path toolbar, whole HUD and usage popover are gone.
  // The panel opens on the turn usage readout; the path is a secondary surface
  // behind the activity line, and the tool buttons unfold it first.
  assert.doesNotMatch(source, /commandBar|pathToolbar/)
  assert.match(source, /<PanelHeader/)
  // The counts ride on the path toggle now; the separate scale line is gone.
  assert.doesNotMatch(source, /<MetricsStrip/)
  assert.match(source, /<PathTimeline/)
  assert.match(source, /<SearchRow/)
  assert.match(source, /<ViewMenu/)
  assert.match(source, /data-watcher-tool="search"/)
  assert.match(source, /data-watcher-tool="timeline"/)
  assert.match(source, /data-watcher-tool="menu"/)
  assert.match(source, /data-watcher-overlay="search"/)
  assert.match(source, /data-watcher-overlay="menu"/)
  assert.doesNotMatch(source, /<StatsPopover/)
  assert.doesNotMatch(source, /id="watcher-stats-popover"/)
  assert.doesNotMatch(source, /data-watcher-overlay="stats"/)
  assert.doesNotMatch(panelStyles, /\.statsPopover/)

  // Exactly one usage surface, and it is the main window: it renders before
  // the collapsible path, which stays closed until the header unfolds it.
  assert.equal((source.match(/<SessionInsights/g) ?? []).length, 1)
  assert.match(source, /<SessionInsights[\s\S]{0,400}?flat/)
  assert.match(source, /id="watcher-usage-window"/)
  assert.ok(source.includes('id="watcher-timeline-section"'))
  assert.ok(source.includes('aria-controls="watcher-timeline-body"'))
  assert.ok(source.includes('aria-expanded={open}'))
  assert.ok(source.includes('hidden={!timelineOpen}'))
  assert.ok(source.includes('data-open={open ? \'\' : undefined}'))
  // The status bar is plain text; the path has its own toggle below the readout.
  assert.doesNotMatch(source, /data-watcher-tool="timeline"[\s\S]{0,600}?<PanelHeader/)
  assert.match(source, /data-timeline=\{timelineOpen \? 'open' : 'closed'\}/)
  assert.ok(source.indexOf('<PanelHeader') < source.indexOf('<SessionInsights'))
  assert.ok(source.indexOf('<SessionInsights') < source.indexOf('id="watcher-timeline-section"'))
  assert.ok(source.indexOf('<PathToggle') < source.indexOf('id="watcher-timeline-body"'))
  assert.match(watcherStyles, /\.timelineSection \{[^}]*display: flex/s)
  assert.match(watcherStyles, /\.timelineBody\[hidden\] \{ display: none; \}/)
  assert.match(panelStyles, /\.pathToggle \{[^}]*border-top: 1px solid var\(--ui-line\)/s)
  assert.match(panelStyles, /\.pathToggle\[data-open\] \.pathChevron/)
  assert.match(watcherStyles, /\.usageWindow \{[^}]*padding/s)
  assert.match(watcherStyles, /\.workPicture\[data-timeline='closed'\] \{[^}]*min-height: 0/s)

  // The status bar owns the only hairline; the path toggle is the border between
  // the usage readout and the unfolded path, not a second toolbar.
  assert.match(panelStyles, /\.statusBar \{[^}]*border-bottom/s)
  assert.match(panelStyles, /\.pathToggle \{[^}]*display: flex/s)
  assert.doesNotMatch(panelStyles, /\.metrics \{/)
  assert.match(watcherStyles, /\.menu \{[\s\S]*?z-index: 1100;/)

  // Toggle rows place a variable number of chips (signals, tags, meta) after
  // the title. A fixed grid silently wraps the overflow into a second line and
  // the fixed row height then paints it over the next row, so these rows must
  // stay on a single flex line.
  for (const selector of ['phaseToggle', 'clusterToggle', 'stepToggle']) {
    const block = panelStyles.match(new RegExp(`\\.${selector} \\{([^}]*)\\}`))
    assert.ok(block, selector)
    assert.match(block[1], /display: flex/)
  }

  // The turn header is sticky over the scrolling path, and the host menu token
  // it inherits is translucent. Without an opaque copy the scrolled-under rows
  // show through the stuck header, so the header and the popovers force alpha 1.
  assert.match(panelStyles, /\.turnHeader \{[^}]*background: rgb\(from var\(--ui-surface\) r g b \/ 1\)/s)
  assert.match(panelStyles, /\.popover \{[^}]*background: rgb\(from var\(--ui-surface\) r g b \/ 1\)/s)

  // The usage window is narrower than the old inline readout in a split panel:
  // its timing header stacks instead of colliding with the bottleneck sentence.
  assert.match(source, /compact=\{flat\}/)
  assert.match(timingStyles, /\.panelBox\.compact \.topRow \{[^}]*flex-wrap: wrap/s)

  // The readout's numbers are a label-over-value grid, not tinted pills, and
  // the alerts are quiet rows that do not import a host button into the panel.
  assert.match(source, /className=\{css\.statGrid\}/)
  assert.match(insightsStyles, /\.statGrid \{[^}]*display: flex/s)
  assert.match(insightsStyles, /\.statCell\[data-metric='model'\]/)
  assert.match(source, /className=\{css\.alertRow\}/)
  assert.match(insightsStyles, /\.alertRow\[data-danger\] \.alertDot/)
  assert.doesNotMatch(source, /<Button variant="outline"/)
})

test('every CSS class a component reads exists in the stylesheet it imports', async () => {
  // A class looked up on the wrong CSS module resolves to undefined at runtime:
  // the element renders unstyled (a native button in the middle of the panel)
  // and nothing fails. Bind each `import css from '...module.css'` to the file
  // it points at and prove every `css.<name>` in that component is defined.
  const names = (await readdir(clientDir, { recursive: true }))
    .filter(name => name.endsWith('.tsx'))
    .sort()
  const missing = []
  for (const name of names) {
    const rel = name.split(path.sep).join('/')
    const source = await readFile(new URL(rel, clientDir), 'utf8')
    const imports = source.matchAll(/^import\s+(\w+)\s+from\s+'([^']+\.module\.css)'/gm)
    for (const [, binding, specifier] of imports) {
      const cssPath = path.posix.normalize(path.posix.join(path.posix.dirname(rel), specifier))
      const styles = await readFile(new URL(cssPath, clientDir), 'utf8')
      const used = new Set([...source.matchAll(new RegExp(`\\b${binding}\\.([A-Za-z_]\\w*)`, 'g'))].map(m => m[1]))
      for (const className of used) {
        if (!new RegExp(`\\.${className}(?![\\w-])`).test(styles)) missing.push(`${rel}: ${binding}.${className} is not defined in ${cssPath}`)
      }
    }
  }
  assert.deepEqual(missing, [])
})

test('each settings section keeps a mounted tabpanel too', async () => {
  const [source, styles] = await Promise.all([
    clientSource,
    readFile(settingsStyles, 'utf8'),
  ])

  for (const section of ['overview', 'trends', 'sessions', 'prefs']) {
    assert.match(source, new RegExp(`id="watcher-settings-${section}-panel"`))
    assert.match(source, new RegExp(`aria-labelledby="watcher-settings-${section}"`))
    assert.match(source, new RegExp(`hidden=\{tab !== '${section}'\}`))
  }
  assert.match(source, /<SegmentedControl\s+id="watcher-settings"/)
  assert.match(styles, /\.settingsPanel\[hidden\]\s*\{[^}]*display:\s*none;/)
})

test('partial history stays explicitly loadable without blocking Host summary', async () => {
  const [source, panelStyles, watcherStyles] = await Promise.all([
    clientSource,
    readFile(panelStylesSource, 'utf8'),
    readFile(clientStyles, 'utf8'),
  ])

  assert.match(source, /正在补齐历史/)
  assert.match(source, /载入更早的记录/)
  assert.match(source, /载入全部历史/)
  assert.match(source, /snapshot\.hasMore/)
  assert.match(source, /void loadAllHistory\(controller\.signal\)/)
  assert.match(source, /onLoadAll/)
  assert.match(source, /historyKind === 'loading'/)
  assert.doesNotMatch(source, /载入全部轮次/)
  assert.match(panelStyles, /\.moreRow\s*\{/)
  assert.match(panelStyles, /\.moreButton\s*\{/)
  assert.match(panelStyles, /\.menuItem\s*\{/)
  assert.doesNotMatch(watcherStyles, /\.loadAllInlineBtn\s*\{/)
  assert.doesNotMatch(watcherStyles, /\.historyNotice\s*\{/)
})

test('wall-clock evidence is visible at every useful level without heuristic speed', async () => {
  const [source, panelStyles, watcherStyles, performance, overview] = await Promise.all([
    clientSource,
    readFile(panelStylesSource, 'utf8'),
    readFile(clientStyles, 'utf8'),
    readFile(performanceSource, 'utf8'),
    readFile(overviewSource, 'utf8'),
  ])

  assert.match(source, /`对话轮次 \$\{turn\.turn\}`/)
  assert.match(source, /总耗时/)
  assert.match(source, /已记录/)
  assert.match(source, /开头未载入/)
  assert.doesNotMatch(source, /≥/)
  assert.match(source, /<SessionInsights/)
  assert.match(source, /wholeSessionInsights/)
  assert.match(source, /tok\/s/)
  assert.doesNotMatch(source, /TurnMetricStrip/)
  assert.doesNotMatch(source, /对话轮次性能分解/)
  assert.doesNotMatch(source, /回合/)
  assert.doesNotMatch(source, /需要处理/)
  assert.doesNotMatch(overview, /需要处理/)
  assert.match(overview, /有失败记录/)

  // Durations live on the path itself: the turn header carries its total, each
  // phase its span, and each record row its own elapsed time.
  assert.match(panelStyles, /\.turnPerf\s*\{/)
  assert.match(panelStyles, /\.turnSpeed\s*\{/)
  assert.match(panelStyles, /\.stepSignals\s*\{/)
  assert.match(panelStyles, /\.itemDuration\s*\{/)
  assert.doesNotMatch(watcherStyles, /\.turnMetrics\s*\{/)
  assert.match(performance, /firstTokenTime/)
  assert.match(performance, /outputTokens \/ \(fold\.decodeMs \/ 1000\)/)
})

test('each Step can disclose a truthful nested model stage and provider-visible reasoning', async () => {
  const [source, styles, modelTrace, modelDefinition, clientIndex] = await Promise.all([
    clientSource,
    readFile(clientStyles, 'utf8'),
    readFile(modelTraceSource, 'utf8'),
    readFile(modelDefinitionSource, 'utf8'),
    readFile(clientIndexSource, 'utf8'),
  ])

  assert.match(source, /function ModelStage/)
  assert.match(source, /模型阶段/)
  assert.match(source, /首响应等待/)
  assert.match(source, /可见推理/)
  assert.match(source, /输出 \/ 工具意图/)
  assert.match(source, /分段耗时不可用/)
  assert.match(source, /aria-expanded=\{open\}/)
  assert.match(source, /<MarkdownText text=\{safeMarkdown\(attempt\.reasoningText\)\}/)
  assert.match(source, /setLayerDisclosure\(current, 'model', modelKey, true\)/)
  assert.match(styles, /\.modelStage\s*\{/)
  assert.match(styles, /\.modelStageBar\s*\{/)
  assert.match(styles, /\.reasoningDisclosure\s*\{/)
  assert.match(modelTrace, /reasoningTokens/)
  assert.match(modelTrace, /reasoning-delta/)
  assert.match(modelDefinition, /buildLocationData/)
  assert.match(modelDefinition, /key: 'dsh-watcher-model-stage'/)
  assert.match(clientIndex, /'uiConversation'/)
  assert.match(clientIndex, /registerModelTraceDefinition\(ctx\)/)
  assert.doesNotMatch(source, /隐藏思维/)
})

test('collapsing the overlay drawer animates instead of popping away', async () => {
  const [source, styles] = await Promise.all([
    clientSource,
    readFile(clientStyles, 'utf8'),
  ])

  assert.match(source, /data-closing=\{closing \? '' : undefined\}/)
  assert.match(source, /onAnimationEnd=\{closing/)
  assert.match(source, /const closeInspector = \(toLatest = false\) =>/)
  assert.match(source, /setInspectorClosing\(true\)/)
  assert.match(source, /onClick=\{selected === undefined \? backToLatest : \(\) => closeInspector\(true\)\}/)
  // Closing must not silently re-arm follow; only the "查看最新" affordance does.
  assert.match(source, /clearSelection/)
  // Frame pinning lives in the panel-geometry hook so the panel component
  // stays about the work picture. The pin freezes the measured frame and
  // releases it to the anchor again on a timer.
  assert.match(clientCode, /const pinFrame = useCallback\(\(\) => \{/)
  assert.match(clientCode, /setPin\(\{ top, right \}\)/)
  assert.match(clientCode, /: \{ top: pin\.top, right: pin\.right, left: 'auto' as const \}/)
  assert.match(clientCode, /pinTimer\.current = window\.setTimeout\(clearPin, fallbackExitMs\)/)
  // The overlay drawer never changes the panel width, so the slide is pure
  // transform: nothing reflows, and the fixed-width children trick is gone.
  assert.match(styles, /\.inspector \{[\s\S]*?position: absolute;/)
  assert.match(styles, /@keyframes watcher-inspector-enter \{\s*from \{ opacity: 0; transform: translateX\(28px\); \}\s*\}/)
  assert.match(styles, /@keyframes watcher-inspector-exit \{\s*to \{ opacity: 0; transform: translateX\(28px\); \}\s*\}/)
  assert.match(styles, /animation: watcher-inspector-exit var\(--ui-motion-slow\) var\(--ui-ease\) forwards/)
  assert.doesNotMatch(styles, /watcher-inspector-content-out/)
  const reduced = styles.slice(styles.indexOf('@media (prefers-reduced-motion: reduce)'))
  assert.match(reduced, /\.inspector\[data-closing\],\s*\n\s*\.inspector\[data-closing\] > \* \{ animation-duration: \.01ms; animation-delay: 0s; \}/)
})

test('the overlay drawer covers the work path without reflowing it', async () => {
  const styles = await readFile(clientStyles, 'utf8')

  // The drawer is an opaque right-anchored overlay; it must never rely on
  // fixed-width children (the old docked-column reflow trick).
  assert.match(styles, /\.inspector \{[\s\S]*?width: min\(460px, 100%\);/)
  assert.match(styles, /\.inspector \{[\s\S]*?border-left: 1px solid var\(--ui-line\);/)
  assert.match(styles, /rgb\(from var\(--ui-surface\) r g b \/ 1\)/)
  assert.doesNotMatch(styles, /\.inspector > \* \{\s*box-sizing: border-box;\s*width: 438px;/)
  assert.match(styles, /\.statusLine,\s*\n\.detailStatus \{\s*display: flex;\s*\n\s*flex-wrap: wrap;/)
  assert.match(styles, /\.location \{\s*margin-left: auto;\s*\n\s*min-width: 0;/)
})

test('the docked inspector keeps a visible way back to the work path', async () => {

  const [source, styles] = await Promise.all([
    clientSource,
    readFile(clientStyles, 'utf8'),
  ])

  assert.match(source, /className=\{css\.inspectorBack\}/)
  assert.match(source, /onClick=\{onBack\}/)
  assert.match(source, /aria-label="返回工作路径"/)

  const start = styles.indexOf('.inspectorBack {')
  const end = styles.indexOf('.inspectorBack:hover')
  assert.ok(start !== -1 && end > start, 'the docked back control has its own rule')
  const dockedRule = styles.slice(start, end)
  assert.match(dockedRule, /display: inline-flex/)
  assert.doesNotMatch(dockedRule, /display: none/)

  // Only the drill-down layout flips the chevron into a back arrow; the docked
  // layout keeps it pointing at the work path beside the inspector.
  assert.doesNotMatch(styles.slice(0, styles.indexOf('@media (max-width: 860px)')), /\.inspectorBack svg/)
})
