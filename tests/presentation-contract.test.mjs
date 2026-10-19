import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const clientDir = new URL('../src/client/', import.meta.url)
const watcherSource = new URL('../src/client/Watcher.tsx', import.meta.url)
const clientStyles = new URL('../src/client/Watcher.module.css', import.meta.url)
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

  assert.match(source, /<MarkdownText text=\{presentation\.text\}/)
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
    'IconRefreshOutlineRegular',
    'IconCheckOutlineRegular',
    'IconCopyOutlineRegular',
  ]) {
    assert.match(source, new RegExp(`\\b${icon}\\b`))
    assert.match(bundle, new RegExp(`\\b${icon}\\b`))
  }
  for (const retired of [
    'IconChevronRightOutline14',
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
  const [source, styles] = await Promise.all([
    clientSource,
    readFile(clientStyles, 'utf8'),
  ])

  assert.match(source, /className=\{css\.turnToggle\}/)
  assert.match(source, /aria-expanded=\{turnOpen\}/)
  // The two view switches are the shared segmented toggle: a labelled group of
  // toggle buttons, not tabs, because neither owns a panel element.
  assert.match(source, /<SegmentedToggle/)
  assert.match(source, /label="路径组织方式"/)
  assert.match(source, /label="路径展开深度"/)
  assert.match(source, /label: '概览'/)
  assert.match(source, /label: '详情'/)
  assert.match(source, /layerDisclosureOpen\(disclosure, 'phase', group\.id\)/)
  assert.match(source, /className=\{css\.phaseMarker\}/)
  assert.match(source, /className=\{css\.phaseToggle\}/)
  assert.match(source, /data-overview-state=\{phaseState\}/)
  assert.match(source, /className=\{css\.overviewStep\}/)
  assert.match(source, /className=\{css\.stepToggle\}/)
  // Steps render a merged timeline (occurrences interleaved with the model
  // stage) and the path filter narrows it before mapping.
  assert.match(source, /stepTimelineEntries\(step\)/)
  assert.match(source, /shownEntries\.map\(entry =>/)
  assert.match(source, /className=\{css\.overviewOccurrence\}/)
  // Grouping is still reversible: the same cluster helper runs over the group's
  // work items, narrowed by the path filter when one is active.
  assert.match(source, /group\.items\.filter\(item => item\.source !== 'model'\)/)
  assert.match(source, /clusterWorkItems\(/)
  assert.match(source, /visibleItemIds\.has\(item\.id\)/)
  assert.match(source, /className=\{css\.analysisClusterToggle\}/)
  assert.match(source, /onSelectItem=\{item => selectItem\(group, item\)\}/)
  assert.match(source, /label: '逐项'/)
  assert.match(source, /label: '归类'/)
  assert.match(source, /aria-label="返回工作路径"/)
  assert.match(source, /picture\.stepCount/)
  assert.doesNotMatch(source, /<StatusMark status=\{turn\.status\}/)
  assert.doesNotMatch(source, /className=\{css\.groupDot\}/)
  assert.doesNotMatch(source, /<span>现在<\/span>/)

  assert.match(styles, /\.phaseMarker\[data-state='settled'\]|\.phaseMarker\s*\{/)
  assert.match(styles, /\.phaseMarker\[data-state='partial'\]/)
  assert.match(styles, /\.overviewOccurrenceTitle\s*\{[^}]*font-size:\s*14px/s)
  assert.match(styles, /\.phaseToggle\[aria-expanded='true'\] \.phaseChevron/)
  assert.match(styles, /\.viewControl\s*\{/)
  assert.match(styles, /\.stepToggle\[aria-expanded='true'\] \.stepChevron/)
  assert.match(styles, /\.analysisClusterToggle\[aria-expanded='true'\] \.analysisClusterChevron/)
  assert.match(styles, /@keyframes watcher-live-append/)
  assert.match(styles, /\.menu:not\(:has\(\.inspector\)\)/)
  assert.match(styles, /\.menu:has\(\.inspector\) \.workPicture\s*\{\s*display:\s*none;/)
  assert.doesNotMatch(styles, /max-height:\s*48vh/)
  assert.doesNotMatch(styles, /\.groupDot|\.nowTag/)
})

test('both panel tabs keep a mounted tabpanel so aria-controls never dangles', async () => {
  const [source, styles] = await Promise.all([
    clientSource,
    readFile(clientStyles, 'utf8'),
  ])

  // SegmentedControl names each panel `<id>-<value>-panel`. Only the selected
  // tab renders content, but both panels stay in the DOM with the inactive one
  // hidden, so every tab's aria-controls resolves to a real element.
  assert.match(source, /id="watcher-panel-stats-panel"/)
  assert.match(source, /aria-labelledby="watcher-panel-stats"/)
  assert.match(source, /hidden=\{panelTab !== 'stats'\}/)
  assert.match(source, /id="watcher-panel-path-panel"/)
  assert.match(source, /aria-labelledby="watcher-panel-path"/)
  assert.match(source, /hidden=\{panelTab !== 'path'\}/)
  assert.match(source, /<SegmentedControl\s+id="watcher-panel"/)

  // A class-level display value outranks the user agent's [hidden] rule.
  assert.match(styles, /\.pathPanel\[hidden\],[\s\S]*?\.statsPanel\[hidden\]\s*\{[^}]*display:\s*none;/)
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
  const [source, styles] = await Promise.all([
    clientSource,
    readFile(clientStyles, 'utf8'),
  ])

  assert.match(source, /正在补齐历史/)
  assert.match(source, /snapshot\.hasMore/)
  assert.match(source, /onClick=\{startHistoryLoad\}/)
  assert.match(source, /void loadAllHistory\(controller\.signal\)/)
  assert.doesNotMatch(source, /载入全部轮次/)
  assert.match(styles, /\.loadAllInlineBtn\s*\{/)
  assert.doesNotMatch(styles, /\.historyNotice\s*\{/)
})

test('wall-clock evidence is visible at every useful level without heuristic speed', async () => {
  const [source, styles, performance, overview] = await Promise.all([
    clientSource,
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
  assert.doesNotMatch(styles, /\.turnMetrics\s*\{/)
  assert.match(styles, /\.turnPerformance\s*\{/)
  // Step and occurrence durations moved out of the inspector's duplicated
  // execution list and into the path itself: the step header carries the total
  // and each occurrence row carries its own elapsed time.
  assert.match(styles, /\.overviewStepSignals\s*\{/)
  assert.match(styles, /\.overviewOccurrenceDuration\s*\{/)
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
  assert.match(source, /<MarkdownText text=\{attempt\.reasoningText\}/)
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
