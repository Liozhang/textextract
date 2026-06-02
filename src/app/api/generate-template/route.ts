import { NextRequest } from 'next/server'
import OpenAI from 'openai'
import { supportsJsonResponseFormat } from '@/lib/merge-utils'

const TEMPLATE_SYSTEM_PROMPT = `你是一个输出模板设计助手。根据用户提供的模板字段描述，为每个字段生成结构化的列定义。

要求：
1. key 使用用户提供的字段名（保持原样，不要翻译或修改）
2. type 只能是 string、number 或 boolean（根据字段含义推断）
3. description 用中文简短描述该字段的含义
4. example 提供一个合理的示例值

返回 JSON 对象，格式如下：
{"columns": [{"key": "字段名", "type": "string", "description": "描述", "example": "示例值"}]}

仅返回 JSON 对象，不要任何解释性文本。`

function isPrivateHost(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return true
    const hostname = parsed.hostname
    const privatePatterns = [/^localhost$/i, /^127(?:\.\d{1,3}){3}$/, /^10(?:\.\d{1,3}){3}$/, /^172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}$/, /^192\.168(?:\.\d{1,3}){2}$/, /^169\.254(?:\.\d{1,3}){2}$/, /^0\.0\.0\.0$/, /^::1$/]
    return privatePatterns.some((re) => re.test(hostname))
  } catch {
    return true
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { prompt, extractionData } = body as {
      prompt?: string
      extractionData?: Array<{ data?: Record<string, unknown> }>
    }

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return Response.json({ error: '请输入模板描述' }, { status: 400, headers: { 'Content-Type': 'application/json' } })
    }

    const baseUrl = (process.env.API_BASE_URL || '').trim()
    const apiKey = (process.env.API_KEY || '').trim()
    const model = (process.env.API_MODEL || '').trim()

    if (!baseUrl || !apiKey || !model) {
      return Response.json({ error: 'API 设置不完整' }, { status: 400, headers: { 'Content-Type': 'application/json' } })
    }

    if (isPrivateHost(baseUrl)) {
      return Response.json({ error: '不允许访问内网地址' }, { status: 400, headers: { 'Content-Type': 'application/json' } })
    }

    const openai = new OpenAI({ baseURL: baseUrl, apiKey })

    // Build user message — include extracted fields as reference for type inference
    let userMessage = prompt.trim()

    if (extractionData && extractionData.length > 0) {
      // Collect sample values for each field to help the LLM infer types
      const fieldSamples = new Map<string, string[]>()
      for (const item of extractionData) {
        if (!item.data) continue
        for (const [key, value] of Object.entries(item.data)) {
          if (value == null) continue
          const samples = fieldSamples.get(key) || []
          if (samples.length < 3) {
            samples.push(String(value).slice(0, 80))
            fieldSamples.set(key, samples)
          }
        }
      }
      if (fieldSamples.size > 0) {
        userMessage += '\n\n# 已提取字段（用于推断类型和示例值）\n'
        for (const [key, samples] of fieldSamples) {
          userMessage += `- ${key}: ${samples.join(', ')}\n`
        }
      }
    }

    const completion = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: TEMPLATE_SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.3,
      ...(supportsJsonResponseFormat(model) ? { response_format: { type: 'json_object' } } : {}),
    } as any)

    const content = completion.choices?.[0]?.message?.content || ''

    let columns: Array<{ key: string; type: string; description: string; example?: string }> = []

    try {
      const parsed = JSON.parse(content)
      if (Array.isArray(parsed)) {
        columns = parsed.filter(
          (c) =>
            typeof c.key === 'string' && c.key &&
            ['string', 'number', 'boolean'].includes(c.type) &&
            typeof c.description === 'string',
        )
      } else if (parsed && typeof parsed === 'object') {
        // Find the first array property (could be "columns", "fields", "items", etc.)
        for (const value of Object.values(parsed)) {
          if (Array.isArray(value)) {
            const filtered = value.filter(
              (c) =>
                typeof c.key === 'string' && c.key &&
                ['string', 'number', 'boolean'].includes(c.type) &&
                typeof c.description === 'string',
            )
            if (filtered.length > 0) {
              columns = filtered
              break
            }
          }
        }
      }
    } catch (parseErr) {
      console.error('[generate-template] JSON parse error:', parseErr instanceof Error ? parseErr.message : parseErr)
      console.error('[generate-template] Raw content:', content.slice(0, 500))
      return Response.json({ error: 'AI 返回格式异常，请重试' }, { status: 502, headers: { 'Content-Type': 'application/json' } })
    }

    if (columns.length === 0) {
      return Response.json({ error: '未能生成模板列，请尝试更明确的描述' }, { status: 502, headers: { 'Content-Type': 'application/json' } })
    }

    return Response.json({ columns })
  } catch (err) {
    const message = err instanceof Error ? err.message : '生成模板失败'
    return Response.json({ error: message }, { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}
