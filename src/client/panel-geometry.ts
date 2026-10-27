import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, RefObject } from 'react'
import { useAnchoredPosition } from '@deepseek-ai/dsh-client-ui-primitives'

/** Distance kept between the trigger and the panel it opens. */
export const PANEL_GAP = 8
/** Distance kept between the panel and every viewport edge. */
export const PANEL_MARGIN = 12

const PANEL_SIZE_KEY = 'dsh-watcher:panel-size:v1'
const PANEL_SIZE_MIN_W = 320
const PANEL_SIZE_MIN_H = 200

const UNPLACED_PANEL_STYLE: CSSProperties = { visibility: 'hidden', left: 0, top: 0 }

interface PanelSize {
  width: number
  height: number
}

interface PanelPoint {
  left: number
  top: number
}

/** A resized panel is a deliberate layout choice; remember it across reopens. */
function readStoredPanelSize(): PanelSize | null {
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

function writeStoredPanelSize(size: PanelSize | null): void {
  try {
    if (size === null) globalThis.localStorage?.removeItem(PANEL_SIZE_KEY)
    else globalThis.localStorage?.setItem(PANEL_SIZE_KEY, JSON.stringify(size))
  } catch {
    // Storage is best-effort; the live panel never depends on it.
  }
}

export interface PanelGeometry {
  /** Inline style for the portaled panel: position, size and the sized flag. */
  style: CSSProperties
  /** True once the user has resized the panel away from its auto layout. */
  sized: boolean
  resizing: boolean
  /** The panel's own frame, exposed so disclosure changes can pin it. */
  panelRef: RefObject<HTMLDivElement>
  /** Freeze the measured frame so a width change cannot re-clamp mid-animation. */
  pinFrame: () => void
  /** Drop a pin and release the frozen coordinates. */
  clearPin: () => void
  startResize: (event: React.PointerEvent<HTMLElement>, axes: 'both' | 'x' | 'y') => void
  resetSize: () => void
}

/**
 * Owns everything about where the floating panel sits and how big it is: the
 * anchored default frame, the frozen frame used while the inspector opens and
 * closes, the user's persisted size, and edge dragging. None of it depends on
 * the work-picture data, so the panel component does not have to carry it.
 *
 * `fallbackExitMs` is how long a frozen frame may outlive the transition that
 * needed it; past that the anchor takes over again even if no animation ran.
 */
export function usePanelGeometry({ open, anchorRef, fallbackExitMs }: {
  open: boolean
  anchorRef: RefObject<HTMLElement>
  fallbackExitMs: number
}): PanelGeometry {
  const panelRef = useRef<HTMLDivElement>(null)
  const [pin, setPin] = useState<{ top: number; right: number } | null>(null)
  const pinTimer = useRef<number | null>(null)
  /** Resize anchors the panel at its current top-left; null until first resized. */
  const [pos, setPos] = useState<PanelPoint | null>(null)
  /** User-chosen size; unset falls back to the CSS auto/max-height layout. */
  const [size, setSize] = useState<PanelSize | null>(readStoredPanelSize)
  /** A restored size is a preference, not a floor: the first drag may shrink it
   * back down, while a first-ever drag keeps the natural layout it opened at as
   * the minimum. */
  const restoredSizeRef = useRef(size !== null)
  const [resizing, setResizing] = useState(false)
  const resizeStart = useRef<{ x: number; y: number; w: number; h: number } | null>(null)
  /** Tears down an in-flight drag; the unmount path needs it too. */
  const endResizeRef = useRef<(() => void) | null>(null)
  /** The natural size the panel opened at — the floor; resize can only grow. */
  const resizeMin = useRef<{ w: number; h: number } | null>(null)
  const anchored = useAnchoredPosition({
    open,
    anchorRef,
    panelRef,
    gap: PANEL_GAP,
    margin: PANEL_MARGIN,
  })

  const clearPin = useCallback(() => {
    if (pinTimer.current !== null) {
      window.clearTimeout(pinTimer.current)
      pinTimer.current = null
    }
    setPin(null)
  }, [])

  /**
   * Opening and closing the docked inspector both change the panel's own width,
   * and a clamped panel derives its inline `left` from that width. The
   * ResizeObserver re-derives it a frame after layout, so mid-animation the
   * frame flicked left and right on every tick. Freezing the measured frame for
   * the transition lets the left edge follow layout instead of a measurement;
   * an unclamped panel needs no pin, because its `left` does not depend on the
   * width.
   */
  const pinFrame = useCallback(() => {
    const panel = panelRef.current
    if (panel === null) return
    // A resized panel owns its left; the width change can still push it off the
    // right edge, so re-clamp after the new frame lands instead of pinning.
    if (pos !== null) {
      requestAnimationFrame(() => {
        const w = panel.offsetWidth
        const h = panel.offsetHeight
        setPos(current => current === null ? current : {
          left: Math.min(Math.max(current.left, PANEL_MARGIN), window.innerWidth - w - PANEL_MARGIN),
          top: Math.min(Math.max(current.top, PANEL_MARGIN), window.innerHeight - h - PANEL_MARGIN),
        })
      })
      return
    }
    if (anchored === null) return
    const { left, top } = anchored
    // Layout values, not getBoundingClientRect: the panel's entry animation is
    // scaled, and offsetWidth/top ignore transforms.
    if (typeof left !== 'number' || typeof top !== 'number') return
    const right = window.innerWidth - (left + panel.offsetWidth)
    if (Math.abs(right - PANEL_MARGIN) > 1) return
    setPin({ top, right })
    if (pinTimer.current !== null) window.clearTimeout(pinTimer.current)
    pinTimer.current = window.setTimeout(clearPin, fallbackExitMs)
  }, [anchored, clearPin, fallbackExitMs, pos])

  /**
   * Resize the panel from its right / bottom / corner edges. The panel keeps
   * its frame position the whole time — resize only changes the size, so the
   * anchored spot is never lost. The floor is the natural size the panel
   * opened at: it can grow but never shrink below what the layout needs.
   */
  const startResize = (event: React.PointerEvent<HTMLElement>, axes: 'both' | 'x' | 'y') => {
    if (event.button !== 0) return
    const panel = panelRef.current
    if (panel === null) return
    event.preventDefault()
    event.stopPropagation()
    const rect = panel.getBoundingClientRect()
    // Freeze the current frame into left/top so a right-pinned or
    // anchor-clamped panel holds its position while only its size changes.
    if (pos === null) setPos({ left: rect.left, top: rect.top })
    setPin(null)
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
      setSize(current => ({
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
    /**
     * Releasing outside the window never delivers pointerup, and a touch can be
     * taken over by the OS (pointercancel). Both paths, plus unmount, must end
     * the drag or the window listeners outlive the gesture and keep resizing.
     */
    const endResize = (persist: boolean) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      if (frame !== null) {
        cancelAnimationFrame(frame)
        frame = null
      }
      const ev = pending
      pending = null
      if (ev !== null) applyMove(ev)
      resizeStart.current = null
      endResizeRef.current = null
      try { panel.releasePointerCapture(event.pointerId) } catch { /* already released */ }
      if (!persist) return
      setResizing(false)
      const el = panelRef.current
      if (el !== null) writeStoredPanelSize({ width: el.offsetWidth, height: el.offsetHeight })
    }
    const onUp = () => endResize(true)
    const onCancel = () => endResize(true)
    endResizeRef.current = () => endResize(false)
    try { panel.setPointerCapture(event.pointerId) } catch { /* pointer already gone */ }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }

  /** A double-click on the grip returns the panel to its anchored auto layout. */
  const resetSize = () => {
    writeStoredPanelSize(null)
    resizeMin.current = null
    setPin(null)
    setPos(null)
    setSize(null)
  }

  // A resized panel owns fixed coordinates; a shrinking viewport has to pull it
  // (and its size) back inside the window instead of stranding it off-screen.
  useEffect(() => {
    const onWindowResize = () => {
      setPos(current => {
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
      setSize(current => {
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

  useLayoutEffect(() => () => {
    if (pinTimer.current !== null) window.clearTimeout(pinTimer.current)
    endResizeRef.current?.()
  }, [])

  const style = ((): CSSProperties => {
    const base = pos !== null
      ? pos
      : pin === null
        ? anchored ?? UNPLACED_PANEL_STYLE
        : { top: pin.top, right: pin.right, left: 'auto' as const }
    return size === null ? base : { ...base, width: size.width, height: size.height, maxHeight: 'none' as const }
  })()

  return {
    style,
    sized: size !== null,
    resizing,
    panelRef,
    pinFrame,
    clearPin,
    startResize,
    resetSize,
  }
}
