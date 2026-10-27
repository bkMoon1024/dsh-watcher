import { useEffect, useRef, useState } from 'react'
import {
  DiffBlock,
  IconCheckOutlineRegular,
  IconChevronLeftOutlineRegular,
  IconChevronRightOutlineRegular,
  IconCopyOutlineRegular,
  JsonTree,
  MarkdownText,
  ReadBlock,
  TerminalBlock,
  writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkGroup, WorkItem, WorkPresentation } from '../observation/fold.ts'
import { groupElapsedMs, itemElapsedMs } from '../observation/performance.ts'
import css from './Watcher.module.css'
import {
  DIFF_LABELS,
  JSON_LABELS,
  MARKDOWN_LABELS,
  READ_LABELS,
  STATUS_LABEL,
  TERMINAL_LABELS,
} from './labels.ts'
import { formatDuration, isJsonValue, itemPattern, rawOf, safeMarkdown } from './display.ts'
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
          <MarkdownText text={safeMarkdown(presentation.text)} labels={MARKDOWN_LABELS} />
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
  position,
  onStep,
  onBack,
  onExited,
}: {
  group: WorkGroup
  selectedItemId: string | null
  live: boolean
  now: number
  closing: boolean
  position: { index: number; total: number }
  onStep: (direction: -1 | 1) => void
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
        <div className={css.inspectorLocator}>
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
          <div className={css.recordStepper} role="group" aria-label="执行记录切换">
            <button
              type="button"
              className={css.recordStepButton}
              onClick={() => onStep(-1)}
              disabled={position.index <= 0}
              aria-label="上一条记录"
              title="上一条记录"
            >
              <IconChevronLeftOutlineRegular size={14} aria-hidden="true" />
            </button>
            <span className={css.recordPosition} aria-live="polite">
              记录 {position.index + 1}/{position.total}
            </span>
            <button
              type="button"
              className={css.recordStepButton}
              onClick={() => onStep(1)}
              disabled={position.index >= position.total - 1}
              aria-label="下一条记录"
              title="下一条记录"
            >
              <IconChevronRightOutlineRegular size={14} aria-hidden="true" />
            </button>
          </div>
        </div>
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
                id={`inspector-tab-${id}`}
                type="button"
                role="tab"
                aria-selected={tab === id}
                aria-controls={`inspector-tabpanel-${id}`}
                tabIndex={tab === id ? 0 : -1}
                className={css.tab}
                data-active={tab === id ? '' : undefined}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>

          <div
            id={`inspector-tabpanel-${tab}`}
            className={css.tabPanel}
            role="tabpanel"
            aria-labelledby={`inspector-tab-${tab}`}
          >
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
