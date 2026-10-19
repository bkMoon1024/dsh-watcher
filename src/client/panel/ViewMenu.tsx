import { SegmentedToggle } from '../ui/SegmentedToggle.tsx'
import type { ObservationMode } from '../view-mode.ts'
import type { DisclosureDepth } from '../disclosure-depth.ts'
import css from './panel.module.css'

export type HistoryKind = 'idle' | 'loading' | 'complete' | 'error'

/**
 * The overflow menu keeps the view switches and the history actions out of the
 * persistent chrome. It is one small surface, opened on demand, so the default
 * panel is only a status bar and a path.
 */
export function ViewMenu({
  mode,
  depth,
  hasMore,
  olderLoading,
  historyKind,
  historyMessage,
  following,
  top,
  onMode,
  onDepth,
  onLoadOlder,
  onLoadAll,
  onBackToLatest,
}: {
  mode: ObservationMode
  depth: DisclosureDepth
  hasMore: boolean
  olderLoading: boolean
  historyKind: HistoryKind
  historyMessage: string | null
  following: boolean
  top: number
  onMode: (mode: ObservationMode) => void
  onDepth: (depth: DisclosureDepth) => void
  onLoadOlder: () => void
  onLoadAll: () => void
  onBackToLatest: () => void
}) {
  const historyBusy = historyKind === 'loading' || olderLoading
  return (
    <div
      id="watcher-view-menu"
      className={css.popover}
      data-watcher-overlay="menu"
      style={{ top }}
      role="dialog"
      aria-label="视图与历史"
    >
      <div className={css.viewMenu}>
        <div className={css.menuRow}>
          <span className={css.menuRowLabel}>组织</span>
          <SegmentedToggle
            label="路径组织方式"
            value={mode}
            onChange={onMode}
            options={[
              { value: 'itemized', label: '逐项', title: '按时间顺序展示每个步骤和每次执行' },
              { value: 'grouped', label: '归类', title: '按同一目标或完全相同的指令归类，展开仍可查看原始执行' },
            ]}
          />
        </div>
        <div className={css.menuRow}>
          <span className={css.menuRowLabel}>展开</span>
          <SegmentedToggle
            label="路径展开深度"
            value={depth}
            onChange={onDepth}
            options={[
              { value: 'overview', label: '概览', title: '展开当前轮次，展示阶段概览；阶段内部保持收起' },
              { value: 'detail', label: '详情', title: '展开所有轮次、阶段、步骤、模型与推理记录' },
            ]}
          />
        </div>
        <div className={css.menuDivider} aria-hidden="true" />
        <button
          type="button"
          className={css.menuItem}
          disabled={!hasMore || historyBusy}
          onClick={onLoadOlder}
        >
          <span>{olderLoading ? '正在载入更早的记录…' : '载入更早的记录'}</span>
          <span className={css.menuItemHint}>{hasMore ? '逐页' : '已到最早'}</span>
        </button>
        <button
          type="button"
          className={css.menuItem}
          disabled={historyKind === 'loading'}
          onClick={onLoadAll}
        >
          <span>{historyKind === 'loading' ? '正在补齐历史…' : historyKind === 'error' ? '重试载入全部历史' : '载入全部历史'}</span>
          <span className={css.menuItemHint}>{historyKind === 'error' ? '重试' : '→'}</span>
        </button>
        <button
          type="button"
          className={css.menuItem}
          disabled={following}
          onClick={onBackToLatest}
        >
          <span>跳到最新进展</span>
          <span className={css.menuItemHint}>{following ? '已跟随' : '↓'}</span>
        </button>
        {historyMessage === null ? null : <p className={css.menuStatus} role="status">{historyMessage}</p>}
      </div>
    </div>
  )
}
