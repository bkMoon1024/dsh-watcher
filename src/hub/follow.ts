import type { WorkPicture } from '../observation/fold.ts'

export interface FollowSnapshot {
  follow: boolean
  unread: number
  selectedId: string | null
}

export interface RailScrollState {
  atBottom: boolean
}

/**
 * Follow versus pin state for the work rail.
 *
 * The rail follows the newest recorded occurrence by default. Selecting
 * history or scrolling away pins the viewport; later occurrences and result
 * updates increment `unread` without yanking the reader away from evidence.
 */
export function createFollow() {
  let follow = true
  let unread = 0
  let selectedId: string | null = null
  let lastCursor: string | null = null
  let observedOccurrenceIds: readonly string[] = []
  // Stable identity while values are unchanged so setUi callers can bail out.
  let cached: FollowSnapshot | null = null

  function snapshot(): FollowSnapshot {
    if (cached === null || cached.follow !== follow || cached.unread !== unread || cached.selectedId !== selectedId) {
      cached = { follow, unread, selectedId }
    }
    return cached
  }

  function catchUp(): void {
    follow = true
    unread = 0
    selectedId = null
  }

  return {
    snapshot,

    /** Counts appended occurrences or a settled live result while pinned. */
    onPicture(picture: Pick<WorkPicture, 'nodes'>): FollowSnapshot {
      const groups = picture.nodes
      if (groups.length === 0) {
        lastCursor = null
        observedOccurrenceIds = []
        catchUp()
        return snapshot()
      }

      const group = groups.at(-1)
      const item = group?.items.at(-1)
      const cursor = group === undefined
        ? null
        : item === undefined
          ? group.id
          : `${group.id}:${item.id}:${item.status}:${item.resultSeq ?? 'open'}:${item.resultTime ?? 'open'}`
      if (cursor !== null && cursor !== lastCursor) {
        // The id list only matters when the newest occurrence changes: a
        // streamed delta republishes the same picture many times per second,
        // and rebuilding every id on each republication is pure waste.
        const occurrenceIds = groups.flatMap(group => group.items.map(item => `${group.id}:${item.id}`))
        if (!follow && lastCursor !== null) {
          const previousIds = new Set(observedOccurrenceIds)
          const appended = occurrenceIds.filter(id => !previousIds.has(id)).length
          unread += Math.max(1, appended)
        }
        observedOccurrenceIds = occurrenceIds
        lastCursor = cursor
        if (follow) selectedId = null
      }
      return snapshot()
    },

    onSelect(id: string): FollowSnapshot {
      follow = false
      selectedId = id
      return snapshot()
    },

    onScroll({ atBottom }: RailScrollState): FollowSnapshot {
      if (atBottom) {
        // Reaching the bottom means the user is back at the live edge: the
        // backlog they scrolled past is now behind them, so it must not keep
        // the rail frozen behind a stale "N new" affordance.
        if (selectedId === null) {
          unread = 0
          follow = true
        }
      } else if (follow) {
        follow = false
      }
      return snapshot()
    },

    setFollow(next: boolean): FollowSnapshot {
      if (next) catchUp()
      else follow = false
      return snapshot()
    },

    backToLatest(): FollowSnapshot {
      catchUp()
      return snapshot()
    },

    /** Drop a pinned selection without re-arming follow: closing the inspector keeps the rail where the user left it. */
    clearSelection(): FollowSnapshot {
      selectedId = null
      return snapshot()
    },

    reset(): FollowSnapshot {
      catchUp()
      lastCursor = null
      observedOccurrenceIds = []
      return snapshot()
    },
  }
}
