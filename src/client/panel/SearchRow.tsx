import { IconSearchOutlineRegular, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { SegmentedToggle } from '../ui/SegmentedToggle.tsx'
import { pathFilterActive, type PathFilter, type PathStatusFilter } from '../path-filter.ts'
import css from './panel.module.css'

/**
 * The search and status filter live on their own row, opened from the status
 * bar. The row stays visible while a filter is active so the narrowed path can
 * always be widened again without hunting for a hidden control.
 */
export function SearchRow({
  filter,
  onChange,
  onClear,
}: {
  filter: PathFilter
  onChange: (filter: PathFilter) => void
  onClear: () => void
}) {
  return (
    <div id="watcher-search-row" className={css.searchRow} data-watcher-overlay="search" role="search" aria-label="搜索工作路径">
      <Input
        className={css.searchInput}
        icon={<IconSearchOutlineRegular size={14} />}
        value={filter.query}
        onChange={event => onChange({ ...filter, query: event.target.value })}
        placeholder="搜索标题、工具或阶段"
        aria-label="搜索标题、工具或阶段"
        autoFocus
      />
      <SegmentedToggle
        label="路径筛选"
        value={filter.status}
        onChange={(status: PathStatusFilter) => onChange({ ...filter, status })}
        options={[
          { value: 'all', label: '全部', title: '显示全部记录' },
          { value: 'issues', label: '异常', title: '只显示失败与中断的记录' },
          { value: 'waiting', label: '等待', title: '只显示等待确认的记录' },
        ]}
      />
      {pathFilterActive(filter)
        ? <button type="button" className={css.clearButton} onClick={onClear}>清除</button>
        : <span className={css.searchHint}>输入以筛选路径 · Esc 收起</span>}
    </div>
  )
}
