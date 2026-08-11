'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
  FLY_RESET_MS,
  resolveTapAction,
  type ArmedCard,
  type TapTarget,
} from './armPlacement'
import type { DropTarget, UnscheduleTarget } from './calendarDnd'

export interface ArmModeValue {
  /** The long-pressed card awaiting a destination tap, or null. */
  armed: ArmedCard | null
  /** Card id whose next layout change should animate as a flight, or null. */
  flyingId: string | null
  /** Arms a card. Long-press only — never wired to a click. */
  arm: (card: ArmedCard) => void
  /** Disarms without writing. The root layout fires this for unclaimed taps. */
  cancel: () => void
  /** Routes a tap that landed on a placement target. No-op while nothing is armed. */
  tap: (target: TapTarget) => void
}

/**
 * Inert default so cards render outside a calendar — the dialog, the dashboard
 * widget and the existing card tests all do — without arming ever engaging.
 */
const INERT: ArmModeValue = {
  armed: null,
  flyingId: null,
  arm: () => {},
  cancel: () => {},
  tap: () => {},
}

const ArmModeContext = createContext<ArmModeValue>(INERT)

export const ArmModeProvider = ArmModeContext.Provider

/** The calendar's arm-mode state. Inert outside an {@link ArmModeProvider}. */
export function useArmMode(): ArmModeValue {
  return useContext(ArmModeContext)
}

/**
 * Owns Task 68's long-press-to-arm state: which card is armed, and what a tap
 * does while one is.
 *
 * Same context-over-props reasoning as `cardSelection.tsx` — the tap surfaces
 * (cards, column bodies, the callout pill) sit at different depths under
 * `CalendarLayout`, and every one of them needs the same three handlers.
 *
 * Placement reuses the drag path's mutations verbatim: `resolveTapAction`
 * produces the same `DropTarget` a drop would have, so the server cannot tell
 * a tap from a drag (CONSTRAINT-19's invariants hold unchanged). A resolved
 * placement also marks the card as "flying" for {@link FLY_RESET_MS}, which
 * the card wrapper turns into a framer-motion layout flight once the
 * refreshed server data moves it — unless reduced motion is on, in which case
 * the card simply appears in place.
 *
 * **Dispatch is by group and nothing else.** Both callbacks take a target that
 * carries its own `group`, so this hook never chooses between an order and a
 * pickup mutation — `useGroupedPlacement` does, from the same discriminator the
 * drag path uses (CONSTRAINT-25). A cross-group tap never reaches either
 * callback: `resolveTapAction` has already turned it into `cancel`.
 *
 * @param place The drag path's placement mutation, from `useGroupedPlacement`.
 * @param unschedule The drag path's clear mutation, same source.
 * @param shouldReduceMotion Disables the fly animation, not the arm state.
 */
export function useArmModeState(
  place: (target: DropTarget) => void,
  unschedule: (target: UnscheduleTarget) => void,
  shouldReduceMotion: boolean,
): ArmModeValue {
  const [armed, setArmed] = useState<ArmedCard | null>(null)
  const [flyingId, setFlyingId] = useState<string | null>(null)
  const flyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (flyTimerRef.current !== null) clearTimeout(flyTimerRef.current)
    },
    [],
  )

  const arm = useCallback((card: ArmedCard) => setArmed(card), [])
  const cancel = useCallback(() => setArmed(null), [])

  const beginFlight = useCallback(
    (cardId: string) => {
      if (shouldReduceMotion) return
      if (flyTimerRef.current !== null) clearTimeout(flyTimerRef.current)
      setFlyingId(cardId)
      flyTimerRef.current = setTimeout(() => {
        flyTimerRef.current = null
        setFlyingId(null)
      }, FLY_RESET_MS)
    },
    [shouldReduceMotion],
  )

  const tap = useCallback(
    (target: TapTarget) => {
      if (armed === null) return
      setArmed(null)

      const action = resolveTapAction(armed, target)
      if (action.kind === 'cancel') return
      if (action.kind === 'unschedule') {
        unschedule(action.target)
        return
      }
      beginFlight(action.target.cardId)
      place(action.target)
    },
    [armed, place, unschedule, beginFlight],
  )

  return useMemo(
    () => ({ armed, flyingId, arm, cancel, tap }),
    [armed, flyingId, arm, cancel, tap],
  )
}
