import {
  EXTRACTION_MAX_OUTPUT_TOKENS,
  EXTRACTION_TEMPERATURE,
  EXTRACTION_TIMEOUT_MS,
  OPENROUTER_CHAT_URL,
} from './extraction.constants'
import {
  ExtractionResponseError,
  OpenRouterHttpError,
  OpenRouterTimeoutError,
} from './errors'
import { extractionJsonSchema } from './schema'
import type { ExtractionConfig, ExtractionRequest } from './types'

/** Longest `error.code` carried into our error; codes are short identifiers. */
const MAX_CODE_CHARS = 64
const REDACTED = '[REDACTED]'

/** The strict schema minus `$schema`, which strict structured output rejects. */
function responseSchema(): Record<string, unknown> {
  const { $schema: _omit, ...schema } = extractionJsonSchema as Record<string, unknown>
  void _omit
  return schema
}

/** Builds the JSON body. Pure, so the privacy flags are visible in one place. */
function buildBody(request: ExtractionRequest, config: ExtractionConfig): string {
  return JSON.stringify({
    model: config.model,
    temperature: EXTRACTION_TEMPERATURE,
    // Bounds spend per call when an injected prompt asks for endless output
    // (@security M-05). A reply cut here is rejected, never parsed.
    max_tokens: EXTRACTION_MAX_OUTPUT_TOKENS,
    messages: [
      { role: 'system', content: request.system },
      { role: 'user', content: request.content },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'purchase_order', strict: true, schema: responseSchema() },
    },
    // `zdr: true` is a LITERAL on purpose — never a constant, env var, config
    // field or parameter. Zero data retention is a privacy invariant, not a
    // setting: anything that can switch it off will eventually ship switched
    // off (plan.md, Feature 16 preamble). If no ZDR route exists, OpenRouter
    // errors and we fail loudly — there is no fallback. `require_parameters`
    // stops routing to providers that would ignore the strict schema.
    provider: { zdr: true, require_parameters: true },
  })
}

/** Removes the API key from text that is about to be thrown. */
function scrubSecret(text: string, secret: string): string {
  return secret ? text.split(secret).join(REDACTED) : text
}

/**
 * The HTTP status text plus OpenRouter's `error.code`, if the body carries one.
 *
 * Provider error text is untrusted and can quote request content, so the
 * free-text `error.message` and the raw body are never carried (@security L-B).
 * The API key is still scrubbed in case a code or status text echoes it.
 */
async function readErrorDetail(response: Response, apiKey: string): Promise<string> {
  const status = response.statusText || 'no status text'
  let code: string | null = null
  try {
    const body = (await response.json()) as { error?: { code?: unknown } }
    const raw = body?.error?.code
    if (typeof raw === 'string' || typeof raw === 'number') code = String(raw).slice(0, MAX_CODE_CHARS)
  } catch {
    // Body was not JSON: report the status text alone. The status is the signal.
  }
  return scrubSecret(code === null ? status : `${status} (code ${code})`, apiKey)
}

/**
 * Pulls `choices[0].message.content` and parses it. Never echoes the content.
 * A reply stopped by `max_tokens` (`finish_reason: 'length'`) is rejected
 * before parsing — a cut-off reading must not pass as a complete one.
 */
async function parseCompletion(response: Response, model: string): Promise<unknown> {
  let body: { choices?: Array<{ finish_reason?: unknown; message?: { content?: unknown } }> }
  try {
    body = await response.json()
  } catch (cause) {
    throw new ExtractionResponseError(model, 'response body is not JSON', { cause })
  }
  if (body?.choices?.[0]?.finish_reason === 'length') {
    throw new ExtractionResponseError(model, 'response truncated at max_tokens')
  }
  const content = body?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || content.trim() === '') {
    throw new ExtractionResponseError(model, 'choices[0].message.content is missing or empty')
  }
  try {
    return JSON.parse(content)
  } catch (cause) {
    throw new ExtractionResponseError(model, 'message content is not valid JSON', { cause })
  }
}

/** Sends the request; converts a network failure into a named error. */
async function send(
  request: ExtractionRequest,
  config: ExtractionConfig,
  fetchImpl: typeof fetch,
  signal: AbortSignal
): Promise<Response> {
  try {
    return await fetchImpl(OPENROUTER_CHAT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: buildBody(request, config),
      signal,
    })
  } catch (cause) {
    if (signal.aborted) throw cause
    const raw = cause instanceof Error ? cause.message : String(cause)
    throw new OpenRouterHttpError(0, config.model, `network failure: ${scrubSecret(raw, config.apiKey)}`, { cause })
  }
}

/** Status check plus body read — everything that must finish inside the timeout. */
async function readResponse(response: Response, config: ExtractionConfig): Promise<unknown> {
  if (!response.ok) {
    const detail = await readErrorDetail(response, config.apiKey)
    throw new OpenRouterHttpError(response.status, config.model, detail)
  }
  return parseCompletion(response, config.model)
}

/**
 * Calls OpenRouter once for one document and returns the model's parsed JSON.
 *
 * Every request demands zero data retention (`provider.zdr: true`, hardcoded),
 * caps the answer at `EXTRACTION_MAX_OUTPUT_TOKENS`, and demands strict
 * structured output against `extractionJsonSchema`. Validation of
 * the returned shape with zod is the caller's job.
 *
 * The timeout covers the whole exchange — headers AND body — so a response
 * that stalls mid-body still fails as a timeout instead of hanging until the
 * platform kills the function.
 *
 * @throws OpenRouterTimeoutError after `EXTRACTION_TIMEOUT_MS`.
 * @throws OpenRouterHttpError on non-2xx (status) or network failure (status 0).
 * @throws ExtractionResponseError when the content is missing, not JSON, or
 *   truncated at `EXTRACTION_MAX_OUTPUT_TOKENS`.
 */
export async function callOpenRouter(
  request: ExtractionRequest,
  config: ExtractionConfig,
  fetchImpl: typeof fetch
): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), EXTRACTION_TIMEOUT_MS)
  try {
    const response = await send(request, config, fetchImpl, controller.signal)
    return await readResponse(response, config)
  } catch (cause) {
    if (controller.signal.aborted) {
      throw new OpenRouterTimeoutError(config.model, EXTRACTION_TIMEOUT_MS, { cause })
    }
    throw cause
  } finally {
    clearTimeout(timer)
  }
}
