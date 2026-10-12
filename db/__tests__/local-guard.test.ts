import { afterEach, describe, expect, it } from 'vitest'
import { requireLocalDatabaseUrl } from '../local-guard'

const ORIGINAL = process.env.DATABASE_URL

afterEach(() => {
  process.env.DATABASE_URL = ORIGINAL
})

describe('requireLocalDatabaseUrl', () => {
  it('returns a localhost URL unchanged', () => {
    const url = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
    process.env.DATABASE_URL = url
    expect(requireLocalDatabaseUrl('test')).toBe(url)
  })

  it('refuses a Supabase pooler host', () => {
    process.env.DATABASE_URL = 'postgresql://u:p@aws-0-us-east-1.pooler.supabase.com:5432/postgres'
    expect(() => requireLocalDatabaseUrl('test')).toThrow(/REFUSING TO RUN.*pooler\.supabase\.com/)
  })

  it('refuses a host that merely starts with localhost', () => {
    process.env.DATABASE_URL = 'postgresql://u:p@localhost.evil.com:5432/postgres'
    expect(() => requireLocalDatabaseUrl('test')).toThrow(/REFUSING TO RUN/)
  })

  it('throws when DATABASE_URL is unset', () => {
    delete process.env.DATABASE_URL
    expect(() => requireLocalDatabaseUrl('test')).toThrow(/not set/)
  })
})
