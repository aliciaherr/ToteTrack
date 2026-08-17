'use client'

import { useState } from 'react'

/**
 * Runs `reset` during render, at the moment `value`'s identity changes.
 *
 * This is React's documented "adjusting state when a prop changes" pattern.
 * The obvious alternative — `useEffect(reset, [value])` — commits a render
 * with the stale state first and then immediately re-renders, which is both a
 * wasted commit and what `react-hooks/set-state-in-effect` flags. Adjusting
 * during render means React discards the in-progress output and re-renders
 * before committing, so the stale state is never shown.
 *
 * `reset` must only call setters belonging to the calling component; that is
 * the single case where React permits `setState` during render.
 *
 * Comparison is by `Object.is` identity, not deep equality — a caller passing
 * a freshly-built array or object on every render would fire `reset` on every
 * render. Pass a value that is referentially stable between real changes.
 *
 * @param value Any value whose identity change means "the caller moved on".
 * @param reset Called during the render in which the change is first observed.
 */
export function useResetOnChange<T>(value: T, reset: () => void): void {
  const [previous, setPrevious] = useState<T>(value)
  if (!Object.is(previous, value)) {
    setPrevious(value)
    reset()
  }
}

/**
 * Runs `reset` when `open` flips `true` → `false`, i.e. as a panel closes.
 *
 * Every confirm dialog in the app stays mounted while closed (the parent keeps
 * rendering it with `open={false}`), so per-open state — inline server errors,
 * an in-flight submit flag, a duplicate-record warning — survives a close and
 * would still be on screen the next time the dialog opens. Clearing it as the
 * dialog closes is load-bearing, not cosmetic: `ConvertLeadDialog` derives its
 * confirm button's force-flag from a warning, so a stale warning would leave
 * the button pre-armed.
 *
 * Opening does not call `reset` — only closing does.
 *
 * @param open The dialog's open flag, straight from props.
 * @param reset Clears the calling component's per-open state.
 */
export function useResetOnClose(open: boolean, reset: () => void): void {
  useResetOnChange(open, () => {
    if (!open) reset()
  })
}
