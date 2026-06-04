'use client';

import { useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  FolderTree,
  Layers,
  Merge,
  AlignJustify,
  GitMerge,
} from 'lucide-react';
import { useT } from '@/lib/i18n';
import {
  Card,
  CardContent,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
// Types
// ---------------------------------------------------------------------------

export interface PipelineRow {
  id: string;
  label: string;
  data: Record<string, unknown>;
  sourceFiles: string[];
  isMerged: boolean;
  fieldConsistency?: Record<string, boolean>;
  mergeMethod?: string;
}

export interface PipelinePhase {
  key: 'grouping' | 'extracting' | 'aligning' | 'merging' | 'collecting' | 'applying';
  status: 'pending' | 'active' | 'done';
  detail: string;
}

// ---------------------------------------------------------------------------
// SSE helpers
// ---------------------------------------------------------------------------

/** Parse SSE text into { event, data } chunks. Only returns complete events (terminated by \n\n). */
export function parseSSEChunks(text: string): { event: string; data: string }[] {
  const events: { event: string; data: string }[] = [];
  // Find last complete event boundary (ending with \n\n)
  const lastBoundary = text.lastIndexOf('\n\n');
  if (lastBoundary === -1) return events;
  const complete = text.slice(0, lastBoundary);
  const blocks = complete.split('\n\n');
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

/** Read SSE stream and invoke callback for each parsed event. */
export async function consumeSSEStream(
  response: Response,
  onEvent: (event: string, data: any) => void,
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('stream_error');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const events = parseSSEChunks(buffer);
    const lastNewline = buffer.lastIndexOf('\n\n');
    if (lastNewline !== -1) buffer = buffer.slice(lastNewline + 2);

    for (const evt of events) {
      try {
        const parsed = JSON.parse(evt.data);
        onEvent(evt.event, parsed);
      } catch {
        // ignore JSON parse errors
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

/** Render a field value with type-aware formatting */
export function renderFieldValue(value: unknown): string {
  if (value == null) return '\u2014';
  if (typeof value === 'object' && !Array.isArray(value) && 'value' in value && 'unit' in value) {
    const v = (value as { value: unknown; unit: string }).value;
    const u = (value as { value: unknown; unit: string }).unit;
    return `${v} ${u}`;
  }
  if (Array.isArray(value)) return value.map(String).join(', ');
  return String(value);
}

/** Translate merge method to human-readable label */
export function formatMergeMethod(method: string | undefined, t: (key: string) => string): { label: string; isFallback: boolean } {
  switch (method) {
    case 'ai': return { label: t('review.mergeMethodAi'), isFallback: false };
    case 'single': return { label: t('review.mergeMethodSingle'), isFallback: false };
    default: return { label: t('review.mergedRecords'), isFallback: false };
  }
}

// ---------------------------------------------------------------------------
// Phase Indicator
// ---------------------------------------------------------------------------

const PHASE_META: Record<string, { icon: typeof FolderTree; labelKey: string }> = {
  grouping: { icon: FolderTree, labelKey: 'pipeline.phaseGrouping' },
  extracting: { icon: Layers, labelKey: 'pipeline.phaseExtracting' },
  aligning: { icon: AlignJustify, labelKey: 'pipeline.phaseAligning' },
  merging: { icon: Merge, labelKey: 'pipeline.phaseMerging' },
};

export function PhaseIndicator({ phases }: { phases: PipelinePhase[] }) {
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
// Pipeline result card (collapsible)
// ---------------------------------------------------------------------------

interface PipelineResultCardProps {
  row: PipelineRow;
  headers: string[];
}

export function PipelineResultCard({ row, headers }: PipelineResultCardProps) {
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
          {row.isMerged && (() => {
            const { label, isFallback } = formatMergeMethod(row.mergeMethod, t);
            return (
              <Badge variant={isFallback ? 'outline' : 'secondary'} className={isFallback ? 'ml-auto gap-1 text-amber-600 border-amber-300' : 'ml-auto gap-1'}>
                <GitMerge className="size-3" />
                {label}
              </Badge>
            );
          })()}
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
