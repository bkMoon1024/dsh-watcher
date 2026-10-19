import assert from 'node:assert/strict'
import test from 'node:test'
import {
  branchNumberOf,
  clusterBasisLabel,
  clusterMetaText,
  groupSignals,
  itemMetaText,
  phaseFilterView,
  phaseMetaText,
  phaseStepRows,
  showStateTag,
} from '../lib/types/client/panel/panel-model.js'

function item(overrides = {}) {
  return {
    id: 'i1',
    seq: 1,
    resultSeq: null,
    time: 0,
    resultTime: null,
    turn: 1,
    step: 1,
    source: 'tool',
    phase: 'build',
    status: 'success',
    title: 'Read fold.ts',
    subtitle: '',
    toolName: 'Read',
    callId: 'c1',
    args: null,
    argsRaw: null,
    rawText: null,
    rawValue: null,
    presentation: { kind: 'empty' },
    durationMs: 120,
    exitCode: null,
    signal: null,
    signature: null,
    intentKey: null,
    target: null,
    retryOf: null,
    retryIndex: 0,
    iterationIndex: 0,
    recoveredBy: null,
    ...overrides,
  }
}

function step(overrides = {}) {
  return {
    id: 's1',
    turn: 1,
    step: 1,
    phase: 'build',
    status: 'success',
    title: '修改实现',
    subtitle: '',
    items: [],
    parallel: false,
    executionCount: 1,
    retryCount: 0,
    iterationCount: 0,
    unconfirmedFailureCount: 0,
    firstSeq: 1,
    lastSeq: 1,
    startTime: 0,
    endTime: 0,
    model: null,
    ...overrides,
  }
}

function group(overrides = {}) {
  return {
    id: 'g1',
    turn: 1,
    phase: 'build',
    status: 'success',
    title: '修改实现',
    subtitle: '',
    steps: [],
    items: [],
    executionCount: 0,
    parallelStepCount: 0,
    retryCount: 0,
    iterationCount: 0,
    unconfirmedFailureCount: 0,
    firstSeq: 1,
    lastSeq: 1,
    startTime: 0,
    endTime: 0,
    ...overrides,
  }
}

function cluster(overrides = {}) {
  return {
    id: 'c1',
    basis: 'exact-call',
    title: 'Read fold.ts',
    items: [item()],
    executionCount: 2,
    stepCount: 2,
    retryCount: 0,
    iterationCount: 0,
    latestStatus: 'success',
    statusCounts: {
      running: 0,
      waiting: 0,
      success: 2,
      failure: 0,
      returned: 0,
      interrupted: 0,
      unknown: 0,
    },
    ...overrides,
  }
}

test('an unfiltered path leaves phase rows untouched', () => {
  const view = phaseFilterView(group({ items: [item()] }), { query: '', status: 'all' })
  assert.equal(view.active, false)
  assert.equal(view.visibleItemIds, null)
  assert.equal(view.matchesNothing, false)
})

test('a phase named by the query keeps its non-model records', () => {
  const view = phaseFilterView(
    group({
      title: '修改实现',
      items: [item({ id: 'a', title: 'Edit Watcher.tsx' }), item({ id: 'b', source: 'model', title: '' })],
    }),
    { query: '修改', status: 'all' },
  )
  assert.equal(view.active, true)
  assert.equal(view.titleMatch, true)
  assert.deepEqual([...view.visibleItemIds], ['a'])
  assert.equal(view.matchesNothing, false)
})

test('a status filter keeps only the records it names, and nothing stays empty', () => {
  const failing = item({ id: 'a', status: 'failure', title: 'Run tests' })
  const ok = item({ id: 'b', status: 'success', title: 'Read fold.ts' })
  const issues = phaseFilterView(group({ items: [failing, ok] }), { query: '', status: 'issues' })
  assert.deepEqual([...issues.visibleItemIds], ['a'])

  const empty = phaseFilterView(group({ items: [ok] }), { query: '', status: 'issues' })
  assert.equal(empty.matchesNothing, true)
  assert.equal(empty.visibleItemIds.size, 0)
})

test('a single-record Step flattens into one row; a model stage or a filtered sibling keeps the header', () => {
  const single = step({ id: 's1', items: [item({ id: 'a' })] })
  const withModel = step({
    id: 's2',
    items: [item({ id: 'b' })],
    model: { attempts: [], decodeMs: 0 },
  })
  const multi = step({ id: 's3', items: [item({ id: 'c' }), item({ id: 'd' })] })
  const rows = phaseStepRows(
    group({ steps: [single, withModel, multi], items: [item({ id: 'a' }), item({ id: 'b' }), item({ id: 'c' }), item({ id: 'd' })] }),
    null,
  )
  assert.deepEqual(rows.map(row => [row.step.id, row.flat]), [['s1', true], ['s2', false], ['s3', false]])
})

test('a filtered Step disappears when none of its rows survive', () => {
  const kept = step({ id: 's1', items: [item({ id: 'a' })] })
  const dropped = step({ id: 's2', items: [item({ id: 'b', title: 'Run tests' })] })
  const rows = phaseStepRows(
    group({ steps: [kept, dropped], items: [item({ id: 'a' }), item({ id: 'b', title: 'Run tests' })] }),
    new Set(['a']),
  )
  assert.deepEqual(rows.map(row => row.step.id), ['s1'])
})

test('parallel records keep a branch number while serial ones do not', () => {
  const first = item({ id: 'a' })
  const second = item({ id: 'b' })
  const parallel = step({ parallel: true, items: [first, second] })
  assert.equal(branchNumberOf(parallel, second), 2)
  assert.equal(branchNumberOf(step({ items: [first] }), first), null)
  assert.equal(branchNumberOf(parallel, item({ id: 'elsewhere' })), null)
})

test('record meta carries step, tool, branch and retry evidence in one line', () => {
  assert.equal(itemMetaText(item(), { stepNumber: 4, branch: 1 }), '步骤 4 · Read · 分支 1')
  assert.equal(itemMetaText(item({ retryIndex: 2 }), { stepNumber: 3 }), '步骤 3 · Read · 重试 2 次')
  assert.equal(itemMetaText(item({ toolName: null, source: 'assistant' }), {}), 'assistant')
  assert.equal(itemMetaText(item({ recoveredBy: 'later' }), {}), 'Read · 后续已恢复')
})

test('phase signals describe parallel, retry and iteration work without decoration', () => {
  assert.deepEqual(groupSignals(group({})), [])
  assert.deepEqual(groupSignals(group({ parallelStepCount: 1 })), [{ kind: 'parallel', label: '并行' }])
  assert.deepEqual(groupSignals(group({ parallelStepCount: 2, retryCount: 3, iterationCount: 1 })), [
    { kind: 'parallel', label: '并行 2 组' },
    { kind: 'retry', label: '重试 3' },
    { kind: 'iteration', label: '迭代 1' },
  ])
})

test('phase meta stays to steps, executions and elapsed time', () => {
  assert.equal(phaseMetaText(group({ steps: [step(), step()], executionCount: 4 }), '3 s'), '2 步 · 4 次 · 3 s')
  assert.equal(phaseMetaText(group({ steps: [step()], executionCount: 1 }), null), '1 步 · 1 次')
})

test('cluster copy keeps its basis, scale and outcome', () => {
  assert.equal(clusterBasisLabel(cluster({ basis: 'shared-target' })), '同一目标')
  assert.equal(clusterBasisLabel(cluster({ basis: 'mutable-target' })), '同一目标')
  assert.equal(clusterBasisLabel(cluster({ basis: 'single' })), null)
  assert.equal(clusterMetaText(cluster()), '同一指令 · 2 次执行 · 2 个步骤 · 2 成功')
})

test('only states worth naming get a text tag', () => {
  for (const state of ['waiting', 'failure', 'interrupted', 'partial']) assert.equal(showStateTag(state), true)
  for (const state of ['active', 'current', 'settled']) assert.equal(showStateTag(state), false)
})
