// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest'
import { callOpenRouter } from '../openrouter'
import { readExtractionConfig } from '../config'
import {
  EXTRACTION_TEMPERATURE,
  EXTRACTION_TIMEOUT_MS,
  OPENROUTER_CHAT_URL,
} from '../extraction.constants'
import { ExtractionResponseError, OpenRouterHttpError, OpenRouterTimeoutError } from '../errors'
import type { ExtractionConfig, ExtractionRequest } from '../types'

// Every fetch below is an injected fake: no test reaches the network.
const config: ExtractionConfig = { apiKey: 'test-key', model: 'test/model' }
const request: ExtractionRequest = {
  system: 'Extract the PO.',
  content: [{ type: 'text', text: 'Invented PO text for tests.' }],
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function completion(content: unknown): Response {
  return jsonResponse({ choices: [{ message: { content } }] })
}

function fakeFetch(response: Response) {
  return vi.fn<typeof fetch>(async () => response)
}

type SentBody = {
  model: string
  temperature: number
  messages: Array<{ role: string; content: unknown }>
  response_format: {
    type: string
    json_schema: { name: string; strict: boolean; schema: Record<string, unknown> }
  }
  provider: { zdr: unknown; require_parameters: unknown }
}

function sent(fetchImpl: ReturnType<typeof fakeFetch>): { url: string; init: RequestInit; body: SentBody } {
  const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
  return { url, init, body: JSON.parse(init.body as string) as SentBody }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('callOpenRouter: request', () => {
  it('sends zdr, require_parameters, a strict schema, the model and the bearer key', async () => {
    const fetchImpl = fakeFetch(completion('{"ok":true}'))
    await callOpenRouter(request, config, fetchImpl)
    const { url, init, body } = sent(fetchImpl)
    const headers = init.headers as Record<string, string>

    expect(url).toBe(OPENROUTER_CHAT_URL)
    expect(init.method).toBe('POST')
    expect(headers.Authorization).toBe('Bearer test-key')
    expect(headers['Content-Type']).toBe('application/json')
    expect(body.provider.zdr).toBe(true)
    expect(body.provider.require_parameters).toBe(true)
    expect(body.model).toBe('test/model')
    expect(body.temperature).toBe(EXTRACTION_TEMPERATURE)
    expect(body.messages).toEqual([
      { role: 'system', content: request.system },
      { role: 'user', content: request.content },
    ])
    expect(body.response_format.type).toBe('json_schema')
    expect(body.response_format.json_schema.name).toBe('purchase_order')
    expect(body.response_format.json_schema.strict).toBe(true)
    expect(body.response_format.json_schema.schema).not.toHaveProperty('$schema')
    expect(body.response_format.json_schema.schema.type).toBe('object')
  })

  it('keeps zdr true no matter what the env or config object says', async () => {
    const fromEnv = readExtractionConfig({
      OPENROUTER_API_KEY: 'test-key',
      OPENROUTER_ZDR: 'false',
      ZDR: 'false',
    })
    const tampered = { ...fromEnv, zdr: false, provider: { zdr: false } } as ExtractionConfig
    const fetchImpl = fakeFetch(completion('{}'))
    await callOpenRouter(request, tampered, fetchImpl)
    expect(sent(fetchImpl).body.provider.zdr).toBe(true)
    expect(fromEnv).not.toHaveProperty('zdr')
  })
})

describe('callOpenRouter: response', () => {
  it('returns the parsed JSON content on 200', async () => {
    const result = await callOpenRouter(request, config, fakeFetch(completion('{"po_number":"A1"}')))
    expect(result).toEqual({ po_number: 'A1' })
  })

  it('throws OpenRouterHttpError with the status and the key scrubbed from the detail', async () => {
    const response = jsonResponse({ error: { message: 'No ZDR route; key test-key rejected' } }, 404)
    const error = await callOpenRouter(request, config, fakeFetch(response)).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(OpenRouterHttpError)
    expect((error as OpenRouterHttpError).status).toBe(404)
    expect((error as Error).message).toContain('No ZDR route')
    expect((error as Error).message).not.toContain('test-key')
  })

  it('truncates a long error detail', async () => {
    const response = jsonResponse({ error: { message: 'x'.repeat(5000) } }, 500)
    const error = await callOpenRouter(request, config, fakeFetch(response)).catch((e: unknown) => e)
    expect((error as Error).message.length).toBeLessThan(500)
  })

  it('wraps a network failure as OpenRouterHttpError status 0 with a cause', async () => {
    const cause = new TypeError('fetch failed')
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw cause
    })
    const error = await callOpenRouter(request, config, fetchImpl).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(OpenRouterHttpError)
    expect((error as OpenRouterHttpError).status).toBe(0)
    expect((error as Error).cause).toBe(cause)
  })

  it('throws OpenRouterTimeoutError when the call outlives the timeout', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        })
    )
    const pending = callOpenRouter(request, config, fetchImpl).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(EXTRACTION_TIMEOUT_MS)
    const error = await pending
    expect(error).toBeInstanceOf(OpenRouterTimeoutError)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('throws OpenRouterTimeoutError when the body stalls after the headers arrive', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      const stalledJson = new Promise<unknown>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
      return { ok: true, status: 200, json: () => stalledJson } as unknown as Response
    })
    const pending = callOpenRouter(request, config, fetchImpl).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(EXTRACTION_TIMEOUT_MS)
    expect(await pending).toBeInstanceOf(OpenRouterTimeoutError)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears the timer after a successful call', async () => {
    vi.useFakeTimers()
    await callOpenRouter(request, config, fakeFetch(completion('{}')))
    expect(vi.getTimerCount()).toBe(0)
  })

  it('throws ExtractionResponseError when the content is not JSON, without echoing it', async () => {
    const response = completion('secret model prose')
    const error = await callOpenRouter(request, config, fakeFetch(response)).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ExtractionResponseError)
    expect((error as Error).message).not.toContain('secret model prose')
  })

  it('throws ExtractionResponseError when the content is missing', async () => {
    const response = jsonResponse({ choices: [] })
    const error = await callOpenRouter(request, config, fakeFetch(response)).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ExtractionResponseError)
  })
})
