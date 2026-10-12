import { z } from 'zod'
import { TOTE_TYPES } from './extraction.constants'

/**
 * The extraction contract: one zod schema that both validates the model's
 * response and — via `extractionJsonSchema` — is sent to the model as its
 * strict `response_format`. One source, so the two cannot drift.
 *
 * Strict structured output requires every key present, so absence is `null`
 * (`.nullable()`), never an omitted key (`.optional()`).
 *
 * The `.describe()` strings ARE the field instructions the model reads. They
 * were written against the first four real POs (plan.md Task 98) — edit them
 * when a real document is misread, and keep them free of customer names.
 */

const quote = z
  .string()
  .describe('The exact text from the document this value was read from, copied character for character. Empty string only when value is null.')

/** A single value plus the document text it was read from. */
function quoted<T extends z.ZodTypeAny>(value: T, description: string) {
  return z.object({ value: value.nullable().describe(description), quote })
}

const toteType = z
  .enum([...TOTE_TYPES, 'unknown'])
  .describe(
    [
      'Which of six tote types this line orders: size 275 or 330 (gallons; may be written "275", "275GAL", "275 G", "275 GAL") and condition Recon, Rebottled or New.',
      'Recon may appear as RECON, REC, Reconditioned. Rebottled may appear as REB, REBOT, Rebottled. New may appear as NEW.',
      'These are examples, not a complete list — interpret other abbreviations and spellings by meaning.',
      'Ignore extra descriptors that do not change size or condition, such as "Limited Use", "NAT", "IBC", valve or bung specifications.',
      'Use "unknown" when size or condition cannot be determined. Never guess.',
    ].join(' ')
  )

const line = z.object({
  kind: z
    .enum(['tote', 'other'])
    .describe('"tote" for a line ordering totes/IBCs. "other" for anything else: service notes, accruals, freight, fees, driver instructions.'),
  toteType: toteType.nullable().describe('Required for kind "tote"; null for kind "other".'),
  quantity: z.number().nullable().describe('Units ordered on this line, as a number. Null if not stated.'),
  unitPrice: z.number().nullable().describe('Price per unit in dollars, as a number. Null if not stated.'),
  lineTotal: z.number().nullable().describe('The line amount in dollars as printed, as a number. Null if not stated.'),
  quote: z.string().describe('The full line text from the document, including the description, copied exactly.'),
})

const labelledDate = z.object({
  value: z.string().describe('The date normalised to YYYY-MM-DD. US documents write month first (MM/DD/YY).'),
  label: z.string().describe('The label printed next to the date, e.g. "Order Date", "Need Date", "Ship Date".'),
  role: z
    .enum(['order', 'delivery', 'other'])
    .describe(
      '"delivery" for when the goods are wanted or shipped: Delivery Date, Sched. Delivery Date, Need Date, Required By, Expected, Ship Date. "order" for when the PO was issued: Order Date, P.O. Date, Date. "other" for anything else.'
    ),
  quote: z.string().describe('The exact date text as printed.'),
})

const poNumberCandidate = z.object({
  value: z.string(),
  label: z.string().describe('The label printed next to the number, e.g. "Purchase Order No.", "Number", "CUST PO", "REF#".'),
  quote: z.string(),
})

/** The full reading of one purchase-order document. */
export const extractedPoSchema = z.object({
  isPurchaseOrder: z
    .boolean()
    .describe('True if this document is a purchase order. False for anything else (invoice, quote, newsletter, reply with no order).'),
  poNumberCandidates: z
    .array(poNumberCandidate)
    .describe(
      "Every number on the document that could be a PO or order reference, each with its label. The issuer's own PO number is usually in the header; numbers inside a line description (such as an end customer's PO) or reference numbers must still be listed, with their own labels."
    ),
  customerName: quoted(
    z.string(),
    'The company that ISSUED and PAYS for this purchase order. Use the company name in the Bill To block; if there is none, the company in the letterhead or logo. Never a person, initials or a buyer code. The vendor/supplier block names the seller and is NEVER the customer. The Ship-To block is only the delivery location, often a different company (the end customer of a distributor), and is NEVER the customer.'
  ),
  shipToAddress: quoted(z.string(), 'The full ship-to / delivery address, as one string. Null if none is printed.'),
  billToAddress: quoted(z.string(), 'The full bill-to address, as one string. Null if none is printed.'),
  dates: z.array(labelledDate).describe('Every labelled date on the document. Omit unlabelled or blank date fields.'),
  statedTotal: quoted(z.number(), 'The document grand total in dollars, as printed. Null if none.'),
  lines: z.array(line).describe('Every line in the order table that has a description, in document order, including non-tote lines and lines priced at $0. Skip rows with no description — rows showing only a $0.00 amount are empty template rows, not lines.'),
})

export type ExtractedPo = z.infer<typeof extractedPoSchema>
export type ExtractedLine = ExtractedPo['lines'][number]
export type ExtractedDate = ExtractedPo['dates'][number]
export type ToteType = (typeof TOTE_TYPES)[number]

/** Sent to OpenRouter as the strict `json_schema` response format. */
export const extractionJsonSchema = z.toJSONSchema(extractedPoSchema, { target: 'draft-7' })
