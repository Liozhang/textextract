import { NextRequest } from 'next/server'
import OpenAI from 'openai'

export const maxDuration = 300

import { alignSchemaWithAI, alignSchema } from '@/lib/pipeline/schema-aligner'
import {
  collectFieldPaths,
  applyFlattenedSchemaToResults,
  buildUnifiedSchemaFromMerged,
} from '@/lib/pipeline/schema-flattener'
import { mergeGroupWithAI } from '@/lib/pipeline/merge-agent'
import {
  SCHEMA_ALIGN_SYSTEM_MESSAGE,
  MERGE_SYSTEM_MESSAGE,
} from '@/lib/pipeline/prompts'
import { strategyMerge } from '@/lib/merge-utils'
import type { PerFileResult, AlignedPerFileResult, MergedRecord } from '@/lib/pipeline/types'

// ─── Types ──────────────────────────────────────────────────────────────────

interface ColumnConstraint {
  key: string
  type: 'string' | 'number' | 'boolean'
  description: string
  example?: string
}

interface AlignMergeRequestBody {
  extractionData: PerFileResult[]
  groups: Array<{ groupId: string; groupKey: string }>
  columns?: ColumnConstraint[]
  prompts?: {
    schemaAlign?: string
    merge?: string
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

// ─── Worker pool for concurrent merge processing ─────────────────────────

async function workerPool<T>(
  items: T[],
  concurrency: number,
  handler: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let nextIndex = 0

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex++
      await handler(items[index], index)
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  await Promise.all(workers)
}

// ─── Merge fallback helper ──────────────────────────────────────────────────

async function mergeGroupWithFallback(
  openai: OpenAI,
  model: string,
  group: { groupId: string; groupKey: string },
  groupResults: AlignedPerFileResult[],
  abortSignal: AbortSignal,
  mergePrompt?: string,
): Promise<MergedRecord> {
  const successful = groupResults.filter((r) => r.success && r.data)

  // Single file or all failed → pass through
  if (successful.length <= 1) {
    const r = groupResults.find((r) => r.success) || groupResults[0]
    return {
      groupId: group.groupId,
      groupKey: group.groupKey,
      data: r?.data || {},
      imageDataUrl: r?.imageDataUrl,
      sourceFileNames: successful.length > 0 ? successful.map((r) => r.fileName) : [r?.fileName || ''],
      mergedCount: successful.length,
      mergeMethod: 'single',
      conflicts: [],
    }
  }

  try {
    return await mergeGroupWithAI(openai, model, group.groupKey, group.groupId, successful, abortSignal, mergePrompt)
  } catch {
    // Fallback to strategy merge
    const { data, conflicts: fallbackConflicts } = strategyMerge(
      successful.map(r => ({ data: r.data! as Record<string, unknown>, fileName: r.fileName })),
      'first_wins',
    )
    const imageResult = successful.find((r) => r.imageDataUrl)
    return {
      groupId: group.groupId,
      groupKey: group.groupKey,
      data,
      imageDataUrl: imageResult?.imageDataUrl,
      sourceFileNames: successful.map((r) => r.fileName),
      mergedCount: successful.length,
      mergeMethod: 'fallback_strategy',
      conflicts: fallbackConflicts,
    }
  }
}

// ─── POST handler ────────────────────────────────────────────────────────────

const MAX_REQUEST_SIZE = 100 * 1024 * 1024 // 100MB

export async function POST(request: NextRequest) {
  const abortController = new AbortController()

  try {
    // Security: check request body size
    const contentLength = request.headers.get('content-length')
    if (contentLength && parseInt(contentLength, 10) > MAX_REQUEST_SIZE) {
      return new Response(JSON.stringify({ error: '请求体过大，最大允许 100MB' }), {
        status: 413,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const body: AlignMergeRequestBody = await request.json()
    const {
      extractionData,
      groups,
      columns: templateColumns,
      prompts: customPrompts,
    } = body

    if (!extractionData || extractionData.length === 0) {
      return new Response(JSON.stringify({ error: '没有提取数据' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (!groups || groups.length === 0) {
      return new Response(JSON.stringify({ error: '没有文件分组信息' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Per-call timeout for AI calls
    const baseTimeout = Number(process.env.API_TIMEOUT) || 120_000
    const perCallTimeout = Math.min(600_000, baseTimeout)

    // Resolve prompts
    const schemaAlignPrompt = customPrompts?.schemaAlign || SCHEMA_ALIGN_SYSTEM_MESSAGE
    const mergePrompt = customPrompts?.merge || MERGE_SYSTEM_MESSAGE

    const apiSettings = {
      baseUrl: (process.env.API_BASE_URL || '').trim(),
      apiKey: (process.env.API_KEY || '').trim(),
      model: (process.env.API_MODEL || '').trim(),
    }

    if (!apiSettings.baseUrl || !apiSettings.apiKey || !apiSettings.model) {
      return new Response(JSON.stringify({ error: 'API 设置不完整，请在 .env 中配置 API_BASE_URL, API_KEY, API_MODEL' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (isPrivateHost(apiSettings.baseUrl)) {
      return new Response(JSON.stringify({ error: '不允许访问内网地址' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const openai = new OpenAI({
      baseURL: apiSettings.baseUrl,
      apiKey: apiSettings.apiKey,
    })

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
          // ── Phase 2: Schema alignment + flattening ─────────────────────────
          send('phase', { phase: 'aligning' })
          const fieldPaths = collectFieldPaths(extractionData)
          let schema
          let schemaAiFailed = false
          try {
            schema = await alignSchemaWithAI(openai, apiSettings.model, fieldPaths, abortController.signal, schemaAlignPrompt, perCallTimeout)
          } catch (alignError) {
            console.error('[align-merge] AI schema alignment failed:', alignError instanceof Error ? alignError.message : alignError)
            schema = alignSchema(fieldPaths)
            schemaAiFailed = true
          }

          // If template columns are provided, prioritize them in field_order
          if (templateColumns && templateColumns.length > 0) {
            const seedKeys = new Set(templateColumns.map((c) => c.key))
            const seeded: string[] = []
            const rest: string[] = []
            for (const h of schema.field_order) {
              if (seedKeys.has(h)) seeded.push(h)
              else rest.push(h)
            }
            // Add any seed keys that AI didn't produce (will be populated during merge)
            for (const c of templateColumns) {
              if (!seeded.includes(c.key) && !rest.includes(c.key)) {
                rest.unshift(c.key)
              }
            }
            schema.field_order = [...seeded, ...rest]
          }

          // Apply flattened schema to each PerFileResult
          const alignedResults = applyFlattenedSchemaToResults(extractionData, schema)

          send('schema_ready', {
            headers: schema.field_order,
            totalRows: alignedResults.filter((r) => r.success).length,
            ...(schemaAiFailed ? { aiFailed: true } : {}),
          })

          // ── Phase 3: Group merge (fields now aligned and flat) ────────────
          send('phase', { phase: 'merging' })
          const mergedRecords: MergedRecord[] = []
          const mergeConcurrency = Number(process.env.MERGE_CONCURRENCY) || 3

          await workerPool(groups, mergeConcurrency, async (group) => {
            const groupAligned = alignedResults.filter((r) => r.groupId === group.groupId)

            send('merge_start', {
              groupId: group.groupId,
              label: group.groupKey,
              fileCount: groupAligned.length,
              successCount: groupAligned.filter((r) => r.success).length,
            })

            const merged = await mergeGroupWithFallback(openai, apiSettings.model, group, groupAligned, AbortSignal.any([abortController.signal, AbortSignal.timeout(perCallTimeout)]), mergePrompt)

            send('group_merged', {
              groupId: merged.groupId,
              groupKey: merged.groupKey,
              sourceFileNames: merged.sourceFileNames,
              mergedCount: merged.mergedCount,
              mergeMethod: merged.mergeMethod,
              conflicts: merged.conflicts,
            })

            mergedRecords.push(merged)
          })

          // ── Final: build UnifiedSchema and send all_done ──────────────────
          const unifiedSchema = buildUnifiedSchemaFromMerged(mergedRecords, schema.field_order)

          send('all_done', {
            totalFiles: extractionData.length,
            totalGroups: groups.length,
            mergedGroups: mergedRecords.length,
            rows: unifiedSchema.rows.map((row) => ({
              id: row.id,
              label: row.label,
              data: row.data,
              sourceFiles: row.sourceFiles,
              isMerged: row.isMerged,
              fieldConsistency: row.fieldConsistency,
              mergeMethod: row.mergeMethod,
            })),
          })

          controller.close()
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : '服务器内部错误'
          send('error', { phase: 'unknown', message: errorMessage })
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
    const message = err instanceof Error ? err.message : '服务器内部错误'
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
