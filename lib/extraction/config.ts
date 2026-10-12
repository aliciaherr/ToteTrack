import { DEFAULT_EXTRACTION_MODEL } from './extraction.constants'
import { ExtractionConfigError } from './errors'
import type { EnvLookup, ExtractionConfig } from './types'

/** Reads a required variable, trimmed; missing or blank fails loudly, naming it. */
function requireEnv(env: EnvLookup, name: string): string {
  const value = env[name]?.trim()
  if (!value) {
    throw new ExtractionConfigError(
      name,
      'is missing or empty. Set it in .env and in the Vercel environment; .env.example lists the expected shape.'
    )
  }
  return value
}

/**
 * Resolves the extraction settings from the environment.
 *
 * `OPENROUTER_API_KEY` is required. `OPENROUTER_MODEL` is optional and falls
 * back to `DEFAULT_EXTRACTION_MODEL`, so a model swap needs no code change.
 * Zero data retention is deliberately NOT read here: it is a literal in
 * `openrouter.ts` and cannot be configured (plan.md, Feature 16 preamble).
 *
 * @throws ExtractionConfigError when `OPENROUTER_API_KEY` is missing or blank.
 */
export function readExtractionConfig(env: EnvLookup = process.env): ExtractionConfig {
  const apiKey = requireEnv(env, 'OPENROUTER_API_KEY')
  const model = env.OPENROUTER_MODEL?.trim() || DEFAULT_EXTRACTION_MODEL
  return { apiKey, model }
}
