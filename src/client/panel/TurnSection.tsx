import { memo } from 'react'
import { IconChevronRightOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { OVERVIEW_STATE_LABEL, overviewStateOf, turnNeedsDefaultDisclosure, turnOverviewSummary } from '../../hub/overview.ts'
import type { WorkGroup, WorkItem, WorkTurn } from '../../observation/fold.ts'
import { formatTokensPerSecond, type TurnPerformance } from '../../observation/performance.ts'
import { turnDuration, useLiveClock } from '../display.ts'
import {
  layerDisclosureOpen,
  turnDisclosureOpen,
  type DisclosureLayer,
  type DisclosureState,
} from '../disclosure-depth.ts'
import type { PathFilter } from '../path-filter.ts'
import type { ObservationMode } from '../view-mode.ts'
import { PhaseSection } from './PhaseSection.tsx'
import { showStateTag } from './panel-model.ts'
import css from './panel.module.css'

/**
 * One conversation turn: a single sticky header row and its phases. The header
 * is the only row that shows aggregate timing; each phase owns its own clock so
 * an idle panel never re-renders on the tick.
 */
export const TurnSection = memo(function TurnSection({
  turn,
  performance,
  isLatest,
  running,
  filterActive,
  mode,
  disclosure,
  filter,
  lastGroupId,
  lastItemId,
  selectedGroupId,
  selectedItemId,
  onToggle,
  onTogglePhase,
  onToggleLayer,
  onToggleReasoning,
  onSelectItem,
}: {
  turn: WorkTurn
  performance: TurnPerformance | undefined
  isLatest: boolean
  running: boolean
  filterActive: boolean
  mode: ObservationMode
  disclosure: DisclosureState
  filter: PathFilter
  lastGroupId: string | null
  lastItemId: string | null
  selectedGroupId: string | null
  selectedItemId: string | null
  onToggle: () => void
  onTogglePhase: (groupId: string) => void
  onToggleLayer: (layer: DisclosureLayer, key: string) => void
  onToggleReasoning: (key: string, modelKey: string) => void
  onSelectItem: (group: WorkGroup, item: WorkItem) => void
}) {
  const isLive = isLatest && running
  const now = useLiveClock(isLive)
  const state = overviewStateOf(turn.status, isLatest)
  const automaticDefaultOpen = turnNeedsDefaultDisclosure(state, isLatest)
  const turnOpen = filterActive || turnDisclosureOpen(disclosure, turn.turn, automaticDefaultOpen)
  const duration = turnDuration(turn, isLive, now)
  const tokenSpeed = performance?.throughput.kind === 'measured'
    ? `${formatTokensPerSecond(performance.throughput.tokensPerSecond)} tok/s`
    : null
  const durationText = duration === null
    ? OVERVIEW_STATE_LABEL[state]
    : duration.kind === 'exact'
      ? `总 ${duration.value}`
      : `已记录 ${duration.value}`
  const secondary = [
    duration?.kind === 'partial' ? '开头未载入' : null,
    tokenSpeed,
  ].filter((part): part is string => part !== null).join(' · ')
  const durationAria = duration === null
    ? ''
    : duration.kind === 'exact'
      ? `，总耗时 ${duration.value}`
      : `，已记录 ${duration.value}，开头未载入`
  const title = turn.turn === 0 ? '会话准备' : `对话轮次 ${turn.turn}`
  const label = turn.turn === 0 ? '准备' : `轮次 ${turn.turn}`
  const summary = turnOverviewSummary(turn)

  return (
    <section className={css.turn} data-state={state} aria-labelledby={`watcher-turn-${turn.turn}`}>
      <header className={css.turnHeader}>
        <h2 id={`watcher-turn-${turn.turn}`} className={css.turnHeading}>
          <button
            type="button"
            className={css.turnToggle}
            aria-expanded={turnOpen}
            aria-controls={`watcher-turn-body-${turn.turn}`}
            aria-label={`${title}，${OVERVIEW_STATE_LABEL[state]}，${summary}${durationAria}${tokenSpeed === null ? '' : `，生成速度 ${tokenSpeed}`}，${turnOpen ? '收起轮次' : '展开轮次'}`}
            title={turnOpen ? '收起此轮次；新进展仍会继续更新' : '展开此轮次'}
            onClick={onToggle}
          >
            <IconChevronRightOutlineRegular size={13} className={css.turnChevron} />
            <span className={css.turnLabel}>{label}</span>
            {showStateTag(state) ? <span className={css.stateTag} data-state={state}>{OVERVIEW_STATE_LABEL[state]}</span> : null}
            <span className={css.turnSummary}>{summary}</span>
            <span className={css.turnPerf}>
              <span>{durationText}</span>
              {secondary === '' ? null : <span className={css.turnSpeed}>{secondary}</span>}
            </span>
          </button>
        </h2>
      </header>
      {turnOpen ? (
        <div id={`watcher-turn-body-${turn.turn}`} className={css.turnBody}>
          {turn.groups.map(group => (
            <PhaseSection
              key={group.id}
              group={group}
              isNow={group.id === lastGroupId}
              running={running}
              lastItemId={lastItemId}
              selectedGroup={selectedGroupId === group.id}
              selectedItemId={selectedItemId}
              mode={mode}
              open={layerDisclosureOpen(disclosure, 'phase', group.id)}
              disclosure={disclosure}
              filter={filter}
              onToggle={() => onTogglePhase(group.id)}
              onToggleLayer={onToggleLayer}
              onToggleReasoning={onToggleReasoning}
              onSelectItem={item => onSelectItem(group, item)}
            />
          ))}
        </div>
      ) : null}
    </section>
  )
}, (prev, next) =>
  prev.turn === next.turn
  && prev.performance === next.performance
  && prev.isLatest === next.isLatest
  && prev.running === next.running
  && prev.filterActive === next.filterActive
  && prev.mode === next.mode
  && prev.disclosure === next.disclosure
  && prev.filter === next.filter
  && prev.lastGroupId === next.lastGroupId
  && prev.lastItemId === next.lastItemId
  && prev.selectedGroupId === next.selectedGroupId
  && prev.selectedItemId === next.selectedItemId
)
