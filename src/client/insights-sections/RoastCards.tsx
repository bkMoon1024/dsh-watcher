import type { InsightsAnalytics } from '../insights-analytics.ts'
import css from '../Insights.module.css'
import { fmtCompact } from '../insights-shared.tsx'

type Drilldown = 'speed' | 'latency' | 'thinking' | 'cache' | 'tool' | 'reliability'

/** Six headline cards; each one opens the matching drill-down panel. */
export function RoastCards({ analytics, activeDrilldown, setActiveDrilldown }: {
  analytics: InsightsAnalytics | null
  activeDrilldown: Drilldown | null
  setActiveDrilldown: (next: Drilldown | null) => void
}) {
  return (
    <>
      {/* 六大极客风云与问题洞察榜单：两列规整自适应排版，右下角动作条绝对平齐 */}
      <div className={css.roastGrid}>
        {/* 卡片 1: 极致打字机 */}
        <button
          type="button"
          className={`${css.roastItem} ${activeDrilldown === 'speed' ? css.roastItemActive : ''}`}
          aria-expanded={activeDrilldown === 'speed'}
          data-tone="ok"
          onClick={() => setActiveDrilldown(activeDrilldown === 'speed' ? null : 'speed')}
        >
          <div className={css.roastHead}>
            <span className={css.roastTag}>极致打字机</span>
            <span className={css.roastCategoryBadge}>速度王者</span>
          </div>
          <div className={css.roastTitle} title={analytics?.fastKing?.model}>{analytics?.fastKing?.model ?? '暂无数据'}</div>
          <div className={css.roastVal}>
            {analytics?.fastKing?.firstSamples ? `首字均值 ${(analytics.fastKing.firstMs / analytics.fastKing.firstSamples / 1000).toFixed(2)} 秒` : '暂无数据'}
          </div>
          <div className={css.roastDesc} title="首字响应最迅速，轻量改错利器">首字响应最迅速，轻量改错利器</div>
          <div className={css.roastFooter}>
            <span className={css.roastFooterLeft}>首响应耗时</span>
            <span className={css.roastAction}>{activeDrilldown === 'speed' ? '收起明细' : '展开明细'}</span>
          </div>
        </button>

        {/* 卡片 2: 最慢树懒 */}
        <button
          type="button"
          className={`${css.roastItem} ${activeDrilldown === 'latency' ? css.roastItemActive : ''}`}
          aria-expanded={activeDrilldown === 'latency'}
          data-tone="warn"
          onClick={() => setActiveDrilldown(activeDrilldown === 'latency' ? null : 'latency')}
        >
          <div className={css.roastHead}>
            <span className={css.roastTag}>最慢树懒</span>
            <span className={css.roastCategoryBadge}>延迟瓶颈</span>
          </div>
          <div className={css.roastTitle} title={analytics?.slowKing?.model}>{analytics?.slowKing?.model ?? '暂无数据'}</div>
          <div className={css.roastVal}>
            {analytics?.slowKing?.firstSamples ? `首字均值 ${(analytics.slowKing.firstMs / analytics.slowKing.firstSamples / 1000).toFixed(2)} 秒` : '暂无数据'}
          </div>
          <div className={css.roastDesc} title="首字排队最久，等待开工的时间最长">首字排队最久，等待开工的时间最长</div>
          <div className={css.roastFooter}>
            <span className={css.roastFooterLeft}>排队瓶颈</span>
            <span className={css.roastAction}>{activeDrilldown === 'latency' ? '收起明细' : '展开明细'}</span>
          </div>
        </button>

        {/* 卡片 3: 深度沉思狂 */}
        <button
          type="button"
          className={`${css.roastItem} ${activeDrilldown === 'thinking' ? css.roastItemActive : ''}`}
          aria-expanded={activeDrilldown === 'thinking'}
          data-tone="think"
          onClick={() => setActiveDrilldown(activeDrilldown === 'thinking' ? null : 'thinking')}
        >
          <div className={css.roastHead}>
            <span className={css.roastTag}>深度沉思狂</span>
            <span className={css.roastCategoryBadge}>推理硬核</span>
          </div>
          <div className={css.roastTitle} title={analytics?.thinkKing?.model}>{analytics?.thinkKing?.model ?? '暂无思考记录'}</div>
          <div className={css.roastVal}>
            {analytics?.thinkKing ? `思考占比 ${Math.round(((analytics.thinkKing.reasoning ?? 0) / (((analytics.thinkKing.reasoning ?? 0) + (analytics.thinkKing.output ?? 0)) || 1)) * 100)}%` : '无推理记录'}
          </div>
          <div className={css.roastDesc} title="思考 Token 占自身输出比例最高">思考 Token 占自身输出比例最高</div>
          <div className={css.roastFooter}>
            <span className={css.roastFooterLeft}>推导占比</span>
            <span className={css.roastAction}>{activeDrilldown === 'thinking' ? '收起明细' : '展开明细'}</span>
          </div>
        </button>

        {/* 卡片 4: 省流小能手 / 缓存待提升 */}
        <button
          type="button"
          className={`${css.roastItem} ${activeDrilldown === 'cache' ? css.roastItemActive : ''}`}
          aria-expanded={activeDrilldown === 'cache'}
          data-tone={(analytics?.cacheHitPct ?? 0) >= 40 ? 'ok' : 'warn'}
          onClick={() => setActiveDrilldown(activeDrilldown === 'cache' ? null : 'cache')}
        >
          <div className={css.roastHead}>
            <span className={css.roastTag}>
              {(analytics?.cacheHitPct ?? 0) >= 40 ? '省流小能手' : '缓存待提升'}
            </span>
            <span className={css.roastCategoryBadge}>成本控制</span>
          </div>
          <div className={css.roastTitle} title={analytics?.bestCacheModel?.model}>
            {(analytics?.cacheHitPct ?? 0) >= 40 ? (analytics?.bestCacheModel?.model ?? '上下文复用') : '上下文重传较多'}
          </div>
          <div className={css.roastVal}>
            {analytics ? `命中 ${analytics.cacheHitPct}% (${fmtCompact(analytics.totalCacheRead)} Token)` : '-'}
          </div>
          <div className={css.roastDesc} title={(analytics?.cacheHitPct ?? 0) >= 40 ? '前缀缓存命中率高，大幅节约 Token' : '较多长文本全量重传，可利用前缀缓存'}>
            {(analytics?.cacheHitPct ?? 0) >= 40 ? '前缀缓存命中率高，大幅节约 Token' : '较多长文本全量重传，可利用前缀缓存'}
          </div>
          <div className={css.roastFooter}>
            <span className={css.roastFooterLeft}>缓存效率</span>
            <span className={css.roastAction}>{activeDrilldown === 'cache' ? '收起明细' : '展开明细'}</span>
          </div>
        </button>

        {/* 卡片 5: 终端耗时狂 / 秒级放行 */}
        <button
          type="button"
          className={`${css.roastItem} ${activeDrilldown === 'tool' ? css.roastItemActive : ''}`}
          aria-expanded={activeDrilldown === 'tool'}
          data-tone={(analytics?.toolTimePct ?? 0) >= 30 ? 'warn' : 'info'}
          onClick={() => setActiveDrilldown(activeDrilldown === 'tool' ? null : 'tool')}
        >
          <div className={css.roastHead}>
            <span className={css.roastTag}>
              {(analytics?.toolTimePct ?? 0) >= 30 ? '终端耗时狂' : '秒级放行'}
            </span>
            <span className={css.roastCategoryBadge}>工程归因</span>
          </div>
          <div className={css.roastTitle}>
            {(analytics?.toolTimePct ?? 0) >= 30 ? `本地命令占 ${analytics?.toolTimePct}% 耗时` : `本地损耗仅 ${analytics?.toolTimePct ?? 0}%`}
          </div>
          <div className={css.roastVal}>
            {analytics ? `工具耗时 ${Math.round(analytics.totalToolMs / 1000)} 秒 (${analytics.totalTools} 次)` : '-'}
          </div>
          <div className={css.roastDesc} title={(analytics?.toolTimePct ?? 0) >= 30 ? '很多时候不是模型卡，是本地脚本跑太久' : '本地工具极速执行，等待时间主要在云端'}>
            {(analytics?.toolTimePct ?? 0) >= 30 ? '很多时候不是模型卡，是本地脚本跑太久' : '本地工具极速执行，等待时间主要在云端'}
          </div>
          <div className={css.roastFooter}>
            <span className={css.roastFooterLeft}>本地耗时</span>
            <span className={css.roastAction}>{activeDrilldown === 'tool' ? '收起明细' : '展开明细'}</span>
          </div>
        </button>

        {/* 卡片 6: 运行可靠度 */}
        <button
          type="button"
          className={`${css.roastItem} ${activeDrilldown === 'reliability' ? css.roastItemActive : ''}`}
          aria-expanded={activeDrilldown === 'reliability'}
          data-tone={(analytics?.totalErrors ?? 0) > 0 ? 'err' : 'ok'}
          onClick={() => setActiveDrilldown(activeDrilldown === 'reliability' ? null : 'reliability')}
        >
          <div className={css.roastHead}>
            <span className={css.roastTag}>
              {(analytics?.totalErrors ?? 0) > 0 ? '翻车排查' : '运行可靠度'}
            </span>
            <span className={css.roastCategoryBadge}>稳定性</span>
          </div>
          <div className={css.roastTitle} title={(analytics?.totalErrors ?? 0) > 0 ? '存在工具报错' : '执行顺畅'}>
            {(analytics?.totalErrors ?? 0) > 0 ? `${analytics?.totalErrors} 次工具报错` : '100% 顺畅'}
          </div>
          <div className={css.roastVal}>
            {(analytics?.totalErrors ?? 0) > 0 ? `${analytics?.totalErrors} 次报错 · ${analytics?.totalRetries} 次重试` : '0 报错 · 0 重试'}
          </div>
          <div className={css.roastDesc} title={(analytics?.totalErrors ?? 0) > 0 ? '命令执行或参数错误，注意环境排查' : '未发生命令报错或异常，执行稳健'}>
            {(analytics?.totalErrors ?? 0) > 0 ? '命令执行或参数错误，注意环境排查' : '未发生命令报错或异常，执行稳健'}
          </div>
          <div className={css.roastFooter}>
            <span className={css.roastFooterLeft}>异常检测</span>
            <span className={css.roastAction}>{activeDrilldown === 'reliability' ? '收起明细' : '展开明细'}</span>
          </div>
        </button>
      </div>
    </>
  )
}
