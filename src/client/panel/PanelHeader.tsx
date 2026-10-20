import { IconEllipsisOutlineRegular, IconSearchOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './panel.module.css'

/** Which tools the status bar currently has open; only one at a time. */
export type PanelTool = 'none' | 'search' | 'menu'

/**
 * The one persistent row of the panel, and a plain read-out: what the agent is
 * doing right now. Opening the work path is a separate control under the usage
 * readout, so this bar never moves when the path folds or unfolds.
 */
export function PanelHeader({
  status,
  nowLabel,
  running,
  alert,
  searchActive,
  tool,
  onToggleSearch,
  onToggleMenu,
}: {
  status: string
  nowLabel: string
  running: boolean
  alert: boolean
  searchActive: boolean
  tool: PanelTool
  onToggleSearch: () => void
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
