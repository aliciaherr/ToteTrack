import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { ACCEPTED_MIME_TYPES, PO_DOCUMENTS_BUCKET } from '../ingest.constants'
import { MAX_ATTACHMENT_BYTES } from '../limits.constants'

// HIGH-03. Every candidate `selectCandidates` admits must be storable, or its
// upload fails on every run and pins the watermark (Task 100 throws on upload
// failure). The bucket's rules live in SQL migrations, so this replays them as
// text, in order, and checks the final values against the ingestion constants.

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../db/migrations')
const MIGRATION_FILE = /^\d{4}_.+\.sql$/

function executedSql(file: string): string {
  return readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
}

interface BucketRules {
  fileSizeLimit: number | null
  allowedMimeTypes: string[] | null
}

/** The bucket's rules after every migration, read from 0003's INSERT and any later UPDATE. */
function finalBucketRules(): BucketRules {
  const rules: BucketRules = { fileSizeLimit: null, allowedMimeTypes: null }
  const files = readdirSync(MIGRATIONS_DIR).filter((file) => MIGRATION_FILE.test(file)).sort()
  for (const file of files) {
    const sql = executedSql(file)
    const inserted = sql.match(
      new RegExp(`\\('${PO_DOCUMENTS_BUCKET}', '${PO_DOCUMENTS_BUCKET}', \\w+, (\\d+), ARRAY\\[([^\\]]*)\\]\\)`)
    )
    if (inserted) {
      rules.fileSizeLimit = Number(inserted[1])
      rules.allowedMimeTypes = [...inserted[2].matchAll(/'([^']+)'/g)].map((match) => match[1])
    }
    const bucketUpdate = new RegExp(`UPDATE storage\\.buckets SET ([^;]*) WHERE id = '${PO_DOCUMENTS_BUCKET}'`)
    const updated = sql.match(bucketUpdate)?.[1]
    if (!updated) continue
    const limit = updated.match(/file_size_limit = (\d+)/)
    if (limit) rules.fileSizeLimit = Number(limit[1])
    if (/allowed_mime_types/.test(updated)) {
      throw new Error(`${file} changes allowed_mime_types; extend this test to read it`)
    }
  }
  return rules
}

describe('po-documents bucket rules vs the ingestion constants', () => {
  const rules = finalBucketRules()

  it('stores every attachment the ingestion cap admits', () => {
    expect(rules.fileSizeLimit).not.toBeNull()
    expect(MAX_ATTACHMENT_BYTES).toBeLessThanOrEqual(rules.fileSizeLimit as number)
  })

  it('accepts exactly the content types ingestion uploads', () => {
    expect([...(rules.allowedMimeTypes ?? [])].sort()).toEqual([...ACCEPTED_MIME_TYPES].sort())
  })

  it('fails when the bucket limit is below the cap (0003 alone)', () => {
    const original = executedSql('0003_storage_buckets.sql').match(/'po-documents', false, (\d+)/)

    expect(Number(original?.[1])).toBeLessThan(MAX_ATTACHMENT_BYTES)
  })
})
