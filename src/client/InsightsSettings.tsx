import { useEffect, useMemo, useRef, useState } from 'react'
// @ts-ignore TS7016: no declarations for the local .mjs module
import { scanSessions } from '../insights/presentation.mjs'
// @ts-ignore TS7016: no declarations for the local .mjs module
import { estimateDisclaimer, formatEstimate, formatEstimateNote } from '../insights/pricing.mjs'
// @ts-ignore TS7016: no declarations for the local .mjs module
import { costCopy } from '../insights/i18n.mjs'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './Insights.module.css'
import tokensCss from './ui/tokens.module.css'
import { SegmentedToggle } from './ui/SegmentedToggle.tsx'
import { analyticsOf, type AnalyticsRange, type SessionSort, type SessionsScan } from './insights-analytics.ts'
import { fmtCompact, usePricingTable, useUiLocale } from './insights-shared.tsx'
import { RoastCards } from './insights-sections/RoastCards.tsx'
import { DrilldownPanel } from './insights-sections/DrilldownPanel.tsx'
import { UsageCharts } from './insights-sections/UsageCharts.tsx'
import { ActivityHeatmap } from './insights-sections/ActivityHeatmap.tsx'
import { SessionLedger } from './insights-sections/SessionLedger.tsx'
import { SettingsPrefs } from './insights-sections/SettingsPrefs.tsx'

type Drilldown = 'speed' | 'latency' | 'thinking' | 'cache' | 'tool' | 'reliability'
type ChartViewMode = 'bar' | 'line'

/** Settings-page surface: usage scan, headline metrics and the section stack. */
export function InsightsSettings(props: { remote?: any }) {
  const locale = useUiLocale()
  const pricing = usePricingTable()
  const copy = costCopy(locale)
  const userPickedRange = useRef(false)
  const [range, setRange] = useState<AnalyticsRange>('7')
  const [customViewMode, setCustomViewMode] = useState<ChartViewMode | null>(null)
  const [sessionSort, setSessionSort] = useState<SessionSort>('tokens')
  const [loading, setLoading] = useState(false)
  const [sessions, setSessions] = useState<SessionsScan | null>(null)
  const [scanError, setScanError] = useState<string | null>(null)
  const [activeDrilldown, setActiveDrilldown] = useState<Drilldown | null>(null)
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    if (!props.remote) return
    let active = true
    setLoading(true)
    setScanError(null)
    scanSessions(props.remote, { limit: 500 })
      .then((res: SessionsScan) => {
        if (active) {
          setSessions(res)
          // 智能感知：如果历史跨度确实超过 7 天，自动提档到 30 天；否则保持清爽的 7 天
          if (!userPickedRange.current) {
            const times = (res?.rows ?? [])
              .map((r: any) => r.updatedAt)
              .filter((t: any) => typeof t === 'number' && t > 0)
            if (times.length >= 2) {
              const span = Math.max(...times) - Math.min(...times)
              if (span > 7 * 86400000) {
                setRange('30')
              }
            }
          }
        }
      })
      .catch((error: unknown) => {
        if (active) setScanError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [props.remote])

  const refresh = () => {
    if (!props.remote || loading) return
    setLoading(true)
    setScanError(null)
    scanSessions(props.remote, { limit: 500 })
      .then((res: SessionsScan) => { if (mountedRef.current) setSessions(res) })
      .catch((error: unknown) => {
        if (mountedRef.current) setScanError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => { if (mountedRef.current) setLoading(false) })
  }

  const analytics = useMemo(() => analyticsOf(sessions, range, sessionSort, pricing), [sessions, range, sessionSort, pricing])
  const activeViewMode = customViewMode ?? (range === '30' || range === '180' ? 'line' : 'bar')
  const cacheNote = !analytics
    ? ''
    : analytics.cacheHitPct >= 70 ? '命中较高'
      : analytics.cacheHitPct >= 40 ? '一般'
        : '命中偏低'
  const heroCostText = analytics ? formatEstimate(analytics.estimatedCost, locale) : '-'
  const heroCostNote = analytics ? formatEstimateNote(analytics.estimatedCost, locale) : ''
  const heroCostTitle = [estimateDisclaimer(locale), heroCostNote].filter(Boolean).join(' · ')

  return (
    <div className={`${tokensCss.tokens} ${tokensCss.series} ${css.settingsContainer}`} data-wi-ui="v2">
      <div className={css.cockpitHeader}>
        <div className={css.cockpitTitleArea}>
          <h2 className={css.cockpitMainTitle}>用量统计与模型洞察</h2>
          <p className={css.cockpitSubTitle}>只读汇总本地已缓存的对话。按活动日期归组，无额外后台开销。</p>
        </div>
        <div className={css.headerRightControls}>
          <SegmentedToggle
            label="统计时间范围"
            value={range}
            onChange={next => { userPickedRange.current = true; setRange(next); setCustomViewMode(null) }}
            options={[
              { value: '7', label: '近 7 天' },
              { value: '30', label: '近 30 天' },
              { value: '180', label: '近 6 个月' },
            ]}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={refresh}
            disabled={loading || !props.remote}
            title={!props.remote ? '会话服务不可用，暂时无法刷新' : '重新扫描本地会话统计'}
          >
            {loading ? '正在刷新' : '刷新'}
          </Button>
        </div>
      </div>

      <div className={css.heroStatsRow}>
        <div className={css.heroMetric}>
          <span className={css.heroCaption}>Token 总消耗</span>
          <strong className={css.heroValue}>{analytics ? fmtCompact(analytics.totalTokens) : '-'}</strong>
        </div>
        <div
          className={css.heroMetric}
          title={heroCostTitle}
          aria-label={`${copy.estimatedCost}: ${heroCostText}`}
        >
          <span className={css.heroCaption}>{copy.estimatedCost}</span>
          <strong className={css.heroValue}>{heroCostText}</strong>
          {heroCostNote ? <span className={css.heroFootnote}>{heroCostNote}</span> : null}
        </div>
        <div className={css.heroMetric}>
          <span className={css.heroCaption}>累计耗时</span>
          <strong className={css.heroValue}>{analytics ? `${analytics.totalTimeHours} 小时` : '-'}</strong>
        </div>
        <div className={css.heroMetric}>
          <span className={css.heroCaption}>缓存命中</span>
          <strong className={css.heroValue}>{analytics ? `${analytics.cacheHitPct}%` : '-'}</strong>
          <span className={css.heroFootnote}>{analytics ? `${cacheNote} · 复用 ${fmtCompact(analytics.totalCacheRead)} Token` : ''}</span>
        </div>
      </div>
      <p className={css.heroScanNote}>
        有统计的对话 <strong>{analytics ? `${analytics.validCount} / ${analytics.scannedCount}` : '-'}</strong>
        {analytics && analytics.scannedCount < analytics.listed
          ? `（会话较多，仅统计最近 ${analytics.scannedCount} / 共 ${analytics.listed} 个）`
          : ''}
      </p>
      {scanError
        ? (
          <p className={css.scanError} role="alert">
            会话统计读取失败：{scanError}
          </p>
        )
        : null}
      <RoastCards
        analytics={analytics}
        activeDrilldown={activeDrilldown}
        setActiveDrilldown={next => setActiveDrilldown(next)}
      />

      {activeDrilldown && analytics ? (
        <DrilldownPanel
          analytics={analytics}
          activeDrilldown={activeDrilldown}
          setActiveDrilldown={next => setActiveDrilldown(next)}
        />
      ) : null}

      <UsageCharts
        analytics={analytics}
        range={range}
        viewMode={activeViewMode}
        setCustomViewMode={next => setCustomViewMode(next)}
      />

      {analytics ? <ActivityHeatmap analytics={analytics} /> : null}

      <SessionLedger
        analytics={analytics}
        sessions={sessions}
        sessionSort={sessionSort}
        setSessionSort={next => setSessionSort(next)}
      />

      <SettingsPrefs copy={copy} />
    </div>
  )
}
