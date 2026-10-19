import type { InsightsView } from '../../insights/projection.ts'
import { SessionInsights, type Evidence } from '../SessionInsights.tsx'
import css from './panel.module.css'

/**
 * The full usage readout, on demand. It used to sit permanently above the
 * timeline; the strip keeps the headline numbers and this overlay holds the
 * timing distribution, model breakdown and health findings.
 */
export function StatsPopover({
  insights,
  now,
  running,
  waiting,
  tokensPerSecond,
  top,
  onEvidence,
  onClose,
}: {
  insights: InsightsView | undefined
  now: number
  running: boolean
  waiting: boolean
  tokensPerSecond: number | null
  top: number
  onEvidence: (evidence: Evidence) => void
  onClose: () => void
}) {
  // A cold session has no projection yet; the overlay should say so instead of
  // opening an empty card.
  const cold = insights === undefined
  return (
    <div
      id="watcher-stats-popover"
      className={`${css.popover} ${css.statsPopover}`}
      data-watcher-overlay="stats"
      style={{ top }}
      role="dialog"
      aria-label="用量与耗时"
    >
      {cold
        ? <p className={css.statsEmpty}>还没有可统计的用量。开始一轮对话后，这里会出现耗时分布、模型与花费。</p>
        : (
          <SessionInsights
            flat
            value={insights}
            now={now}
            running={running}
            waiting={waiting}
            onEvidence={onEvidence}
            tokensPerSecond={tokensPerSecond}
            onClose={onClose}
          />
        )}
    </div>
  )
}
