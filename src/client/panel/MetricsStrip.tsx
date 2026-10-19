import { useMemo } from 'react'
// @ts-ignore TS7016: no declarations for the local .mjs module
import { estimateFromInsights, formatEstimate, formatEstimateNote } from '../../insights/pricing.mjs'
// @ts-ignore TS7016: no declarations for the local .mjs module
import { costCopy } from '../../insights/i18n.mjs'
import type { InsightsView } from '../../insights/projection.ts'
import { formatTokensPerSecond } from '../../observation/performance.ts'
import { fmtCompact, usePricingTable, useUiLocale } from '../insights-shared.tsx'
import css from './panel.module.css'

/**
 * One quiet line of numbers under the status bar: how much path is loaded and
 * what the session has spent. No borders and no chrome, so it reads as a
 * caption to the timeline rather than a second toolbar.
 */
export function MetricsStrip({
  turns,
  steps,
  actions,
  loadingHint,
  insights,
  running,
  tokensPerSecond,
}: {
  turns: string
  steps: string
  actions: string
  loadingHint: string
  insights: InsightsView | undefined
  running: boolean
  tokensPerSecond: number | null
}) {
  const pricing = usePricingTable()
  const locale = useUiLocale()
  const copy = costCopy(locale)
  const stats = insights?.totals
  // Whole-session numbers belong on the strip: the scope switch inside the
  // stats overlay only affects that overlay.
  const currentRoute = insights?.turn?.route ?? insights?.models?.[0]
  const estimate = useMemo(
    () => (insights !== undefined && stats !== undefined
      ? estimateFromInsights(insights, stats, 'session', undefined, currentRoute, pricing)
      : null),
    [insights, stats, currentRoute, pricing],
  )
  const totalIn = (stats?.input ?? 0) + (stats?.cacheRead ?? 0)
  const cachePct = totalIn > 0 ? Math.round(((stats?.cacheRead ?? 0) / totalIn) * 100) : 0
  const costText = estimate === null ? null : formatEstimate(estimate, locale)
  const costNote = estimate === null ? null : formatEstimateNote(estimate, locale)
  const costTitle = costText === null ? undefined : costNote === null ? `${copy.estimatedCost}: ${costText}` : `${copy.estimatedCost}: ${costText} · ${costNote}`

  return (
    <div className={css.metrics} aria-label="工作路径规模与用量">
      <span className={css.metricCounts} title={loadingHint}>{turns} · {steps} · {actions}</span>
      {stats === undefined || costText === null
        ? null
        : (
          <span className={css.metricUsage}>
            <span>{fmtCompact(stats.tokens ?? 0)} Token</span>
            <span className={css.metricDot} aria-hidden="true">·</span>
            <span className={css.metricCost} title={costTitle} aria-label={`${copy.estimatedCost}: ${costText}`}>
              {copy.estimatedCost} {costText}
            </span>
            <span className={css.metricDot} aria-hidden="true">·</span>
            <span>{cachePct}% 命中</span>
          </span>
        )}
      {tokensPerSecond === null
        ? null
        : <span className={css.metricSpeed} data-live={running ? '' : undefined}>{formatTokensPerSecond(tokensPerSecond)} tok/s</span>}
    </div>
  )
}
