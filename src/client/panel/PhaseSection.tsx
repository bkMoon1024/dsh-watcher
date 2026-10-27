import { memo, useMemo } from 'react'
import { IconChevronRightOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { clusterWorkItems } from '../../hub/aggregation.ts'
import { OVERVIEW_STATE_LABEL, overviewStateOf } from '../../hub/overview.ts'
import type { WorkGroup, WorkItem, WorkStep } from '../../observation/fold.ts'
import type { ModelStepTrace } from '../../observation/model-trace.ts'
import { groupElapsedMs, stepElapsedMs } from '../../observation/performance.ts'
import { formatDuration, useLiveClock } from '../display.ts'
import { layerDisclosureOpen, layerDisclosureOverride, type DisclosureLayer, type DisclosureState } from '../disclosure-depth.ts'
import { ModelStage } from '../ModelStage.tsx'
import { StatusMark } from '../StatusMark.tsx'
import type { PathFilter } from '../path-filter.ts'
import type { ObservationMode } from '../view-mode.ts'
import { OccurrenceRow } from './OccurrenceRow.tsx'
import {
  branchNumberOf,
  clusterMetaText,
  groupSignals,
  phaseFilterView,
  phaseMetaText,
  phaseStepRows,
} from './panel-model.ts'
import css from './panel.module.css'

/**
 * One phase of the path. In itemized mode a step that owns a single record is
 * drawn as that record (the step number folds into the meta line); everything
 * else keeps a quiet step header with the records indented under it. In grouped
 * mode records are clustered by the aggregation projection and model stages get
 * one collapsed summary per phase.
 *
 * Memoized with a comparator that ignores `now` and the callbacks: the phase
 * owns its live clock, and only the running phase subscribes to it.
 */
export const PhaseSection = memo(function PhaseSection({
  group,
  isNow,
  running,
  lastItemId,
  selectedGroup,
  selectedItemId,
  mode,
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
  lastItemId: string | null
  selectedGroup: boolean
  selectedItemId: string | null
  mode: ObservationMode
  open: boolean
  disclosure: DisclosureState
  filter: PathFilter
  onToggle: () => void
  onToggleLayer: (layer: DisclosureLayer, key: string) => void
  onToggleReasoning: (key: string, modelKey: string) => void
  onSelectItem: (item: WorkItem) => void
}) {
  const now = useLiveClock(isNow && running)
  const state = overviewStateOf(group.status, isNow)
  const duration = formatDuration(groupElapsedMs(group, isNow && running, now))
  const filterView = useMemo(() => phaseFilterView(group, filter), [group, filter])
  const filterActive = filterView.visibleItemIds !== null
  const rows = useMemo(
    () => phaseStepRows(group, filterView.visibleItemIds),
    [group, filterView.visibleItemIds],
  )
  // Grouped mode is the only reader of these two projections. Itemized mode
  // used to compute both and throw them away on every live tick, which is real
  // work: clustering walks every item of the phase and the model filter walks
  // every step.
  const grouped = mode === 'grouped'
  const clusters = useMemo(() => {
    if (!grouped) return []
    const sourceItems = group.items.filter(item => item.source !== 'model')
    const visible = filterView.visibleItemIds
    return clusterWorkItems(visible === null ? sourceItems : sourceItems.filter(item => visible.has(item.id)))
  }, [grouped, group, filterView.visibleItemIds])
  const modelSteps = useMemo(
    () => (grouped && filterView.visibleItemIds === null
      ? group.steps.filter((step): step is WorkStep & { model: ModelStepTrace } => step.model !== null)
      : []),
    [grouped, group, filterView.visibleItemIds],
  )
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
  const phaseMeta = phaseMetaText(group, duration)
  // A filter is a reading intent: matching rows must be on screen without
  // another click, so the phase opens itself while the path is narrowed. An
  // explicit toggle still wins in both directions, otherwise the header's
  // chevron would look broken for as long as the filter stays on.
  const effectiveOpen = layerDisclosureOverride(disclosure, 'phase', group.id)
    ?? (open || (filterActive && !filterView.matchesNothing))

  if (filterView.matchesNothing) return null

  return (
    <section
      className={css.phase}
      data-phase={group.phase}
      data-selected={selectedGroup ? '' : undefined}
      data-now={isNow ? '' : undefined}
      data-overview-state={state}
      aria-label={`${group.title}，${phaseMeta}，${OVERVIEW_STATE_LABEL[state]}`}
    >
      <header className={css.phaseHeader}>
        <button
          type="button"
          className={css.phaseToggle}
          aria-expanded={effectiveOpen}
          aria-controls={`watcher-phase-body-${group.id}`}
          aria-label={`${group.title}，${phaseMeta}，${effectiveOpen ? '收起阶段' : '展开阶段'}`}
          onClick={onToggle}
        >
          <IconChevronRightOutlineRegular size={12} className={css.phaseChevron} />
          <span className={css.phaseMarker} data-state={state} aria-hidden="true" />
          <span className={css.phaseTitle} data-watcher-group-title="">{group.title}</span>
          {groupSignals(group).map(signal => (
            <span key={signal.kind} className={css.phaseSignal}>{signal.label}</span>
          ))}
          {/* A failed phase is already the only red marker in the path and its
              turn header carries the full tag; repeating it on every row is
              noise. Only states that ask something of the reader stay. */}
          {state === 'waiting' || state === 'interrupted' || state === 'partial'
            ? <span className={css.stateTag} data-state={state}>{OVERVIEW_STATE_LABEL[state]}</span>
            : null}
          <span className={css.phaseMeta}>{phaseMeta}</span>
        </button>
      </header>

      {effectiveOpen ? (
        <div id={`watcher-phase-body-${group.id}`} className={css.phaseBody}>
          {mode === 'itemized' ? (
            <div className={css.stepList} data-observation-mode="itemized">
              {rows.map(({ step, entries, flat }) => {
                if (flat) {
                  const entry = entries[0]
                  if (entry === undefined || entry.kind !== 'occurrence') return null
                  const item = entry.item
                  const live = isNow && running && item.id === lastItemId && item.status === 'running'
                  return (
                    <OccurrenceRow
                      key={step.id}
                      item={item}
                      index={occurrenceNumbers.get(item.id) ?? 0}
                      branch={null}
                      stepNumber={step.step}
                      live={live}
                      selected={selectedGroup && selectedItemId === item.id}
                      now={now}
                      indent={false}
                      onSelect={() => onSelectItem(item)}
                    />
                  )
                }

                const stepLive = isNow && running
                  && step.items.some(item => item.id === lastItemId && item.status === 'running')
                const stepDuration = formatDuration(stepElapsedMs(step, stepLive, now))
                const stepOpen = layerDisclosureOpen(disclosure, 'step', step.id)
                const modelOpen = layerDisclosureOpen(disclosure, 'model', step.id)
                return (
                  <section
                    key={step.id}
                    className={css.step}
                    data-current={stepLive ? '' : undefined}
                    data-parallel={step.parallel ? '' : undefined}
                  >
                    <button
                      type="button"
                      className={css.stepToggle}
                      aria-expanded={stepOpen}
                      aria-controls={`watcher-step-body-${step.id}`}
                      aria-label={`步骤 ${step.step || '—'}，${step.executionCount} 次执行${stepDuration === null ? '' : `，耗时 ${stepDuration}`}，${stepOpen ? '收起步骤' : '展开步骤'}`}
                      onClick={() => onToggleLayer('step', step.id)}
                    >
                      <IconChevronRightOutlineRegular size={11} className={css.stepChevron} />
                      <span className={css.stepLabel}>步骤 {step.step || '—'}</span>
                      <span className={css.stepSignals}>
                        <span>{step.executionCount} 次</span>
                        {step.parallel ? <span>{step.executionCount} 项并行</span> : null}
                        {stepDuration === null ? null : <span>{stepDuration}</span>}
                      </span>
                    </button>
                    {stepOpen ? (
                      <div id={`watcher-step-body-${step.id}`} className={css.stepBody}>
                        {entries.map(entry => (
                          entry.kind === 'model'
                            ? (
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
                            : (
                              <OccurrenceRow
                                key={entry.item.id}
                                item={entry.item}
                                index={occurrenceNumbers.get(entry.item.id) ?? 0}
                                branch={step.parallel ? entry.occurrenceIndex + 1 : null}
                                stepNumber={null}
                                live={stepLive && entry.item.id === lastItemId && entry.item.status === 'running'}
                                selected={selectedGroup && selectedItemId === entry.item.id}
                                now={now}
                                indent
                                onSelect={() => onSelectItem(entry.item)}
                              />
                            )
                        ))}
                      </div>
                    ) : null}
                  </section>
                )
              })}
            </div>
          ) : (
            <div className={css.clusterList} data-observation-mode="grouped">
              {modelSteps.length === 0
                ? null
                : (
                  <section className={css.modelSummary} data-open={groupedModelsOpen ? '' : undefined}>
                    <button
                      type="button"
                      className={css.modelSummaryToggle}
                      aria-expanded={groupedModelsOpen}
                      aria-controls={`watcher-grouped-models-${group.id}`}
                      onClick={() => onToggleLayer('model', groupedModelsKey)}
                    >
                      <IconChevronRightOutlineRegular size={11} className={css.modelSummaryChevron} />
                      <span>模型阶段汇总</span>
                      <span className={css.modelSummaryMeta}>{modelSteps.length} 个 Step · 按 Step 保留，不合并推理</span>
                    </button>
                    {groupedModelsOpen ? (
                      <div id={`watcher-grouped-models-${group.id}`} className={css.modelSummaryList}>
                        {modelSteps.map(step => {
                          const modelOpen = layerDisclosureOpen(disclosure, 'model', step.id)
                          return (
                            <div key={step.id} className={css.modelSummaryStep}>
                              <span className={css.modelSummaryStepLabel}>步骤 {step.step || '—'}</span>
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
                  const live = isNow && running && item.id === lastItemId && item.status === 'running'
                  return (
                    <OccurrenceRow
                      key={cluster.id}
                      item={item}
                      index={occurrenceNumbers.get(item.id) ?? 0}
                      branch={sourceStep === undefined ? null : branchNumberOf(sourceStep, item)}
                      stepNumber={item.step}
                      live={live}
                      selected={selectedGroup && selectedItemId === item.id}
                      now={now}
                      indent={false}
                      onSelect={() => onSelectItem(item)}
                    />
                  )
                }
                const clusterOpen = layerDisclosureOpen(disclosure, 'cluster', cluster.id)
                const clusterMeta = clusterMetaText(cluster)
                return (
                  <section key={cluster.id} className={css.cluster} data-open={clusterOpen ? '' : undefined}>
                    <button
                      type="button"
                      className={css.clusterToggle}
                      aria-expanded={clusterOpen}
                      aria-controls={`watcher-cluster-body-${cluster.id}`}
                      aria-label={`${cluster.title}，${clusterMeta}，${clusterOpen ? '收起同类执行' : '展开同类执行'}`}
                      onClick={() => onToggleLayer('cluster', cluster.id)}
                    >
                      <IconChevronRightOutlineRegular size={11} className={css.clusterChevron} />
                      <span className={css.clusterDot} aria-hidden="true"><StatusMark status={cluster.latestStatus} /></span>
                      <span className={css.clusterTitle}>{cluster.title}</span>
                      <span className={css.clusterMeta}>{clusterMeta}</span>
                      <span className={css.clusterCount}>×{cluster.executionCount}</span>
                    </button>
                    {clusterOpen ? (
                      <div id={`watcher-cluster-body-${cluster.id}`} className={css.clusterBody}>
                        {cluster.items.map(item => {
                          const sourceStep = sourceSteps.get(item.id)
                          return (
                            <OccurrenceRow
                              key={item.id}
                              item={item}
                              index={occurrenceNumbers.get(item.id) ?? 0}
                              branch={sourceStep === undefined ? null : branchNumberOf(sourceStep, item)}
                              stepNumber={item.step}
                              live={isNow && running && item.id === lastItemId && item.status === 'running'}
                              selected={selectedGroup && selectedItemId === item.id}
                              now={now}
                              indent
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
  && prev.lastItemId === next.lastItemId
  && prev.selectedGroup === next.selectedGroup
  && prev.selectedItemId === next.selectedItemId
  && prev.mode === next.mode
  && prev.open === next.open
  && prev.disclosure === next.disclosure
  && prev.filter === next.filter
)
