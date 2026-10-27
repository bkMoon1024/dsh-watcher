import { useEffect, useState } from 'react'
import { turnElapsedReading } from '../observation/performance.ts'
import type { WorkItem, WorkTurn } from '../observation/fold.ts'

export function formatDuration(durationMs: number | null): string | null {
  if (durationMs === null) return null
  if (durationMs < 1000) return `${Math.round(durationMs)} ms`
  const secondsWithDecimal = Math.round(durationMs / 100) / 10
  if (secondsWithDecimal < 60) {
    return `${secondsWithDecimal < 10 ? secondsWithDecimal.toFixed(1) : Math.round(secondsWithDecimal)} s`
  }
  const totalSeconds = Math.round(durationMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60)
    return `${hours}h ${minutes % 60}m`
  }
  return `${minutes}m ${seconds}s`
}

export type TurnDurationDisplay = {
  kind: 'exact' | 'partial'
  value: string
}

export function turnDuration(turn: WorkTurn, live: boolean, now: number): TurnDurationDisplay | null {
  const reading = turnElapsedReading(turn, live, now)
  if (reading.kind === 'unavailable') return null
  const duration = formatDuration(reading.durationMs)
  if (duration === null) return null
  return {
    kind: reading.kind === 'exact' ? 'exact' : 'partial',
    value: duration,
  }
}

export function useLiveClock(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!enabled) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [enabled])

  return now
}

/**
 * Markdown that is safe to render inside the panel.
 *
 * Recorded output is untrusted text: a model or a fetched file can contain
 * `![x](https://…)`, which a markdown renderer resolves immediately. That would
 * turn opening a record into a request to somebody else's server, so a remote
 * image becomes a plain link the reader can choose to open.
 */
export function safeMarkdown(text: string): string {
  if (!text) return text
  return text
    .replace(/!\[([^\]]*)\]\((\s*)(https?:\/\/[^)\s]+)([^)]*)\)/gi, (_match, alt: string, _space, url: string) => (
      alt ? `[${alt}](${url})` : `<${url}>`
    ))
    // Raw HTML images bypass markdown image syntax entirely.
    .replace(/<img[^>]*src\s*=\s*["']?(https?:\/\/[^"'>\s]+)[^>]*>/gi, '<$1>')
}

/** How an item relates to an earlier attempt at the same work. */
export function itemPattern(item: WorkItem): string | null {
  if (item.retryIndex > 0) return `重试 ${item.retryIndex} 次`
  if (item.iterationIndex > 0) return `迭代第 ${item.iterationIndex + 1} 版`
  if (item.recoveredBy !== null) return '后续已恢复'
  return null
}

/** The raw payload as text, falling back to JSON when the fold kept no text. */
export function rawOf(item: WorkItem): string {
  if (item.rawText.trim() !== '') return item.rawText
  try {
    return JSON.stringify(item.rawValue, null, 2) ?? String(item.rawValue)
  } catch {
    return String(item.rawValue)
  }
}

export function isJsonValue(value: unknown): value is object | unknown[] {
  return typeof value === 'object' && value !== null
}
