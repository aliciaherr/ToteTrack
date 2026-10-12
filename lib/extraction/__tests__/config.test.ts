// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readExtractionConfig } from '../config'
import { DEFAULT_EXTRACTION_MODEL } from '../extraction.constants'
import { ExtractionConfigError } from '../errors'

// Plain-object envs only: process.env is never read here.
describe('readExtractionConfig', () => {
  it('reads the key and model, trimmed', () => {
    const config = readExtractionConfig({ OPENROUTER_API_KEY: ' test-key ', OPENROUTER_MODEL: ' some/model ' })
    expect(config).toEqual({ apiKey: 'test-key', model: 'some/model' })
  })

  it('falls back to the default model when OPENROUTER_MODEL is unset', () => {
    expect(readExtractionConfig({ OPENROUTER_API_KEY: 'test-key' }).model).toBe(DEFAULT_EXTRACTION_MODEL)
  })

  it('falls back to the default model when OPENROUTER_MODEL is blank', () => {
    const config = readExtractionConfig({ OPENROUTER_API_KEY: 'test-key', OPENROUTER_MODEL: '  ' })
    expect(config.model).toBe(DEFAULT_EXTRACTION_MODEL)
  })

  it('throws ExtractionConfigError naming OPENROUTER_API_KEY when it is missing', () => {
    let caught: unknown
    try {
      readExtractionConfig({})
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(ExtractionConfigError)
    expect((caught as ExtractionConfigError).variable).toBe('OPENROUTER_API_KEY')
    expect((caught as Error).message).toContain('OPENROUTER_API_KEY')
    expect((caught as Error).message).toContain('Vercel')
  })

  it('throws when the key is whitespace only', () => {
    expect(() => readExtractionConfig({ OPENROUTER_API_KEY: '   ' })).toThrow(ExtractionConfigError)
  })
})
