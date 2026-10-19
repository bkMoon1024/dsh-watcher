import { clusterOutcomeSummary, type WorkCluster } from '../../hub/aggregation.ts'
import type { OverviewState } from '../../hub/overview.ts'
import type { WorkGroup, WorkItem, WorkStep } from '../../observation/fold.ts'
import { itemPattern } from '../display.ts'
import { groupTitleMatches, itemMatchesFilter, pathFilterActive, type PathFilter } from '../path-filter.ts'
import { stepTimelineEntries, type StepTimelineEntry } from '../step-timeline.ts'

/**
 * The reading projection of one phase under the current path filter.
 *
 * Occurrence numbers are assigned by the phase component from the whole phase,
 * so a record keeps its identity no matter how the path is narrowed.
 */
export interface PhaseFilterView {
  readonly active: boolean
  readonly titleMatch: boolean
  /** Item ids the query keeps. `null` means no filter is active. */
  readonly visibleItemIds: ReadonlySet<string> | null
  readonly matchesNothing: boolean
}

const UNFILTERED: PhaseFilterView = {
  active: false,
  titleMatch: false,
  visibleItemIds: null,
  matchesNothing: false,
}

export function phaseFilterView(group: WorkGroup, filter: PathFilter): PhaseFilterView {
  if (!pathFilterActive(filter)) return UNFILTERED
  const titleMatch = groupTitleMatches(group, filter)
  const visibleItemIds = new Set<string>()
  for (const item of group.items) {
    // Model stages carry no title a query could name; they leave the path while
    // a filter is active instead of pretending to be a match.
    if (item.source === 'model') continue
    if (titleMatch || itemMatchesFilter(item, filter)) visibleItemIds.add(item.id)
  }
  return { active: true, titleMatch, visibleItemIds, matchesNothing: !titleMatch && visibleItemIds.size === 0 }
}

/** One authoritative step, narrowed to the rows the panel should draw. */
export interface PhaseStepRow {
  readonly step: WorkStep
  readonly entries: readonly StepTimelineEntry[]
  /**
   * A step that owns exactly one record needs no header of its own: the record
   * row carries the step number in its meta line and becomes one flat path row.
   */
  readonly flat: boolean
}

export function phaseStepRows(
  group: WorkGroup,
  visibleItemIds: ReadonlySet<string> | null,
): readonly PhaseStepRow[] {
  const rows: PhaseStepRow[] = []
  for (const step of group.steps) {
    const base = stepTimelineEntries(step)
    const entries = visibleItemIds === null
      ? base
      : base.filter(entry => entry.kind === 'occurrence' && visibleItemIds.has(entry.item.id))
    if (entries.length === 0) continue
    const only = entries[0]
    rows.push({ step, entries, flat: entries.length === 1 && only !== undefined && only.kind === 'occurrence' })
  }
  return rows
}

export function branchNumberOf(step: WorkStep, item: WorkItem): number | null {
  if (!step.parallel) return null
  const index = step.items.findIndex(candidate => candidate.id === item.id)
  return index < 0 ? null : index + 1
}

export function itemMetaText(
  item: WorkItem,
  options: { branch?: number | null; stepNumber?: number | null } = {},
): string {
  const { branch = null, stepNumber = null } = options
  return [
    stepNumber === null ? null : `步骤 ${stepNumber || '—'}`,
    item.toolName ?? item.source,
    branch === null ? null : `分支 ${branch}`,
    itemPattern(item),
  ].filter((part): part is string => part !== null && part !== '').join(' · ')
}

export interface GroupSignal {
  readonly kind: 'parallel' | 'retry' | 'iteration'
  readonly label: string
}

export function groupSignals(group: WorkGroup): readonly GroupSignal[] {
  const signals: GroupSignal[] = []
  if (group.parallelStepCount > 0) {
    signals.push({ kind: 'parallel', label: group.parallelStepCount === 1 ? '并行' : `并行 ${group.parallelStepCount} 组` })
  }
  if (group.retryCount > 0) signals.push({ kind: 'retry', label: `重试 ${group.retryCount}` })
  if (group.iterationCount > 0) signals.push({ kind: 'iteration', label: `迭代 ${group.iterationCount}` })
  return signals
}

export function phaseMetaText(group: WorkGroup, duration: string | null): string {
  return [`${group.steps.length} 步`, `${group.executionCount} 次`, duration]
    .filter((part): part is string => part !== null && part !== '')
    .join(' · ')
}

export function clusterBasisLabel(cluster: WorkCluster): string | null {
  if (cluster.executionCount < 2) return null
  if (cluster.basis === 'mutable-target' || cluster.basis === 'shared-target') return '同一目标'
  if (cluster.basis === 'exact-call') return '同一指令'
  return null
}

export function clusterMetaText(cluster: WorkCluster): string {
  return [
    clusterBasisLabel(cluster),
    `${cluster.executionCount} 次执行`,
    `${cluster.stepCount} 个步骤`,
    clusterOutcomeSummary(cluster),
  ].filter((part): part is string => part !== null && part !== '').join(' · ')
}

/** Overview states that should surface as a text tag, not only as a colour. */
export function showStateTag(state: OverviewState): boolean {
  return state === 'waiting' || state === 'failure' || state === 'interrupted' || state === 'partial'
}
