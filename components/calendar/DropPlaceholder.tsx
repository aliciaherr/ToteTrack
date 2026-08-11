'use client'

/**
 * Where the card will land if released now.
 *
 * The dragged card's own slot is the one the sortable strategy moves to the
 * insertion point, so replacing its contents with an accent outline turns that
 * slot into a live drop indicator that tracks the cursor. The card itself is
 * still visible — `DragOverlay` renders a clone following the pointer — so
 * nothing disappears; the original just stops pretending to be in its old place.
 *
 * Without this the source card sat faded in its original position while the
 * gap opened elsewhere, which is what made drops feel like guesswork.
 *
 * Shared by both card wrappers rather than duplicated: the placeholder is the
 * one piece of drag feedback that must look identical across the two groups, so
 * that a slot opening in the pickups list reads as the same promise a slot in
 * the orders list makes (CONSTRAINT-25).
 */
export default function DropPlaceholder() {
  return (
    <div
      data-testid="drop-placeholder"
      aria-hidden="true"
      className="rounded-md border-2 border-dashed border-primary bg-primary/5"
      style={{ height: 'var(--card-h)' }}
    />
  )
}
