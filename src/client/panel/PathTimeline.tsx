import type { RefObject } from 'react'
import { IconChevronRightOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { overviewStateOf, turnNeedsDefaultDisclosure } from '../../hub/overview.ts'
import type { WorkGroup, WorkItem, WorkTurn } from '../../observation/fold.ts'
import type { TurnPerformance } from '../../observation/performance.ts'
import type { DisclosureLayer, DisclosureState } from '../disclosure-depth.ts'
import type { PathFilter } from '../path-filter.ts'
import type { ObservationMode } from '../view-mode.ts'
import type { HistoryKind } from './ViewMenu.tsx'
import { TurnSection } from './TurnSection.tsx'
import css from './panel.module.css'

/**
 * The scrollable path: a dashed "load older" row at the top of the loaded
 * window, then one section per turn. The viewport itself is owned here so the
 * follow behaviour in the panel can keep reading and writing its scrollTop.
 */
export function PathTimeline({
  turns,
  viewportRef,
  onScroll,
  performanceByTurn,
  latestTurnNumber,
  running,
  filterActive,
  filter,
  mode,
  disclosure,
  lastGroupId,
  lastItemId,
  selectedGroupId,
  selectedItemId,
  hasMore,
  olderLoading,
  historyKind,
  historyMessage,
  onLoadOlder,
  onToggleTurn,
  onTogglePhase,
  onToggleLayer,
  onToggleReasoning,
  onSelectItem,
}: {
  turns: readonly WorkTurn[]
  viewportRef: RefObject<HTMLDivElement>
  onScroll: () => void
  performanceByTurn: ReadonlyMap<number, TurnPerformance>
  latestTurnNumber: number | null
  running: boolean
  filterActive: boolean
  filter: PathFilter
  mode: ObservationMode
  disclosure: DisclosureState
  lastGroupId: string | null
  lastItemId: string | null
  selectedGroupId: string | null
  selectedItemId: string | null
  hasMore: boolean
  olderLoading: boolean
  historyKind: HistoryKind
  historyMessage: string | null
  onLoadOlder: () => void
  onToggleTurn: (turn: number, automaticDefaultOpen: boolean) => void
  onTogglePhase: (groupId: string) => void
  onToggleLayer: (layer: DisclosureLayer, key: string) => void
  onToggleReasoning: (key: string, modelKey: string) => void
  onSelectItem: (group: WorkGroup, item: WorkItem) => void
}) {
  return (
    <div className={css.railViewport} ref={viewportRef} onScroll={onScroll}>
      <div className={css.turns}>
        {hasMore ? (
          <div className={css.moreRow}>
            <button
              type="button"
              className={css.moreButton}
              onClick={onLoadOlder}
              disabled={olderLoading}
              title="只往回载入一页历史；继续点击可逐页翻到会话开头"
            >
              <IconChevronRightOutlineRegular size={11} className={css.moreChevron} />
              {olderLoading ? '正在载入更早的记录…' : '载入更早的记录'}
            </button>
            {historyKind === 'error' && historyMessage !== null
              ? <span className={css.moreStatus} role="status">{historyMessage}</span>
              : null}
          </div>
        ) : null}
        {turns.map(turn => {
          const isLatest = turn.turn === latestTurnNumber
          const state = overviewStateOf(turn.status, isLatest)
          const automaticDefaultOpen = turnNeedsDefaultDisclosure(state, isLatest)
          return (
            <TurnSection
              key={turn.turn}
              turn={turn}
              performance={performanceByTurn.get(turn.turn)}
              isLatest={isLatest}
              running={running}
              filterActive={filterActive}
              mode={mode}
              disclosure={disclosure}
              filter={filter}
              lastGroupId={lastGroupId}
              lastItemId={lastItemId}
              selectedGroupId={selectedGroupId}
              selectedItemId={selectedItemId}
              onToggle={() => onToggleTurn(turn.turn, automaticDefaultOpen)}
              onTogglePhase={onTogglePhase}
              onToggleLayer={onToggleLayer}
              onToggleReasoning={onToggleReasoning}
              onSelectItem={onSelectItem}
            />
          )
        })}
      </div>
    </div>
  )
}
