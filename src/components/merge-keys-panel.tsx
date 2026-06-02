'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  GitMerge,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  SkipForward,
  ArrowRight,
  RotateCcw,
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
import { Textarea } from '@/components/ui/textarea';
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
import { parseSSEChunks } from '@/lib/pipeline-helpers';

// ---------------------------------------------------------------------------
// Phase type for this panel
// ---------------------------------------------------------------------------

interface AlignPhase {
  key: string;
  status: 'pending' | 'active' | 'done';
}

const INIT_PHASES: AlignPhase[] = [
  { key: 'collecting', status: 'active' },
  { key: 'aligning', status: 'pending' },
  { key: 'applying', status: 'pending' },
];

const ALL_DONE_PHASES: AlignPhase[] = [
  { key: 'collecting', status: 'done' },
  { key: 'aligning', status: 'done' },
  { key: 'applying', status: 'done' },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function MergeKeysPanel() {
  const t = useT();
  const progress = useStore((s) => s.progress);
  const extractionSnapshot = useStore((s) => s.extractionSnapshot);
  const keyAlignmentResult = useStore((s) => s.keyAlignmentResult);
  const setKeyAlignmentResult = useStore((s) => s.setKeyAlignmentResult);
  const setExtractionSnapshot = useStore((s) => s.setExtractionSnapshot);
  const setProgress = useStore((s) => s.setProgress);
  const setStep = useStore((s) => s.setStep);
  const clearKeyAlignmentResult = useStore((s) => s.clearKeyAlignmentResult);

  const abortRef = useRef<AbortController | null>(null);

  const [phases, setPhases] = useState<AlignPhase[]>([...INIT_PHASES]);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [referenceText, setReferenceText] = useState('');
  const [error, setError] = useState('');

  const isAligning = progress.status === 'keys_aligning';
  const isAligned = progress.status === 'keys_aligned' && keyAlignmentResult !== null;

  // Compute unique keys from extraction snapshot
  const uniqueKeys = useMemo(() => {
    if (!extractionSnapshot) return [];
    const keyCount = new Map<string, number>();
    for (const r of extractionSnapshot.results) {
      if (r.success && r.data) {
        for (const key of Object.keys(r.data)) {
          keyCount.set(key, (keyCount.get(key) || 0) + 1);
        }
      }
    }
    return Array.from(keyCount.entries())
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
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

  // Toggle key selection
  const toggleKey = useCallback((key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Handle auto-merge
  const handleAutoMerge = useCallback(async () => {
    const snapshot = useStore.getState().extractionSnapshot;
    if (!snapshot) return;

    setProgress({ status: 'keys_aligning' });
    clearKeyAlignmentResult();
    setError('');
    setPhases([...INIT_PHASES]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // Collect reference keys: selected keys + parsed reference text
      const refKeys: string[] = [...selectedKeys];
      if (referenceText.trim()) {
        const lines = referenceText.trim().split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
        refKeys.push(...lines);
      }

      const body = {
        extractionData: snapshot.results.map((r) => ({
          fileId: r.fileId,
          fileName: r.fileName,
          groupId: r.groupId,
          success: r.success,
          data: r.data,
          error: r.error,
        })),
        ...(refKeys.length > 0 ? { referenceKeys: refKeys } : {}),
        ...(referenceText.trim() ? { referenceText: referenceText.trim() } : {}),
        prompts: {
          keyAlign: useStore.getState().promptSettings.keyAlign || undefined,
        },
      };

      const response = await fetch('/api/align-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `Server error ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('Unable to read response stream');

      const decoder = new TextDecoder();
      let buffer = '';

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
                setPhases((prev) =>
                  prev.map((p) =>
                    p.key === parsed.phase
                      ? { ...p, status: 'active' }
                      : p,
                  ),
                );
                break;
              }

              case 'keys_ready': {
                setKeyAlignmentResult({
                  fieldMapping: parsed.fieldMapping ?? {},
                  fieldOrder: parsed.fieldOrder ?? [],
                  aiFailed: false,
                });
                // Mark aligning as done
                setPhases((prev) =>
                  prev.map((p) =>
                    p.key === 'aligning'
                      ? { ...p, status: 'done' }
                      : p,
                  ),
                );
                break;
              }

              case 'all_done': {
                setPhases([...ALL_DONE_PHASES]);
                // Replace extraction snapshot with aligned results
                setExtractionSnapshot({
                  results: (parsed.alignedResults ?? []).map((r: any) => ({
                    fileId: r.fileId,
                    fileName: r.fileName,
                    groupId: r.groupId,
                    success: r.success,
                    data: r.data,
                    error: r.error,
                  })),
                  groups: snapshot.groups,
                });
                setProgress({ status: 'keys_aligned' });
                break;
              }

              case 'error': {
                setError(parsed.message ?? 'Unknown error');
                setProgress({ status: 'extraction_done' });
                setPhases((prev) =>
                  prev.map((p) => {
                    if (p.status === 'active') return { ...p, status: 'pending' };
                    return p;
                  }),
                );
                break;
              }
            }
          } catch {
            // ignore JSON parse errors
          }
        }
      }

      // Stream ended without explicit all_done
      if (useStore.getState().progress.status === 'keys_aligning') {
        setPhases([...ALL_DONE_PHASES]);
        setProgress({ status: 'extraction_done' });
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        setProgress({ status: 'extraction_done' });
      } else {
        setError(err instanceof Error ? err.message : t('mergeKeys.aiFailed'));
        setProgress({ status: 'extraction_done' });
      }
      setPhases((prev) =>
        prev.map((p) => {
          if (p.status === 'active') return { ...p, status: 'pending' };
          return p;
        }),
      );
    } finally {
      abortRef.current = null;
    }
  }, [selectedKeys, referenceText, setProgress, setExtractionSnapshot, setKeyAlignmentResult, clearKeyAlignmentResult, t]);

  // Handle skip
  const handleSkip = useCallback(() => {
    clearKeyAlignmentResult();
    setStep('template');
  }, [clearKeyAlignmentResult, setStep]);

  // Handle proceed
  const handleProceed = useCallback(() => {
    setStep('template');
  }, [setStep]);

  // Handle abort
  const handleAbort = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setProgress({ status: 'extraction_done' });
    setPhases((prev) =>
      prev.map((p) => {
        if (p.status === 'active') return { ...p, status: 'pending' };
        return p;
      }),
    );
  }, [setProgress]);

  // Build mapping entries (group by canonical name, only show changes)
  const mappingEntries = useMemo(() => {
    if (!keyAlignmentResult) return [];
    const mapping = keyAlignmentResult.fieldMapping;
    const grouped = new Map<string, string[]>();
    for (const [original, canonical] of Object.entries(mapping)) {
      if (original !== canonical) {
        const existing = grouped.get(canonical) || [];
        existing.push(original);
        grouped.set(canonical, existing);
      }
    }
    return Array.from(grouped.entries())
      .map(([canonical, originals]) => ({ canonical, originals }))
      .sort((a, b) => a.canonical.localeCompare(b.canonical));
  }, [keyAlignmentResult]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    };
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GitMerge className="size-5" />
          {t('mergeKeys.title')}
        </CardTitle>
        <CardDescription>{t('mergeKeys.description')}</CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        {/* ---------- No extraction data ---------- */}
        {!extractionSnapshot && (
          <p className="text-sm text-muted-foreground">{t('review.hintNoFiles')}</p>
        )}

        {/* ---------- Extraction summary ---------- */}
        {extractionSummary && (
          <Collapsible>
            <CollapsibleTrigger className="flex w-full items-center gap-2 px-4 py-3 text-sm font-medium hover:bg-muted/50 rounded-t-md">
              <CheckCircle2 className="text-emerald-600 size-4" />
              <span className="font-semibold">{t('review.extractionComplete')}</span>
              <span className="ml-2 text-xs text-muted-foreground">
                {t('mergeKeys.extractionSummary', {
                  total: extractionSummary.total,
                  succeeded: extractionSummary.succeeded,
                  failed: extractionSummary.failed,
                })}
              </span>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="pt-0 flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <span className="text-sm font-medium text-muted-foreground">
                    {t('mergeKeys.uniqueKeys', { count: uniqueKeys.length })}
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {uniqueKeys.map(({ key, count }) => (
                      <Badge
                        key={key}
                        variant={selectedKeys.has(key) ? 'default' : 'outline'}
                        className="text-xs cursor-pointer select-none"
                        onClick={() => toggleKey(key)}
                      >
                        {key}
                        {count > 1 && (
                          <span className="ml-1 opacity-60">({count})</span>
                        )}
                      </Badge>
                    ))}
                  </div>
                </div>
              </CardContent>
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* ---------- Reference input ---------- */}
        {extractionSnapshot && !isAligning && !isAligned && (
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-muted-foreground">
              {t('mergeKeys.referenceText')}
            </span>
            <Textarea
              className="min-h-[60px]"
              placeholder={t('mergeKeys.referenceTextPlaceholder')}
              value={referenceText}
              onChange={(e) => setReferenceText(e.target.value)}
            />
          </div>
        )}

        {/* ---------- Action buttons ---------- */}
        {extractionSnapshot && !isAligning && !isAligned && (
          <div className="flex gap-2">
            <Button
              onClick={handleAutoMerge}
              disabled={uniqueKeys.length === 0}
            >
              <Sparkles className="size-4 mr-1" />
              {t('mergeKeys.autoMerge')}
            </Button>
            <Button variant="outline" onClick={handleSkip}>
              <SkipForward className="size-4 mr-1" />
              {t('mergeKeys.skip')}
            </Button>
          </div>
        )}

        {/* ---------- Error ---------- */}
        {error && (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertTriangle className="size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* ---------- Aligning in progress ---------- */}
        {isAligning && (
          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Loader2 className="size-4 animate-spin text-primary" />
                  {t('mergeKeys.autoMerging')}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex items-center gap-4">
                  {phases.map((phase) => (
                    <div key={phase.key} className="flex items-center gap-2">
                      <div
                        className={`flex items-center justify-center rounded-full ${
                          phase.status === 'done'
                            ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/20'
                            : phase.status === 'active'
                              ? 'bg-primary/10 text-primary'
                              : 'bg-muted text-muted-foreground'
                        }`}
                        style={{ width: 28, height: 28 }}
                      >
                        {phase.status === 'done' ? (
                          <CheckCircle2 className="size-4" />
                        ) : phase.status === 'active' ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <div className="size-2 rounded-full bg-current" />
                        )}
                      </div>
                      <span className="text-sm">
                        {t(`mergeKeys.phase${phase.key.charAt(0).toUpperCase() + phase.key.slice(1)}`)}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
            <Button variant="destructive" onClick={handleAbort}>
              {t('mergeKeys.abort')}
            </Button>
          </div>
        )}

        {/* ---------- Alignment result ---------- */}
        {isAligned && keyAlignmentResult && (
          <div className="flex flex-col gap-4">
            {/* AI fallback warning */}
            {keyAlignmentResult.aiFailed && (
              <div className="flex items-center gap-2 text-sm text-amber-600">
                <AlertTriangle className="size-4 shrink-0" />
                <span>{t('mergeKeys.aiFailed')}</span>
              </div>
            )}

            {/* Summary */}
            <div className="flex items-center gap-2 text-sm">
              <GitMerge className="size-4 text-muted-foreground" />
              <span>
                {t('mergeKeys.mappingSummary', {
                  from: uniqueKeys.length,
                  to: keyAlignmentResult.fieldOrder.length,
                })}
              </span>
            </div>

            {/* Mapping table (only changed entries) */}
            {mappingEntries.length > 0 ? (
              <Card>
                <CardContent className="pt-4">
                  <h4 className="text-sm font-medium mb-3">{t('mergeKeys.mappingTable')}</h4>
                  <div className="max-h-[40vh] overflow-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('mergeKeys.canonicalKey')}</TableHead>
                          <TableHead>{t('mergeKeys.originalKey')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {mappingEntries.map(({ canonical, originals }) => (
                          <TableRow key={canonical}>
                            <TableCell className="font-medium">{canonical}</TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-1">
                                {originals.map((orig) => (
                                  <Badge key={orig} variant="secondary" className="text-xs">
                                    {orig}
                                  </Badge>
                                ))}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <p className="text-sm text-muted-foreground">{t('mergeKeys.noMapping')}</p>
            )}

            {/* Navigation */}
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => {
                clearKeyAlignmentResult();
                setProgress({ status: 'extraction_done' });
                setPhases([...INIT_PHASES]);
              }}>
                <RotateCcw className="size-4 mr-1" />
                {t('mergeKeys.remap')}
              </Button>
              <Button onClick={handleProceed}>
                {t('mergeKeys.proceed')}
                <ArrowRight className="size-4 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
