import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-session-stats/client'
import {
  IconChevronRightOutlineRegular,
  IconRefreshOutlineRegular,
  Pill,
  useAnchoredPosition,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { createFollow } from '../hub/follow.ts'
import type { CompleteHistoryResult } from '../hub/history.ts'
import {
  clusterOutcomeSummary,
  clusterWorkItems,
  type WorkCluster,
} from '../hub/aggregation.ts'
import {
  EMPTY_PICTURE,
  foldSnapshot,
  mergeObservedPictures,
  type WorkGroup,
  type WorkItem,
  type WorkPicture,
  type WorkPresentation,
  type WorkStatus,
  type WorkStep,
  type WorkTurn,
  type WatcherSnapshot,
} from '../observation/fold.ts'
import css from './Watcher.module.css'
import tokensCss from './ui/tokens.module.css'
import { SessionInsights } from './SessionInsights.tsx'
import { SegmentedToggle } from './ui/SegmentedToggle.tsx'
import {
  OVERVIEW_STATE_LABEL,
  overviewStateOf,
  turnNeedsDefaultDisclosure,
  turnOverviewSummary,
} from '../hub/overview.ts'
import {
  deriveTurnPerformance,
  formatTokensPerSecond,
  groupElapsedMs,
  itemElapsedMs,
  stepElapsedMs,
  turnElapsedReading,
  type TurnPerformance,
} from '../observation/performance.ts'
import {
  hasReasoningEvidence,
  modelStageMetrics,
  type ModelAttempt,
  type ModelStepTrace,
} from '../observation/model-trace.ts'
import { formatDuration, turnDuration, useLiveClock } from './display.ts'
import { ExecutionInspector, type DetailTab } from './Inspector.tsx'
import { PhaseOverview, showOverviewTag } from './Overview.tsx'
import type { ObservationMode } from './view-mode.ts'
import {
  chooseDisclosureDepth,
  createDisclosureState,
  layerDisclosureOpen,
  resetDisclosureOverrides,
  setLayerDisclosure,
  toggleLayerDisclosure,
  toggleTurnDisclosure,
  turnDisclosureOpen,
  type DisclosureLayer,
  type DisclosureState,
} from './disclosure-depth.ts'

export interface WatcherInjected {
  loadAllHistory: (signal: AbortSignal) => Promise<CompleteHistoryResult>
}

export type WatcherProps = PropsRuntime<'conversation.session.header.utilities'> & WatcherInjected

type HistoryLoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'complete' }
  | { kind: 'error'; message: string }

const PANEL_GAP = 8
const PANEL_MARGIN = 12
/**
 * Mirrors the docked inspector choreography in `Watcher.module.css`: the detail
 * content leaves first, the column closes after it. The fallback keeps the
 * control working when the animation event is lost.
 */
const INSPECTOR_CONTENT_EXIT_MS = 120
const INSPECTOR_EXIT_MS = 200
const INSPECTOR_EXIT_FALLBACK_MS = INSPECTOR_CONTENT_EXIT_MS + INSPECTOR_EXIT_MS + 250
const UNPLACED_PANEL_STYLE: CSSProperties = { visibility: 'hidden', left: 0, top: 0 }
const PANEL_SIZE_KEY = 'dsh-watcher:panel-size:v1'
const PANEL_SIZE_MIN_W = 320
const PANEL_SIZE_MIN_H = 200

/** A resized panel is a deliberate layout choice; remember it across reopens. */
function readStoredPanelSize(): { width: number; height: number } | null {
  try {
    const raw = globalThis.localStorage?.getItem(PANEL_SIZE_KEY)
    if (raw == null) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const width = (parsed as Record<string, unknown>).width
    const height = (parsed as Record<string, unknown>).height
    if (typeof width !== 'number' || !Number.isFinite(width) || typeof height !== 'number' || !Number.isFinite(height)) return null
    const clamp = (value: number, floor: number, ceil: number) => Math.min(Math.max(value, floor), Math.max(floor, ceil))
    return {
      width: clamp(width, PANEL_SIZE_MIN_W, window.innerWidth - PANEL_MARGIN * 2),
      height: clamp(height, PANEL_SIZE_MIN_H, window.innerHeight - PANEL_MARGIN * 2),
    }
  } catch {
    return null
  }
}

function writeStoredPanelSize(size: { width: number; height: number } | null): void {
  try {
    if (size === null) globalThis.localStorage?.removeItem(PANEL_SIZE_KEY)
    else globalThis.localStorage?.setItem(PANEL_SIZE_KEY, JSON.stringify(size))
  } catch {
    // Storage is best-effort; the live panel never depends on it.
  }
}

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
          className={css.eyeOutline}
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
  const snapshotPicture = useMemo(
    () => (open ? foldSnapshot(snapshot, { running }) : null),
    [open, snapshot, running],
  )
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
  const latestActivityKey = lastItem === undefined
    ? lastGroupId
    : `${lastGroupId}:${lastItem.id}:${lastItem.seq}:${lastItem.status}:${lastItem.resultSeq ?? 'open'}:${lastItem.resultTime ?? 'open'}`
  const [ui, setUi] = useState(() => ({ follow: true, unread: 0, selectedId: null as string | null }))
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [inspectorClosing, setInspectorClosing] = useState(false)
  const inspectorExitTimer = useRef<number | null>(null)
  const inspectorExitToLatest = useRef(false)
  const [panelPin, setPanelPin] = useState<{ top: number; right: number } | null>(null)
  const panelPinTimer = useRef<number | null>(null)
  /** Resize anchors the panel at its current top-left; null until first resized. */
  const [panelPos, setPanelPos] = useState<{ left: number; top: number } | null>(null)
  /** User-chosen panel size; unset falls back to the CSS auto/max-height layout. */
  const [panelSize, setPanelSize] = useState<{ width: number; height: number } | null>(readStoredPanelSize)
  /** A size restored from storage is a preference, not a floor: the first drag
   * may shrink it back down, while a first-ever drag keeps the natural layout
   * it opened at as the minimum. */
  const restoredSizeRef = useRef(panelSize !== null)
  const [resizing, setResizing] = useState(false)
  const resizeStart = useRef<{ x: number; y: number; w: number; h: number } | null>(null)
  /** The natural size the panel opened at — the floor; resize can only grow. */
  const resizeMin = useRef<{ w: number; h: number } | null>(null)
  const [observationMode, setObservationMode] = useState<ObservationMode>('itemized')
  const [disclosure, setDisclosure] = useState(createDisclosureState)
  const [historyLoad, setHistoryLoad] = useState<HistoryLoadState>({ kind: 'idle' })
  const now = useLiveClock(open && picture.running)
  const followRef = useRef(createFollow())
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const railRef = useRef<HTMLDivElement>(null)
  const programmaticScrollRef = useRef(false)
  const historyAbortRef = useRef<AbortController | null>(null)
  const panelPosition = useAnchoredPosition({
    open,
    anchorRef: triggerRef,
    panelRef,
    gap: PANEL_GAP,
    margin: PANEL_MARGIN,
  })

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
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  useLayoutEffect(() => {
    historyAbortRef.current?.abort()
    historyAbortRef.current = null
    setHistoryLoad({ kind: 'idle' })
    followRef.current.reset()
    setUi(followRef.current.snapshot())
    setSelectedItemId(null)
    setDisclosure(resetDisclosureOverrides)
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
  }, [ui.follow, latestActivityKey, observationMode, open])

  const selected = ui.selectedId === null ? undefined : picture.nodes.find(group => group.id === ui.selectedId)
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

  const selectItem = (group: WorkGroup, item: WorkItem) => {
    clearInspectorExit()
    pinPanelFrame()
    setInspectorClosing(false)
    setUi(followRef.current.onSelect(group.id))
    setSelectedItemId(item.id)
  }

  /**
   * "定位现场" must end at the failing work item, not just somewhere near the
   * turn: opening the inspector on that exact item is the whole point of the
   * affordance. A finding whose step can't be matched still lands on its turn.
   */
  const locateEvidence = (e: { turn: number; steps: number[]; seqs: number[] }) => {
    pinForDisclosure()
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

  const clearPanelPin = () => {
    if (panelPinTimer.current !== null) {
      window.clearTimeout(panelPinTimer.current)
      panelPinTimer.current = null
    }
    setPanelPin(null)
  }

  /**
   * Opening and closing the docked inspector both change the panel's own width,
   * and a clamped panel derives its inline `left` from that width. The
   * ResizeObserver re-derives it a frame after layout, so mid-animation the
   * frame flicked left and right on every tick. Freezing the measured frame for
   * the transition lets the left edge follow layout instead of a measurement;
   * an unclamped panel needs no pin, because its `left` does not depend on the
   * width.
   */
  const pinPanelFrame = () => {
    const panel = panelRef.current
    if (panel === null) return
    // A resized panel owns its left; the width change can still push it off the
    // right edge, so re-clamp after the new frame lands instead of pinning.
    if (panelPos !== null) {
      requestAnimationFrame(() => {
        const w = panel.offsetWidth
        const h = panel.offsetHeight
        setPanelPos(current => current === null ? current : {
          left: Math.min(Math.max(current.left, PANEL_MARGIN), window.innerWidth - w - PANEL_MARGIN),
          top: Math.min(Math.max(current.top, PANEL_MARGIN), window.innerHeight - h - PANEL_MARGIN),
        })
      })
      return
    }
    if (panelPosition === null) return
    const { left, top } = panelPosition
    // Layout values, not getBoundingClientRect: the panel's entry animation is
    // scaled, and offsetWidth/top ignore transforms.
    if (typeof left !== 'number' || typeof top !== 'number') return
    const right = window.innerWidth - (left + panel.offsetWidth)
    if (Math.abs(right - PANEL_MARGIN) > 1) return
    setPanelPin({ top, right })
    if (panelPinTimer.current !== null) window.clearTimeout(panelPinTimer.current)
    panelPinTimer.current = window.setTimeout(clearPanelPin, INSPECTOR_EXIT_FALLBACK_MS)
  }

  /**
   * Resize the panel from its right / bottom / corner edges. The panel keeps
   * its frame position the whole time — resize only changes the size, so the
   * anchored spot is never lost. The floor is the natural size the panel
   * opened at: it can grow but never shrink below what the layout needs.
   */
  const onResizeStart = (event: ReactPointerEvent<HTMLElement>, axes: 'both' | 'x' | 'y') => {
    if (event.button !== 0) return
    const panel = panelRef.current
    if (panel === null) return
    event.preventDefault()
    event.stopPropagation()
    const rect = panel.getBoundingClientRect()
    // Freeze the current frame into left/top so a right-pinned or
    // anchor-clamped panel holds its position while only its size changes.
    if (panelPos === null) setPanelPos({ left: rect.left, top: rect.top })
    setPanelPin(null)
    // The first resize establishes the minimum; the panel can only grow. A
    // restored size is exempt — it was chosen elsewhere and may shrink.
    if (resizeMin.current === null) {
      resizeMin.current = restoredSizeRef.current
        ? { w: PANEL_SIZE_MIN_W, h: PANEL_SIZE_MIN_H }
        : { w: rect.width, h: rect.height }
    }
    resizeStart.current = { x: event.clientX, y: event.clientY, w: rect.width, h: rect.height }
    setResizing(true)
    const minW = resizeMin.current.w
    const minH = resizeMin.current.h
    // The panel's fixed left/top doesn't move during a resize, so the max
    // width/height is whatever still fits to its right/below.
    const maxW = Math.max(minW, window.innerWidth - rect.left - PANEL_MARGIN)
    const maxH = Math.max(minH, window.innerHeight - rect.top - PANEL_MARGIN)
    const applyMove = (e: PointerEvent) => {
      const s = resizeStart.current
      if (s === null) return
      setPanelSize(current => ({
        width: axes === 'y' ? (current?.width ?? s.w) : Math.min(Math.max(s.w + (e.clientX - s.x), minW), maxW),
        height: axes === 'x' ? (current?.height ?? s.h) : Math.min(Math.max(s.h + (e.clientY - s.y), minH), maxH),
      }))
    }
    // One size commit per frame: pointermove outpaces React renders while dragging.
    let pending: PointerEvent | null = null
    let frame: number | null = null
    const move = (e: PointerEvent) => {
      pending = e
      if (frame !== null) return
      frame = requestAnimationFrame(() => {
        frame = null
        const ev = pending
        pending = null
        if (ev !== null) applyMove(ev)
      })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (frame !== null) {
        cancelAnimationFrame(frame)
        frame = null
      }
      const ev = pending
      pending = null
      if (ev !== null) applyMove(ev)
      resizeStart.current = null
      setResizing(false)
      const el = panelRef.current
      if (el !== null) writeStoredPanelSize({ width: el.offsetWidth, height: el.offsetHeight })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /** A double-click on the grip returns the panel to its anchored auto layout. */
  const resetPanelSize = () => {
    writeStoredPanelSize(null)
    resizeMin.current = null
    setPanelPin(null)
    setPanelPos(null)
    setPanelSize(null)
  }

  // A resized panel owns fixed coordinates; a shrinking viewport has to pull it
  // (and its size) back inside the window instead of stranding it off-screen.
  useEffect(() => {
    const onWindowResize = () => {
      setPanelPos(current => {
        if (current === null) return current
        const panel = panelRef.current
        const w = panel?.offsetWidth ?? 0
        const h = panel?.offsetHeight ?? 0
        const clamp = (value: number, ceil: number) => Math.min(Math.max(value, PANEL_MARGIN), Math.max(PANEL_MARGIN, ceil))
        return {
          left: clamp(current.left, window.innerWidth - w - PANEL_MARGIN),
          top: clamp(current.top, window.innerHeight - h - PANEL_MARGIN),
        }
      })
      setPanelSize(current => {
        if (current === null) return current
        return {
          width: Math.min(current.width, Math.max(PANEL_SIZE_MIN_W, window.innerWidth - PANEL_MARGIN * 2)),
          height: Math.min(current.height, Math.max(PANEL_SIZE_MIN_H, window.innerHeight - PANEL_MARGIN * 2)),
        }
      })
    }
    window.addEventListener('resize', onWindowResize)
    return () => window.removeEventListener('resize', onWindowResize)
  }, [])

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
    pinPanelFrame()
    setInspectorClosing(true)
    // The animation end is the primary signal; this keeps the control working
    // when the animation never runs or its event is lost.
    inspectorExitTimer.current = window.setTimeout(finishInspectorExit, INSPECTOR_EXIT_FALLBACK_MS)
  }

  useEffect(() => () => {
    clearInspectorExit()
    if (panelPinTimer.current !== null) window.clearTimeout(panelPinTimer.current)
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
            style={(() => {
              const pos = panelPos !== null
                ? panelPos
                : panelPin === null
                  ? panelPosition ?? UNPLACED_PANEL_STYLE
                  : { top: panelPin.top, right: panelPin.right, left: 'auto' as const }
              return panelSize === null ? pos : { ...pos, width: panelSize.width, height: panelSize.height, maxHeight: 'none' as const }
            })()}
            data-sized={panelSize !== null ? '' : undefined}
            data-resizing={resizing ? '' : undefined}
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
                  onSelectItem={setSelectedItemId}
                  onBack={() => closeInspector()}
                  onExited={finishInspectorExit}
                />
              )}

            <section className={css.workPicture} aria-label="Agent 工作路径" data-ud-check="watcher-work-picture" data-ud-role="panel">
              <header className={css.commandBar}>
                <div className={css.commandRow}>
                  {/* Only the coarse state is announced; the ticking clock below
                      would otherwise re-announce once per second. */}
                  <div className={css.commandState}>
                    <span
                      className={css.commandDot}
                      data-state={picture.running ? 'running' : hasEdgeAlert ? 'alert' : 'idle'}
                      aria-hidden="true"
                    />
                    <span className={css.commandStatus} aria-live="polite" data-alert={hasEdgeAlert ? '' : undefined}>{summaryState}</span>
                    <span className={css.commandNow} aria-hidden="true" title={picture.running ? nowLabel : 'DSH-Watcher'}>
                      {picture.running ? nowLabel : 'DSH-Watcher'}
                    </span>
                  </div>
                  <Pill
                    className={css.follow}
                    active={ui.follow}
                    aria-pressed={ui.follow}
                    aria-label={ui.follow ? '停止跟随最新工作' : '跟随最新工作'}
                    onClick={() => {
                      if (!ui.follow) programmaticScrollRef.current = true
                      setUi(followRef.current.setFollow(!ui.follow))
                    }}
                  >
                    <IconRefreshOutlineRegular size={12} />
                    {ui.follow ? '自动跟随' : '浏览历史'}
                  </Pill>
                </div>
                <div className={css.controlRow} aria-label="路径视图设置">
                  <div className={css.controlCounts}>
                    <span>
                      {snapshot.hasMore && totalTurnCount > picture.turnCount
                        ? `已载入 ${picture.turnCount}/${totalTurnCount} 轮`
                        : `${picture.turnCount} 轮`}
                    </span>
                    <span>
                      {snapshot.hasMore && totalStepCount > picture.stepCount
                        ? `${picture.stepCount}/${totalStepCount} 步`
                        : `${picture.stepCount} 步`}
                    </span>
                    <span>{picture.actionCount} 次执行</span>
                    {snapshot.hasMore || historyLoad.kind === 'loading' || historyLoad.kind === 'error' ? (
                      <button
                        type="button"
                        className={css.loadAllInlineBtn}
                        onClick={startHistoryLoad}
                        disabled={historyLoad.kind === 'loading'}
                      >
                        {historyLoad.kind === 'loading' ? '正在补齐历史…' : historyLoad.kind === 'error' ? '重试载入' : '载入全部历史 →'}
                      </button>
                    ) : null}
                    {historyLoad.kind === 'loading' || historyLoad.kind === 'error' ? (
                      <span role="status">{historyLoad.kind === 'error' ? historyLoad.message : `已载入 ${historyProgress}`}</span>
                    ) : null}
                  </div>
                  <div className={css.controlViews}>
                    <div className={css.viewControl}>
                      <span className={css.viewToolbarLabel}>组织</span>
                      <SegmentedToggle
                        label="路径组织方式"
                        value={observationMode}
                        onChange={chooseObservationMode}
                        options={[
                          { value: 'itemized', label: '逐项', title: '按时间顺序展示每个步骤和每次执行' },
                          { value: 'grouped', label: '归类', title: '按同一目标或完全相同的指令归类，展开仍可查看原始执行' },
                        ]}
                      />
                    </div>
                    <div className={css.viewControl}>
                      <span className={css.viewToolbarLabel}>层级</span>
                      <SegmentedToggle
                        label="路径展开深度"
                        value={disclosure.depth}
                        onChange={chooseDepth}
                        options={[
                          { value: 'overview', label: '概览', title: '展开当前轮次，展示阶段概览；阶段内部保持收起' },
                          { value: 'detail', label: '详情', title: '展开所有轮次、阶段、步骤、模型与推理记录' },
                        ]}
                      />
                    </div>
                  </div>
                </div>
              </header>

              <SessionInsights value={wholeSessionInsights} now={now} running={picture.running} waiting={picture.pendingCount > 0} onEvidence={locateEvidence} tokensPerSecond={liveTokensPerSecond} />

              {!ui.follow && ui.unread > 0
                ? (
                  <button
                    type="button"
                    className={css.unread}
                    onClick={selected === undefined ? backToLatest : () => closeInspector(true)}
                  >
                    <IconRefreshOutlineRegular size={12} />
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
                : (
                  <div ref={railRef} className={css.railViewport} onScroll={onRailScroll}>
                    <div className={css.turns}>
                      {picture.turns.map(turn => {
                        const isLatestTurn = turn.turn === latestTurnNumber
                        const turnState = overviewStateOf(turn.status, isLatestTurn)
                        const automaticDefaultOpen = turnNeedsDefaultDisclosure(turnState, isLatestTurn)
                        const turnOpen = turnDisclosureOpen(disclosure, turn.turn, automaticDefaultOpen)
                        const turnTitle = turn.turn === 0 ? '会话准备' : `对话轮次 ${turn.turn}`
                        const turnSummary = turnOverviewSummary(turn)
                        const performance = performanceByTurn.get(turn.turn)
                        const isLiveTurn = isLatestTurn && picture.running
                        const duration = turnDuration(turn, isLiveTurn, now)
                        const tokenSpeed = performance?.throughput.kind === 'measured'
                          ? `${formatTokensPerSecond(performance.throughput.tokensPerSecond)} tok/s`
                          : null
                        const durationAria = duration === null
                          ? ''
                          : duration.kind === 'exact'
                            ? `，总耗时 ${duration.value}`
                            : `，已记录 ${duration.value}，开头未载入`
                        const secondaryPerformance = [
                          duration?.kind === 'partial' ? '开头未载入' : null,
                          tokenSpeed,
                        ].filter((value): value is string => value !== null).join(' · ')
                        return (
                          <section key={turn.turn} className={css.turn} aria-labelledby={`watcher-turn-${turn.turn}`}>
                            <header className={css.turnHeader}>
                              <h2 id={`watcher-turn-${turn.turn}`}>
                                <button
                                  type="button"
                                  className={css.turnToggle}
                                  aria-expanded={turnOpen}
                                  aria-controls={`watcher-turn-body-${turn.turn}`}
                                  aria-label={`${turnTitle}，${OVERVIEW_STATE_LABEL[turnState]}，${turnSummary}${durationAria}${tokenSpeed === null ? '' : `，生成速度 ${tokenSpeed}`}，${turnOpen ? '收起轮次' : '展开轮次'}`}
                                  title={turnOpen ? '收起此轮次；新进展仍会继续更新' : '展开此轮次'}
                                  onClick={() => {
                                    pinForDisclosure()
                                    setDisclosure(current => toggleTurnDisclosure(
                                      current,
                                      turn.turn,
                                      automaticDefaultOpen,
                                    ))
                                  }}
                                >
                                  <IconChevronRightOutlineRegular size={13} className={css.turnChevron} />
                                  <span className={css.turnNoWrap} aria-hidden="true">
                                    <span className={css.turnNoLabel}>{turn.turn === 0 ? '准备' : '轮次'}</span>
                                    <span className={css.turnNo}>{turn.turn === 0 ? '—' : turn.turn}</span>
                                  </span>
                                  <span className={css.turnCopy}>
                                    <span className={css.turnTitleLine}>
                                      {showOverviewTag(turnState)
                                        ? <span className={css.overviewTag} data-state={turnState}>{OVERVIEW_STATE_LABEL[turnState]}</span>
                                        : null}
                                    </span>
                                    <span className={css.turnSummary}>{turnSummary}</span>
                                  </span>
                                  <span className={css.turnPerformance}>
                                    <span className={css.turnDuration}>
                                      {duration === null
                                        ? OVERVIEW_STATE_LABEL[turnState]
                                        : duration.kind === 'exact'
                                          ? `总 ${duration.value}`
                                          : `已记录 ${duration.value}`}
                                    </span>
                                    {secondaryPerformance === '' ? null : <span className={css.turnSpeed}>{secondaryPerformance}</span>}
                                  </span>
                                </button>
                              </h2>
                            </header>
                            {turnOpen ? (
                            <div id={`watcher-turn-body-${turn.turn}`} className={css.turnBody}>
                              <div className={css.groupRail}>
                                <span className={css.railLine} aria-hidden="true" />
                                {(() => {
                                  const turnTotalMs = turn.groups.reduce(
                                    (sum, group) => sum + (groupElapsedMs(group, isLiveTurn, now) ?? 0),
                                    0,
                                  )
                                  return turn.groups.map(group => {
                                    const isNow = group.id === lastGroupId
                                    const selectedGroup = ui.selectedId === group.id
                                    const phaseOpen = layerDisclosureOpen(disclosure, 'phase', group.id)
                                    return (
                                      <PhaseOverview
                                        key={group.id}
                                        group={group}
                                        isNow={isNow}
                                        running={picture.running}
                                        turnTotalMs={turnTotalMs}
                                        selectedGroup={selectedGroup}
                                      selectedItemId={selectedItemId}
                                      observationMode={observationMode}
                                      open={phaseOpen}
                                      disclosure={disclosure}
                                      onToggle={() => {
                                        pinForDisclosure()
                                        setDisclosure(current => toggleLayerDisclosure(current, 'phase', group.id))
                                      }}
                                      onToggleLayer={(layer, key) => {
                                        pinForDisclosure()
                                        setDisclosure(current => toggleLayerDisclosure(current, layer, key))
                                      }}
                                      onToggleReasoning={(key, modelKey) => {
                                        pinForDisclosure()
                                        setDisclosure(current => {
                                          const reasoningOpen = layerDisclosureOpen(current, 'reasoning', key)
                                          const withOpenParent = reasoningOpen
                                            ? current
                                            : setLayerDisclosure(current, 'model', modelKey, true)
                                          // Opening a nested reasoning record is explicit reading intent.
                                          // Keep its parent open when the live model settles and its
                                          // default changes after a depth switch or live update.
                                          return toggleLayerDisclosure(withOpenParent, 'reasoning', key)
                                        })
                                      }}
                                      onSelectItem={item => selectItem(group, item)}
                                    />
                                  )
                                })
                              })()}
                              </div>
                            </div>
                            ) : null}
                          </section>
                        )
                      })}
                    </div>
                  </div>
                )}
            </section>
            <div className={css.resizeEdgeRight} aria-hidden="true" onPointerDown={e => onResizeStart(e, 'x')} />
            <div className={css.resizeEdgeBottom} aria-hidden="true" onPointerDown={e => onResizeStart(e, 'y')} />
            <div
              className={css.resizeGrip}
              aria-hidden="true"
              title="拖动调整大小 · 双击恢复默认尺寸"
              onPointerDown={e => onResizeStart(e, 'both')}
              onDoubleClick={resetPanelSize}
            />
          </div>,
          document.body,
        )
        : null}
    </div>
  )
}
