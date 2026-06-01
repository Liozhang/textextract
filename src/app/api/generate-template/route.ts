import { NextRequest } from 'next/server'
import OpenAI from 'openai'

const TEMPLATE_SYSTEM_PROMPT = `你是医疗文档输出模板设计专家。根据用户的描述，设计结构化的输出列定义。

要求：
1. 列名使用"模块-字段名(英文缩写)"格式（如"血常规-白细胞 (WBC)"），基本信息可省略模块前缀
2. 临床诊断使用"诊断-"前缀（如"诊断-出院诊断"）
3. 病理发现使用"病理描述-"前缀
4. 每列提供清晰的中文描述和合理的示例值
5. type 只能是 string、number 或 boolean

返回 JSON 数组，每项格式：
{"key": "字段名", "type": "string|number|boolean", "description": "描述", "example": "示例值"}

仅返回 JSON 数组，不要任何解释性文本。`

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
    const { prompt, files, extractionData } = body as {
      prompt?: string
      files?: Array<{ name: string }>
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

    // Build user message with context from file names and extracted fields
    let userMessage = prompt.trim()
    if (files && files.length > 0) {
      const fileNames = files.map((f) => f.name).join(', ')
      userMessage += `\n\n参考文件：${fileNames}`
    }

    // If extraction data is available, list actual fields for precise template
    if (extractionData && extractionData.length > 0) {
      const fieldSet = new Set<string>()
      for (const item of extractionData) {
        if (item.data) {
          for (const key of Object.keys(item.data)) {
            fieldSet.add(key)
          }
        }
      }
      if (fieldSet.size > 0) {
        userMessage += `\n\n# 已提取的字段列表（请基于这些字段设计模板列）\n${Array.from(fieldSet).map((f) => `- ${f}`).join('\n')}`
      }
    }

    const completion = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: TEMPLATE_SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' },
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
      } else if (parsed && Array.isArray(parsed.columns)) {
        columns = parsed.columns.filter(
          (c) =>
            typeof c.key === 'string' && c.key &&
            ['string', 'number', 'boolean'].includes(c.type) &&
            typeof c.description === 'string',
        )
      }
    } catch {
      // JSON parse failed, return empty
    }

    return Response.json({ columns })
  } catch (err) {
    const message = err instanceof Error ? err.message : '生成模板失败'
    return Response.json({ error: message }, { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}
