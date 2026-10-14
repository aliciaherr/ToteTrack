import { describe, expect, it } from 'vitest'
import { MAX_QUOTE_CHARS, MAX_SOURCE_TEXT_CHARS } from '../checks.constants'
import { checkQuotes, verifyQuote } from '../quotes'
import { makePo, SOURCE_TEXT, toteLine } from './fixtures'

describe('verifyQuote', () => {
  it('verifies a quote that is in the text', () => {
    expect(verifyQuote('Example Widgets Co', ['Bill To\nExample Widgets Co\n'])).toBe('verified')
  })

  it('ignores case, whitespace and line breaks', () => {
    expect(verifyQuote('PURCHASE ORDER NO.    :  PO-0001', ['Purchase Order No.: PO-\n0001'])).toBe('verified')
  })

  it('matches across words the text layer split mid-item ("Exam" "ple")', () => {
    expect(verifyQuote('Example Widgets', ['Exam' + 'ple Widgets'])).toBe('verified')
  })

  it('matches a ligature in the text layer', () => {
    expect(verifyQuote('field office', ['ﬁeld office'])).toBe('verified')
  })

  it('returns not_found for an invented value', () => {
    expect(verifyQuote('$9,999.00', SOURCE_TEXT)).toBe('not_found')
  })

  it('returns not_found when one number in a line is changed', () => {
    expect(verifyQuote('275 RECON TOTE 10 $150.00 $1,000.00', SOURCE_TEXT)).toBe('not_found')
  })

  it('returns not_found for an empty quote', () => {
    expect(verifyQuote('', SOURCE_TEXT)).toBe('not_found')
  })

  it('returns unverifiable when there is no source text', () => {
    expect(verifyQuote('anything at all', null)).toBe('unverifiable')
  })

  it('verifies a table row whose cells the text layer lists in another order', () => {
    const page = '60 1 E Tote\n330 Gallon Recon Tote\n$130.00 $7,800.00330 G Tote - Recon'
    expect(verifyQuote('60 1 E Tote 330 G Tote - Recon 330 Gallon Recon Tote $130.00 $7,800.00', [page])).toBe('verified')
  })

  it('verifies a two-column block the text layer interleaves', () => {
    const page = 'EXAMPLE CO EXAMPLE CO\nPO BOX 1 22 Hwy 9\nTestville Shipton'
    expect(verifyQuote('EXAMPLE CO\n22 Hwy 9\nShipton', [page])).toBe('verified')
  })

  it('tolerates one swapped letter in a long word (model "fixed" a typo)', () => {
    expect(verifyQuote('Arlington, TX', ['Arlintgon, TX 76003'])).toBe('verified')
  })

  it('does not tolerate a typo in a number', () => {
    expect(verifyQuote('76030', ['Arlington, TX 76003'])).toBe('not_found')
  })

  it('does not tolerate a typo in a short word', () => {
    expect(verifyQuote('Hwy 8 Dr', ['Hwy 8 Rd'])).toBe('not_found')
  })

  it('returns unverifiable for text over MAX_SOURCE_TEXT_CHARS or a quote over MAX_QUOTE_CHARS', () => {
    expect(verifyQuote('zzz', ['z'.repeat(MAX_SOURCE_TEXT_CHARS + 1)])).toBe('unverifiable')
    expect(verifyQuote('y'.repeat(MAX_QUOTE_CHARS + 1), SOURCE_TEXT)).toBe('unverifiable')
  })

  it('does not match tokens spread across different pages', () => {
    expect(verifyQuote('Shipton 22', ['Shipton', '22'])).toBe('not_found')
  })
})

describe('verifyQuote — numbers match whole', () => {
  it('does not verify $7,800 against $7,800.18', () => {
    expect(verifyQuote('$7,800', ['TOTAL $7,800.18'])).toBe('not_found')
    expect(verifyQuote('TOTAL $7,800', ['TOTAL $7,800.18'])).toBe('not_found')
  })

  it('does not verify PO# 1067 against PO# 10672', () => {
    expect(verifyQuote('PO# 1067', ['PO# 10672'])).toBe('not_found')
    expect(verifyQuote('1067 PO#', ['PO# 10672'])).toBe('not_found')
  })

  it('does not let a fallback number token 30 match inside 300', () => {
    expect(verifyQuote('Tote 30', ['Tote 300'])).toBe('not_found')
    expect(verifyQuote('30 Tote', ['Tote 300'])).toBe('not_found')
  })

  it('does not match a number inside the tail of a longer one (800 in 7,800)', () => {
    expect(verifyQuote('800 Tote', ['Tote 7,800'])).toBe('not_found')
  })

  it('still verifies exact numbers, whole quote or token by token', () => {
    expect(verifyQuote('$7,800.18', ['TOTAL $7,800.18'])).toBe('verified')
    expect(verifyQuote('PO# 10672', ['PO# 10672'])).toBe('verified')
    expect(verifyQuote('30 Tote', ['Tote 30'])).toBe('verified')
    expect(verifyQuote('Total $7,800.', ['Total $7,800.'])).toBe('verified')
  })

  it('treats whitespace on the page as a separator, not part of a number', () => {
    expect(verifyQuote('PO# 1067', ['PO# 1067 2026-01-20'])).toBe('verified')
    expect(verifyQuote('PO# 1067', ['PO#\n1067\n10672'])).toBe('verified')
  })

  it('accepts cents run into the next table cell ($7,800.00330), but not a cut amount', () => {
    expect(verifyQuote('$7,800.00', ['$7,800.00330 G Tote'])).toBe('verified')
    expect(verifyQuote('330 G Tote', ['$7,800.00330 G Tote'])).toBe('verified')
    expect(verifyQuote('$7,800', ['$7,800.00330 G Tote'])).toBe('not_found')
  })
})

describe('checkQuotes', () => {
  it('verifies every quote of a clean PO with no failures', () => {
    const { failures, quotes } = checkQuotes(makePo(), SOURCE_TEXT)
    expect(failures).toEqual([])
    expect(quotes.every((quote) => quote.status === 'verified')).toBe(true)
    expect(quotes.map((quote) => quote.field)).toEqual([
      'poNumberCandidates[0]',
      'customerName',
      'shipToAddress',
      'statedTotal',
      'dates[0]',
      'lines[0]',
    ])
  })

  it('skips a quote whose value is null', () => {
    const { quotes } = checkQuotes(makePo(), SOURCE_TEXT)
    expect(quotes.some((quote) => quote.field === 'billToAddress')).toBe(false)
  })

  it('records a quote_not_found failure for an invented quote', () => {
    const po = makePo({ customerName: { value: 'Invented Corp', quote: 'Invented Corp' } })
    const { failures } = checkQuotes(po, SOURCE_TEXT)
    expect(failures).toEqual([{ check: 'quote_not_found', field: 'customerName', detail: expect.any(String) }])
  })

  it('marks every quote unverifiable, with no failures, for an image (no text)', () => {
    const { failures, quotes } = checkQuotes(makePo(), null)
    expect(failures).toEqual([])
    expect(quotes.length).toBeGreaterThan(0)
    expect(quotes.every((quote) => quote.status === 'unverifiable')).toBe(true)
  })

  it('fails a quote over MAX_QUOTE_CHARS without matching it', () => {
    const long = 'x'.repeat(MAX_QUOTE_CHARS + 1)
    const { failures, quotes } = checkQuotes(makePo({ lines: [toteLine({ quote: long })] }), SOURCE_TEXT)
    expect(failures).toEqual([{ check: 'quote_too_long', field: 'lines[0]', detail: expect.any(String) }])
    expect(quotes.find((quote) => quote.field === 'lines[0]')?.status).toBe('unverifiable')
  })

  it('accepts a quote exactly at MAX_QUOTE_CHARS', () => {
    const exact = 'y'.repeat(MAX_QUOTE_CHARS)
    const { failures } = checkQuotes(makePo({ lines: [toteLine({ quote: exact })] }), [...SOURCE_TEXT, exact])
    expect(failures).toEqual([])
  })

  it('refuses to match a document over MAX_SOURCE_TEXT_CHARS, loudly', () => {
    const huge = ['z'.repeat(MAX_SOURCE_TEXT_CHARS + 1)]
    const { failures, quotes } = checkQuotes(makePo(), huge)
    expect(failures).toEqual([{ check: 'source_text_too_long', field: 'sourceText', detail: expect.any(String) }])
    expect(quotes.every((quote) => quote.status === 'unverifiable')).toBe(true)
  })

  it('caps typo-matching work per document: a crafted input ends not_found, fast (MEDIUM-07)', () => {
    // Every quote word appears only near the end of the page, one letter swapped,
    // so each fuzzy search scans the whole page. Unbudgeted, this took ~5.4 s.
    const quote = Array.from({ length: Math.floor(MAX_QUOTE_CHARS / 6) }, () => 'qwxzj').join(' ')
    const page = '7'.repeat(MAX_SOURCE_TEXT_CHARS - 10) + 'qxwzj'
    const po = makePo({ lines: Array.from({ length: 27 }, () => toteLine({ quote })) })

    const started = Date.now()
    const { quotes } = checkQuotes(po, [page])
    const elapsed = Date.now() - started

    const lineStatuses = quotes.filter((result) => result.field.startsWith('lines')).map((result) => result.status)
    expect(lineStatuses[0]).toBe('verified')
    expect(lineStatuses.at(-1)).toBe('not_found')
    expect(elapsed).toBeLessThan(2_000)
  })

  it('never stores quote text in its results', () => {
    const po = makePo({ customerName: { value: 'Invented Corp', quote: '<b>Invented Corp</b>' } })
    const serialized = JSON.stringify(checkQuotes(po, SOURCE_TEXT))
    expect(serialized).not.toContain('Invented Corp')
    expect(serialized).not.toContain('<b>')
  })
})
