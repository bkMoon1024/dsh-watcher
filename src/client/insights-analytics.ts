// @ts-ignore TS7016: no declarations for the local .mjs module
import { estimateUsageRows } from '../insights/pricing.mjs'
import { PALETTE, WEEKDAYS, dayKey, dayKeyDaysAgo, dayLabel, dayStart, routeLabel } from './insights-shared.tsx'

export type SessionsScan = { total: number; selected: number; rows: any[] }
export type AnalyticsRange = '7' | '30' | '180'
export type SessionSort = 'tokens' | 'time' | 'errors'

/**
 * Everything the settings dashboard plots, derived in one pass over a scan.
 * Pure: the caller owns scanning, storage and hover state.
 */
export function analyticsOf(
  sessions: SessionsScan | null,
  range: AnalyticsRange,
  sessionSort: SessionSort,
  pricing: any,
) {
  if (!sessions) return null
  const days = Number(range)
  // The ledger totals and the plotted columns must cover the same calendar
  // window; a rolling `days * 24h` cutoff counts part of a day the chart cannot
  // draw yet.
  const rangeStart = new Date(dayStart(Date.now()))
  rangeStart.setDate(rangeStart.getDate() - (days - 1))
  const cutoff = rangeStart.getTime()
  const validRows = sessions.rows.filter((r: any) => r.value && (!r.updatedAt || r.updatedAt >= cutoff))
  const validViews = validRows.map((r: any) => r.value)
  let totalTokens = 0
  let totalModelMs = 0
  let totalToolMs = 0
  let totalBashMs = 0
  let totalTools = 0
  let totalCacheRead = 0
  let totalCacheWrite = 0
  let totalInput = 0
  let totalOutput = 0
  let totalErrors = 0
  let totalRetries = 0

  validViews.forEach((v: any) => {
    totalTokens += v.totals.tokens ?? 0
    totalModelMs += v.totals.modelMs ?? 0
    totalToolMs += v.totals.toolMs ?? 0
    totalBashMs += v.totals.bashMs ?? 0
    totalTools += v.totals.tools ?? 0
    totalCacheRead += v.totals.cacheRead ?? 0
    totalCacheWrite += v.totals.cacheWrite ?? 0
    totalInput += v.totals.input ?? 0
    totalOutput += v.totals.output ?? 0
    totalErrors += v.totals.toolErrors ?? 0
    totalRetries += v.totals.retries ?? 0
  })

  const totalWallMs = totalModelMs + totalToolMs
  const toolTimePct = totalWallMs > 0 ? Math.round((totalToolMs / totalWallMs) * 100) : 0
  const totalFileMs = Math.max(0, totalToolMs - totalBashMs)
  const bashPct = totalToolMs > 0 ? Math.round((totalBashMs / totalToolMs) * 100) : 0
  const filePct = Math.max(0, 100 - bashPct)
  const totalInAll = totalInput + totalCacheRead
  const cacheHitPct = totalInAll > 0 ? Math.round((totalCacheRead / totalInAll) * 100) : 0

  // 按 provider/model 汇总，避免不同提供方的同名模型混在一起。
  const modelMap = new Map<string, any>()
  for (const view of validViews) {
    for (const m of view.models ?? []) {
      const name = routeLabel(m)
      let row = modelMap.get(name)
      if (!row) {
        row = { model: name, provider: m.provider, pricingModel: m.model, calls: 0, tokens: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, modelMs: 0, firstMs: 0, firstSamples: 0 }
        modelMap.set(name, row)
      }
      for (const k of ['calls', 'tokens', 'input', 'output', 'cacheRead', 'cacheWrite', 'reasoning', 'modelMs', 'firstMs', 'firstSamples']) {
        if (typeof m[k] === 'number' && Number.isFinite(m[k])) {
          row[k] += m[k]
        }
      }
    }
  }
  const uniqueModels = [...modelMap.values()]

  // 1. 首响应延迟由短到长（升序：最快在上，TTFT 速度排行榜）
  const speedList = uniqueModels
    .filter((m: any) => (m.firstSamples ?? 0) > 0 && (m.firstMs ?? 0) > 0)
    .sort((a: any, b: any) => (a.firstMs / a.firstSamples) - (b.firstMs / b.firstSamples))

  // 2. 首响应排队由长到短（降序：最慢在上，延迟瓶颈排行榜）
  const latencyList = uniqueModels
    .filter((m: any) => (m.firstSamples ?? 0) > 0 && (m.firstMs ?? 0) > 0)
    .sort((a: any, b: any) => (b.firstMs / b.firstSamples) - (a.firstMs / a.firstSamples))

  // 3. 深度推导按思考 Token 占比降序（从高到低）
  const thinkList = uniqueModels
    .filter((m: any) => (m.reasoning ?? 0) > 0)
    .sort((a: any, b: any) => {
      const ratioA = a.reasoning / (((a.reasoning ?? 0) + (a.output ?? 0)) || 1)
      const ratioB = b.reasoning / (((b.reasoning ?? 0) + (b.output ?? 0)) || 1)
      return ratioB - ratioA || b.reasoning - a.reasoning
    })

  // 4. 前缀缓存按命中率降序（从高到低）
  const cacheList = uniqueModels
    .filter((m: any) => (m.tokens ?? 0) > 0)
    .sort((a: any, b: any) => {
      const rateA = (a.cacheRead ?? 0) / (((a.input ?? 0) + (a.cacheRead ?? 0)) || 1)
      const rateB = (b.cacheRead ?? 0) / (((b.input ?? 0) + (b.cacheRead ?? 0)) || 1)
      return rateB - rateA || (b.cacheRead ?? 0) - (a.cacheRead ?? 0)
    })

  // 头部 6 大 KPI 卡片数据：精准绑定对应排行榜的第一名！
  const fastKing = speedList[0]
  const slowKing = latencyList[0]
  const thinkKing = thinkList[0]
  const bestCacheModel = cacheList[0]

  // 工具高耗时排查会话 TOP 3 (严格按工具总耗时降序)
  const topToolSessions = [...validRows]
    .filter((r: any) => (r.value?.totals?.toolMs ?? 0) > 0)
    .sort((a: any, b: any) => (b.value.totals.toolMs ?? 0) - (a.value.totals.toolMs ?? 0))
    .slice(0, 3)

  // 报错与重试排查会话 (严格按报错量降序)
  const errorSessions = [...validRows]
    .filter((r: any) => (r.value?.totals?.toolErrors ?? 0) > 0 || (r.value?.totals?.retries ?? 0) > 0)
    .sort((a: any, b: any) => {
      const scoreA = (a.value.totals.toolErrors ?? 0) * 100 + (a.value.totals.retries ?? 0)
      const scoreB = (b.value.totals.toolErrors ?? 0) * 100 + (b.value.totals.retries ?? 0)
      return scoreB - scoreA
    })
    .slice(0, 6)

  // 重点对话账单：严格按用户指定的维度降序排序！
  const sortedSessions = [...validRows].sort((a: any, b: any) => {
    const va = a.value.totals
    const vb = b.value.totals
    if (sessionSort === 'tokens') {
      return (vb.tokens ?? 0) - (va.tokens ?? 0)
    }
    if (sessionSort === 'time') {
      const timeA = (va.modelMs ?? 0) + (va.toolMs ?? 0)
      const timeB = (vb.modelMs ?? 0) + (vb.toolMs ?? 0)
      return timeB - timeA
    }
    if (sessionSort === 'errors') {
      const scoreA = (va.toolErrors ?? 0) * 100 + (va.retries ?? 0)
      const scoreB = (vb.toolErrors ?? 0) * 100 + (vb.retries ?? 0)
      return scoreB - scoreA || (vb.tokens ?? 0) - (va.tokens ?? 0)
    }
    return (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
  })
  const maxSessionTokens = Math.max(1, ...sortedSessions.map((s: any) => s.value?.totals?.tokens ?? 0))

  // 环形图数据：纯模型排序，前 4 名 + 其余汇总为 "其他"，并保证严格按 Token 降序排列！
  const tokenRankedModels = [...uniqueModels].sort((a, b) => b.tokens - a.tokens)
  const topModels = tokenRankedModels.slice(0, 4)
  const restModels = tokenRankedModels.slice(4)
  const restTokens = restModels.reduce((sum: number, m: any) => sum + (m.tokens ?? 0), 0)
  const donutModels = [...topModels]
  if (restTokens > 0) {
    donutModels.push({ model: '其他模型', tokens: restTokens })
  }
  donutModels.sort((a: any, b: any) => (b.tokens ?? 0) - (a.tokens ?? 0))

  const donutTotal = donutModels.reduce((sum: number, m: any) => sum + (m.tokens ?? 0), 0)

  const colorOf = (name: string) => {
    const found = donutModels.findIndex((m: any) => m.model === name)
    return PALETTE[(found >= 0 ? found : 0) % PALETTE.length]
  }

  // 环形切片计算：无缝精准闭环，最后一段精确吸附
  const circumference = 2 * Math.PI * 38 // 238.761...
  let accumulated = 0
  const donutSegments = donutTotal <= 0 ? [] : donutModels.map((m: any, idx: number) => {
    const pctRatio = m.tokens / donutTotal
    const strokeLength = idx === donutModels.length - 1
      ? Math.max(0, circumference - accumulated)
      : pctRatio * circumference
    const gapLength = Math.max(0, circumference - strokeLength)
    const offset = -accumulated
    accumulated += strokeLength
    return {
      model: m.model,
      tokens: m.tokens,
      pct: Math.round(pctRatio * 100),
      color: PALETTE[idx % PALETTE.length],
      dasharray: `${strokeLength} ${gapLength}`,
      dashoffset: offset,
    }
  })

  // 每日活动序列
  const keys: string[] = []
  for (let i = days - 1; i >= 0; i--) keys.push(dayKeyDaysAgo(i))
  const byDay = new Map(keys.map(k => [k, { models: new Map<string, number>(), sessions: 0 }]))
  validRows.forEach((row: any) => {
    // A session without updatedAt has no honest day bucket; counting it as
    // today would inflate the newest column.
    if (!row.updatedAt) return
    const key = dayKey(row.updatedAt)
    const bucket = byDay.get(key)
    if (!bucket) return
    bucket.sessions += 1
    const models = row.value.models?.length
      ? row.value.models
      : [{ model: '未标注', tokens: row.value.totals.tokens ?? 0 }]
    models.forEach((m: any) => {
      bucket.models.set(routeLabel(m), (bucket.models.get(routeLabel(m)) ?? 0) + (m.tokens ?? 0))
    })
  })

  const todayStr = dayKeyDaysAgo(0)
  const yesterdayStr = dayKeyDaysAgo(1)

  const daySeries = keys.map(key => {
    const bucket = byDay.get(key) ?? { models: new Map(), sessions: 0 }
    const segments = [...bucket.models.entries()]
      .map(([model, tokens]) => ({ model, tokens, color: colorOf(model) }))
      .sort((a, b) => b.tokens - a.tokens)
    const totalTokens = segments.reduce((s, x) => s + x.tokens, 0)
    const segsWithPct = segments.map(seg => ({
      ...seg,
      pct: totalTokens > 0 ? Math.round((seg.tokens / totalTokens) * 100) : 0,
    }))
    const dObj = new Date(key + 'T00:00:00')
    const weekdayStr = WEEKDAYS[dObj.getDay()]
    const isToday = key === todayStr
    const isYesterday = key === yesterdayStr
    const label = range === '7'
      ? (isToday ? '今天' : isYesterday ? '昨天' : weekdayStr)
      : (key.endsWith('01') || key.endsWith('05') || key.endsWith('10') || key.endsWith('15') || key.endsWith('20') || key.endsWith('25') ? dayLabel(key) : '')
    return {
      key,
      label,
      weekday: weekdayStr,
      isToday,
      isYesterday,
      total: totalTokens,
      sessions: bucket.sessions,
      segments: segsWithPct,
    }
  })
  const dayMax = Math.max(1, ...daySeries.map(d => d.total))

  // 活跃模型图例提取 (针对当前 range)
  const activeModelMap = new Map<string, number>()
  daySeries.forEach(d => {
    d.segments.forEach(s => {
      activeModelMap.set(s.model, (activeModelMap.get(s.model) ?? 0) + s.tokens)
    })
  })
  const activeRangeTotal = [...activeModelMap.values()].reduce((a, b) => a + b, 0)
  const activeRangeModels = [...activeModelMap.entries()]
    .map(([model, tokens]) => ({
      model,
      tokens,
      color: colorOf(model),
      pct: activeRangeTotal > 0 ? Math.round((tokens / activeRangeTotal) * 100) : 0,
    }))
    .sort((a, b) => b.tokens - a.tokens)

  // 近 6 个月（26 周，约 182 天）全景热力图数据生成 (如图 3)
  const todayDate = new Date()
  todayDate.setHours(23, 59, 59, 999)
  const todayDayOfWeek = (todayDate.getDay() + 6) % 7 // 周一为 0，周日为 6
  const currentWeekSunday = new Date(todayDate)
  currentWeekSunday.setDate(todayDate.getDate() + (6 - todayDayOfWeek))

  const numWeeks = 26
  const heatmapStart = new Date(currentWeekSunday)
  heatmapStart.setDate(currentWeekSunday.getDate() - (numWeeks * 7 - 1))
  heatmapStart.setHours(0, 0, 0, 0)

  const allHistoricalRows = sessions.rows.filter((r: any) => r.value && r.updatedAt && r.updatedAt >= heatmapStart.getTime())
  const heatmapDayMap = new Map<string, { tokens: number; sessions: number; models: Map<string, number> }>()
  allHistoricalRows.forEach((r: any) => {
    const k = dayKey(r.updatedAt)
    let dEntry = heatmapDayMap.get(k)
    if (!dEntry) {
      dEntry = { tokens: 0, sessions: 0, models: new Map() }
      heatmapDayMap.set(k, dEntry)
    }
    dEntry.tokens += r.value.totals?.tokens ?? 0
    dEntry.sessions += 1
    ;(r.value.models ?? []).forEach((m: any) => {
      dEntry!.models.set(routeLabel(m), (dEntry!.models.get(routeLabel(m)) ?? 0) + (m.tokens ?? 0))
    })
  })

  const nonZeroTokenDays = [...heatmapDayMap.values()].map(d => d.tokens).filter(t => t > 0).sort((a, b) => a - b)
  const q1 = nonZeroTokenDays[Math.floor(nonZeroTokenDays.length * 0.25)] || 1
  const q2 = nonZeroTokenDays[Math.floor(nonZeroTokenDays.length * 0.50)] || q1
  const q3 = nonZeroTokenDays[Math.floor(nonZeroTokenDays.length * 0.75)] || q2
  const maxHeatmapDayTokens = nonZeroTokenDays.length > 0 ? nonZeroTokenDays[nonZeroTokenDays.length - 1] : 0

  const getHeatmapLevel = (tokens: number): 0 | 1 | 2 | 3 | 4 => {
    if (!tokens || tokens <= 0) return 0
    if (tokens <= q1) return 1
    if (tokens <= q2) return 2
    if (tokens <= q3) return 3
    return 4
  }

  const heatmapWeeks: Array<{
    weekIndex: number
    days: Array<{
      date: string
      dayOfWeek: number
      weekday: string
      month: number
      isFuture: boolean
      isToday: boolean
      tokens: number
      sessions: number
      models: Array<{ model: string; tokens: number; color: string; pct: number }>
      level: 0 | 1 | 2 | 3 | 4
    }>
  }> = []

  const heatmapMonthLabels: Array<{ colIndex: number; label: string }> = []

  for (let w = 0; w < numWeeks; w++) {
    const daysInWeek = []
    let monthStartingInThisWeek: number | null = null

    for (let d = 0; d < 7; d++) {
      const cur = new Date(heatmapStart)
      cur.setDate(heatmapStart.getDate() + w * 7 + d)
      const dateStr = dayKey(cur.getTime())
      const month = cur.getMonth()
      const isFuture = cur.getTime() > todayDate.getTime()
      const isToday = dateStr === todayStr

      // 精准识别每月 1 号所在的周列，确保月份标签与日期格子 100% 像素级对齐
      if (cur.getDate() === 1) {
        monthStartingInThisWeek = month
      }

      const data = heatmapDayMap.get(dateStr)
      const tokens = data?.tokens ?? 0
      const sessionsCount = data?.sessions ?? 0
      const modelsList = data
        ? [...data.models.entries()]
            .map(([m, t]) => ({
              model: m,
              tokens: t,
              color: colorOf(m),
              pct: tokens > 0 ? Math.round((t / tokens) * 100) : 0,
            }))
            .sort((a, b) => b.tokens - a.tokens)
        : []

      daysInWeek.push({
        date: dateStr,
        dayOfWeek: d,
        weekday: WEEKDAYS[cur.getDay()],
        month,
        isFuture,
        isToday,
        tokens,
        sessions: sessionsCount,
        models: modelsList,
        level: isFuture ? (0 as const) : getHeatmapLevel(tokens),
      })
    }

    if (monthStartingInThisWeek !== null) {
      heatmapMonthLabels.push({ colIndex: w, label: `${monthStartingInThisWeek + 1}月` })
    }

    heatmapWeeks.push({ weekIndex: w, days: daysInWeek })
  }

  const totalHeatmapTokens = nonZeroTokenDays.reduce((acc, v) => acc + v, 0)
  const totalHeatmapSessions = allHistoricalRows.length

  const costRows = uniqueModels.length > 0
    ? uniqueModels.map(({ pricingModel, ...row }) => ({ ...row, model: pricingModel }))
    : [{ model: '未标注', tokens: totalTokens, input: totalInput, output: totalOutput, cacheRead: totalCacheRead, cacheWrite: totalCacheWrite }]
  const estimatedCost = estimateUsageRows(costRows, pricing)

  return {
    validCount: validRows.length,
    listed: sessions.total,
    scannedCount: sessions.selected,
    totalTokens,
    estimatedCost,
    totalTimeHours: ((totalModelMs + totalToolMs) / 3600000).toFixed(1),
    cacheHitPct,
    totalCacheRead,
    totalToolMs,
    totalBashMs,
    totalFileMs,
    bashPct,
    filePct,
    topToolSessions,
    errorSessions,
    sortedSessions,
    maxSessionTokens,
    totalTools,
    toolTimePct,
    totalErrors,
    totalRetries,
    speedList,
    latencyList,
    thinkList,
    cacheList,
    donutModels,
    donutTotal,
    donutSegments,
    thinkKing,
    fastKing,
    slowKing,
    bestCacheModel,
    daySeries,
    dayMax,
    activeRangeModels,
    heatmapWeeks,
    heatmapMonthLabels,
    heatmapStats: {
      activeDays: nonZeroTokenDays.length,
      totalHeatmapTokens,
      totalHeatmapSessions,
      maxHeatmapDayTokens,
    },
  }
}

export type InsightsAnalytics = NonNullable<ReturnType<typeof analyticsOf>>
