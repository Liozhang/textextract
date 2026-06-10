'use client'

import { useState, useMemo, useEffect } from 'react'
import { toast } from 'sonner'
import {
  Table as TableIcon,
  FileText,
  Braces,
  Download,
  Loader2,
  ArrowLeft,
  AlertCircle,
  Columns3,
  RotateCcw,
  Plus,
  Trash2,
} from 'lucide-react'
import { useStore, type ExportFormat, type MergedExportRow } from '@/lib/store'
import { useT } from '@/lib/i18n'
import {
  pivotLongToWide,
  getRepeatingColumns,
  getNonRepeatingColumns,
  getAutoValueColumns,
  type PivotPreset,
} from '@/lib/pivot'

import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table'
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'

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

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
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
  const templateColumns = useStore((s) => s.templateColumns)

  const [filename, setFilename] = useState<string>(getDefaultFilename)
  const [exporting, setExporting] = useState(false)
  const [activeTab, setActiveTab] = useState('long')

  // ── Row & Column selection state (long format) ─────────────────────
  const [selectedRowIndices, setSelectedRowIndices] = useState<Set<number>>(new Set())
  const [selectedColumns, setSelectedColumns] = useState<Set<string>>(new Set())

  // ── Pivot state (wide format) ────────────────────────────────────────
  const repeatingCols = useMemo(() => getRepeatingColumns(templateColumns), [templateColumns])
  const nonRepeatingCols = useMemo(() => getNonRepeatingColumns(templateColumns), [templateColumns])
  const canPivot = repeatingCols.length >= 2

  const [pivotPresets, setPivotPresets] = useState<PivotPreset[]>([])
  const [columnNameMap, setColumnNameMap] = useState<Record<string, string>>({})

  const addPreset = () => {
    setPivotPresets((prev) => [
      ...prev,
      { id: crypto.randomUUID(), prefixColumn: null, pivotKeyColumn: '', valueColumns: [] },
    ])
  }
  const removePreset = (id: string) => {
    setPivotPresets((prev) => prev.filter((p) => p.id !== id))
  }
  const updatePreset = (id: string, updates: Partial<PivotPreset>) => {
    setPivotPresets((prev) => prev.map((p) => (p.id === id ? { ...p, ...updates } : p)))
  }

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

  // Only export successful records
  const filteredResults = useMemo(() => {
    return mergedExportData.filter((row) => row.success)
  }, [mergedExportData])

  // Build preview data (first 5 rows, flattened) — long format
  const previewData = useMemo(() => {
    return filteredResults.slice(0, 5).map((r) => flattenRow(r.data ?? {}))
  }, [filteredResults])

  const previewHeaders = useMemo(() => {
    if (templateColumns.length > 0) {
      return templateColumns.map((c) => c.key)
    }
    const headerSet = new Set<string>()
    for (const row of previewData) {
      for (const key of Object.keys(row)) {
        headerSet.add(key)
      }
    }
    return Array.from(headerSet).sort()
  }, [previewData, templateColumns])

  const hasResults = filteredResults.length > 0

  // ── Auto-select all rows/columns when data changes ───────────────────────
  useEffect(() => {
    setSelectedRowIndices(new Set(filteredResults.map((_, i) => i)))
  }, [filteredResults.length])

  useEffect(() => {
    setSelectedColumns(new Set(previewHeaders))
  }, [previewHeaders.length])

  // ── Computed export data (long format) ────────────────────────────────
  const exportColumns = useMemo(() => {
    return previewHeaders.filter((h) => selectedColumns.has(h))
  }, [previewHeaders, selectedColumns])

  const canExport = hasResults && selectedRowIndices.size > 0 && exportColumns.length > 0

  // ── Pivot result (wide format) ──────────────────────────────────────
  const pivotResult = useMemo(() => {
    const validPresets = pivotPresets.filter((p) => p.pivotKeyColumn)
    if (!canPivot || validPresets.length === 0 || filteredResults.length === 0) return null
    return pivotLongToWide(filteredResults, templateColumns, validPresets)
  }, [filteredResults, templateColumns, pivotPresets, canPivot])

  // Memoize pivot columns as JSON for stable useEffect dependency
  const pivotColsJson = useMemo(
    () => pivotResult ? JSON.stringify(pivotResult.columns) : '',
    [pivotResult],
  )

  const canExportWide = pivotResult !== null && pivotResult.rows.length > 0

  // Auto-generate column name map when pivot columns change
  useEffect(() => {
    if (pivotResult) {
      const map: Record<string, string> = {}
      for (const col of pivotResult.columns) {
        map[col] = columnNameMap[col] ?? col // preserve user edits if possible
      }
      setColumnNameMap(map)
    }
  }, [pivotColsJson]) // eslint-disable-line react-hooks/exhaustive-deps

  // -----------------------------------------------------------------------
  // Export handlers
  // -----------------------------------------------------------------------

  async function handleExport() {
    if (!canExport || exporting) return

    setExporting(true)
    try {
      const selectedRows = Array.from(selectedRowIndices)
        .map((i) => filteredResults[i])
        .filter(Boolean)
      const colOrder = exportColumns.length > 0 ? exportColumns : null
      const payload = selectedRows.map((r) => {
        const obj: Record<string, unknown> = {}
        const keys = colOrder ?? Object.keys(r.data ?? {})
        for (const key of keys) {
          if (key in (r.data ?? {})) obj[key] = r.data[key]
          else obj[key] = null
        }
        return obj
      })

      const response = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          format: exportFormat,
          data: payload,
          filename: filename || getDefaultFilename(),
          ...(colOrder ? { columnOrder: colOrder } : {}),
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        throw new Error(errorData?.error ?? t('export.exportFailedDetail', { code: response.status }))
      }

      const blob = await response.blob()
      const safeName = (filename || getDefaultFilename()) + getExtension(exportFormat)
      downloadBlob(blob, safeName)

      toast.success(t('export.exportSuccess'), {
        description: t('export.exportSuccessDesc', { count: selectedRows.length }),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : t('export.exportRetry')
      toast.error(t('export.exportFailed'), { description: message })
    } finally {
      setExporting(false)
    }
  }

  async function handleExportWide() {
    if (!canExportWide || !pivotResult || exporting) return

    setExporting(true)
    try {
      // Apply column name edits
      const renamedRows = pivotResult.rows.map((row) => {
        const renamed: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(row)) {
          if (key === '_label') continue
          renamed[columnNameMap[key] ?? key] = value
        }
        return renamed
      })

      const colOrder = pivotResult.columns.map((c) => columnNameMap[c] ?? c)

      const response = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          format: exportFormat,
          data: renamedRows,
          filename: filename || getDefaultFilename(),
          columnOrder: colOrder,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        throw new Error(errorData?.error ?? t('export.exportFailedDetail', { code: response.status }))
      }

      const blob = await response.blob()
      const safeName = (filename || getDefaultFilename()) + getExtension(exportFormat)
      downloadBlob(blob, safeName)

      toast.success(t('export.exportSuccess'), {
        description: t('export.exportSuccessDesc', { count: pivotResult.rows.length }),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : t('export.exportRetry')
      toast.error(t('export.exportFailed'), { description: message })
    } finally {
      setExporting(false)
    }
  }

  // -----------------------------------------------------------------------
  // Shared format + filename section
  // -----------------------------------------------------------------------

  const formatSection = (
    <>
      <div className="flex flex-col gap-3">
        <Label className="text-sm font-medium">{t('export.format')}</Label>
        <RadioGroup
          value={exportFormat}
          onValueChange={(v) => setExportSettings({ format: v as ExportFormat })}
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
                <span className="text-xs text-muted-foreground">{opt.description}</span>
              </div>
            </label>
          ))}
        </RadioGroup>
      </div>

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
    </>
  )

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
        {formatSection}

        {hasResults ? (
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="long">{t('export.longData')}</TabsTrigger>
              {canPivot && (
                <TabsTrigger value="wide">{t('export.wideData')}</TabsTrigger>
              )}
            </TabsList>

            {/* ── Long Format Tab ──────────────────────────────────────── */}
            <TabsContent value="long" className="flex flex-col gap-6">
              {/* Data preview with row selection */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">{t('export.preview')}</Label>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {t('export.selectedRowsCount', {
                        count: selectedRowIndices.size,
                        total: filteredResults.length,
                      })}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs"
                      onClick={() => {
                        if (selectedRowIndices.size === filteredResults.length) {
                          setSelectedRowIndices(new Set())
                        } else {
                          setSelectedRowIndices(new Set(filteredResults.map((_, i) => i)))
                        }
                      }}
                    >
                      {selectedRowIndices.size === filteredResults.length
                        ? t('export.deselectAllRows')
                        : t('export.selectAllRows')}
                    </Button>
                  </div>
                </div>

                <div className="max-h-48 overflow-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10 text-center">
                          <Checkbox
                            checked={selectedRowIndices.size === filteredResults.length && filteredResults.length > 0}
                            onCheckedChange={(v) => {
                              if (v) setSelectedRowIndices(new Set(filteredResults.map((_, i) => i)))
                              else setSelectedRowIndices(new Set())
                            }}
                          />
                        </TableHead>
                        <TableHead>{t('review.fileName')}</TableHead>
                        {exportColumns.map((h) => (
                          <TableHead key={h} className="whitespace-nowrap truncate max-w-[200px]" title={h}>{h}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {previewData.length > 0 ? (
                        previewData.map((row, idx) => (
                          <TableRow
                            key={idx}
                            className={selectedRowIndices.has(idx) ? 'bg-primary/5' : ''}
                          >
                            <TableCell className="text-center">
                              <Checkbox
                                checked={selectedRowIndices.has(idx)}
                                onCheckedChange={(v) => {
                                  setSelectedRowIndices((prev) => {
                                    const next = new Set(prev)
                                    if (v) next.add(idx)
                                    else next.delete(idx)
                                    return next
                                  })
                                }}
                              />
                            </TableCell>
                            <TableCell className="font-medium">
                              {filteredResults[idx]?.label ?? ''}
                            </TableCell>
                            {exportColumns.map((h) => (
                              <TableCell key={h} className="max-w-[280px] truncate">
                                {row[h] ?? '-'}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell
                            colSpan={exportColumns.length + 2}
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

              {/* Column selection */}
              {previewHeaders.length > 0 && (
                <div className="flex items-center justify-between">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="h-8 text-xs">
                        <Columns3 className="size-3.5 mr-1" />
                        {t('export.selectColumns')}
                        <Badge variant="secondary" className="ml-1.5 px-1.5 py-0 text-[10px]">
                          {selectedColumns.size}/{previewHeaders.length}
                        </Badge>
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-64 p-0" align="start">
                      <div className="flex items-center justify-between border-b px-3 py-2">
                        <span className="text-xs font-medium">{t('export.selectColumns')}</span>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => setSelectedColumns(new Set(previewHeaders))}>
                            {t('export.selectAllColumns')}
                          </Button>
                          <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => setSelectedColumns(new Set())}>
                            {t('export.deselectAllColumns')}
                          </Button>
                        </div>
                      </div>
                      <ScrollArea className="max-h-[300px]">
                        <div className="px-3 py-1">
                          {previewHeaders.map((h) => (
                            <label key={h} className="flex items-center gap-2 py-1.5 cursor-pointer hover:bg-muted/50 rounded px-1">
                              <Checkbox
                                checked={selectedColumns.has(h)}
                                onCheckedChange={(v) => {
                                  setSelectedColumns((prev) => {
                                    const next = new Set(prev)
                                    if (v) next.add(h)
                                    else next.delete(h)
                                    return next
                                  })
                                }}
                              />
                              <span className="text-sm truncate" title={h}>{h}</span>
                            </label>
                          ))}
                        </div>
                      </ScrollArea>
                    </PopoverContent>
                  </Popover>
                  {exportColumns.length === 0 && (
                    <span className="text-xs text-destructive">{t('export.noSelection')}</span>
                  )}
                </div>
              )}
            </TabsContent>

            {/* ── Wide Format Tab ──────────────────────────────────────── */}
            {canPivot && (
              <TabsContent value="wide" className="flex flex-col gap-6">
                {/* Pivot Presets */}
                <div className="rounded-lg border p-4 flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium">{t('export.pivotConfig')}</Label>
                    <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={addPreset}>
                      <Plus className="size-3.5" />
                      {t('export.pivotAddPreset')}
                    </Button>
                  </div>

                  {pivotPresets.length === 0 ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                      <AlertCircle className="size-4 shrink-0" />
                      <span>{t('export.pivotNoPresets')}</span>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {pivotPresets.map((preset, idx) => {
                        const keyOptions = repeatingCols.filter((c) => c !== preset.prefixColumn)
                        const autoValues = getAutoValueColumns(templateColumns, preset)
                        return (
                          <div key={preset.id} className="flex items-end gap-2 rounded-md border p-3">
                            <span className="text-xs text-muted-foreground shrink-0 w-10 pb-2">
                              {t('export.pivotPreset', { n: idx + 1 })}
                            </span>
                            {/* Prefix column */}
                            <div className="flex-1 min-w-0">
                              <Label className="text-[10px] text-muted-foreground">{t('export.pivotPrefixColumn')}</Label>
                              <Select
                                value={preset.prefixColumn ?? '__none__'}
                                onValueChange={(v) =>
                                  updatePreset(preset.id, { prefixColumn: v === '__none__' ? null : v })
                                }
                              >
                                <SelectTrigger className="h-8 text-xs mt-0.5">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__none__">{t('export.pivotNone')}</SelectItem>
                                  {repeatingCols.map((col) => (
                                    <SelectItem key={col} value={col}>{col}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            {/* Pivot key column */}
                            <div className="flex-1 min-w-0">
                              <Label className="text-[10px] text-muted-foreground">{t('export.pivotKeyColumn')}</Label>
                              <Select
                                value={preset.pivotKeyColumn}
                                onValueChange={(v) => updatePreset(preset.id, { pivotKeyColumn: v })}
                              >
                                <SelectTrigger className="h-8 text-xs mt-0.5">
                                  <SelectValue placeholder={t('export.pivotKeyColumnDesc')} />
                                </SelectTrigger>
                                <SelectContent>
                                  {keyOptions.map((col) => (
                                    <SelectItem key={col} value={col}>{col}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            {/* Value columns selector */}
                            <div className="flex-1 min-w-0">
                              <Label className="text-[10px] text-muted-foreground">{t('export.pivotValueColumns')}</Label>
                              <Popover>
                                <PopoverTrigger asChild>
                                  <Button variant="outline" size="sm" className="w-full mt-0.5 h-8 text-xs justify-start gap-1">
                                    <span className="truncate min-w-0 flex-1 text-left">
                                      {autoValues.length > 0
                                        ? autoValues.join(', ')
                                        : t('export.pivotValueColumnsDesc')}
                                    </span>
                                    <Badge variant="secondary" className="ml-auto px-1.5 py-0 text-[10px]">
                                      {autoValues.length}/{repeatingCols.filter(c => c !== preset.prefixColumn && c !== preset.pivotKeyColumn).length}
                                    </Badge>
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-64 p-0" align="start">
                                  <div className="flex items-center justify-between border-b px-3 py-2">
                                    <span className="text-xs font-medium">{t('export.pivotValueColumns')}</span>
                                    <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => {
                                      const all = repeatingCols.filter(c => c !== preset.prefixColumn && c !== preset.pivotKeyColumn)
                                      updatePreset(preset.id, { valueColumns: [...all] })
                                    }}>
                                      {t('export.selectAllColumns')}
                                    </Button>
                                  </div>
                                  <ScrollArea className="max-h-[200px]">
                                    <div className="px-3 py-1">
                                      {repeatingCols.filter(c => c !== preset.prefixColumn && c !== preset.pivotKeyColumn).map((col) => (
                                        <label key={col} className="flex items-center gap-2 py-1.5 cursor-pointer hover:bg-muted/50 rounded px-1">
                                          <Checkbox
                                            checked={autoValues.includes(col)}
                                            onCheckedChange={(v) => {
                                              const next = v
                                                ? [...preset.valueColumns, col]
                                                : preset.valueColumns.filter((c) => c !== col)
                                              updatePreset(preset.id, { valueColumns: next })
                                            }}
                                          />
                                          <span className="text-sm truncate" title={col}>{col}</span>
                                        </label>
                                      ))}
                                    </div>
                                  </ScrollArea>
                                </PopoverContent>
                              </Popover>
                            </div>
                            {/* Delete */}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive shrink-0"
                              onClick={() => removePreset(preset.id)}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

                {/* Column Name Editor */}
                {pivotResult && (
                  <Collapsible defaultOpen>
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5">
                        {t('export.pivotColumnNames')}
                        <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                          {pivotResult.columns.length}
                        </Badge>
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <p className="text-xs text-muted-foreground mb-2">{t('export.pivotColumnNamesDesc')}</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {pivotResult.columns.map((col) => (
                          <div key={col} className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground w-44 shrink-0 truncate" title={col}>
                              {col}
                            </span>
                            <Input
                              value={columnNameMap[col] ?? col}
                              onChange={(e) =>
                                setColumnNameMap((prev) => ({ ...prev, [col]: e.target.value }))
                              }
                              className="h-7 text-xs"
                            />
                          </div>
                        ))}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs mt-2"
                        onClick={() => {
                          const map: Record<string, string> = {}
                          for (const c of pivotResult.columns) map[c] = c
                          setColumnNameMap(map)
                        }}
                      >
                        <RotateCcw className="size-3 mr-1" />
                        {t('export.pivotResetNames')}
                      </Button>
                    </CollapsibleContent>
                  </Collapsible>
                )}

                {/* Wide preview */}
                {pivotResult && pivotResult.rows.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    <Label className="text-sm font-medium">{t('export.pivotPreview')}</Label>
                    <div className="max-h-48 overflow-auto rounded-lg border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-32">{t('review.fileName')}</TableHead>
                            {pivotResult.columns.map((col) => (
                              <TableHead key={col} className="min-w-[120px] max-w-[240px] whitespace-nowrap truncate" title={columnNameMap[col] ?? col}>
                                {columnNameMap[col] ?? col}
                              </TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {pivotResult.rows.slice(0, 3).map((row, idx) => (
                            <TableRow key={idx}>
                              <TableCell className="font-medium truncate">
                                {String(row._label ?? '')}
                              </TableCell>
                              {pivotResult.columns.map((col) => (
                                <TableCell key={col} className="max-w-[220px] truncate">
                                  {row[col] != null ? String(row[col]) : '-'}
                                </TableCell>
                              ))}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    {pivotResult.rows.length > 3 && (
                      <span className="text-xs text-muted-foreground">
                        ... {pivotResult.rows.length - 3} more
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <AlertCircle className="size-4 shrink-0" />
                    <span>{pivotPresets.length > 0 ? t('export.noData') : t('export.pivotNoPresets')}</span>
                  </div>
                )}
              </TabsContent>
            )}
          </Tabs>
        ) : (
          /* No results state */
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
      </CardContent>

      <CardFooter className="flex flex-col gap-3">
        <Button
          size="lg"
          className="w-full"
          disabled={(activeTab === 'long' ? !canExport : !canExportWide) || exporting}
          onClick={activeTab === 'long' ? handleExport : handleExportWide}
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
        {hasResults && activeTab === 'long' && !canExport && (
          <div className="flex items-center gap-2 text-xs text-destructive">
            <AlertCircle className="size-3.5" />
            <span>{t('export.noSelection')}</span>
          </div>
        )}
      </CardFooter>
    </Card>
  )
}
