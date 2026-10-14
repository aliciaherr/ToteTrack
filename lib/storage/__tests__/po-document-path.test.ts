import { describe, it, expect } from 'vitest'
import { isInboundDocumentPath } from '../po-document-path'

describe('isInboundDocumentPath', () => {
  it.each(['inbound/a.pdf', 'inbound/2026/10/abc123-po.png', 'inbound/file..name.pdf'])('accepts %s', (value) => {
    expect(isInboundDocumentPath(value)).toBe(true)
  })

  it.each([
    ['empty', ''],
    ['the folder alone', 'inbound/'],
    ['another folder', 'outbound/a.pdf'],
    ['a prefix look-alike', 'inbound-old/a.pdf'],
    ['a leading slash', '/inbound/a.pdf'],
    ['a traversal', 'inbound/../secret.pdf'],
    ['a nested traversal', 'inbound/a/../../b.pdf'],
    ['a dot segment', 'inbound/./a.pdf'],
    ['an empty segment', 'inbound//a.pdf'],
    ['a trailing slash', 'inbound/a/'],
    ['a backslash', 'inbound\\a.pdf'],
    ['a backslash traversal', 'inbound/..\\secret.pdf'],
    ['an https URL', 'https://evil.example.com/inbound/a.pdf'],
    ['a scheme on an inbound key', 'inbound:/a.pdf'],
    ['a NUL byte', 'inbound/a.pdf\u0000.png'],
  ])('refuses %s', (_label, value) => {
    expect(isInboundDocumentPath(value)).toBe(false)
  })

  it.each([null, undefined, 42, {}])('refuses the non-string %s', (value) => {
    expect(isInboundDocumentPath(value)).toBe(false)
  })
})
