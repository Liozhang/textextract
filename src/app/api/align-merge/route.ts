import { NextRequest } from 'next/server'
import OpenAI from 'openai'

export const maxDuration = 600

import { mergeGroupWithAI, alignToTemplateWithAI, normalizeValue, normalizeKey, isValidKey } from '@/lib/pipeline/merge-agent'
import { isPrivateHost, sseEvent, workerPool, resolveApiSettings } from '@/lib/api-utils'
import { cleanupExpiredSessions } from '@/lib/server-cleanup'
import { MERGE_SYSTEM_MESSAGE, TEMPLATE_ALIGN_SYSTEM_MESSAGE } from '@/lib/pipeline/prompts'
import { readAllResults } from '@/lib/server-results'
import type { PerFileResult, MergedRecord } from '@/lib/pipeline/types'
import type { ColumnConstraint } from '@/lib/store'
import { getTempDir } from '@/lib/temp-dir'
import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import { join } from 'path'

// ─── Types ──────────────────────────────────────────────────────────────────

interface AlignMergeRequestBody {
  /** Server-side sessionId — when provided, read results from disk instead of request body */
  sessionId?: string
  /** Legacy: full extraction data in request body (backward compat) */
  extractionData?: PerFileResult[]
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
    cacheExpiryHours?: number
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
  sessionId?: string,
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
    // Reconstruct imageDataUrl from uploaded file if missing (disk-loaded results)
    let imgDataUrl = r?.imageDataUrl
    if (!imgDataUrl && sessionId && r?.fileId) {
      const filePath = join(getTempDir(), sessionId, r.fileId)
      if (existsSync(filePath)) {
        const ext = r.fileName.split('.').pop()?.toLowerCase()
        const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png'
        imgDataUrl = `data:${mime};base64,${(await readFile(filePath)).toString('base64')}`
      }
    }
    return [{
      groupId: group.groupId,
      groupKey: group.groupKey,
      data: normalizedData,
      imageDataUrl: imgDataUrl,
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
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      })
    }

    const body: AlignMergeRequestBody = await request.json()
    const {
      sessionId,
      extractionData: inlineData,
      groups: allGroups,
      columns: templateColumns,
      prompts: customPrompts,
      apiSettings: apiSettingsOverride,
      retryGroupIds,
    } = body

    // Load extraction data: from disk (sessionId) or from request body (backward compat)
    let extractionData = inlineData || []
    if (!extractionData.length && sessionId) {
      extractionData = await readAllResults(sessionId)
    }

    const isRetry = retryGroupIds && retryGroupIds.length > 0
    const groups = isRetry
      ? allGroups.filter((g) => retryGroupIds.includes(g.groupId))
      : allGroups

    if (!extractionData || extractionData.length === 0) {
      return new Response(JSON.stringify({ error: '没有提取数据' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      })
    }

    if (!allGroups || allGroups.length === 0) {
      return new Response(JSON.stringify({ error: '没有文件分组信息' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      })
    }

    // Per-call timeout for AI calls
    // Use a generous timeout: base from env (default 120s) or 300s, whichever is larger.
    // Template alignment with long-format output needs extra time for multi-entry generation.
    const baseTimeout = Number(process.env.API_TIMEOUT) || 120_000
    const perCallTimeout = Math.min(600_000, Math.max(baseTimeout, 120_000))

    // Resolve prompts
    const mergePrompt = customPrompts?.merge || MERGE_SYSTEM_MESSAGE
    const templateAlignPrompt = customPrompts?.templateAlign || TEMPLATE_ALIGN_SYSTEM_MESSAGE

    const apiSettings = resolveApiSettings(apiSettingsOverride)

    // Fire-and-forget: clean up expired temp sessions (use client-provided expiry)
    cleanupExpiredSessions(
      apiSettings.cacheExpiryHours ? apiSettings.cacheExpiryHours * 60 * 60 * 1000 : undefined,
    )

    if (!apiSettings.baseUrl || !apiSettings.apiKey || !apiSettings.model) {
      return new Response(JSON.stringify({ error: 'API 设置不完整，请在设置中配置或在 .env 中配置 API_BASE_URL, API_KEY, API_MODEL' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      })
    }

    if (isPrivateHost(apiSettings.baseUrl)) {
      return new Response(JSON.stringify({ error: '不允许访问内网地址' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
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
          for (const k of Object.keys(r.data)) {
            const nk = normalizeKey(k)
            if (isValidKey(nk)) allKeys.add(nk)
          }
        }
        if (r.entries) {
          for (const entry of r.entries) {
            for (const k of Object.keys(entry)) {
              const nk = normalizeKey(k)
              if (isValidKey(nk)) allKeys.add(nk)
            }
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
          // ── Fast path: schema-guided extraction → row assembly ──
          const hasSchemaEntries = extractionData.some(
            (r) => r.success && ((r.entries && r.entries.length > 0) || (r.data && Object.keys(r.data).length > 0)),
          )
          if (hasSchemaEntries) {
            send('phase', { phase: 'merging' })

            // Detect nested format: some results have headerData
            const hasHeaderData = extractionData.some(
              (r) => r.success && r.headerData && Object.keys(r.headerData).length > 0,
            )
            const hasRepeatingCols = templateColumns?.some((c) => c.repeating)

            // Collect output headers: template columns > all unique keys
            const schemaHeaders = templateColumns && templateColumns.length > 0
              ? templateColumns.map((c) => c.key)
              : (() => {
                  const keys = new Set<string>()
                  for (const r of extractionData) {
                    if (r.success) {
                      if (r.headerData) {
                        for (const k of Object.keys(r.headerData)) {
                          const nk = normalizeKey(k)
                          if (isValidKey(nk)) keys.add(nk)
                        }
                      }
                      if (r.entries) {
                        for (const entry of r.entries) {
                          for (const k of Object.keys(entry)) {
                            const nk = normalizeKey(k)
                            if (isValidKey(nk)) keys.add(nk)
                          }
                        }
                      }
                      if (r.data) {
                        for (const k of Object.keys(r.data)) {
                          const nk = normalizeKey(k)
                          if (isValidKey(nk)) keys.add(nk)
                        }
                      }
                    }
                  }
                  return Array.from(keys)
                })()
            send('schema_ready', {
              headers: schemaHeaders,
              totalRows: groups.length,
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

              send('merge_start', {
                groupId: group.groupId,
                label: group.groupKey,
                fileCount: groupResults.length,
                successCount: groupResults.filter((r) => r.success).length,
              })

              // ── Nested format: headerData + entries → cross-join flatten ──
              if (hasHeaderData && hasRepeatingCols) {
                const successful = groupResults.filter((r) => r.success)
                if (successful.length === 0) continue

                // Merge headerData across files (first non-empty wins, conflict detection)
                const mergedHeader: Record<string, unknown> = {}
                const allSources = new Set<string>()
                const fieldConflicts: Array<{ fieldName: string; values: string[] }> = []
                let firstImage: string | undefined

                for (const r of successful) {
                  allSources.add(r.fileName)
                  if (!firstImage && r.imageDataUrl) firstImage = r.imageDataUrl

                  const header = r.headerData ?? {}
                  for (const [rawKey, value] of Object.entries(header)) {
                    if (value === null || value === undefined || value === '') continue
                    const key = normalizeKey(rawKey)
                    if (!isValidKey(key)) continue
                    const normalizedValue = normalizeValue(value)
                    if (!(key in mergedHeader)) {
                      mergedHeader[key] = normalizedValue
                    } else {
                      const existing = mergedHeader[key]
                      if (JSON.stringify(existing) !== JSON.stringify(normalizedValue)) {
                        const c = fieldConflicts.find((x) => x.fieldName === key)
                        const valStr = typeof normalizedValue === 'string' ? normalizedValue : JSON.stringify(normalizedValue)
                        if (c) {
                          if (!c.values.includes(valStr)) c.values.push(valStr)
                        } else {
                          const exStr = typeof existing === 'string' ? existing : JSON.stringify(existing)
                          fieldConflicts.push({ fieldName: key, values: [exStr, valStr] })
                        }
                      }
                    }
                  }
                }

                // Collect all entries from all files
                const allEntries: Array<{ entry: Record<string, unknown> }> = []
                for (const r of successful) {
                  if (r.entries && r.entries.length > 0) {
                    for (const entry of r.entries) {
                      allEntries.push({ entry })
                    }
                  }
                }

                // No entries but has header → single row with header only
                if (allEntries.length === 0) {
                  const data: Record<string, unknown> = { ...mergedHeader }
                  if (templateColumns) {
                    for (const col of templateColumns) {
                      if (!(col.key in data)) data[col.key] = null
                    }
                  }
                  const fieldConsistency: Record<string, boolean> = {}
                  for (const key of Object.keys(data)) {
                    fieldConsistency[key] = !fieldConflicts.some((c) => c.fieldName === key)
                  }
                  rows.push({
                    id: group.groupId,
                    label: group.groupKey,
                    data,
                    imageDataUrl: firstImage,
                    sourceFiles: Array.from(allSources),
                    isMerged: successful.length > 1,
                    fieldConsistency,
                    mergeMethod: 'programmatic',
                  })
                } else {
                  // Cross-join: each entry gets merged header fields
                  for (let i = 0; i < allEntries.length; i++) {
                    const { entry } = allEntries[i]
                    const data: Record<string, unknown> = { ...mergedHeader }

                    for (const [rawKey, value] of Object.entries(entry)) {
                      if (value === null || value === undefined || value === '') continue
                      const key = normalizeKey(rawKey)
                      if (!isValidKey(key)) continue
                      data[key] = normalizeValue(value)
                    }

                    // Fill template columns with null for missing
                    if (templateColumns) {
                      for (const col of templateColumns) {
                        if (!(col.key in data)) data[col.key] = null
                      }
                    }

                    const fieldConsistency: Record<string, boolean> = {}
                    for (const key of Object.keys(data)) {
                      fieldConsistency[key] = !fieldConflicts.some((c) => c.fieldName === key)
                    }

                    rows.push({
                      id: allEntries.length > 1 ? `${group.groupId}-${i}` : group.groupId,
                      label: allEntries.length > 1 ? `${group.groupKey} #${i + 1}` : group.groupKey,
                      data,
                      imageDataUrl: i === 0 ? firstImage : undefined,
                      sourceFiles: Array.from(allSources),
                      isMerged: successful.length > 1 || allEntries.length > 1,
                      fieldConsistency,
                      mergeMethod: 'programmatic',
                    })
                  }
                }

                send('group_merged', {
                  groupId: group.groupId,
                  groupKey: group.groupKey,
                  sourceFileNames: groupResults.map((r) => r.fileName),
                  mergedCount: rows.filter((r) => r.id.startsWith(group.groupId)).length || 1,
                  mergeMethod: 'programmatic',
                  conflicts: fieldConflicts,
                })
              } else {
                // ── Flat format: existing programmatic merge logic ──
                const groupEntries: Array<{ entry: Record<string, unknown>; source: string; imageDataUrl?: string }> = []

                for (const r of groupResults) {
                  if (r.success) {
                    if (r.entries && r.entries.length > 0) {
                      for (const entry of r.entries) {
                        groupEntries.push({ entry, source: r.fileName, imageDataUrl: r.imageDataUrl })
                      }
                    } else if (r.data) {
                      groupEntries.push({ entry: r.data, source: r.fileName, imageDataUrl: r.imageDataUrl })
                    }
                  }
                }

                if (groupEntries.length === 0) continue

                const mergedData: Record<string, unknown> = {}
                const allSources = new Set<string>()
                const fieldConflicts: Array<{ fieldName: string; values: string[] }> = []

                for (let { entry, source } of groupEntries) {
                  allSources.add(source)

                  // Detect common prefix in ALL keys of this entry
                  const rawKeys = Object.keys(entry)
                  if (rawKeys.length > 1) {
                    const firstParts = rawKeys[0].split('-')
                    if (firstParts.length > 1) {
                      const candidatePrefix = firstParts[0] + '-'
                      const allSharePrefix = rawKeys.every((k) => k.startsWith(candidatePrefix))
                      if (allSharePrefix) {
                        const stripped: Record<string, unknown> = {}
                        for (const [k, v] of Object.entries(entry)) {
                          stripped[k.slice(candidatePrefix.length)] = v
                        }
                        entry = stripped
                      }
                    }
                  }

                  for (const [rawKey, value] of Object.entries(entry)) {
                    if (value === null || value === undefined || value === '') continue
                    const key = normalizeKey(rawKey)
                    if (!isValidKey(key)) continue
                    const normalizedValue = normalizeValue(value)
                    if (!(key in mergedData)) {
                      mergedData[key] = normalizedValue
                    } else {
                      const existing = mergedData[key]
                      if (JSON.stringify(existing) !== JSON.stringify(normalizedValue)) {
                        const c = fieldConflicts.find((x) => x.fieldName === key)
                        const valStr = typeof normalizedValue === 'string' ? normalizedValue : JSON.stringify(normalizedValue)
                        if (c) {
                          if (!c.values.includes(valStr)) c.values.push(valStr)
                        } else {
                          const exStr = typeof existing === 'string' ? existing : JSON.stringify(existing)
                          fieldConflicts.push({ fieldName: key, values: [exStr, valStr] })
                        }
                      }
                    }
                  }
                }

                const fieldConsistency: Record<string, boolean> = {}
                for (const key of Object.keys(mergedData)) {
                  fieldConsistency[key] = !fieldConflicts.some((c) => c.fieldName === key)
                }

                const firstImage = groupEntries.find((e) => e.imageDataUrl)?.imageDataUrl

                rows.push({
                  id: group.groupId,
                  label: group.groupKey,
                  data: mergedData,
                  imageDataUrl: firstImage,
                  sourceFiles: Array.from(allSources),
                  isMerged: groupEntries.length > 1,
                  fieldConsistency,
                  mergeMethod: 'programmatic',
                })

                send('group_merged', {
                  groupId: group.groupId,
                  groupKey: group.groupKey,
                  sourceFileNames: groupResults.map((r) => r.fileName),
                  mergedCount: 1,
                  mergeMethod: 'programmatic',
                  conflicts: fieldConflicts,
                })
              }
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
                sessionId,
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
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : '服务器内部错误'
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    })
  }
}