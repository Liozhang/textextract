import { NextRequest } from 'next/server'
import OpenAI from 'openai'

export const maxDuration = 300

import { mergeGroupWithAI } from '@/lib/pipeline/merge-agent'
import { isPrivateHost, sseEvent, workerPool } from '@/lib/api-utils'
import { MERGE_SYSTEM_MESSAGE } from '@/lib/pipeline/prompts'
import type { PerFileResult, MergedRecord } from '@/lib/pipeline/types'
import { isReasoningModel, supportsJsonResponseFormat } from '@/lib/merge-utils'

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
    merge?: string
  }
}

// ─── Merge fallback helper ──────────────────────────────────────────────────

async function mergeGroupWithFallback(
  openai: OpenAI,
  model: string,
  group: { groupId: string; groupKey: string },
  groupResults: PerFileResult[],
  abortSignal: AbortSignal,
  mergePrompt?: string,
  templateColumns?: Array<{ key: string; description?: string }>,
): Promise<MergedRecord> {
  const successful = groupResults.filter((r) => r.success && r.data)

  // Single file or all failed -> pass through (filter to template columns if provided)
  if (successful.length <= 1) {
    const r = groupResults.find((r) => r.success) || groupResults[0]
    const rawData = r?.data || {}
    const filteredData = templateColumns && templateColumns.length > 0
      ? Object.fromEntries(
          templateColumns
            .filter((c) => c.key in rawData)
            .map((c) => [c.key, rawData[c.key]]),
        )
      : rawData
    return {
      groupId: group.groupId,
      groupKey: group.groupKey,
      data: filteredData,
      imageDataUrl: r?.imageDataUrl,
      sourceFileNames: successful.length > 0 ? successful.map((r) => r.fileName) : [r?.fileName || ''],
      mergedCount: successful.length,
      mergeMethod: 'single',
      conflicts: [],
    }
  }

  try {
    return await mergeGroupWithAI(
      openai,
      model,
      group.groupKey,
      group.groupId,
      successful.map((r) => ({
        fileId: r.fileId,
        fileName: r.fileName,
        groupId: r.groupId,
        success: true,
        data: Object.fromEntries(
          Object.entries(r.data!).map(([k, v]) => [k, v != null ? String(v) : '']),
        ) as Record<string, string>,
        imageDataUrl: r.imageDataUrl,
      })),
      abortSignal,
      mergePrompt,
      templateColumns,
    )
  } catch (err) {
    throw new Error(
      `合并组 "${group.groupKey}" 失败: ${err instanceof Error ? err.message : '未知错误'}`,
    )
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

    // Determine output headers: template columns > all unique keys
    const allKeys = new Set<string>()
    for (const r of extractionData) {
      if (r.success && r.data) {
        for (const k of Object.keys(r.data)) allKeys.add(k)
      }
    }
    const outputHeaders = (templateColumns && templateColumns.length > 0)
      ? templateColumns.map((c) => c.key)
      : Array.from(allKeys)

    const templateColsForAI = templateColumns?.map((c) => ({ key: c.key, description: c.description }))

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
          // ── Phase: Merge per group ───────────────────────────────────────
          send('phase', { phase: 'merging' })
          send('schema_ready', { headers: outputHeaders, totalRows: extractionData.filter((r) => r.success).length })

          const mergedRecords: MergedRecord[] = []
          const mergeConcurrency = Number(process.env.MERGE_CONCURRENCY) || 3

          await workerPool(groups, mergeConcurrency, async (group) => {
            const groupResults = extractionData.filter((r) => r.groupId === group.groupId)

            send('merge_start', {
              groupId: group.groupId,
              label: group.groupKey,
              fileCount: groupResults.length,
              successCount: groupResults.filter((r) => r.success).length,
            })

            const merged = await mergeGroupWithFallback(
              openai,
              apiSettings.model,
              group,
              groupResults,
              AbortSignal.any([abortController.signal, AbortSignal.timeout(perCallTimeout)]),
              mergePrompt,
              templateColsForAI,
            )

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

          // ── Final: send all_done ──────────────────────────────────────────
          const rows = mergedRecords.map((record) => {
            const data: Record<string, unknown> = {}

            // Only output template columns
            for (const h of outputHeaders) {
              data[h] = record.data[h] ?? null
            }

            // Build fieldConsistency from conflicts
            const fieldConsistency: Record<string, boolean> = {}
            for (const conflict of record.conflicts) {
              fieldConsistency[conflict.fieldName] = false
            }
            for (const h of Object.keys(data)) {
              if (fieldConsistency[h] === undefined) {
                fieldConsistency[h] = true
              }
            }

            return {
              id: record.groupId,
              label: record.groupKey,
              data,
              imageDataUrl: record.imageDataUrl,
              sourceFiles: record.sourceFileNames,
              isMerged: record.mergedCount > 1,
              fieldConsistency,
              mergeMethod: record.mergeMethod,
            }
          })

          send('all_done', {
            totalFiles: extractionData.length,
            totalGroups: groups.length,
            mergedGroups: mergedRecords.length,
            rows,
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
