import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

// CONSTRAINT-38. The Supabase secret key bypasses RLS, so exactly one module
// may read it. This walks every source file in the repository and fails if
// any other one names the variable. Test files are skipped: they stub the
// variable to exercise the module, which is not reading the key.

const REPO_ROOT = path.resolve(__dirname, '../../..')
const ALLOWED_FILE = path.join('lib', 'storage', 'po-documents.ts')
const VARIABLE = ['SUPABASE', 'SECRET', 'KEY'].join('_')
const SOURCE_FILE = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/
const TEST_FILE = /\.test\.(?:ts|tsx)$/
const SKIPPED_DIRECTORIES = new Set(['node_modules', '.next', '.git', '.vercel', 'supabase', 'coverage'])

function sourceFiles(directory: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) files.push(...sourceFiles(path.join(directory, entry.name)))
    } else if (SOURCE_FILE.test(entry.name) && !TEST_FILE.test(entry.name)) {
      files.push(path.join(directory, entry.name))
    }
  }
  return files
}

describe('CONSTRAINT-38 — secret key confinement', () => {
  const files = sourceFiles(REPO_ROOT).map((file) => path.relative(REPO_ROOT, file))

  it('finds the storage module, so the walk is really covering source', () => {
    expect(files).toContain(ALLOWED_FILE)
  })

  it('no source file but lib/storage/po-documents.ts names the secret key', () => {
    const offenders = files.filter(
      (file) => file !== ALLOWED_FILE && readFileSync(path.join(REPO_ROOT, file), 'utf8').includes(VARIABLE),
    )
    expect(offenders).toEqual([])
  })
})
