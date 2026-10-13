/**
 * Bounds for drawing PDFs in the review overlay (Task 117). The page count
 * reuses extraction's `MAX_PDF_PAGES`.
 */

/**
 * Page size in CSS pixels relative to 72 dpi, before the device pixel ratio.
 * 1.5 draws a US Letter page ~920 px wide: sharp in the half-screen pane and
 * still legible when zoomed in the expanded view.
 */
export const PDF_VIEW_SCALE = 1.5

/**
 * Most device pixels one page canvas may hold. 8M px ≈ 32 MB; five pages stay
 * well inside iPad Safari's total canvas memory. A bigger page is drawn smaller,
 * never refused: this is a view, not the extraction render.
 */
export const MAX_PDF_VIEW_PIXELS = 8_000_000

/** Bytes per canvas pixel (RGBA). */
const BYTES_PER_PIXEL = 4

/**
 * Largest scratch canvas pdf.js may create for patterns, groups and masks
 * (LOW-T117-2). pdf.js's default is unlimited; same budget as one page canvas.
 */
export const MAX_PDF_SCRATCH_CANVAS_BYTES = MAX_PDF_VIEW_PIXELS * BYTES_PER_PIXEL
