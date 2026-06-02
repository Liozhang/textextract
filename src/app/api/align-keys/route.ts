import { NextRequest } from 'next/server'
import OpenAI from 'openai'

export const maxDuration = 300

import {
  collectFieldPaths,
  applyFlattenedSchemaToResults,
} from '@/lib/pipeline/schema-flattener'
import { KEY_ALIGN_SYSTEM_MESSAGE } from '@/lib/pipeline/prompts'
import { parseJsonResponse } from '@/lib/pipeline/json-parser'
import { isReasoningModel, supportsJsonResponseFormat } from '@/lib/merge-utils'
import { isPrivateHost, sseEvent, workerPool } from '@/lib/api-utils'
import type { PerFileResult, FieldPathInfo, FlattenedSchema, FlattenRule } from '@/lib/pipeline/types'

// ─── Types ──────────────────────────────────────────────────────────────────

interface AlignKeysRequestBody {
  extractionData: PerFileResult[]
  referenceKeys?: string[]
  referenceText?: string
  prompts?: {
    keyAlign?: string
  }
}

// ─── Infer flatten rule from type ────────────────────────────────────────────

function inferRule(type: string): FlattenRule {
  switch (type) {
    case 'measurement': return 'measurement'
    case 'array': return 'join_comma'
    default: return 'leaf'
  }
}

// ─── Parse AI response into field_mapping + field_order + field_actions ───

function parseAlignResult(
  parsed: unknown,
  fieldPaths: FieldPathInfo[],
): { fieldMapping: Record<string, string>; fieldOrder: string[]; fieldActions: Record<string, string>; flattenRules: Record<string, FlattenRule> } {
  let fieldMapping: Record<string, string> = {}
  let fieldOrder: string[] = []
  let fieldActions: Record<string, string> = {}

  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>
    if (obj.field_mapping && typeof obj.field_mapping === 'object') {
      fieldMapping = obj.field_mapping as Record<string, string>
    }
    if (Array.isArray(obj.field_order)) {
      fieldOrder = (obj.field_order as string[]).filter((v) => typeof v === 'string')
    }
    if (obj.field_actions && typeof obj.field_actions === 'object') {
      fieldActions = obj.field_actions as Record<string, string>
    }
  }

  // Ensure every field path has a mapping (identity fallback)
  for (const fp of fieldPaths) {
    if (!fieldMapping[fp.path]) {
      fieldMapping[fp.path] = fp.path
    }
  }

  // Build flatten rules
  const flattenRules: Record<string, FlattenRule> = {}
  for (const fp of fieldPaths) {
    flattenRules[fp.path] = inferRule(fp.type)
  }

  // Deduplicate headers
  const allCanonical = new Set(Object.values(fieldMapping))
  const headers: string[] = []
  const seen = new Set<string>()
  for (const name of fieldOrder) {
    if (!seen.has(name) && allCanonical.has(name)) {
      headers.push(name)
      seen.add(name)
    }
  }
  for (const canonical of allCanonical) {
    if (!seen.has(canonical)) {
      headers.push(canonical)
    }
  }

  return { fieldMapping, fieldOrder: headers, fieldActions, flattenRules }
}

// ─── POST handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const abortController = new AbortController()

  try {
    const body: AlignKeysRequestBody = await request.json()
    const { extractionData, referenceKeys, referenceText, prompts: customPrompts } = body

    if (!extractionData || extractionData.length === 0) {
      return new Response(JSON.stringify({ error: 'No extraction data' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const baseUrl = (process.env.API_BASE_URL || '').trim()
    const apiKey = (process.env.API_KEY || '').trim()
    const model = (process.env.API_MODEL || '').trim()

    if (!baseUrl || !apiKey || !model) {
      return new Response(JSON.stringify({ error: 'API settings incomplete' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (isPrivateHost(baseUrl)) {
      return new Response(JSON.stringify({ error: 'Private host not allowed' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const openai = new OpenAI({ baseURL: baseUrl, apiKey })
    const effectivePrompt = customPrompts?.keyAlign || KEY_ALIGN_SYSTEM_MESSAGE
    const baseTimeout = Number(process.env.API_TIMEOUT) || 120_000
    const perCallTimeout = Math.min(600_000, baseTimeout)

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder()

        function send(event: string, data: unknown) {
          try {
            if (!abortController.signal.aborted) {
              controller.enqueue(encoder.encode(sseEvent(event, data)))
            }
          } catch {
            // Client disconnected
          }
        }

        try {
          // Phase 1: Collect field paths
          send('phase', { phase: 'collecting' })
          const fieldPaths = collectFieldPaths(extractionData)

          // Phase 2: AI alignment with retry
          send('phase', { phase: 'aligning' })

          // Build user message with field paths + optional reference
          const fieldsSection = fieldPaths
            .map((fp) => JSON.stringify({
              path: fp.path,
              count: fp.count,
              sample_values: fp.sampleValues,
              type: fp.type,
            }))
            .join(',\n  ')

          let userMessage = `以下是 ${fieldPaths.length} 个不同字段路径的统计信息，请进行语义归一和字段排序。\n\n{\n  "fields": [\n  ${fieldsSection}\n  ]\n}`

          if (referenceKeys && referenceKeys.length > 0) {
            userMessage += `\n\n# 用户指定的参考键名（优先使用这些作为规范键名）\n${referenceKeys.map((k) => `- ${k}`).join('\n')}`
          }
          if (referenceText && referenceText.trim()) {
            userMessage += `\n\n# 用户自定义参考\n${referenceText.trim()}`
          }

          const MAX_RETRIES = 3
          let lastError = ''
          let parsed: unknown

          for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
              if (attempt > 1) {
                send('phase', { phase: 'aligning' })
                const delayMs = Math.min(4000, 1000 * Math.pow(2, attempt - 2))
                await new Promise((resolve) => setTimeout(resolve, delayMs))
              }

              const requestOptions: Record<string, unknown> = {
                model,
                messages: [
                  { role: 'system', content: effectivePrompt },
                  { role: 'user', content: userMessage },
                ],
                temperature: 0.1,
                stream: false,
              }

              if (supportsJsonResponseFormat(model)) {
                requestOptions.response_format = { type: 'json_object' }
              }

              if (isReasoningModel(model)) {
                requestOptions.reasoning_effort = 'low'
              }

              const completion = await openai.chat.completions.create(
                requestOptions as any,
                { signal: AbortSignal.any([abortController.signal, AbortSignal.timeout(perCallTimeout)]) },
              )

              const msg = completion.choices?.[0]?.message
              const content = typeof msg?.content === 'string' ? msg.content : ''
              parsed = parseJsonResponse(content)
              lastError = ''
              break
            } catch (err) {
              if (err instanceof Error) {
                const apiErr = err as Error & { status?: number }
                if (apiErr.status) {
                  lastError = `API ${apiErr.status}: ${err.message}`
                  if (apiErr.status === 429) {
                    await new Promise((resolve) => setTimeout(resolve, 5000))
                  }
                } else if (err.name === 'AbortError' || err.name === 'TimeoutError') {
                  lastError = `Request timeout (${Math.round(perCallTimeout / 1000)}s)`
                } else {
                  lastError = err.message
                }
              } else {
                lastError = 'Unknown error'
              }
            }
          }

          if (lastError) {
            send('error', { message: lastError })
            controller.close()
            return
          }

          const alignResult = parseAlignResult(parsed, fieldPaths)

          // Send keys_ready event
          send('keys_ready', {
            fieldMapping: alignResult.fieldMapping,
            fieldOrder: alignResult.fieldOrder,
            fieldActions: alignResult.fieldActions,
            aiFailed: false,
          })

          // Phase 3: Apply schema to results
          send('phase', { phase: 'applying' })

          const schema: FlattenedSchema = {
            field_mapping: alignResult.fieldMapping,
            field_order: alignResult.fieldOrder,
            flatten_rules: alignResult.flattenRules,
          }

          const alignedResults = applyFlattenedSchemaToResults(extractionData, schema)

          // Send all_done event
          send('all_done', {
            alignedResults: alignedResults.map((r) => ({
              fileId: r.fileId,
              fileName: r.fileName,
              groupId: r.groupId,
              success: r.success,
              data: r.data,
              error: r.error,
            })),
          })

          controller.close()
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Server error'
          send('error', { message })
          try {
            controller.close()
          } catch {
            // Already closed
          }
        }
      },
      cancel() {
        abortController.abort()
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Server error'
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
