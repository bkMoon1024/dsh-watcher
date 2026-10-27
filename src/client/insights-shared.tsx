import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
// Untyped local ESM helpers: single .mjs source kept for node tests.
// @ts-ignore TS7016: no declarations for the local .mjs module
import { DEFAULT_LIMITS, limitsOf } from '../insights/presentation.mjs'
// @ts-ignore TS7016: no declarations for the local .mjs module
import { defaultPricing, mergePricing, readStoredOverride } from '../insights/pricing.mjs'
// @ts-ignore TS7016: no declarations for the local .mjs module
import { detectLocale } from '../insights/i18n.mjs'
import css from './Insights.module.css'
import tokensCss from './ui/tokens.module.css'

/** Shared formatting, storage and chart plumbing for both Insights surfaces. */

export type Limits = { silenceSeconds: number; reasoningSeconds: number }
export const STORAGE = 'dsh-watcher:insights-display:v1'

export function routeLabel(route?: { provider?: string; model?: string }): string {
  return `${route?.provider || '未标注提供方'}/${route?.model || '未标注模型'}`
}

export function modelKeyOf(m: any): string {
  return `${m?.provider ?? ''}/${m?.model ?? ''}/${m?.effort ?? ''}`
}

export function readLimits(): Limits {
  try {
    return limitsOf(JSON.parse(localStorage.getItem(STORAGE) ?? '{}'))
  } catch {
    return { ...DEFAULT_LIMITS }
  }
}

export function useLimits() {
  const [limits, setLimits] = useState(readLimits)
  useEffect(() => {
    const update = () => setLimits(readLimits())
    window.addEventListener('watcher-insights-settings', update)
    return () => window.removeEventListener('watcher-insights-settings', update)
  }, [])
  return limits
}

export function useUiLocale() {
  const [locale, setLocale] = useState(detectLocale)
  useEffect(() => { setLocale(detectLocale()) }, [])
  return locale
}

/** A broken override must degrade to defaults, never break the page render. */
function readPricingTable() {
  try {
    return mergePricing(defaultPricing(), readStoredOverride(globalThis.localStorage))
  } catch {
    return defaultPricing()
  }
}

export function usePricingTable() {
  const [table, setTable] = useState(readPricingTable)
  useEffect(() => {
    const update = () => setTable(readPricingTable())
    window.addEventListener('watcher-pricing-settings', update)
    return () => window.removeEventListener('watcher-pricing-settings', update)
  }, [])
  return table
}

export const numberFormat = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 })
export const fmt = (n: number) => numberFormat.format(n)

export const fmtCompact = (n: number) => {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n >= 1e8) return `${(n / 1e8).toFixed(1)} 亿`
  if (n >= 1e4) return `${(n / 1e4).toFixed(1)} 万`
  return fmt(n)
}

export const dayKey = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Local midnight of the day holding `ms`; the anchor for calendar-day ranges. */
export const dayStart = (ms: number) => {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * The calendar key `daysAgo` days back. Stepping with `setDate` keeps the local
 * calendar honest across DST shifts, where subtracting 24h would repeat or skip
 * a day and drop a column from every chart.
 */
export const dayKeyDaysAgo = (daysAgo: number, now = Date.now()) => {
  const d = new Date(dayStart(now))
  d.setDate(d.getDate() - daysAgo)
  return dayKey(d.getTime())
}

export const dayLabel = (key: string) => {
  const [, m, d] = key.split('-')
  return `${Number(m)}/${Number(d)}`
}

// Categorical hues live in the shared token layer so every chart, legend and
// tooltip dot reads the same model colour and both themes stay in sync.
export const PALETTE = [
  'var(--ui-chart-1)', 'var(--ui-chart-2)', 'var(--ui-chart-3)',
  'var(--ui-chart-4)', 'var(--ui-chart-5)', 'var(--ui-chart-6)',
]
export const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

export function computeStackedLineChart(
  daySeries: Array<{ key: string; label: string; total: number; weekday: string; sessions: number; segments: any[]; isToday?: boolean; isYesterday?: boolean }>,
  modelsList: Array<{ model: string; color: string; tokens: number; pct: number }>,
  width = 560,
  height = 160,
) {
  const padding = { top: 20, right: 20, bottom: 28, left: 45 }
  const plotW = Math.max(10, width - padding.left - padding.right)
  const plotH = Math.max(10, height - padding.top - padding.bottom)
  const bottomY = padding.top + plotH

  const maxVal = Math.max(1, ...daySeries.map(d => d.total))
  const yMax = Math.ceil(maxVal * 1.15)
  const yCoord = (val: number) => bottomY - (val / yMax) * plotH

  // 按图例顺序作为堆叠图层：基底为主要模型，逐层向上堆叠
  const effectiveModels = modelsList.length > 0
    ? modelsList
    : [{ model: '全部模型', color: 'var(--ui-chart-1)', tokens: maxVal, pct: 100 }]

  const stackLevels = daySeries.map((d, dayIdx) => {
    const x = padding.left + (dayIdx / Math.max(1, daySeries.length - 1)) * plotW
    let acc = 0
    const modelStacks = effectiveModels.map(m => {
      const seg = d.segments.find((s: any) => s.model === m.model)
      const tokens = seg ? seg.tokens : 0
      const bTokens = acc
      acc += tokens
      const tTokens = acc
      return {
        model: m.model,
        color: m.color,
        tokens,
        bottomY: yCoord(bTokens),
        topY: yCoord(tTokens),
      }
    })
    return {
      index: dayIdx,
      x,
      total: d.total,
      data: d,
      modelStacks,
    }
  })

  const buildSpline = (pts: Array<{ x: number; y: number }>) => {
    if (pts.length <= 1) return pts.length === 1 ? `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}` : ''
    let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)]
      const p1 = pts[i]
      const p2 = pts[i + 1]
      const p3 = pts[Math.min(pts.length - 1, i + 2)]
      const cp1x = p1.x + (p2.x - p0.x) / 6
      const cp1y = Math.min(bottomY, Math.max(padding.top, p1.y + (p2.y - p0.y) / 6))
      const cp2x = p2.x - (p3.x - p1.x) / 6
      const cp2y = Math.min(bottomY, Math.max(padding.top, p2.y - (p3.y - p1.y) / 6))
      d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`
    }
    return d
  }

  const buildSegmentSpline = (pts: Array<{ x: number; y: number }>) => {
    let d = ''
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)]
      const p1 = pts[i]
      const p2 = pts[i + 1]
      const p3 = pts[Math.min(pts.length - 1, i + 2)]
      const cp1x = p1.x + (p2.x - p0.x) / 6
      const cp1y = Math.min(bottomY, Math.max(padding.top, p1.y + (p2.y - p0.y) / 6))
      const cp2x = p2.x - (p3.x - p1.x) / 6
      const cp2y = Math.min(bottomY, Math.max(padding.top, p2.y - (p3.y - p1.y) / 6))
      d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`
    }
    return d
  }

  // 为每个模型生成独立堆叠面积层与边界折线
  const layers = effectiveModels.map((m, mIdx) => {
    const topPts = stackLevels.map(sl => ({ x: sl.x, y: sl.modelStacks[mIdx].topY }))
    const bottomPts = stackLevels.map(sl => ({ x: sl.x, y: sl.modelStacks[mIdx].bottomY }))

    const lineD = buildSpline(topPts)
    const revBottom = [...bottomPts].reverse()
    const bottomSeg = buildSegmentSpline(revBottom)
    const areaD = `${lineD} L ${revBottom[0].x.toFixed(1)} ${revBottom[0].y.toFixed(1)}${bottomSeg} Z`

    return {
      model: m.model,
      color: m.color,
      lineD,
      areaD,
      topPts,
    }
  })

  return { layers, stackLevels, yMax, bottomY, padding, plotW, plotH }
}

/**
 * Viewport-space anchor for a chart hover card: a live element plus the
 * relative point inside it the card should point at. The rectangle is re-read
 * on every placement, so the card keeps following its bar/cell while a nested
 * settings pane scrolls.
 */
export type ChartAnchor = {
  el: Element
  ratioX: number
  ratioY: number
  /** Preferred side of the anchor point; placement flips it when that side does not fit. */
  side: 'above' | 'below'
}

export const TOOLTIP_MARGIN = 8
export const TOOLTIP_GAP = 12

/**
 * Hover card for the charts. The panels clip their content, and a card centred
 * on a late bar is wider than the space left of the panel edge, so the card is
 * portalled to the document body and placed in viewport coordinates — the same
 * approach as the UI primitives' HoverCard. Placement is written straight to
 * the node: it runs before paint and again on scroll/resize, and it clamps to
 * the viewport so no side of the card is ever cut off.
 */
export function ChartTooltip({ anchor, children }: { anchor: ChartAnchor | null; children: ReactNode }) {
  const cardRef = useRef<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    const card = cardRef.current
    if (card === null || anchor === null) return
    const place = () => {
      const rect = anchor.el.getBoundingClientRect()
      const width = card.offsetWidth
      const height = card.offsetHeight
      const viewportWidth = document.documentElement.clientWidth
      const viewportHeight = document.documentElement.clientHeight
      const pointX = rect.left + rect.width * anchor.ratioX
      const pointY = rect.top + rect.height * anchor.ratioY
      const left = Math.min(
        Math.max(pointX - width / 2, TOOLTIP_MARGIN),
        Math.max(TOOLTIP_MARGIN, viewportWidth - width - TOOLTIP_MARGIN),
      )
      const above = pointY - height - TOOLTIP_GAP
      const below = pointY + TOOLTIP_GAP
      const fitsAbove = above >= TOOLTIP_MARGIN
      const fitsBelow = below + height <= viewportHeight - TOOLTIP_MARGIN
      const preferred = anchor.side === 'above' ? above : below
      const flipped = anchor.side === 'above' ? below : above
      const chosen = anchor.side === 'above'
        ? (fitsAbove ? preferred : flipped)
        : (fitsBelow ? preferred : flipped)
      const top = Math.min(
        Math.max(chosen, TOOLTIP_MARGIN),
        Math.max(TOOLTIP_MARGIN, viewportHeight - height - TOOLTIP_MARGIN),
      )
      card.style.left = `${Math.round(left)}px`
      card.style.top = `${Math.round(top)}px`
      card.style.visibility = 'visible'
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [anchor])
  if (anchor === null) return null
  return createPortal(
    <div ref={cardRef} className={`${tokensCss.tokens} ${css.chartTooltipBox} ${css.chartTooltipPortal}`}>
      {children}
    </div>,
    document.body,
  )
}

export function effortLabel(effort: string | null | undefined): string {
  if (!effort) return ''
  const map: Record<string, string> = { high: '高', medium: '中', low: '低' }
  return map[effort.toLowerCase()] ?? effort
}
