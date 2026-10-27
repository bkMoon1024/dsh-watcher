import type {
  AssistantMessageNode,
  ConversationNode,
  ConversationViewSnapshotStore,
  RunningToolCall,
  ToolResultNode,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { SessionPendingInteractionBase } from '@deepseek-ai/dsh-client-ui-session/client'
import { foldModelTraceEvents, hasReasoningEvidence, type ModelStepTrace } from './model-trace.ts'

/** Watcher-owned projection assembled from the public RC1 Session and Conversation stores. */
export interface WatcherSnapshot {
  readonly views: ConversationViewSnapshotStore
  readonly chat: ChatSnapshot
  readonly nodes: readonly ConversationNode[]
  readonly turnTimings: ReadonlyMap<number, { readonly startTime: number; readonly endTime?: number }>
  readonly runningCalls: readonly RunningToolCall[]
  readonly pending: readonly SessionPendingInteractionBase[]
  readonly blank: boolean
  readonly running: boolean
  readonly hasMore: boolean
}

/** One truthful lifecycle state. Result presence alone never means success. */
export type WorkStatus =
  | 'running'
  | 'waiting'
  | 'success'
  | 'failure'
  | 'returned'
  | 'interrupted'
  | 'unknown'

/** User-facing phases used by the compact work rail. */
export type WorkPhase =
  | 'request'
  | 'steering'
  | 'plan'
  | 'investigate'
  | 'build'
  | 'verify'
  | 'activate'
  | 'desktop'
  | 'answer'
  | 'model'
  | 'wait'
  | 'failure'
  | 'other'

export type WorkSource =
  | 'tool'
  | 'user'
  | 'steering'
  | 'assistant'
  | 'artifact'
  | 'interaction'
  | 'turn'
  | 'model'

export type WorkPresentation =
  | {
    kind: 'terminal'
    command: string
    cwd: string | null
    output: string
    exitCode: number | null
    signal: string | null
    running: boolean
  }
  | {
    kind: 'read'
    label: string
    lang: string | null
    lines: readonly { number: number; text: string }[]
    totalLines: number
  }
  | {
    kind: 'diff'
    diffs: { path: string; oldText: string | null; newText: string }[]
  }
  | { kind: 'json'; data: object | unknown[] }
  | { kind: 'text'; text: string }
  | { kind: 'image'; attachment: unknown }
  | { kind: 'empty' }

/** Immutable evidence for one recorded occurrence. */
export interface WorkItem {
  id: string
  seq: number
  resultSeq: number | null
  time: number
  resultTime: number | null
  turn: number
  step: number
  source: WorkSource
  phase: WorkPhase
  status: WorkStatus
  title: string
  subtitle: string
  toolName: string | null
  callId: string | null
  args: Record<string, unknown>
  argsRaw: string | null
  rawText: string
  rawValue: unknown
  presentation: WorkPresentation
  durationMs: number | null
  exitCode: number | null
  signal: string | null
  signature: string | null
  intentKey: string | null
  target: string | null
  retryOf: string | null
  retryIndex: number
  iterationIndex: number
  recoveredBy: string | null
}

export interface WorkStep {
  id: string
  turn: number
  step: number
  phase: WorkPhase
  status: WorkStatus
  title: string
  subtitle: string
  items: readonly WorkItem[]
  parallel: boolean
  executionCount: number
  retryCount: number
  iterationCount: number
  unconfirmedFailureCount: number
  firstSeq: number
  lastSeq: number
  startTime: number | null
  endTime: number | null
  model: ModelStepTrace | null
}

/** One consecutive phase inside one Turn. Every child Step remains addressable. */
export interface WorkGroup {
  id: string
  turn: number
  phase: WorkPhase
  status: WorkStatus
  title: string
  subtitle: string
  steps: readonly WorkStep[]
  items: readonly WorkItem[]
  executionCount: number
  parallelStepCount: number
  retryCount: number
  iterationCount: number
  unconfirmedFailureCount: number
  firstSeq: number
  lastSeq: number
  startTime: number | null
  endTime: number | null
}

export interface WorkTurn {
  turn: number
  status: WorkStatus
  groups: readonly WorkGroup[]
  startTime: number | null
  endTime: number | null
}

export interface WorkPicture {
  nodes: readonly WorkGroup[]
  turns: readonly WorkTurn[]
  now: { phase: WorkPhase; label: string; status: WorkStatus }
  actionCount: number
  stepCount: number
  turnCount: number
  parallelStepCount: number
  retryCount: number
  iterationCount: number
  pendingCount: number
  unconfirmedFailureCount: number
  running: boolean
  partialHistory: boolean
}

interface ToolPair {
  callId: string
  seq: number
  resultSeq: number | null
  time: number
  resultTime: number | null
  turn: number
  step: number
  name: string
  args: Record<string, unknown>
  argsRaw: string
  result: unknown
  meta: unknown
  callView: unknown
  resultView: unknown
  orphan: boolean
}

interface EventLike {
  type: string
  seq?: number
  time?: number
  data?: unknown
}

interface Coordinates {
  turn: number
  step: number
}

interface TimeBounds {
  startTime: number | null
  endTime: number | null
}

const EMPTY_NOW = Object.freeze({ phase: 'other' as const, label: '', status: 'unknown' as const })

export const EMPTY_PICTURE: WorkPicture = Object.freeze({
  nodes: [],
  turns: [],
  now: EMPTY_NOW,
  actionCount: 0,
  stepCount: 0,
  turnCount: 0,
  parallelStepCount: 0,
  retryCount: 0,
  iterationCount: 0,
  pendingCount: 0,
  unconfirmedFailureCount: 0,
  running: false,
  partialHistory: false,
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function recordAt(value: unknown, key: string): Record<string, unknown> | null {
  if (!isRecord(value)) return null
  const child = value[key]
  return isRecord(child) ? child : null
}

function stringAt(value: unknown, key: string): string | null {
  return isRecord(value) && typeof value[key] === 'string' ? value[key] : null
}

function numberAt(value: unknown, key: string): number | null {
  return isRecord(value) && typeof value[key] === 'number' && Number.isFinite(value[key])
    ? value[key]
    : null
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (isRecord(raw)) return raw
  if (typeof raw !== 'string' || raw.trim() === '') return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * JSON.parse keeps whatever nesting the caller wrote, so a hostile or broken
 * tool argument can be thousands of levels deep. Both walkers below stop at
 * this depth: past it the payload is evidence of nothing, and unbounded
 * recursion would throw RangeError while rendering.
 */
const NESTED_VALUE_DEPTH = 32

function stableValue(value: unknown, depth = 0): unknown {
  if (depth >= NESTED_VALUE_DEPTH) return null
  if (Array.isArray(value)) return value.map(child => stableValue(child, depth + 1))
  if (!isRecord(value)) return value
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key], depth + 1)]))
}

/** Stable exact signature used only for evidence-backed retry detection. */
export function normalizedSignature(toolName: string, args: Record<string, unknown>): string {
  return `${toolName}\u0000${JSON.stringify(stableValue(args))}`
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function textFromContent(value: unknown, output: string[] = [], depth = 0): string[] {
  if (depth >= NESTED_VALUE_DEPTH) return output
  if (Array.isArray(value)) {
    for (const child of value) textFromContent(child, output, depth + 1)
    return output
  }
  if (!isRecord(value)) return output
  if (value.type === 'text' && typeof value.text === 'string') {
    output.push(value.text)
    return output
  }
  if (typeof value.output === 'string') output.push(value.output)
  if (Array.isArray(value.content)) textFromContent(value.content, output, depth + 1)
  if (isRecord(value.message)) textFromContent(value.message, output, depth + 1)
  return output
}

function resultText(value: unknown): string {
  return textFromContent(value).filter(Boolean).join('\n')
}

function parseJsonCandidate(text: string): object | unknown[] | null {
  const trimmed = text.trim()
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return null
  try {
    const parsed: unknown = JSON.parse(trimmed)
    return typeof parsed === 'object' && parsed !== null ? parsed : null
  } catch {
    return null
  }
}

function baseName(path: string): string {
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path
}

function stringArg(args: Record<string, unknown>, ...keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = args[key]
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return null
}

function commandOf(args: Record<string, unknown>): string {
  return stringArg(args, 'command', 'cmd') ?? ''
}

function commandPreview(command: string): string {
  const oneLine = command.replace(/\s+/g, ' ').trim()
  if (oneLine.length <= 52) return oneLine
  return `${oneLine.slice(0, 49)}…`
}

function targetOf(name: string, args: Record<string, unknown>): string | null {
  const direct = stringArg(args, 'file_path', 'path', 'url', 'query', 'pattern', 'name', 'plugin')
  if (direct !== null) return direct
  if (name === 'bash') {
    const command = commandOf(args)
    const path = command.match(/(?:^|\s)(\.?\.?\/[\w./-]+|\/[\w./-]+)/)?.[1]
    return path ?? null
  }
  return null
}

function isVerificationCommand(command: string): boolean {
  return /(?:^|\s)(?:test|typecheck|check|verify|lint|vitest|jest|tsc|build)(?:\s|$)|dshx\s+check/i.test(command)
}

function isActivationCommand(command: string): boolean {
  return /dshx\s+(?:activation-plan|sync-artifact|ship|install|start)|dsh\s+plugin\s+(?:add|remove)/i.test(command)
}

function phaseOfTool(name: string, args: Record<string, unknown>, callView: unknown): WorkPhase {
  const kind = stringAt(callView, 'kind')
  if (/^(skill|todo_write|create_goal|update_goal|get_goal|update_plan)$/.test(name)) return 'plan'
  if (/^(read|grep|glob|find|search|web_search|web_fetch|web_open)$/.test(name)) return 'investigate'
  if (/^(write|edit|apply_patch|imagegen|image_gen)/.test(name)) return 'build'
  if (/^(dshx_activation_plan|dshx_sync_artifact|dshx_ship|dshx_install|dshx_start)/.test(name)) return 'activate'
  if (/^(dshx_check|dshx_verify|dshx_which|dshx_status)/.test(name)) return 'verify'
  if (name.startsWith('cua_') || name.includes('computer')) return 'desktop'
  if (name === 'bash') {
    const command = commandOf(args)
    if (isActivationCommand(command)) return 'activate'
    if (isVerificationCommand(command)) return 'verify'
    if (/\b(?:sed|head|tail|ls|find|rg|grep|git\s+(?:status|diff|log|show))\b/.test(command)) return 'investigate'
    return 'build'
  }
  if (kind === 'read' || kind === 'search' || kind === 'fetch') return 'investigate'
  if (kind === 'edit' || kind === 'delete' || kind === 'move') return 'build'
  if (kind === 'execute') return 'build'
  return 'other'
}

function titleOfTool(name: string, args: Record<string, unknown>, callView: unknown): string {
  const target = targetOf(name, args)
  if (name === 'read') return `读取 ${target === null ? '文件' : baseName(target)}`
  if (name === 'grep') return `搜索 ${stringArg(args, 'pattern') ?? '内容'}`
  if (name === 'glob') return `查找 ${stringArg(args, 'pattern') ?? '文件'}`
  if (name === 'write') return `写入 ${target === null ? '文件' : baseName(target)}`
  if (name === 'edit') return `修改 ${target === null ? '文件' : baseName(target)}`
  if (name === 'apply_patch') return '应用代码补丁'
  if (name === 'bash') {
    const description = stringArg(args, 'description')
    if (description !== null) return description
    const command = commandOf(args)
    return command === '' ? '运行命令' : `运行 ${commandPreview(command)}`
  }
  if (name === 'skill') return '读取工作说明'
  if (name === 'todo_write' || name === 'update_plan') return '更新工作计划'
  if (name === 'create_goal') return '建立任务目标'
  if (name === 'update_goal') return '更新任务目标'
  if (name === 'get_goal') return '核对任务目标'
  if (name === 'dshx_status' || name === 'dshx_which') return '核对 DSHX 环境'
  if (name === 'dshx_check') return '检查插件合同'
  if (name === 'dshx_activation_plan') return '规划插件激活'
  if (name === 'dshx_sync_artifact') return '同步插件产物'
  const presented = stringAt(callView, 'title')
  return presented ?? (name.replaceAll('_', ' ') || '未知执行')
}

function subtitleOfTool(name: string, args: Record<string, unknown>, target: string | null): string {
  if (target !== null) return target
  if (name === 'bash') return commandOf(args) || name
  const query = stringArg(args, 'query', 'pattern')
  return query ?? name
}

function validReadPresentation(value: unknown): WorkPresentation | null {
  if (!isRecord(value) || value.card !== 'read' || !Array.isArray(value.lines)) return null
  const lines: { number: number; text: string }[] = []
  for (const line of value.lines) {
    if (!isRecord(line) || typeof line.number !== 'number' || typeof line.text !== 'string') return null
    lines.push({ number: line.number, text: line.text })
  }
  const totalLines = typeof value.totalLines === 'number' ? value.totalLines : lines.length
  return {
    kind: 'read',
    label: typeof value.title === 'string' ? value.title : typeof value.path === 'string' ? value.path : '文件',
    lang: typeof value.lang === 'string' ? value.lang : null,
    lines,
    totalLines,
  }
}

function validReadMeta(value: unknown): WorkPresentation | null {
  if (!isRecord(value) || !Array.isArray(value.lines) || typeof value.path !== 'string') return null
  const lines: { number: number; text: string }[] = []
  for (const line of value.lines) {
    if (!isRecord(line) || typeof line.number !== 'number' || typeof line.text !== 'string') return null
    lines.push({ number: line.number, text: line.text })
  }
  return {
    kind: 'read',
    label: value.path,
    lang: typeof value.lang === 'string' ? value.lang : null,
    lines,
    totalLines: typeof value.totalLines === 'number' ? value.totalLines : lines.length,
  }
}

function validDiffs(value: unknown): { path: string; oldText: string | null; newText: string }[] | null {
  if (!Array.isArray(value)) return null
  const diffs: { path: string; oldText: string | null; newText: string }[] = []
  for (const diff of value) {
    if (!isRecord(diff) || typeof diff.path !== 'string' || typeof diff.newText !== 'string') return null
    if (diff.oldText !== null && typeof diff.oldText !== 'string') return null
    diffs.push({ path: diff.path, oldText: diff.oldText, newText: diff.newText })
  }
  return diffs
}

function diffFromArgs(name: string, args: Record<string, unknown>): WorkPresentation | null {
  const path = stringArg(args, 'file_path', 'path')
  if (path === null) return null
  if (name === 'write' && typeof args.content === 'string') {
    return { kind: 'diff', diffs: [{ path, oldText: null, newText: args.content }] }
  }
  if (name === 'edit' && typeof args.old_string === 'string' && typeof args.new_string === 'string') {
    return { kind: 'diff', diffs: [{ path, oldText: args.old_string, newText: args.new_string }] }
  }
  return null
}

function presentationOf(pair: ToolPair, rawText: string, exitCode: number | null, signal: string | null): WorkPresentation {
  const call = isRecord(pair.callView) ? pair.callView : null
  const result = isRecord(pair.resultView) ? pair.resultView : null
  if (result?.card === 'terminal' || (pair.result === null && call?.card === 'terminal') || pair.name === 'bash') {
    return {
      kind: 'terminal',
      command: typeof result?.title === 'string'
        ? result.title
        : typeof call?.title === 'string' ? call.title : commandOf(pair.args),
      cwd: typeof call?.cwd === 'string' ? call.cwd : stringArg(pair.args, 'workdir', 'cwd'),
      output: typeof result?.output === 'string' ? result.output : rawText,
      exitCode,
      signal,
      running: pair.result === null,
    }
  }
  const read = validReadPresentation(result) ?? validReadMeta(pair.meta)
  if (read !== null) return read
  const resultDiffs = result?.card === 'diff' ? validDiffs(result.diffs) : null
  const callDiffs = call?.card === 'diff' ? validDiffs(call.diffs) : null
  const diffs = resultDiffs ?? callDiffs
  if (diffs !== null) return { kind: 'diff', diffs }
  const argDiff = diffFromArgs(pair.name, pair.args)
  if (argDiff !== null) return argDiff
  if (result !== null && result.card !== 'generic') return { kind: 'json', data: result }
  if (isRecord(pair.meta) || Array.isArray(pair.meta)) return { kind: 'json', data: pair.meta }
  const parsed = parseJsonCandidate(rawText)
  if (parsed !== null) return { kind: 'json', data: parsed }
  if (rawText !== '') return { kind: 'text', text: rawText }
  return { kind: 'empty' }
}

function recognizedResultView(value: unknown): boolean {
  if (!isRecord(value) || typeof value.card !== 'string') return false
  return new Set(['generic', 'terminal', 'diff', 'search', 'read', 'web']).has(value.card)
}

interface ValueOutcomeProbe {
  exitCode: number | null
  signal: string | null
  isError: boolean
  okFlag: boolean | null
  outcomeText: 'success' | 'failure' | null
}

interface ToolOutcomeProbe {
  exitCode: number | null
  signal: string | null
  isError: boolean
  domain: 'success' | 'failure' | null
}

const EXIT_CODE_KEYS: ReadonlySet<string> = new Set(['exitCode', 'exit_code'])
const SIGNAL_KEYS: ReadonlySet<string> = new Set(['signal'])
const ERROR_KEYS: ReadonlySet<string> = new Set(['isError'])
const OK_KEYS: ReadonlySet<string> = new Set(['ok', 'success'])
const OUTCOME_KEYS: ReadonlySet<string> = new Set(['status', 'outcome'])
const SUCCESS_TEXT = /^(ok|success|succeeded|passed|done|completed)$/
const FAILURE_TEXT = /^(error|failed|failure|denied|cancelled|canceled)$/

function emptyProbe(): ValueOutcomeProbe {
  return { exitCode: null, signal: null, isError: false, okFlag: null, outcomeText: null }
}

/**
 * One walk collects every outcome field of one value. It used to take four
 * separate depth-first searches per value, and a tool item probes three values,
 * so this is the hottest path in a fold. Each field still takes the first match
 * its own search would have found: keys at this level first, then children in
 * order, with booleans limited to a shallower depth than numbers and strings.
 */
function probeToolOutcome(value: unknown, probe: ValueOutcomeProbe, depth = 0): void {
  if (depth > 8) return
  if (probe.exitCode !== null && probe.signal !== null && probe.isError
    && probe.okFlag !== null && probe.outcomeText !== null) return
  if (Array.isArray(value)) {
    for (const child of value) probeToolOutcome(child, probe, depth + 1)
    return
  }
  if (!isRecord(value)) return
  for (const [key, child] of Object.entries(value)) {
    if (probe.exitCode === null && EXIT_CODE_KEYS.has(key) && typeof child === 'number' && Number.isFinite(child)) {
      probe.exitCode = child
      continue
    }
    if (probe.signal === null && SIGNAL_KEYS.has(key) && typeof child === 'string') {
      probe.signal = child
      continue
    }
    if (depth <= 6 && typeof child === 'boolean') {
      if (!probe.isError && ERROR_KEYS.has(key)) {
        probe.isError = child
        continue
      }
      if (probe.okFlag === null && OK_KEYS.has(key)) {
        probe.okFlag = child
        continue
      }
    }
    if (probe.outcomeText === null && OUTCOME_KEYS.has(key) && typeof child === 'string') {
      const status = child.toLowerCase()
      if (SUCCESS_TEXT.test(status)) probe.outcomeText = 'success'
      else if (FAILURE_TEXT.test(status)) probe.outcomeText = 'failure'
    }
  }
  for (const child of Object.values(value)) probeToolOutcome(child, probe, depth + 1)
}

function domainOf(probe: ValueOutcomeProbe): 'success' | 'failure' | null {
  if (probe.okFlag !== null) return probe.okFlag ? 'success' : 'failure'
  return probe.outcomeText
}

function outcomeOfPair(pair: ToolPair): ToolOutcomeProbe {
  const view = emptyProbe()
  probeToolOutcome(pair.resultView, view)
  const meta = emptyProbe()
  probeToolOutcome(pair.meta, meta)
  const result = emptyProbe()
  probeToolOutcome(pair.result, result)
  // Field order is the one the replaced helpers used: exit code and signal read
  // view → meta → result, the domain reads meta → view → result, and the error
  // flag only ever looked at the result.
  return {
    exitCode: view.exitCode ?? exitCodeFromText(resultText(pair.resultView))
      ?? meta.exitCode ?? exitCodeFromText(resultText(pair.meta))
      ?? result.exitCode ?? exitCodeFromText(resultText(pair.result)),
    signal: view.signal ?? meta.signal ?? result.signal,
    isError: result.isError,
    domain: domainOf(meta) ?? domainOf(view) ?? domainOf(result),
  }
}

function exitCodeFromText(text: string): number | null {
  const marker = text.match(/\[exit code:\s*(-?\d+)\]/i)
    ?? text.match(/"(?:exitCode|exit_code)"\s*:\s*(-?\d+)/)
  return marker?.[1] === undefined ? null : Number(marker[1])
}

function statusOfTool(pair: ToolPair, probe: ToolOutcomeProbe): WorkStatus {
  const { exitCode, signal } = probe
  if (pair.result === null) return 'running'
  if (probe.isError || signal !== null || (exitCode !== null && exitCode !== 0)) return 'failure'
  if (exitCode === 0) return 'success'
  if (probe.domain !== null) return probe.domain
  if (recognizedResultView(pair.resultView)) return 'success'
  if (pair.orphan && pair.name === '') return 'unknown'
  return 'returned'
}

function mutableIntent(name: string): boolean {
  return /^(write|edit|apply_patch|imagegen|image_gen)/.test(name)
}

function toolItem(pair: ToolPair): WorkItem {
  const rawText = pair.result === null ? '' : resultText(pair.result)
  const probe = outcomeOfPair(pair)
  const { exitCode, signal } = probe
  const target = targetOf(pair.name, pair.args)
  const signature = pair.name === '' ? null : normalizedSignature(pair.name, pair.args)
  const intentKey = mutableIntent(pair.name) && target !== null ? `${pair.name}\u0000${target}` : null
  const status = statusOfTool(pair, probe)
  return {
    id: `tool:${pair.callId}`,
    seq: pair.seq,
    resultSeq: pair.resultSeq,
    time: pair.time,
    resultTime: pair.resultTime,
    turn: pair.turn,
    step: pair.step,
    source: 'tool',
    phase: phaseOfTool(pair.name, pair.args, pair.callView),
    status,
    title: pair.orphan && pair.name === '' ? `未配对结果 ${pair.callId}` : titleOfTool(pair.name, pair.args, pair.callView),
    subtitle: subtitleOfTool(pair.name, pair.args, target),
    toolName: pair.name || null,
    callId: pair.callId,
    args: pair.args,
    argsRaw: pair.argsRaw || null,
    rawText,
    rawValue: pair.meta ?? pair.result,
    presentation: presentationOf(pair, rawText, exitCode, signal),
    durationMs: pair.resultTime === null ? null : Math.max(0, pair.resultTime - pair.time),
    exitCode,
    signal,
    signature,
    intentKey,
    target,
    retryOf: null,
    retryIndex: 0,
    iterationIndex: 0,
    recoveredBy: null,
  }
}

function contentText(value: unknown): string {
  if (!Array.isArray(value)) return ''
  return value.flatMap((block): string[] => (
    isRecord(block) && block.type === 'text' && typeof block.text === 'string' ? [block.text] : []
  )).join('\n')
}

function messageItem(node: ConversationNode, coordinates: Coordinates, source: 'user' | 'steering' | 'assistant', text: string): WorkItem {
  const phase: WorkPhase = source === 'user' ? 'request' : source === 'steering' ? 'steering' : 'answer'
  const title = source === 'user' ? '用户提出任务' : source === 'steering' ? '用户补充要求' : '完成回复'
  const clean = text.replace(/\s+/g, ' ').trim()
  return {
    id: `${source}:${node.seq}`,
    seq: node.seq,
    resultSeq: null,
    time: node.time,
    resultTime: null,
    turn: coordinates.turn,
    step: coordinates.step,
    source,
    phase,
    status: 'returned',
    title,
    subtitle: clean.length > 76 ? `${clean.slice(0, 73)}…` : clean,
    toolName: null,
    callId: null,
    args: {},
    argsRaw: null,
    rawText: text,
    rawValue: text,
    presentation: text === '' ? { kind: 'empty' } : { kind: 'text', text },
    durationMs: null,
    exitCode: null,
    signal: null,
    signature: null,
    intentKey: null,
    target: null,
    retryOf: null,
    retryIndex: 0,
    iterationIndex: 0,
    recoveredBy: null,
  }
}

function imageItems(node: AssistantMessageNode, coordinates: Coordinates): WorkItem[] {
  const items: WorkItem[] = []
  let imageIndex = 0
  for (const block of node.blocks) {
    if (block.kind !== 'image') continue
    imageIndex++
    items.push({
      id: `artifact:${node.seq}:${imageIndex}`,
      seq: node.seq + imageIndex / 1000,
      resultSeq: null,
      time: node.time,
      resultTime: null,
      turn: coordinates.turn,
      step: coordinates.step,
      source: 'artifact',
      phase: 'build',
      status: 'success',
      title: '生成图片',
      subtitle: `图片附件 ${imageIndex}`,
      toolName: null,
      callId: null,
      args: {},
      argsRaw: null,
      rawText: '',
      rawValue: block.attachment,
      presentation: { kind: 'image', attachment: block.attachment },
      durationMs: null,
      exitCode: null,
      signal: null,
      signature: null,
      intentKey: null,
      target: null,
      retryOf: null,
      retryIndex: 0,
      iterationIndex: 0,
      recoveredBy: null,
    })
  }
  return items
}

function turnStateItem(seq: number, time: number, coordinates: Coordinates, status: 'failure' | 'interrupted', message: string): WorkItem {
  return {
    id: `turn:${seq}`,
    seq,
    resultSeq: null,
    time,
    resultTime: null,
    turn: coordinates.turn,
    step: coordinates.step,
    source: 'turn',
    phase: 'failure',
    status,
    title: status === 'interrupted' ? '本轮已中断' : '本轮失败',
    subtitle: message,
    toolName: null,
    callId: null,
    args: {},
    argsRaw: null,
    rawText: message,
    rawValue: message,
    presentation: { kind: 'text', text: message },
    durationMs: null,
    exitCode: null,
    signal: null,
    signature: null,
    intentKey: null,
    target: null,
    retryOf: null,
    retryIndex: 0,
    iterationIndex: 0,
    recoveredBy: null,
  }
}

function interactionItem(
  id: string,
  seq: number,
  time: number,
  coordinates: Coordinates,
  status: WorkStatus,
  subtitle: string,
  durationMs: number | null,
  rawValue: unknown,
): WorkItem {
  return {
    id: `interaction:${id}`,
    seq,
    resultSeq: null,
    time,
    resultTime: durationMs === null ? null : time + durationMs,
    turn: coordinates.turn,
    step: coordinates.step,
    source: 'interaction',
    phase: 'wait',
    status,
    title: status === 'waiting' ? '等待你决定' : '你已作决定',
    subtitle,
    toolName: null,
    callId: null,
    args: {},
    argsRaw: null,
    rawText: safeStringify(rawValue),
    rawValue,
    presentation: isRecord(rawValue) ? { kind: 'json', data: rawValue } : { kind: 'text', text: String(rawValue) },
    durationMs,
    exitCode: null,
    signal: null,
    signature: null,
    intentKey: null,
    target: null,
    retryOf: null,
    retryIndex: 0,
    iterationIndex: 0,
    recoveredBy: null,
  }
}

function modelItem(trace: ModelStepTrace): WorkItem {
  const attempt = trace.attempts.at(-1)
  const running = attempt?.kind === 'running'
  const interrupted = attempt?.kind === 'interrupted'
  const resultTime = attempt === undefined || running ? null : attempt.endedAt
  const time = trace.startTime
    ?? attempt?.firstTokenTime
    ?? attempt?.firstReasoningTime
    ?? resultTime
    ?? 0
  return {
    id: `model:${trace.turn}:${trace.step}`,
    // A streaming trace mutates lastSeq on every chunk. Ordering and React
    // disclosure identity must stay anchored to the first observed event;
    // lastSeq remains the activity/result cursor only.
    seq: trace.startSeq,
    resultSeq: running ? null : trace.lastSeq,
    time,
    resultTime,
    turn: trace.turn,
    step: trace.step,
    source: 'model',
    phase: 'model',
    status: running ? 'running' : interrupted ? 'interrupted' : 'returned',
    title: running ? '模型正在生成' : '模型响应',
    subtitle: hasReasoningEvidence(trace) ? '包含可见推理记录' : '模型活动记录',
    toolName: null,
    callId: null,
    args: {},
    argsRaw: null,
    rawText: '',
    rawValue: trace,
    presentation: { kind: 'empty' },
    durationMs: resultTime === null ? null : Math.max(0, resultTime - time),
    exitCode: null,
    signal: null,
    signature: null,
    intentKey: null,
    target: null,
    retryOf: null,
    retryIndex: 0,
    iterationIndex: 0,
    recoveredBy: null,
  }
}

function withModelPlaceholders(
  items: readonly WorkItem[],
  traces: Iterable<ModelStepTrace>,
): WorkItem[] {
  const occupied = new Set(items.map(item => `${item.turn}:${item.step}`))
  const next = [...items]
  for (const trace of traces) {
    if (!occupied.has(`${trace.turn}:${trace.step}`)) next.push(modelItem(trace))
  }
  return next
}

function coordinatesOfLocation(value: unknown): Coordinates | null {
  if (!isRecord(value)) return null
  if (value.kind === 'step') {
    const turn = recordAt(value, 'turn')
    const step = recordAt(value, 'step')
    if (typeof turn?.turn === 'number' && typeof step?.step === 'number') return { turn: turn.turn, step: step.step }
  }
  if (value.kind === 'turn') {
    const turn = recordAt(value, 'turn')
    if (typeof turn?.turn === 'number') return { turn: turn.turn, step: 0 }
  }
  return null
}

function snapshotLocations(snapshot: WatcherSnapshot): Map<number, Coordinates> {
  const locations = new Map<number, Coordinates>()
  const views = snapshot.views as unknown as { get: (target: string) => unknown }
  const trajectory = views.get('trajectory')
  if (isRecord(trajectory) && trajectory.eventLocations instanceof Map) {
    for (const [seq, location] of trajectory.eventLocations) {
      if (typeof seq !== 'number') continue
      const coordinates = coordinatesOfLocation(location)
      if (coordinates !== null) locations.set(seq, coordinates)
    }
  }
  for (const turnNumber of snapshot.chat.timeline.turnOrder) {
    const turn = snapshot.chat.timeline.turns.get(turnNumber)
    if (turn === undefined) continue
    for (const step of turn.steps) {
      for (const key of snapshot.chat.locations.getStep(turnNumber, step.step)) {
        const node = snapshot.chat.nodes.get(key)
        if (node === undefined) continue
        const coordinates = { turn: turnNumber, step: step.step }
        if (!locations.has(node.anchorSeq)) locations.set(node.anchorSeq, coordinates)

        // Chat anchors a Tool row at its tool/call seq, while the durable
        // ToolResultNode is keyed by the later tool/result seq. Preserve both
        // identities so a settled Tool never falls into synthetic Turn 0 when
        // Trajectory intentionally omits contribution-only event locations.
        const data = recordAt(node, 'data')
        const root = recordAt(data, 'root')
        const resultSeq = root?.kind === 'tool-result' ? numberAt(root, 'seq') : null
        if (resultSeq !== null && !locations.has(resultSeq)) locations.set(resultSeq, coordinates)
      }
    }
  }
  return locations
}

function trajectoryNodes(snapshot: WatcherSnapshot): readonly ConversationNode[] {
  const views = snapshot.views as unknown as { get: (target: string) => unknown }
  const trajectory = views.get('trajectory')
  if (isRecord(trajectory) && Array.isArray(trajectory.eventNodes)) return trajectory.eventNodes as readonly ConversationNode[]
  return snapshot.nodes
}

function pairFromSettled(node: ToolResultNode): ToolPair {
  const argsRaw = node.call?.argsRaw ?? ''
  return {
    callId: node.callId,
    seq: node.callTime === null ? node.seq : node.seq - 0.5,
    resultSeq: node.seq,
    time: node.callTime ?? node.time,
    resultTime: node.time,
    turn: 0,
    step: 0,
    name: node.call?.name ?? '',
    args: parseArgs(argsRaw),
    argsRaw,
    result: { content: node.content, isError: node.isError, error: node.error },
    meta: node.meta,
    callView: null,
    resultView: null,
    orphan: node.call === null,
  }
}

function pairFromRunning(call: RunningToolCall, index: number): ToolPair {
  const argsRaw = call.phase === 'start' ? call.argsRaw : ''
  return {
    callId: call.callId,
    seq: Number.MAX_SAFE_INTEGER - 1000 + index,
    resultSeq: null,
    time: call.time,
    resultTime: null,
    turn: call.turn,
    step: call.step,
    name: call.name,
    args: parseArgs(argsRaw),
    argsRaw,
    result: null,
    meta: null,
    callView: null,
    resultView: null,
    orphan: false,
  }
}

/** Public RC1 Session/Conversation projection to occurrence-preserving tool pairs. */
export function pairsFromSnapshot(
  snapshot: WatcherSnapshot,
  locations: Map<number, Coordinates> = snapshotLocations(snapshot),
  nodes: readonly ConversationNode[] = trajectoryNodes(snapshot),
): ToolPair[] {
  const pairs: ToolPair[] = []
  for (const node of nodes) {
    if (node.kind !== 'tool-result') continue
    const pair = pairFromSettled(node)
    const coordinates = locations.get(node.seq)
    pair.turn = coordinates?.turn ?? 0
    pair.step = coordinates?.step ?? 0
    pairs.push(pair)
  }
  snapshot.runningCalls.forEach((call, index) => pairs.push(pairFromRunning(call, index)))
  pairs.sort((left, right) => left.seq - right.seq || left.time - right.time)
  return pairs
}

function snapshotItems(snapshot: WatcherSnapshot): WorkItem[] {
  // Both derivations are pure functions of one snapshot. Build them once and
  // share them with the pair pass; each used to be walked twice per fold.
  const locations = snapshotLocations(snapshot)
  const nodes = trajectoryNodes(snapshot)
  const items = pairsFromSnapshot(snapshot, locations, nodes).map(toolItem)
  for (const node of nodes) {
    const coordinates = locations.get(node.seq) ?? { turn: 'turn' in node ? node.turn : 0, step: 'step' in node ? node.step : 0 }
    if (node.kind === 'user') {
      if (stringAt(node.source, 'kind') !== 'user') continue
      const text = contentText(node.content)
      if (text !== '') items.push(messageItem(node, coordinates, 'user', text))
    } else if (node.kind === 'steering') {
      const text = contentText(node.content)
      if (text !== '') items.push(messageItem(node, coordinates, 'steering', text))
    } else if (node.kind === 'assistant') {
      const hasTool = node.blocks.some((block: any) => block.kind === 'tool-call')
      const text = node.blocks.flatMap((block: any) => block.kind === 'text' ? [block.text] : []).join('\n')
      if (!hasTool && text.trim() !== '') items.push(messageItem(node, coordinates, 'assistant', text))
      items.push(...imageItems(node, coordinates))
      if (node.interrupted === true) items.push(turnStateItem(node.seq + 0.9, node.time, coordinates, 'interrupted', 'Agent 输出在完成前停止'))
    } else if (node.kind === 'turn-error') {
      items.push(turnStateItem(node.seq, node.time, coordinates, 'failure', node.message))
    } else if (node.kind === 'turn-max-tokens') {
      items.push(turnStateItem(node.seq, node.time, coordinates, 'interrupted', '达到本轮输出上限'))
    }
  }
  const latestTurn = snapshot.chat.timeline.turnOrder.at(-1) ?? 0
  const latestStep = snapshot.chat.timeline.turns.get(latestTurn)?.steps.at(-1)?.step ?? 0
  snapshot.pending.forEach((pending, index) => {
    const name = pending.kind === 'approval' ? '等待批准' : '等待回答问题'
    items.push(interactionItem(
      pending.key,
      Number.MAX_SAFE_INTEGER - 100 + index,
      Date.now(),
      { turn: latestTurn, step: latestStep },
      'waiting',
      name,
      null,
      pending,
    ))
  })
  const models = snapshot.chat.timeline.turnOrder.flatMap(turn => (
    snapshot.chat.timeline.turns.get(turn)?.steps.flatMap(step => {
      const model = step.data.get('dsh-watcher-model-stage')
      return model === undefined ? [] : [model]
    }) ?? []
  ))
  return withModelPlaceholders(items, models)
    .sort((left, right) => left.seq - right.seq || left.time - right.time)
}

function resultCallId(value: unknown): string | null {
  const message = recordAt(value, 'message')
  const source = recordAt(message, 'source')
  return stringAt(source, 'callId') ?? stringAt(value, 'callId')
}

/** Pair every log call/result and preserve an orphan result instead of dropping it. */
export function pairTools(events: readonly EventLike[]): ToolPair[] {
  const calls = new Map<string, EventLike>()
  const results = new Map<string, EventLike>()
  for (const event of events) {
    const data = event.data
    if (event.type === 'tool/call') {
      const callId = stringAt(data, 'callId')
      if (callId !== null) calls.set(callId, event)
    } else if (event.type === 'tool/result') {
      const callId = resultCallId(data)
      if (callId !== null) results.set(callId, event)
    }
  }
  const pairs: ToolPair[] = []
  for (const [callId, callEvent] of calls) {
    const callData = isRecord(callEvent.data) ? callEvent.data : {}
    const resultEvent = results.get(callId)
    const resultData = resultEvent?.data ?? null
    const argumentsRaw = typeof callData.arguments === 'string' ? callData.arguments : safeStringify(callData.arguments ?? {})
    pairs.push({
      callId,
      seq: callEvent.seq ?? 0,
      resultSeq: resultEvent?.seq ?? null,
      time: callEvent.time ?? 0,
      resultTime: resultEvent?.time ?? null,
      turn: numberAt(callData, 'turn') ?? 0,
      step: numberAt(callData, 'step') ?? 0,
      name: stringAt(callData, 'name') ?? '',
      args: parseArgs(callData.arguments),
      argsRaw: argumentsRaw,
      result: resultData,
      meta: isRecord(resultData) ? resultData.meta ?? null : null,
      callView: callData.view ?? callData.callView ?? null,
      resultView: isRecord(resultData) ? resultData.view ?? resultData.resultView ?? null : null,
      orphan: false,
    })
  }
  for (const [callId, resultEvent] of results) {
    if (calls.has(callId)) continue
    const resultData = isRecord(resultEvent.data) ? resultEvent.data : {}
    pairs.push({
      callId,
      seq: resultEvent.seq ?? 0,
      resultSeq: resultEvent.seq ?? null,
      time: resultEvent.time ?? 0,
      resultTime: resultEvent.time ?? null,
      turn: numberAt(resultData, 'turn') ?? 0,
      step: numberAt(resultData, 'step') ?? 0,
      name: '',
      args: {},
      argsRaw: '',
      result: resultEvent.data ?? null,
      meta: resultData.meta ?? null,
      callView: null,
      resultView: resultData.view ?? resultData.resultView ?? null,
      orphan: true,
    })
  }
  return pairs.sort((left, right) => left.seq - right.seq || left.time - right.time)
}

function eventCoordinates(events: readonly EventLike[]): Map<number, Coordinates> {
  const map = new Map<number, Coordinates>()
  let turn = 0
  let step = 0
  for (const event of events) {
    const data = isRecord(event.data) ? event.data : {}
    if (event.type === 'turn/start') {
      turn = numberAt(data, 'turn') ?? turn
      step = 0
    } else if (event.type === 'step/start') {
      turn = numberAt(data, 'turn') ?? turn
      step = numberAt(data, 'step') ?? step
    }
    const directTurn = numberAt(data, 'turn')
    const directStep = numberAt(data, 'step')
    if (event.seq !== undefined) map.set(event.seq, { turn: directTurn ?? turn, step: directStep ?? step })
  }
  return map
}

interface EventTimingIndex {
  turns: ReadonlyMap<number, TimeBounds>
  steps: ReadonlyMap<string, TimeBounds>
}

function eventTimingIndex(events: readonly EventLike[]): EventTimingIndex {
  const turns = new Map<number, TimeBounds>()
  const steps = new Map<string, TimeBounds>()
  for (const event of events) {
    const data = isRecord(event.data) ? event.data : {}
    const turn = numberAt(data, 'turn')
    if (turn === null) continue
    const time = event.time ?? null
    if (event.type === 'turn/start' || event.type === 'turn/end') {
      const current = turns.get(turn) ?? { startTime: null, endTime: null }
      turns.set(turn, event.type === 'turn/start'
        ? { ...current, startTime: time }
        : { ...current, endTime: time })
    }
    if (event.type !== 'step/start' && event.type !== 'step/end') continue
    const step = numberAt(data, 'step')
    if (step === null) continue
    const key = `${turn}:${step}`
    const current = steps.get(key) ?? { startTime: null, endTime: null }
    steps.set(key, event.type === 'step/start'
      ? { ...current, startTime: time }
      : { ...current, endTime: time })
  }
  return { turns, steps }
}

function eventMessageContent(event: EventLike): readonly unknown[] {
  const data = isRecord(event.data) ? event.data : null
  if (data === null) return []
  const message = recordAt(data, 'message')
  const content = message?.content ?? data.content
  return Array.isArray(content) ? content : []
}

function logMessageItems(events: readonly EventLike[], coordinates: ReadonlyMap<number, Coordinates>): WorkItem[] {
  const items: WorkItem[] = []
  for (const event of events) {
    const seq = event.seq ?? 0
    const location = coordinates.get(seq) ?? { turn: 0, step: 0 }
    const data = isRecord(event.data) ? event.data : {}
    if (event.type === 'user/message') {
      const source = recordAt(data, 'source')
      if (stringAt(source, 'kind') !== 'user') continue
      const text = contentText(data.content)
      if (text !== '') {
        const node = { kind: 'user', seq, time: event.time ?? 0, content: [], source: null } as ConversationNode
        items.push(messageItem(node, location, 'user', text))
      }
    } else if (event.type === 'agent/inbox/spliced' && data.target === 'next-step' && Array.isArray(data.inserted)) {
      for (const inserted of data.inserted) {
        if (!isRecord(inserted) || stringAt(inserted.source, 'kind') !== 'user') continue
        const text = contentText(inserted.content)
        if (text === '') continue
        const node = { kind: 'steering', seq, time: event.time ?? 0, content: [], source: null } as unknown as ConversationNode
        items.push(messageItem(node, location, 'steering', text))
      }
    } else if (event.type === 'assistant/message') {
      const content = eventMessageContent(event)
      const hasTool = content.some(block => isRecord(block) && block.type === 'tool-call')
      const text = contentText(content)
      if (!hasTool && text !== '') {
        const node = { kind: 'assistant', seq, time: event.time ?? 0, turn: location.turn, step: location.step, blocks: [] } as ConversationNode
        items.push(messageItem(node, location, 'assistant', text))
      }
      let imageIndex = 0
      for (const block of content) {
        if (!isRecord(block) || block.type !== 'image') continue
        imageIndex++
        const attachment = block.attachment ?? block
        const base = messageItem(
          { kind: 'assistant', seq, time: event.time ?? 0, turn: location.turn, step: location.step, blocks: [] } as ConversationNode,
          location,
          'assistant',
          '',
        )
        items.push({
          ...base,
          id: `artifact:${seq}:${imageIndex}`,
          seq: seq + imageIndex / 1000,
          source: 'artifact',
          phase: 'build',
          status: 'success',
          title: '生成图片',
          subtitle: `图片附件 ${imageIndex}`,
          rawValue: attachment,
          presentation: { kind: 'image', attachment },
        })
      }
    } else if (event.type === 'turn/end') {
      const reason = recordAt(data, 'reason')
      const kind = stringAt(reason, 'kind')
      if (kind === 'aborted') items.push(turnStateItem(seq, event.time ?? 0, location, 'interrupted', '用户或运行时中断了本轮对话'))
      else if (kind !== null && kind !== 'completed') items.push(turnStateItem(seq, event.time ?? 0, location, 'failure', safeStringify(reason)))
    }
  }
  return items
}

function approvalItems(events: readonly EventLike[], coordinates: ReadonlyMap<number, Coordinates>): WorkItem[] {
  const decided = new Map<string, EventLike>()
  const callLocations = new Map<string, Coordinates>()
  for (const event of events) {
    const data = isRecord(event.data) ? event.data : {}
    if (event.type === 'approval/decided') {
      const id = stringAt(data, 'id')
      if (id !== null) decided.set(id, event)
    } else if (event.type === 'tool/call') {
      const callId = stringAt(data, 'callId')
      if (callId !== null) callLocations.set(callId, coordinates.get(event.seq ?? 0) ?? { turn: 0, step: 0 })
    }
  }
  const items: WorkItem[] = []
  for (const event of events) {
    if (event.type !== 'approval/asked') continue
    const data = isRecord(event.data) ? event.data : {}
    const id = stringAt(data, 'id')
    if (id === null) continue
    const decision = decided.get(id)
    const decisionData = isRecord(decision?.data) ? decision.data : {}
    const outcome = stringAt(decisionData, 'outcome')
    const status: WorkStatus = decision === undefined
      ? 'waiting'
      : outcome !== null && /denied|reject|cancel/i.test(outcome) ? 'failure' : 'returned'
    const toolName = stringAt(data, 'toolName') ?? '工具调用'
    const location = callLocations.get(stringAt(data, 'callId') ?? '') ?? coordinates.get(event.seq ?? 0) ?? { turn: 0, step: 0 }
    const duration = decision?.time === undefined || event.time === undefined ? null : Math.max(0, decision.time - event.time)
    items.push(interactionItem(id, event.seq ?? 0, event.time ?? 0, location, status, `${toolName}${outcome === null ? '' : ` · ${outcome}`}`, duration, { asked: data, decided: decisionData }))
  }
  return items
}

function withPatterns(items: readonly WorkItem[]): WorkItem[] {
  const next = items.map(item => ({ ...item }))
  const lastBySignature = new Map<string, number>()
  const lastByIntent = new Map<string, number>()
  for (let index = 0; index < next.length; index++) {
    const item = next[index]
    if (item === undefined) continue
    if (item.signature !== null) {
      const previousIndex = lastBySignature.get(item.signature)
      const previous = previousIndex === undefined ? undefined : next[previousIndex]
      if (previous !== undefined && (previous.status === 'failure' || previous.status === 'unknown')) {
        item.retryOf = previous.id
        item.retryIndex = previous.retryIndex + 1
      }
      if (item.status === 'success' && previous !== undefined && previous.status === 'failure') previous.recoveredBy = item.id
      lastBySignature.set(item.signature, index)
    }
    if (item.intentKey !== null) {
      const previousIndex = lastByIntent.get(item.intentKey)
      const previous = previousIndex === undefined ? undefined : next[previousIndex]
      if (previous !== undefined && previous.signature !== item.signature) item.iterationIndex = previous.iterationIndex + 1
      lastByIntent.set(item.intentKey, index)
    }
  }
  return next
}

function phasePriority(phase: WorkPhase): number {
  const priorities: Record<WorkPhase, number> = {
    wait: 100,
    steering: 95,
    request: 90,
    failure: 85,
    activate: 80,
    verify: 70,
    build: 60,
    desktop: 55,
    investigate: 50,
    plan: 40,
    answer: 30,
    model: 25,
    other: 0,
  }
  return priorities[phase]
}

function statusOfItems(items: readonly WorkItem[]): WorkStatus {
  // One scan instead of one `some` per status; the priority order is unchanged.
  let waiting = false
  let running = false
  let interrupted = false
  let failure = false
  let success = false
  let returned = false
  for (const item of items) {
    if (item.status === 'waiting') waiting = true
    else if (item.status === 'running') running = true
    else if (item.status === 'interrupted') interrupted = true
    else if (item.status === 'failure' && item.recoveredBy === null) failure = true
    else if (item.status === 'success') success = true
    else if (item.status === 'returned') returned = true
  }
  if (waiting) return 'waiting'
  if (running) return 'running'
  if (interrupted) return 'interrupted'
  if (failure) return 'failure'
  if (success) return 'success'
  if (returned) return 'returned'
  return 'unknown'
}

export function phaseTitle(phase: WorkPhase): string {
  const titles: Record<WorkPhase, string> = {
    request: '理解任务',
    steering: '接收用户补充',
    plan: '规划工作',
    investigate: '检查与理解',
    build: '修改实现',
    verify: '验证结果',
    activate: '激活插件',
    desktop: '操作界面',
    answer: '完成回复',
    model: '模型响应',
    wait: '等待你决定',
    failure: '处理异常',
    other: '执行其他工作',
  }
  return titles[phase]
}

function compactTargets(items: readonly WorkItem[]): string {
  const values = [...new Set(items.map(item => item.target).filter((value): value is string => value !== null))]
  if (values.length === 0) return ''
  const head = values.slice(0, 2).map(baseName).join(' · ')
  return values.length > 2 ? `${head} · +${values.length - 2}` : head
}

function stepOf(items: readonly WorkItem[], timing: TimeBounds, model: ModelStepTrace | null): WorkStep {
  const first = items[0]
  if (first === undefined) throw new Error('work step requires at least one item')
  const phase = items.reduce((winner, item) => phasePriority(item.phase) > phasePriority(winner) ? item.phase : winner, first.phase)
  const executionCount = items.filter(item => item.source === 'tool').length
  const parallel = executionCount > 1
  const retryCount = items.filter(item => item.retryOf !== null).length
  const iterationCount = items.filter(item => item.iterationIndex > 0).length
  const unconfirmedFailureCount = items.filter(item => item.status === 'failure' && item.recoveredBy === null).length
  const targets = compactTargets(items)
  const title = items.length === 1 ? first.title : `${phaseTitle(phase)}${parallel ? ` · ${executionCount} 项并行` : ''}`
  const detail = [targets, executionCount > 0 ? `${executionCount} 次执行` : `${items.length} 条记录`].filter(Boolean).join(' · ')
  return {
    id: `turn:${first.turn}:step:${first.step}:seq:${first.seq}`,
    turn: first.turn,
    step: first.step,
    phase,
    status: statusOfItems(items),
    title,
    subtitle: detail,
    items,
    parallel,
    executionCount,
    retryCount,
    iterationCount,
    unconfirmedFailureCount,
    firstSeq: first.seq,
    lastSeq: items.at(-1)?.seq ?? first.seq,
    ...timing,
    model,
  }
}

function stepsOf(
  items: readonly WorkItem[],
  timingOf: ((turn: number, step: number) => TimeBounds) | undefined,
  modelOf: ((turn: number, step: number) => ModelStepTrace | null) | undefined,
): WorkStep[] {
  const steps: WorkStep[] = []
  let current: WorkItem[] = []
  let key = ''
  for (const item of items) {
    const itemKey = `${item.turn}:${item.step}`
    if (current.length > 0 && itemKey !== key) {
      const first = current[0]
      if (first !== undefined) {
        steps.push(stepOf(
          current,
          timingOf?.(first.turn, first.step) ?? { startTime: null, endTime: null },
          modelOf?.(first.turn, first.step) ?? null,
        ))
      }
      current = []
    }
    key = itemKey
    current.push(item)
  }
  if (current.length > 0) {
    const first = current[0]
    if (first !== undefined) {
      steps.push(stepOf(
        current,
        timingOf?.(first.turn, first.step) ?? { startTime: null, endTime: null },
        modelOf?.(first.turn, first.step) ?? null,
      ))
    }
  }
  return steps
}

function groupOf(steps: readonly WorkStep[]): WorkGroup {
  const first = steps[0]
  if (first === undefined) throw new Error('work group requires at least one step')
  const items = steps.flatMap(step => step.items)
  const executionCount = steps.reduce((sum, step) => sum + step.executionCount, 0)
  const parallelStepCount = steps.filter(step => step.parallel).length
  const retryCount = steps.reduce((sum, step) => sum + step.retryCount, 0)
  const iterationCount = steps.reduce((sum, step) => sum + step.iterationCount, 0)
  const unconfirmedFailureCount = steps.reduce((sum, step) => sum + step.unconfirmedFailureCount, 0)
  const summary = [
    `${steps.length} 个步骤`,
    executionCount > 0 ? `${executionCount} 次执行` : null,
    parallelStepCount > 0 ? `${parallelStepCount} 次并行` : null,
  ].filter((part): part is string => part !== null).join(' · ')
  return {
    id: `turn:${first.turn}:phase:${first.phase}:seq:${first.firstSeq}`,
    turn: first.turn,
    phase: first.phase,
    status: statusOfItems(items),
    title: phaseTitle(first.phase),
    subtitle: summary,
    steps,
    items,
    executionCount,
    parallelStepCount,
    retryCount,
    iterationCount,
    unconfirmedFailureCount,
    firstSeq: first.firstSeq,
    lastSeq: steps.at(-1)?.lastSeq ?? first.lastSeq,
    startTime: first.startTime,
    endTime: steps.at(-1)?.endTime ?? null,
  }
}

function groupsOf(steps: readonly WorkStep[]): WorkGroup[] {
  const groups: WorkGroup[] = []
  let current: WorkStep[] = []
  let phase: WorkPhase | null = null
  let turn: number | null = null
  for (const step of steps) {
    if (current.length > 0 && (step.phase !== phase || step.turn !== turn)) {
      groups.push(groupOf(current))
      current = []
    }
    phase = step.phase
    turn = step.turn
    current.push(step)
  }
  if (current.length > 0) groups.push(groupOf(current))
  return groups
}

function turnTimesFromSnapshot(snapshot: WatcherSnapshot, turn: number): TimeBounds {
  const location = snapshot.chat.timeline.turns.get(turn)
  const timing = snapshot.turnTimings.get(turn)
  return {
    startTime: location?.start?.time ?? timing?.startTime ?? null,
    endTime: location?.end?.time ?? timing?.endTime ?? null,
  }
}

function stepTimesFromSnapshot(snapshot: WatcherSnapshot, turn: number, step: number): TimeBounds {
  const location = snapshot.chat.timeline.turns.get(turn)?.steps.find(value => value.step === step)
  return {
    startTime: location?.start?.time ?? null,
    endTime: location?.end?.time ?? null,
  }
}

function stepModelFromSnapshot(snapshot: WatcherSnapshot, turn: number, step: number): ModelStepTrace | null {
  return snapshot.chat.timeline.turns.get(turn)?.steps
    .find(value => value.step === step)?.data.get('dsh-watcher-model-stage') ?? null
}

function pictureOf(
  sourceItems: readonly WorkItem[],
  options: {
    running: boolean
    partialHistory: boolean
    pendingCount: number
    turnTimes?: (turn: number) => TimeBounds
    stepTimes?: (turn: number, step: number) => TimeBounds
    modelOf?: (turn: number, step: number) => ModelStepTrace | null
  },
): WorkPicture {
  if (sourceItems.length === 0) return { ...EMPTY_PICTURE, running: options.running, partialHistory: options.partialHistory, pendingCount: options.pendingCount }
  const occupiedSteps = new Set(sourceItems
    .filter(item => item.source !== 'model')
    .map(item => `${item.turn}:${item.step}`))
  const visibleSourceItems = sourceItems.filter(item => (
    item.source !== 'model' || !occupiedSteps.has(`${item.turn}:${item.step}`)
  ))
  // Turn and Step are the authoritative conversation coordinates. Some
  // interaction records (for example a delayed approval decision) arrive
  // after events from a later Step. Event sequence therefore orders only
  // occurrences *inside* one Step; it must never reorder the Step rail.
  const items = withPatterns([...visibleSourceItems].sort((left, right) =>
    left.turn - right.turn
    || left.step - right.step
    || left.seq - right.seq
    || left.time - right.time,
  ))
  const steps = stepsOf(items, options.stepTimes, options.modelOf)
  const groups = groupsOf(steps)
  // Bucket groups once; the previous filter-per-turn scan was turns x groups.
  const groupsByTurn = new Map<number, WorkGroup[]>()
  for (const group of groups) {
    const bucket = groupsByTurn.get(group.turn)
    if (bucket === undefined) groupsByTurn.set(group.turn, [group])
    else bucket.push(group)
  }
  const turns: WorkTurn[] = []
  for (const [turnNumber, turnGroups] of groupsByTurn) {
    const timing = options.turnTimes?.(turnNumber) ?? { startTime: null, endTime: null }
    turns.push({ turn: turnNumber, status: statusOfItems(turnGroups.flatMap(group => group.items)), groups: turnGroups, ...timing })
  }
  // Every counter below used to rescan the whole item list on its own.
  let actionCount = 0
  let retryCount = 0
  let iterationCount = 0
  let unconfirmedFailureCount = 0
  for (const item of items) {
    if (item.source === 'tool') actionCount += 1
    if (item.retryOf !== null) retryCount += 1
    if (item.iterationIndex > 0) iterationCount += 1
    if (item.status === 'failure' && item.recoveredBy === null) unconfirmedFailureCount += 1
  }
  let parallelStepCount = 0
  for (const step of steps) if (step.parallel) parallelStepCount += 1
  const latest = items.at(-1)
  const now = latest === undefined
    ? EMPTY_NOW
    : {
      phase: latest.phase,
      label: latest.status === 'running' ? latest.title : options.running ? '等待 Agent 继续' : latest.title,
      status: latest.status === 'running' ? 'running' as const : options.running ? 'running' as const : latest.status,
    }
  return {
    nodes: groups,
    turns,
    now,
    actionCount,
    stepCount: steps.length,
    turnCount: turns.length,
    parallelStepCount,
    retryCount,
    iterationCount,
    pendingCount: options.pendingCount,
    unconfirmedFailureCount,
    running: options.running,
    partialHistory: options.partialHistory,
  }
}

/** Fold the official RC8 snapshot without flattening Turn/Step identity. */
export function foldSnapshot(snapshot: WatcherSnapshot, options: { running?: boolean } = {}): WorkPicture {
  if (snapshot.blank) {
    return {
      ...EMPTY_PICTURE,
      running: options.running === true || snapshot.running,
      partialHistory: snapshot.hasMore,
    }
  }
  return pictureOf(snapshotItems(snapshot), {
    running: options.running === true || snapshot.running,
    partialHistory: snapshot.hasMore,
    pendingCount: snapshot.pending.length,
    turnTimes: turn => turnTimesFromSnapshot(snapshot, turn),
    stepTimes: (turn, step) => stepTimesFromSnapshot(snapshot, turn, step),
    modelOf: (turn, step) => stepModelFromSnapshot(snapshot, turn, step),
  })
}

function itemsOfPicture(picture: WorkPicture): readonly WorkItem[] {
  return picture.nodes.flatMap(group => group.items)
}

function turnTimesOfPicture(picture: WorkPicture): Map<number, TimeBounds> {
  return new Map(picture.turns.map(turn => [turn.turn, {
    startTime: turn.startTime,
    endTime: turn.endTime,
  }]))
}

function stepTimesOfPicture(picture: WorkPicture): Map<string, TimeBounds> {
  return new Map(picture.nodes.flatMap(group => group.steps.map(step => [
    `${step.turn}:${step.step}`,
    { startTime: step.startTime, endTime: step.endTime },
  ] as const)))
}

function stepModelsOfPicture(picture: WorkPicture): Map<string, ModelStepTrace> {
  return new Map(picture.nodes.flatMap(group => group.steps.flatMap(step => (
    step.model === null ? [] : [[`${step.turn}:${step.step}`, step.model] as const]
  ))))
}

/** Bound on retained occurrences; far above one window, low enough to stay safe. */
const OBSERVED_ITEM_LIMIT = 4000

/**
 * Retain every occurrence already observed in this mounted page while the
 * official RC8 window advances. Latest evidence wins by stable occurrence id,
 * so running → result updates one row instead of duplicating or removing it.
 */
export function mergeObservedPictures(previous: WorkPicture, current: WorkPicture): WorkPicture {
  if (previous.nodes.length === 0) return current
  if (current.nodes.length === 0) {
    return {
      ...previous,
      running: current.running,
      partialHistory: current.partialHistory,
      pendingCount: current.pendingCount,
    }
  }

  const items = new Map<string, WorkItem>()
  for (const item of itemsOfPicture(previous)) items.set(item.id, item)
  for (const item of itemsOfPicture(current)) items.set(item.id, item)
  // The merge bridges the sliding official window; it is not meant to keep a
  // whole session resident. Cap pathological growth on very long pages.
  if (items.size > OBSERVED_ITEM_LIMIT) {
    const kept = [...items.values()]
      .sort((left, right) => right.seq - left.seq)
      .slice(0, OBSERVED_ITEM_LIMIT)
    items.clear()
    for (const item of kept) items.set(item.id, item)
  }

  const turns = turnTimesOfPicture(previous)
  for (const [turn, timing] of turnTimesOfPicture(current)) {
    const prior = turns.get(turn)
    turns.set(turn, {
      startTime: timing.startTime ?? prior?.startTime ?? null,
      endTime: timing.endTime ?? prior?.endTime ?? null,
    })
  }

  const steps = stepTimesOfPicture(previous)
  for (const [key, timing] of stepTimesOfPicture(current)) {
    const prior = steps.get(key)
    steps.set(key, {
      startTime: timing.startTime ?? prior?.startTime ?? null,
      endTime: timing.endTime ?? prior?.endTime ?? null,
    })
  }

  const models = stepModelsOfPicture(previous)
  for (const [key, model] of stepModelsOfPicture(current)) models.set(key, model)

  return pictureOf([...items.values()], {
    running: current.running,
    partialHistory: current.partialHistory,
    pendingCount: current.pendingCount,
    turnTimes: turn => turns.get(turn) ?? { startTime: null, endTime: null },
    stepTimes: (turn, step) => steps.get(`${turn}:${step}`) ?? { startTime: null, endTime: null },
    modelOf: (turn, step) => models.get(`${turn}:${step}`) ?? null,
  })
}

/** Fold a full session JSONL replay, including approvals, steering, images, and orphan results. */
export function foldEvents(events: readonly EventLike[], options: { running?: boolean } = {}): WorkPicture {
  const coordinates = eventCoordinates(events)
  const timings = eventTimingIndex(events)
  const models = foldModelTraceEvents(events)
  const items = withModelPlaceholders(
    [...pairTools(events).map(toolItem), ...logMessageItems(events, coordinates), ...approvalItems(events, coordinates)],
    models.values(),
  )
  const pendingCount = items.filter(item => item.status === 'waiting').length
  return pictureOf(items, {
    running: options.running === true,
    partialHistory: false,
    pendingCount,
    turnTimes: turn => timings.turns.get(turn) ?? { startTime: null, endTime: null },
    stepTimes: (turn, step) => timings.steps.get(`${turn}:${step}`) ?? { startTime: null, endTime: null },
    modelOf: (turn, step) => models.get(`${turn}:${step}`) ?? null,
  })
}

/** Parse valid JSONL lines and skip only a torn final line. */
export function parseJsonl(text: string): EventLike[] {
  const events: EventLike[] = []
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') continue
    try {
      const parsed: unknown = JSON.parse(line)
      if (isRecord(parsed) && typeof parsed.type === 'string') events.push(parsed as unknown as EventLike)
    } catch {
      // Session files may end with one torn append; prior complete events remain usable.
    }
  }
  return events
}
