import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkStatus } from '../observation/fold.ts'
import css from './Watcher.module.css'

function dotState(status: WorkStatus): StateDotState | null {
  if (status === 'running') return 'ongoing'
  if (status === 'waiting') return 'warning'
  if (status === 'failure' || status === 'interrupted') return 'error'
  if (status === 'success') return 'done'
  return null
}

export function StatusMark({ status, className }: { status: WorkStatus; className?: string | undefined }) {
  const state = dotState(status)
  return state === null
    ? <span className={`${css.neutralDot}${className === undefined ? '' : ` ${className}`}`} data-status={status} aria-hidden="true" />
    : <StateDot state={state} size={10} className={className} />
}
