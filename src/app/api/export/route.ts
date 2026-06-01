import { NextRequest } from 'next/server'

// ─── Types ──────────────────────────────────────────────────────────────────

interface ExportRequestBody {
  format: 'xlsx' | 'csv' | 'json'
  data: Record<string, unknown>[]
  filename?: string
}

// ─── buildSheetData ─────────────────────────────────────────────────────────

/**
 * Builds sheet data from an array of objects.
 * - Collects ALL unique keys across all data objects into a sorted global header set
 * - Flattens nested objects (key.subkey) and expands arrays into multiple rows
 * - Returns headers and rows where each row corresponds to one header column
 */
function buildSheetData(data: Record<string, unknown>[]): {
  headers: string[]
  rows: string[][]
} {
  // Collect all unique flattened keys from all items
  const headersSet = new Set<string>()

  function flattenObject(obj: Record<string, unknown>, prefix: string = ''): Record<string, string> {
    const result: Record<string, string> = {}
    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key
      if (value === null || value === undefined) {
        continue
      } else if (typeof value === 'object' && !Array.isArray(value)) {
        const nested = flattenObject(value as Record<string, unknown>, fullKey)
        Object.assign(result, nested)
      } else if (Array.isArray(value)) {
        headersSet.add(fullKey)
        result[fullKey] = JSON.stringify(value)
      } else {
        headersSet.add(fullKey)
        result[fullKey] = String(value)
      }
    }
    return result
  }

  // First pass: collect all headers
  for (const item of data) {
    flattenObject(item)
  }

  // Sort headers for consistent column ordering
  const headers = Array.from(headersSet).sort()

  // Second pass: build rows
  const rows: string[][] = []
  for (const item of data) {
    const flat = flattenObject(item)
    const row = headers.map((h) => flat[h] ?? '')
    rows.push(row)
  }

  return { headers, rows }
}

// ─── POST handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body: ExportRequestBody = await request.json()
    const { format, data, filename } = body

    if (!format || !data || !Array.isArray(data)) {
      return new Response(
        JSON.stringify({ error: '缺少必要参数: format, data' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      )
    }

    if (!['xlsx', 'csv', 'json'].includes(format)) {
      return new Response(
        JSON.stringify({ error: `不支持的导出格式: ${format}` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      )
    }

    const safeFilename = filename || `export_${new Date().toISOString().slice(0, 10)}`

    switch (format) {
      case 'xlsx': {
        const XLSX = await import('xlsx')
        const { headers, rows } = buildSheetData(data)

        // First row is headers, rest are data rows
        const sheetData = [headers, ...rows]
        const worksheet = XLSX.utils.aoa_to_sheet(sheetData)
        const workbook = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1')
        const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })

        return new Response(buffer, {
          status: 200,
          headers: {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': `attachment; filename="${encodeURIComponent(safeFilename)}.xlsx"`,
          },
        })
      }

      case 'csv': {
        const { headers, rows } = buildSheetData(data)

        // Build CSV string with proper escaping (including CSV injection prevention)
        const escapeField = (field: string): string => {
          // Prevent CSV injection: prefix formula-like values with single quote
          if (/^[=+\-@\t\r]/.test(field)) {
            field = "'" + field
          }
          if (field.includes(',') || field.includes('"') || field.includes('\n') || field.includes('\r')) {
            return `"${field.replace(/"/g, '""')}"`
          }
          return field
        }

        const csvLines: string[] = []
        csvLines.push(headers.map(escapeField).join(','))
        for (const row of rows) {
          csvLines.push(row.map(escapeField).join(','))
        }

        // Normalize line endings to \r\n for proper CSV
        const csvContent = csvLines.join('\r\n')

        return new Response(csvContent, {
          status: 200,
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="${encodeURIComponent(safeFilename)}.csv"`,
          },
        })
      }

      case 'json': {
        const jsonContent = JSON.stringify(data, null, 2)

        return new Response(jsonContent, {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Content-Disposition': `attachment; filename="${encodeURIComponent(safeFilename)}.json"`,
          },
        })
      }

      default: {
        return new Response(
          JSON.stringify({ error: `不支持的导出格式: ${format}` }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        )
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : '服务器内部错误'
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }
}
