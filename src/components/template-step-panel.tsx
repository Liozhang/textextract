'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  RotateCcw,
  Square,
  CheckCircle2,
  XCircle,
  BarChart3,
  GitMerge,
  List,
  Loader2,
  LayoutTemplate,
  AlertTriangle,
  Sparkles,
  ArrowRight,
} from 'lucide-react';
import { useStore } from '@/lib/store';
import { useT } from '@/lib/i18n';
import TemplatePanel from '@/components/template-panel';
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

export default function TemplateStepPanel() {
  const t = useT();
  const progress = useStore((s) => s.progress);
  const extractionSnapshot = useStore((s) => s.extractionSnapshot);
  const keyAlignmentResult = useStore((s) => s.keyAlignmentResult);
  const addResult = useStore((s) => s.addResult);
  const setProgress = useStore((s) => s.setProgress);
  const setMergedExportData = useStore((s) => s.setMergedExportData);
  const resetTemplate = useStore((s) => s.resetTemplate);

  const abortRef = useRef<AbortController | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  // Pipeline result state
  const [pipelineRows, setPipelineRows] = useState<PipelineRow[]>([]);
  const [schemaHeaders, setSchemaHeaders] = useState<string[]>([]);
  const [schemaAlignFallback, setSchemaAlignFallback] = useState(false);
  const [phases, setPhases] = useState<PipelinePhase[]>(
    progress.status === 'done' ? [...ALL_DONE_PHASES] : [...INIT_PHASES],
  );

  const isAligning = progress.status === 'aligning_merging';
  const isExtractionDone = progress.status === 'extraction_done';
  const isDone = progress.status === 'done';

  const mergedHeaders = useMemo(() => {
    if (schemaHeaders.length > 0) return schemaHeaders;
    const headerSet = new Set<string>();
    for (const row of pipelineRows) {
      Object.keys(row.data).forEach((k) => headerSet.add(k));
    }
    return Array.from(headerSet);
  }, [pipelineRows, schemaHeaders]);

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
  // Reconfigure: reset to extraction_done so user can re-do template
  // ------------------------------------------------------------------
  const handleReconfigure = useCallback(() => {
    resetTemplate();
    setPipelineRows([]);
    setSchemaHeaders([]);
    setSchemaAlignFallback(false);
    setPhases([...INIT_PHASES]);
    setProgress({ status: 'extraction_done' });
  }, [resetTemplate, setProgress]);

  // ------------------------------------------------------------------
  // Phase 2-3: Align + Merge (SSE stream to /api/align-merge)
  // ------------------------------------------------------------------
  const handleAlignMerge = useCallback(async () => {
    const snapshot = useStore.getState().extractionSnapshot;
    if (!snapshot) return;

    setPipelineRows([]);
    setSchemaHeaders([]);
    setSchemaAlignFallback(false);
    setPhases([...INIT_PHASES]);

    setProgress({ status: 'aligning_merging' });

    const currentColumns = useStore.getState().templateColumns;
    const currentPromptSettings = useStore.getState().promptSettings;

    const body = {
      extractionData: snapshot.results.map((r) => ({
        fileId: r.fileId,
        fileName: r.fileName,
        groupId: r.groupId,
        success: r.success,
        data: r.data,
        error: r.error,
      })),
      groups: snapshot.groups.map((g) => ({ groupId: g.groupId, groupKey: g.groupKey })),
      ...(currentColumns.length > 0 ? { columns: currentColumns } : {}),
      prompts: {
        merge: currentPromptSettings.merge || undefined,
      },
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

      // Stream ended without explicit all_done
      if (useStore.getState().progress.status === 'aligning_merging') {
        setPhases((prev) => prev.map((p) => ({ ...p, status: 'done' })));
        setProgress({ status: 'done' });
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        // no-op — handleAbort sets state
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

  // ------------------------------------------------------------------
  // Abort
  // ------------------------------------------------------------------
  const handleAbort = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    // Return to extraction_done so user can retry with different template
    setProgress({ status: 'extraction_done', currentFile: '' });
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
          <LayoutTemplate className="size-5" />
          {t('review.templateStepTitle')}
        </CardTitle>
        <CardDescription>{t('review.templateStepDesc')}</CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        {/* ---------- No extraction data yet ---------- */}
        {!isExtractionDone && !isDone && !isAligning && (
          <p className="text-muted-foreground text-sm">
            {t('review.hintNoFiles')}
          </p>
        )}

        {/* ---------- Extraction context (collapsible, default closed) ---------- */}
        {(isExtractionDone || isDone || isAligning) && extractionSummary && (
          <Card>
            <Collapsible>
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
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="pt-0 flex flex-col gap-4">
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
                </CardContent>
              </CollapsibleContent>
            </Collapsible>
          </Card>
        )}

        {/* ---------- Template Configuration (when extraction done, not yet aligned) ---------- */}
        {isExtractionDone && !isAligning && !isDone && (
          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Sparkles className="size-4" />
                  {t('review.configureTemplateTitle')}
                </CardTitle>
                <CardDescription>{t('review.configureTemplateDesc')}</CardDescription>
              </CardHeader>
              <CardContent>
                <TemplatePanel
                  embedded
                  extractionData={extractionSnapshot?.results}
                  prefilledKeys={keyAlignmentResult?.fieldOrder}
                  onConfirm={() => handleAlignMerge()}
                  onSkip={() => {
                    resetTemplate();
                    handleAlignMerge();
                  }}
                />
              </CardContent>
            </Card>
          </div>
        )}

        {/* ---------- Align & Merge in progress ---------- */}
        {isAligning && (
          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Loader2 className="size-4 animate-spin text-primary" />
                  {t('review.alignMergeInProgress')}
                </CardTitle>
              </CardHeader>
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

        {/* ---------- Schema alignment fallback warning ---------- */}
        {schemaAlignFallback && (
          <div className="flex items-center gap-2 text-sm text-amber-600">
            <AlertTriangle className="size-4 shrink-0" />
            <span>{t('pipeline.schemaAlignFallback')}</span>
          </div>
        )}

        {/* ---------- Final Results (after align-merge) ---------- */}
        {(pipelineRows.length > 0 || isDone) && (
          <div className="flex flex-col gap-4">
            <Separator />

            {/* ---- Summary Bar ---- */}
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
            {pipelineRows.length === 0 && (
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

        {/* ---------- Error status ---------- */}
        {progress.status === 'error' && !isAligning && !isExtractionDone && (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <XCircle className="size-4" />
            {t('review.error')}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
