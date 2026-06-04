import { NextRequest } from 'next/server'
import OpenAI from 'openai'

export const maxDuration = 600

import { mergeGroupWithAI, alignToTemplateWithAI, normalizeValue } from '@/lib/pipeline/merge-agent'
import { isPrivateHost, sseEvent, workerPool, resolveApiSettings } from '@/lib/api-utils'
import { MERGE_SYSTEM_MESSAGE, TEMPLATE_ALIGN_SYSTEM_MESSAGE } from '@/lib/pipeline/prompts'
import type { PerFileResult, MergedRecord } from '@/lib/pipeline/types'
import type { ColumnConstraint } from '@/lib/store'

// ─── Types ──────────────────────────────────────────────────────────────────

interface AlignMergeRequestBody {
  extractionData: PerFileResult[]
  groups: Array<{ groupId: string; groupKey: string }>
  columns?: ColumnConstraint[]
  prompts?: {
    merge?: string
    templateAlign?: string
  }
  apiSettings?: {
    baseUrl?: string
    apiKey?: string
    model?: string
  }
  /** When provided, only process these groups (used for single-row retry) */
  retryGroupIds?: string[]
}

// ─── Merge fallback helper (Phase 1: no template columns) ───────────────────

async function mergeGroupWithFallback(
  openai: OpenAI,
  model: string,
  group: { groupId: string; groupKey: string },
  groupResults: PerFileResult[],
  abortSignal: AbortSignal,
  mergePrompt?: string,
): Promise<MergedRecord[]> {
  const successful = groupResults.filter((r) => r.success && r.data)

  // Single file or all failed -> pass through (preserve all original keys)
  if (successful.length <= 1) {
    const r = groupResults.find((r) => r.success) || groupResults[0]
    const rawData = r?.data || {}
    // Normalize values in single-file passthrough too
    const normalizedData: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawData)) {
      normalizedData[k] = normalizeValue(v);
    }
    return [{
      groupId: group.groupId,
      groupKey: group.groupKey,
      data: normalizedData,
      imageDataUrl: r?.imageDataUrl,
      sourceFileNames: successful.length > 0 ? successful.map((r) => r.fileName) : [r?.fileName || ''],
      mergedCount: successful.length,
      mergeMethod: 'single',
      conflicts: [],
    }]
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
          Object.entries(r.data!).map(([k, v]) => [k, normalizeValue(v)]),
        ) as Record<string, string>,
        imageDataUrl: r.imageDataUrl,
      })),
      abortSignal,
      mergePrompt,
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
      groups: allGroups,
      columns: templateColumns,
      prompts: customPrompts,
      apiSettings: apiSettingsOverride,
      retryGroupIds,
    } = body

    const isRetry = retryGroupIds && retryGroupIds.length > 0
    const groups = isRetry
      ? allGroups.filter((g) => retryGroupIds.includes(g.groupId))
      : allGroups

    if (!extractionData || extractionData.length === 0) {
      return new Response(JSON.stringify({ error: '没有提取数据' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (!allGroups || allGroups.length === 0) {
      return new Response(JSON.stringify({ error: '没有文件分组信息' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Per-call timeout for AI calls
    // Use a generous timeout: base from env (default 120s) or 300s, whichever is larger.
    // Template alignment with long-format output needs extra time for multi-entry generation.
    const baseTimeout = Number(process.env.API_TIMEOUT) || 120_000
    const perCallTimeout = Math.min(600_000, Math.max(600_000, baseTimeout))

    // Resolve prompts
    const mergePrompt = customPrompts?.merge || MERGE_SYSTEM_MESSAGE
    const templateAlignPrompt = customPrompts?.templateAlign || TEMPLATE_ALIGN_SYSTEM_MESSAGE

    const apiSettings = resolveApiSettings(apiSettingsOverride)

    if (!apiSettings.baseUrl || !apiSettings.apiKey || !apiSettings.model) {
      return new Response(JSON.stringify({ error: 'API 设置不完整，请在设置中配置或在 .env 中配置 API_BASE_URL, API_KEY, API_MODEL' }), {
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
      if (r.success) {
        if (r.data) {
          for (const k of Object.keys(r.data)) allKeys.add(k)
        }
        if (r.entries) {
          for (const entry of r.entries) {
            for (const k of Object.keys(entry)) allKeys.add(k)
          }
        }
      }
    }
    const outputHeaders = (templateColumns && templateColumns.length > 0)
      ? templateColumns.map((c) => c.key)
      : Array.from(allKeys)

    const templateColsForAI = templateColumns?.map((c) => ({ key: c.key, description: c.description }))
    const hasTemplateColumns = templateColsForAI && templateColsForAI.length > 0

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
          // ── Fast path: schema-guided extraction → simple row assembly ──
          const hasSchemaEntries = extractionData.some(
            (r) => r.success && r.entries && r.entries.length > 0,
          )
          if (hasSchemaEntries && templateColumns && templateColumns.length > 0) {
            send('phase', { phase: 'merging' })
            send('schema_ready', {
              headers: templateColumns.map((c) => c.key),
              totalRows: extractionData.filter((r) => r.success).length,
            })

            const rows: Array<{
              id: string
              label: string
              data: Record<string, unknown>
              imageDataUrl?: string
              sourceFiles: string[]
              isMerged: boolean
              fieldConsistency: Record<string, boolean>
              mergeMethod: string
            }> = []

            for (const group of groups) {
              const groupResults = extractionData.filter((r) => r.groupId === group.groupId)
              const groupEntries: Array<{ entry: Record<string, unknown>; source: string; imageDataUrl?: string }> = []

              for (const r of groupResults) {
                if (r.success && r.entries) {
                  for (const entry of r.entries) {
                    groupEntries.push({ entry, source: r.fileName, imageDataUrl: r.imageDataUrl })
                  }
                }
              }

              send('merge_start', {
                groupId: group.groupId,
                label: group.groupKey,
                fileCount: groupResults.length,
                successCount: groupResults.filter((r) => r.success).length,
              })

              for (let i = 0; i < groupEntries.length; i++) {
                const { entry, source } = groupEntries[i]
                rows.push({
                  id: groupEntries.length > 1 ? `${group.groupId}-${i}` : group.groupId,
                  label: groupEntries.length > 1 ? `${group.groupKey} #${i + 1}` : group.groupKey,
                  data: entry,
                  imageDataUrl: groupEntries[i].imageDataUrl,
                  sourceFiles: [source],
                  isMerged: groupEntries.length > 1,
                  fieldConsistency: {},
                  mergeMethod: 'schema_guided',
                })
              }

              send('group_merged', {
                groupId: group.groupId,
                groupKey: group.groupKey,
                sourceFileNames: groupResults.map((r) => r.fileName),
                mergedCount: groupEntries.length,
                mergeMethod: 'schema_guided',
                conflicts: [],
              })
            }

            send('all_done', {
              totalFiles: extractionData.length,
              totalGroups: allGroups.length,
              mergedGroups: groups.length,
              rows,
              ...(isRetry ? { isRetry: true } : {}),
            })

            controller.close()
            return
          }

          // ── Legacy path: AI merge + optional template alignment ──
          // ── Phase 1: Merge per group (no template columns) ────────────────
          send('phase', { phase: 'merging' })
          send('schema_ready', { headers: outputHeaders, totalRows: extractionData.filter((r) => r.success).length })

          const mergedRecords: MergedRecord[] = []
          const mergeConcurrency = apiSettings.concurrency

          await workerPool(groups, mergeConcurrency, async (group) => {
            const groupResults = extractionData.filter((r) => r.groupId === group.groupId)

            send('merge_start', {
              groupId: group.groupId,
              label: group.groupKey,
              fileCount: groupResults.length,
              successCount: groupResults.filter((r) => r.success).length,
            })

            try {
              const groupRecords = await mergeGroupWithFallback(
                openai,
                apiSettings.model,
                group,
                groupResults,
                AbortSignal.any([abortController.signal, AbortSignal.timeout(perCallTimeout)]),
                mergePrompt,
              )

              send('group_merged', {
                groupId: group.groupId,
                groupKey: group.groupKey,
                sourceFileNames: groupRecords[0]?.sourceFileNames ?? [],
                mergedCount: groupRecords.length,
                mergeMethod: groupRecords[0]?.mergeMethod ?? 'single',
                conflicts: groupRecords.flatMap((r) => r.conflicts),
              })

              mergedRecords.push(...groupRecords)
            } catch (err) {
              const msg = err instanceof Error ? err.message : '未知错误'
              send('group_error', {
                phase: 'merging',
                groupId: group.groupId,
                groupKey: group.groupKey,
                message: `合并失败: ${msg}`,
              })
            }
          })

          // ── Phase 2: Template alignment (if template columns exist) ───────
          let finalRecords = mergedRecords

          if (hasTemplateColumns) {
            send('phase', { phase: 'aligning' })

            const alignedRecords: MergedRecord[] = []

            await workerPool(groups, mergeConcurrency, async (group) => {
              const groupMerged = mergedRecords.filter((r) => r.groupId === group.groupId)
              if (groupMerged.length === 0) return

              send('align_start', {
                groupId: group.groupId,
                label: group.groupKey,
                entryCount: groupMerged.length,
              })

              try {
                const aligned = await alignToTemplateWithAI(
                  openai,
                  apiSettings.model,
                  group.groupKey,
                  group.groupId,
                  groupMerged,
                  templateColsForAI!,
                  AbortSignal.any([abortController.signal, AbortSignal.timeout(perCallTimeout)]),
                  templateAlignPrompt,
                )

                send('group_aligned', {
                  groupId: group.groupId,
                  groupKey: group.groupKey,
                  entryCount: aligned.length,
                })

                alignedRecords.push(...aligned)
              } catch (err) {
                const msg = err instanceof Error ? err.message : '未知错误'
                send('group_error', {
                  phase: 'aligning',
                  groupId: group.groupId,
                  groupKey: group.groupKey,
                  message: `模板对齐失败: ${msg}`,
                })
              }
            })

            finalRecords = alignedRecords
          }

          // ── Final: send all_done ──────────────────────────────────────────
          const groupEntryCounts = new Map<string, number>();
          const groupEntryIndices = new Map<string, number>();
          for (const r of finalRecords) {
            groupEntryCounts.set(r.groupId, (groupEntryCounts.get(r.groupId) || 0) + 1);
          }

          const rows = finalRecords.map((record) => {
            const idx = groupEntryIndices.get(record.groupId) || 0;
            groupEntryIndices.set(record.groupId, idx + 1);
            const totalInGroup = groupEntryCounts.get(record.groupId) || 1;

            const data: Record<string, unknown> = {};

            // Only output template columns
            for (const h of outputHeaders) {
              data[h] = record.data[h] ?? null;
            }

            // Build fieldConsistency from conflicts (skip meta fields prefixed with _)
            const fieldConsistency: Record<string, boolean> = {};
            for (const conflict of record.conflicts) {
              if (conflict.fieldName.startsWith('_')) continue;
              fieldConsistency[conflict.fieldName] = false;
            }
            for (const h of Object.keys(data)) {
              if (fieldConsistency[h] === undefined) {
                fieldConsistency[h] = true;
              }
            }

            return {
              id: totalInGroup > 1 ? `${record.groupId}-${idx}` : record.groupId,
              label: totalInGroup > 1 ? `${record.groupKey} #${idx + 1}` : record.groupKey,
              data,
              imageDataUrl: record.imageDataUrl,
              sourceFiles: record.sourceFileNames,
              isMerged: record.mergedCount > 1,
              fieldConsistency,
              mergeMethod: record.mergeMethod,
            };
          })

          send('all_done', {
            totalFiles: extractionData.length,
            totalGroups: allGroups.length,
            mergedGroups: finalRecords.length,
            rows,
            ...(isRetry ? { isRetry: true } : {}),
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