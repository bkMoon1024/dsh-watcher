import { useEffect, useRef, useState } from 'react'
import {
  DiffBlock,
  IconCheckOutlineRegular,
  IconChevronRightOutlineRegular,
  IconCopyOutlineRegular,
  JsonTree,
  MarkdownText,
  ReadBlock,
  TerminalBlock,
  writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkGroup, WorkItem, WorkPresentation } from '../observation/fold.ts'
import { groupElapsedMs, itemElapsedMs, stepElapsedMs } from '../observation/performance.ts'
import css from './Watcher.module.css'
import {
  DIFF_LABELS,
  JSON_LABELS,
  MARKDOWN_LABELS,
  READ_LABELS,
  STATUS_LABEL,
  TERMINAL_LABELS,
} from './labels.ts'
import { formatDuration, isJsonValue, itemPattern, rawOf } from './display.ts'
import { StatusMark } from './StatusMark.tsx'

/** Which payload view the docked inspector is showing. */
export type DetailTab = 'result' | 'input' | 'raw'

function CopyRawButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current)
  }, [])

  const copy = () => {
    void writeClipboard(text).then((ok) => {
      if (!ok) return
      setCopied(true)
      if (timerRef.current !== null) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <button type="button" className={css.copyRaw} onClick={copy} aria-label={copied ? '原始数据已复制' : '复制原始数据'}>
      {copied ? <IconCheckOutlineRegular size={14} /> : <IconCopyOutlineRegular size={14} />}
      {copied ? '已复制' : '复制'}
    </button>
  )
}

function ResultPresentation({ presentation }: { presentation: WorkPresentation }) {
  switch (presentation.kind) {
    case 'terminal':
      return (
        <TerminalBlock
          command={presentation.command}
          cwd={presentation.cwd ?? undefined}
          output={presentation.output}
          exitCode={presentation.exitCode ?? undefined}
          signal={presentation.signal ?? undefined}
          running={presentation.running}
          maxLines={18}
          labels={TERMINAL_LABELS}
        />
      )
    case 'read':
      return (
        <ReadBlock
          label={presentation.label}
          lang={presentation.lang ?? undefined}
          lines={presentation.lines}
          totalLines={presentation.totalLines}
          maxLines={18}
          labels={READ_LABELS}
        />
      )
    case 'diff':
      return <DiffBlock diffs={presentation.diffs} maxLines={18} labels={DIFF_LABELS} />
    case 'json':
      return <div className={css.jsonSurface}><JsonTree data={presentation.data} label="结构化结果" labels={JSON_LABELS} /></div>
    case 'text':
      return (
        <article className={css.documentResult} data-watcher-document="">
          <MarkdownText text={presentation.text} labels={MARKDOWN_LABELS} />
        </article>
      )
    case 'image':
      return (
        <div className={css.artifactResult}>
          <div className={css.artifactGlyph} aria-hidden="true">▧</div>
          <strong>图片附件</strong>
          <span>附件已保留在本次会话记录中</span>
          {isJsonValue(presentation.attachment)
            ? <div className={css.jsonSurface}><JsonTree data={presentation.attachment} label="图片附件信息" labels={JSON_LABELS} /></div>
            : null}
        </div>
      )
    case 'empty':
      return <div className={css.detailEmpty}>这次执行还没有可显示的结果</div>
  }
}

function preferredItem(group: WorkGroup): WorkItem | null {
  return group.items.find(item => item.status === 'failure' && item.recoveredBy === null)
    ?? group.items.find(item => item.status === 'waiting' || item.status === 'running')
    ?? group.items.at(-1)
    ?? null
}

function groupStatusLabel(group: WorkGroup): string {
  return group.status === 'failure' ? '含失败记录' : STATUS_LABEL[group.status]
}

export function ExecutionInspector({
  group,
  selectedItemId,
  live,
  now,
  closing,
  onSelectItem,
  onBack,
  onExited,
}: {
  group: WorkGroup
  selectedItemId: string | null
  live: boolean
  now: number
  closing: boolean
  onSelectItem: (id: string) => void
  onBack: () => void
  onExited: () => void
}) {
  const [tab, setTab] = useState<DetailTab>('result')
  const fallback = preferredItem(group)
  const selected = group.items.find(item => item.id === selectedItemId) ?? fallback

  useEffect(() => setTab('result'), [group.id, selected?.id])

  if (selected === null) return null
  const duration = formatDuration(itemElapsedMs(selected, live && selected.status === 'running', now))
  const groupDuration = formatDuration(groupElapsedMs(group, live, now))
  const raw = tab === 'raw' ? rawOf(selected) : ''
  const hasInput = Object.keys(selected.args).length > 0
  const pattern = itemPattern(selected)

  return (
    <aside
      className={css.inspector}
      aria-label={`${group.title} 的执行详情`}
      data-ud-check="watcher-inspector"
      data-ud-role="panel"
      data-closing={closing ? '' : undefined}
      onAnimationEnd={closing
        ? event => {
          // Nested result animations bubble their own events; only the collapse
          // on this element finishes the exit.
          if (event.target === event.currentTarget) onExited()
        }
        : undefined}
    >
      <header className={css.inspectorHeader}>
        <button
          type="button"
          className={css.inspectorBack}
          onClick={onBack}
          aria-label="返回工作路径"
          title="返回工作路径"
        >
          <IconChevronRightOutlineRegular size={13} aria-hidden="true" />
          工作路径
        </button>
        <div className={css.statusLine} data-status={group.status}>
          <StatusMark status={group.status} />
          <span>{groupStatusLabel(group)}</span>
          <span className={css.location}>
            对话轮次 {group.turn || '—'} · {group.steps.length} 个步骤{groupDuration === null ? '' : ` · ${groupDuration}`}
          </span>
        </div>
        <h2 className={css.inspectorTitle}>{group.title}</h2>
        <p className={css.inspectorSummary}>{group.subtitle}</p>
        <div className={css.groupSignals} aria-label="工作模式">
          {group.parallelStepCount > 0 ? <span>并行 {group.parallelStepCount} 次</span> : null}
          {group.retryCount > 0 ? <span data-retry="">重试 {group.retryCount} 次</span> : null}
          {group.iterationCount > 0 ? <span>有 {group.iterationCount} 次迭代</span> : null}
          {group.unconfirmedFailureCount > 0 ? <span data-error="">{group.unconfirmedFailureCount} 条失败后未见成功证据</span> : null}
        </div>
      </header>

      <div className={css.inspectorBody}>
        <section className={css.executionSection} aria-labelledby={`execution-title-${group.id}`}>
          <div className={css.sectionHeading}>
            <h3 id={`execution-title-${group.id}`}>执行路径</h3>
            <span>{group.items.length} 条记录</span>
          </div>
          <div className={css.executionList}>
            {group.steps.map((step, stepIndex) => {
              const stepLive = live && stepIndex === group.steps.length - 1
              const stepDuration = formatDuration(stepElapsedMs(step, stepLive, now))
              return <div key={step.id} className={css.stepBlock} data-parallel={step.parallel ? '' : undefined}>
                <div className={css.stepHeading}>
                  <span>步骤 {step.step || '—'}</span>
                  <span className={css.stepSignals}>
                    {stepDuration === null ? null : <span className={css.stepDuration}>{stepDuration}</span>}
                    {step.parallel ? <span className={css.parallelLabel}>{step.executionCount} 项并行</span> : null}
                  </span>
                </div>
                <div className={css.occurrences}>
                  {step.items.map((item, itemIndex) => {
                    const itemDuration = formatDuration(itemElapsedMs(item, stepLive && item.status === 'running', now))
                    return <button
                      key={item.id}
                      type="button"
                      className={css.occurrence}
                      data-selected={item.id === selected.id ? '' : undefined}
                      data-status={item.status}
                      aria-pressed={item.id === selected.id}
                      onClick={() => onSelectItem(item.id)}
                    >
                      <StatusMark status={item.status} className={css.occurrenceDot} />
                      <span className={css.occurrenceCopy}>
                        <span className={css.occurrenceTitle}>{item.title}</span>
                        <span className={css.occurrenceMeta}>
                          {item.toolName ?? item.source}
                          {step.items.length > 1 ? ` · 分支 ${itemIndex + 1}` : ''}
                          {itemPattern(item) === null ? '' : ` · ${itemPattern(item)}`}
                        </span>
                      </span>
                      {itemDuration === null ? null : <span className={css.occurrenceDuration}>{itemDuration}</span>}
                      <IconChevronRightOutlineRegular size={12} className={css.occurrenceChevron} />
                    </button>
                  })}
                </div>
              </div>
            })}
          </div>
        </section>

        <section className={css.detailSection} aria-labelledby={`detail-title-${selected.id}`}>
          <div className={css.detailHeader}>
            <div className={css.detailIdentity}>
              <div className={css.detailStatus} data-status={selected.status}>
                <StatusMark status={selected.status} />
                <span>{STATUS_LABEL[selected.status]}</span>
                {pattern === null ? null : <span className={css.patternLabel}>{pattern}</span>}
              </div>
              <h3 id={`detail-title-${selected.id}`}>{selected.title}</h3>
              <p title={selected.subtitle}>{selected.subtitle || '没有补充说明'}</p>
            </div>
            <dl className={css.metrics}>
              {duration === null ? null : <><dt>耗时</dt><dd>{duration}</dd></>}
              {selected.exitCode === null ? null : <><dt>退出码</dt><dd data-error={selected.exitCode === 0 ? undefined : ''}>{selected.exitCode}</dd></>}
              {selected.signal === null ? null : <><dt>信号</dt><dd data-error="">{selected.signal}</dd></>}
            </dl>
          </div>

          <div className={css.tabs} role="tablist" aria-label="执行数据">
            {([
              ['result', '结果'],
              ['input', '输入'],
              ['raw', '原始'],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                className={css.tab}
                data-active={tab === id ? '' : undefined}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className={css.tabPanel} role="tabpanel">
            {tab === 'result' ? <ResultPresentation presentation={selected.presentation} /> : null}
            {tab === 'input'
              ? hasInput
                ? <div className={css.jsonSurface}><JsonTree data={selected.args} label="执行输入" labels={JSON_LABELS} /></div>
                : <div className={css.detailEmpty}>这条记录没有工具输入</div>
              : null}
            {tab === 'raw'
              ? (
                <div className={css.rawPanel}>
                  <div className={css.rawToolbar}>
                    <span>完整原始数据 · 不截断</span>
                    <CopyRawButton text={raw} />
                  </div>
                  <pre>{raw || '没有原始数据'}</pre>
                </div>
              )
              : null}
          </div>
        </section>
      </div>
      <footer className={css.inspectorFooter}>只读观察 · 不会改变 Agent</footer>
    </aside>
  )
}
