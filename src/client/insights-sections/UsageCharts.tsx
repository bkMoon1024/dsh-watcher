import { useMemo, useState } from 'react'
import type { InsightsAnalytics, AnalyticsRange } from '../insights-analytics.ts'
import css from '../Insights.module.css'
import { SegmentedToggle } from '../ui/SegmentedToggle.tsx'
import { ChartTooltip, computeStackedLineChart, dayLabel, fmtCompact, type ChartAnchor } from '../insights-shared.tsx'

export type ChartViewMode = 'bar' | 'line'

/** Donut split plus the daily activity chart with its two hover readouts. */
export function UsageCharts({ analytics, range, viewMode, setCustomViewMode }: {
  analytics: InsightsAnalytics | null
  range: AnalyticsRange
  viewMode: ChartViewMode
  setCustomViewMode: (next: ChartViewMode | null) => void
}) {
  const [hoveredModel, setHoveredModel] = useState<string | null>(null)
  const [hoveredDayIdx, setHoveredDayIdx] = useState<number | null>(null)
  const [hoveredDayAnchor, setHoveredDayAnchor] = useState<ChartAnchor | null>(null)
  const [hoveredLineIdx, setHoveredLineIdx] = useState<number | null>(null)
  const [hoveredLineAnchor, setHoveredLineAnchor] = useState<ChartAnchor | null>(null)
  const activeSeg = hoveredModel !== null
    ? analytics?.donutSegments.find(seg => seg.model === hoveredModel) ?? null
    : null
  const topModel = analytics?.donutSegments[0]
  // The stacked spline is stable per analytics; hover moves must not rebuild it.
  const lineData = useMemo(
    () => (analytics && analytics.daySeries.length > 0
      ? computeStackedLineChart(analytics.daySeries, analytics.activeRangeModels, 560, 160)
      : null),
    [analytics],
  )
  const activeViewMode = viewMode
  return (
    <>
      <div className={css.vizSplitGrid}>
        {/* 模型支出份额 (环形图 100% 闭环无缺口，图例按 Token 严格降序) */}
        <div className={css.vizPanel}>
          <div className={css.vizHead}>
            <span className={css.vizTitle}>模型支出份额</span>
            <span className={css.vizSub}>按消耗 Token 降序排列</span>
          </div>
          <div className={css.donutWrap}>
            <div className={css.donutSvgBox}>
              <svg viewBox="0 0 100 100" className={css.donutSvg}>
                <circle cx="50" cy="50" r="38" fill="none" stroke="var(--ui-surface-raised)" strokeWidth="12" />
                <g transform="rotate(-90 50 50)">
                  {(analytics?.donutSegments.length ?? 0) === 1 ? (
                    <circle cx="50" cy="50" r="38" fill="none" stroke={analytics!.donutSegments[0].color} strokeWidth="12" />
                  ) : (
                    analytics?.donutSegments.map((seg) => (
                      <circle
                        key={seg.model}
                        cx="50"
                        cy="50"
                        r="38"
                        fill="none"
                        stroke={seg.color}
                        strokeWidth="12"
                        strokeDasharray={seg.dasharray}
                        strokeDashoffset={seg.dashoffset}
                      />
                    ))
                  )}
                </g>
              </svg>
              <div className={css.donutCenterText}>
                <div className={css.donutCenterNum}>
                  {activeSeg ? `${activeSeg.pct}%` : topModel ? `${topModel.pct}%` : `${analytics?.donutSegments.length ?? 0}款`}
                </div>
                <div className={css.donutCenterSub}>
                  {activeSeg ? '选中占比' : '主力占比'}
                </div>
              </div>
            </div>
            <div className={css.donutLegendList}>
              {analytics?.donutSegments.map((seg) => (
                <div
                  key={seg.model}
                  className={`${css.donutLegendRow} ${hoveredModel === seg.model ? css.donutLegendRowActive : ''}`}
                  onMouseEnter={() => setHoveredModel(seg.model)}
                  onMouseLeave={() => setHoveredModel(null)}
                >
                  <span className={css.dlLeft}>
                    <i className={css.dlDot} style={{ background: seg.color }} />
                    <span className={css.dlName} title={seg.model}>{seg.model}</span>
                  </span>
                  <span className={css.dlRight}>{fmtCompact(seg.tokens)} · {seg.pct}%</span>
                </div>
              ))}
            </div>
          </div>
          {/* 专属模型全名与份额透视条：彻底舒展超长模型名 */}
          {(activeSeg || topModel) ? (
            <div className={css.donutInspectBar}>
              <i className={css.dlDot} style={{ background: (activeSeg || topModel)?.color }} />
              <span className={css.donutInspectName} title={(activeSeg || topModel)?.model}>
                {(activeSeg || topModel)?.model}
              </span>
              <span className={css.donutInspectTag}>{activeSeg ? '当前高亮' : '全场主力'}</span>
              <span className={css.donutInspectVal}>
                {fmtCompact((activeSeg || topModel)?.tokens ?? 0)} Token ({ (activeSeg || topModel)?.pct }%)
              </span>
            </div>
          ) : null}
        </div>

        {/* 每日编码活跃度与走势 */}
        <div className={css.vizPanel}>
          <div className={css.vizHead}>
            <div className={css.vizHeadTitles}>
              <span className={css.vizTitle}>
                {range === '7' ? '近 7 日活动分布' : range === '30' ? '近 30 日走势' : '近 6 个月趋势'}
              </span>
              <span className={css.vizSub}>
                {activeViewMode === 'bar' ? '柱状堆叠图 · 分色对应模型' : '平滑折线图 · 活动趋势'}
              </span>
            </div>
            <SegmentedToggle
              label="图表类型切换"
              value={activeViewMode}
              onChange={setCustomViewMode}
              options={[
                { value: 'bar', label: '柱状图' },
                { value: 'line', label: '折线图' },
              ]}
            />
          </div>

          {/* 图例 (Legend)：展示当前区间内活跃模型及其颜色与消耗量 */}
          {analytics && analytics.activeRangeModels.length > 0 && (
            <div className={css.chartLegend} aria-label="图例">
              {analytics.activeRangeModels.map(m => (
                <div key={m.model} className={css.chartLegendItem} title={`${m.model}: ${fmtCompact(m.tokens)} Token (${m.pct}%)`}>
                  <i className={css.chartLegendDot} style={{ background: m.color }} />
                  <span className={css.chartLegendName}>{m.model}</span>
                  <span className={css.chartLegendVal}>{fmtCompact(m.tokens)} ({m.pct}%)</span>
                </div>
              ))}
            </div>
          )}

          {/* 模式 A：柱状图 (带图例、顶部数值、Hover 悬浮卡片) */}
          {activeViewMode === 'bar' ? (
            <div
              className={css.chartInteractiveWrap}
              onMouseLeave={() => { setHoveredDayIdx(null); setHoveredDayAnchor(null) }}
            >
              {/* 悬停浮层 Tooltip Popover：挂载到 body，避免被面板 overflow: hidden 裁剪 */}
              {hoveredDayIdx !== null && analytics?.daySeries[hoveredDayIdx] && (
                (() => {
                  const day = analytics.daySeries[hoveredDayIdx]
                  return (
                    <ChartTooltip anchor={hoveredDayAnchor}>
                      <div className={css.chartTooltipDate}>
                        <span>{day.key}</span>
                        <span className={css.chartTooltipDateBadge}>
                          {day.isToday ? '今天 · ' : day.isYesterday ? '昨天 · ' : ''}{day.weekday}
                        </span>
                      </div>
                      <div className={css.chartTooltipTotal}>
                        {fmtCompact(day.total)} <span className={css.chartTooltipUnit}>Token</span>
                        <span className={css.chartTooltipSessions}>· {day.sessions} 个会话</span>
                      </div>
                      {day.segments.length > 0 && <div className={css.chartTooltipDivider} />}
                      <div className={css.chartTooltipModelList}>
                        {day.segments.map(seg => (
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
                  )
                })()
              )}

              <div className={`${css.dayStack} ${range === '7' ? css.dayStackWeek : ''}`} aria-label="按日活跃柱图">
                {(analytics?.daySeries ?? []).map((day, idx) => (
                  <div
                    key={day.key}
                    className={css.dayCol}
                    onMouseEnter={(e) => {
                      setHoveredDayIdx(idx)
                      setHoveredDayAnchor({ el: e.currentTarget, ratioX: 0.5, ratioY: 0, side: 'below' })
                    }}
                  >
                    {/* 柱顶数值 */}
                    <div className={css.dayBarTopLabel}>
                      {day.total > 0 ? fmtCompact(day.total) : ''}
                    </div>
                    <div className={`${css.dayColFill} ${hoveredDayIdx === idx ? css.dayColFillActive : ''}`}>
                      {day.total > 0 ? (
                        day.segments.map(seg => (
                          <div key={seg.model} className={css.daySeg} style={{
                            height: `${(seg.tokens / analytics!.dayMax) * 100}%`,
                            background: seg.color,
                          }} />
                        ))
                      ) : (
                        <div className={css.dayEmptyDot} />
                      )}
                    </div>
                    <span className={`${css.dayLabel} ${day.isToday ? css.dayLabelToday : ''}`}>
                      {day.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            /* 模式 B：平滑堆叠折线图 (按模型分色多层堆叠、网格渐变、吸附光标与悬停卡片，如图 2) */
            <div
              className={css.chartInteractiveWrap}
              onMouseLeave={() => { setHoveredLineIdx(null); setHoveredLineAnchor(null) }}
            >
              {analytics && lineData && (
                (() => {
                  const hoveredPoint = hoveredLineIdx !== null && hoveredLineIdx < lineData.stackLevels.length
                    ? lineData.stackLevels[hoveredLineIdx]
                    : null

                  return (
                    <div className={css.lineChartWrap}>
                      {/* 悬停浮层 Tooltip Popover：挂载到 body，避免被面板 overflow: hidden 裁剪 */}
                      {hoveredPoint && (
                        <ChartTooltip anchor={hoveredLineAnchor}>
                          <div className={css.chartTooltipDate}>
                            <span>{hoveredPoint.data.key}</span>
                            <span className={css.chartTooltipDateBadge}>
                              {hoveredPoint.data.isToday ? '今天 · ' : hoveredPoint.data.isYesterday ? '昨天 · ' : ''}{hoveredPoint.data.weekday}
                            </span>
                          </div>
                          <div className={css.chartTooltipTotal}>
                            {fmtCompact(hoveredPoint.data.total)} <span className={css.chartTooltipUnit}>Token</span>
                            <span className={css.chartTooltipSessions}>· {hoveredPoint.data.sessions} 个会话</span>
                          </div>
                          {hoveredPoint.data.segments.length > 0 && <div className={css.chartTooltipDivider} />}
                          <div className={css.chartTooltipModelList}>
                            {hoveredPoint.data.segments.map((seg: any) => (
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

                      <svg
                        className={css.lineChartSvg}
                        viewBox="0 0 560 160"
                        preserveAspectRatio="none"
                        onMouseMove={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect()
                          const scaleX = 560 / rect.width
                          const svgX = (e.clientX - rect.left) * scaleX
                          let nearestIdx = 0
                          let minDiff = Infinity
                          lineData.stackLevels.forEach((sl, idx) => {
                            const diff = Math.abs(sl.x - svgX)
                            if (diff < minDiff) {
                              minDiff = diff
                              nearestIdx = idx
                            }
                          })
                          setHoveredLineIdx(nearestIdx)
                          const level = lineData.stackLevels[nearestIdx]
                          const stacks = level?.modelStacks ?? []
                          const topY = stacks[stacks.length - 1]?.topY ?? 60
                          setHoveredLineAnchor({
                            el: e.currentTarget,
                            ratioX: (level?.x ?? 0) / 560,
                            ratioY: topY / 160,
                            side: 'above',
                          })
                        }}
                      >
                        <defs>
                          {lineData.layers.map((layer, mIdx) => (
                            <linearGradient
                              key={`dshWatcherLayerGrad_${mIdx}`}
                              id={`dshWatcherLayerGrad_${mIdx}`}
                              x1="0"
                              y1="0"
                              x2="0"
                              y2="1"
                            >
                              <stop offset="0%" stopColor={layer.color} stopOpacity="0.55" />
                              <stop offset="100%" stopColor={layer.color} stopOpacity="0.18" />
                            </linearGradient>
                          ))}
                        </defs>

                        {/* 水平网格线与 Y 轴刻度 */}
                        <line
                          x1={lineData.padding.left}
                          y1={lineData.padding.top}
                          x2={560 - lineData.padding.right}
                          y2={lineData.padding.top}
                          className={css.lineGrid}
                        />
                        <text x={lineData.padding.left - 6} y={lineData.padding.top + 3} textAnchor="end" className={css.lineAxisText}>
                          {fmtCompact(lineData.yMax)}
                        </text>

                        <line
                          x1={lineData.padding.left}
                          y1={lineData.padding.top + lineData.plotH / 2}
                          x2={560 - lineData.padding.right}
                          y2={lineData.padding.top + lineData.plotH / 2}
                          className={css.lineGrid}
                        />
                        <text x={lineData.padding.left - 6} y={lineData.padding.top + lineData.plotH / 2 + 3} textAnchor="end" className={css.lineAxisText}>
                          {fmtCompact(Math.round(lineData.yMax / 2))}
                        </text>

                        <line
                          x1={lineData.padding.left}
                          y1={lineData.bottomY}
                          x2={560 - lineData.padding.right}
                          y2={lineData.bottomY}
                          stroke="var(--ui-line)"
                          strokeWidth="1"
                        />
                        <text x={lineData.padding.left - 6} y={lineData.bottomY + 3} textAnchor="end" className={css.lineAxisText}>
                          0
                        </text>

                        {/* X 轴日期刻度 */}
                        {lineData.stackLevels.map((sl, idx) => {
                          const isKeyDate = lineData.stackLevels.length <= 10
                            ? true
                            : idx === 0 || idx === lineData.stackLevels.length - 1 || idx % Math.max(1, Math.floor(lineData.stackLevels.length / 5)) === 0
                          if (!isKeyDate) return null
                          const text = sl.data.isToday ? '今天' : sl.data.label || dayLabel(sl.data.key)
                          return (
                            <text
                              key={sl.data.key}
                              x={sl.x}
                              y={lineData.bottomY + 16}
                              textAnchor="middle"
                              className={css.lineAxisText}
                              fill={sl.data.isToday ? 'var(--ui-accent)' : undefined}
                              fontWeight={sl.data.isToday ? '700' : undefined}
                            >
                              {text}
                            </text>
                          )
                        })}

                        {/* 各模型堆叠面积层 */}
                        {lineData.layers.map((layer, mIdx) => (
                          <path
                            key={`area_${layer.model}`}
                            d={layer.areaD}
                            fill={`url(#dshWatcherLayerGrad_${mIdx})`}
                          />
                        ))}

                        {/* 各模型堆叠边界折线 */}
                        {lineData.layers.map((layer) => (
                          <path
                            key={`line_${layer.model}`}
                            d={layer.lineD}
                            fill="none"
                            stroke={layer.color}
                            strokeWidth="2.2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        ))}

                        {/* 各模型数据节点圆点 */}
                        {lineData.stackLevels.map((sl) => {
                          return sl.modelStacks.map((ms: any) => {
                            if (ms.tokens <= 0) return null
                            return (
                              <circle
                                key={`dot_${ms.model}_${sl.index}`}
                                cx={sl.x}
                                cy={ms.topY}
                                r="2"
                                fill={ms.color}
                              />
                            )
                          })
                        })}

                        {/* 悬停光标与各层吸附高亮圆点 */}
                        {hoveredPoint && (
                          <g>
                            <line
                              x1={hoveredPoint.x}
                              y1={lineData.padding.top}
                              x2={hoveredPoint.x}
                              y2={lineData.bottomY}
                              className={css.lineCursor}
                            />
                            {hoveredPoint.modelStacks.map((ms: any) => {
                              if (ms.tokens <= 0) return null
                              return (
                                <g key={`hover_dot_${ms.model}`}>
                                  <circle
                                    cx={hoveredPoint.x}
                                    cy={ms.topY}
                                    r="6"
                                    fill={ms.color}
                                    fillOpacity="0.35"
                                  />
                                  <circle
                                    cx={hoveredPoint.x}
                                    cy={ms.topY}
                                    r="3.5"
                                    fill={ms.color}
                                    stroke="var(--ui-surface)"
                                    strokeWidth="1.5"
                                  />
                                </g>
                              )
                            })}
                          </g>
                        )}
                      </svg>
                    </div>
                  )
                })()
              )}
            </div>
          )}

          <div className={css.chartFoot}>
            {activeViewMode === 'bar'
              ? '每日柱高代表当天最后活动的对话 Token 汇总，分色对应上方模型图例。'
              : '折线展示编码活跃趋势，鼠标滑动可透视任意一天的 Token 消耗与调用明细。'}
          </div>
        </div>
      </div>
    </>
  )
}
