'use client'

import { useState, useMemo } from 'react'
import { toast } from 'sonner'
import {
  Table as TableIcon,
  FileText,
  Braces,
  Download,
  Loader2,
  ArrowLeft,
  AlertCircle,
} from 'lucide-react'
import { useStore, type ExportFormat, type MergedExportRow } from '@/lib/store'
import { useT } from '@/lib/i18n'

import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FormatOption {
  value: ExportFormat
  label: string
  description: string
  icon: React.ReactNode
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getDefaultFilename(): string {
  return `extraction-result-${new Date().toISOString().slice(0, 10)}`
}

function getExtension(format: ExportFormat): string {
  switch (format) {
    case 'xlsx':
      return '.xlsx'
    case 'csv':
      return '.csv'
    case 'json':
      return '.json'
  }
}

/** Flatten an object into a shallow key-value map using dot-notation for nested keys. */
function flattenRow(
  obj: Record<string, unknown>,
  prefix = '',
): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (key.startsWith('_')) continue
    const fullKey = prefix ? `${prefix}.${key}` : key
    if (value === null || value === undefined) {
      continue
    } else if (typeof value === 'object' && !Array.isArray(value)) {
      // Measurement objects: {value, unit} → "value unit"
      if ('value' in value && 'unit' in value) {
        result[fullKey] = `${(value as { value: unknown }).value} ${(value as { unit: string }).unit}`
      } else {
        Object.assign(result, flattenRow(value as Record<string, unknown>, fullKey))
      }
    } else {
      result[fullKey] = Array.isArray(value) ? JSON.stringify(value) : String(value)
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ExportPanel() {
  const t = useT()
  const mergedExportData = useStore((s) => s.mergedExportData)
  const exportFormat = useStore((s) => s.exportSettings.format)
  const setExportSettings = useStore((s) => s.setExportSettings)
  const setStep = useStore((s) => s.setStep)

  const [filename, setFilename] = useState<string>(getDefaultFilename)
  const [exporting, setExporting] = useState(false)
  const [onlySuccess, setOnlySuccess] = useState(true)

  // Format options — inside the component so t() is available for descriptions
  const FORMAT_OPTIONS: FormatOption[] = [
    {
      value: 'xlsx',
      label: 'XLSX',
      description: t('export.xlsxDesc'),
      icon: <TableIcon className="size-5 text-emerald-600" />,
    },
    {
      value: 'csv',
      label: 'CSV',
      description: t('export.csvDesc'),
      icon: <FileText className="size-5 text-sky-600" />,
    },
    {
      value: 'json',
      label: 'JSON',
      description: t('export.jsonDesc'),
      icon: <Braces className="size-5 text-amber-600" />,
    },
  ]

  // Filter data according to advanced options
  const filteredResults = useMemo(() => {
    if (onlySuccess) return mergedExportData.filter((row) => row.success);
    return mergedExportData
  }, [mergedExportData, onlySuccess])

  // Build preview data (first 5 rows, flattened)
  const previewData = useMemo(() => {
    return filteredResults.slice(0, 5).map((r) => flattenRow(r.data ?? {}))
  }, [filteredResults])

  // Collect all unique headers for the preview table
  const previewHeaders = useMemo(() => {
    const headerSet = new Set<string>()
    for (const row of previewData) {
      for (const key of Object.keys(row)) {
        headerSet.add(key)
      }
    }
    return Array.from(headerSet).sort()
  }, [previewData])

  const hasResults = filteredResults.length > 0

  // -----------------------------------------------------------------------
  // Export handler
  // -----------------------------------------------------------------------

  async function handleExport() {
    if (!hasResults || exporting) return

    setExporting(true)
    try {
      // Build the data payload
      const payload = filteredResults.map((r) => {
        const obj: Record<string, unknown> = { ...r.data }
        return obj
      })

      const response = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          format: exportFormat,
          data: payload,
          filename: filename || getDefaultFilename(),
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        throw new Error(errorData?.error ?? t('export.exportFailedDetail', { code: response.status }))
      }

      const blob = await response.blob()
      const safeName = (filename || getDefaultFilename()) + getExtension(exportFormat)

      // Programmatically trigger download
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = safeName
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      toast.success(t('export.exportSuccess'), {
        description: t('export.exportSuccessDesc', { count: filteredResults.length }),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : t('export.exportRetry')
      toast.error(t('export.exportFailed'), { description: message })
    } finally {
      setExporting(false)
    }
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('export.title')}</CardTitle>
        <CardDescription>{t('export.description')}</CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        {/* ── Format selection ─────────────────────────────────────────── */}
        <div className="flex flex-col gap-3">
          <Label className="text-sm font-medium">{t('export.format')}</Label>
          <RadioGroup
            value={exportFormat}
            onValueChange={(v) =>
              setExportSettings({ format: v as ExportFormat })
            }
            className="grid grid-cols-1 gap-3 sm:grid-cols-3"
          >
            {FORMAT_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                htmlFor={`format-${opt.value}`}
                className="group relative flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors hover:bg-accent/50 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
              >
                <RadioGroupItem
                  value={opt.value}
                  id={`format-${opt.value}`}
                  className="mt-0.5"
                />
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    {opt.icon}
                    <span className="text-sm font-semibold">{opt.label}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {opt.description}
                  </span>
                </div>
              </label>
            ))}
          </RadioGroup>
        </div>

        {/* ── Filename customization ───────────────────────────────────── */}
        <div className="flex flex-col gap-2">
          <Label htmlFor="export-filename" className="text-sm font-medium">
            {t('export.filename')}
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id="export-filename"
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              placeholder={getDefaultFilename()}
              className="flex-1"
            />
            <span className="text-sm text-muted-foreground whitespace-nowrap">
              {getExtension(exportFormat)}
            </span>
          </div>
        </div>

        {/* ── Data preview ─────────────────────────────────────────────── */}
        {hasResults && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">{t('export.preview')}</Label>
              <span className="text-xs text-muted-foreground">
                {t('export.dataCount', { count: filteredResults.length })}
              </span>
            </div>

            <div className="max-h-48 overflow-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10 text-center">#</TableHead>
                    <TableHead>{t('review.fileName')}</TableHead>
                    {previewHeaders.map((h) => (
                      <TableHead key={h}>{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previewData.length > 0 ? (
                    previewData.map((row, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="text-center text-muted-foreground">
                          {idx + 1}
                        </TableCell>
                        <TableCell className="font-medium">
                          {filteredResults[idx]?.label ?? ''}
                        </TableCell>
                        {previewHeaders.map((h) => (
                          <TableCell key={h} className="max-w-[200px] truncate">
                            {row[h] ?? '-'}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell
                        colSpan={previewHeaders.length + 2}
                        className="h-24 text-center text-muted-foreground"
                      >
                        {t('export.noData')}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        {/* ── Filter options ─────────────────────────────────────────── */}
        <div className="flex items-center gap-3 rounded-lg border p-4">
          <Checkbox
            id="only-success"
            checked={onlySuccess}
            onCheckedChange={(v) => setOnlySuccess(v === true)}
          />
          <Label htmlFor="only-success" className="cursor-pointer">
            {t('export.onlySuccess')}
          </Label>
        </div>
      </CardContent>

      <CardFooter className="flex flex-col gap-3">
        <Button
          size="lg"
          className="w-full"
          disabled={!hasResults || exporting}
          onClick={handleExport}
        >
          {exporting ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              {t('export.exporting')}
            </>
          ) : (
            <>
              <Download className="size-4" />
              {t('export.exportBtn')}
            </>
          )}
        </Button>
        {!hasResults && (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <AlertCircle className="size-4 shrink-0" />
              <span>{t('export.noDataHint')}</span>
            </div>
            <Button variant="outline" size="sm" onClick={() => setStep('template')}>
              <ArrowLeft className="size-4 mr-1" />
              {t('export.goToTemplate')}
            </Button>
          </div>
        )}
      </CardFooter>
    </Card>
  )
}
