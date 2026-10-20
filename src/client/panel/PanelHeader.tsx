import { IconChevronDownOutlineRegular, IconEllipsisOutlineRegular, IconSearchOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './panel.module.css'

/** Which tools the status bar currently has open; only one at a time. */
export type PanelTool = 'none' | 'search' | 'menu'

/**
 * The one persistent row of the panel. The activity line doubles as the button
 * that unfolds the work path under the usage readout: the stats stay in view,
 * the path opens on demand. Search and the view/history menu stay quiet icons,
 * and unfold the path themselves when it is collapsed.
 */
export function PanelHeader({
  status,
  nowLabel,
  running,
  alert,
  searchActive,
  tool,
  timelineOpen,
  onToggleTimeline,
  onToggleSearch,
  onToggleMenu,
}: {
  status: string
  nowLabel: string
  running: boolean
  alert: boolean
  searchActive: boolean
  tool: PanelTool
  timelineOpen: boolean
  onToggleTimeline: () => void
  onToggleSearch: () => void
  onToggleMenu: () => void
}) {
  return (
    <header className={css.statusBar}>
      <button
        type="button"
        className={css.statusToggle}
        data-open={timelineOpen ? '' : undefined}
        data-watcher-tool="timeline"
        aria-expanded={timelineOpen}
        aria-controls="watcher-timeline-section"
        aria-label={timelineOpen ? `收起执行路径，${status}` : `展开执行路径，${status}`}
        title={timelineOpen ? '收起执行路径' : '展开执行路径'}
        onClick={onToggleTimeline}
      >
        <span
          className={css.statusDot}
          data-state={running ? 'running' : alert ? 'alert' : 'idle'}
          aria-hidden="true"
        />
        {/* Only the coarse state is announced; the ticking label below would
            otherwise re-announce once per second. Idle sessions keep the bar
            down to the state word. */}
        <span className={css.statusText} aria-live="polite" data-alert={alert ? '' : undefined}>{status}</span>
        {running ? <span className={css.statusNow} aria-hidden="true" title={nowLabel}>{nowLabel}</span> : null}
        <IconChevronDownOutlineRegular size={13} className={css.statusChevron} />
      </button>
      <div className={css.iconBar}>
        <button
          type="button"
          className={css.iconButton}
          data-active={searchActive ? '' : undefined}
          aria-expanded={searchActive}
          aria-controls={searchActive ? 'watcher-search-row' : undefined}
          data-watcher-tool="search"
          aria-label={searchActive ? '收起路径搜索' : '搜索工作路径'}
          title={searchActive ? '收起搜索' : '搜索工作路径'}
          onClick={onToggleSearch}
        >
          <IconSearchOutlineRegular size={14} />
        </button>
        <button
          type="button"
          className={css.iconButton}
          data-active={tool === 'menu' ? '' : undefined}
          aria-expanded={tool === 'menu'}
          aria-controls={tool === 'menu' ? 'watcher-view-menu' : undefined}
          data-watcher-tool="menu"
          aria-label="视图与历史"
          title="视图与历史"
          onClick={onToggleMenu}
        >
          <IconEllipsisOutlineRegular size={14} />
        </button>
      </div>
    </header>
  )
}
