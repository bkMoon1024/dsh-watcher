import { useMemo, useState } from 'react'
// @ts-ignore TS7016: no declarations for the local .mjs module
import { alertsOf } from '../insights/presentation.mjs'
// @ts-ignore TS7016: no declarations for the local .mjs module
import { estimateFromInsights, formatEstimate, formatEstimateNote } from '../insights/pricing.mjs'
// @ts-ignore TS7016: no declarations for the local .mjs module
import { costCopy } from '../insights/i18n.mjs'
import type { InsightsView } from '../insights/projection.ts'
import css from './Insights.module.css'
import tokensCss from './ui/tokens.module.css'
import { TimingPanel } from './TimingPanel.tsx'
import { SegmentedToggle } from './ui/SegmentedToggle.tsx'
import {
  effortLabel,
  fmt,
  modelKeyOf,
  routeLabel,
  useLimits,
  usePricingTable,
  useUiLocale,
} from './insights-shared.tsx'

/** The in-panel session readout: cost, timing, per-turn evidence. */

export type Evidence = { turn: number; steps: number[]; seqs: number[] }

export function SessionInsights({ value, now, running, waiting, onEvidence, tokensPerSecond, flat = false, onClose }: {
  value: InsightsView | undefined; now: number; running: boolean; waiting: boolean; onEvidence: (e: Evidence) => void; tokensPerSecond?: number | null; flat?: boolean; onClose?: () => void
}) {
  const limits = useLimits()
  const pricing = usePricingTable()
  const locale = useUiLocale()
  const copy = costCopy(locale)
  const [scope, setScope] = useState<'turn' | 'session'>('turn')
  const [modelFilter, setModelFilter] = useState<'all' | string>('all')
  const [storedCollapsed, setCollapsed] = useState(() => {
    try { return globalThis.localStorage?.getItem('dsh-watcher:hud-collapsed') === '1' } catch { return false }
  })
  // A popover is always expanded: the collapsed state belongs to the inline
  // readout, and a stale stored value must not collapse an overlay.
  const collapsed = flat ? false : storedCollapsed
  const toggleCollapsed = () => {
    const next = !collapsed
    try { globalThis.localStorage?.setItem('dsh-watcher:hud-collapsed', next ? '1' : '0') } catch {}
    setCollapsed(next)
  }
  // Hooks stay above the early return so hook order never depends on load state.
  const selectedModel = scope === 'session' && modelFilter !== 'all' && value
    ? value.models.find(m => modelKeyOf(m) === modelFilter)
    : undefined
  const stats = value && scope === 'turn' && value.turn
    ? value.turn.stats
    : (selectedModel ?? value?.totals)
  // "本轮" must never label whole-session totals: before the first turn the
  // fallback below is session-wide, and the heading has to say so.
  const turnMissing = scope === 'turn' && !value?.turn
  const alerts = useMemo(() => alertsOf(value ?? null, now, { running, waiting, limits }), [value, now, running, waiting, limits])
  const currentRoute = value?.turn?.route ?? (value?.models && value.models.length > 0 ? value.models[0] : undefined)
  const estimate = useMemo(
    () => (value && stats ? estimateFromInsights(value, stats, scope, selectedModel, currentRoute, pricing) : null),
    [value, stats, scope, selectedModel, currentRoute, pricing],
  )
  if (!value || !stats || !estimate) return null

  const isMultiModel = (value.models?.length ?? 0) > 1
  const totalIn = (stats.input ?? 0) + (stats.cacheRead ?? 0)
  const cachePct = totalIn > 0 ? Math.round(((stats.cacheRead ?? 0) / totalIn) * 100) : 0
  const costText = formatEstimate(estimate, locale)
  const costNote = formatEstimateNote(estimate, locale)
  const costTitle = costNote ? `${copy.estimatedCost}: ${costText} · ${costNote}` : `${copy.estimatedCost}: ${costText}`

  const boxClass = flat ? `${css.hudBox} ${css.hudBoxFlat}` : css.hudBox

  return (
    <section className={`${tokensCss.tokens} ${tokensCss.series} ${boxClass}`} aria-label={flat ? '用量与耗时' : '耗时分布与运行健康度'} data-collapsed={collapsed ? '' : undefined} data-flat={flat ? '' : undefined}>
      <div className={css.hudTop}>
        <div className={css.hudHeadRow}>
          <div className={css.hudTopLeft}>
            <span className={css.hudHeading}>
              {flat
                ? '用量与耗时'
                : scope === 'turn'
                  ? (turnMissing ? '全会话' : '本轮')
                  : selectedModel
                    ? `模型: ${routeLabel(selectedModel)}`
                    : '全会话'}
            </span>
            {turnMissing
              ? <span className={css.hudHeadingNote} title="本轮尚未开始，以下为全会话累计数据">本轮未开始 · 已显示全会话</span>
              : null}
          </div>
          <div className={css.hudTopRight}>
            <SegmentedToggle
              label="统计范围切换"
              value={scope}
              onChange={next => {
                setScope(next)
                if (next === 'turn') setModelFilter('all')
              }}
              options={[
                { value: 'turn', label: '本轮' },
                { value: 'session', label: '全会话' },
              ]}
            />
            {flat
              ? null
              : (
                <button
                  type="button"
                  className={css.collapseBtn}
                  aria-expanded={!collapsed}
                  aria-label={collapsed ? '展开耗时统计' : '收起耗时统计'}
                  title={collapsed ? '展开耗时统计' : '收起耗时统计'}
                  onClick={toggleCollapsed}
                >
                  <span className={css.collapseChevron} aria-hidden="true">▾</span>
                </button>
              )}
            {onClose === undefined
              ? null
              : (
                <button
                  type="button"
                  className={css.popoverClose}
                  aria-label="关闭用量统计"
                  title="关闭"
                  onClick={onClose}
                >
                  <span aria-hidden="true">×</span>
                </button>
              )}
          </div>
        </div>
        <div className={css.statGrid}>
          {scope === 'turn' && currentRoute?.model ? (
            <div className={css.statCell} data-metric="model">
              <span className={css.statLabel}>模型</span>
              <span className={css.statValue} title={routeLabel(currentRoute)}>{routeLabel(currentRoute)}</span>
              {currentRoute.effort ? <span className={css.statNote}>思考 {effortLabel(currentRoute.effort)}</span> : null}
            </div>
          ) : null}
          <div className={css.statCell} data-metric="context">
            <span className={css.statLabel}>{scope === 'turn' ? '上下文' : '累计输入'}</span>
            <span className={css.statValue}>{fmt(stats.input ?? 0)}<span className={css.statUnit}> Token</span></span>
          </div>
          <div className={css.statCell} data-metric="tokens">
            <span className={css.statLabel}>Token</span>
            <span className={css.statValue}>{fmt(stats.tokens ?? 0)}</span>
            <span className={css.statNote}>{cachePct}% 命中</span>
          </div>
          <div className={css.statCell} data-metric="cost">
            <span className={css.statLabel}>{copy.estimatedCost}</span>
            <span className={css.statValue} title={costTitle} aria-label={`${copy.estimatedCost}: ${costText}`}>{costText}</span>
          </div>
        </div>
      </div>
      {!collapsed && scope === 'session' && isMultiModel ? (
        <SegmentedToggle
          label="多模型切换"
          className={css.modelTabBar}
          value={modelFilter}
          onChange={setModelFilter}
          options={[
            { value: 'all', label: `全部模型汇总 (${value.models.length})` },
            ...value.models.map((m: any) => ({
              value: modelKeyOf(m),
              label: `${routeLabel(m)} (${m.calls}次)`,
              title: routeLabel(m),
            })),
          ]}
        />
      ) : null}
      {collapsed ? null : (
      <div className={css.hudBody}>
        <TimingPanel stats={stats} scope={scope} tokensPerSecond={scope === 'turn' ? tokensPerSecond : undefined} compact={flat} />
        {alerts.length > 0 ? (
          <div className={css.alertSection} aria-live="polite">
            {alerts.map((a: Evidence & { id: string; title: string; detail: string; kind?: string }) => {
              const isRepeat = a.kind === 'repeated-failure' || a.id.startsWith('repeat')
              return (
                <div key={a.id} className={css.alertRow} data-danger={isRepeat ? '' : undefined}>
                  <span className={css.alertDot} aria-hidden="true" />
                  <div className={css.alertTexts}>
                    <strong className={css.alertMainText}>{a.title}</strong>
                    <span className={css.alertSubText}>{a.detail}</span>
                  </div>
                  <button type="button" className={css.alertAction} onClick={() => onEvidence(a)}>定位现场</button>
                </div>
              )
            })}
          </div>
        ) : null}
      </div>
      )}
    </section>
  )
}
