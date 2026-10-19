import { IconChevronRightOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkItem } from '../../observation/fold.ts'
import { itemElapsedMs } from '../../observation/performance.ts'
import { formatDuration } from '../display.ts'
import { STATUS_LABEL } from '../labels.ts'
import { StatusMark } from '../StatusMark.tsx'
import { itemMetaText } from './panel-model.ts'
import css from './panel.module.css'

/**
 * One record of the path, on a single line. The index is the record's position
 * in its phase and stays stable while the path is filtered; the meta line
 * carries step, tool, branch and retry context that used to need extra rows.
 */
export function OccurrenceRow({
  item,
  index,
  branch,
  stepNumber,
  live,
  selected,
  now,
  indent,
  onSelect,
}: {
  item: WorkItem
  index: number
  branch: number | null
  stepNumber: number | null
  live: boolean
  selected: boolean
  now: number
  indent: boolean
  onSelect: () => void
}) {
  const duration = formatDuration(itemElapsedMs(item, live, now))
  const meta = itemMetaText(item, { branch, stepNumber })
  return (
    <button
      type="button"
      className={css.itemRow}
      data-phase={item.phase}
      data-status={item.status}
      data-selected={selected ? '' : undefined}
      data-current={live ? '' : undefined}
      data-indent={indent ? '' : undefined}
      data-ud-motion="watcher-live-append"
      aria-current={live ? 'step' : undefined}
      aria-pressed={selected}
      aria-label={`记录 ${index}，${item.title}，${meta}${duration === null ? '' : `，耗时 ${duration}`}，${STATUS_LABEL[item.status]}`}
      onClick={onSelect}
    >
      <span className={css.itemIndex} aria-hidden="true">{String(index).padStart(2, '0')}</span>
      <span className={css.itemDot} aria-hidden="true"><StatusMark status={item.status} /></span>
      <span className={css.itemCopy}>
        <span className={css.itemTitle}>{item.title}</span>
        {meta === '' ? null : <span className={css.itemMeta}>{meta}</span>}
      </span>
      {duration === null ? null : <span className={css.itemDuration}>{duration}</span>}
      <IconChevronRightOutlineRegular size={12} className={css.itemChevron} />
    </button>
  )
}
