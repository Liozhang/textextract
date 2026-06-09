import { NextRequest } from 'next/server'
import OpenAI from 'openai'
import mammoth from 'mammoth'
import sharp from 'sharp'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { getTempDir } from '@/lib/temp-dir'

import { parseJsonResponse } from '@/lib/pipeline/json-parser'
import { isPrivateHost, sseEvent, workerPool, resolveApiSettings } from '@/lib/api-utils'
import { cleanupExpiredSessions } from '@/lib/server-cleanup'
import { writeResult, writeGroupsManifest, resultExists, readResult } from '@/lib/server-results'
import { isValidKey, cleanKeySuffix, normalizeKey, resolveTemplateColumnValue } from '@/lib/pipeline/merge-agent'
import { randomUUID } from 'crypto'

export const maxDuration = 300
import { groupFilesByPrefix, findGroupForFile } from '@/lib/pipeline/file-grouper'
import {
  EXTRACTION_SYSTEM_MESSAGE,
  TEXT_EXTRACTION_PREFIX,
  buildSchemaGuidedPrompt,
} from '@/lib/pipeline/prompts'
import { isReasoningModel, supportsJsonResponseFormat } from '@/lib/merge-utils'
import type { PerFileResult } from '@/lib/pipeline/types'

// ─── Key cleaning ─────────────────────────────────────────────────────────

/** Strip invalid keys from extracted data before writing to disk. */
function cleanResultKeys(
  data: Record<string, unknown> | undefined,
  entries: Array<Record<string, unknown>> | undefined,
): { data?: Record<string, unknown>; entries?: Array<Record<string, unknown>> } {
  const clean = (obj: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      const cleaned = normalizeKey(k);
      if (isValidKey(cleaned) && cleaned.length > 0) {
        out[cleaned] = v;
      }
    }
    return out;
  };
  return {
    data: data ? clean(data) : undefined,
    entries: entries ? entries.map(clean).filter((e) => Object.keys(e).length > 0) : undefined,
  };
}

type OpenAIError = Error & { status?: number }

// ─── Types ──────────────────────────────────────────────────────────────────

interface FileInput {
  id: string
  name: string
  size?: number
  type?: string
  content?: string
  dataUrl?: string
  /** When provided, read file from server temp storage: tmpdir/ocr-extract/{sessionId}/{id} */
  sessionId?: string
}

interface ApiSettings {
  baseUrl: string
  apiKey: string
  model: string
  temperature?: number
  concurrency: number
}

interface ExtractRequestBody {
  files: FileInput[]
  imageCompressThreshold?: number
  documentType?: string
  /** When true, skip cached results and re-extract all files */
  force?: boolean
  prompts?: {
    extraction?: string
  }
  apiSettings?: {
    baseUrl?: string
    apiKey?: string
    model?: string
    concurrency?: number
  }
  /** Schema columns for guided extraction (template-first mode) */
  templateColumns?: Array<{
    key: string
    type: 'string' | 'number' | 'boolean'
    description: string
    example?: string
    repeating?: boolean
  }>
}

// ─── File parsing ───────────────────────────────────────────────────────────

async function parseFileContent(file: FileInput, compressThreshold: number): Promise<{
  text: string
  images?: { dataUrl: string }[]
}> {
  const ext = file.name.split('.').pop()?.toLowerCase() || ''

  // Helper: extract base64 from dataUrl (used for binary files uploaded as dataUrl)
  const getBase64 = () => {
    if (file.sessionId) {
      // Server temp storage path
      const filePath = join(getTempDir(), file.sessionId, file.id)
      if (existsSync(filePath)) {
        return readFileSync(filePath).toString('base64')
      }
    }
    if (file.dataUrl) return file.dataUrl.replace(/^data:[^;]+;base64,/, '')
    if (file.content) return file.content
    return ''
  }

  switch (ext) {
    case 'docx': {
      const buffer = Buffer.from(getBase64(), 'base64')
      const result = await mammoth.extractRawText({ buffer })
      return { text: result.value }
    }

    case 'pdf': {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse = require('pdf-parse')
      const buffer = Buffer.from(getBase64(), 'base64')
      const result = await pdfParse(buffer)
      return { text: result.text }
    }

    case 'xlsx':
    case 'xls': {
      const XLSX = await import('xlsx')
      const buffer = Buffer.from(getBase64(), 'base64')
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
      const base64Data = getBase64()
      if (!base64Data) {
        return { text: '[图片文件无内容]', images: [] }
      }

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
        // Reconstruct dataUrl from base64 buffer
        const mimeType = file.type || 'image/png'
        finalDataUrl = `data:${mimeType};base64,${base64Data}`
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
    default: {
      // For text-based files, try server temp file first, then fallback to content
      if (file.sessionId) {
        const filePath = join(getTempDir(), file.sessionId, file.id)
        if (existsSync(filePath)) {
          const text = readFileSync(filePath, 'utf-8')
          return { text }
        }
      }
      return { text: file.content || '' }
    }
  }
}

// ─── Structure validation & deterministic flatten ───────────────────────────────

/** Allow at most one-level nesting: top-level values can be objects containing only primitives. */
function isAllowedStructure(data: Record<string, unknown>): boolean {
  for (const val of Object.values(data)) {
    if (val === null || val === undefined) continue
    if (Array.isArray(val)) return false
    if (typeof val === 'object') {
      for (const nestedVal of Object.values(val as Record<string, unknown>)) {
        if (nestedVal !== null && nestedVal !== undefined && typeof nestedVal === 'object') return false
      }
    }
  }
  return true
}

/**
 * Flatten nested object using hyphen-path keys (e.g. "血常规-白细胞(WBC)").
 */
function flattenObject(obj: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}-${key}` : key
    if (val === null || val === undefined) continue
    if (Array.isArray(val)) {
      result[fullKey] = val.map((v) => typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)).join('; ')
    } else if (typeof val === 'object') {
      Object.assign(result, flattenObject(val as Record<string, unknown>, fullKey))
    } else {
      result[fullKey] = val
    }
  }
  return result
}

// ─── POST handler ────────────────────────────────────────────────────────────

const MAX_REQUEST_SIZE = 100 * 1024 * 1024 // 100MB

export async function POST(request: NextRequest) {
  const abortController = new AbortController()

  try {
    // Security: check request body size via content-length header
    const contentLength = request.headers.get('content-length')
    if (contentLength && parseInt(contentLength, 10) > MAX_REQUEST_SIZE) {
      return new Response(JSON.stringify({ error: '请求体过大，最大允许 100MB' }), {
        status: 413,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      })
    }

    const body: ExtractRequestBody = await request.json()
    const {
      files,
      imageCompressThreshold = Number(process.env.IMAGE_COMPRESS_THRESHOLD) || 20,
      prompts: customPrompts,
      templateColumns,
      documentType,
      force = false,
    } = body

    // Resolve prompt: schema-guided or legacy
    // User custom extraction prompt is always supplementary (<user_instructions>), never replaces column definitions.
    const isSchemaMode = templateColumns && templateColumns.length > 0
    const extractionPrompt = isSchemaMode
      ? buildSchemaGuidedPrompt(templateColumns, customPrompts?.extraction, documentType)
      : (customPrompts?.extraction
        ? EXTRACTION_SYSTEM_MESSAGE + `\n\n<user_instructions>\n${customPrompts.extraction.trim()}\n</user_instructions>`
        : EXTRACTION_SYSTEM_MESSAGE)

    // Compute per-call timeout scaled to total request payload size.
    // Base: API_TIMEOUT env (default 120s) + 15s per MB of total body (covers
    // image base64 + JSON overhead). Conservative: over-estimates per-file need.
    // Fallback: if content-length is absent (chunked encoding), estimate from
    // parsed file data to avoid silent degradation to base timeout.
    const baseTimeout = Number(process.env.API_TIMEOUT) || 120_000
    // Schema mode needs longer timeout: entries JSON with many columns is much larger output
    const schemaCap = isSchemaMode ? 600_000 : 300_000
    // Per-file timeout: based on individual file size, capped at 300s (600s for schema).
    const computePerFileTimeout = (dataUrlLength: number, attempt: number): number => {
      const fileSizeMB = dataUrlLength / (1024 * 1024)
      const sizeTimeout = baseTimeout + Math.ceil(fileSizeMB * 10_000)
      const attemptFactor = attempt === 1 ? 1 : attempt === 2 ? 0.6 : 0.4
      return Math.min(schemaCap, Math.floor(sizeTimeout * attemptFactor))
    }

    // All model settings from .env, overridden by user-provided settings
    const resolved = resolveApiSettings(body.apiSettings)

    // Fire-and-forget: clean up expired temp sessions (use client-provided expiry)
    cleanupExpiredSessions(
      resolved.cacheExpiryHours ? resolved.cacheExpiryHours * 60 * 60 * 1000 : undefined,
    )

    const apiSettings: ApiSettings = {
      baseUrl: resolved.baseUrl,
      apiKey: resolved.apiKey,
      model: resolved.model,
      temperature: 0.1,
      concurrency: resolved.concurrency,
    }

    if (!files || files.length === 0) {
      return new Response(JSON.stringify({ error: '没有提供文件' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      })
    }

    if (!apiSettings.baseUrl || !apiSettings.apiKey || !apiSettings.model) {
      return new Response(JSON.stringify({ error: 'API 设置不完整，请在 .env 中配置 API_BASE_URL, API_KEY, API_MODEL' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      })
    }

    // Security: SSRF prevention
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

          // Derive sessionId from files (server upload session) or generate new one
          const resultSessionId = files.find((f) => f.sessionId)?.sessionId || randomUUID()

          // Write groups manifest to disk for align-merge
          await writeGroupsManifest(resultSessionId, fileGroups.map((g) => ({
            groupId: g.groupId,
            groupKey: g.groupKey,
            fileCount: g.files.length,
            fileIds: g.files.map((f) => f.id),
          })))

          // ── Phase 1: Per-file extraction ─────────────────────────────────
          send('phase', { phase: 'extracting' })
          // Lightweight metadata only — actual data written to disk via writeResult()
          const fileMeta: Array<{ fileId: string; fileName: string; groupId: string; success: boolean; error?: string }> = []

          const MAX_RETRIES = 3

          await workerPool(files, apiSettings.concurrency, async (file, index) => {
            const fileId = file.id
            const fileName = file.name
            const group = findGroupForFile(fileGroups, file.id)
            // Preserve existing groupId from disk (retries may create new groupIds)
            const existingResult = await readResult(resultSessionId, fileId)
            const groupId = existingResult?.groupId || group.groupId

            send('file_start', { fileId, fileName, groupId: groupId })

            // Check for cached result — skip AI call if already extracted (unless force)
            const cached = force ? null : await resultExists(resultSessionId, fileId)
            if (cached) {
              fileMeta.push({ fileId, fileName, groupId: groupId, success: true })
              send('file_complete', {
                fileId,
                fileName,
                groupId: groupId,
                success: true,
                data: cached.data,
                entries: cached.entries,
                headerData: cached.headerData,
              })
              return
            }

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
                  image_url: { url: img.dataUrl, detail: 'high' },
                })
              }
            }

            const baseMessages: OpenAI.ChatCompletionMessageParam[] = [
              { role: 'system', content: extractionPrompt },
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
            if (supportsJsonResponseFormat(apiSettings.model)) {
              requestOptions.response_format = { type: 'json_object' }
            }

            let lastError = ''
            let retryMessages: OpenAI.ChatCompletionMessageParam[] = [...baseMessages]
            const fileDataLen = file.dataUrl?.length || 0

            // Helper: await next chunk with stall detection (timeout cleared on success)
            async function nextChunkWithStallCheck(
              iter: AsyncIterator<OpenAI.ChatCompletionChunk>,
              StallTimeout: number,
            ): Promise<IteratorResult<OpenAI.ChatCompletionChunk>> {
              let timer: ReturnType<typeof setTimeout> | undefined
              try {
                return await Promise.race([
                  iter.next(),
                  new Promise<never>((_, reject) => {
                    timer = setTimeout(() => reject(new Error('STALL')), StallTimeout)
                  }),
                ])
              } finally {
                if (timer) clearTimeout(timer)
              }
            }

            for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
              const perCallTimeout = computePerFileTimeout(fileDataLen, attempt)
              try {
                if (attempt > 1) {
                  send('file_retry', { fileId, fileName, attempt })
                }

                const completion = await openai.chat.completions.create(
                  { ...requestOptions, messages: retryMessages } as any,
                  { signal: AbortSignal.any([abortController.signal, AbortSignal.timeout(perCallTimeout)]) },
                )

                let fullContent = ''
                let stalled = false
                if (Symbol.asyncIterator in Object(completion)) {
                  const STALL_TIMEOUT = isSchemaMode ? 60_000 : 30_000 // schema mode: 60s (more output), legacy: 30s
                  const iter = (completion as unknown as AsyncIterable<OpenAI.ChatCompletionChunk>)[Symbol.asyncIterator]()
                  let firstTokenReceived = false
                  const streamDeadline = Date.now() + perCallTimeout

                  while (Date.now() < streamDeadline) {
                    let chunk: OpenAI.ChatCompletionChunk | undefined
                    try {
                      // Only apply stall detection after first token received
                      // (model may need >30s to process images before generating first token)
                      const result = firstTokenReceived
                        ? await nextChunkWithStallCheck(iter, STALL_TIMEOUT)
                        : await iter.next()
                      if (result.done) break
                      chunk = result.value
                    } catch (e) {
                      if ((e as Error).message === 'STALL') {
                        let fieldCount = 0
                        try {
                          fieldCount = Object.keys(parseJsonResponse(fullContent) as Record<string, unknown>).length
                        } catch { /* ignore parse errors in stall message */ }
                        lastError = `Token 停顿超过 ${STALL_TIMEOUT / 1000}s（已收到 ${fieldCount} 个字段）`
                        stalled = true
                        break
                      }
                      throw e
                    }

                    const delta = chunk?.choices?.[0]?.delta
                    // Count both content and reasoning_content as "active" tokens
                    // to avoid false stall detection during model thinking phase
                    const contentDelta = delta?.content
                    const reasoningDelta = (delta as Record<string, unknown> | undefined)?.reasoning_content
                    if (contentDelta) {
                      firstTokenReceived = true
                      fullContent += contentDelta
                    } else if (reasoningDelta) {
                      firstTokenReceived = true
                    }
                  }
                  // Stream deadline exceeded — treat as timeout
                  if (Date.now() >= streamDeadline && !stalled) {
                    let fieldCount = 0
                    try {
                      fieldCount = Object.keys(parseJsonResponse(fullContent) as Record<string, unknown>).length
                    } catch { /* ignore */ }
                    lastError = `流式读取超时 (${Math.round(perCallTimeout / 1000)}s，已收到 ${fieldCount} 个字段)`
                    stalled = true
                  }
                } else {
                  const msg = (completion as unknown as OpenAI.ChatCompletion).choices?.[0]?.message
                  fullContent = msg?.content || ''
                }

                // Skip parsing on stall — partial content is unreliable, retry with context
                if (stalled) {
                  if (fullContent) {
                    retryMessages = [
                      ...baseMessages,
                      { role: 'assistant' as const, content: fullContent },
                      { role: 'user' as const, content: `上一次提取中途停顿，返回内容不完整。请重新提取所有字段，只返回纯 JSON 对象。` },
                    ]
                  }
                  continue
                }

                // Parse JSON — separate try/catch for parse errors vs API errors
                let extracted: unknown
                try {
                  extracted = parseJsonResponse(fullContent)
                } catch (parseErr) {
                  // Parse failed — append feedback to conversation for next retry
                  retryMessages = [
                    ...baseMessages,
                    { role: 'assistant' as const, content: fullContent },
                    { role: 'user' as const, content: `上一次返回的不是合法 JSON。错误：${parseErr instanceof Error ? parseErr.message : '解析失败'}。请只返回 ${isSchemaMode ? '{"entries":[...]}' : '纯 JSON 对象'}，不要包含 markdown 标记或解释文本。` },
                  ]
                  lastError = `JSON 解析失败: ${parseErr instanceof Error ? parseErr.message : ''}`
                  continue
                }

                // ── Schema-guided mode: expect {单值字段..., entries: [...]} ──
                if (isSchemaMode) {
                  let headerData: Record<string, unknown> = {}
                  let entries: Array<Record<string, unknown>> = []

                  if (extracted && typeof extracted === 'object' && !Array.isArray(extracted)) {
                    const obj = extracted as Record<string, unknown>

                    // Extract top-level single-value fields (non-entries keys)
                    const repeatingKeys = new Set(
                      templateColumns.filter((c) => c.repeating).map((c) => normalizeKey(c.key)),
                    )
                    for (const [k, v] of Object.entries(obj)) {
                      if (k === 'entries') continue
                      if (repeatingKeys.has(normalizeKey(k))) continue
                      headerData[normalizeKey(k)] = v
                    }

                    // Extract entries array
                    if (Array.isArray(obj.entries)) {
                      entries = obj.entries.filter((e) => e && typeof e === 'object' && !Array.isArray(e))
                    }
                  }

                  // Validate headerData against single-value columns (with fuzzy matching)
                  const singleCols = templateColumns.filter((c) => !c.repeating)
                  const repeatingCols = templateColumns.filter((c) => c.repeating)

                  if (singleCols.length > 0) {
                    const normIndex = new Map<string, unknown>()
                    for (const [k, v] of Object.entries(headerData)) {
                      normIndex.set(normalizeKey(k), v)
                    }
                    const validatedHeader: Record<string, unknown> = {}
                    for (const col of singleCols) {
                      validatedHeader[col.key] = headerData[col.key]
                        ?? resolveTemplateColumnValue(col.key, normIndex)
                        ?? null
                    }
                    headerData = validatedHeader
                  }

                  // Validate entries against repeating columns (with fuzzy matching)
                  const entryColumns = repeatingCols.length > 0 ? repeatingCols : templateColumns
                  const validatedEntries = entries.map((entry) => {
                    const normIndex = new Map<string, unknown>()
                    for (const [k, v] of Object.entries(entry)) {
                      normIndex.set(normalizeKey(k), v)
                    }
                    const row: Record<string, unknown> = {}
                    for (const col of entryColumns) {
                      row[col.key] = entry[col.key] ?? resolveTemplateColumnValue(col.key, normIndex) ?? null
                    }
                    return row
                  })

                  // Guard: at least one entry
                  if (validatedEntries.length === 0) {
                    retryMessages = [
                      ...baseMessages,
                      { role: 'assistant' as const, content: fullContent },
                      { role: 'user' as const, content: '上一次返回了空 entries 数组。请从文档中提取信息，输出 {"姓名": "张三", "entries": [{...}]} 格式。' },
                    ]
                    lastError = 'Schema 模式提取结果为空（无 entries）'
                    continue
                  }

                  // Guard: headerData or entries must have non-null values
                  const hasAnyData = Object.values(headerData).some((v) => v !== null && v !== undefined)
                    || validatedEntries.some(
                      (entry) => Object.values(entry).some((v) => v !== null && v !== undefined),
                    )
                  if (!hasAnyData) {
                    retryMessages = [
                      ...baseMessages,
                      { role: 'assistant' as const, content: fullContent },
                      { role: 'user' as const, content: '上一次返回的所有字段值均为 null。请从文档中提取实际数据，单值字段放在顶层，多值字段放在 entries 中。' },
                    ]
                    lastError = 'Schema 模式所有字段值均为 null'
                    continue
                  }

                  let imageDataUrl: string | undefined
                  if (file.dataUrl && /^data:image\//.test(file.dataUrl)) {
                    imageDataUrl = file.dataUrl
                  }

                  const cleanedHeader = cleanResultKeys(headerData, undefined).data
                  const cleanedEntries = cleanResultKeys(undefined, validatedEntries).entries

                  await writeResult(resultSessionId, {
                    fileId, fileName, groupId: groupId,
                    success: true,
                    entries: cleanedEntries,
                    headerData: cleanedHeader && Object.keys(cleanedHeader).length > 0 ? cleanedHeader : undefined,
                  })
                  fileMeta.push({ fileId, fileName, groupId: groupId, success: true })

                  send('file_complete', {
                    fileId,
                    fileName,
                    groupId: groupId,
                    success: true,
                    data: undefined,
                    entries: cleanedEntries,
                    headerData: cleanedHeader && Object.keys(cleanedHeader).length > 0 ? cleanedHeader : undefined,
                  })

                  lastError = ''
                  break
                }

                // ── Legacy mode: flat object extraction ──
                const data = (extracted && typeof extracted === 'object' && !Array.isArray(extracted))
                  ? extracted as Record<string, unknown>
                  : { result: extracted }

                // Flatten if structure exceeds one-level nesting
                let finalData = data
                if (!isAllowedStructure(data)) {
                  finalData = flattenObject(data)
                }
                // Auto-flatten: single top-level key with object value → unwrap
                if (Object.keys(finalData).length === 1) {
                  const singleVal = Object.values(finalData)[0]
                  if (singleVal && typeof singleVal === 'object' && !Array.isArray(singleVal)) {
                    finalData = flattenObject(finalData)
                  }
                }

                let imageDataUrl: string | undefined
                if (file.dataUrl && /^data:image\//.test(file.dataUrl)) {
                  imageDataUrl = file.dataUrl
                }

                // Post-processing guards
                // Guard against empty results
                if (Object.keys(finalData).length === 0) {
                  retryMessages = [
                    ...baseMessages,
                    { role: 'assistant' as const, content: fullContent },
                    { role: 'user' as const, content: '上一次返回了空对象 {}，未提取到任何字段。请从文档中提取所有可识别的结构化信息，只返回纯 JSON 对象。' },
                  ]
                  lastError = '提取结果为空'
                  continue
                }

                // Guard against too-few fields (<2 fields is almost always a parse/model failure)
                const MIN_FIELDS = 2
                if (Object.keys(finalData).length < MIN_FIELDS) {
                  retryMessages = [
                    ...baseMessages,
                    { role: 'assistant' as const, content: fullContent },
                    { role: 'user' as const, content: `上一次返回仅包含 ${Object.keys(finalData).length} 个字段，字段数过少。请从文档中提取所有可识别的结构化字段，至少应包含多个字段。只返回纯 JSON 对象。` },
                  ]
                  lastError = `提取字段过少（仅 ${Object.keys(finalData).length} 个字段）`
                  continue
                }

                // Guard against malformed keys (e.g., ": :" prefix, empty keys)
                const cleanedData: Record<string, unknown> = {}
                for (const [k, v] of Object.entries(finalData)) {
                  const cleanedKey = k.replace(/^[\s:;|，、\-]+/, '').trim()
                  if (cleanedKey) cleanedData[cleanedKey] = v
                }
                finalData = cleanedData

                // Guard against concatenated table-header keys (too many hyphen segments)
                const suspiciousKeys = Object.keys(finalData).filter(k => k.split('-').length > 5)
                if (suspiciousKeys.length > 0) {
                  retryMessages = [
                    ...baseMessages,
                    { role: 'assistant' as const, content: fullContent },
                    { role: 'user' as const, content: `上一次返回的键名疑似将表头拼接为一个键（${suspiciousKeys.slice(0, 3).join(', ')}）。每个字段必须是独立的短键名，禁止将多个表头合并为一个键。只返回纯 JSON 对象。` },
                  ]
                  lastError = `疑似表格键名连接: ${suspiciousKeys.slice(0, 3).join(', ')}`
                  continue
                }

                const cleaned2 = cleanResultKeys(finalData, undefined)

                await writeResult(resultSessionId, {
                  fileId, fileName, groupId: groupId,
                  success: true, data: cleaned2.data,
                })
                fileMeta.push({ fileId, fileName, groupId: groupId, success: true })

                send('file_complete', {
                  fileId,
                  fileName,
                  groupId: groupId,
                  success: true,
                  data: cleaned2.data,
                })

                lastError = ''
                break
              } catch (err) {
                // API/network error — reset conversation context + backoff
                retryMessages = [...baseMessages]
                if (err instanceof Error) {
                  const apiErr = err as OpenAIError
                  if (apiErr.status) {
                    lastError = `API ${apiErr.status}: ${err.message}`
                    // Extra wait on rate limit before next retry
                    if (apiErr.status === 429) {
                      await new Promise((resolve) => setTimeout(resolve, 5000))
                    } else {
                      const delayMs = Math.min(4000, 1000 * Math.pow(2, attempt - 1))
                      await new Promise((resolve) => setTimeout(resolve, delayMs))
                    }
                  } else if (err.name === 'AbortError' || err.name === 'TimeoutError') {
                    lastError = `请求超时 (${Math.round(perCallTimeout / 1000)}s)`
                  } else {
                    lastError = err.message
                  }
                } else {
                  lastError = '未知错误'
                }
              }
            }

            // All retries exhausted
            if (lastError && isSchemaMode) {
              // Schema mode failed — fallback: one legacy attempt without schema constraints
              send('file_retry', { fileId, fileName, attempt: MAX_RETRIES + 1 })
              const legacyPrompt = customPrompts?.extraction
                ? EXTRACTION_SYSTEM_MESSAGE + `\n\n<user_instructions>\n${customPrompts.extraction.trim()}\n</user_instructions>`
                : EXTRACTION_SYSTEM_MESSAGE
              const legacyMessages: OpenAI.ChatCompletionMessageParam[] = [
                { role: 'system', content: legacyPrompt },
                baseMessages[1], // user message with image content
              ]
              const legacyTimeout = Math.min(300_000, Math.floor((baseTimeout + Math.ceil(fileDataLen / (1024 * 1024) * 10_000))))
              try {
                const legacyCompletion = await openai.chat.completions.create(
                  { ...requestOptions, messages: legacyMessages, stream: false } as any,
                  { signal: AbortSignal.any([abortController.signal, AbortSignal.timeout(legacyTimeout)]) },
                )
                const legacyFull = (legacyCompletion as unknown as OpenAI.ChatCompletion).choices?.[0]?.message?.content || ''
                const legacyExtracted = parseJsonResponse(legacyFull)
                if (legacyExtracted && typeof legacyExtracted === 'object' && !Array.isArray(legacyExtracted) && Object.keys(legacyExtracted).length > 0) {
                  const cleaned3 = cleanResultKeys(legacyExtracted as Record<string, unknown>, undefined)
                  await writeResult(resultSessionId, {
                    fileId, fileName, groupId: groupId,
                    success: true, data: cleaned3.data,
                  })
                  fileMeta.push({ fileId, fileName, groupId: groupId, success: true })
                  send('file_complete', {
                    fileId,
                    fileName,
                    groupId: groupId,
                    success: true,
                    data: cleaned3.data,
                  })
                  lastError = ''
                } else {
                  await writeResult(resultSessionId, {
                    fileId, fileName, groupId: groupId,
                    success: false, error: lastError,
                  })
                  fileMeta.push({ fileId, fileName, groupId: groupId, success: false, error: lastError })
                  send('file_complete', { fileId, fileName, groupId: groupId, success: false, error: lastError })
                }
              } catch {
                await writeResult(resultSessionId, {
                  fileId, fileName, groupId: groupId,
                  success: false, error: lastError,
                })
                fileMeta.push({ fileId, fileName, groupId: groupId, success: false, error: lastError })
                send('file_complete', { fileId, fileName, groupId: groupId, success: false, error: lastError })
              }
            } else if (lastError) {
              await writeResult(resultSessionId, {
                fileId, fileName, groupId: groupId,
                success: false, error: lastError,
              })
              fileMeta.push({ fileId, fileName, groupId: groupId, success: false, error: lastError })
              send('file_complete', {
                fileId,
                fileName,
                groupId: groupId,
                success: false,
                error: lastError,
              })
            }
          })

          // ── Send extraction_done with results and groups ──────────────────
          // Send extraction_done with results and groups (include imageDataUrl for preview)
          send('extraction_done', {
            sessionId: resultSessionId,
            results: fileMeta,
            groups: fileGroups.map((g) => ({
              groupId: g.groupId,
              groupKey: g.groupKey,
              fileCount: g.files.length,
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
