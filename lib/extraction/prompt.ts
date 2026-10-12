import { OWN_COMPANY_NAMES } from './extraction.constants'

/**
 * The system prompt for PO extraction (Task 98).
 *
 * Deliberately short: the per-field rules live in the schema's `.describe()`
 * strings (`schema.ts`), which the model receives as the strict
 * `response_format`. This prompt only sets the frame and the two traps found
 * in real POs — the vendor block naming us, and several numbers that look
 * like a PO number. Our names come from `OWN_COMPANY_NAMES`; no customer name
 * ever appears here.
 *
 * @returns The system message text, identical on every call.
 */
export function buildSystemPrompt(): string {
  const ownNames = OWN_COMPANY_NAMES.map((name) => `"${name}"`).join(', ')

  return [
    'You read one purchase order that a customer sent TO a tote (IBC container) supplier, and return what it says as JSON matching the given schema.',
    '',
    'Rules:',
    '- Return only what is printed on the document. Never invent, infer or complete a value.',
    '- Copy every quote exactly as printed, character for character.',
    '- When a value is absent, return null (and an empty quote). Never guess.',
    `- The supplier is our company. It appears in the vendor / seller / supplier block under names such as ${ownNames}. That company is NEVER the customer.`,
    '- The customer is the company that ISSUED the purchase order: the company named in Bill To, else the letterhead. Never a person or buyer code. The ship-to is only where goods are delivered and may be a different company — never the customer.',
    '- List every number that could be a PO or order reference, each with the label printed next to it.',
    '- List every line of the order table that has a description, in document order, including non-tote lines. Skip empty template rows that show only a $0.00 amount.',
    '- Interpret tote types by meaning, following the schema descriptions. Use "unknown" when size or condition cannot be determined.',
    '- Dates on US documents are written month first (MM/DD/YY).',
  ].join('\n')
}
