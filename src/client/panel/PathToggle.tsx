import { IconChevronDownOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './panel.module.css'

/**
 * The one control for the secondary window: a quiet row under the usage
 * readout that unfolds the path. It starts folded, so the card reads as a
 * status board first and a path viewer only on demand.
 */
export function PathToggle({
  open,
  counts,
  hint,
  onToggle,
}: {
  open: boolean
  counts: string
  hint: string
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      className={css.pathToggle}
      data-open={open ? '' : undefined}
      data-watcher-tool="timeline"
      aria-expanded={open}
      aria-controls="watcher-timeline-body"
      title={open ? '收起执行路径' : '展开执行路径'}
      onClick={onToggle}
    >
      <span className={css.pathLabel}>执行路径</span>
      <span className={css.pathCounts} title={hint}>{counts}</span>
      <IconChevronDownOutlineRegular size={13} className={css.pathChevron} />
    </button>
  )
}
