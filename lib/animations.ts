/**
 * Central Framer Motion variant constants for ToteTrack. Pure plain objects
 * only — no functions, no logic, no imports from React or framer-motion
 * (CQ-01 / Task 28 spec). Reduced-motion handling is applied at every call
 * site via `useReducedMotion()` + `variants={shouldReduceMotion ? undefined
 * : xxxVariants}`; this file does not know about motion preferences.
 */

const EASE_OUT = 'easeOut' as const
const EASE_IN = 'easeIn' as const
const EASE_IN_OUT = 'easeInOut' as const

// Page enter: fade + 4px upward slide, 200ms ease-out.
export const pageVariants = {
  hidden: { opacity: 0, y: 4 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.2, ease: EASE_OUT },
  },
}

// Modal: backdrop opacity 0→1 (180ms out / 130ms in);
// panel scale 0.97→1 + opacity (180ms out / 130ms in).
export const modalVariants = {
  backdrop: {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { duration: 0.18, ease: EASE_OUT } },
    exit: { opacity: 0, transition: { duration: 0.13, ease: EASE_IN } },
  },
  panel: {
    hidden: { opacity: 0, scale: 0.97 },
    visible: {
      opacity: 1,
      scale: 1,
      transition: { duration: 0.18, ease: EASE_OUT },
    },
    exit: {
      opacity: 0,
      scale: 0.97,
      transition: { duration: 0.13, ease: EASE_IN },
    },
  },
}

// Cancel / dismiss exit: opacity 1→0 + y 0→2, 150ms ease-in.
export const cancelVariants = {
  initial: { opacity: 1, y: 0 },
  exit: {
    opacity: 0,
    y: 2,
    transition: { duration: 0.15, ease: EASE_IN },
  },
}

// List container: orchestrates staggered child entry.
// Spec: items 1-8 at 30ms stagger; index >= 8 appear together. The
// `staggerChildren: 0.03` covers items 1-8; per-item `delay: 0` overrides
// (applied at the call site by the list renderer) handle the >= 8 cutoff.
export const staggerContainer = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.03 } },
}

// List item: fade-in, 150ms ease-out.
export const staggerItem = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: 0.15, ease: EASE_OUT },
  },
}

// Collapsible: height expand/collapse, 200ms ease-in-out.
export const collapsibleVariants = {
  collapsed: { height: 0, opacity: 0 },
  expanded: {
    height: 'auto' as const,
    opacity: 1,
    transition: { duration: 0.2, ease: EASE_IN_OUT },
  },
  exit: {
    height: 0,
    opacity: 0,
    transition: { duration: 0.2, ease: EASE_IN_OUT },
  },
}

// Toast: slide in from top-right (x: 100%→0), 250ms ease-out;
// fade out on auto-dismiss, 200ms ease-out. Spec: design-decisions.md
// Animation Specs table, "Success / complete" row.
export const toastVariants = {
  hidden: { opacity: 0, x: '100%' },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.25, ease: EASE_OUT },
  },
  exit: {
    opacity: 0,
    transition: { duration: 0.2, ease: EASE_OUT },
  },
}

// Speed-dial FAB: 45° rotation when expanded ("+" → "×"), 150ms ease-in-out.
export const speedDialFabVariants = {
  closed: { rotate: 0, transition: { duration: 0.15, ease: EASE_IN_OUT } },
  open: { rotate: 45, transition: { duration: 0.15, ease: EASE_IN_OUT } },
}

// Speed-dial container: orchestrates per-option staggered entry/exit.
// 30ms stagger between options. Reverse direction so the option closest to
// the FAB animates first on open (bottom-up fan), matching the visual
// "fan upward" intent in PRD Feature 8.
export const speedDialContainerVariants = {
  closed: { transition: { staggerChildren: 0.03, staggerDirection: -1 } },
  open: { transition: { staggerChildren: 0.03, staggerDirection: -1 } },
}

// Speed-dial option: scale 0.8→1 + upward translate 8px→0, 150ms ease-out.
// Reverse on close (130ms ease-in).
export const speedDialOptionVariants = {
  closed: {
    opacity: 0,
    scale: 0.8,
    y: 8,
    transition: { duration: 0.13, ease: EASE_IN },
  },
  open: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { duration: 0.15, ease: EASE_OUT },
  },
}
