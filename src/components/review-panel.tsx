'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Play,
  RotateCcw,
  Square,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronRight,
  FileSearch,
  BarChart3,
  ImageIcon,
  GitMerge,
  CheckSquare,
  List,
} from 'lucide-react';
import { useStore, type FieldRegion } from '@/lib/store';
import { useT } from '@/lib/i18n';
import { mergeByFilename, mergeByPatientAndDate, type MergeStrategy } from '@/lib/merge-utils';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Parse SSE text into { event, data } chunks. */
function parseSSEChunks(text: string): { event: string; data: string }[] {
  const events: { event: string; data: string }[] = [];
  // SSE uses double-newline as delimiter
  const blocks = text.split('\n\n').filter(Boolean);
  for (const block of blocks) {
    let event = '';
    let data = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data = line.slice(5).trim();
    }
    if (event && data) events.push({ event, data });
  }
  return events;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** Unified display row type */
interface DisplayRow {
  id: string;
  label: string;
  data: Record<string, unknown>;
  regions: Record<string, FieldRegion>;
  imageDataUrl?: string;
  isMerged: boolean;
  sourceFiles: string[];
  fieldConsistency?: Record<string, boolean>;
}

/** Render a field value with type-aware formatting */
function renderFieldValue(value: unknown): string {
  if (value == null) return '—'
  if (typeof value === 'object' && !Array.isArray(value) && 'value' in value && 'unit' in value) {
    const v = (value as { value: unknown; unit: string }).value
    const u = (value as { value: unknown; unit: string }).unit
    return `${v} ${u}`
  }
  if (Array.isArray(value)) return value.map(String).join(', ')
  return String(value)
}

export default function ReviewPanel() {
  const t = useT();
  const files = useStore((s) => s.files);
  const template = useStore((s) => s.template);
  const results = useStore((s) => s.results);
  const progress = useStore((s) => s.progress);
  const clearResults = useStore((s) => s.clearResults);
  const addResult = useStore((s) => s.addResult);
  const setProgress = useStore((s) => s.setProgress);
  const selectedFileId = useStore((s) => s.selectedFileId);
  const setSelectedFileId = useStore((s) => s.setSelectedFileId);
  const setMergedExportData = useStore((s) => s.setMergedExportData);

  const abortRef = useRef<AbortController | null>(null);
  const [hasExtracted, setHasExtracted] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [mergeStrategy, setMergeStrategy] = useState<MergeStrategy>('first_wins');
  // Manual merges: { ids: merged row IDs, merged: resulting display row }
  const [manualMerges, setManualMerges] = useState<
    Array<{
      ids: Set<string>;
      merged: DisplayRow;
    }>
  >([]);

  // Track "all done" or "error" status derived from results
  const successfulCount = results.filter((r) => r.success).length;
  const failedCount = results.filter((r) => !r.success).length;
  const isExtracting = progress.status === 'extracting';

  // Derived: can we start extraction?
  const canStart = files.length > 0;

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    };
  }, []);

  // Auto-select first image result when extraction completes
  useEffect(() => {
    if (progress.status === 'done' && results.length > 0) {
      const firstImageResult = results.find((r) => r.success && r.imageDataUrl);
      if (firstImageResult && !selectedFileId) {
        setSelectedFileId(firstImageResult.fileId);
      }
    }
  }, [progress.status, results, selectedFileId, setSelectedFileId]);

  // ------------------------------------------------------------------
  // Start extraction
  // ------------------------------------------------------------------
  const handleStart = useCallback(async () => {
    if (isExtracting) return;

    // Clear previous results
    clearResults();
    setHasExtracted(false);

    const total = files.length;
    setProgress({
      totalFiles: total,
      completedFiles: 0,
      currentFile: '',
      status: 'extracting',
    });

    // Prepare request body
    const body = {
      files: files.map((f) => ({
        id: f.id,
        name: f.name,
        size: f.size,
        type: f.type,
        content: f.content,
        dataUrl: f.dataUrl,
      })),
      template: {
        prompt: template.prompt,
        fields: template.fields,
      },
    };

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(t('review.serverError', { code: response.status, text: response.statusText }));
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error(t('review.streamError'));

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE blocks from buffer
        const events = parseSSEChunks(buffer);
        // Keep incomplete trailing data
        const lastNewline = buffer.lastIndexOf('\n\n');
        if (lastNewline !== -1) {
          buffer = buffer.slice(lastNewline + 2);
        }

        for (const evt of events) {
          try {
            const parsed = JSON.parse(evt.data);

            switch (evt.event) {
              case 'file_start': {
                setProgress({
                  currentFile: parsed.fileName ?? '',
                });
                break;
              }
              case 'file_complete': {
                addResult({
                  fileId: String(parsed.fileId ?? ''),
                  fileName: parsed.fileName ?? '',
                  success: parsed.success ?? false,
                  data: parsed.data,
                  rawResponse: parsed.rawResponse,
                  error: parsed.error,
                  regions: parsed.regions,
                  imageDataUrl: parsed.imageDataUrl,
                });
                setProgress((prev) => ({
                  completedFiles: prev.completedFiles + 1,
                }));
                break;
              }
              case 'all_done': {
                setProgress({ status: 'done' });
                setHasExtracted(true);
                break;
              }
              case 'error': {
                setProgress({ status: 'error' });
                addResult({
                  fileId: 'system',
                  fileName: t('review.systemError'),
                  success: false,
                  error: parsed.error ?? t('review.unknownError'),
                });
                setHasExtracted(true);
                break;
              }
            }
          } catch {
            // ignore JSON parse errors for individual events
          }
        }
      }

      // If we exit the loop and status is still extracting, mark as done
      if (useStore.getState().progress.status === 'extracting') {
        setProgress({ status: 'done' });
        setHasExtracted(true);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        setProgress({ status: 'idle', currentFile: '' });
      } else {
        setProgress({ status: 'error' });
        const errorMessage =
          err instanceof Error ? err.message : t('review.unknownError');
        addResult({
          fileId: 'system',
          fileName: t('review.systemError'),
          success: false,
          error: errorMessage,
        });
        setHasExtracted(true);
      }
    } finally {
      abortRef.current = null;
    }
  }, [
    files,
    template,
    isExtracting,
    clearResults,
    setProgress,
    addResult,
    progress.status,
  ]);

  // ------------------------------------------------------------------
  // Abort
  // ------------------------------------------------------------------
  const handleAbort = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setProgress({ status: 'idle', currentFile: '' });
  }, [setProgress]);

  // ------------------------------------------------------------------
  // Progress percentage
  // ------------------------------------------------------------------
  const progressPercent =
    progress.totalFiles > 0
      ? Math.round((progress.completedFiles / progress.totalFiles) * 100)
      : 0;

  // ------------------------------------------------------------------
  // Auto-merge by patient + date
  // ------------------------------------------------------------------
  const mergeReport = useMemo(() => {
    if (progress.status !== 'done') return null;
    // Strategy: 1) group by filename prefix first, 2) fallback to patient+date for remaining
    const byFilename = mergeByFilename(results, { fallbackLabel: t('review.mergedRecords'), strategy: mergeStrategy });
    if (byFilename.groups.length > 0) {
      // Check if remaining unmerged results could be grouped by patient+date
      if (byFilename.unmerged.length >= 2) {
        const byPatient = mergeByPatientAndDate(byFilename.unmerged, { fallbackLabel: t('review.mergedRecords'), strategy: mergeStrategy });
        return {
          groups: [...byFilename.groups, ...byPatient.groups],
          unmerged: byPatient.unmerged,
          mergedCount: byFilename.mergedCount + byPatient.mergedCount,
          mergeKeys: { patients: [...byFilename.mergeKeys.patients, ...byPatient.mergeKeys.patients], dates: [...byFilename.mergeKeys.dates, ...byPatient.mergeKeys.dates] },
        };
      }
      return byFilename;
    }
    return mergeByPatientAndDate(results, { fallbackLabel: t('review.mergedRecords'), strategy: mergeStrategy });
  }, [results, progress.status, mergeStrategy, t]);

  const hasMerged = mergeReport && mergeReport.groups.length > 0;

  // ------------------------------------------------------------------
  // Merged data for "全部数据" view
  // ------------------------------------------------------------------
  const allSuccessfulResults = results.filter((r) => r.success);
  const mergedHeaders = (() => {
    const headerSet = new Set<string>();
    for (const r of allSuccessfulResults) {
      if (r.data) {
        Object.keys(r.data).forEach((k) => headerSet.add(k));
      }
    }
    // Also include fields from merged groups
    if (mergeReport) {
      for (const g of mergeReport.groups) {
        Object.keys(g.data).forEach((k) => headerSet.add(k));
      }
    }
    return Array.from(headerSet);
  })();

  // Rows to display: unmerged + merged groups
  const displayRows: DisplayRow[] = useMemo(() => {
    if (!mergeReport || mergeReport.groups.length === 0) {
      return allSuccessfulResults.map((r) => ({
        id: r.fileId,
        label: r.fileName,
        data: r.data || {},
        regions: r.regions || {},
        imageDataUrl: r.imageDataUrl,
        isMerged: false,
        sourceFiles: [r.fileName],
      }));
    }

    const rows: DisplayRow[] = [];

    // Add unmerged records
    for (const r of mergeReport.unmerged) {
      if (r.success && r.data) {
        rows.push({
          id: r.fileId,
          label: r.fileName,
          data: r.data,
          regions: r.regions || {},
          imageDataUrl: r.imageDataUrl,
          isMerged: false,
          sourceFiles: [r.fileName],
        });
      }
    }

    // Add merged groups
    for (const g of mergeReport.groups) {
      rows.push({
        id: g.fileId,
        label: g.label,
        data: g.data,
        regions: g.regions,
        imageDataUrl: g.imageDataUrl,
        isMerged: true,
        sourceFiles: g.fileNames,
        fieldConsistency: g.fieldConsistency,
      });
    }

    return rows;
  }, [allSuccessfulResults, mergeReport]);

  // Apply manual merges: hide consumed rows, add merged results
  const finalDisplayRows: DisplayRow[] = useMemo(() => {
    if (manualMerges.length === 0) return displayRows;

    const consumedIds = new Set<string>();
    const mergedRows: DisplayRow[] = [];

    for (const mm of manualMerges) {
      mm.ids.forEach((id) => consumedIds.add(id));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mergedRows.push(mm.merged);
    }

    const visible = displayRows.filter((r) => !consumedIds.has(r.id));
    return [...visible, ...mergedRows];
  }, [displayRows, manualMerges]);

  // ------------------------------------------------------------------
  // Manual merge: merge selected rows
  // ------------------------------------------------------------------
  const handleManualMerge = useCallback(() => {
    if (selectedRows.size < 2) return;

    const rowsToMerge = displayRows.filter((r) => selectedRows.has(r.id));
    if (rowsToMerge.length < 2) return;

    // Build merged data
    const mergedData: Record<string, unknown> = {};
    const mergedRegions: Record<string, { x: number; y: number; width: number; height: number }> = {};
    const fileNames: string[] = [];
    let mergedImageDataUrl: string | undefined;

    for (const row of rowsToMerge) {
      // Merge data: apply current strategy
      for (const [key, val] of Object.entries(row.data)) {
        const v = val != null ? String(val).trim() : '';
        const current = mergedData[key] != null ? String(mergedData[key]).trim() : '';
        const shouldOverwrite =
          mergeStrategy === 'latest_wins' ? v !== '' :
          mergeStrategy === 'longest_wins' ? v.length > current.length :
          v !== '' && current === '';
        if (shouldOverwrite) {
          mergedData[key] = val;
        }
      }
      Object.assign(mergedRegions, row.regions);
      fileNames.push(...row.sourceFiles);
      if (!mergedImageDataUrl && row.imageDataUrl) {
        mergedImageDataUrl = row.imageDataUrl;
      }
    }

    // Compute field consistency for manual merge
    const allKeys = new Set(rowsToMerge.flatMap((r) => Object.keys(r.data)));
    const manualConsistency: Record<string, boolean> = {};
    for (const key of allKeys) {
      const values = rowsToMerge
        .map((r) => r.data[key])
        .filter((v) => v != null && String(v).trim() !== '')
        .map((v) => String(v).trim());
      manualConsistency[key] = values.length <= 1 || values.every((v) => v === values[0]);
    }

    const ids = new Set(rowsToMerge.map((r) => r.id));
    setManualMerges((prev) => [
      ...prev,
      {
        ids,
        merged: {
          id: `manual-merged-${Date.now()}`,
          label: fileNames.join(' + '),
          data: mergedData,
          regions: mergedRegions,
          imageDataUrl: mergedImageDataUrl,
          isMerged: true,
          sourceFiles: fileNames,
          fieldConsistency: manualConsistency,
        },
      },
    ]);
    setSelectedRows(new Set());
  }, [selectedRows, displayRows, mergeStrategy]);

  const toggleRowSelection = useCallback((id: string) => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // Clear selection when extraction starts
  const wrappedHandleStart = useCallback(async () => {
    setSelectedRows(new Set());
    setManualMerges([]);
    await handleStart();
  }, [handleStart]);

  // Derived: current preview data
  const resultsWithImages = finalDisplayRows.filter((r) => r.imageDataUrl);

  // Sync merged data to store for export panel
  useEffect(() => {
    setMergedExportData(
      finalDisplayRows.map((row) => ({
        label: row.label,
        data: row.data,
        sourceFiles: row.sourceFiles,
        success: true,
      })),
    );
  }, [finalDisplayRows, setMergedExportData]);

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileSearch className="size-5" />
          {t('review.title')}
        </CardTitle>
        <CardDescription>{t('review.description')}</CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        {/* ---------- Start / Stop Buttons ---------- */}
        <div className="flex flex-wrap items-center gap-3">
          {isExtracting ? (
            <Button variant="destructive" size="lg" onClick={handleAbort}>
              <Square className="size-4" />
              {t('review.stop')}
            </Button>
          ) : (
            <>
              <Button
                size="lg"
                disabled={!canStart}
                onClick={wrappedHandleStart}
              >
                <Play className="size-4" />
                {hasExtracted ? t('review.restart') : t('review.start')}
              </Button>
              {hasExtracted && (
                <Button
                  variant="outline"
                  size="lg"
                  onClick={wrappedHandleStart}
                  disabled={!canStart}
                >
                  <RotateCcw className="size-4" />
                  {t('review.restart')}
                </Button>
              )}
            </>
          )}

          {!canStart && !isExtracting && (
            <p className="text-muted-foreground text-sm">
              {t('review.hintNoFiles')}
            </p>
          )}
        </div>

        {/* ---------- Progress ---------- */}
        {isExtracting && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {t('review.processing', { file: progress.currentFile || t('review.preparing') })}
              </span>
              <span className="font-medium">
                {progress.completedFiles} / {progress.totalFiles}
              </span>
            </div>
            <Progress value={progressPercent} className="h-2" />
          </div>
        )}

        {/* ---------- Status ---------- */}
        {progress.status === 'done' && (
          <div className="flex items-center gap-2 text-sm text-emerald-600">
            <CheckCircle2 className="size-4" />
            {t('review.complete')}
          </div>
        )}
        {progress.status === 'error' && (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <XCircle className="size-4" />
            {t('review.error')}
          </div>
        )}

        {/* ---------- Results ---------- */}
        {(results.length > 0 || hasExtracted) && (
          <div className="flex flex-col gap-4">
            <Separator />

            {/* ---- Summary Bar with actions ---- */}
            <div className="flex items-center gap-3 flex-wrap">
              <BarChart3 className="text-muted-foreground size-4" />
              <span className="text-sm">
                {t('review.summary', { total: results.length })}
              </span>
              {successfulCount > 0 && (
                <Badge variant="secondary">
                  {t('review.succeeded', { count: successfulCount })}
                </Badge>
              )}
              {failedCount > 0 && (
                <Badge variant="destructive">
                  {t('review.failed', { count: failedCount })}
                </Badge>
              )}
              {hasMerged && (
                <Badge variant="secondary" className="gap-1">
                  <GitMerge className="size-3" />
                  {t('review.mergeGroups', { groups: mergeReport!.groups.length, records: mergeReport!.mergedCount })}
                </Badge>
              )}

              {hasMerged && (
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="text-muted-foreground">{t('review.mergeStrategy')}:</span>
                  {([
                    { value: 'first_wins' as const, label: t('review.mergeFirstWins') },
                    { value: 'latest_wins' as const, label: t('review.mergeLatestWins') },
                    { value: 'longest_wins' as const, label: t('review.mergeLongestWins') },
                  ]).map((opt) => (
                    <Button
                      key={opt.value}
                      variant={mergeStrategy === opt.value ? 'default' : 'outline'}
                      size="sm"
                      className="h-6 text-xs px-2"
                      onClick={() => setMergeStrategy(opt.value)}
                    >
                      {opt.label}
                    </Button>
                  ))}
                </div>
              )}

              <div className="flex-1" />

              {/* Manual merge button */}
              {selectedRows.size >= 2 && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleManualMerge}
                  className="gap-1"
                >
                  <GitMerge className="size-3.5" />
                  {t('review.mergeSelected', { count: selectedRows.size })}
                </Button>
              )}

              {/* Toggle detail cards */}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowDetails(!showDetails)}
                className="gap-1"
              >
                <List className="size-3.5" />
                {showDetails ? t('review.hideDetails') : t('review.showDetails')}
              </Button>
            </div>

            {/* ---- Main data table + Image viewer ---- */}
            {finalDisplayRows.length > 0 && mergedHeaders.length > 0 && (
              <div className="flex flex-col gap-2">
                <div
                  className={`gap-4 ''
                  }`}
                >
                  {/* Data table */}
                  <div
                    className={`max-h-[60vh] overflow-auto rounded-md border ${
                      resultsWithImages.length > 0 ? '' : ''
                    }`}
                  >
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-8">
                            <CheckSquare className="size-3.5 text-muted-foreground" />
                          </TableHead>
                          <TableHead className="w-36">{t('review.fileName')}</TableHead>
                          {mergedHeaders.map((h) => (
                            <TableHead key={h}>
                              <div className="flex items-center gap-1">
                                <span>{h}</span>
                              </div>
                            </TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {finalDisplayRows.map((row) => {
                          const isRowSelected = row.id === selectedFileId;
                          const isChecked = selectedRows.has(row.id);
                          return (
                            <TableRow
                              key={row.id}
                              className={
                                isRowSelected
                                  ? 'bg-primary/5 hover:bg-primary/10'
                                  : row.isMerged
                                    ? 'bg-amber-50/50 dark:bg-amber-900/5 hover:bg-muted/50'
                                    : isChecked
                                      ? 'bg-blue-50/50 dark:bg-blue-900/10 hover:bg-muted/50'
                                      : 'hover:bg-muted/50'
                              }
                            >
                              {/* Checkbox */}
                              <TableCell className="p-2">
                                <Checkbox
                                  checked={isChecked}
                                  onCheckedChange={() => toggleRowSelection(row.id)}
                                />
                              </TableCell>

                              {/* File name / label */}
                              <TableCell
                                className={`font-medium cursor-pointer ${
                                  row.imageDataUrl ? 'text-primary hover:underline' : ''
                                }`}
                                onClick={() => {
                                  if (row.imageDataUrl) {
                                    setSelectedFileId(
                                      row.id === selectedFileId ? null : row.id
                                    );
                                  }
                                }}
                              >
                                <div className="flex items-center gap-1.5">
                                  {row.imageDataUrl && (
                                    <ImageIcon className="size-3.5 text-muted-foreground" />
                                  )}
                                  {row.isMerged && (
                                    <GitMerge className="size-3.5 text-amber-500" />
                                  )}
                                  <span className="truncate max-w-[120px]">
                                    {row.label}
                                  </span>
                                </div>
                                {row.isMerged && row.sourceFiles.length > 1 && (
                                  <div className="text-[10px] text-muted-foreground mt-0.5 max-w-[140px] truncate">
                                    {row.sourceFiles.join(', ')}
                                  </div>
                                )}
                              </TableCell>

                              {/* Data cells */}
                              {mergedHeaders.map((h) => {
                                const value = row.data[h];
                                const isInconsistent = row.fieldConsistency?.[h] === false;
                                return (
                                  <TableCell
                                    key={h}
                                    className={isInconsistent ? 'bg-amber-100 dark:bg-amber-900/20' : ''}
                                  >
                                    <div className="flex items-center gap-1">
                                      <span className="max-w-[150px] truncate">
                                        {renderFieldValue(value)}
                                      </span>
                                    </div>
                                  </TableCell>
                                );
                              })}
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>

                </div>
              </div>
            )}

            {/* ---- Individual result cards (collapsible) ---- */}
            {showDetails && (
              <div className="flex flex-col gap-3">
                <Separator />
                <h4 className="text-sm font-medium text-muted-foreground">
                  {t('review.fileDetails')}
                </h4>
                {results.map((result, idx) => (
                  <ResultCard key={`${result.fileId}-${idx}`} result={result} />
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Single result card (collapsible)
// ---------------------------------------------------------------------------

interface ResultCardProps {
  result: {
    fileId: string;
    fileName: string;
    success: boolean;
    data?: Record<string, unknown>;
    rawResponse?: string;
    error?: string;
  };
}

function ResultCard({ result }: ResultCardProps) {
  const t = useT();
  const [open, setOpen] = useState(true);

  if (!result.success) {
    return (
      <Card className="border-destructive/30 bg-destructive/5">
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger className="flex w-full items-center gap-2 px-4 py-3 text-sm font-medium">
            {open ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            )}
            <XCircle className="text-destructive size-4" />
            {result.fileName}
            <Badge variant="destructive" className="ml-auto">{t('review.failedBadge')}</Badge>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="px-4 pb-3 text-sm text-destructive">
              {result.error || t('review.noErrorDetail')}
            </div>
            {result.rawResponse && (
              <div className="px-4 pb-3">
                <RawResponseBlock raw={result.rawResponse} />
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>
      </Card>
    );
  }

  const entries = result.data ? Object.entries(result.data) : [];

  return (
    <Card>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex w-full items-center gap-2 px-4 py-3 text-sm font-medium">
          {open ? (
            <ChevronDown className="size-4" />
          ) : (
            <ChevronRight className="size-4" />
          )}
          <CheckCircle2 className="text-emerald-600 size-4" />
          {result.fileName}
          <Badge variant="secondary" className="ml-auto">
            {t('review.fieldsCount', { count: entries.length })}
          </Badge>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0">
            <div className="flex flex-col gap-4">
              {/* Extracted data table */}
              {entries.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-40">{t('review.field')}</TableHead>
                      <TableHead>{t('review.value')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entries.map(([key, value]) => (
                      <TableRow key={key}>
                        <TableCell className="font-medium">{key}</TableCell>
                        <TableCell>
                          {value != null ? String(value) : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-muted-foreground text-sm">
                  {t('review.noData')}
                </p>
              )}

              {/* Raw response collapsible */}
              {result.rawResponse && (
                <RawResponseBlock raw={result.rawResponse} />
              )}
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Raw response display (collapsible)
// ---------------------------------------------------------------------------

function RawResponseBlock({ raw }: { raw: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs transition-colors">
        {open ? (
          <ChevronDown className="size-3" />
        ) : (
          <ChevronRight className="size-3" />
        )}
        {t('review.rawResponse')}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="bg-muted mt-1 max-h-48 overflow-y-auto rounded-md p-3 text-xs leading-relaxed">
          {raw}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}
