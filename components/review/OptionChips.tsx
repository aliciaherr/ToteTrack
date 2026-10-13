'use client'

import type { LabelledOption } from '@/lib/review/review-fields.types'

interface OptionChipsProps {
  /** Group name read by assistive tech, e.g. "PO number options". */
  label: string
  options: LabelledOption[]
  /** The field's current value; the matching chip shows as chosen. */
  value: string
  onChoose: (value: string) => void
}

/**
 * Labelled one-tap options for a field the extraction could not settle
 * (Task 118): several PO numbers or dates, each with the label the document
 * printed beside it. None is chosen at start, because the field starts blank;
 * a tap fills the field. Labels are document text, rendered as text (L-D).
 */
export default function OptionChips({ label, options, value, onChoose }: OptionChipsProps) {
  if (options.length === 0) return null
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((option) => {
        const isChosen = option.value === value
        return (
          <button
            key={option.path}
            type="button"
            aria-pressed={isChosen}
            onClick={() => onChoose(option.value)}
            className={`min-h-[44px] rounded-md border px-3 py-1 text-left text-sm ${
              isChosen ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-foreground'
            }`}
          >
            <span className="block font-medium">{option.value}</span>
            {option.label && <span className="block text-xs opacity-80">{option.label}</span>}
          </button>
        )
      })}
    </div>
  )
}
