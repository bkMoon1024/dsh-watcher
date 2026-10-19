import { memo, useMemo } from 'react'
import { IconChevronRightOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { clusterOutcomeSummary, clusterWorkItems, type WorkCluster } from '../hub/aggregation.ts'
import { OVERVIEW_STATE_LABEL, overviewStateOf } from '../hub/overview.ts'
import type { WorkGroup, WorkItem, WorkStep } from '../observation/fold.ts'
import { modelStageMetrics, type ModelStepTrace } from '../observation/model-trace.ts'
import { groupElapsedMs, itemElapsedMs, stepElapsedMs } from '../observation/performance.ts'
import {
  layerDisclosureOpen,
  type DisclosureLayer,
  type DisclosureState,
} from './disclosure-depth.ts'
import { stepTimelineEntries } from './step-timeline.ts'
import {
  groupTitleMatches,
  itemMatchesFilter,
  pathFilterActive,
  type PathFilter,
} from './path-filter.ts'
import css from './Watcher.module.css'
import { STATUS_LABEL } from './labels.ts'
import { formatDuration, itemPattern, useLiveClock } from './display.ts'
import { ModelStage } from './ModelStage.tsx'
import { StatusMark } from './StatusMark.tsx'
import type { ObservationMode } from './view-mode.ts'

function groupBadges(group: WorkGroup) {
  return (
    <span className={css.groupBadges} aria-hidden="true">
      {group.parallelStepCount > 0
        ? <span data-kind="parallel">{group.parallelStepCount === 1 ? '并行' : `并行 ${group.parallelStepCount} 组`}</span>
        : null}
      {group.retryCount > 0 ? <span data-kind="retry">重试 {group.retryCount}</span> : null}
      {group.iterationCount > 0 ? <span data-kind="iteration">迭代 {group.iterationCount}</span> : null}
    </span>
  )
}

export function showOverviewTag(state: ReturnType<typeof overviewStateOf>): boolean {
  return state === 'waiting' || state === 'failure' || state === 'interrupted' || state === 'partial'
}

function itemMeta(item: WorkItem, { branch, step }: { branch: number | null; step: number | null }): string {
  return [
    step === null ? null : `步骤 ${step || '—'}`,
    item.toolName ?? item.source,
    branch === null ? null : `分支 ${branch}`,
    itemPattern(item),
  ].filter((part): part is string => part !== null && part !== '').join(' · ')
}

function branchNumberOf(step: WorkStep, item: WorkItem): number | null {
  if (!step.parallel) return null
  const index = step.items.findIndex(candidate => candidate.id === item.id)
  return index < 0 ? null : index + 1
}

function clusterBasisLabel(cluster: WorkCluster): string | null {
  if (cluster.executionCount < 2) return null
  if (cluster.basis === 'mutable-target' || cluster.basis === 'shared-target') return '同一目标'
  if (cluster.basis === 'exact-call') return '同一指令'
  return null
}

function OverviewOccurrenceButton({
  item,
  occurrenceNumber,
  branch,
  step,
  live,
  selected,
  now,
  onSelect,
}: {
  item: WorkItem
  occurrenceNumber: number
  branch: number | null
  step: number | null
  live: boolean
  selected: boolean
  now: number
  onSelect: () => void
}) {
  const duration = formatDuration(itemElapsedMs(item, live, now))
  const meta = itemMeta(item, { branch, step })
  return (
    <button
      type="button"
      className={css.overviewOccurrence}
      data-selected={selected ? '' : undefined}
      data-current={live ? '' : undefined}
      data-status={item.status}
      data-ud-motion="watcher-live-append"
      aria-current={live ? 'step' : undefined}
      aria-pressed={selected}
      aria-label={`记录 ${occurrenceNumber}，${item.title}，${meta}${duration === null ? '' : `，耗时 ${duration}`}，${STATUS_LABEL[item.status]}`}
      onClick={onSelect}
    >
      <span className={css.overviewOccurrenceIndex}>{String(occurrenceNumber).padStart(2, '0')}</span>
      <span className={css.overviewOccurrenceDotSlot} aria-hidden="true">
        <StatusMark status={item.status} className={css.overviewOccurrenceDot} />
      </span>
      <span className={css.overviewOccurrenceCopy}>
        <span className={css.overviewOccurrenceTitle}>{item.title}</span>
        <span className={css.overviewOccurrenceMeta}>{meta}</span>
      </span>
      {duration === null ? null : <span className={css.overviewOccurrenceDuration}>{duration}</span>}
      <IconChevronRightOutlineRegular size={12} className={css.overviewOccurrenceChevron} />
    </button>
  )
}

/* Memoized with a comparator that deliberately ignores `now` and the toggle
 * callbacks: phases own their live clock internally (only the running phase
 * subscribes to the 1Hz tick), and the callbacks are semantically constant.
 * This keeps an idle panel's per-second reconciliation from walking every
 * historical phase subtree. */
export const PhaseOverview = memo(function PhaseOverview({
  group,
  isNow,
  running,
  turnTotalMs,
  selectedGroup,
  selectedItemId,
  observationMode,
  open,
  disclosure,
  filter,
  onToggle,
  onToggleLayer,
  onToggleReasoning,
  onSelectItem,
}: {
  group: WorkGroup
  isNow: boolean
  running: boolean
  turnTotalMs: number | null
  selectedGroup: boolean
  selectedItemId: string | null
  observationMode: ObservationMode
  open: boolean
  disclosure: DisclosureState
  filter: PathFilter
  onToggle: () => void
  onToggleLayer: (layer: DisclosureLayer, key: string) => void
  onToggleReasoning: (key: string, modelKey: string) => void
  onSelectItem: (item: WorkItem) => void
}) {
  // Only the phase that is executing now subscribes to the 1Hz clock;
  // historical phases render on data changes alone.
  const now = useLiveClock(isNow && running)
  const phaseState = overviewStateOf(group.status, isNow)
  const phaseElapsedMs = groupElapsedMs(group, isNow && running, now)
  const phaseDuration = formatDuration(phaseElapsedMs)
  const phaseSummary = [
    `${group.steps.length} 步`,
    `${group.executionCount} 次`,
    phaseDuration,
  ].filter((part): part is string => part !== null).join(' · ')
  const durationFraction = phaseElapsedMs !== null && turnTotalMs !== null && turnTotalMs > 0
    ? Math.min(1, phaseElapsedMs / turnTotalMs)
    : null
  const latestItemId = group.items.at(-1)?.id ?? null
  // A narrowed path keeps only the rows the query names. Model stages have no
  // title to match, so they leave the path while a filter is active; the
  // occurrence numbers still come from the full group so a record keeps its
  // identity no matter how the path is narrowed.
  const filterActive = pathFilterActive(filter)
  const titleMatch = groupTitleMatches(group, filter)
  const visibleItemIds = useMemo(() => {
    if (!pathFilterActive(filter)) return null
    const ids = new Set<string>()
    for (const item of group.items) {
      if (item.source === 'model') continue
      if (titleMatch || itemMatchesFilter(item, filter)) ids.add(item.id)
    }
    return ids
  }, [group, filter, titleMatch])
  const clusters = useMemo(() => {
    const sourceItems = group.items.filter(item => item.source !== 'model')
    return clusterWorkItems(
      visibleItemIds === null ? sourceItems : sourceItems.filter(item => visibleItemIds.has(item.id)),
    )
  }, [group, visibleItemIds])
  const modelSteps = useMemo(
    () => (visibleItemIds === null
      ? group.steps.filter((step): step is WorkStep & { model: ModelStepTrace } => step.model !== null)
      : []),
    [group, visibleItemIds],
  )
  const matchesNothing = filterActive && !titleMatch && visibleItemIds !== null && visibleItemIds.size === 0
  // Filtering is a reading intent: the matching rows have to be on screen
  // without another click, so the phase opens while a filter is active.
  const effectiveOpen = open || (visibleItemIds !== null && !matchesNothing)
  // Position lookups are per-render today but hot at the 1Hz live clock; index
  // the group once instead of scanning per item.
  const occurrenceNumbers = useMemo(
    () => new Map(group.items.map((item, index) => [item.id, index + 1])),
    [group],
  )
  const sourceSteps = useMemo(() => {
    const map = new Map<string, WorkStep>()
    for (const step of group.steps) for (const item of step.items) if (!map.has(item.id)) map.set(item.id, step)
    return map
  }, [group])
  const groupedModelsKey = `${group.id}:model-list`
  const groupedModelsOpen = layerDisclosureOpen(disclosure, 'model', groupedModelsKey)

  if (matchesNothing) return null

  return (
    <section
      className={css.phase}
      data-selected={selectedGroup ? '' : undefined}
      data-now={isNow ? '' : undefined}
      data-overview-state={phaseState}
      aria-label={`${group.title}，${phaseSummary}，${OVERVIEW_STATE_LABEL[phaseState]}`}
    >
      <header className={css.phaseHeader}>
        {durationFraction === null ? null : (
          <span
            className={css.phaseDurBar}
            data-state={phaseState}
            style={{ width: `${Math.max(6, Math.round(durationFraction * 100))}%` }}
            aria-hidden="true"
          />
        )}
        <button
          type="button"
          className={css.phaseToggle}
          aria-expanded={effectiveOpen}
          aria-controls={`watcher-phase-body-${group.id}`}
          aria-label={`${group.title}，${phaseSummary}，${effectiveOpen ? '收起阶段' : '展开阶段'}`}
          onClick={onToggle}
        >
          <span className={css.phaseMarker} data-state={phaseState} aria-hidden="true" />
          <IconChevronRightOutlineRegular size={12} className={css.phaseChevron} />
          <span className={css.phaseTitleLine}>
            <span className={css.phaseTitle} data-watcher-group-title="">{group.title}</span>
            {groupBadges(group)}
            {showOverviewTag(phaseState)
              ? <span className={css.overviewTag} data-state={phaseState}>{OVERVIEW_STATE_LABEL[phaseState]}</span>
              : null}
          </span>
          <span className={css.phaseMeta}>{phaseSummary}</span>
        </button>
      </header>

      {effectiveOpen ? (
      <div id={`watcher-phase-body-${group.id}`}>
        {observationMode === 'itemized'
          ? (
            <div className={css.stepTimeline} data-observation-mode="itemized">
              {group.steps.map(step => {
                const timelineEntries = stepTimelineEntries(step)
                const shownEntries = visibleItemIds === null
                  ? timelineEntries
                  : timelineEntries.filter(entry => entry.kind === 'occurrence' && visibleItemIds.has(entry.item.id))
                if (shownEntries.length === 0) return null
                const stepLive = isNow && running && step.items.some(item => item.id === latestItemId && item.status === 'running')
                const stepDuration = formatDuration(stepElapsedMs(step, stepLive, now))
                const stepOpen = layerDisclosureOpen(disclosure, 'step', step.id)
                const modelMetrics = step.model === null ? null : modelStageMetrics(step.model, now)
                const modelDuration = formatDuration(modelMetrics?.totalMs ?? null)
                const showStepTotal = stepDuration !== null && stepDuration !== modelDuration
                const modelOpen = layerDisclosureOpen(disclosure, 'model', step.id)
                return (
                  <section
                    key={step.id}
                    className={css.overviewStep}
                    data-current={stepLive ? '' : undefined}
                    data-parallel={step.parallel ? '' : undefined}
                  >
                    <header className={css.overviewStepHeader}>
                      <button
                        type="button"
                        className={css.stepToggle}
                        aria-expanded={stepOpen}
                        aria-controls={`watcher-step-body-${step.id}`}
                        aria-label={`步骤 ${step.step || '—'}，${step.executionCount} 次执行${stepDuration === null ? '' : `，耗时 ${stepDuration}`}，${stepOpen ? '收起步骤' : '展开步骤'}`}
                        onClick={() => onToggleLayer('step', step.id)}
                      >
                        <IconChevronRightOutlineRegular size={11} className={css.stepChevron} />
                        <span className={css.overviewStepLabel}>步骤 {step.step || '—'}</span>
                        <span className={css.overviewStepSignals}>
                          {step.executionCount > 0 ? <span>{step.executionCount} 次</span> : null}
                          {step.parallel ? <span className={css.parallelLabel}>{step.executionCount} 项并行</span> : null}
                          {modelDuration === null ? null : <span>模型 {modelDuration}</span>}
                          {showStepTotal ? <span>总 {stepDuration}</span> : null}
                        </span>
                      </button>
                    </header>
                    {stepOpen ? (
                    <div id={`watcher-step-body-${step.id}`} className={css.overviewOccurrences}>
                      {shownEntries.map(entry => {
                        if (entry.kind === 'model') {
                          return (
                            <ModelStage
                              key={`model:${step.id}`}
                              trace={entry.trace}
                              stepId={step.id}
                              now={now}
                              open={modelOpen}
                              disclosure={disclosure}
                              onToggle={() => onToggleLayer('model', step.id)}
                              onToggleReasoning={key => onToggleReasoning(key, step.id)}
                            />
                          )
                        }

                        const item = entry.item
                        return (
                          <OverviewOccurrenceButton
                            key={item.id}
                            item={item}
                            occurrenceNumber={occurrenceNumbers.get(item.id) ?? 0}
                            branch={step.parallel ? entry.occurrenceIndex + 1 : null}
                            step={null}
                            live={stepLive && item.id === latestItemId && item.status === 'running'}
                            selected={selectedGroup && selectedItemId === item.id}
                            now={now}
                            onSelect={() => onSelectItem(item)}
                          />
                        )
                      })}
                    </div>
                    ) : null}
                  </section>
                )
              })}
            </div>
          )
          : (
            <div className={css.analysisClusters} data-observation-mode="grouped">
              {modelSteps.length === 0
                ? null
                : (
                  <section className={css.groupedModelStages} data-open={groupedModelsOpen ? '' : undefined}>
                    <button
                      type="button"
                      className={css.groupedModelToggle}
                      aria-expanded={groupedModelsOpen}
                      aria-controls={`watcher-grouped-models-${group.id}`}
                      onClick={() => onToggleLayer('model', groupedModelsKey)}
                    >
                      <IconChevronRightOutlineRegular size={11} className={css.groupedModelChevron} />
                      <span>
                        <strong>模型阶段汇总</strong>
                        <small>{modelSteps.length} 个 Step · 按 Step 保留，不合并推理</small>
                      </span>
                    </button>
                    {groupedModelsOpen ? (
                    <div
                      id={`watcher-grouped-models-${group.id}`}
                      className={css.groupedModelList}
                    >
                      {modelSteps.map(step => {
                        const modelOpen = layerDisclosureOpen(disclosure, 'model', step.id)
                        return (
                          <div key={step.id} className={css.groupedModelStep}>
                            <span className={css.groupedModelStepLabel}>步骤 {step.step || '—'}</span>
                            <ModelStage
                              trace={step.model}
                              stepId={`${step.id}:grouped`}
                              now={now}
                              open={modelOpen}
                              disclosure={disclosure}
                              onToggle={() => onToggleLayer('model', step.id)}
                              onToggleReasoning={key => onToggleReasoning(key, step.id)}
                            />
                          </div>
                        )
                      })}
                    </div>
                    ) : null}
                  </section>
                )}
              {clusters.map(cluster => {
                if (cluster.executionCount === 1) {
                  const item = cluster.items[0]
                  const sourceStep = sourceSteps.get(item.id)
                  const branch = sourceStep === undefined ? null : branchNumberOf(sourceStep, item)
                  return (
                    <div key={cluster.id} className={css.analysisSingleton}>
                      <OverviewOccurrenceButton
                        item={item}
                        occurrenceNumber={occurrenceNumbers.get(item.id) ?? 0}
                        branch={branch}
                        step={item.step}
                        live={isNow && running && item.id === latestItemId && item.status === 'running'}
                        selected={selectedGroup && selectedItemId === item.id}
                        now={now}
                        onSelect={() => onSelectItem(item)}
                      />
                    </div>
                  )
                }
                const clusterOpen = layerDisclosureOpen(disclosure, 'cluster', cluster.id)
                const basisLabel = clusterBasisLabel(cluster)
                const outcome = clusterOutcomeSummary(cluster)
                const clusterMeta = [
                  basisLabel,
                  `${cluster.executionCount} 次执行`,
                  `${cluster.stepCount} 个步骤`,
                  outcome,
                ].filter((part): part is string => part !== null && part !== '').join(' · ')
                return (
                  <section key={cluster.id} className={css.analysisCluster} data-open={clusterOpen ? '' : undefined}>
                    <button
                      type="button"
                      className={css.analysisClusterToggle}
                      aria-expanded={clusterOpen}
                      aria-controls={`watcher-cluster-body-${cluster.id}`}
                      aria-label={`${cluster.title}，${clusterMeta}，${clusterOpen ? '收起同类执行' : '展开同类执行'}`}
                      onClick={() => onToggleLayer('cluster', cluster.id)}
                    >
                      <IconChevronRightOutlineRegular size={11} className={css.analysisClusterChevron} />
                      <span className={css.analysisClusterDotSlot} aria-hidden="true">
                        <StatusMark status={cluster.latestStatus} className={css.analysisClusterDot} />
                      </span>
                      <span className={css.analysisClusterCopy}>
                        <span className={css.analysisClusterTitle}>{cluster.title}</span>
                        <span className={css.analysisClusterMeta}>{clusterMeta}</span>
                      </span>
                      {cluster.executionCount > 1
                        ? <span className={css.analysisClusterCount}>×{cluster.executionCount}</span>
                        : null}
                    </button>
                    {clusterOpen ? (
                    <div
                      id={`watcher-cluster-body-${cluster.id}`}
                      className={css.analysisClusterItems}
                    >
                      {cluster.items.map(item => {
                        const sourceStep = sourceSteps.get(item.id)
                        const branch = sourceStep === undefined ? null : branchNumberOf(sourceStep, item)
                        return (
                          <OverviewOccurrenceButton
                            key={item.id}
                            item={item}
                            occurrenceNumber={occurrenceNumbers.get(item.id) ?? 0}
                            branch={branch}
                            step={item.step}
                            live={isNow && running && item.id === latestItemId && item.status === 'running'}
                            selected={selectedGroup && selectedItemId === item.id}
                            now={now}
                            onSelect={() => onSelectItem(item)}
                          />
                        )
                      })}
                    </div>
                    ) : null}
                  </section>
                )
              })}
            </div>
          )}
      </div>
      ) : null}
    </section>
  )
}, (prev, next) =>
  prev.group === next.group
  && prev.isNow === next.isNow
  && prev.running === next.running
  && prev.turnTotalMs === next.turnTotalMs
  && prev.selectedGroup === next.selectedGroup
  && prev.selectedItemId === next.selectedItemId
  && prev.observationMode === next.observationMode
  && prev.open === next.open
  && prev.disclosure === next.disclosure
  && prev.filter === next.filter
)
