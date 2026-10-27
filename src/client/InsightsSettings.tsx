import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
// @ts-ignore TS7016: no declarations for the local .mjs module
import { scanSessions } from '../insights/presentation.mjs'
// @ts-ignore TS7016: no declarations for the local .mjs module
import { estimateDisclaimer, formatEstimate, formatEstimateNote } from '../insights/pricing.mjs'
// @ts-ignore TS7016: no declarations for the local .mjs module
import { costCopy } from '../insights/i18n.mjs'
import { Button, SegmentedControl } from '@deepseek-ai/dsh-client-ui-primitives'
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
/** The settings surface is a set of pages, not one long scroll. */
type SettingsTab = 'overview' | 'trends' | 'sessions' | 'prefs'

/** Settings-page surface: usage scan, headline metrics and the section stack. */
export function InsightsSettings(props: { remote?: any }) {
  const locale = useUiLocale()
  const pricing = usePricingTable()
  const copy = costCopy(locale)
  const userPickedRange = useRef(false)
  const [tab, setTab] = useState<SettingsTab>('overview')
  const [range, setRange] = useState<AnalyticsRange>('7')
  const [customViewMode, setCustomViewMode] = useState<ChartViewMode | null>(null)
  const [sessionSort, setSessionSort] = useState<SessionSort>('tokens')
  const [loading, setLoading] = useState(false)
  const [sessions, setSessions] = useState<SessionsScan | null>(null)
  const [scanError, setScanError] = useState<string | null>(null)
  const [activeDrilldown, setActiveDrilldown] = useState<Drilldown | null>(null)
  const drilldownRef = useRef<HTMLDivElement | null>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const mountedRef = useRef(true)
  /** A scan reads every session row: leaving the tab must not keep it running. */
  const scanAbort = useRef<AbortController | null>(null)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      scanAbort.current?.abort()
      scanAbort.current = null
    }
  }, [])

  useEffect(() => {
    if (!props.remote) return
    let active = true
    scanAbort.current?.abort()
    const controller = new AbortController()
    scanAbort.current = controller
    setLoading(true)
    setScanError(null)
    scanSessions(props.remote, { limit: 500, signal: controller.signal })
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
    return () => { active = false; controller.abort() }
  }, [props.remote])

  const refresh = () => {
    if (!props.remote || loading) return
    scanAbort.current?.abort()
    const controller = new AbortController()
    scanAbort.current = controller
    setLoading(true)
    setScanError(null)
    scanSessions(props.remote, { limit: 500, signal: controller.signal })
      .then((res: SessionsScan) => { if (mountedRef.current) setSessions(res) })
      .catch((error: unknown) => {
        if (mountedRef.current) setScanError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => { if (mountedRef.current) setLoading(false) })
  }

  const analytics = useMemo(() => analyticsOf(sessions, range, sessionSort, pricing), [sessions, range, sessionSort, pricing])

  // Drill-downs used to be inserted inline, pushing everything below them down.
  // They now open as a layer over the page and hand focus back on close.
  const closeDrilldown = useCallback(() => {
    setActiveDrilldown(null)
    const target = restoreFocusRef.current
    restoreFocusRef.current = null
    if (target !== null && target.isConnected) target.focus()
  }, [])

  const openDrilldown = useCallback((next: Drilldown | null) => {
    if (next === null) {
      closeDrilldown()
      return
    }
    if (restoreFocusRef.current === null) {
      restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    }
    setActiveDrilldown(next)
  }, [closeDrilldown])

  useEffect(() => {
    if (activeDrilldown === null) return
    drilldownRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closeDrilldown()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [activeDrilldown, closeDrilldown])
  // A scan skips sessions for concrete reasons (no cached projection yet, or a
  // subagent whose inherited prefix would double-count). Those reasons already
  // travel with the rows; folding them into one line explains the gap between
  // "scanned" and "counted" instead of leaving it a mystery.
  const skipped = useMemo(() => {
    const reasons = new Map<string, number>()
    for (const row of (sessions?.rows ?? []) as any[]) {
      if (row.value) continue
      const reason = typeof row.error === 'string' && row.error ? row.error : '未知原因'
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1)
    }
    return [...reasons.entries()].sort((a, b) => b[1] - a[1])
  }, [sessions])
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
          {tab === 'prefs' ? null : (
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
          )}
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

      <div className={css.settingsTabsRow}>
        <SegmentedControl
          id="watcher-settings"
          label="设置分区"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'overview', label: '概览' },
            { value: 'trends', label: '趋势' },
            { value: 'sessions', label: '会话' },
            { value: 'prefs', label: '偏好' },
          ]}
        />
        <p className={css.heroScanNote}>
          有统计的对话 <strong>{analytics ? `${analytics.validCount} / ${analytics.scannedCount}` : '-'}</strong>
          {analytics && analytics.scannedCount < analytics.listed
            ? `（会话较多，仅统计最近 ${analytics.scannedCount} / 共 ${analytics.listed} 个）`
            : ''}
        </p>
      </div>

      {scanError
        ? (
          <p className={css.scanError} role="alert">
            会话统计读取失败：{scanError}
          </p>
        )
        : null}

      <div
        id="watcher-settings-overview-panel"
        role="tabpanel"
        aria-labelledby="watcher-settings-overview"
        className={css.settingsPanel}
        hidden={tab !== 'overview'}
      >
        {tab === 'overview'
          ? (
            <>
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
              {skipped.length > 0
                ? (
                  <p className={css.heroScanNote}>
                    未纳入统计 {skipped.reduce((sum, [, count]) => sum + count, 0)} 个：
                    {skipped.map(([reason, count], index) => (
                      <span key={reason}>
                        {index > 0 ? ' · ' : ''}
                        <span title={reason}>{reason.replace(/[；;].*$/, '')}（{count}）</span>
                      </span>
                    ))}
                  </p>
                )
                : null}
              <RoastCards
                analytics={analytics}
                activeDrilldown={activeDrilldown}
                setActiveDrilldown={openDrilldown}
              />
            </>
          )
          : null}
      </div>

      <div
        id="watcher-settings-trends-panel"
        role="tabpanel"
        aria-labelledby="watcher-settings-trends"
        className={css.settingsPanel}
        hidden={tab !== 'trends'}
      >
        {tab === 'trends'
          ? (
            <>
              <UsageCharts
                analytics={analytics}
                range={range}
                viewMode={activeViewMode}
                setCustomViewMode={next => setCustomViewMode(next)}
              />
              {analytics ? <ActivityHeatmap analytics={analytics} /> : null}
            </>
          )
          : null}
      </div>

      <div
        id="watcher-settings-sessions-panel"
        role="tabpanel"
        aria-labelledby="watcher-settings-sessions"
        className={css.settingsPanel}
        hidden={tab !== 'sessions'}
      >
        {tab === 'sessions'
          ? (
            <SessionLedger
              analytics={analytics}
              sessions={sessions}
              sessionSort={sessionSort}
              setSessionSort={next => setSessionSort(next)}
            />
          )
          : null}
      </div>

      <div
        id="watcher-settings-prefs-panel"
        role="tabpanel"
        aria-labelledby="watcher-settings-prefs"
        className={css.settingsPanel}
        hidden={tab !== 'prefs'}
      >
        {tab === 'prefs' ? <SettingsPrefs copy={copy} /> : null}
      </div>


      {activeDrilldown && analytics
        ? (
          <div className={css.drilldownOverlay}>
            <button
              type="button"
              className={css.drilldownBackdrop}
              aria-label="关闭下钻详情"
              tabIndex={-1}
              onClick={closeDrilldown}
            />
            <div
              ref={drilldownRef}
              className={css.drilldownDialog}
              role="dialog"
              aria-modal="true"
              aria-label="指标下钻详情"
              tabIndex={-1}
            >
              <DrilldownPanel
                analytics={analytics}
                activeDrilldown={activeDrilldown}
                setActiveDrilldown={openDrilldown}
              />
            </div>
          </div>
        )
        : null}
    </div>
  )
}
