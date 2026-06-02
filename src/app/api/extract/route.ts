import { NextRequest } from 'next/server'
import OpenAI from 'openai'
import mammoth from 'mammoth'
import sharp from 'sharp'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

import { parseJsonResponse } from '@/lib/pipeline/json-parser'

export const maxDuration = 300
import { groupFilesByPrefix, findGroupForFile } from '@/lib/pipeline/file-grouper'
import {
  EXTRACTION_SYSTEM_MESSAGE,
  TEXT_EXTRACTION_PREFIX,
} from '@/lib/pipeline/prompts'
import { isReasoningModel, supportsJsonResponseFormat } from '@/lib/merge-utils'
import { normalizePostExtraction } from '@/lib/pipeline/post-normalizer'
import type { PerFileResult } from '@/lib/pipeline/types'

type OpenAIError = Error & { status?: number }

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
  /** When provided, read file from server temp storage: tmpdir/ocr-extract/{sessionId}/{id} */
  sessionId?: string
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
  prompts?: {
    extraction?: string
  }
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

  // Helper: extract base64 from dataUrl (used for binary files uploaded as dataUrl)
  const getBase64 = () => {
    if (file.sessionId) {
      // Server temp storage path
      const filePath = join(tmpdir(), 'ocr-extract', file.sessionId, file.id)
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
        const filePath = join(tmpdir(), 'ocr-extract', file.sessionId, file.id)
        if (existsSync(filePath)) {
          const text = readFileSync(filePath, 'utf-8')
          return { text }
        }
      }
      return { text: file.content || '' }
    }
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

// ─── Flat validation ──────────────────────────────────────────────────────────

function isFlat(data: Record<string, unknown>): boolean {
  for (const val of Object.values(data)) {
    if (val !== null && typeof val === 'object') return false
  }
  return true
}

const FLATTEN_RETRY_SYSTEM = `你上一次的输出包含了嵌套对象或数组，这不符合要求。请严格按以下规则重新输出：

1. 所有信息必须在 JSON 的第一层级，绝对禁止嵌套对象 {} 和数组 []
2. 所有值只能是字符串、数字或布尔类型
3. 逻辑分类通过键名中的连字符 "-" 体现（如 "模块-子项"）
4. 多个同类项用英文分号 ";" 拼接为一个字符串
5. 带单位的数据保留数值和单位在一个字符串中
6. 仅输出纯 JSON，不要任何解释性文本或代码块标记`

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
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const body: ExtractRequestBody = await request.json()
    const {
      files,
      imageCompressThreshold = Number(process.env.IMAGE_COMPRESS_THRESHOLD) || 20,
      prompts: customPrompts,
    } = body

    // Resolve prompt: custom override or default
    const extractionPrompt = customPrompts?.extraction || EXTRACTION_SYSTEM_MESSAGE

    // Compute per-call timeout scaled to total request payload size.
    // Base: API_TIMEOUT env (default 120s) + 15s per MB of total body (covers
    // image base64 + JSON overhead). Conservative: over-estimates per-file need.
    // Fallback: if content-length is absent (chunked encoding), estimate from
    // parsed file data to avoid silent degradation to base timeout.
    const baseTimeout = Number(process.env.API_TIMEOUT) || 120_000
    let bodySizeMB = contentLength ? parseInt(contentLength, 10) / (1024 * 1024) : 0
    if (bodySizeMB === 0 && files.length > 0) {
      const estimatedBytes = files.reduce((sum, f) => sum + (f.dataUrl?.length || 0) + (f.content?.length || 0), 0)
      bodySizeMB = estimatedBytes / (1024 * 1024)
    }
    const perCallTimeout = Math.min(600_000, baseTimeout + Math.ceil(bodySizeMB * 15_000))

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
            const fileId = file.id
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

            for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
              try {
                if (attempt > 1) {
                  send('file_retry', { fileId, fileName, attempt })
                  // Exponential backoff: 1s, 2s, 4s
                  const delayMs = Math.min(4000, 1000 * Math.pow(2, attempt - 2))
                  await new Promise((resolve) => setTimeout(resolve, delayMs))
                }

                // Each retry uses a fresh messages array (no conversation context)
                const completion = await openai.chat.completions.create(
                  { ...requestOptions, messages: baseMessages } as any,
                  { signal: AbortSignal.any([abortController.signal, AbortSignal.timeout(perCallTimeout)]) },
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

                // Validate flat structure — retry with flatten prompt if nested
                let finalData = data
                if (!isFlat(data)) {
                  try {
                    const flatMessages: OpenAI.ChatCompletionMessageParam[] = [
                      { role: 'system', content: FLATTEN_RETRY_SYSTEM },
                      {
                        role: 'user',
                        content: `以下是需要展平的 JSON 数据：\n\n${JSON.stringify(data)}\n\n请按照上述规则输出完全扁平化的 JSON。`,
                      },
                    ]
                    const flatCompletion = await openai.chat.completions.create(
                      { ...requestOptions, messages: flatMessages } as any,
                      { signal: AbortSignal.any([abortController.signal, AbortSignal.timeout(perCallTimeout)]) },
                    )
                    let flatContent = ''
                    if (Symbol.asyncIterator in Object(flatCompletion)) {
                      for await (const chunk of flatCompletion as unknown as AsyncIterable<OpenAI.ChatCompletionChunk>) {
                        const delta = chunk.choices?.[0]?.delta?.content
                        if (delta) flatContent += delta
                      }
                    } else {
                      const msg = (flatCompletion as unknown as OpenAI.ChatCompletion).choices?.[0]?.message
                      flatContent = msg?.content || ''
                    }
                    const flatParsed = parseJsonResponse(flatContent)
                    if (flatParsed && typeof flatParsed === 'object' && !Array.isArray(flatParsed) && isFlat(flatParsed as Record<string, unknown>)) {
                      finalData = flatParsed as Record<string, unknown>
                    }
                  } catch {
                    // Flatten retry failed — proceed with original data (Phase 2 schema-flattener handles nested structures)
                  }
                }

                let imageDataUrl: string | undefined
                if (file.dataUrl && /^data:image\//.test(file.dataUrl)) {
                  imageDataUrl = file.dataUrl
                }

                perFileResults.push({
                  fileId,
                  fileName,
                  groupId: group.groupId,
                  success: true,
                  data: finalData,
                  imageDataUrl,
                })

                // Normalize each result immediately after extraction
                normalizePostExtraction(perFileResults[perFileResults.length - 1])

                send('file_complete', {
                  fileId,
                  fileName,
                  groupId: group.groupId,
                  success: true,
                  data: perFileResults[perFileResults.length - 1].data,
                })

                lastError = '' // clear on success
                break
              } catch (err) {
                if (err instanceof Error) {
                  const apiErr = err as OpenAIError
                  if (apiErr.status) {
                    lastError = `API ${apiErr.status}: ${err.message}`
                    // Extra wait on rate limit before next retry
                    if (apiErr.status === 429) {
                      await new Promise((resolve) => setTimeout(resolve, 5000))
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

          // ── Send extraction_done with results and groups ──────────────────
          // Send extraction_done with results and groups (include imageDataUrl for preview)
          send('extraction_done', {
            results: perFileResults.map((r) => ({
              fileId: r.fileId,
              fileName: r.fileName,
              groupId: r.groupId,
              success: r.success,
              data: r.data,
              error: r.error,
              imageDataUrl: r.imageDataUrl,
            })),
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
