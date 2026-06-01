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
  GitMerge,
  List,
  Loader2,
  FolderTree,
  Layers,
  Merge,
  AlignJustify,
} from 'lucide-react';
import { useStore } from '@/lib/store';
import { useT } from '@/lib/i18n';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
// Types for backend pipeline events
// ---------------------------------------------------------------------------

interface PipelineRow {
  id: string;
  label: string;
  data: Record<string, unknown>;
  sourceFiles: string[];
  isMerged: boolean;
  fieldConsistency?: Record<string, boolean>;
  mergeMethod?: string;
}

interface PipelinePhase {
  key: 'grouping' | 'extracting' | 'aligning' | 'merging';
  status: 'pending' | 'active' | 'done';
  detail: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse SSE text into { event, data } chunks. */
function parseSSEChunks(text: string): { event: string; data: string }[] {
  const events: { event: string; data: string }[] = [];
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

/** Render a field value with type-aware formatting */
function renderFieldValue(value: unknown): string {
  if (value == null) return '\u2014';
  if (typeof value === 'object' && !Array.isArray(value) && 'value' in value && 'unit' in value) {
    const v = (value as { value: unknown; unit: string }).value;
    const u = (value as { value: unknown; unit: string }).unit;
    return `${v} ${u}`;
  }
  if (Array.isArray(value)) return value.map(String).join(', ');
  return String(value);
}

// ---------------------------------------------------------------------------
// Pipeline Phase Indicator
// ---------------------------------------------------------------------------

const PHASE_META: Record<string, { icon: typeof FolderTree; labelKey: string }> = {
  grouping: { icon: FolderTree, labelKey: 'pipeline.phaseGrouping' },
  extracting: { icon: Layers, labelKey: 'pipeline.phaseExtracting' },
  aligning: { icon: AlignJustify, labelKey: 'pipeline.phaseAligning' },
  merging: { icon: Merge, labelKey: 'pipeline.phaseMerging' },
};

function PhaseIndicator({ phases }: { phases: PipelinePhase[] }) {
  const t = useT();
  return (
    <div className="flex items-center gap-1">
      {phases.map((phase, idx) => {
        const meta = PHASE_META[phase.key] ?? PHASE_META.extracting;
        const Icon = meta.icon;
        const isActive = phase.status === 'active';
        const isDone = phase.status === 'done';

        return (
          <div key={phase.key} className="flex items-center">
            <div
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : isDone
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground/50'
              }`}
            >
              {isActive ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : isDone ? (
                <CheckCircle2 className="size-3.5" />
              ) : (
                <Icon className="size-3.5" />
              )}
              <span>{t(meta.labelKey)}</span>
              {phase.detail && (
                <span className="opacity-70 ml-0.5">
                  {phase.detail}
                </span>
              )}
            </div>
            {idx < phases.length - 1 && (
              <div className={`mx-1 h-px w-4 ${isDone ? 'bg-primary/30' : 'bg-muted'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ReviewPanel() {
  const t = useT();
  const files = useStore((s) => s.files);
  const progress = useStore((s) => s.progress);
  const clearResults = useStore((s) => s.clearResults);
  const addResult = useStore((s) => s.addResult);
  const setProgress = useStore((s) => s.setProgress);
  const setMergedExportData = useStore((s) => s.setMergedExportData);
  const promptSettings = useStore((s) => s.promptSettings);

  const abortRef = useRef<AbortController | null>(null);
  const [hasExtracted, setHasExtracted] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  // Pipeline result state
  const [pipelineRows, setPipelineRows] = useState<PipelineRow[]>([]);
  const [schemaHeaders, setSchemaHeaders] = useState<string[]>([]);
  const [phases, setPhases] = useState<PipelinePhase[]>([
    { key: 'grouping', status: 'pending', detail: '' },
    { key: 'extracting', status: 'pending', detail: '' },
    { key: 'aligning', status: 'pending', detail: '' },
    { key: 'merging', status: 'pending', detail: '' },
  ]);

  const isExtracting = progress.status === 'extracting';
  const canStart = files.length > 0;

  const mergedHeaders = useMemo(() => {
    if (schemaHeaders.length > 0) return schemaHeaders;
    const headerSet = new Set<string>();
    for (const row of pipelineRows) {
      Object.keys(row.data).forEach((k) => headerSet.add(k));
    }
    return Array.from(headerSet);
  }, [pipelineRows, schemaHeaders]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    };
  }, []);

  // ------------------------------------------------------------------
  // Start extraction
  // ------------------------------------------------------------------
  const handleStart = useCallback(async () => {
    if (isExtracting) return;

    clearResults();
    setHasExtracted(false);
    setPipelineRows([]);
    setSchemaHeaders([]);
    setPhases([
      { key: 'grouping', status: 'pending', detail: '' },
      { key: 'extracting', status: 'pending', detail: '' },
      { key: 'aligning', status: 'pending', detail: '' },
      { key: 'merging', status: 'pending', detail: '' },
    ]);

    const total = files.length;
    setProgress({
      totalFiles: total,
      completedFiles: 0,
      currentFile: '',
      status: 'extracting',
    });

    const body = {
      files: files.map((f) => ({
        id: f.id,
        name: f.name,
        size: f.size,
        type: f.type,
        content: f.content,
        dataUrl: f.dataUrl,
      })),
      prompts: {
        extraction: promptSettings.extraction || undefined,
        schemaAlign: promptSettings.schemaAlign || undefined,
        merge: promptSettings.merge || undefined,
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

      // Local counters for progress tracking
      let completedFiles = 0;
      let totalFiles = total;
      let groupsDone = false;
      const groupLabels: string[] = [];
      let mergedGroups = 0;
      let totalGroups = 0;
      let extractedCount = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const events = parseSSEChunks(buffer);
        const lastNewline = buffer.lastIndexOf('\n\n');
        if (lastNewline !== -1) {
          buffer = buffer.slice(lastNewline + 2);
        }

        for (const evt of events) {
          try {
            const parsed = JSON.parse(evt.data);

            switch (evt.event) {
              case 'phase': {
                const phase = parsed.phase as string;
                setPhases((prev) =>
                  prev.map((p) =>
                    p.key === phase
                      ? { ...p, status: 'active', detail: '' }
                      : p.status === 'active'
                        ? { ...p, status: 'active' }
                        : p,
                  ),
                );
                break;
              }

              case 'grouping_done': {
                totalGroups = parsed.groups?.length ?? 0;
                for (const g of parsed.groups ?? []) {
                  groupLabels.push(g.label);
                }
                setPhases((prev) =>
                  prev.map((p) =>
                    p.key === 'grouping'
                      ? { ...p, status: 'done', detail: `${totalGroups}` }
                      : p,
                  ),
                );
                groupsDone = true;
                break;
              }

              case 'file_retry': {
                // Update extracting phase detail to show retry info
                setPhases((prev) =>
                  prev.map((p) =>
                    p.key === 'extracting'
                      ? { ...p, detail: `(${completedFiles + 1}/${totalFiles}) retry ${parsed.attempt}` }
                      : p,
                  ),
                );
                break;
              }

              case 'file_start': {
                setPhases((prev) =>
                  prev.map((p) =>
                    p.key === 'extracting'
                      ? { ...p, status: 'active', detail: `(${completedFiles + 1}/${totalFiles})` }
                      : p,
                  ),
                );
                setProgress({ currentFile: parsed.fileName ?? '' });
                break;
              }

              case 'file_complete': {
                completedFiles++;
                extractedCount += parsed.success ? 1 : 0;
                setProgress({ completedFiles });
                if (completedFiles >= totalFiles && groupsDone) {
                  setPhases((prev) =>
                    prev.map((p) =>
                      p.key === 'extracting'
                        ? { ...p, status: 'done', detail: `(${extractedCount}/${totalFiles})` }
                        : p,
                    ),
                  );
                }
                addResult({
                  fileId: String(parsed.fileId ?? ''),
                  fileName: parsed.fileName ?? '',
                  success: parsed.success ?? false,
                  data: parsed.data,
                  error: parsed.error,
                });
                break;
              }

              case 'merge_start': {
                mergedGroups++;
                setPhases((prev) =>
                  prev.map((p) =>
                    p.key === 'merging'
                      ? { ...p, status: 'active', detail: `${parsed.label} (${parsed.fileCount})` }
                      : p,
                  ),
                );
                break;
              }

              case 'group_merged': {
                const method = parsed.mergeMethod ?? '';
                const count = parsed.mergedCount ?? 0;
                const label = parsed.groupKey ?? '';
                setPhases((prev) =>
                  prev.map((p) =>
                    p.key === 'merging'
                      ? {
                          ...p,
                          detail: t('pipeline.mergeProgress', {
                            current: mergedGroups,
                            total: totalGroups,
                          }),
                        }
                      : p,
                  ),
                );
                break;
              }

              case 'schema_ready': {
                setSchemaHeaders(parsed.headers ?? []);
                setPhases((prev) =>
                  prev.map((p) =>
                    p.key === 'aligning' ? { ...p, status: 'done', detail: `${parsed.headers?.length ?? 0}` } : p,
                  ),
                );
                break;
              }

              case 'all_done': {
                setPhases((prev) =>
                  prev.map((p) => ({ ...p, status: 'done' })),
                );
                setProgress({ status: 'done' });
                setHasExtracted(true);

                const rows: PipelineRow[] = (parsed.rows ?? []).map((r: any) => ({
                  id: r.id ?? '',
                  label: r.label ?? '',
                  data: r.data ?? {},
                  sourceFiles: r.sourceFiles ?? [],
                  isMerged: r.isMerged ?? false,
                  fieldConsistency: r.fieldConsistency,
                  mergeMethod: r.mergeMethod,
                }));
                setPipelineRows(rows);

                setMergedExportData(
                  rows.map((row) => ({
                    label: row.label,
                    data: row.data,
                    sourceFiles: row.sourceFiles,
                    success: true,
                  })),
                );
                break;
              }

              case 'error': {
                setPhases((prev) =>
                  prev.map((p) => {
                    if (p.status === 'active') return { ...p, status: 'pending', detail: '' };
                    return p;
                  }),
                );
                setProgress({ status: 'error' });
                addResult({
                  fileId: 'system',
                  fileName: t('review.systemError'),
                  success: false,
                  error: parsed.message ?? t('review.unknownError'),
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

      if (useStore.getState().progress.status === 'extracting') {
        setPhases((prev) => prev.map((p) => ({ ...p, status: 'done' })));
        setProgress({ status: 'done' });
        setHasExtracted(true);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        setProgress({ status: 'idle', currentFile: '' });
        setPhases((prev) =>
          prev.map((p) => {
            if (p.status === 'active') return { ...p, status: 'pending', detail: '' };
            return p;
          }),
        );
      } else {
        setPhases((prev) =>
          prev.map((p) => {
            if (p.status === 'active') return { ...p, status: 'pending', detail: '' };
            return p;
          }),
        );
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
    isExtracting,
    clearResults,
    setProgress,
    addResult,
    setMergedExportData,
    progress.status,
    t,
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
                onClick={handleStart}
              >
                <Play className="size-4" />
                {hasExtracted ? t('review.restart') : t('review.start')}
              </Button>
              {hasExtracted && (
                <Button
                  variant="outline"
                  size="lg"
                  onClick={handleStart}
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

        {/* ---------- Pipeline Phase Indicator ---------- */}
        {(isExtracting || (hasExtracted && phases.some((p) => p.status !== 'pending'))) && (
          <PhaseIndicator phases={phases} />
        )}

        {/* ---------- File-level progress during extraction ---------- */}
        {isExtracting && phases[1]?.status === 'active' && (
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span className="truncate">
              {progress.currentFile || t('review.preparing')}
            </span>
            <span className="font-medium tabular-nums">
              {progress.completedFiles} / {progress.totalFiles}
            </span>
          </div>
        )}

        {/* ---------- Status ---------- */}
        {progress.status === 'done' && !isExtracting && (
          <div className="flex items-center gap-2 text-sm text-emerald-600">
            <CheckCircle2 className="size-4" />
            <span>
              {t('review.completeSummary', {
                groups: phases[0]?.detail || '0',
                rows: pipelineRows.length,
                fields: mergedHeaders.length,
              })}
            </span>
          </div>
        )}
        {progress.status === 'error' && !isExtracting && (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <XCircle className="size-4" />
            {t('review.error')}
          </div>
        )}

        {/* ---------- Results ---------- */}
        {(pipelineRows.length > 0 || hasExtracted) && (
          <div className="flex flex-col gap-4">
            <Separator />

            {/* ---- Summary Bar ---- */}
            <div className="flex items-center gap-3 flex-wrap">
              <BarChart3 className="text-muted-foreground size-4" />
              <span className="text-sm">
                {t('review.summary', { total: progress.totalFiles })}
              </span>
              <Badge variant="secondary">
                {t('review.succeeded', { count: pipelineRows.length })}
              </Badge>

              <div className="flex-1" />
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

            {/* ---- Main data table ---- */}
            {pipelineRows.length > 0 && mergedHeaders.length > 0 && (
              <div className="flex flex-col gap-2">
                <div className="max-h-[60vh] overflow-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-36">{t('review.fileName')}</TableHead>
                        {mergedHeaders.map((h) => (
                          <TableHead key={h}>{h}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pipelineRows.map((row) => {
                        return (
                          <TableRow
                            key={row.id}
                            className={
                              row.isMerged
                                ? 'bg-amber-50/50 dark:bg-amber-900/5 hover:bg-muted/50'
                                : 'hover:bg-muted/50'
                            }
                          >
                            <TableCell className="font-medium">
                              <div className="flex items-center gap-1.5">
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
            )}

            {/* ---- No results ---- */}
            {hasExtracted && pipelineRows.length === 0 && (
              <p className="text-muted-foreground text-sm text-center py-8">
                {t('review.noResults')}
              </p>
            )}

            {/* ---- Individual result cards ---- */}
            {showDetails && (
              <div className="flex flex-col gap-3">
                <Separator />
                <h4 className="text-sm font-medium text-muted-foreground">
                  {t('review.fileDetails')}
                </h4>
                {pipelineRows.map((row) => (
                  <PipelineResultCard key={row.id} row={row} headers={mergedHeaders} />
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
// Pipeline result card (collapsible)
// ---------------------------------------------------------------------------

interface PipelineResultCardProps {
  row: PipelineRow;
  headers: string[];
}

function PipelineResultCard({ row, headers }: PipelineResultCardProps) {
  const t = useT();
  const [open, setOpen] = useState(true);

  const entries = headers
    .filter((h) => row.data[h] != null)
    .map((h) => [h, row.data[h]] as [string, unknown]);

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
          {row.label}
          {row.isMerged && (
            <Badge variant="secondary" className="ml-auto gap-1">
              <GitMerge className="size-3" />
              {row.mergeMethod || t('review.mergedRecords')}
            </Badge>
          )}
          {!row.isMerged && (
            <Badge variant="secondary" className="ml-auto">
              {t('review.fieldsCount', { count: entries.length })}
            </Badge>
          )}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0">
            <div className="flex flex-col gap-4">
              {row.isMerged && row.sourceFiles.length > 0 && (
                <div className="text-xs text-muted-foreground">
                  {row.sourceFiles.join(', ')}
                </div>
              )}

              {entries.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-40">{t('review.field')}</TableHead>
                      <TableHead>{t('review.value')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entries.map(([key, value]) => {
                      const isInconsistent = row.fieldConsistency?.[key] === false;
                      return (
                        <TableRow key={key}>
                          <TableCell className={`font-medium ${isInconsistent ? 'bg-amber-100 dark:bg-amber-900/20' : ''}`}>
                            {key}
                          </TableCell>
                          <TableCell className={isInconsistent ? 'bg-amber-100 dark:bg-amber-900/20' : ''}>
                            {renderFieldValue(value)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-muted-foreground text-sm">
                  {t('review.noData')}
                </p>
              )}
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
