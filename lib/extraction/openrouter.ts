import {
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

/** Longest slice of OpenRouter's error message carried into our error. */
const MAX_DETAIL_CHARS = 300
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

/** OpenRouter's `error.message` if the body carries one; never the raw body. */
async function readErrorDetail(response: Response, apiKey: string): Promise<string> {
  let message = response.statusText || 'no error message'
  try {
    const body = (await response.json()) as { error?: { message?: unknown } }
    if (typeof body?.error?.message === 'string') message = body.error.message
  } catch {
    // Body was not JSON: keep the status text. The status itself is the signal.
  }
  return scrubSecret(message, apiKey).slice(0, MAX_DETAIL_CHARS)
}

/** Pulls `choices[0].message.content` and parses it. Never echoes the content. */
async function parseCompletion(response: Response, model: string): Promise<unknown> {
  let body: { choices?: Array<{ message?: { content?: unknown } }> }
  try {
    body = await response.json()
  } catch (cause) {
    throw new ExtractionResponseError(model, 'response body is not JSON', { cause })
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
 * Every request demands zero data retention (`provider.zdr: true`, hardcoded)
 * and strict structured output against `extractionJsonSchema`. Validation of
 * the returned shape with zod is the caller's job.
 *
 * The timeout covers the whole exchange — headers AND body — so a response
 * that stalls mid-body still fails as a timeout instead of hanging until the
 * platform kills the function.
 *
 * @throws OpenRouterTimeoutError after `EXTRACTION_TIMEOUT_MS`.
 * @throws OpenRouterHttpError on non-2xx (status) or network failure (status 0).
 * @throws ExtractionResponseError when the content is missing or not JSON.
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
