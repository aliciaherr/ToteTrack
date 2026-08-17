'use client'

import { useEffect } from 'react'
import type { RefObject } from 'react'

/**
 * Moves focus to `target` each time `open` becomes true.
 *
 * Unlike the state resets in `useResetOnChange`, this genuinely belongs in an
 * effect: focusing is a DOM side effect that can only run once the node is
 * committed, so it cannot move into the render phase.
 *
 * Every confirm dialog points this at its Cancel button rather than its
 * destructive button — opening a "delete this?" prompt with the delete action
 * pre-focused invites an accidental Enter.
 *
 * @param open The dialog's open flag, straight from props.
 * @param target The element to focus. Nothing happens if it is unmounted.
 */
export function useFocusOnOpen<T extends HTMLElement>(
  open: boolean,
  target: RefObject<T | null>,
): void {
  useEffect(() => {
    if (open) target.current?.focus()
  }, [open, target])
}
