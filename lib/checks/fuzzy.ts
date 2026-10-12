import { FUZZY_MAX_EDITS } from './checks.constants'

/**
 * True when some substring of `text` is within `FUZZY_MAX_EDITS` edits of
 * `pattern`. An edit is an insertion, deletion, substitution, or a swap of two
 * neighbouring characters ("VITON" ↔ "VTION" is one edit, not two).
 *
 * Sellers' approximate substring search with the optimal-string-alignment
 * swap rule: a column of edit costs per character of `text`, where a match
 * may start anywhere (row 0 is all zeros). Work is pattern × text; callers
 * keep both bounded (`MAX_QUOTE_CHARS`, `MAX_SOURCE_TEXT_CHARS`).
 *
 * @param pattern - The token to look for. Already normalised.
 * @param text - Where to look. Already normalised.
 */
export function containsWithinOneEdit(pattern: string, text: string): boolean {
  const length = pattern.length
  let beforePrevious: number[] = new Array<number>(length + 1).fill(0)
  let previous: number[] = Array.from({ length: length + 1 }, (_, row) => row)
  let current: number[] = new Array<number>(length + 1).fill(0)

  for (let column = 1; column <= text.length; column++) {
    current[0] = 0
    for (let row = 1; row <= length; row++) {
      const substitution = pattern[row - 1] === text[column - 1] ? 0 : 1
      let cost = Math.min(previous[row] + 1, current[row - 1] + 1, previous[row - 1] + substitution)
      const swapped =
        row > 1 &&
        column > 1 &&
        pattern[row - 1] === text[column - 2] &&
        pattern[row - 2] === text[column - 1]
      if (swapped) cost = Math.min(cost, beforePrevious[row - 2] + 1)
      current[row] = cost
    }
    if (current[length] <= FUZZY_MAX_EDITS) return true
    ;[beforePrevious, previous, current] = [previous, current, beforePrevious]
  }
  return false
}
