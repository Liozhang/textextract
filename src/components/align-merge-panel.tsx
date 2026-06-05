'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  RotateCcw,
  Square,
  GitMerge,
  List,
  Loader2,
  AlertTriangle,
  BarChart3,
  RefreshCw,
} from 'lucide-react';
import { useStore } from '@/lib/store';
import { useT } from '@/lib/i18n';
import {
  PipelinePhase,
  PipelineRow,
  consumeSSEStream,
  renderFieldValue,
  PhaseIndicator,
  PipelineResultCard,
} from '@/lib/pipeline-helpers';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INIT_PHASES: PipelinePhase[] = [
  { key: 'grouping', status: 'done', detail: '' },
  { key: 'extracting', status: 'done', detail: '' },
  { key: 'merging', status: 'pending', detail: '' },
];

const ALL_DONE_PHASES: PipelinePhase[] = [
  { key: 'grouping', status: 'done', detail: '' },
  { key: 'extracting', status: 'done', detail: '' },
  { key: 'merging', status: 'done', detail: '' },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AlignMergePanel() {
  const t = useT();
  const progress = useStore((s) => s.progress);
  const addResult = useStore((s) => s.addResult);
  const setProgress = useStore((s) => s.setProgress);
  const setMergedExportData = useStore((s) => s.setMergedExportData);
  const resetTemplate = useStore((s) => s.resetTemplate);
  const setStep = useStore((s) => s.setStep);

  const abortRef = useRef<AbortController | null>(null);
  const intentionalAbortRef = useRef(false);
  const [showDetails, setShowDetails] = useState(false);
  const [retryingGroupId, setRetryingGroupId] = useState<string | null>(null);
  const [retryPhase, setRetryPhase] = useState('');
  const [retrySchemaHeaders, setRetrySchemaHeaders] = useState<string[]>([]);

  const [pipelineRows, setPipelineRowsState] = useState<PipelineRow[]>([]);
  const pipelineRowsRef = useRef<PipelineRow[]>([]);
  const setPipelineRows = useCallback((rows: PipelineRow[] | ((prev: PipelineRow[]) => PipelineRow[])) => {
    setPipelineRowsState((prev) => {
      const next = typeof rows === 'function' ? rows(prev) : rows;
      pipelineRowsRef.current = next;
      return next;
    });
  }, []);
  const [schemaHeaders, setSchemaHeaders] = useState<string[]>([]);
  const [schemaAlignFallback, setSchemaAlignFallback] = useState(false);
  const hasTemplateColumns = useStore((s) => s.templateColumns.length > 0);
  const mergedExportData = useStore((s) => s.mergedExportData);

  // Restore pipelineRows from mergedExportData when returning after align-merge completed
  useEffect(() => {
    if (isDone && pipelineRows.length === 0 && mergedExportData.length > 0) {
      const restored: PipelineRow[] = mergedExportData.map((row, idx) => ({
        id: `row-${idx}`,
        label: row.label,
        data: row.data,
        sourceFiles: row.sourceFiles,
        isMerged: true,
      }));
      setPipelineRows(restored);
    }
  }, [isDone, mergedExportData]); // eslint-disable-line react-hooks/exhaustive-deps
  const [phases, setPhases] = useState<PipelinePhase[]>(() => {
    if (progress.status === 'done') return [...ALL_DONE_PHASES];
    const base: PipelinePhase[] = [
      { key: 'grouping', status: 'done' as const, detail: '' },
      { key: 'extracting', status: 'done' as const, detail: '' },
      { key: 'merging', status: 'pending' as const, detail: '' },
    ];
    if (hasTemplateColumns) {
      base.push({ key: 'aligning', status: 'pending' as const, detail: '' });
    }
    return base;
  });

  const isAligning = progress.status === 'aligning_merging';
  const isDone = progress.status === 'done';
  const isError = progress.status === 'error';
  const isStopped = progress.status === 'extraction_done' && pipelineRows.length === 0;

  const mergedHeaders = useMemo(() => {
    if (schemaHeaders.length > 0) return schemaHeaders;
    const headerSet = new Set<string>();
    for (const row of pipelineRows) {
      Object.keys(row.data).forEach((k) => headerSet.add(k));
    }
    return Array.from(headerSet);
  }, [pipelineRows, schemaHeaders]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    };
  }, []);

  // ------------------------------------------------------------------
  // Reconfigure: go back to template step
  // ------------------------------------------------------------------
  const handleReconfigure = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    resetTemplate();
    setPipelineRows([]);
    setSchemaHeaders([]);
    setSchemaAlignFallback(false);
    setPhases([...INIT_PHASES]);
    setProgress({ status: 'extraction_done' });
    setStep('template');
  }, [resetTemplate, setProgress, setStep]);

  // ------------------------------------------------------------------
  // Abort
  // ------------------------------------------------------------------
  const handleAbort = useCallback(() => {
    intentionalAbortRef.current = true;
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setProgress({ status: 'extraction_done', currentFile: '' });
    setPhases((prev) =>
      prev.map((p) => {
        if (p.status === 'active') return { ...p, status: 'pending', detail: '' };
        return p;
      }),
    );
  }, [setProgress]);

  // ------------------------------------------------------------------
  // Align + Merge (SSE stream to /api/align-merge)
  // ------------------------------------------------------------------
  const handleAlignMerge = useCallback(async () => {
    const snapshot = useStore.getState().extractionSnapshot;
    if (!snapshot) return;

    setPipelineRows([]);
    setSchemaHeaders([]);
    setSchemaAlignFallback(false);

    const currentColumns = useStore.getState().templateColumns;
    const hasTemplate = currentColumns.length > 0;

    const basePhases: PipelinePhase[] = [
      { key: 'grouping', status: 'done' as const, detail: '' },
      { key: 'extracting', status: 'done' as const, detail: '' },
      { key: 'merging', status: 'pending' as const, detail: '' },
    ];
    if (hasTemplate) {
      basePhases.push({ key: 'aligning', status: 'pending' as const, detail: '' });
    }
    setPhases(basePhases);
    setProgress({ status: 'aligning_merging' });

    const currentPromptSettings = useStore.getState().promptSettings;

    const body: Record<string, unknown> = {
      // Use server sessionId for disk-based reading (preferred)
      ...(snapshot.serverSessionId ? { sessionId: snapshot.serverSessionId } : {
        // Fallback: send extraction data inline (backward compat)
        extractionData: snapshot.results.map((r) => ({
          fileId: r.fileId,
          fileName: r.fileName,
          groupId: r.groupId,
          success: r.success,
          data: r.data,
          entries: r.entries,
          headerData: r.headerData,
          error: r.error,
        })),
      }),
      groups: snapshot.groups.map((g) => ({ groupId: g.groupId, groupKey: g.groupKey })),
      ...(currentColumns.length > 0 ? { columns: currentColumns } : {}),
      prompts: {
        merge: currentPromptSettings.merge || undefined,
        templateAlign: currentPromptSettings.templateAlign || undefined,
      },
      ...(useStore.getState().apiSettings.baseUrl || useStore.getState().apiSettings.apiKey || useStore.getState().apiSettings.model ? {
        apiSettings: {
          ...useStore.getState().apiSettings,
          cacheExpiryHours: useStore.getState().cacheSettings.expiryHours || undefined,
        },
      } : {}),
    };

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch('/api/align-merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(t('review.serverError', { code: response.status, text: response.statusText }));
      }

      let mergedGroups = 0;
      const totalGroups = snapshot.groups.length;

      await consumeSSEStream(response, (event, parsed) => {
        switch (event) {
          case 'phase': {
            const phase = parsed.phase as string;
            setPhases((prev) =>
              prev.map((p) =>
                p.key === phase
                  ? { ...p, status: 'active', detail: '' }
                  : p,
              ),
            );
            break;
          }

          case 'schema_ready': {
            setSchemaHeaders(parsed.headers ?? []);
            if (parsed.aiFailed) setSchemaAlignFallback(true);
            setPhases((prev) =>
              prev.map((p) =>
                p.key === 'aligning'
                  ? { ...p, status: 'done', detail: `${parsed.headers?.length ?? 0}` }
                  : p,
              ),
            );
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

          case 'align_start': {
            setPhases((prev) =>
              prev.map((p) =>
                p.key === 'aligning'
                  ? { ...p, status: 'active', detail: `${parsed.label} (${parsed.entryCount})` }
                  : p.key === 'merging'
                    ? { ...p, status: 'done' }
                    : p,
              ),
            );
            break;
          }

          case 'group_aligned': {
            setPhases((prev) =>
              prev.map((p) =>
                p.key === 'aligning'
                  ? { ...p, detail: `${parsed.groupKey} \u2713` }
                  : p,
              ),
            );
            break;
          }

          case 'group_error': {
            addResult({
              fileId: `group-${parsed.groupId}`,
              fileName: parsed.groupKey || t('review.systemError'),
              success: false,
              error: parsed.message ?? t('review.unknownError'),
            });
            break;
          }

          case 'all_done': {
            setPhases((prev) =>
              prev.map((p) => ({ ...p, status: 'done' })),
            );
            setProgress({ status: 'done' });

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

            // Clean up server temp files (deferred from extraction-panel)
            const sIds = [...new Set(useStore.getState().files.map((f) => f.sessionId).filter(Boolean))] as string[]
            sIds.forEach((sid) => {
              fetch(`/api/upload/${sid}`, { method: 'DELETE' }).catch(() => {});
            });
            // Clear localStorage snapshot — align-merge done, no longer needed
            localStorage.removeItem('ocr-extract-snapshot');
            // Clear extraction snapshot to free memory
            useStore.getState().clearExtractionSnapshot();
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
            break;
          }
        }
      });

      // Stream ended without explicit all_done — sync pipelineRows to mergedExportData
      if (useStore.getState().progress.status === 'aligning_merging') {
        setPhases((prev) => prev.map((p) => ({ ...p, status: 'done' })));
        setProgress({ status: 'done' });
        const currentRows = pipelineRowsRef.current;
        if (currentRows.length > 0) {
          setMergedExportData(
            currentRows.map((row) => ({
              label: row.label,
              data: row.data,
              sourceFiles: row.sourceFiles,
              success: true,
            })),
          );
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        // If abort was NOT intentional (e.g., HMR refresh, component unmount),
        // reset progress so the UI shows the "start" button on re-mount
        if (!intentionalAbortRef.current) {
          setProgress({ status: 'extraction_done' });
          setPhases((prev) =>
            prev.map((p) => (p.status === 'active' ? { ...p, status: 'pending', detail: '' } : p)),
          );
        }
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
      }
    } finally {
      abortRef.current = null;
    }
  }, [t, addResult, setMergedExportData, setProgress]);

  // Auto-start when component mounts or progress transitions to extraction_done
  const hasStarted = useRef(false);
  useEffect(() => {
    if (progress.status === 'extraction_done' && !hasStarted.current && useStore.getState().templateColumns.length > 0) {
      hasStarted.current = true;
      handleAlignMerge();
    }
  }, [progress.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------------------------
  // Retry single group
  // ------------------------------------------------------------------
  const handleRetryGroup = useCallback(async (groupId: string) => {
    const snapshot = useStore.getState().extractionSnapshot;
    const currentColumns = useStore.getState().templateColumns;
    if (!snapshot || currentColumns.length === 0) return;

    setRetryingGroupId(groupId);

    const body: Record<string, unknown> = {
      ...(snapshot.serverSessionId ? { sessionId: snapshot.serverSessionId } : {
        extractionData: snapshot.results.map((r) => ({
          fileId: r.fileId,
          fileName: r.fileName,
          groupId: r.groupId,
          success: r.success,
          data: r.data,
          entries: r.entries,
          headerData: r.headerData,
          error: r.error,
        })),
      }),
      groups: snapshot.groups.map((g) => ({ groupId: g.groupId, groupKey: g.groupKey })),
      columns: currentColumns,
      retryGroupIds: [groupId],
      prompts: {
        merge: useStore.getState().promptSettings.merge || undefined,
        templateAlign: useStore.getState().promptSettings.templateAlign || undefined,
      },
      ...(useStore.getState().apiSettings.baseUrl || useStore.getState().apiSettings.apiKey || useStore.getState().apiSettings.model ? {
        apiSettings: {
          ...useStore.getState().apiSettings,
          cacheExpiryHours: useStore.getState().cacheSettings.expiryHours || undefined,
        },
      } : {}),
    };

    try {
      const response = await fetch('/api/align-merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(t('review.serverError', { code: response.status, text: response.statusText }));
      }

      await consumeSSEStream(response, (event, parsed) => {
        switch (event) {
          case 'phase':
          case 'merge_start':
          case 'align_start': {
            setRetryPhase(parsed.phase ?? '');
            break;
          }

          case 'schema_ready': {
            setRetrySchemaHeaders(parsed.headers ?? []);
            break;
          }

          case 'group_merged':
          case 'group_aligned': {
            const newRows: PipelineRow[] = (parsed.rows ?? []).map((r: any) => ({
              id: r.id ?? '',
              label: r.label ?? '',
              data: r.data ?? {},
              sourceFiles: r.sourceFiles ?? [],
              isMerged: r.isMerged ?? false,
              fieldConsistency: r.fieldConsistency,
              mergeMethod: r.mergeMethod,
            }));

            setPipelineRows((prev) => {
              const other = prev.filter((r) => r.id !== groupId && !r.id.startsWith(groupId + '-'));
              return [...other, ...newRows];
            });
            break;
          }

          case 'group_error': {
            addResult({
              fileId: groupId,
              fileName: t('review.systemError'),
              success: false,
              error: parsed.message ?? t('review.unknownError'),
            });
            break;
          }

          case 'error': {
            addResult({
              fileId: 'system',
              fileName: t('review.systemError'),
              success: false,
              error: parsed.message ?? t('review.unknownError'),
            });
            break;
          }

          case 'all_done': {
            const newRows: PipelineRow[] = (parsed.rows ?? []).map((r: any) => ({
              id: r.id ?? '',
              label: r.label ?? '',
              data: r.data ?? {},
              sourceFiles: r.sourceFiles ?? [],
              isMerged: r.isMerged ?? false,
              fieldConsistency: r.fieldConsistency,
              mergeMethod: r.mergeMethod,
            }));

            setPipelineRows((prev) => {
              const other = prev.filter((r) => r.id !== groupId && !r.id.startsWith(groupId + '-'));
              const updated = [...other, ...newRows];
              // Sync mergedExportData so export step uses the latest data
              setMergedExportData(
                updated.map((row) => ({
                  label: row.label,
                  data: row.data,
                  sourceFiles: row.sourceFiles,
                  success: true,
                })),
              );
              return updated;
            });
            break;
          }
        }
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') {
        addResult({
          fileId: 'system',
          fileName: t('review.systemError'),
          success: false,
          error: err.message,
        });
      }
    } finally {
      setRetryingGroupId(null);
    }
  }, [t, addResult]);

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GitMerge className="size-5" />
          {isDone
            ? t('review.alignMergeComplete')
            : isAligning
              ? t('review.alignMergeInProgress')
              : t('review.alignMergeReady')}
        </CardTitle>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        {/* Idle / stopped / error — show start button */}
        {!isAligning && !isDone && (
          <div className="flex flex-col gap-3 items-center py-8">
            <p className="text-sm text-muted-foreground">
              {isError ? t('review.error') : isStopped ? t('review.alignMergeStopped') : t('review.alignMergeHint')}
            </p>
            <div className="flex gap-2">
              <Button onClick={() => {
                intentionalAbortRef.current = false;
                handleAlignMerge();
              }}>
                <GitMerge className="size-4" />
                {isError || isStopped ? t('review.retryAlign') : t('review.startAlignMerge')}
              </Button>
              <Button variant="outline" onClick={handleReconfigure}>
                <RotateCcw className="size-4" />
                {t('review.reconfigure')}
              </Button>
            </div>
          </div>
        )}

        {/* Align & Merge in progress */}
        {isAligning && (
          <div className="flex flex-col gap-4">
            <Card>
              <CardContent className="pt-0">
                <PhaseIndicator phases={phases} />
              </CardContent>
            </Card>
            <Button variant="destructive" onClick={handleAbort}>
              <Square className="size-4" />
              {t('review.stop')}
            </Button>
          </div>
        )}

        {/* Schema alignment fallback warning */}
        {schemaAlignFallback && (
          <div className="flex items-center gap-2 text-sm text-amber-600">
            <AlertTriangle className="size-4 shrink-0" />
            <span>{t('pipeline.schemaAlignFallback')}</span>
          </div>
        )}

        {/* Final Results */}
        {(pipelineRows.length > 0 || isDone) && (
          <div className="flex flex-col gap-4">
            <Separator />

            {/* Summary Bar */}
            <div className="flex items-center gap-3 flex-wrap">
              <BarChart3 className="text-muted-foreground size-4" />
              <span className="text-sm">
                {t('review.completeSummary', {
                  groups: phases[0]?.detail || '0',
                  rows: pipelineRows.length,
                  fields: mergedHeaders.length,
                })}
              </span>

              <div className="flex-1" />

              <Button
                variant="outline"
                size="sm"
                onClick={handleReconfigure}
                className="gap-1"
              >
                <RotateCcw className="size-3.5" />
                {t('review.reconfigure')}
              </Button>

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

            {/* Main data table */}
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
                                <span className="truncate max-w-[100px]">
                                  {row.label}
                                </span>
                                {hasTemplateColumns && (
                                  <button
                                    type="button"
                                    className="ml-0.5 p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                                    title={t('review.retryAlign')}
                                    onClick={() => handleRetryGroup(row.id.includes('-') ? row.id.split('-')[0] : row.id)}
                                    disabled={retryingGroupId !== null}
                                  >
                                    <RefreshCw
                                      className={`size-3 ${retryingGroupId === (row.id.includes('-') ? row.id.split('-')[0] : row.id) ? 'animate-spin' : ''}`}
                                    />
                                  </button>
                                )}
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

            {/* No results */}
            {pipelineRows.length === 0 && (
              <p className="text-muted-foreground text-sm text-center py-8">
                {t('review.noResults')}
              </p>
            )}

            {/* Individual result cards */}
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

        {/* Error status */}
        {progress.status === 'error' && !isAligning && (
          <div className="flex items-center gap-2 text-sm text-destructive">
            {t('review.error')}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
