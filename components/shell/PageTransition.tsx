'use client'

import { motion, useReducedMotion } from 'framer-motion'
import type { ReactNode } from 'react'
import { pageVariants } from '@/lib/animations'

interface PageTransitionProps {
  children: ReactNode
}

/**
 * Wraps each screen's content with a mount-enter animation: fade + 4px upward
 * slide, 200ms ease-out. Honours `useReducedMotion()` — when the OS requests
 * reduced motion, the wrapper passes `undefined` variants so Framer Motion
 * renders the content instantly at its final position.
 */
export default function PageTransition({ children }: PageTransitionProps) {
  const shouldReduceMotion = useReducedMotion()
  return (
    <motion.div
      variants={shouldReduceMotion ? undefined : pageVariants}
      initial="hidden"
      animate="visible"
      className="h-full"
    >
      {children}
    </motion.div>
  )
}
