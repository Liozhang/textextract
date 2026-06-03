'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Play,
  RotateCcw,
  Square,
  CheckCircle2,
  XCircle,
  ChevronDown,
  FileSearch,
  Loader2,
  Eye,
  X,
} from 'lucide-react';
import { useStore } from '@/lib/store';
import { useT } from '@/lib/i18n';
import { useExtractionSummary } from '@/lib/hooks/use-extraction-summary';
import {
  PipelinePhase,
  parseSSEChunks,
  consumeSSEStream,
} from '@/lib/pipeline-helpers';
import { saveSession, clearSession } from '@/lib/idb-storage';
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

function getBatchSize(fileCount: number): number {
  if (fileCount <= 20) return 5;
  if (fileCount <= 100) return 5;
  if (fileCount <= 200) return 8;
  return 10;
}

/** Format milliseconds into human-readable ETA string */
function formatETA(ms: number, t: (key: string, params?: Record<string, number>) => string): string {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return t('review.etaSeconds', { count: Math.ceil(ms / 1000) });
  if (minutes < 60) return t('review.etaMinutes', { count: minutes });
  const hours = Math.floor(minutes / 60);
  const remMin = minutes % 60;
  return t('review.etaHours', { count: hours, minutes: remMin });
}

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
  const apiSettings = useStore((s) => s.apiSettings);
  const extractionSnapshot = useStore((s) => s.extractionSnapshot);
  const setExtractionSnapshot = useStore((s) => s.setExtractionSnapshot);
  const updateFile = useStore((s) => s.updateFile);

  const abortRef = useRef<AbortController | null>(null);
  // Ref to track latest extraction state for beforeunload persistence
  const sessionStateRef = useRef<{ sessionId: string; results: SessionData['results']; groups: SessionData['groups']; total: number } | null>(null);
  const [selectedResults, setSelectedResults] = useState<Set<string>>(new Set());
  const [eta, setEta] = useState<string | null>(null);
  const [batchTimings, setBatchTimings] = useState<number[]>([]);
  const [currentBatch, setCurrentBatch] = useState(0);
  const [totalBatches, setTotalBatches] = useState(0);
  const [previewResult, setPreviewResult] = useState<{ fileId: string; fileName: string; data: Record<string, unknown>; entries?: Record<string, unknown>[]; imageDataUrl?: string } | null>(null);
  // Close preview on Escape key
  useEffect(() => {
    if (!previewResult) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreviewResult(null);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [previewResult]);

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
  const { extractedFields, extractionSummary } = useExtractionSummary();

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
  // Extract only (SSE stream to /api/extract, batched)
  // Supports resume from interrupted session
  // ------------------------------------------------------------------
  const handleExtract = useCallback(async () => {
    if (isExtracting) return;

    const snapshot = useStore.getState().extractionSnapshot;
    const isResume = !!snapshot && snapshot.results.length > 0;

    if (!isResume) {
      clearResults();
      setHasExtracted(false);
      setExtractionSnapshot(null);
      setPhases([...INIT_PHASES]);
      setMergedExportData([]);
    }

    // Generate session ID for IndexedDB persistence
    const sessionId = isResume ? crypto.randomUUID() : crypto.randomUUID();

    // Clean up any previous server temp files before starting new (non-resume) extraction
    if (!isResume) {
      const prevSessionIds = [...new Set(files.map((f) => f.sessionId).filter(Boolean))] as string[];
      prevSessionIds.forEach((sid) => {
        fetch(`/api/upload/${sid}`, { method: 'DELETE' }).catch(() => {});
      });
    }

    // Determine which files still need extraction
    const existingResults = isResume ? snapshot!.results : [];
    const completedFileIds = new Set(existingResults.filter((r) => r.success).map((r) => r.fileId));
    const filesToExtract = isResume
      ? files.filter((f) => !completedFileIds.has(f.id))
      : files;

    if (filesToExtract.length === 0) {
      // All files already extracted
      setProgress({ status: 'extraction_done' });
      setHasExtracted(true);
      return;
    }

    const total = files.length;
    const alreadyCompleted = existingResults.length;
    setProgress({
      totalFiles: total,
      completedFiles: alreadyCompleted,
      currentFile: '',
      status: 'extracting',
    });

    // Initialize sessionStateRef for crash recovery persistence
    sessionStateRef.current = {
      sessionId,
      results: [...existingResults],
      groups: isResume && snapshot!.groups.length > 0 ? [...snapshot!.groups] : [],
      total,
    };

    // Dynamic batch size based on total file count
    const batchSize = getBatchSize(filesToExtract.length);

    // Split files to extract into batches
    const batches: Array<{ ids: string[]; files: typeof files }> = [];
    for (let i = 0; i < filesToExtract.length; i += batchSize) {
      const ids = filesToExtract.slice(i, i + batchSize).map((f) => f.id);
      const batchFiles = files.filter((f) => ids.includes(f.id));
      batches.push({ ids, files: batchFiles });
    }

    const controller = new AbortController();
    abortRef.current = controller;

    // Accumulated results (start with existing if resuming)
    const accumulatedResults: Array<{
      fileId: string;
      fileName: string;
      groupId: string;
      success: boolean;
      data?: Record<string, unknown>;
      entries?: Array<Record<string, unknown>>;
      error?: string;
      imageDataUrl?: string;
    }> = isResume ? [...existingResults] : [];
    let accumulatedGroups: Array<{ groupId: string; groupKey: string; fileCount: number }> =
      isResume && snapshot!.groups.length > 0 ? [...snapshot!.groups] : [];

    setTotalBatches(batches.length);
    setBatchTimings([]);
    setEta(null);

    // Collect all unique server session IDs for cleanup tracking
    const allSessionIds = [...new Set(files.map((f) => f.sessionId).filter(Boolean))] as string[];

    // Helper: synchronously persist current progress to localStorage for crash recovery
    const persistToLocalStorage = () => {
      try {
        const state = sessionStateRef.current;
        if (!state || state.results.length === 0) return;
        const storeFiles = useStore.getState().files;
        const storeColumns = useStore.getState().templateColumns;
        const sIds = [...new Set(storeFiles.map((f) => f.sessionId).filter(Boolean))] as string[];
        const payload: SessionData = {
          sessionId: state.sessionId,
          status: 'extracting',
          results: state.results,
          groups: state.groups,
          completedBatches: state.results.filter((r) => r.success).length,
          totalBatches: state.total,
          createdAt: Date.now(),
          files: storeFiles.map((f) => ({
            id: f.id, name: f.name, size: f.size, type: f.type,
            sessionId: f.sessionId ?? '', status: f.status,
          })),
          sessionIds: sIds,
          templateColumns: storeColumns.length > 0 ? storeColumns : null,
          extractionSnapshot: {
            results: state.results.map(r => {
              const { imageDataUrl, ...rest } = r as any;
              return rest;
            }),
            groups: state.groups,
          },
          batchTimings: [],
        };
        localStorage.setItem('ocr-extract-interrupted', JSON.stringify(payload));
      } catch { /* ignore */ }
    };

    try {
      for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
        if (controller.signal.aborted) break;

        setCurrentBatch(batchIdx + 1);
        const batchStartTime = Date.now();

        const { files: batchFiles } = batches[batchIdx];
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
          ...(apiSettings.baseUrl || apiSettings.apiKey || apiSettings.model ? {
            apiSettings: {
              baseUrl: apiSettings.baseUrl || undefined,
              apiKey: apiSettings.apiKey || undefined,
              model: apiSettings.model || undefined,
              concurrency: apiSettings.concurrency || undefined,
            },
          } : {}),
          ...(useStore.getState().templateColumns.length > 0
            ? { templateColumns: useStore.getState().templateColumns }
            : {}),
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
        const prevCompleted = accumulatedResults.length;
        let extractedCount = accumulatedResults.filter((r) => r.success).length;

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
                accumulatedGroups = (parsed.groups || []).map((g: any) => ({
                  groupId: g.groupId ?? g.label ?? '',
                  groupKey: g.groupKey ?? g.label ?? '',
                  fileCount: g.fileCount ?? 1,
                }));
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
              if (parsed.success) {
                updateFile(String(parsed.fileId ?? ''), { dataUrl: undefined, content: undefined });
              }
              // Update ref for beforeunload persistence
              if (sessionStateRef.current) {
                sessionStateRef.current.results.push({
                  fileId: String(parsed.fileId ?? ''),
                  fileName: parsed.fileName ?? '',
                  groupId: '',
                  success: parsed.success ?? false,
                  data: parsed.data,
                  error: parsed.error,
                });
              }
              persistToLocalStorage();
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
                entries: r.entries,
                error: r.error,
                imageDataUrl: r.imageDataUrl,
              })));
              if (!accumulatedGroups.length) {
                accumulatedGroups = (parsed.groups || []).map((g: any) => ({
                  groupId: g.groupId ?? g.label ?? '',
                  groupKey: g.groupKey ?? g.label ?? '',
                  fileCount: g.fileCount ?? 1,
                }));
              }
              // Update ref with latest accumulated results + groups
              if (sessionStateRef.current) {
                sessionStateRef.current.results = [...accumulatedResults];
                sessionStateRef.current.groups = [...accumulatedGroups];
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
              return;
            }
          }
        });

        if (useStore.getState().progress.status === 'error') break;

        // Track batch timing for ETA
        const batchDuration = Date.now() - batchStartTime;
        setBatchTimings((prev) => {
          const next = [...prev, batchDuration];
          const avg = next.reduce((a, b) => a + b, 0) / next.length;
          const remaining = batches.length - batchIdx - 1;
          if (remaining > 0) {
            setEta(formatETA(avg * remaining, t));
          } else {
            setEta(null);
          }
          return next;
        });

        // Persist batch progress to IndexedDB (fire-and-forget)
        saveSession({
          sessionId,
          status: 'extracting',
          results: accumulatedResults,
          groups: accumulatedGroups,
          completedBatches: isResume ? snapshot!.results.filter((r) => r.success).length + batchIdx + 1 : batchIdx + 1,
          totalBatches: batches.length,
          createdAt: Date.now(),
          files: useStore.getState().files.map((f) => ({
            id: f.id,
            name: f.name,
            size: f.size,
            type: f.type,
            sessionId: f.sessionId ?? '',
            status: f.status,
          })),
          sessionIds: allSessionIds,
          templateColumns: useStore.getState().templateColumns.length > 0
            ? useStore.getState().templateColumns
            : null,
          extractionSnapshot: { results: accumulatedResults, groups: accumulatedGroups },
          batchTimings: [],
        }).catch(() => {});
        // Also persist to localStorage as a fallback (survives page unload)
        persistToLocalStorage();
      }

      // All batches complete — build final snapshot
      if (!controller.signal.aborted && useStore.getState().progress.status === 'extracting') {
        if (!accumulatedGroups.length && accumulatedResults.length > 0) {
          accumulatedGroups = Array.from(
            new Map(accumulatedResults.map((r) => [r.groupId, { groupId: r.groupId, groupKey: r.fileName.split('.')[0], fileCount: 1 }])).values(),
          );
        }
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
        setProgress({ status: 'extraction_done' });
        setHasExtracted(true);
        setEta(null);
        sessionStateRef.current = null; // Clear ref — no need to persist anymore
        localStorage.removeItem('ocr-extract-interrupted');
        clearSession(sessionId).catch(() => {});
        // Clean up server temp files on successful completion
        allSessionIds.forEach((sid) => {
          fetch(`/api/upload/${sid}`, { method: 'DELETE' }).catch(() => {});
        });
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        if (accumulatedResults.length > 0) {
          setExtractionSnapshot({
            results: accumulatedResults,
            groups: accumulatedGroups,
          });
          setProgress({ status: 'extraction_done', currentFile: '' });
          // Persist interrupted session to IndexedDB for resume
          saveSession({
            sessionId,
            status: 'extracting',
            results: accumulatedResults,
            groups: accumulatedGroups,
            completedBatches: accumulatedResults.filter((r) => r.success).length,
            totalBatches: total,
            createdAt: Date.now(),
            files: useStore.getState().files.map((f) => ({
              id: f.id,
              name: f.name,
              size: f.size,
              type: f.type,
              sessionId: f.sessionId ?? '',
              status: f.status,
            })),
            sessionIds: allSessionIds,
            templateColumns: useStore.getState().templateColumns.length > 0
              ? useStore.getState().templateColumns
              : null,
            extractionSnapshot: { results: accumulatedResults, groups: accumulatedGroups },
            batchTimings: [],
          }).catch(() => {});
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
      setEta(null);
      setCurrentBatch(0);
      setTotalBatches(0);
      setBatchTimings([]);
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
    t,
  ]);

  // ------------------------------------------------------------------
  // Retry selected files (SSE stream to /api/extract)
  // ------------------------------------------------------------------
  const handleRetrySelected = useCallback(async (fileIdsToRetry: string[]) => {
    const snapshot = useStore.getState().extractionSnapshot;
    const allFiles = useStore.getState().files;
    if (!snapshot) return;

    const filesToRetry = allFiles.filter((f) => fileIdsToRetry.includes(f.id));
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
      ...(useStore.getState().apiSettings.baseUrl || useStore.getState().apiSettings.apiKey || useStore.getState().apiSettings.model ? {
        apiSettings: useStore.getState().apiSettings,
      } : {}),
      ...(useStore.getState().templateColumns.length > 0
        ? { templateColumns: useStore.getState().templateColumns }
        : {}),
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
        imageDataUrl?: string;
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
              imageDataUrl: parsed.imageDataUrl,
            });
            break;

          case 'extraction_done': {
            // Merge retry results into existing snapshot (match by fileId)
            const existing = useStore.getState().extractionSnapshot;
            if (existing) {
              const mergedResults = existing.results.map((r) => {
                const retryResult = retryResults.find((nr) => nr.fileId === r.fileId);
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
            setSelectedResults(new Set());
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
            const retryResult = retryResults.find((nr) => nr.fileId === r.fileId);
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
        setSelectedResults(new Set());
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

  // Convenience: retry all failed files
  const handleRetryFailed = useCallback(() => {
    const snapshot = useStore.getState().extractionSnapshot;
    if (!snapshot) return;
    const failedIds = snapshot.results.filter((r) => !r.success).map((r) => r.fileId);
    handleRetrySelected(failedIds);
  }, [handleRetrySelected]);

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
          <div className="flex flex-col gap-1.5">
            {/* Progress bar */}
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: `${progress.totalFiles > 0 ? (progress.completedFiles / progress.totalFiles) * 100 : 0}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span className="truncate">
                {progress.currentFile || t('review.preparing')}
              </span>
              <span className="font-medium tabular-nums">
                {progress.completedFiles} / {progress.totalFiles}
                {totalBatches > 1 && (
                  <span className="text-xs ml-2">
                    {t('review.batchProgress', { current: currentBatch, total: totalBatches })}
                  </span>
                )}
              </span>
            </div>
            {eta && (
              <p className="text-xs text-muted-foreground/70">
                {t('review.eta', { time: eta })}
              </p>
            )}
          </div>
        )}

        {/* ---------- Status ---------- */}
        {progress.status === 'error' && !isExtracting && (
          <div className="flex items-center gap-3 text-sm text-destructive">
            <XCircle className="size-4 shrink-0" />
            {t('review.error')}
            <Button variant="outline" size="sm" onClick={handleExtract} disabled={!canStart}>
              <RotateCcw className="size-3 mr-1" />
              {t('review.restart')}
            </Button>
          </div>
        )}

        {/* ---------- Extraction Done: Results ---------- */}
        {isExtractionDone && extractionSummary && (
          <div className="flex flex-col gap-4">
            <Separator />

            {/* Summary + Action bar */}
            <div className="flex flex-wrap items-center gap-3">
              <CheckCircle2 className="text-emerald-600 size-4" />
              <span className="text-sm font-medium">
                {t('review.extractionComplete')}
              </span>
              <span className="text-xs text-muted-foreground">
                {t('review.extractionSummary', {
                  total: extractionSummary.total,
                  succeeded: extractionSummary.succeeded,
                  failed: extractionSummary.failed,
                })}
              </span>
              <span className="text-xs text-muted-foreground/60 border-l pl-2 ml-1">
                {t('review.multiValueNote')}
              </span>
              <div className="flex-1" />
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => {
                  if (selectedResults.size === extractionSnapshot!.results.length) {
                    setSelectedResults(new Set());
                  } else {
                    setSelectedResults(new Set(extractionSnapshot!.results.map((r) => r.fileId)));
                  }
                }}
              >
                {selectedResults.size === extractionSnapshot?.results.length
                  ? t('review.deselectAll')
                  : t('review.selectAll')}
              </Button>
              {selectedResults.size > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={isExtracting}
                  onClick={() => handleRetrySelected(Array.from(selectedResults))}
                >
                  <RotateCcw className="size-3 mr-1" />
                  {t('review.retrySelected', { count: selectedResults.size })}
                </Button>
              )}
              {extractionSummary.failed > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={isExtracting}
                  onClick={handleRetryFailed}
                >
                  <RotateCcw className="size-3 mr-1" />
                  {t('review.retryFailed', { count: extractionSummary.failed })}
                </Button>
              )}
            </div>

            {/* Per-file extraction results (always visible) */}
            <div className="max-h-[400px] overflow-auto rounded-md border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-left text-muted-foreground">
                    <th className="px-2 py-1.5 w-8" />
                    <th className="px-2 py-1.5 w-6" />
                    <th className="px-3 py-1.5">{t('review.fileName')}</th>
                    <th className="px-3 py-1.5 w-20 text-right">{t('review.fieldsCount', { count: '' })}</th>
                    <th className="px-2 py-1.5 w-8" />
                  </tr>
                </thead>
                <tbody>
                  {extractionSnapshot?.results.map((r) => (
                    <tr
                      key={r.fileId}
                      className={`border-b last:border-0 transition-colors ${selectedResults.has(r.fileId) ? 'bg-primary/5' : 'hover:bg-muted/30'}`}
                    >
                      <td className="px-2 py-1.5">
                        <input
                          type="checkbox"
                          checked={selectedResults.has(r.fileId)}
                          onChange={() => {
                            setSelectedResults((prev) => {
                              const next = new Set(prev);
                              if (next.has(r.fileId)) next.delete(r.fileId);
                              else next.add(r.fileId);
                              return next;
                            });
                          }}
                          className="size-3.5 rounded"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        {r.success ? (
                          <CheckCircle2 className="size-3.5 text-emerald-600" />
                        ) : (
                          <XCircle className="size-3.5 text-destructive" />
                        )}
                      </td>
                      <td className="px-3 py-1.5">
                        <span className="truncate max-w-[240px] block">{r.fileName}</span>
                        {r.error && (
                          <span className="text-[10px] text-destructive block truncate max-w-[240px]">{r.error}</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                        {r.success && r.data ? Object.keys(r.data).length : r.success && r.entries ? r.entries.length : '\u2014'}
                      </td>
                      <td className="px-2 py-1.5">
                        {(r.success && (r.data || r.entries)) || r.imageDataUrl ? (
                          <button
                            onClick={() => setPreviewResult({
                              fileId: r.fileId,
                              fileName: r.fileName,
                              data: r.data ?? {},
                              entries: Array.isArray(r.entries) ? r.entries as Record<string, unknown>[] : undefined,
                              imageDataUrl: r.imageDataUrl,
                            })}
                            className="text-muted-foreground hover:text-primary transition-colors"
                            title={t('review.preview')}
                          >
                            <Eye className="size-3.5" />
                          </button>
                        ) : (
                          <span className="text-muted-foreground/30">&mdash;</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Result Preview Dialog */}
            {previewResult && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setPreviewResult(null)} role="dialog" aria-modal="true" aria-label={previewResult.fileName}>
                <Card className="max-w-2xl w-full mx-4 max-h-[85vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-base">{previewResult.fileName}</CardTitle>
                    <button onClick={() => setPreviewResult(null)} className="text-muted-foreground hover:text-foreground rounded-md p-1 hover:bg-muted transition-colors">
                      <X className="size-4" />
                    </button>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-4">
                    {/* Image preview (if available) */}
                    {previewResult.imageDataUrl && (
                      <div className="rounded-md border overflow-hidden">
                        {/* eslint-disable-next-line @next/next/image */}
                        <img
                          src={previewResult.imageDataUrl}
                          alt={previewResult.fileName}
                          className="max-h-[300px] w-auto mx-auto object-contain"
                        />
                      </div>
                    )}
                    {/* Extracted JSON / Entries */}
                    {previewResult.entries && previewResult.entries.length > 0 ? (
                      <div className="space-y-2">
                        <span className="text-xs font-medium text-muted-foreground">
                          {t('review.entriesCount', { count: previewResult.entries.length })}
                        </span>
                        <div className="max-h-[300px] overflow-auto rounded-md border">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b bg-muted/50 text-left text-muted-foreground">
                                <th className="px-2 py-1.5 w-8">#</th>
                                {Object.keys(previewResult.entries[0]).map((col) => (
                                  <th key={col} className="px-2 py-1.5">{col}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {previewResult.entries.map((row, idx) => (
                                <tr key={idx} className="border-b border-muted/30 last:border-0">
                                  <td className="px-2 py-1 text-muted-foreground tabular-nums">{idx + 1}</td>
                                  {Object.values(row).map((val, ci) => (
                                    <td key={ci} className="px-2 py-1 break-all">
                                      {typeof val === 'string' ? val : JSON.stringify(val)}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <span className="text-xs font-medium text-muted-foreground">
                          {t('review.fieldsCount', { count: Object.keys(previewResult.data).length })}
                        </span>
                        <div className="max-h-[300px] overflow-auto rounded-md border p-2">
                          {Object.entries(previewResult.data).map(([key, value]) => (
                            <div key={key} className="flex gap-2 text-sm py-0.5 border-b border-muted/30 last:border-0">
                              <span className="font-medium text-muted-foreground shrink-0 min-w-[120px]">{key}</span>
                              <span className="break-all">
                                {typeof value === 'string' ? value : JSON.stringify(value)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
