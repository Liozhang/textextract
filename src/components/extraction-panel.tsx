'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Play,
  RotateCcw,
  Square,
  CheckCircle2,
  XCircle,
  ChevronDown,
  FileSearch,
  Loader2,
} from 'lucide-react';
import { useStore } from '@/lib/store';
import { useT } from '@/lib/i18n';
import {
  PipelinePhase,
  parseSSEChunks,
  consumeSSEStream,
} from '@/lib/pipeline-helpers';
import { saveSession, clearSession, loadSession, getInterruptedSessions } from '@/lib/idb-storage';
import type { SessionData } from '@/lib/idb-storage';
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { PhaseIndicator } from '@/lib/pipeline-helpers';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INIT_PHASES: PipelinePhase[] = [
  { key: 'grouping', status: 'pending', detail: '' },
  { key: 'extracting', status: 'pending', detail: '' },
];

const BATCH_SIZE = 5;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ExtractionPanel() {
  const t = useT();
  const files = useStore((s) => s.files);
  const progress = useStore((s) => s.progress);
  const clearResults = useStore((s) => s.clearResults);
  const addResult = useStore((s) => s.addResult);
  const setProgress = useStore((s) => s.setProgress);
  const setMergedExportData = useStore((s) => s.setMergedExportData);
  const promptSettings = useStore((s) => s.promptSettings);
  const extractionSnapshot = useStore((s) => s.extractionSnapshot);
  const setExtractionSnapshot = useStore((s) => s.setExtractionSnapshot);
  const resetTemplate = useStore((s) => s.resetTemplate);
  const updateFile = useStore((s) => s.updateFile);

  const abortRef = useRef<AbortController | null>(null);
  const [hasExtracted, setHasExtracted] = useState(
    progress.status === 'extraction_done' || progress.status === 'done' || progress.status === 'aligning_merging',
  );
  const [phases, setPhases] = useState<PipelinePhase[]>(
    // Pre-populate phases if extraction already done
    (progress.status === 'extraction_done' || progress.status === 'done' || progress.status === 'aligning_merging')
      ? INIT_PHASES.map(p => ({ ...p, status: 'done' as const }))
      : [...INIT_PHASES],
  );

  const isExtracting = progress.status === 'extracting';
  const isExtractionDone = progress.status === 'extraction_done';
  const canStart = files.length > 0;

  // Extracted fields from snapshot
  const extractedFields = useMemo(() => {
    if (!extractionSnapshot) return [];
    const fieldSet = new Set<string>();
    for (const r of extractionSnapshot.results) {
      if (r.success && r.data) {
        for (const key of Object.keys(r.data)) {
          fieldSet.add(key);
        }
      }
    }
    return Array.from(fieldSet);
  }, [extractionSnapshot]);

  const extractionSummary = useMemo(() => {
    if (!extractionSnapshot) return null;
    const results = extractionSnapshot.results;
    return {
      total: results.length,
      succeeded: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
    };
  }, [extractionSnapshot]);

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
  // Phase 1: Extract only (SSE stream to /api/extract, batched)
  // ------------------------------------------------------------------
  const handleExtract = useCallback(async () => {
    if (isExtracting) return;

    clearResults();
    setHasExtracted(false);
    setExtractionSnapshot(null);
    setPhases([...INIT_PHASES]);
    // Clear downstream data when re-extracting
    setMergedExportData([]);
    resetTemplate();

    // Generate session ID for IndexedDB persistence
    const sessionId = crypto.randomUUID();

    const total = files.length;
    setProgress({
      totalFiles: total,
      completedFiles: 0,
      currentFile: '',
      status: 'extracting',
    });

    // Split files into batches of BATCH_SIZE
    const allFileIds = files.map((f) => f.id);
    const batches: Array<{ ids: string[]; files: typeof files }> = [];
    for (let i = 0; i < allFileIds.length; i += BATCH_SIZE) {
      const ids = allFileIds.slice(i, i + BATCH_SIZE);
      const batchFiles = files.filter((f) => ids.includes(f.id));
      batches.push({ ids, files: batchFiles });
    }

    const controller = new AbortController();
    abortRef.current = controller;

    // Accumulated results across batches
    const accumulatedResults: Array<{
      fileId: string;
      fileName: string;
      groupId: string;
      success: boolean;
      data?: Record<string, unknown>;
      error?: string;
    }> = [];
    let accumulatedGroups: Array<{ groupId: string; groupKey: string; fileCount: number }> = [];

    try {
      for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
        // Check abort before each batch
        if (controller.signal.aborted) break;

        const { files: batchFiles } = batches[batchIdx];
        const globalOffset = batchIdx * BATCH_SIZE;
        const isFirstBatch = batchIdx === 0;

        const body = {
          files: batchFiles.map((f) => ({
            id: f.id,
            name: f.name,
            size: f.size,
            type: f.type,
            sessionId: f.sessionId,
          })),
          prompts: {
            extraction: promptSettings.extraction || undefined,
          },
        };

        const response = await fetch('/api/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(t('review.serverError', { code: response.status, text: response.statusText }));
        }

        let batchCompleted = 0;
        const batchTotal = batchFiles.length;
        const prevCompleted = accumulatedResults.length;
        let extractedCount = 0;
        accumulatedResults.forEach((r) => { if (r.success) extractedCount++; });

        await consumeSSEStream(response, (event, parsed) => {
          switch (event) {
            case 'phase': {
              if (isFirstBatch) {
                const phase = parsed.phase as string;
                setPhases((prev) =>
                  prev.map((p) =>
                    p.key === phase
                      ? { ...p, status: 'active', detail: '' }
                      : p,
                  ),
                );
              }
              break;
            }

            case 'grouping_done': {
              if (isFirstBatch) {
                setPhases((prev) =>
                  prev.map((p) =>
                    p.key === 'grouping'
                      ? { ...p, status: 'done', detail: `${parsed.groups?.length ?? 0}` }
                      : p,
                  ),
                );
              }
              if (!accumulatedGroups.length) {
                accumulatedGroups = parsed.groups || [];
              }
              break;
            }

            case 'file_retry': {
              setPhases((prev) =>
                prev.map((p) =>
                  p.key === 'extracting'
                    ? { ...p, detail: `(${prevCompleted + batchCompleted + 1}/${total}) retry ${parsed.attempt}` }
                    : p,
                ),
              );
              break;
            }

            case 'file_start': {
              setPhases((prev) =>
                prev.map((p) =>
                  p.key === 'extracting'
                    ? { ...p, status: 'active', detail: `(${prevCompleted + batchCompleted + 1}/${total})` }
                    : p,
                ),
              );
              setProgress({ currentFile: parsed.fileName ?? '' });
              break;
            }

            case 'file_complete': {
              batchCompleted++;
              if (parsed.success) extractedCount++;
              const globalCompleted = prevCompleted + batchCompleted;
              setProgress({ completedFiles: globalCompleted });
              if (globalCompleted >= total) {
                setPhases((prev) =>
                  prev.map((p) =>
                    p.key === 'extracting'
                      ? { ...p, status: 'done', detail: `(${extractedCount}/${total})` }
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
              // 1.2: Clear file data from store after successful extraction
              if (parsed.success) {
                updateFile(String(parsed.fileId ?? ''), { dataUrl: undefined, content: undefined });
              }
              break;
            }

            case 'extraction_done': {
              const batchResults = parsed.results || [];
              accumulatedResults.push(...batchResults.map((r: any) => ({
                fileId: r.fileId ?? '',
                fileName: r.fileName ?? '',
                groupId: r.groupId ?? '',
                success: r.success ?? false,
                data: r.data,
                error: r.error,
              })));
              if (!accumulatedGroups.length) {
                accumulatedGroups = parsed.groups || [];
              }
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
              return; // stop processing this batch
            }
          }
        });

        // If status was set to error, stop all batches
        if (useStore.getState().progress.status === 'error') break;

        // Persist batch progress to IndexedDB (fire-and-forget)
        saveSession({
          sessionId,
          status: 'extracting',
          results: accumulatedResults,
          groups: accumulatedGroups,
          completedBatches: batchIdx + 1,
          totalBatches: batches.length,
          createdAt: Date.now(),
        }).catch(() => {});
      }

      // All batches complete — build final snapshot
      if (!controller.signal.aborted && useStore.getState().progress.status === 'extracting') {
        setExtractionSnapshot({
          results: accumulatedResults,
          groups: accumulatedGroups,
        });
        setPhases((prev) =>
          prev.map((p) =>
            (p.key === 'grouping' || p.key === 'extracting')
              ? { ...p, status: 'done' }
              : p,
          ),
        );
        // Fallback: if no groups from SSE, build from results
        if (!accumulatedGroups.length && accumulatedResults.length > 0) {
          accumulatedGroups = Array.from(
            new Map(accumulatedResults.map((r) => [r.groupId, { groupId: r.groupId, groupKey: r.fileName.split('.')[0], fileCount: 1 }])).values(),
          );
        }
        setExtractionSnapshot({
          results: accumulatedResults,
          groups: accumulatedGroups,
        });
        setProgress({ status: 'extraction_done' });
        setHasExtracted(true);
        // Clear IndexedDB session on successful completion
        clearSession(sessionId).catch(() => {});
        // Clean up server temp files for all unique sessionIds
        const serverSessionIds = [...new Set(files.map((f) => f.sessionId).filter(Boolean))] as string[];
        serverSessionIds.forEach((sid) => {
          fetch(`/api/upload/${sid}`, { method: 'DELETE' }).catch(() => {});
        });
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        // Preserve extraction_done if we already have results from previous batches
        if (accumulatedResults.length > 0) {
          setExtractionSnapshot({
            results: accumulatedResults,
            groups: accumulatedGroups,
          });
          setProgress({ status: 'extraction_done', currentFile: '' });
        } else {
          setProgress({ status: 'idle', currentFile: '' });
          clearSession(sessionId).catch(() => {});
        }
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
    updateFile,
    setExtractionSnapshot,
    setMergedExportData,
    resetTemplate,
    t,
  ]);

  // ------------------------------------------------------------------
  // Retry failed files only (SSE stream to /api/extract)
  // ------------------------------------------------------------------
  const handleRetryFailed = useCallback(async () => {
    const snapshot = useStore.getState().extractionSnapshot;
    const allFiles = useStore.getState().files;
    if (!snapshot) return;

    const failedResults = snapshot.results.filter((r) => !r.success);
    if (failedResults.length === 0) return;

    const failedFileIds = new Set(failedResults.map((r) => r.fileId));
    const filesToRetry = allFiles.filter((f) => failedFileIds.has(f.id));
    if (filesToRetry.length === 0) return;

    // Reset extract phases to show retry progress
    setPhases((prev) =>
      prev.map((p) =>
        (p.key === 'grouping' || p.key === 'extracting')
          ? { ...p, status: 'pending', detail: '' }
          : p,
      ),
    );
    setProgress({
      totalFiles: filesToRetry.length,
      completedFiles: 0,
      currentFile: '',
      status: 'extracting',
    });

    const body = {
      files: filesToRetry.map((f) => ({
        id: f.id,
        name: f.name,
        size: f.size,
        type: f.type,
        sessionId: f.sessionId,
      })),
      prompts: {
        extraction: useStore.getState().promptSettings.extraction || undefined,
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

      let completedFiles = 0;
      const totalFiles = filesToRetry.length;
      let extractedCount = 0;
      const retryResults: Array<{
        fileId: string;
        fileName: string;
        groupId: string;
        success: boolean;
        data?: Record<string, unknown>;
        error?: string;
      }> = [];

      await consumeSSEStream(response, (event, parsed) => {
        switch (event) {
          case 'phase':
            setPhases((prev) =>
              prev.map((p) =>
                p.key === parsed.phase
                  ? { ...p, status: 'active', detail: '' }
                  : p,
              ),
            );
            break;

          case 'file_retry':
            setPhases((prev) =>
              prev.map((p) =>
                p.key === 'extracting'
                  ? { ...p, detail: `(${completedFiles + 1}/${totalFiles}) retry ${parsed.attempt}` }
                  : p,
              ),
            );
            break;

          case 'file_start':
            setPhases((prev) =>
              prev.map((p) =>
                p.key === 'extracting'
                  ? { ...p, status: 'active', detail: `(${completedFiles + 1}/${totalFiles})` }
                  : p,
              ),
            );
            setProgress({ currentFile: parsed.fileName ?? '' });
            break;

          case 'file_complete':
            completedFiles++;
            extractedCount += parsed.success ? 1 : 0;
            setProgress({ completedFiles });
            if (completedFiles >= totalFiles) {
              setPhases((prev) =>
                prev.map((p) =>
                  p.key === 'extracting' || p.key === 'grouping'
                    ? { ...p, status: 'done', detail: `(${extractedCount}/${totalFiles})` }
                    : p,
                ),
              );
            }
            retryResults.push({
              fileId: String(parsed.fileId ?? ''),
              fileName: parsed.fileName ?? '',
              groupId: parsed.groupId ?? '',
              success: parsed.success ?? false,
              data: parsed.data,
              error: parsed.error,
            });
            break;

          case 'extraction_done': {
            // Merge retry results into existing snapshot
            const existing = useStore.getState().extractionSnapshot;
            if (existing) {
              const mergedResults = existing.results.map((r) => {
                const retryResult = retryResults.find((nr) => nr.fileName === r.fileName);
                if (retryResult) {
                  if (retryResult.success) {
                    return { ...retryResult, groupId: r.groupId };
                  }
                  return { ...r, error: retryResult.error };
                }
                return r;
              });
              setExtractionSnapshot({
                results: mergedResults,
                groups: existing.groups,
              });
            }
            setPhases((prev) =>
              prev.map((p) =>
                (p.key === 'grouping' || p.key === 'extracting')
                  ? { ...p, status: 'done' }
                  : p,
              ),
            );
            setProgress({ status: 'extraction_done' });
            break;
          }

          case 'error':
            setPhases((prev) =>
              prev.map((p) =>
                p.status === 'active' ? { ...p, status: 'pending', detail: '' } : p,
              ),
            );
            setProgress({ status: 'extraction_done' });
            break;
        }
      });

      // Stream ended without extraction_done — merge whatever we got
      if (useStore.getState().progress.status === 'extracting') {
        const existing = useStore.getState().extractionSnapshot;
        if (existing && retryResults.length > 0) {
          const mergedResults = existing.results.map((r) => {
            const retryResult = retryResults.find((nr) => nr.fileName === r.fileName);
            if (retryResult) {
              if (retryResult.success) return { ...retryResult, groupId: r.groupId };
              return { ...r, error: retryResult.error };
            }
            return r;
          });
          setExtractionSnapshot({ results: mergedResults, groups: existing.groups });
        }
        setPhases((prev) =>
          prev.map((p) => (p.status === 'active' ? { ...p, status: 'done' } : p)),
        );
        setProgress({ status: 'extraction_done' });
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        // no-op — handleAbort sets state
      } else {
        setProgress({ status: 'extraction_done', currentFile: '' });
      }
      setPhases((prev) =>
        prev.map((p) =>
          p.status === 'active' ? { ...p, status: 'pending', detail: '' } : p,
        ),
      );
    } finally {
      abortRef.current = null;
    }
  }, [t, setProgress, setExtractionSnapshot]);

  // ------------------------------------------------------------------
  // Abort
  // ------------------------------------------------------------------
  const handleAbort = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    // If retrying failed files, abort should return to extraction_done (preserve results)
    // If fresh extraction, abort should return to idle
    const currentStatus = useStore.getState().progress.status;
    if (currentStatus === 'extracting' && useStore.getState().extractionSnapshot) {
      setProgress({ status: 'extraction_done', currentFile: '' });
    } else {
      setProgress({ status: 'idle', currentFile: '' });
    }
    setPhases((prev) =>
      prev.map((p) => {
        if (p.status === 'active') return { ...p, status: 'pending', detail: '' };
        return p;
      }),
    );
  }, [setProgress]);

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileSearch className="size-5" />
          {t('review.extractStepTitle')}
        </CardTitle>
        <CardDescription>{t('review.extractStepDesc')}</CardDescription>
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
            <Button
              size="lg"
              disabled={!canStart}
              onClick={handleExtract}
            >
              {hasExtracted ? (
                <>
                  <RotateCcw className="size-4" />
                  {t('review.restart')}
                </>
              ) : (
                <>
                  <Play className="size-4" />
                  {t('review.start')}
                </>
              )}
            </Button>
          )}

          {!canStart && !isExtracting && (
            <p className="text-muted-foreground text-sm">
              {t('review.hintNoFiles')}
            </p>
          )}
        </div>

        {/* ---------- Pipeline Phase Indicator ---------- */}
        {(isExtracting || hasExtracted || isExtractionDone) && (
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
        {progress.status === 'error' && !isExtracting && (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <XCircle className="size-4" />
            {t('review.error')}
          </div>
        )}

        {/* ---------- Extraction Done: Results Preview ---------- */}
        {isExtractionDone && extractionSummary && (
          <div className="flex flex-col gap-4">
            <Separator />

            {/* Extraction Complete (collapsible) */}
            <Card>
              <Collapsible defaultOpen>
                <CollapsibleTrigger className="flex w-full items-center gap-2 px-4 py-3 text-sm font-medium hover:bg-muted/50 rounded-t-md">
                  <CheckCircle2 className="text-emerald-600 size-4" />
                  <span className="font-semibold">{t('review.extractionComplete')}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {t('review.extractionSummary', {
                      total: extractionSummary.total,
                      succeeded: extractionSummary.succeeded,
                      failed: extractionSummary.failed,
                    })}
                  </span>
                  {extractionSummary.failed > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="ml-auto h-7 text-xs"
                      disabled={isExtracting}
                      onClick={handleRetryFailed}
                    >
                      <RotateCcw className="size-3 mr-1" />
                      {t('review.retryFailed', { count: extractionSummary.failed })}
                    </Button>
                  )}
                  <ChevronDown className="ml-auto size-4 text-muted-foreground transition-transform" />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="pt-0 flex flex-col gap-4">
                    {/* Extracted fields */}
                    {extractedFields.length > 0 && (
                      <div className="flex flex-col gap-2">
                        <span className="text-sm font-medium text-muted-foreground">
                          {t('review.extractedFields', { count: extractedFields.length })}
                        </span>
                        <div className="flex flex-wrap gap-1">
                          {extractedFields.map((field) => (
                            <Badge key={field} variant="outline" className="text-xs">
                              {field}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Per-file extraction status */}
                    <div className="max-h-[200px] overflow-auto rounded-md border">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-muted/50 text-left text-muted-foreground">
                            <th className="px-3 py-1.5 w-8" />
                            <th className="px-3 py-1.5">{t('review.fileName')}</th>
                            <th className="px-3 py-1.5 w-20 text-right">{t('review.fieldsCount', { count: 'N' }).replace(/\d+/, '')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {extractionSnapshot?.results.map((r) => (
                            <tr key={r.fileId} className="border-b last:border-0">
                              <td className="px-3 py-1">
                                {r.success ? (
                                  <CheckCircle2 className="size-3.5 text-emerald-600" />
                                ) : (
                                  <XCircle className="size-3.5 text-destructive" />
                                )}
                              </td>
                              <td className="px-3 py-1">{r.fileName}</td>
                              <td className="px-3 py-1 text-right text-muted-foreground">
                                {r.success && r.data ? Object.keys(r.data).length : '\u2014'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Collapsible>
            </Card>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
