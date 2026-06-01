import { NextRequest } from 'next/server'
import OpenAI from 'openai'
import mammoth from 'mammoth'
import sharp from 'sharp'

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
  name: string
  content?: string
  dataUrl?: string
}

interface TemplateField {
  name: string
  type: string
  required?: boolean
  description?: string
}

interface Template {
  prompt: string
  fields: TemplateField[]
}

interface ApiSettings {
  baseUrl: string
  apiKey: string
  model: string
  temperature?: number
}

interface ExtractRequestBody {
  files: FileInput[]
  template: Template
  imageCompressThreshold?: number
}

// ─── Helper: send SSE event ─────────────────────────────────────────────────

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

// ─── Helper: detect if model is a reasoning model ────────────────────────────

function isReasoningModel(model: string): boolean {
  const lower = model.toLowerCase()
  // StepFun step-* models, OpenAI o-series models, and DeepSeek models
  return /^(o[13]-|o4-|step-|deepseek-)/.test(lower)
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
        // Use PNG for transparency support, JPEG for photos
        const isPng = ext === 'png' || ext === 'gif' || ext === 'webp'
        const compressedBuffer = isPng
          ? await sharp(buffer).png({ quality: 80 }).toBuffer()
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

// ─── 5-layer JSON Parsing ──────────────────────────────────────────────────

function parseJsonResponse(text: string): unknown {
  if (!text || !text.trim()) {
    throw new Error('模型返回内容为空')
  }

  const trimmed = text.trim()

  // Layer 1: Direct JSON.parse
  try {
    return JSON.parse(trimmed)
  } catch {
    // continue to next layer
  }

  // Layer 2: Extract JSON from markdown code blocks
  const codeBlockRegex = /```(?:json)?\s*\n?([\s\S]*?)\n?```/
  const codeBlockMatch = trimmed.match(codeBlockRegex)
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim())
    } catch {
      // continue
    }
  }

  // Layer 3: Find JSON object/array using regex
  const objectMatch = trimmed.match(/\{[\s\S]*\}/)
  if (objectMatch) {
    try {
      return JSON.parse(objectMatch[0])
    } catch {
      // try the longest match
      let bestMatch = ''
      let depth = 0
      let start = -1
      for (let i = 0; i < trimmed.length; i++) {
        if (trimmed[i] === '{') {
          if (depth === 0) start = i
          depth++
        } else if (trimmed[i] === '}') {
          depth--
          if (depth === 0 && start >= 0) {
            const candidate = trimmed.substring(start, i + 1)
            if (candidate.length > bestMatch.length) bestMatch = candidate
          }
        }
      }
      if (bestMatch) {
        try {
          return JSON.parse(bestMatch)
        } catch {
          // continue
        }
      }
    }
  }

  const arrayMatch = trimmed.match(/\[[\s\S]*\]/)
  if (arrayMatch) {
    try {
      return JSON.parse(arrayMatch[0])
    } catch {
      // continue
    }
  }

  // Layer 4: Split by commas/semicolons and try to parse segments
  const segments = trimmed.split(/[;,]/).map(s => s.trim()).filter(Boolean)
  for (const seg of segments) {
    // Try wrapping in braces/brackets
    for (const wrapper of ['{', '[']) {
      const closing = wrapper === '{' ? '}' : ']'
      try {
        return JSON.parse(wrapper + seg + closing)
      } catch {
        // continue
      }
    }
    // Try parsing as-is
    try {
      const parsed = JSON.parse(seg)
      if (typeof parsed === 'object' && parsed !== null) return parsed
    } catch {
      // continue
    }
  }

  // Layer 5: Regex to find key-value patterns and construct JSON
  const kvRegex = /["']?(\w+)["']?\s*[:：]\s*["']?([^"'}\],]+)["']?/g
  const kvResult: Record<string, string> = {}
  let kvMatch
  while ((kvMatch = kvRegex.exec(trimmed)) !== null) {
    kvResult[kvMatch[1].trim()] = kvMatch[2].trim()
  }
  if (Object.keys(kvResult).length > 0) {
    return kvResult
  }

  throw new Error('无法解析模型返回的JSON内容: ' + trimmed.substring(0, 200))
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

// ─── Separate regions from values ─────────────────────────────────────────────

interface FieldRegion {
  x: number
  y: number
  width: number
  height: number
}

/** Top-level keys that are coordinate/metadata, not actual data fields */
const COORD_META_KEYS = new Set(['x', 'y', 'width', 'height', 'value', 'label', 'confidence', 'source', 'polygon', 'attributes'])

function separateRegionsAndValues(
  extracted: unknown
): { data: Record<string, unknown>; regions: Record<string, FieldRegion> } {
  const data: Record<string, unknown> = {}
  const regions: Record<string, FieldRegion> = {}

  if (extracted && typeof extracted === 'object' && !Array.isArray(extracted)) {
    for (const [key, val] of Object.entries(extracted as Record<string, unknown>)) {
      // Skip standalone coordinate/metadata keys leaked by AI
      if (COORD_META_KEYS.has(key)) continue

      if (val && typeof val === 'object' && !Array.isArray(val) && 'value' in val) {
        // Coordinate-aware format: { value, x, y, width, height }
        const obj = val as Record<string, unknown>
        data[key] = obj.value
        if (
          typeof obj.x === 'number' &&
          typeof obj.y === 'number' &&
          typeof obj.width === 'number' &&
          typeof obj.height === 'number'
        ) {
          regions[key] = { x: obj.x, y: obj.y, width: obj.width, height: obj.height }
        }
      } else {
        // Plain format: just the value, no coordinates
        data[key] = val
      }
    }
  } else {
    // Non-object result — use as-is, no regions
    return { data: { result: extracted }, regions: {} }
  }

  return { data, regions }
}

// ─── Post-extraction validation ────────────────────────────────────────────

/** Normalize Chinese date formats to YYYY-MM-DD */
function normalizeDate(value: unknown): string {
  const s = String(value ?? '').trim()
  if (!s) return s

  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s

  // Chinese date: 2024年1月15日, 2024年01月15日
  const cn = s.match(/(\d{4})年(\d{1,2})月(\d{1,2})日?/)
  if (cn) return `${cn[1]}-${cn[2].padStart(2, '0')}-${cn[3].padStart(2, '0')}`

  // Slash format: 2024/01/15 or 15/01/2024
  const parts = s.split(/[\/\-\.]/).map(Number)
  if (parts.length === 3 && parts.every((p) => !isNaN(p))) {
    if (parts[0] > 1000) return `${parts[0]}-${String(parts[1]).padStart(2, '0')}-${String(parts[2]).padStart(2, '0')}`
    if (parts[2] > 1000) return `${parts[2]}-${String(parts[1]).padStart(2, '0')}-${String(parts[0]).padStart(2, '0')}`
  }

  return s
}

/** Normalize measurement fields: extract {value, unit} or plain string */
function normalizeMeasurement(value: unknown): unknown {
  if (value && typeof value === 'object' && 'value' in value && 'unit' in value) {
    return value // Already structured from AI
  }
  const s = String(value ?? '').trim()
  if (!s) return s
  // Try to extract number + unit: "120 mmHg", "36.5℃", "5mg/kg"
  const match = s.match(/^([\d.]+)\s*(.+)$/)
  if (match) {
    const num = parseFloat(match[1])
    if (!isNaN(num)) return { value: num, unit: match[2].trim() }
  }
  return s
}

/** Apply type-specific normalization to extracted data based on template */
function applyTypeNormalization(
  data: Record<string, unknown>,
  fields: TemplateField[],
): Record<string, unknown> {
  const fieldMap = new Map(fields.map((f) => [f.name, f.type]))
  const normalized: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(data)) {
    const type = fieldMap.get(key)
    if (type === 'date') normalized[key] = normalizeDate(val)
    else if (type === 'measurement') normalized[key] = normalizeMeasurement(val)
    else normalized[key] = val
  }
  return normalized
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

    const body: ExtractRequestBody = await request.json()
    const {
      files,
      template,
      imageCompressThreshold = Number(process.env.IMAGE_COMPRESS_THRESHOLD) || 20,
    } = body

    // All model settings from .env
    const apiSettings: ApiSettings = {
      baseUrl: process.env.API_BASE_URL || '',
      apiKey: process.env.API_KEY || '',
      model: process.env.API_MODEL || '',
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

    // Security: SSRF prevention - block private/internal IPs
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

        const results: { fileId: number; fileName: string; success: boolean; data?: unknown; error?: string }[] = []
        let successCount = 0
        let errorCount = 0

        const systemMessage = '你是一个专业的文档内容提取助手。请严格按照用户要求的字段格式提取信息，以JSON格式返回。'

        await workerPool(files, 3, async (file, index) => {
          const fileId = index
          const fileName = file.name

          send('file_start', { fileId, fileName })

          try {
            // Parse file content
            const parsed = await parseFileContent(file, imageCompressThreshold)

            // Build user message
            const hasFields = template.fields.length > 0
            const fieldDescriptions = hasFields
              ? template.fields
                  .map((f) => {
                    let desc = `- ${f.name}`;
                    if (f.type === 'date') desc += '：请统一为YYYY-MM-DD格式';
                    if (f.type === 'measurement') desc += '：请返回格式 {"value": 数值, "unit": "单位"}';
                    if (f.description) desc += `（${f.description}）`;
                    return desc;
                  })
                  .join('\n') + '\n\n' +
                `仅提取上述列出的字段名对应的数据，不要添加任何额外字段。字段类型为${template.fields.map(f => f.type).join(', ')}。`
              : ''

            const hasImages = parsed.images && parsed.images.length > 0
            const isImageFile = file.dataUrl && /^data:image\//.test(file.dataUrl)

            const contentParts: OpenAI.ChatCompletionContentPart[] = []

            // Build prompt text
            let promptText = template.prompt
            if (hasFields) {
              promptText += `\n\n请提取以下字段信息：\n${fieldDescriptions}`
              if (hasImages || isImageFile) {
                const fieldNames = template.fields.map((f) => f.name).join('、')
                promptText += `\n\n【重要】文档为图片，请对每个字段返回其在图片中的位置坐标（归一化百分比，0-100）：
返回格式示例：{"${template.fields[0]?.name || '字段名'}": {"value": "提取的值", "x": 10.5, "y": 20.3, "width": 30.0, "height": 5.0}}
- x: 字段区域左边界占图片宽度的百分比
- y: 字段区域上边界占图片高度的百分比
- width: 字段区域宽度占图片宽度的百分比
- height: 字段区域高度占图片高度的百分比
请确保每个字段 "${fieldNames}" 都包含坐标信息。`
              }
            } else if (hasImages || isImageFile) {
              // No fields defined but has images: prompt for free-form extraction with coordinates
              promptText += `\n\n【重要】文档为图片，请根据提示词提取信息并以JSON格式返回。对每个提取的信息项，同时返回其在图片中的位置坐标（归一化百分比，0-100）：
返回格式示例：{"提取的信息名": {"value": "提取的值", "x": 10.5, "y": 20.3, "width": 30.0, "height": 5.0}}
- x: 信息区域左边界占图片宽度的百分比
- y: 信息区域上边界占图片高度的百分比
- width: 信息区域宽度占图片宽度的百分比
- height: 信息区域高度占图片高度的百分比`
            } else {
              // No fields, no images: just ask for structured JSON
              promptText += '\n\n请以JSON格式返回提取的结构化信息。'
            }

            // Add text content
            if (parsed.text) {
              contentParts.push({
                type: 'text',
                text: promptText + '\n\n文档内容：\n' + parsed.text,
              })
            } else if (hasImages || isImageFile) {
              // Image-only file: text part just contains the prompt
              contentParts.push({ type: 'text', text: promptText })
            } else {
              // Fallback: prompt only
              contentParts.push({ type: 'text', text: promptText })
            }

            // Add images if any
            if (parsed.images && parsed.images.length > 0) {
              for (const img of parsed.images) {
                contentParts.push({
                  type: 'image_url',
                  image_url: {
                    url: img.dataUrl,
                    detail: 'auto',
                  },
                })
              }
            }

            const messages: OpenAI.ChatCompletionMessageParam[] = [
              { role: 'system', content: systemMessage },
              { role: 'user', content: contentParts.length === 1 && contentParts[0].type === 'text'
                ? contentParts[0].text
                : contentParts as OpenAI.ChatCompletionContentPart[],
              },
            ]

            // Build request options
            const requestOptions: OpenAI.ChatCompletionCreateParams = {
              model: apiSettings.model,
              messages,
              temperature: apiSettings.temperature ?? 0.1,
              stream: true,
            }

            // For reasoning models: add reasoning_effort
            // StepFun step-3.7-flash/step-3.5-flash support BOTH reasoning_effort AND response_format
            // OpenAI o-series models support reasoning_effort but NOT response_format
            const isStepModel = /^step-/.test(apiSettings.model.toLowerCase())
            if (isReasoningModel(apiSettings.model)) {
              (requestOptions as unknown as Record<string, unknown>).reasoning_effort = 'low'
            }
            // All models get response_format for structured JSON output
            // Step models support json_object; OpenAI o-series will ignore it or error, but
            // the 5-layer JSON parser handles non-JSON output gracefully
            if (!apiSettings.model.toLowerCase().startsWith('o')) {
              (requestOptions as unknown as Record<string, unknown>).response_format = { type: 'json_object' }
            }

            // Call OpenAI with streaming
            const completion = await openai.chat.completions.create(
              requestOptions as OpenAI.ChatCompletionCreateParamsNonStreaming & { stream: true },
              { signal: AbortSignal.any([abortController.signal, AbortSignal.timeout(120_000)]) },
            )

            // Collect streamed content
            let fullContent = ''

            // Check if response is a stream (AsyncIterable)
            if (Symbol.asyncIterator in Object(completion)) {
              // It's a stream - iterate over chunks
              for await (const chunk of completion as unknown as AsyncIterable<OpenAI.ChatCompletionChunk>) {
                const delta = chunk.choices?.[0]?.delta?.content
                if (delta) {
                  fullContent += delta
                }
              }
            } else {
              // Non-streaming response (some providers return this despite stream: true)
              const msg = (completion as unknown as OpenAI.ChatCompletion).choices?.[0]?.message
              fullContent = msg?.content || ''
            }

            // Parse the JSON response with 5-layer fallback
            const extracted = parseJsonResponse(fullContent)

            // Separate values from coordinate regions
            const { data, regions } = separateRegionsAndValues(extracted)

            // Apply type-specific normalization (date format, measurement structure)
            const normalizedData = hasFields ? applyTypeNormalization(data, template.fields) : data

            // Defense-in-depth: filter out any fields not in the template
            // Also filter coordinate/metadata fields that AI may return as top-level keys
            const META_KEYS = new Set(['value', 'x', 'y', 'width', 'height', 'label', 'confidence', 'source', 'polygon', 'attributes', 'group', 'index', 'type', 'required', 'name'])
            const allowedFieldNames = new Set(template.fields.map((f) => f.name))
            const filteredData: Record<string, unknown> = {}
            if (hasFields && allowedFieldNames.size > 0) {
              for (const [key, val] of Object.entries(normalizedData)) {
                if (allowedFieldNames.has(key)) {
                  filteredData[key] = val
                }
              }
            } else {
              // No template fields defined — keep all except known metadata
              for (const [key, val] of Object.entries(normalizedData)) {
                if (!META_KEYS.has(key)) {
                  filteredData[key] = val
                }
              }
            }

            // Determine imageDataUrl for image files
            let imageDataUrl: string | undefined
            if (file.dataUrl && /^data:image\//.test(file.dataUrl)) {
              imageDataUrl = file.dataUrl
            }

            successCount++
            results.push({ fileId, fileName, success: true, data: filteredData })
            send('file_complete', {
              fileId,
              fileName,
              success: true,
              data: filteredData,
              regions: Object.keys(regions).length > 0 ? regions : undefined,
              imageDataUrl,
              rawResponse: fullContent.substring(0, 2000),
            })
          } catch (err) {
            errorCount++
            const errorMessage = err instanceof Error ? err.message : '未知错误'
            results.push({ fileId, fileName, success: false, error: errorMessage })
            send('file_complete', { fileId, fileName, success: false, error: errorMessage })
          }
        })

        // Send final summary
        send('all_done', {
          totalFiles: files.length,
          successCount,
          errorCount,
        })

        try {
          controller.close()
        } catch {
          // Already closed
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
