import { NextRequest } from 'next/server'
import OpenAI from 'openai'
import mammoth from 'mammoth'
import sharp from 'sharp'

import { parseJsonResponse } from '@/lib/pipeline/json-parser'
import { groupFilesByPrefix, findGroupForFile } from '@/lib/pipeline/file-grouper'
import { mergeGroupWithAI } from '@/lib/pipeline/merge-agent'
import { alignSchemaWithAI, alignSchema } from '@/lib/pipeline/schema-aligner'
import { collectFieldPaths, applyFlattenedSchemaToResults, buildUnifiedSchemaFromMerged } from '@/lib/pipeline/schema-flattener'
import {
  EXTRACTION_SYSTEM_MESSAGE,
  TEXT_EXTRACTION_PREFIX,
} from '@/lib/pipeline/prompts'
import { strategyMerge, isReasoningModel } from '@/lib/merge-utils'
import type { PerFileResult, AlignedPerFileResult, MergedRecord } from '@/lib/pipeline/types'

// ─── Security: URL validation ────────────────────────────────────────────

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
    const hostname = parsed.hostname
    return PRIVATE_HOSTS.some((re) => re.test(hostname))
  } catch {
    return true
  }
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface FileInput {
  id: string
  name: string
  size?: number
  type?: string
  content?: string
  dataUrl?: string
}

interface ApiSettings {
  baseUrl: string
  apiKey: string
  model: string
  temperature?: number
}

interface ExtractRequestBody {
  files: FileInput[]
  imageCompressThreshold?: number
}

// ─── Helper: send SSE event ─────────────────────────────────────────────────

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

// ─── File parsing ───────────────────────────────────────────────────────────

async function parseFileContent(file: FileInput, compressThreshold: number): Promise<{
  text: string
  images?: { dataUrl: string }[]
}> {
  const ext = file.name.split('.').pop()?.toLowerCase() || ''

  switch (ext) {
    case 'docx': {
      const buffer = Buffer.from(file.content || '', 'base64')
      const result = await mammoth.extractRawText({ buffer })
      return { text: result.value }
    }

    case 'pdf': {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse = require('pdf-parse')
      const buffer = Buffer.from(file.content || '', 'base64')
      const result = await pdfParse(buffer)
      return { text: result.text }
    }

    case 'xlsx':
    case 'xls': {
      const XLSX = await import('xlsx')
      const buffer = Buffer.from(file.content || '', 'base64')
      const workbook = XLSX.read(buffer, { type: 'buffer' })
      const firstSheet = workbook.SheetNames[0]
      const sheet = workbook.Sheets[firstSheet]
      const text = XLSX.utils.sheet_to_csv(sheet)
      return { text }
    }

    case 'doc':
      return { text: '不支持 .doc 格式，请转换为 .docx' }

    case 'jpg':
    case 'jpeg':
    case 'png':
    case 'gif':
    case 'webp': {
      if (!file.dataUrl) {
        return { text: '[图片文件无内容]', images: [] }
      }

      const base64Data = file.dataUrl.replace(/^data:[^;]+;base64,/, '')
      const buffer = Buffer.from(base64Data, 'base64')
      const fileSizeBytes = buffer.length
      const thresholdBytes = compressThreshold * 1024 * 1024

      let finalDataUrl: string

      if (fileSizeBytes > thresholdBytes) {
        const isPng = ext === 'png' || ext === 'gif' || ext === 'webp'
        const compressedBuffer = isPng
          ? await sharp(buffer).png({ compressionLevel: 9 }).toBuffer()
          : await sharp(buffer).jpeg({ quality: 80 }).toBuffer()
        const base64 = compressedBuffer.toString('base64')
        const mimeType = isPng ? 'image/png' : 'image/jpeg'
        finalDataUrl = `data:${mimeType};base64,${base64}`
      } else {
        finalDataUrl = file.dataUrl
      }

      return { text: '[图片文件]', images: [{ dataUrl: finalDataUrl }] }
    }

    case 'txt':
    case 'md':
    case 'csv':
    case 'json':
    case 'tsv':
    case 'xml':
    case 'html':
    case 'htm':
    default:
      return { text: file.content || '' }
  }
}

// ─── Worker pool for concurrent processing ───────────────────────────────────

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

// ─── Date/measurement normalization ──────────────────────────────────────────

function normalizeDate(value: unknown): string {
  const s = String(value ?? '').trim()
  if (!s) return s
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const cn = s.match(/(\d{4})年(\d{1,2})月(\d{1,2})日?/)
  if (cn) return `${cn[1]}-${cn[2].padStart(2, '0')}-${cn[3].padStart(2, '0')}`
  const parts = s.split(/[\/\-\.]/).map(Number)
  if (parts.length === 3 && parts.every((p) => !isNaN(p))) {
    if (parts[0] > 1000) return `${parts[0]}-${String(parts[1]).padStart(2, '0')}-${String(parts[2]).padStart(2, '0')}`
    if (parts[2] > 1000) return `${parts[2]}-${String(parts[1]).padStart(2, '0')}-${String(parts[0]).padStart(2, '0')}`
  }
  return s
}

function normalizeMeasurement(value: unknown): unknown {
  if (value && typeof value === 'object' && 'value' in value && 'unit' in value) return value
  const s = String(value ?? '').trim()
  if (!s) return s
  const match = s.match(/^([\d.]+)\s*(.+)$/)
  if (match) {
    const num = parseFloat(match[1])
    if (!isNaN(num)) return { value: num, unit: match[2].trim() }
  }
  return s
}

/** Apply generic normalization to extracted data (no template field types needed) */
function normalizeExtractedData(data: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(data)) {
    // Try date normalization for any field that looks like a date
    const strVal = typeof val === 'string' ? val.trim() : ''
    if (strVal && (/\d{4}[年/\-]\d{1,2}[月/\-]\d{1,2}/.test(strVal) || /^\d{4}-\d{2}-\d{2}$/.test(strVal))) {
      normalized[key] = normalizeDate(val)
    } else if (strVal && /^[\d.]+\s+\w+$/.test(strVal)) {
      normalized[key] = normalizeMeasurement(val)
    } else {
      normalized[key] = val
    }
  }
  return normalized
}

// ─── Merge fallback helper ──────────────────────────────────────────────────

async function mergeGroupWithFallback(
  openai: OpenAI,
  model: string,
  group: { groupId: string; groupKey: string },
  groupResults: AlignedPerFileResult[],
  abortSignal: AbortSignal,
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
    return await mergeGroupWithAI(openai, model, group.groupKey, group.groupId, successful, abortSignal)
  } catch {
    // Fallback to strategy merge
    const { data } = strategyMerge(successful.map(r => ({ data: r.data! as Record<string, unknown> })), 'first_wins')
    const imageResult = successful.find((r) => r.imageDataUrl)
    return {
      groupId: group.groupId,
      groupKey: group.groupKey,
      data,
      imageDataUrl: imageResult?.imageDataUrl,
      sourceFileNames: successful.map((r) => r.fileName),
      mergedCount: successful.length,
      mergeMethod: 'fallback_strategy',
      conflicts: [],
    }
  }
}

// ─── POST handler ────────────────────────────────────────────────────────────

const MAX_REQUEST_SIZE = 100 * 1024 * 1024 // 100MB

export async function POST(request: NextRequest) {
  const abortController = new AbortController()

  try {
    // Security: check request body size (content-length can be missing in chunked encoding)
    const contentLength = request.headers.get('content-length')
    if (contentLength && parseInt(contentLength, 10) > MAX_REQUEST_SIZE) {
      return new Response(JSON.stringify({ error: '请求体过大，最大允许 100MB' }), {
        status: 413,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Clone body stream and measure actual bytes as a safety net
    const bodyClone = request.clone()
    let actualSize = 0
    const reader = bodyClone.body?.getReader()
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        actualSize += value.byteLength
        if (actualSize > MAX_REQUEST_SIZE) {
          reader.cancel()
          return new Response(JSON.stringify({ error: '请求体过大，最大允许 100MB' }), {
            status: 413,
            headers: { 'Content-Type': 'application/json' },
          })
        }
      }
    }

    const body: ExtractRequestBody = await request.json()
    const {
      files,
      imageCompressThreshold = Number(process.env.IMAGE_COMPRESS_THRESHOLD) || 20,
    } = body

    // All model settings from .env (trim to avoid whitespace issues)
    const apiSettings: ApiSettings = {
      baseUrl: (process.env.API_BASE_URL || '').trim(),
      apiKey: (process.env.API_KEY || '').trim(),
      model: (process.env.API_MODEL || '').trim(),
      temperature: Number(process.env.API_TEMPERATURE) || 0.3,
    }

    if (!files || files.length === 0) {
      return new Response(JSON.stringify({ error: '没有提供文件' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (!apiSettings.baseUrl || !apiSettings.apiKey || !apiSettings.model) {
      return new Response(JSON.stringify({ error: 'API 设置不完整，请在 .env 中配置 API_BASE_URL, API_KEY, API_MODEL' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Security: SSRF prevention
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
          // ── Phase 0: File grouping ─────────────────────────────────────────
          send('phase', { phase: 'grouping' })
          const fileGroups = groupFilesByPrefix(files)
          send('grouping_done', { groups: fileGroups.map((g) => ({ groupId: g.groupId, label: g.groupKey, fileCount: g.files.length })) })

          // ── Phase 1: Per-file extraction ─────────────────────────────────
          send('phase', { phase: 'extracting' })
          const perFileResults: PerFileResult[] = []

          const MAX_RETRIES = 3

          await workerPool(files, 3, async (file, index) => {
            const fileId = String(index)
            const fileName = file.name
            const group = findGroupForFile(fileGroups, file.id)

            send('file_start', { fileId, fileName, groupId: group.groupId })

            const parsed = await parseFileContent(file, imageCompressThreshold)

            // Build prompt text
            let promptText = ''
            if (parsed.text) {
              promptText = TEXT_EXTRACTION_PREFIX + parsed.text
            } else {
              promptText = '请从文档中提取所有结构化信息。'
            }

            const contentParts: OpenAI.ChatCompletionContentPart[] = []
            contentParts.push({ type: 'text', text: promptText })

            // Add images
            if (parsed.images && parsed.images.length > 0) {
              for (const img of parsed.images) {
                contentParts.push({
                  type: 'image_url',
                  image_url: { url: img.dataUrl, detail: 'auto' },
                })
              }
            }

            const baseMessages: OpenAI.ChatCompletionMessageParam[] = [
              { role: 'system', content: EXTRACTION_SYSTEM_MESSAGE },
              { role: 'user', content: contentParts.length === 1 && contentParts[0].type === 'text'
                ? contentParts[0].text
                : contentParts as OpenAI.ChatCompletionContentPart[],
              },
            ]

            const requestOptions: Record<string, unknown> = {
              model: apiSettings.model,
              temperature: apiSettings.temperature ?? 0.1,
              stream: true,
            }

            if (isReasoningModel(apiSettings.model)) {
              requestOptions.reasoning_effort = 'low'
            }
            if (!apiSettings.model.toLowerCase().startsWith('o')) {
              requestOptions.response_format = { type: 'json_object' }
            }

            let lastError = ''

            for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
              try {
                if (attempt > 1) {
                  send('file_retry', { fileId, fileName, attempt })
                }

                // Each retry uses a fresh messages array (no conversation context)
                const completion = await openai.chat.completions.create(
                  { ...requestOptions, messages: baseMessages } as any,
                  { signal: AbortSignal.any([abortController.signal, AbortSignal.timeout(120_000)]) },
                )

                let fullContent = ''
                if (Symbol.asyncIterator in Object(completion)) {
                  for await (const chunk of completion as unknown as AsyncIterable<OpenAI.ChatCompletionChunk>) {
                    const delta = chunk.choices?.[0]?.delta?.content
                    if (delta) fullContent += delta
                  }
                } else {
                  const msg = (completion as unknown as OpenAI.ChatCompletion).choices?.[0]?.message
                  fullContent = msg?.content || ''
                }

                // Parse JSON with 5-layer fallback
                const extracted = parseJsonResponse(fullContent)
                const data = (extracted && typeof extracted === 'object' && !Array.isArray(extracted))
                  ? extracted as Record<string, unknown>
                  : { result: extracted }
                const normalizedData = normalizeExtractedData(data)

                let imageDataUrl: string | undefined
                if (file.dataUrl && /^data:image\//.test(file.dataUrl)) {
                  imageDataUrl = file.dataUrl
                }

                perFileResults.push({
                  fileId,
                  fileName,
                  groupId: group.groupId,
                  success: true,
                  data: normalizedData,
                  imageDataUrl,
                })

                send('file_complete', {
                  fileId,
                  fileName,
                  groupId: group.groupId,
                  success: true,
                  data: normalizedData,
                  imageDataUrl,
                })

                lastError = '' // clear on success
                break
              } catch (err) {
                lastError = err instanceof Error ? err.message : '未知错误'
              }
            }

            // All retries exhausted
            if (lastError) {
              perFileResults.push({
                fileId,
                fileName,
                groupId: group.groupId,
                success: false,
                error: lastError,
              })
              send('file_complete', {
                fileId,
                fileName,
                groupId: group.groupId,
                success: false,
                error: lastError,
              })
            }
          })

          // ── Phase 2: Schema alignment + flattening (before merge) ──────────
          send('phase', { phase: 'aligning' })
          const fieldPaths = collectFieldPaths(perFileResults)
          let schema
          try {
            schema = await alignSchemaWithAI(openai, apiSettings.model, fieldPaths, abortController.signal)
          } catch {
            schema = alignSchema(fieldPaths)
          }

          // Apply flattened schema to each PerFileResult
          const alignedResults = applyFlattenedSchemaToResults(perFileResults, schema)

          send('schema_ready', {
            headers: schema.field_order,
            totalRows: alignedResults.filter((r) => r.success).length,
          })

          // ── Phase 3: Group merge (fields now aligned and flat) ────────────
          send('phase', { phase: 'merging' })
          const mergedRecords: MergedRecord[] = []

          for (const group of fileGroups) {
            const groupAligned = alignedResults.filter((r) => r.groupId === group.groupId)

            send('merge_start', {
              groupId: group.groupId,
              label: group.groupKey,
              fileCount: groupAligned.length,
              successCount: groupAligned.filter((r) => r.success).length,
            })

            const merged = await mergeGroupWithFallback(openai, apiSettings.model, group, groupAligned, abortController.signal)
            mergedRecords.push(merged)

            send('group_merged', {
              groupId: merged.groupId,
              groupKey: merged.groupKey,
              sourceFileNames: merged.sourceFileNames,
              mergedCount: merged.mergedCount,
              mergeMethod: merged.mergeMethod,
              conflicts: merged.conflicts,
            })
          }

          // ── Final: build UnifiedSchema and send all_done ──────────────────
          const unifiedSchema = buildUnifiedSchemaFromMerged(mergedRecords, schema.field_order)

          send('all_done', {
            totalFiles: files.length,
            totalGroups: fileGroups.length,
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
