import { NextRequest } from 'next/server'
import OpenAI from 'openai'

export const maxDuration = 300

import { alignSchemaWithAI, alignSchema } from '@/lib/pipeline/schema-aligner'
import {
  collectFieldPaths,
  applyFlattenedSchemaToResults,
} from '@/lib/pipeline/schema-flattener'
import { KEY_ALIGN_SYSTEM_MESSAGE } from '@/lib/pipeline/prompts'
import { parseJsonResponse } from '@/lib/pipeline/json-parser'
import { isReasoningModel, supportsJsonResponseFormat } from '@/lib/merge-utils'
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

// ─── Security: URL validation ────────────────────────────────────────────────

const PRIVATE_HOSTS = [
  /^localhost$/i,
  /^127(?:\.\d{1,3}){3}$/,
  /^10(?:\.\d{1,3}){3}$/,
  /^172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}$/,
  /^192\.168(?:\.\d{1,3}){2}$/,
  /^169\.254(?:\.\d{1,3}){2}$/,
  /^0\.0\.0\.0$/,
  /^::1$/,
  /^\[::1\]$/,
]

function isPrivateHost(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return true
    return PRIVATE_HOSTS.some((re) => re.test(parsed.hostname))
  } catch {
    return true
  }
}

// ─── Helper: send SSE event ─────────────────────────────────────────────────

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
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
  const encoder = new TextEncoder()
  const stream = new TransformStream()
  const writer = stream.writable.getWriter()

  // Run pipeline in background, writing SSE events to stream
  ;(async () => {
    try {
      const body: AlignKeysRequestBody = await request.json()
      const { extractionData, referenceKeys, referenceText, prompts: customPrompts } = body

      if (!extractionData || extractionData.length === 0) {
        writer.write(encoder.encode(sseEvent('error', { message: 'No extraction data' })))
        return
      }

      const baseUrl = (process.env.API_BASE_URL || '').trim()
      const apiKey = (process.env.API_KEY || '').trim()
      const model = (process.env.API_MODEL || '').trim()

      if (!baseUrl || !apiKey || !model) {
        writer.write(encoder.encode(sseEvent('error', { message: 'API settings incomplete' })))
        return
      }

      if (isPrivateHost(baseUrl)) {
        writer.write(encoder.encode(sseEvent('error', { message: 'Private host not allowed' })))
        return
      }

      const openai = new OpenAI({ baseURL: baseUrl, apiKey })

      // Phase 1: Collect field paths
      writer.write(encoder.encode(sseEvent('phase', { phase: 'collecting' })))
      const fieldPaths = collectFieldPaths(extractionData)

      // Phase 2: AI alignment
      writer.write(encoder.encode(sseEvent('phase', { phase: 'aligning' })))

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

      const effectivePrompt = customPrompts?.keyAlign || KEY_ALIGN_SYSTEM_MESSAGE
      const baseTimeout = Number(process.env.API_TIMEOUT) || 120_000
      const perCallTimeout = Math.min(600_000, baseTimeout)
      const abortSignal = AbortSignal.timeout(perCallTimeout)

      let schema: FlattenedSchema
      let fieldActions: Record<string, string> = {}
      let aiFailed = false

      try {
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
          { signal: abortSignal },
        )

        const msg = completion.choices?.[0]?.message
        const content = typeof msg?.content === 'string' ? msg.content : ''
        const parsed = parseJsonResponse(content)

        const alignResult = parseAlignResult(parsed, fieldPaths)
        fieldActions = alignResult.fieldActions

        schema = {
          field_mapping: alignResult.fieldMapping,
          field_order: alignResult.fieldOrder,
          flatten_rules: alignResult.flattenRules,
        }
      } catch (err) {
        console.error('[align-keys] AI alignment failed:', err)
        const fallbackSchema = alignSchema(fieldPaths)
        schema = {
          field_mapping: fallbackSchema.field_mapping,
          field_order: fallbackSchema.field_order,
          flatten_rules: fallbackSchema.flatten_rules,
        }
        aiFailed = true
      }

      // Send keys_ready event
      writer.write(encoder.encode(sseEvent('keys_ready', {
        fieldMapping: schema.field_mapping,
        fieldOrder: schema.field_order,
        fieldActions,
        aiFailed,
      })))

      // Phase 3: Apply schema to results
      writer.write(encoder.encode(sseEvent('phase', { phase: 'applying' })))
      const alignedResults = applyFlattenedSchemaToResults(extractionData, schema)

      // Send all_done event
      writer.write(encoder.encode(sseEvent('all_done', {
        alignedResults: alignedResults.map((r) => ({
          fileId: r.fileId,
          fileName: r.fileName,
          groupId: r.groupId,
          success: r.success,
          data: r.data,
          error: r.error,
        })),
      })))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Server error'
      writer.write(encoder.encode(sseEvent('error', { message })))
    } finally {
      writer.close()
    }
  })()

  return new Response(stream.readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
