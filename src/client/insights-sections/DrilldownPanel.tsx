import type { InsightsAnalytics } from '../insights-analytics.ts'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import css from '../Insights.module.css'
import { fmtCompact, routeLabel } from '../insights-shared.tsx'

type Drilldown = 'speed' | 'latency' | 'thinking' | 'cache' | 'tool' | 'reliability'

/** Detail body behind the headline cards: one ranked list per dimension. */
export function DrilldownPanel({ analytics, activeDrilldown, setActiveDrilldown }: {
  analytics: InsightsAnalytics
  activeDrilldown: Drilldown
  setActiveDrilldown: (next: Drilldown | null) => void
}) {
  return (
    <>
      {/* KPI 卡片深度下钻透视面板：严格严谨排序，绝不出框 */}
      {activeDrilldown && analytics ? (
        <div className={css.drilldownPanel}>
          <div className={css.drilldownHead}>
            <div className={css.drilldownTitleGroup}>
              <span className={css.drilldownTitle}>
                {activeDrilldown === 'speed' && '模型首字响应延迟对比（TTFT）'}
                {activeDrilldown === 'latency' && '模型首字排队耗时排行'}
                {activeDrilldown === 'thinking' && '深度推导算力分配明细'}
                {activeDrilldown === 'cache' && '前缀缓存命中率排行'}
                {activeDrilldown === 'tool' && '本地工具与终端耗时拆解'}
                {activeDrilldown === 'reliability' && '运行可靠度与报错排查'}
              </span>
              <span className={css.drilldownSub}>
                {activeDrilldown === 'speed' && '按首响应延迟升序排列（最快在上，首字响应最迅速）'}
                {activeDrilldown === 'latency' && '按排队耗时降序排列（排队最久在上，定位卡顿瓶颈）'}
                {activeDrilldown === 'thinking' && '按思考 Token 占比降序排列（对比自我推导与正文算力比重）'}
                {activeDrilldown === 'cache' && '按前缀缓存命中率降序排列（直接决定上下文成本与省钱效率）'}
                {activeDrilldown === 'tool' && '本地工具耗时全景拆解（按单会话本地执行耗时由大到小降序排查）'}
                {activeDrilldown === 'reliability' && '按报错与重试次数降序排查（优先定位最高频故障会话）'}
              </span>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setActiveDrilldown(null)}>收起</Button>
          </div>

          {/* 1. 速度 / 延迟下钻：每个模型唯一，严格升序/降序 */}
          {activeDrilldown === 'speed' && (
            <div className={css.rankList}>
              {analytics.speedList.map((m: any, idx: number) => {
                const avgMs = m.firstMs / m.firstSamples
                const minMs = analytics.speedList[0].firstMs / analytics.speedList[0].firstSamples
                // 最快的模型得分为 100%，后续依次递减，条长完美单调递减
                const score = Math.max(10, Math.min(100, Math.round((minMs / avgMs) * 100)))
                const tone = avgMs < 1000 ? 'good' : avgMs < 3000 ? 'fair' : 'warn'
                return (
                  <div key={m.model} className={css.rankItem}>
                    <div className={css.rankItemTop}>
                      <div className={css.rankItemLeft}>
                        <span className={`${css.rankBadge} ${idx === 0 ? css.rankBadgeGold : ''}`}>#{idx + 1}</span>
                        <span className={css.rankName} title={m.model}>{m.model}</span>
                      </div>
                      <span className={css.rankValMain} data-tone={tone}>
                        {(avgMs / 1000).toFixed(2)} 秒
                      </span>
                    </div>
                    <div className={css.rankTrack}>
                      <div className={css.rankBar} data-tone={tone} style={{ width: `${score}%` }} />
                    </div>
                    <div className={css.rankSubText}>
                      <span>速度敏捷得分 <strong>{score}分</strong> (首字均值 {(avgMs / 1000).toFixed(2)}s)</span>
                      <span>累计采样 {m.firstSamples} 次</span>
                    </div>
                  </div>
                )
              })}
              {analytics.speedList.length === 0 ? (
                <div className={css.drilldownEmpty}>暂无模型首字响应延迟采样数据。</div>
              ) : null}
            </div>
          )}

          {activeDrilldown === 'latency' && (
            <div className={css.rankList}>
              {analytics.latencyList.map((m: any, idx: number) => {
                const avgMs = m.firstMs / m.firstSamples
                const maxMs = analytics.latencyList[0].firstMs / analytics.latencyList[0].firstSamples
                // 最慢的模型瓶颈权重 100%，后续依次递减，条长完美单调递减
                const bottleneckPct = Math.max(10, Math.min(100, Math.round((avgMs / maxMs) * 100)))
                const tone = avgMs > 5000 ? 'bad' : avgMs > 2000 ? 'warn' : 'fair'
                return (
                  <div key={m.model} className={css.rankItem}>
                    <div className={css.rankItemTop}>
                      <div className={css.rankItemLeft}>
                        <span className={`${css.rankBadge} ${idx === 0 ? css.rankBadgeGold : ''}`}>#{idx + 1}</span>
                        <span className={css.rankName} title={m.model}>{m.model}</span>
                      </div>
                      <span className={css.rankValMain} data-tone={tone}>
                        {(avgMs / 1000).toFixed(2)} 秒
                      </span>
                    </div>
                    <div className={css.rankTrack}>
                      <div className={css.rankBar} data-tone={tone} style={{ width: `${bottleneckPct}%` }} />
                    </div>
                    <div className={css.rankSubText}>
                      <span>排队延迟 <strong>{(avgMs / 1000).toFixed(2)}s</strong> (瓶颈权重 {bottleneckPct}%)</span>
                      <span>累计采样 {m.firstSamples} 次</span>
                    </div>
                  </div>
                )
              })}
              {analytics.latencyList.length === 0 ? (
                <div className={css.drilldownEmpty}>暂无模型排队延迟采样数据。</div>
              ) : null}
            </div>
          )}

          {/* 2. 深度思考推导下钻：严格按思考占比降序 */}
          {activeDrilldown === 'thinking' && (
            <div className={css.rankList}>
              {analytics.thinkList.map((m: any, idx: number) => {
                const totalTokens = (m.reasoning ?? 0) + (m.output ?? 0)
                const thinkPct = totalTokens > 0 ? Math.round((m.reasoning / totalTokens) * 100) : 0
                return (
                  <div key={m.model} className={css.rankItem}>
                    <div className={css.rankItemTop}>
                      <div className={css.rankItemLeft}>
                        <span className={`${css.rankBadge} ${idx === 0 ? css.rankBadgeGold : ''}`}>#{idx + 1}</span>
                        <span className={css.rankName} title={m.model}>{m.model}</span>
                      </div>
                      <span className={css.rankValMain} data-tone="think">
                        思考占比 {thinkPct}%
                      </span>
                    </div>
                    <div className={`${css.toolCompoundTrack} ${css.toolCompoundTrackCompact}`}>
                      <div className={css.barSegThink} style={{ width: `${thinkPct}%` }} title={`思考: ${thinkPct}%`} />
                      <div className={css.barSegBody} style={{ width: `${100 - thinkPct}%` }} title={`正文: ${100 - thinkPct}%`} />
                    </div>
                    <div className={css.rankSubText}>
                      <span>思考推导 <strong>{fmtCompact(m.reasoning)}</strong> Token ({thinkPct}%)</span>
                      <span>正文输出 <strong>{fmtCompact(m.output)}</strong> Token</span>
                    </div>
                  </div>
                )
              })}
              {analytics.thinkList.length === 0 ? (
                <div className={css.drilldownEmpty}>当前时间范围内未检测到调用带推导思考过程的模型。</div>
              ) : null}
            </div>
          )}

          {/* 3. 前缀缓存下钻：严格按命中率降序 */}
          {activeDrilldown === 'cache' && (
            <div className={css.rankList}>
              {analytics.cacheList.map((m: any, idx: number) => {
                const totalIn = (m.input ?? 0) + (m.cacheRead ?? 0)
                const hitPct = totalIn > 0 ? Math.round(((m.cacheRead ?? 0) / totalIn) * 100) : 0
                return (
                  <div key={m.model} className={css.rankItem}>
                    <div className={css.rankItemTop}>
                      <div className={css.rankItemLeft}>
                        <span className={`${css.rankBadge} ${idx === 0 ? css.rankBadgeGold : ''}`}>#{idx + 1}</span>
                        <span className={css.rankName} title={m.model}>{m.model}</span>
                      </div>
                      <span className={css.rankValMain} data-tone="good">
                        命中率 {hitPct}%
                      </span>
                    </div>
                    <div className={`${css.toolCompoundTrack} ${css.toolCompoundTrackCompact}`}>
                      <div className={css.barSegHit} style={{ width: `${hitPct}%` }} title={`缓存命中: ${hitPct}%`} />
                      <div className={css.barSegMiss} style={{ width: `${100 - hitPct}%` }} title={`未命中: ${100 - hitPct}%`} />
                    </div>
                    <div className={css.rankSubText}>
                      <span>命中复用 <strong>{fmtCompact(m.cacheRead ?? 0)}</strong> Token ({hitPct}%)</span>
                      <span>实付输入 <strong>{fmtCompact(m.input ?? 0)}</strong> Token</span>
                    </div>
                  </div>
                )
              })}
              {analytics.cacheList.length === 0 ? (
                <div className={css.drilldownEmpty}>暂无模型缓存使用记录。</div>
              ) : null}
            </div>
          )}

          {/* 4. 本地工具耗时下钻：排序严谨，严格降序 */}
          {activeDrilldown === 'tool' && (
            <div className={css.toolDrillSection}>
              {/* 顶部复合比例条 */}
              <div className={css.toolCompoundBox}>
                <div className={css.toolCompoundTrack}>
                  <div className={css.toolSliceBash} style={{ width: `${analytics.bashPct}%` }} />
                  <div className={css.toolSliceFile} style={{ width: `${analytics.filePct}%` }} />
                </div>
                <div className={css.toolCompoundLegend}>
                  <span><i className={`${css.dlDot} ${css.dlDotBash}`} /> 终端命令 (Bash): <strong>{Math.round(analytics.totalBashMs / 1000)}秒 ({analytics.bashPct}%)</strong></span>
                  <span><i className={`${css.dlDot} ${css.dlDotFile}`} /> 文件与通用读写: <strong>{Math.round(analytics.totalFileMs / 1000)}秒 ({analytics.filePct}%)</strong></span>
                </div>
              </div>

              {/* 两张典型场景拆解卡片 */}
              <div className={css.toolGridCards}>
                <div className={css.toolMiniCard}>
                  <div className={css.toolMiniTitle}>
                    <i className={`${css.dlDot} ${css.dlDotBash}`} />
                    <span>终端 Bash 命令 (测试/构建/脚本)</span>
                  </div>
                  <div className={css.toolMiniNum}>{Math.round(analytics.totalBashMs / 1000)} 秒</div>
                  <div className={css.toolMiniDesc}>
                    包含 npm run, cargo, git, Python 以及本地自动化测试脚本等高耗时运行环节。
                  </div>
                </div>

                <div className={css.toolMiniCard}>
                <div className={css.toolMiniTitle}>
                  <i className={`${css.dlDot} ${css.dlDotFile}`} />
                  <span>文件操作与其他工具 (读写/检索)</span>
                </div>
                  <div className={css.toolMiniNum}>{Math.round(analytics.totalFileMs / 1000)} 秒</div>
                  <div className={css.toolMiniDesc}>
                    包含 read, write, edit, glob, grep 等轻量快速文件读写。单次耗时通常在毫秒级。
                  </div>
                </div>
              </div>

              {/* 最耗时的对话工具执行排查 (严格按耗时降序) */}
              {analytics.topToolSessions && analytics.topToolSessions.length > 0 ? (
                <div className={css.toolTopList}>
                  <div className={css.toolTopListTitle}>单会话工具总耗时 TOP 3 (降序排查)</div>
                  {analytics.topToolSessions.slice(0, 3).map((s: any, idx: number) => {
                    const tMs = s.value?.totals?.toolMs ?? 0
                    const bMs = s.value?.totals?.bashMs ?? 0
                    const fMs = Math.max(0, tMs - bMs)
                    const bPct = tMs > 0 ? Math.round((bMs / tMs) * 100) : 0
                    return (
                      <div key={s.sessionId} className={css.rankItem}>
                        <div className={css.rankItemTop}>
                          <div className={css.rankItemLeft}>
                            <span className={`${css.rankBadge} ${idx === 0 ? css.rankBadgeGold : ''}`}>#{idx + 1}</span>
                            <span className={css.sessionIdTag}>{s.sessionId.slice(0, 14)}…</span>
                            <span className={css.rankName} title={s.value?.models?.[0] ? routeLabel(s.value.models[0]) : undefined}>{s.value?.models?.[0] ? routeLabel(s.value.models[0]) : '通用会话'}</span>
                          </div>
                          <span className={css.rankValMain}>
                            总计 {Math.round(tMs / 1000)} 秒
                          </span>
                        </div>
                        <div className={`${css.toolCompoundTrack} ${css.toolCompoundTrackCompact}`}>
                          <div className={css.barSegBash} style={{ width: `${bPct}%` }} title={`终端命令: ${Math.round(bMs/1000)}s`} />
                          <div className={css.barSegFile} style={{ width: `${100 - bPct}%` }} title={`文件读写: ${Math.round(fMs/1000)}s`} />
                        </div>
                        <div className={css.rankSubText}>
                          <span>终端 Bash <strong>{Math.round(bMs / 1000)}s</strong> ({bPct}%)</span>
                          <span>文件读写 <strong>{Math.round(fMs / 1000)}s</strong> ({100 - bPct}%)</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : null}
            </div>
          )}

          {/* 5. 运行可靠度与报错排查下钻：严格按报错次数降序 */}
          {activeDrilldown === 'reliability' && (
            <div className={css.errorDrillSection}>
              {analytics.totalErrors === 0 && analytics.totalRetries === 0 ? (
                <div className={css.errorAllGoodBox}>
                  ✓ 全部会话工具执行 100% 顺畅，未记录到任何非零退出码或重试异常！
                </div>
              ) : (
                <div className={css.errorSessionList}>
                  <div className={css.toolTopListTitle}>报错与重试排查列表 (按异常严重度降序)</div>
                  {analytics.errorSessions.map((s: any, idx: number) => (
                    <div key={s.sessionId} className={css.errorSessionRow}>
                      <span className={`${css.rankBadge} ${idx === 0 ? css.rankBadgeGold : ''}`}>#{idx + 1}</span>
                      <span className={css.sessionIdTag}>{s.sessionId.slice(0, 14)}…</span>
                      <span className={css.rankName}>{s.value?.models?.[0] ? routeLabel(s.value.models[0]) : '通用对话'}</span>
                      <span className={s.value?.totals?.toolErrors > 0 ? css.statusBad : css.statusOk}>
                        {s.value?.totals?.toolErrors > 0 ? `${s.value.totals.toolErrors} 次报错` : '0 报错'}
                      </span>
                      <span className={s.value?.totals?.retries > 0 ? css.statusWarn : css.statusOk}>
                        {s.value?.totals?.retries > 0 ? `${s.value.totals.retries} 次重试` : '0 重试'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ) : null}
    </>
  )
}
