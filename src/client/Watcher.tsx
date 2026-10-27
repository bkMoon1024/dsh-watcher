import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-session-stats/client'
import { IconSearchOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { createFollow } from '../hub/follow.ts'
import type { CompleteHistoryResult } from '../hub/history.ts'
import {
  EMPTY_PICTURE,
  foldSnapshot,
  mergeObservedPictures,
  type WorkGroup,
  type WorkItem,
  type WorkPicture,
  type WorkStatus,
  type WatcherSnapshot,
} from '../observation/fold.ts'
import css from './Watcher.module.css'
import tokensCss from './ui/tokens.module.css'
import { usePanelGeometry } from './panel-geometry.ts'
import { deriveTurnPerformance, type TurnPerformance } from '../observation/performance.ts'
import { useLiveClock } from './display.ts'
import { ExecutionInspector } from './Inspector.tsx'
import {
  EMPTY_PATH_FILTER,
  groupMatchesFilter,
  pathFilterActive,
  type PathFilter,
} from './path-filter.ts'
import type { ObservationMode } from './view-mode.ts'
import {
  chooseDisclosureDepth,
  createDisclosureState,
  layerDisclosureOpen,
  resetDisclosureOverrides,
  setLayerDisclosure,
  toggleLayerDisclosure,
  toggleTurnDisclosure,
  type DisclosureLayer,
  type DisclosureState,
} from './disclosure-depth.ts'
import { SessionInsights, type Evidence } from './SessionInsights.tsx'
import { PanelHeader, type PanelTool } from './panel/PanelHeader.tsx'
import { PathTimeline } from './panel/PathTimeline.tsx'
import { PathToggle } from './panel/PathToggle.tsx'
import { SearchRow } from './panel/SearchRow.tsx'
import { ViewMenu } from './panel/ViewMenu.tsx'

export interface WatcherInjected {
  /** Pull a single older page; the caller decides how far back to walk. */
  loadOlderPage: () => Promise<void>
  loadAllHistory: (signal: AbortSignal) => Promise<CompleteHistoryResult>
}

export type WatcherProps = PropsRuntime<'conversation.session.header.utilities'> & WatcherInjected

type HistoryLoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'complete' }
  | { kind: 'error'; message: string }

/**
 * Mirrors the docked inspector choreography in `Watcher.module.css`: the detail
 * content leaves first, the column closes after it. The fallback keeps the
 * control working when the animation event is lost.
 */
const INSPECTOR_CONTENT_EXIT_MS = 120
const INSPECTOR_EXIT_MS = 200
const INSPECTOR_EXIT_FALLBACK_MS = INSPECTOR_CONTENT_EXIT_MS + INSPECTOR_EXIT_MS + 250

/** The pupil scans only while live; the complete eye remains a useful static glyph. */
function IconLivingEye({ size = 17 }: { size?: number }) {
  return (
    <svg
      className={css.eye}
      data-ud-motion="watcher-eye-scan"
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden="true"
    >
      <g className={css.eyeBlink}>
        <path
          fill="currentColor"
          fillRule="evenodd"
          d="M9 3.25c-3.93 0-7.03 2.88-7.9 5.75.87 2.87 3.97 5.75 7.9 5.75s7.03-2.88 7.9-5.75C16.03 6.13 12.93 3.25 9 3.25Zm0 9.95A4.2 4.2 0 1 1 9 4.8a4.2 4.2 0 0 1 0 8.4Z"
        />
        <g className={css.eyePupil}>
          <circle cx="9" cy="9" r="2.05" fill="currentColor" />
          <circle cx="9.65" cy="8.35" r="0.45" fill="var(--ui-surface)" opacity="0.9" />
        </g>
      </g>
    </svg>
  )
}

/** Placeholder while the panel is closed and no fold has run yet. */
const NO_PERFORMANCE: ReadonlyMap<number, TurnPerformance> = new Map()

interface NodeHint {
  readonly kind?: unknown
  readonly interrupted?: unknown
}

/**
 * The closed trigger still has to report a failed or interrupted turn, but it
 * must not fold the session to find that out. The snapshot ends with the node
 * that closed the turn, so read that one node instead of the whole picture.
 */
function closedEdgeStatus(nodes: readonly NodeHint[], running: boolean): WorkStatus {
  if (running) return 'running'
  const last = nodes.at(-1)
  if (last === undefined) return 'unknown'
  if (last.kind === 'turn-error') return 'failure'
  if (last.kind === 'turn-max-tokens') return 'interrupted'
  if (last.kind === 'assistant' && last.interrupted === true) return 'interrupted'
  return 'unknown'
}

/** Native session-header utility: exact work picture, typed evidence, no steering. */
export function Watcher(props: WatcherProps) {
  const conversation = props.useConversation((state: any) => state)
  const chat = conversation?.views?.get('chat')
  if (chat === undefined) return <span role="status">Watcher 正在等待会话记录…</span>
  return <ReadyWatcher {...props} chat={chat} views={conversation.views} />
}

function ReadyWatcher({
  useSession,
  useSessionStatus,
  useProjection,
  sessionId,
  loadOlderPage,
  loadAllHistory,
  chat,
  views,
}: WatcherProps & Pick<WatcherSnapshot, 'chat' | 'views'>) {
  const sessionSnapshot = useSession((state: any) => state)
  const pending = useSessionStatus((state: any) => state.get(sessionId)?.pendingInteraction)
  const snapshot = useMemo<WatcherSnapshot>(() => ({
    views,
    chat,
    nodes: chat.legacy.nodes,
    turnTimings: chat.legacy.turnTimings,
    runningCalls: chat.legacy.runningCalls,
    pending: pending === undefined ? [] : [pending],
    blank: sessionSnapshot.blank,
    running: sessionSnapshot.running,
    hasMore: sessionSnapshot.hasMore,
  }), [chat, views, pending, sessionSnapshot.blank, sessionSnapshot.hasMore, sessionSnapshot.running])
  const running = snapshot.running
  const [open, setOpen] = useState(false)
  const wholeSessionStats = useProjection('sessionStats')
  const wholeSessionInsights = useProjection('watcherInsights')
  // Folding walks every node, pair, step and item of the session, and this
  // component is mounted in the session header for the whole page lifetime.
  // Folding unconditionally meant every streaming delta paid for a picture
  // nobody was looking at. Fold only while the panel is open; the closed
  // trigger reads the cheap live session flags instead.
  //
  // While a turn streams, the host republishes this snapshot for every delta,
  // and a long session does not fold cheaply (a 20k-event session folds in
  // ~130 ms). Refolding per delta pegged the main thread, so live rendering
  // coalesces to a bounded rate that backs off with the measured fold cost.
  // The moment the turn settles the newest snapshot folds immediately, so the
  // read can never lag behind recorded evidence.
  const [foldSource, setFoldSource] = useState(snapshot)
  const latestFoldSource = useRef(snapshot)
  const foldCostRef = useRef(0)
  latestFoldSource.current = snapshot
  useEffect(() => {
    if (!open || !running) return
    let cancelled = false
    let timer: number | undefined
    const tick = () => {
      if (cancelled) return
      setFoldSource(latestFoldSource.current)
      timer = window.setTimeout(tick, Math.max(120, foldCostRef.current * 3))
    }
    tick()
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [open, running])
  // Idle snapshots are folded on arrival: a settled turn is exactly when the
  // reader expects the panel to catch up, and there is nothing to coalesce.
  useEffect(() => {
    if (running) return
    setFoldSource(snapshot)
  }, [running, snapshot])
  const snapshotPicture = useMemo(() => {
    if (!open) return null
    const started = performance.now()
    const folded = foldSnapshot(foldSource, { running })
    foldCostRef.current = performance.now() - started
    return folded
  }, [open, foldSource, running])
  const observedRef = useRef<{ sessionId: string; picture: WorkPicture; source: WorkPicture } | null>(null)
  const lastPictureRef = useRef<WorkPicture | null>(null)
  const picture = useMemo(() => {
    if (snapshotPicture === null) return lastPictureRef.current ?? EMPTY_PICTURE
    const previous = observedRef.current?.sessionId === sessionId
      ? observedRef.current.picture
      : null
    // Idempotent on repeated evaluation of the same input (StrictMode double
    // render), so the accumulated merge can never run twice for one snapshot.
    if (observedRef.current !== null && observedRef.current.sessionId === sessionId
      && observedRef.current.source === snapshotPicture) return observedRef.current.picture
    const next = previous === null ? snapshotPicture : mergeObservedPictures(previous, snapshotPicture)
    observedRef.current = { sessionId, picture: next, source: snapshotPicture }
    lastPictureRef.current = next
    return next
  }, [sessionId, snapshotPicture])
  const performanceByTurn = useMemo(
    () => (open ? deriveTurnPerformance(snapshot.nodes, picture.turns) : NO_PERFORMANCE),
    [open, snapshot.nodes, picture.turns],
  )
  const lastGroup = picture.nodes.at(-1)
  const lastGroupId = lastGroup?.id ?? null
  const lastItem = lastGroup?.items.at(-1)
  const lastItemId = lastItem?.id ?? null
  const latestActivityKey = lastItem === undefined
    ? lastGroupId
    : `${lastGroupId}:${lastItem.id}:${lastItem.seq}:${lastItem.status}:${lastItem.resultSeq ?? 'open'}:${lastItem.resultTime ?? 'open'}`
  const [ui, setUi] = useState(() => ({ follow: true, unread: 0, selectedId: null as string | null }))
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [inspectorClosing, setInspectorClosing] = useState(false)
  const inspectorExitTimer = useRef<number | null>(null)
  const inspectorExitToLatest = useRef(false)
  const [observationMode, setObservationMode] = useState<ObservationMode>('itemized')
  const [disclosure, setDisclosure] = useState(createDisclosureState)
  const [historyLoad, setHistoryLoad] = useState<HistoryLoadState>({ kind: 'idle' })
  const [olderLoading, setOlderLoading] = useState(false)
  const [pathFilter, setPathFilter] = useState<PathFilter>(EMPTY_PATH_FILTER)
  const filterActive = pathFilterActive(pathFilter)
  // The panel keeps one tool open at a time: search or the view/history menu.
  // The usage readout is the main surface and the path opens below it on demand.
  const [activeTool, setActiveTool] = useState<PanelTool>('none')
  const [timelineOpen, setTimelineOpen] = useState(false)
  const searchVisible = activeTool === 'search' || filterActive
  // A wide panel can show the work path and the open record side by side;
  // narrower ones keep the overlay drawer so neither column gets crushed.
  const [splitView, setSplitView] = useState(false)
  const now = useLiveClock(open && picture.running)
  const followRef = useRef(createFollow())
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const railRef = useRef<HTMLDivElement>(null)
  const programmaticScrollRef = useRef(false)
  const historyAbortRef = useRef<AbortController | null>(null)
  const geometry = usePanelGeometry({ open, anchorRef: triggerRef, fallbackExitMs: INSPECTOR_EXIT_FALLBACK_MS })
  const panelRef = geometry.panelRef

  // The panel is portaled out of the conversation header so it can sit above
  // the sticky composer and every shell column. Outside dismissal therefore
  // has to test the in-place trigger and the portaled surface independently.
  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return
      if (rootRef.current?.contains(event.target) === true) return
      if (panelRef.current?.contains(event.target) === true) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
    }
  }, [open, panelRef])

  // The split threshold is a property of the panel, not the viewport: the panel
  // can be dragged wider than the window's breakpoints suggest. It stays above
  // the default panel width (760px) so the default layout keeps the overlay
  // drawer; only a deliberately widened panel earns the second column.
  useEffect(() => {
    const panel = open ? panelRef.current : null
    if (panel === null) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry === undefined) return
      setSplitView(entry.contentRect.width >= 980)
    })
    observer.observe(panel)
    return () => observer.disconnect()
  }, [open, panelRef])

  // A click elsewhere closes the open tool. The tool buttons and the overlays
  // themselves are exempt: the button's own click has to be able to toggle it.
  useEffect(() => {
    if (activeTool === 'none') return
    const closeTool = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (target.closest('[data-watcher-tool]') !== null) return
      if (target.closest('[data-watcher-overlay]') !== null) return
      setActiveTool('none')
    }
    document.addEventListener('pointerdown', closeTool)
    return () => document.removeEventListener('pointerdown', closeTool)
  }, [activeTool])

  useEffect(() => {
    if (open) return
    setActiveTool('none')
  }, [open])

  useLayoutEffect(() => {
    historyAbortRef.current?.abort()
    historyAbortRef.current = null
    setHistoryLoad({ kind: 'idle' })
    followRef.current.reset()
    setUi(followRef.current.snapshot())
    setSelectedItemId(null)
    setDisclosure(resetDisclosureOverrides)
    setPathFilter(EMPTY_PATH_FILTER)
    setActiveTool('none')
    setTimelineOpen(false)
  }, [sessionId])

  useEffect(() => () => {
    historyAbortRef.current?.abort()
  }, [])

  useLayoutEffect(() => {
    setUi(followRef.current.onPicture(picture))
  }, [picture])

  useLayoutEffect(() => {
    const rail = railRef.current
    if (!rail || !open || !ui.follow) return
    programmaticScrollRef.current = true
    rail.scrollTop = rail.scrollHeight
    const frame = requestAnimationFrame(() => {
      programmaticScrollRef.current = false
    })
    return () => {
      cancelAnimationFrame(frame)
      programmaticScrollRef.current = false
    }
  }, [ui.follow, latestActivityKey, observationMode, open, timelineOpen])

  const selected = ui.selectedId === null ? undefined : picture.nodes.find(group => group.id === ui.selectedId)
  const selectionItems = selected?.items ?? []
  const selectedIndex = selected === undefined
    ? -1
    : Math.max(0, selected.items.findIndex(item => item.id === selectedItemId))
  const inspectorPosition = { index: selectedIndex, total: selectionItems.length }
  const latestTurnNumber = picture.turns.at(-1)?.turn ?? null
  const latestPerformance = performanceByTurn.get(latestTurnNumber ?? -1)
  const liveTokensPerSecond = latestPerformance?.throughput.kind === 'measured'
    ? latestPerformance.throughput.tokensPerSecond
    : null
  const totalTurnCount = Math.max(picture.turnCount, wholeSessionStats?.turns ?? 0)
  const totalStepCount = Math.max(picture.stepCount, wholeSessionStats?.steps ?? 0)
  const historyProgress = totalStepCount > picture.stepCount
    ? `${picture.stepCount}/${totalStepCount} 个步骤`
    : totalTurnCount > picture.turnCount
      ? `${picture.turnCount}/${totalTurnCount} 个对话轮次`
      : `${picture.stepCount} 个步骤已载入`
  // While the panel is closed the fold is skipped, so the trigger reads the
  // cheap live session flags instead of a work picture that is not being kept
  // up to date.
  const liveRunning = open ? picture.running : snapshot.running
  const livePending = open ? picture.pendingCount > 0 : snapshot.pending.length > 0
  const edgeStatus = open ? picture.now.status : closedEdgeStatus(snapshot.nodes, running)
  const hasEdgeAlert = livePending
    || edgeStatus === 'failure'
    || edgeStatus === 'interrupted'
  const summaryState = livePending
    ? '等待确认'
    : liveRunning
      ? '正在执行'
      : edgeStatus === 'failure'
        ? '执行失败'
        : edgeStatus === 'interrupted'
          ? '已中断'
          : (open ? picture.nodes.length > 0 : !snapshot.blank) ? '就绪' : '待命'
  const nowLabel = picture.now.label || (picture.nodes.length > 0 ? '执行路径已就绪' : '等待指令')

  // Filtering narrows the path instead of hiding it: a turn survives when any
  // of its groups does, and an active filter opens the turns it kept so the
  // matches are not hidden behind collapsed headers.
  const visibleTurns = useMemo(() => (filterActive
    ? picture.turns.filter(turn => turn.groups.some(group => groupMatchesFilter(group, pathFilter)))
    : picture.turns), [filterActive, picture.turns, pathFilter])
  const noFilterMatch = filterActive && visibleTurns.length === 0
  const turnsText = totalTurnCount > picture.turnCount
    ? `${picture.turnCount}/${totalTurnCount} 轮`
    : `${picture.turnCount} 轮`
  const stepsText = totalStepCount > picture.stepCount
    ? `${picture.stepCount}/${totalStepCount} 步`
    : `${picture.stepCount} 步`
  const actionsText = `${picture.actionCount} 次执行`
  const historyMessage = historyLoad.kind === 'error'
    ? historyLoad.message
    : historyLoad.kind === 'loading'
      ? `已载入 ${historyProgress}`
      : historyLoad.kind === 'complete'
        ? '历史已补齐'
        : null
  // The view/history overlay hangs directly under the status bar it is opened
  // from; the path itself sits below the usage readout.
  const overlayTop = 50

  const selectItem = (group: WorkGroup, item: WorkItem) => {
    clearInspectorExit()
    geometry.pinFrame()
    setInspectorClosing(false)
    setUi(followRef.current.onSelect(group.id))
    setSelectedItemId(item.id)
  }

  /**
   * A long run is reviewed record by record, not by re-finding the next row in
   * the path: step the inspector through the group it was opened from.
   */
  const stepSelection = (direction: -1 | 1) => {
    if (selected === undefined) return
    const items = selected.items
    const index = items.findIndex(item => item.id === selectedItemId)
    const base = index < 0 ? (direction > 0 ? -1 : 0) : index
    const next = items[base + direction]
    if (next === undefined) return
    selectItem(selected, next)
  }

  // Escape peels one layer at a time: the open tool first, then the detail,
  // then the unfolded path, then the panel. Arrow keys move between the records
  // of the open detail, but never while a text field has focus.
  // The listener is bound once per open panel and reads the newest closures
  // through a ref: rebinding it on every render churned add/remove for each
  // streaming delta.
  const keydownHandler = useRef<(event: globalThis.KeyboardEvent) => void>(() => {})
  keydownHandler.current = (event: globalThis.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      if (activeTool !== 'none') {
        setActiveTool('none')
        return
      }
      if (selected !== undefined) {
        // The detail is still animating out: swallow this Esc instead of
        // collapsing the path underneath the closing column.
        if (!inspectorClosing) closeInspector()
        return
      }
      if (timelineOpen) {
        setTimelineOpen(false)
        return
      }
      setOpen(false)
      triggerRef.current?.focus()
      return
    }
    // A floating tool owns the keyboard while it is open.
    if (activeTool !== 'none') return
    if (selected === undefined || inspectorClosing) return
    const target = event.target
    if (target instanceof HTMLElement
      && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault()
      stepSelection(1)
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault()
      stepSelection(-1)
    }
  }
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: globalThis.KeyboardEvent) => keydownHandler.current(event)
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  /**
   * "定位现场" must end at the failing work item, not just somewhere near the
   * turn: opening the inspector on that exact item is the whole point of the
   * affordance. A finding whose step can't be matched still lands on its turn.
   */
  const locateEvidence = (e: Evidence) => {
    pinForDisclosure()
    setTimelineOpen(true)
    setPathFilter(EMPTY_PATH_FILTER)
    setActiveTool('none')
    setDisclosure(chooseDisclosureDepth('detail'))
    const turn = picture.turns.find(t => t.turn === e.turn)
    const group = turn?.groups.find(g => g.items.some(i =>
      i.status === 'failure' && e.steps.includes(i.step ?? -1)))
    const item = group?.items.find(i => i.status === 'failure' && e.steps.includes(i.step ?? -1))
    if (turn && group && item) {
      selectItem(group, item)
      requestAnimationFrame(() => document.getElementById(`watcher-turn-${turn.turn}`)?.scrollIntoView({ block: 'nearest' }))
    } else {
      requestAnimationFrame(() => document.getElementById(`watcher-turn-${e.turn}`)?.scrollIntoView({ block: 'nearest' }))
    }
  }

  const onRailScroll = () => {
    if (programmaticScrollRef.current) return
    const rail = railRef.current
    if (rail === null) return
    const atBottom = rail.scrollHeight - rail.scrollTop - rail.clientHeight < 24
    setUi(followRef.current.onScroll({ atBottom }))
  }

  const backToLatest = () => {
    programmaticScrollRef.current = true
    setUi(followRef.current.backToLatest())
  }

  const clearInspectorExit = () => {
    if (inspectorExitTimer.current === null) return
    window.clearTimeout(inspectorExitTimer.current)
    inspectorExitTimer.current = null
  }

  /**
   * Closing the inspector is one continuous motion: the column narrows while
   * the detail content slides right and disappears under the work-path card.
   * The collapse animation already ends at the closed width, so the unmount
   * that finishes it cannot flash or jump.
   * `toLatest` is for the "查看最新" affordance only; the plain back control
   * just closes the detail and keeps the rail pinned where the user left it.
   */
  const finishInspectorExit = () => {
    clearInspectorExit()
    setUi(inspectorExitToLatest.current ? followRef.current.backToLatest() : followRef.current.clearSelection())
    setSelectedItemId(null)
    setInspectorClosing(false)
  }

  const closeInspector = (toLatest = false) => {
    if (inspectorClosing) return
    inspectorExitToLatest.current = toLatest
    geometry.pinFrame()
    setInspectorClosing(true)
    // The animation end is the primary signal; this keeps the control working
    // when the animation never runs or its event is lost.
    inspectorExitTimer.current = window.setTimeout(finishInspectorExit, INSPECTOR_EXIT_FALLBACK_MS)
  }

  useEffect(() => () => {
    clearInspectorExit()
  }, [])

  const pinForDisclosure = () => {
    if (ui.follow) setUi(followRef.current.setFollow(false))
  }

  const chooseObservationMode = (mode: ObservationMode) => {
    if (mode === observationMode) return
    if (ui.follow) programmaticScrollRef.current = true
    setObservationMode(mode)
  }

  const chooseDepth = (depth: DisclosureState['depth']) => {
    if (depth === disclosure.depth) return
    pinForDisclosure()
    setDisclosure(chooseDisclosureDepth(depth))
  }

  const toggleTurn = (turn: number, automaticDefaultOpen: boolean) => {
    pinForDisclosure()
    setDisclosure(current => toggleTurnDisclosure(current, turn, automaticDefaultOpen))
  }

  const togglePhase = (groupId: string) => {
    pinForDisclosure()
    setDisclosure(current => toggleLayerDisclosure(current, 'phase', groupId))
  }

  const toggleLayer = (layer: DisclosureLayer, key: string) => {
    pinForDisclosure()
    setDisclosure(current => toggleLayerDisclosure(current, layer, key))
  }

  const toggleReasoning = (key: string, modelKey: string) => {
    pinForDisclosure()
    setDisclosure(current => {
      const reasoningOpen = layerDisclosureOpen(current, 'reasoning', key)
      const withOpenParent = reasoningOpen
        ? current
        : setLayerDisclosure(current, 'model', modelKey, true)
      // Opening a nested reasoning record is explicit reading intent. Keep its
      // parent open when the live model settles and its default changes after
      // a depth switch or live update.
      return toggleLayerDisclosure(withOpenParent, 'reasoning', key)
    })
  }

  const startOlderLoad = () => {
    if (olderLoading || !snapshot.hasMore) return
    setOlderLoading(true)
    setHistoryLoad({ kind: 'idle' })
    void loadOlderPage()
      .catch((error: unknown) => {
        setHistoryLoad({
          kind: 'error',
          message: error instanceof Error ? error.message : String(error),
        })
      })
      .finally(() => setOlderLoading(false))
  }

  const startHistoryLoad = () => {
    if (historyLoad.kind === 'loading' || historyLoad.kind === 'complete') return
    historyAbortRef.current?.abort()
    const controller = new AbortController()
    historyAbortRef.current = controller
    setHistoryLoad({ kind: 'loading' })
    void loadAllHistory(controller.signal).then((result) => {
      if (historyAbortRef.current !== controller) return
      if (result.kind === 'blocked') {
        const message = result.reason === 'busy'
          ? '主会话正在载入历史，请稍后重试'
          : result.reason === 'page-limit'
            ? '历史页数超出安全上限，请分次重试'
            : '历史分页没有继续前进，请重试'
        setHistoryLoad({ kind: 'error', message })
      } else if (result.kind === 'complete') {
        // Keep a short terminal state until React observes the final Session
        // page. This prevents a stale `hasMore` render from starting the loop
        // a second time after the official loader has already reached page 1.
        setHistoryLoad({ kind: 'complete' })
      } else {
        setHistoryLoad({ kind: 'idle' })
      }
    }).catch((error: unknown) => {
      if (historyAbortRef.current !== controller || controller.signal.aborted) return
      setHistoryLoad({
        kind: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
    }).finally(() => {
      if (historyAbortRef.current === controller) historyAbortRef.current = null
    })
  }

  // Full history is an explicit choice; the summary comes from the Host projection.
  useEffect(() => {
    if (historyLoad.kind !== 'complete' || snapshot.hasMore) return
    setHistoryLoad({ kind: 'idle' })
  }, [historyLoad.kind, snapshot.hasMore])

  /**
   * Both tools belong to the path, so asking for one unfolds it first: a click
   * on search or the view menu should never land on a hidden surface.
   */
  const toggleTool = (tool: Exclude<PanelTool, 'none'>) => {
    setTimelineOpen(true)
    setActiveTool(current => (current === tool ? 'none' : tool))
  }
  const closeTool = () => setActiveTool('none')
  const toggleTimeline = () => {
    const next = !timelineOpen
    setTimelineOpen(next)
    // A tool floats over the path; collapsing the path must not leave its
    // overlay hanging over the usage readout.
    if (!next) setActiveTool('none')
  }
  // Closing the path also shrinks the card to its read-out: the persisted drag
  // height would otherwise leave the collapsed panel mostly empty.
  const panelStyle = timelineOpen
    ? geometry.style
    : { ...geometry.style, height: 'auto', maxHeight: 'min(680px, calc(100vh - 24px))' }

  return (
    <div ref={rootRef} className={`${tokensCss.tokens} ${tokensCss.series} ${css.root}`} data-dsh-watcher="header">
      <button
        ref={triggerRef}
        type="button"
        className={css.trigger}
        data-open={open ? '' : undefined}
        data-live={liveRunning && (open ? picture.nodes.length > 0 : !snapshot.blank) ? '' : undefined}
        data-alert={hasEdgeAlert ? '' : undefined}
        aria-expanded={open}
        aria-label={`Watcher，${summaryState}`}
        title={`Watcher · ${summaryState}`}
        onClick={() => setOpen(value => !value)}
      >
        <IconLivingEye />
      </button>

      {open
        ? createPortal(
          <div
            ref={panelRef}
            className={`${tokensCss.tokens} ${tokensCss.series} ${css.menu}`}
            style={panelStyle}
            data-sized={geometry.sized ? '' : undefined}
            data-resizing={geometry.resizing ? '' : undefined}
            data-split={splitView && selected !== undefined ? '' : undefined}
            role="dialog"
            aria-modal="false"
            aria-label="Watcher 工作图"
            data-dsh-watcher-panel=""
            data-ud-motion="watcher-panel-enter"
          >
            {selected === undefined
              ? null
              : (
                <ExecutionInspector
                  group={selected}
                  selectedItemId={selectedItemId}
                  live={picture.running && selected.id === lastGroupId}
                  now={now}
                  closing={inspectorClosing}
                  position={inspectorPosition}
                  onStep={stepSelection}
                  onBack={() => closeInspector()}
                  onExited={finishInspectorExit}
                />
              )}

            <section
              className={css.workPicture}
              aria-label="Agent 工作路径"
              data-timeline={timelineOpen ? 'open' : 'closed'}
              data-ud-check="watcher-work-picture"
              data-ud-role="panel"
            >
              <PanelHeader
                status={summaryState}
                nowLabel={nowLabel}
                running={picture.running}
                alert={hasEdgeAlert}
                searchActive={searchVisible}
                tool={activeTool}
                onToggleSearch={() => toggleTool('search')}
                onToggleMenu={() => toggleTool('menu')}
              />
              <div className={css.usageWindow} id="watcher-usage-window" aria-label="用量与耗时">
                {wholeSessionInsights === undefined
                  ? (
                    <p className={css.statsEmpty}>
                      还没有可统计的用量。开始一轮对话后，这里会出现耗时分布、模型与花费。
                    </p>
                  )
                  : (
                    <SessionInsights
                      flat
                      value={wholeSessionInsights}
                      now={now}
                      running={picture.running}
                      waiting={picture.pendingCount > 0}
                      onEvidence={locateEvidence}
                      tokensPerSecond={liveTokensPerSecond}
                    />
                  )}
              </div>
              <section
                id="watcher-timeline-section"
                className={css.timelineSection}
                aria-label="执行路径"
                data-open={timelineOpen ? '' : undefined}
              >
                <PathToggle
                  open={timelineOpen}
                  counts={`${turnsText} · ${stepsText} · ${actionsText}`}
                  hint={historyProgress}
                  onToggle={toggleTimeline}
                />
                <div id="watcher-timeline-body" className={css.timelineBody} hidden={!timelineOpen}>
                {searchVisible
                  ? (
                    <SearchRow
                      filter={pathFilter}
                      onChange={setPathFilter}
                      onClear={() => {
                        setPathFilter(EMPTY_PATH_FILTER)
                        setActiveTool(current => (current === 'search' ? 'none' : current))
                      }}
                    />
                  )
                  : null}
                {!ui.follow && ui.unread > 0
                  ? (
                    <button
                      type="button"
                      className={css.unread}
                      onClick={selected === undefined ? backToLatest : () => closeInspector(true)}
                    >
                      {ui.unread} 条新进展 · 查看最新
                    </button>
                  )
                  : null}

                {picture.nodes.length === 0
                  ? (
                    <div className={css.empty}>
                      <span className={css.emptyEye} aria-hidden="true"><IconLivingEye size={22} /></span>
                      <strong>还没有工作记录</strong>
                      <span>第一轮对话开始后，路径会从这里生长</span>
                    </div>
                  )
                  : noFilterMatch
                    ? (
                      <div className={css.empty}>
                        <span className={css.emptyEye} aria-hidden="true"><IconSearchOutlineRegular size={22} /></span>
                        <strong>没有匹配的记录</strong>
                        <span>换个关键词，或把筛选切回「全部」</span>
                      </div>
                    )
                    : (
                      <PathTimeline
                        turns={visibleTurns}
                        viewportRef={railRef}
                        onScroll={onRailScroll}
                        performanceByTurn={performanceByTurn}
                        latestTurnNumber={latestTurnNumber}
                        running={picture.running}
                        filterActive={filterActive}
                        filter={pathFilter}
                        mode={observationMode}
                        disclosure={disclosure}
                        lastGroupId={lastGroupId}
                        lastItemId={lastItemId}
                        selectedGroupId={ui.selectedId}
                        selectedItemId={selectedItemId}
                        hasMore={snapshot.hasMore}
                        olderLoading={olderLoading}
                        historyKind={historyLoad.kind}
                        historyMessage={historyLoad.kind === 'error' ? historyLoad.message : null}
                        onLoadOlder={startOlderLoad}
                        onToggleTurn={toggleTurn}
                        onTogglePhase={togglePhase}
                        onToggleLayer={toggleLayer}
                        onToggleReasoning={toggleReasoning}
                        onSelectItem={selectItem}
                      />
                    )}
                </div>
              </section>
              {activeTool === 'menu'
                ? (
                  <ViewMenu
                    mode={observationMode}
                    depth={disclosure.depth}
                    hasMore={snapshot.hasMore}
                    olderLoading={olderLoading}
                    historyKind={historyLoad.kind}
                    historyMessage={historyMessage}
                    following={ui.follow}
                    top={overlayTop}
                    onMode={mode => { chooseObservationMode(mode); closeTool() }}
                    onDepth={depth => { chooseDepth(depth); closeTool() }}
                    onLoadOlder={() => { closeTool(); startOlderLoad() }}
                    onLoadAll={() => { closeTool(); startHistoryLoad() }}
                    onBackToLatest={() => { closeTool(); backToLatest() }}
                  />
                )
                : null}
            </section>
            {timelineOpen
              ? (
                <>
                  <div className={css.resizeEdgeRight} aria-hidden="true" onPointerDown={e => geometry.startResize(e, 'x')} />
                  <div className={css.resizeEdgeBottom} aria-hidden="true" onPointerDown={e => geometry.startResize(e, 'y')} />
                  <div
                    className={css.resizeGrip}
                    aria-hidden="true"
                    title="拖动调整大小 · 双击恢复默认尺寸"
                    onPointerDown={e => geometry.startResize(e, 'both')}
                    onDoubleClick={geometry.resetSize}
                  />
                </>
              )
              : null}
          </div>,
          document.body,
        )
        : null}
    </div>
  )
}
