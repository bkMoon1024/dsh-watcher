import { useState } from 'react'
import type { InsightsAnalytics, SessionSort, SessionsScan } from '../insights-analytics.ts'
import css from '../Insights.module.css'
import { SegmentedToggle } from '../ui/SegmentedToggle.tsx'
import { fmtCompact, routeLabel } from '../insights-shared.tsx'

/** Top conversations ranked by the selected dimension, expandable in place. */
export function SessionLedger({ analytics, sessions, sessionSort, setSessionSort }: {
  analytics: InsightsAnalytics | null
  sessions: SessionsScan | null
  sessionSort: SessionSort
  setSessionSort: (next: SessionSort) => void
}) {
  const [openSessionId, setOpenSessionId] = useState<string | null>(null)
  return (
    <>
      {/* 重点对话账单：严格按选定维度降序排序！ */}
      <div className={css.vizPanel}>
        <div className={css.vizHead}>
          <div className={css.tableTitleGroup}>
            <span className={css.vizTitle}>重点对话账单</span>
            <span className={css.vizSub}>
              {sessionSort === 'tokens' && '按 Token 消耗由高到低严格排序'}
              {sessionSort === 'time' && '按执行总耗时由长到短严格排序'}
              {sessionSort === 'errors' && '按报错与重试次数降序排查'}
            </span>
          </div>
          <SegmentedToggle
            label="对话账单排序切换"
            value={sessionSort}
            onChange={setSessionSort}
            options={[
              { value: 'tokens', label: 'Token 消耗 ↓' },
              { value: 'time', label: '总耗时 ↓' },
              { value: 'errors', label: '故障数 ↓' },
            ]}
          />
        </div>

        {sessions && sessions.rows.length > 0 ? (
          <div className={css.sessionTableBox}>
            <div className={css.sessionTableHeader}>
              <span>排名 · 会话ID</span>
              <span>主用模型</span>
              <span className={css.cellEnd}>Token 消耗</span>
              <span className={css.cellEnd}>总耗时</span>
              <span className={css.cellCenter}>运行状态</span>
              <span />
            </div>
            {analytics?.sortedSessions.slice(0, 10).map((row: any, idx: number) => {
              const val = row.value
              const isOpen = openSessionId === row.sessionId
              const errCount = val.totals.toolErrors ?? 0
              const retryCount = val.totals.retries ?? 0
              const modelMs = val.totals.modelMs ?? 0
              const toolMs = val.totals.toolMs ?? 0
              const totalMs = modelMs + toolMs
              const modelPct = totalMs > 0 ? Math.round((modelMs / totalMs) * 100) : 50
              const status = errCount > 0
                ? `${errCount} 次报错`
                : retryCount > 0 ? `${retryCount} 次重试` : '顺畅'
              const tokenBarPct = Math.max(4, Math.round(((val.totals.tokens ?? 0) / analytics.maxSessionTokens) * 100))
              return (
                <div key={row.sessionId} className={`${css.sessionItemRow} ${isOpen ? css.sessionItemOpen : ''}`}>
                  <button
                    type="button"
                    className={css.sessionItemHead}
                    aria-expanded={isOpen}
                    onClick={() => setOpenSessionId(isOpen ? null : row.sessionId)}
                  >
                    <span className={css.sessionIdTag} title={row.sessionId}>
                      <strong className={css.tableRankNum}>#{idx + 1}</strong> {row.sessionId.length > 12 ? `${row.sessionId.slice(0, 6)}…${row.sessionId.slice(-3)}` : row.sessionId}
                    </span>
                    <span className={css.sessionModelCell} title={routeLabel(val.models?.[0])}>{routeLabel(val.models?.[0])}</span>
                    <div className={css.sessionTokenCell}>
                      <span>{fmtCompact(val.totals.tokens)}</span>
                      <div className={css.sessionTokenBar} style={{ width: `${tokenBarPct}%` }} />
                    </div>
                    <span className={css.cellEnd}>{Math.round(totalMs / 1000)} 秒</span>
                    <span className={`${css.cellCenter} ${errCount > 0 ? css.statusBad : retryCount > 0 ? css.statusWarn : css.statusOk}`}>{status}</span>
                    <span className={css.arrowIcon}>›</span>
                  </button>
                  {isOpen ? (
                    <div className={css.sessionItemDrawer}>
                      <div className={css.drawerTitle}>耗时构成下钻：模型响应 vs 本地工具</div>
                      <div className={css.drawerBarTrack}>
                        <div className={css.drawerSliceModel} style={{ width: `${modelPct}%` }} />
                        <div className={css.drawerSliceTool} style={{ width: `${100 - modelPct}%` }} />
                      </div>
                      <div className={css.drawerMetaRow}>
                        <span>模型 {Math.round(modelMs / 1000)} 秒 (首响应均值 {val.totals.firstSamples ? (val.totals.firstMs / val.totals.firstSamples / 1000).toFixed(1) : 0}s)</span>
                        <span>工具 {Math.round(toolMs / 1000)} 秒 · {val.totals.tools} 次执行</span>
                        <span>缓存命中率 {val.totals.input + val.totals.cacheRead > 0 ? Math.round((val.totals.cacheRead / (val.totals.input + val.totals.cacheRead)) * 100) : 0}%</span>
                      </div>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        ) : (
          <div className={css.emptyScan}>暂无已缓存的对话统计。</div>
        )}
      </div>
    </>
  )
}
