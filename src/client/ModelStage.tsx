import { IconChevronRightOutlineRegular, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import { hasReasoningEvidence, modelStageMetrics, type ModelAttempt, type ModelStepTrace } from '../observation/model-trace.ts'
import { layerDisclosureOpen, type DisclosureState } from './disclosure-depth.ts'
import css from './Watcher.module.css'
import { MARKDOWN_LABELS } from './labels.ts'
import { formatDuration, safeMarkdown } from './display.ts'

function reasoningAttemptDuration(attempt: ModelAttempt, now: number): number | null {
  if (attempt.firstReasoningTime === null || attempt.lastReasoningTime === null) return null
  const end = attempt.kind === 'running' && attempt.firstOutputTime === null
    ? now
    : attempt.lastReasoningTime
  return Math.max(0, end - attempt.firstReasoningTime)
}

function reasoningAttemptState(attempt: ModelAttempt): string {
  if (attempt.kind === 'running') return '生成中'
  if (attempt.kind === 'retried') return '已重试'
  if (attempt.kind === 'interrupted') return '已中断'
  return '已完成'
}

type ModelStageSegment = {
  key: 'wait' | 'reasoning' | 'output' | 'unattributed'
  label: string
  durationMs: number | null
  unavailableLabel: string
}

export function ModelStage({
  trace,
  stepId,
  now,
  open,
  disclosure,
  onToggle,
  onToggleReasoning,
}: {
  trace: ModelStepTrace
  stepId: string
  now: number
  open: boolean
  disclosure: DisclosureState
  onToggle: () => void
  onToggleReasoning: (key: string) => void
}) {
  const metrics = modelStageMetrics(trace, now)
  const hasReasoning = hasReasoningEvidence(trace)
  const total = formatDuration(metrics.totalMs)
  const visibleReasoning = formatDuration(metrics.visibleReasoningMs)
  const reasoningAttempts = trace.attempts.filter(attempt => attempt.reasoningText.trim() !== '')
  const summary = [
    total === null ? '时间不完整' : `模型 ${total}`,
    hasReasoning
      ? visibleReasoning === null ? '可见推理已记录' : `可见推理 ${visibleReasoning}`
      : null,
    trace.reasoningTokens === null ? null : `${trace.reasoningTokens.toLocaleString('zh-CN')} 推理 token`,
    metrics.live ? '进行中' : null,
  ].filter((value): value is string => value !== null).join(' · ')
  const segments: ModelStageSegment[] = [
    {
      key: 'wait',
      label: '首响应等待',
      durationMs: metrics.firstResponseMs,
      unavailableLabel: '时间戳不可用',
    },
    {
      key: 'reasoning',
      label: '可见推理',
      durationMs: metrics.visibleReasoningMs,
      unavailableLabel: hasReasoning ? '分段耗时不可用' : '未记录',
    },
    {
      key: 'output',
      label: '输出 / 工具意图',
      durationMs: metrics.outputMs,
      unavailableLabel: '时间戳不可用',
    },
    ...metrics.unattributedMs !== null && metrics.unattributedMs > 0
      ? [{
          key: 'unattributed' as const,
          label: '重试 / 未归因',
          durationMs: metrics.unattributedMs,
          unavailableLabel: '不可用',
        }]
      : [],
  ]
  const measuredSegments = segments.filter((segment): segment is ModelStageSegment & { durationMs: number } => (
    segment.durationMs !== null && segment.durationMs > 0
  ))
  const bodyId = `watcher-model-stage-${stepId}`

  return (
    <section className={css.modelStage} data-live={metrics.live ? '' : undefined}>
      <button
        type="button"
        className={css.modelStageToggle}
        aria-expanded={open}
        aria-controls={bodyId}
        title="模型阶段只使用 DSH 会话中供应商公开写入的事件"
        onClick={onToggle}
      >
        <IconChevronRightOutlineRegular size={11} className={css.modelStageChevron} />
        <span className={css.modelStageGlyph} aria-hidden="true" />
        <span className={css.modelStageCopy}>
          <span className={css.modelStageTitle}>模型阶段</span>
          <span className={css.modelStageSummary}>{summary}</span>
        </span>
      </button>

      {open ? (
      <div id={bodyId} className={css.modelStageBody}>
        {measuredSegments.length === 0
          ? null
          : (
            <div className={css.modelStageBar} aria-label="模型阶段耗时比例">
              {measuredSegments.map(segment => (
                <span
                  key={segment.key}
                  data-segment={segment.key}
                  style={{ flexGrow: Math.max(segment.durationMs, 1) }}
                  title={`${segment.label} ${formatDuration(segment.durationMs) ?? ''}`}
                />
              ))}
            </div>
          )}

        <dl className={css.modelStageLedger}>
          {segments.map(segment => (
            <div key={segment.key} className={css.modelStageMetric}>
              <dt>
                <span className={css.modelStageSwatch} data-segment={segment.key} aria-hidden="true" />
                {segment.label}
              </dt>
              <dd>{formatDuration(segment.durationMs) ?? segment.unavailableLabel}</dd>
            </div>
          ))}
        </dl>

        {reasoningAttempts.length === 0
          ? <p className={css.modelStageNote}>本 Step 没有供应商可见推理记录</p>
          : (
            <div className={css.reasoningAttempts}>
              <p className={css.modelStageNote}>仅展示供应商写入 DSH 会话的可见 reasoning；不补写未记录内容。</p>
              {reasoningAttempts.map(attempt => {
                const key = `${stepId}:attempt:${attempt.attempt}`
                const reasoningOpen = layerDisclosureOpen(disclosure, 'reasoning', key)
                const duration = formatDuration(reasoningAttemptDuration(attempt, now))
                const meta = [
                  reasoningAttemptState(attempt),
                  duration ?? '分段耗时不可用',
                  `${attempt.fragments.length} 个流片段`,
                  attempt.kind === 'retried' ? `等待重试 ${formatDuration(attempt.retryDelayMs) ?? '—'}` : null,
                ].filter((value): value is string => value !== null).join(' · ')
                return (
                  <section key={key} className={css.reasoningDisclosure} data-open={reasoningOpen ? '' : undefined}>
                    <button
                      type="button"
                      className={css.reasoningToggle}
                      aria-expanded={reasoningOpen}
                      aria-controls={`watcher-reasoning-${key}`}
                      onClick={() => onToggleReasoning(key)}
                    >
                      <IconChevronRightOutlineRegular size={11} className={css.reasoningChevron} />
                      <span className={css.reasoningLabel}>
                        {reasoningAttempts.length === 1 ? '推理记录' : `尝试 ${attempt.attempt}`}
                      </span>
                      <span className={css.reasoningMeta}>{meta}</span>
                    </button>
                    {reasoningOpen ? (
                      <article
                      id={`watcher-reasoning-${key}`}
                      className={css.reasoningBody}
                      >
                      <MarkdownText text={safeMarkdown(attempt.reasoningText)} labels={MARKDOWN_LABELS} />
                      </article>
                    ) : null}
                  </section>
                )
              })}
            </div>
          )}
      </div>
      ) : null}
    </section>
  )
}
