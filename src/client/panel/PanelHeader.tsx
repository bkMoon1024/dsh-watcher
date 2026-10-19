import { IconEllipsisOutlineRegular, IconGaugeOutlineRegular, IconSearchOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './panel.module.css'

/** Which tools the status bar currently has open; only one at a time. */
export type PanelTool = 'none' | 'search' | 'stats' | 'menu'

/**
 * The one persistent row of the panel: what the agent is doing right now and
 * the three tools that open the rest. Everything else moved into the path or
 * into an overlay so the timeline stays the main surface.
 */
export function PanelHeader({
  status,
  nowLabel,
  running,
  alert,
  searchActive,
  tool,
  onToggleSearch,
  onToggleStats,
  onToggleMenu,
}: {
  status: string
  nowLabel: string
  running: boolean
  alert: boolean
  searchActive: boolean
  tool: PanelTool
  onToggleSearch: () => void
  onToggleStats: () => void
  onToggleMenu: () => void
}) {
  return (
    <header className={css.statusBar}>
      <div className={css.statusLeft}>
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
      </div>
      <div className={css.iconBar}>
        <button
          type="button"
          className={css.iconButton}
          data-active={searchActive ? '' : undefined}
          aria-expanded={searchActive}
          aria-controls="watcher-search-row"
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
          data-active={tool === 'stats' ? '' : undefined}
          aria-expanded={tool === 'stats'}
          aria-controls="watcher-stats-popover"
          data-watcher-tool="stats"
          aria-label={alert ? '查看用量与异常' : '查看用量与耗时'}
          title="用量与耗时"
          onClick={onToggleStats}
        >
          <IconGaugeOutlineRegular size={14} />
          {alert ? <span className={css.badge} aria-hidden="true" /> : null}
        </button>
        <button
          type="button"
          className={css.iconButton}
          data-active={tool === 'menu' ? '' : undefined}
          aria-expanded={tool === 'menu'}
          aria-controls="watcher-view-menu"
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
