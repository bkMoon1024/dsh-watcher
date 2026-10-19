import { useState } from 'react'
// @ts-ignore TS7016: no declarations for the local .mjs module
import { clearPricingEditor, effectivePricingText, persistPricingEditor } from '../../insights/pricing.mjs'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import css from '../Insights.module.css'
import { STORAGE, useLimits } from '../insights-shared.tsx'

/** Alert thresholds and the local pricing override, both saved explicitly. */
export function SettingsPrefs({ copy }: { copy: any }) {
  const limits = useLimits()
  const [silence, setSilence] = useState(limits.silenceSeconds)
  const [reasoning, setReasoning] = useState(limits.reasoningSeconds)
  const [saved, setSaved] = useState(false)
  const [overrideText, setOverrideText] = useState(() => effectivePricingText(globalThis.localStorage))
  const [overrideError, setOverrideError] = useState('')
  const [overrideSaved, setOverrideSaved] = useState(false)
  const save = () => {
    localStorage.setItem(STORAGE, JSON.stringify({ silenceSeconds: silence, reasoningSeconds: reasoning }))
    window.dispatchEvent(new CustomEvent('watcher-insights-settings'))
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }
  return (
    <>
      <details className={css.settingsDrawer}>
        <summary className={css.settingsSummary}>{copy.priceOverrideTitle}</summary>
        <div className={css.settingsDrawerContent}>
          <p className={css.priceOverrideHelp}>{copy.priceOverrideHelp}</p>
          <textarea
            className={css.priceOverrideInput}
            rows={8}
            spellCheck={false}
            placeholder={copy.priceOverridePlaceholder}
            value={overrideText}
            onChange={e => setOverrideText(e.target.value)}
            aria-label={copy.priceOverrideTitle}
          />
          {overrideError ? <p className={css.priceOverrideError}>{overrideError}</p> : null}
          <div className={css.priceOverrideActions}>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                try {
                  setOverrideText(persistPricingEditor(overrideText, globalThis.localStorage))
                  window.dispatchEvent(new CustomEvent('watcher-pricing-settings'))
                  setOverrideError('')
                  setOverrideSaved(true)
                  setTimeout(() => setOverrideSaved(false), 2000)
                } catch {
                  setOverrideError(copy.priceOverrideInvalid)
                }
              }}
            >
              {overrideSaved ? copy.priceOverrideSaved : copy.priceOverrideSave}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setOverrideText(clearPricingEditor(globalThis.localStorage))
                window.dispatchEvent(new CustomEvent('watcher-pricing-settings'))
                setOverrideError('')
              }}
            >
              {copy.priceOverrideReset}
            </Button>
          </div>
        </div>
      </details>

      <details className={css.settingsDrawer}>
        <summary className={css.settingsSummary}>异常提醒阈值</summary>
        <div className={css.settingsDrawerContent}>
          <label className={css.settingInlineItem}>
            <span>等多久没字算卡顿:</span>
            <Input type="number" min={5} max={300} value={silence} className={css.settingsMiniInput}
              onChange={e => setSilence(Number(e.target.value))} />
            <span>秒</span>
          </label>
          <label className={css.settingInlineItem}>
            <span>单次推导思考超时:</span>
            <Input type="number" min={10} max={600} value={reasoning} className={css.settingsMiniInput}
              onChange={e => setReasoning(Number(e.target.value))} />
            <span>秒</span>
          </label>
          <Button variant="primary" size="sm" onClick={save}>{saved ? '已保存 ✓' : '保存'}</Button>
        </div>
      </details>
    </>
  )
}
