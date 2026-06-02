import { NextRequest } from 'next/server'
import OpenAI from 'openai'
import { supportsJsonResponseFormat } from '@/lib/merge-utils'
import { isPrivateHost, resolveApiSettings } from '@/lib/api-utils'
import { TEMPLATE_GENERATE_SYSTEM_MESSAGE } from '@/lib/pipeline/prompts'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { prompt, extractionData, apiSettings: apiSettingsOverride } = body as {
      prompt?: string
      extractionData?: Array<{ data?: Record<string, unknown> }>
      apiSettings?: { baseUrl?: string; apiKey?: string; model?: string }
    }

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return Response.json({ error: '请输入模板描述' }, { status: 400, headers: { 'Content-Type': 'application/json' } })
    }

    const apiSettings = resolveApiSettings(apiSettingsOverride)

    if (!apiSettings.baseUrl || !apiSettings.apiKey || !apiSettings.model) {
      return Response.json({ error: 'API 设置不完整' }, { status: 400, headers: { 'Content-Type': 'application/json' } })
    }

    if (isPrivateHost(apiSettings.baseUrl)) {
      return Response.json({ error: '不允许访问内网地址' }, { status: 400, headers: { 'Content-Type': 'application/json' } })
    }

    const openai = new OpenAI({ baseURL: apiSettings.baseUrl, apiKey: apiSettings.apiKey })

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
      model: apiSettings.model,
      messages: [
        { role: 'system', content: TEMPLATE_GENERATE_SYSTEM_MESSAGE },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.3,
      ...(supportsJsonResponseFormat(apiSettings.model) ? { response_format: { type: 'json_object' } } : {}),
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
