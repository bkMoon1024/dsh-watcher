import { useState } from 'react'
import type { InsightsAnalytics } from '../insights-analytics.ts'
import css from '../Insights.module.css'
import { ChartTooltip, fmtCompact, type ChartAnchor } from '../insights-shared.tsx'

/** Six-month activity matrix; the hovered day mirrors into the header readout. */
export function ActivityHeatmap({ analytics }: { analytics: InsightsAnalytics }) {
  const [hoveredHeatmapDay, setHoveredHeatmapDay] = useState<any | null>(null)
  const [hoveredHeatmapAnchor, setHoveredHeatmapAnchor] = useState<ChartAnchor | null>(null)
  return (
    <>
      {/* 5. 近 6 个月调用热力图 (GitHub 贡献矩阵风格 Calendar Heatmap，如图 3) */}
      {analytics && (
        <div className={css.heatmapPanel} onMouseLeave={() => setHoveredHeatmapDay(null)}>
          <div className={css.heatmapHead}>
            <div className={css.heatmapTitleGroup}>
              <span className={css.heatmapTitle}>近 6 个月调用热力图</span>
              <span className={css.heatmapSub}>26 周活动矩阵 · 真实反映长期 AI 编码活跃节奏与频次</span>
            </div>
            {hoveredHeatmapDay ? (
              <div className={css.heatmapLiveHud}>
                <span className={css.heatmapLiveDate}>
                  {hoveredHeatmapDay.date} {hoveredHeatmapDay.isToday ? '(今天)' : ''} · {hoveredHeatmapDay.weekday}
                </span>
                <span className={css.heatmapLiveTokens}>
                  {hoveredHeatmapDay.tokens > 0 ? `${fmtCompact(hoveredHeatmapDay.tokens)} Token · ${hoveredHeatmapDay.sessions} 个会话` : '无调用活动'}
                </span>
                {hoveredHeatmapDay.models[0] && (
                  <span className={css.heatmapLiveModel}>
                    主力: {hoveredHeatmapDay.models[0].model} ({hoveredHeatmapDay.models[0].pct}%)
                  </span>
                )}
              </div>
            ) : (
              <div className={css.heatmapStatsRow}>
                <span>活跃天数 <strong>{analytics.heatmapStats.activeDays} 天</strong></span>
                <span>调用会话 <strong>{analytics.heatmapStats.totalHeatmapSessions} 次</strong></span>
                <span>累计消耗 <strong>{fmtCompact(analytics.heatmapStats.totalHeatmapTokens)} Token</strong></span>
                <span>峰值单日 <strong>{fmtCompact(analytics.heatmapStats.maxHeatmapDayTokens)} Token</strong></span>
              </div>
            )}
          </div>

          <div
            className={css.chartInteractiveWrap}
            onMouseLeave={() => { setHoveredHeatmapDay(null); setHoveredHeatmapAnchor(null) }}
          >
            {/* 热力图悬停浮层 Tooltip Popover：挂载到 body，上下自动翻转，永不裁剪 */}
            {hoveredHeatmapDay && (
              <ChartTooltip anchor={hoveredHeatmapAnchor}>
                <div className={css.chartTooltipDate}>
                  <span>{hoveredHeatmapDay.date}</span>
                  <span className={css.chartTooltipDateBadge}>
                    {hoveredHeatmapDay.isToday ? '今天 · ' : ''}{hoveredHeatmapDay.weekday}
                  </span>
                </div>
                <div className={css.chartTooltipTotal}>
                  {hoveredHeatmapDay.tokens > 0 ? (
                    <>
                      {fmtCompact(hoveredHeatmapDay.tokens)} <span style={{ fontSize: '11px', fontWeight: 500 }}>Token</span>
                      <span className={css.chartTooltipSessions}>· {hoveredHeatmapDay.sessions} 个会话</span>
                    </>
                  ) : (
                    <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--dsw-alias-label-tertiary)' }}>当日未产生模型调用</span>
                  )}
                </div>
                {hoveredHeatmapDay.models.length > 0 && <div className={css.chartTooltipDivider} />}
                <div className={css.chartTooltipModelList}>
                  {hoveredHeatmapDay.models.map((seg: any) => (
                    <div key={seg.model} className={css.chartTooltipModelRow}>
                      <div className={css.chartTooltipModelLeft}>
                        <i className={css.chartTooltipModelDot} style={{ background: seg.color }} />
                        <span className={css.chartTooltipModelName} title={seg.model}>{seg.model}</span>
                      </div>
                      <span className={css.chartTooltipModelRight}>
                        {fmtCompact(seg.tokens)} ({seg.pct}%)
                      </span>
                    </div>
                  ))}
                </div>
              </ChartTooltip>
            )}

            <div className={css.heatmapScrollArea}>
              <div className={css.heatmapContainer}>
                {/* 顶部月份标注：与下方周列在像素上 1:1 绝对对齐 */}
                <div className={css.heatmapMonthsRow}>
                  {analytics.heatmapMonthLabels.map(m => (
                    <span
                      key={`${m.colIndex}-${m.label}`}
                      className={css.heatmapMonthLabel}
                      style={{ left: `${m.colIndex * 16}px` }}
                    >
                      {m.label}
                    </span>
                  ))}
                </div>

                {/* 矩阵主体：左侧星期标签 + 26 列方块 */}
                <div className={css.heatmapGrid}>
                  <div className={css.heatmapWeekdaysCol}>
                    <span>周一</span>
                    <span>周三</span>
                    <span>周五</span>
                    <span>周日</span>
                  </div>

                  <div className={css.heatmapWeeksRow}>
                    {analytics.heatmapWeeks.map(w => (
                      <div key={w.weekIndex} className={css.heatmapWeekCol}>
                        {w.days.map(d => (
                          <div
                            key={d.date}
                            className={`${css.heatmapCell} ${d.isToday ? css.heatmapCellToday : ''} ${hoveredHeatmapDay?.date === d.date ? css.heatmapCellActive : ''}`}
                            data-level={d.level}
                            data-future={d.isFuture ? 'true' : undefined}
                            onMouseEnter={(e) => {
                              if (!d.isFuture) {
                                setHoveredHeatmapDay(d)
                                setHoveredHeatmapAnchor({
                                  el: e.currentTarget,
                                  ratioX: 0.5,
                                  ratioY: 0.5,
                                  side: d.dayOfWeek <= 3 ? 'below' : 'above',
                                })
                              }
                            }}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className={css.heatmapFoot}>
            <span>只读汇总本地已缓存对话。方块深浅代表当天 Token 消耗强度（自适应四分位数分阶）。</span>
            <div className={css.heatmapLegend}>
              <span>少</span>
              <div className={css.heatmapLegendCell} data-level="0" />
              <div className={css.heatmapLegendCell} data-level="1" />
              <div className={css.heatmapLegendCell} data-level="2" />
              <div className={css.heatmapLegendCell} data-level="3" />
              <div className={css.heatmapLegendCell} data-level="4" />
              <span>多</span>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
