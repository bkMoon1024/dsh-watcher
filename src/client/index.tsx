import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { loadCompleteHistory } from '../hub/history.ts'
import { Watcher, type WatcherInjected } from './Watcher.tsx'
import { registerModelTraceDefinition } from './model-trace-definition.ts'
import { InsightsSettings } from './InsightsSettings.tsx'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'

export const name = 'dsh-watcher-client'
export const inject = ['slots', 'sessions', 'uiConversation']

/**
 * Native session-header utility. Order 50 sits after Session log (0)
 * and before the files-panel toggle (110). No overlay glyph.
 */
export function apply(ctx: ClientContext) {
  registerModelTraceDefinition(ctx)
  ctx.inject(['remote', 'remote.session'], c => {
    c.slots.inject('settings.section', () => c.slots.register({
      name: 'settings.section', id: 'watcher-insights', order: 85,
      label: 'Watcher', inject: () => ({ remote: c.remote }),
    }, InsightsSettings))
  })
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'dsh-watcher',
    order: 50,
    label: 'Watcher',
    inject: (sessionId: SessionId): WatcherInjected => {
      // Workspace Host provides ISessions.binding(); keep runtime behavior.
      const session = (ctx.sessions as any).binding?.(sessionId)?.session as
        | { loadOlder: () => Promise<void>; getSnapshot: () => { hasMore: boolean; loadingOlder: boolean } }
        | undefined
      if (session === undefined) {
        // A header can render before its session binding exists (restore, cold
        // start, closing window). Throwing here would escape into React's render
        // path, so degrade to a read-only placeholder instead.
        return {
          loadOlderPage: () => Promise.resolve(),
          loadAllHistory: async () => ({ kind: 'blocked', pages: 0, reason: 'busy' }),
        }
      }
      return {
        // One page at a time, so a long session can be walked backwards
        // without committing to the whole history (or hitting its page limit).
        loadOlderPage: () => session.loadOlder(),
        loadAllHistory: signal => loadCompleteHistory({
          signal,
          loadOlder: () => session.loadOlder(),
          read: () => {
            const sessionSnapshot = session.getSnapshot()
            const conversation = ctx.uiConversation.binding(sessionId).snapshot.getSnapshot()
            const chat = conversation.views.get('chat')
            if (chat === undefined) throw new Error('dsh-watcher: Chat conversation target is unavailable')
            const firstNode = chat.legacy.nodes[0]
            const firstTurn = chat.timeline.turnOrder[0]
            return {
              hasMore: sessionSnapshot.hasMore,
              loadingOlder: sessionSnapshot.loadingOlder,
              headKey: `${firstTurn ?? 'none'}:${firstNode?.seq ?? 'none'}:${chat.legacy.nodes.length}`,
            }
          },
        }),
      }
    },
  }, Watcher))
}
