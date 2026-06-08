'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useStore, type ColumnConstraint } from '@/lib/store';
import { useT } from '@/lib/i18n';
import { PRESET_TEMPLATES } from '@/lib/preset-templates';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Separator } from '@/components/ui/separator';
import {
  Sparkles,
  Plus,
  Trash2,
  Loader2,
  SkipForward,
  Check,
  Download,
  Keyboard,
  CheckCircle2,
  LayoutGrid,
} from 'lucide-react';

interface TemplatePanelProps {
  /** Embedded mode: used inside review panel after extraction */
  embedded?: boolean;
  /** Extraction data for field-aware AI generation (embedded mode) */
  extractionData?: Array<{ fileId?: string; fileName?: string; data?: Record<string, unknown> }>;
  /** Pre-filled keys from key normalization step */
  prefilledKeys?: string[];
  /** Callback when user confirms template columns (embedded mode) */
  onConfirm?: () => void;
  /** Callback when user skips template (embedded mode) */
  onSkip?: () => void;
}

/**
 * Detect if pasted text is tabular data (headers from Excel/CSV).
 * Returns parsed column names if detected, null otherwise.
 */
function detectHeaders(text: string): string[] | null {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return null;

  // Check if first line contains tabs or multiple commas (Excel copy)
  const firstLine = lines[0];
  const hasTabs = firstLine.includes('\t');
  const commaCount = (firstLine.match(/,/g) || []).length;

  if (hasTabs) {
    return firstLine.split('\t').map((h) => h.trim()).filter(Boolean);
  }
  if (commaCount >= 2) {
    return firstLine.split(',').map((h) => h.trim()).filter(Boolean);
  }

  // Single line with space-separated values (3+ items, only when single line)
  const spaceParts = firstLine.split(/\s+/).filter(Boolean);
  if (lines.length === 1 && spaceParts.length >= 3 && spaceParts.length <= 15) {
    return spaceParts;
  }

  return null;
}

/**
 * Infer type from example value
 */
function inferType(value: string): 'string' | 'number' | 'boolean' {
  if (/^(true|false|yes|no|是|否)$/i.test(value)) return 'boolean';
  if (/^-?\d+(\.\d+)?$/.test(value)) return 'number';
  return 'string';
}

export default function TemplatePanel({
  embedded = false,
  extractionData,
  prefilledKeys,
  onConfirm,
  onSkip,
}: TemplatePanelProps) {
  const t = useT();
  const files = useStore((s) => s.files);
  const templateColumns = useStore((s) => s.templateColumns);
  const templatePrompt = useStore((s) => s.templatePrompt);
  const templateGenerated = useStore((s) => s.templateGenerated);
  const setTemplateColumns = useStore((s) => s.setTemplateColumns);
  const setTemplatePrompt = useStore((s) => s.setTemplatePrompt);
  const setTemplateGenerated = useStore((s) => s.setTemplateGenerated);
  const resetTemplate = useStore((s) => s.resetTemplate);
  const documentType = useStore((s) => s.documentType);
  const setDocumentType = useStore((s) => s.setDocumentType);

  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [newKeyName, setNewKeyName] = useState('');
  const [selectedImportKeys, setSelectedImportKeys] = useState<Set<string>>(new Set());

  // Auto-load clinical-report preset when no columns are configured yet
  useEffect(() => {
    if (templateColumns.length === 0 && !embedded) {
      const clinicalReport = PRESET_TEMPLATES.find((p) => p.id === 'clinical-report');
      if (clinicalReport) {
        setTemplateColumns(clinicalReport.columns);
        setTemplateGenerated(true);
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // All unique fields from extraction data (for import-all)
  const allExtractedFields = useMemo(() => {
    if (!extractionData) return [];
    const fieldSet = new Set<string>();
    for (const r of extractionData) {
      if (r.data) {
        for (const key of Object.keys(r.data)) {
          fieldSet.add(key);
        }
      }
    }
    return Array.from(fieldSet);
  }, [extractionData]);

  // The source keys to show as selectable badges (prefer normalized keys, fallback to all extracted)
  const availableKeys = useMemo(() => {
    if (prefilledKeys && prefilledKeys.length > 0) return prefilledKeys;
    return allExtractedFields;
  }, [prefilledKeys, allExtractedFields]);

  // Toggle a key in the selection set
  const toggleKey = useCallback((key: string) => {
    setSelectedImportKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Select / deselect all available keys
  const handleSelectAll = useCallback(() => {
    const existing = new Set(templateColumns.map((c) => c.key));
    setSelectedImportKeys(new Set(availableKeys.filter((k) => !existing.has(k))));
  }, [availableKeys, templateColumns]);

  const handleDeselectAll = useCallback(() => {
    setSelectedImportKeys(new Set());
  }, []);

  // Import selected keys into template columns
  const handleImportSelected = useCallback(() => {
    if (selectedImportKeys.size === 0) return;
    const existing = new Set(templateColumns.map((c) => c.key));
    const toAdd: ColumnConstraint[] = [];
    for (const key of selectedImportKeys) {
      if (!existing.has(key)) {
        toAdd.push({ key, type: 'string' as const, description: key, example: '' });
      }
    }
    if (toAdd.length > 0) {
      setTemplateColumns([...templateColumns, ...toAdd]);
      setTemplateGenerated(true);
    }
    setSelectedImportKeys(new Set());
  }, [selectedImportKeys, templateColumns, setTemplateColumns, setTemplateGenerated]);

  // Add single key manually
  const handleAddKey = useCallback(() => {
    const name = newKeyName.trim();
    if (!name) return;
    if (templateColumns.some((c) => c.key === name)) return;
    setTemplateColumns([
      ...templateColumns,
      { key: name, type: 'string', description: name, example: '' },
    ]);
    setNewKeyName('');
    setTemplateGenerated(true);
  }, [newKeyName, templateColumns, setTemplateColumns, setTemplateGenerated]);

  const handleGenerate = useCallback(async () => {
    if (!templatePrompt.trim()) return;
    setGenerating(true);
    setError('');

    try {
      // First line detection: if pasted text looks like tabular headers, parse directly
      const detectedHeaders = detectHeaders(templatePrompt);

      if (detectedHeaders && detectedHeaders.length >= 2) {
        // Parse second line as example values if available
        const lines = templatePrompt.trim().split(/\r?\n/).filter((l) => l.trim());
        let exampleRow: string[] = [];
        if (lines.length >= 2) {
          const sep = lines[0].includes('\t') ? '\t' : ',';
          exampleRow = lines[1].split(sep).map((v) => v.trim()).filter(Boolean);
        }

        const columns: ColumnConstraint[] = detectedHeaders.map((header, idx) => ({
          key: header,
          type: idx < exampleRow.length ? inferType(exampleRow[idx]) : 'string',
          description: header,
          example: idx < exampleRow.length ? exampleRow[idx] : '',
        }));

        setTemplateColumns(columns);
        setTemplatePrompt('');
        setTemplateGenerated(true);
        return;
      }

      // Not tabular data — check for simple key list before calling AI
      const simpleLines = templatePrompt.trim().split(/\r?\n/).filter((l) => l.trim());
      const singleLineText = simpleLines.length === 1 ? simpleLines[0].trim() : null;

      // Single line, single token (no separator): e.g. "姓名"
      if (singleLineText && !/[\t,\s]/.test(singleLineText)) {
        setTemplateColumns([{ key: singleLineText, type: 'string', description: singleLineText, example: '' }]);
        setTemplatePrompt('');
        setTemplateGenerated(true);
        return;
      }

      // Multi-line, each line a single token (no tab/comma): e.g. "姓名\n年龄\n电话"
      if (simpleLines.length >= 2 && simpleLines.every((l) => !/[\t,]/.test(l.trim()) && l.trim().length > 0)) {
        const seen = new Set<string>();
        const columns: ColumnConstraint[] = [];
        for (const l of simpleLines) {
          const key = l.trim();
          if (!seen.has(key)) {
            seen.add(key);
            columns.push({ key, type: 'string', description: key, example: '' });
          }
        }
        setTemplateColumns(columns);
        setTemplatePrompt('');
        setTemplateGenerated(true);
        return;
      }

      // Complex description — call AI to generate columns
      const apiSettings = useStore.getState().apiSettings;
      const res = await fetch('/api/generate-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: templatePrompt.trim(),
          files: files.map((f) => ({ name: f.name })),
          extractionData: extractionData || undefined,
          ...(apiSettings.baseUrl || apiSettings.apiKey || apiSettings.model ? { apiSettings } : {}),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || t('review.unknownError'));
        return;
      }

      if (data.columns && Array.isArray(data.columns) && data.columns.length > 0) {
        setTemplateColumns(data.columns);
        setTemplatePrompt('');
        setTemplateGenerated(true);
      } else {
        setError(t('template.emptyTemplate'));
      }
    } catch {
      setError(t('review.streamError'));
    } finally {
      setGenerating(false);
    }
  }, [templatePrompt, files, extractionData, setTemplateColumns, setTemplatePrompt, setTemplateGenerated]);

  const updateColumn = useCallback(
    (index: number, partial: Partial<ColumnConstraint>) => {
      if (partial.key !== undefined && partial.key !== templateColumns[index].key) {
        const duplicate = templateColumns.some(
          (c, i) => i !== index && c.key === partial.key,
        );
        if (duplicate) return;
      }
      const updated = templateColumns.map((c, i) =>
        i === index ? { ...c, ...partial } : c,
      );
      setTemplateColumns(updated);
    },
    [templateColumns, setTemplateColumns],
  );

  const addColumn = useCallback(() => {
    setTemplateColumns([
      ...templateColumns,
      { key: '', type: 'string', description: '', example: '' },
    ]);
  }, [templateColumns, setTemplateColumns]);

  const removeColumn = useCallback(
    (index: number) => {
      setTemplateColumns(templateColumns.filter((_, i) => i !== index));
    },
    [templateColumns, setTemplateColumns],
  );

  const handleConfirm = useCallback(() => {
    const validColumns = templateColumns.filter((c) => c.key.trim() !== '');
    if (validColumns.length > 0) {
      if (validColumns.length !== templateColumns.length) {
        setTemplateColumns(validColumns);
      }
      if (onConfirm) onConfirm();
    }
  }, [templateColumns, setTemplateColumns, onConfirm]);

  const handleSkip = useCallback(() => {
    if (onSkip) {
      onSkip();
    }
  }, [onSkip]);

  // Build value preview: for each column key, collect values from all extraction results
  const valuePreviewMap = useMemo(() => {
    if (!extractionData) return {};
    const map: Record<string, Array<{ fileName: string; value: unknown }>> = {};
    for (const col of templateColumns) {
      const entries: Array<{ fileName: string; value: unknown }> = [];
      for (const r of extractionData) {
        if (r.data && col.key in r.data) {
          entries.push({
            fileName: r.fileName || r.fileId || '?',
            value: r.data[col.key],
          });
        }
      }
      if (entries.length > 0) {
        map[col.key] = entries;
      }
    }
    return map;
  }, [extractionData, templateColumns]);

  // Unique file count for value preview header
  const previewFileCount = useMemo(() => {
    if (!extractionData) return 0;
    return new Set(extractionData.map((r) => r.fileId || r.fileName)).size;
  }, [extractionData]);

  return (
    <div className="space-y-4">
      {/* ── Document Type ── */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          {t('settings.documentType')}
        </div>
        <Input
          value={documentType}
          onChange={(e) => setDocumentType(e.target.value)}
          placeholder={t('settings.documentTypePlaceholder')}
        />
        <p className="text-xs text-muted-foreground">{t('settings.documentTypeHint')}</p>
      </div>

      <Separator />

      {/* ── Preset template selector ── */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <LayoutGrid className="size-4" />
          {t('template.presetSection')}
        </div>
        <p className="text-xs text-muted-foreground">{t('template.presetDesc')}</p>
        <div className="flex flex-wrap gap-2">
          {PRESET_TEMPLATES.map((preset) => (
            <Button
              key={preset.id}
              variant="outline"
              size="sm"
              onClick={() => {
                setTemplateColumns(preset.columns.map((c) => ({ ...c })));
                setTemplateGenerated(true);
              }}
            >
              {preset.name}
            </Button>
          ))}
        </div>
      </div>

      <Separator />

      {/* ── AI / Paste generation ── */}
      <div className="space-y-2">
        <div className="text-sm font-semibold">{t('template.title')}</div>
        <p className="text-xs text-muted-foreground">
          {embedded ? t('template.embeddedDescription') : t('template.description')}
        </p>
        <div className="flex gap-3">
          <Textarea
            className="min-h-[80px] flex-1"
            placeholder={t('template.promptPlaceholder')}
            value={templatePrompt}
            onChange={(e) => setTemplatePrompt(e.target.value)}
          />
          <Button
            onClick={handleGenerate}
            disabled={!templatePrompt.trim() || generating}
            className="shrink-0"
          >
            {generating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-1" />
                {t('template.generate')}
              </>
            )}
          </Button>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {generating && <p className="text-sm text-muted-foreground">{t('template.generating')}</p>}
      </div>

      <Separator />

      {/* ── Manual key input ── */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Keyboard className="size-4" />
          {t('template.manualSection')}
        </div>
        <p className="text-xs text-muted-foreground">{t('template.manualDesc')}</p>
        <div className="flex gap-2">
          <Input
            className="h-8 flex-1"
            placeholder={t('template.addKeyPlaceholder')}
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAddKey();
              }
            }}
          />
          <Button variant="outline" size="sm" onClick={handleAddKey} disabled={!newKeyName.trim()}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            {t('template.addKeyButton')}
          </Button>
        </div>

        {/* Selectable field badges */}
        {availableKeys.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{t('template.selectFieldsDesc')}</span>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={handleSelectAll}>
                  {t('template.selectAll')}
                </Button>
                <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={handleDeselectAll}>
                  {t('template.deselectAll')}
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {availableKeys.map((key) => {
                const alreadyInTemplate = templateColumns.some((c) => c.key === key);
                const isSelected = selectedImportKeys.has(key);
                return (
                  <Badge
                    key={key}
                    variant={isSelected ? 'default' : 'outline'}
                    className={`cursor-pointer select-none text-xs transition-colors ${
                      alreadyInTemplate ? 'opacity-40 pointer-events-none' : ''
                    }`}
                    onClick={() => !alreadyInTemplate && toggleKey(key)}
                  >
                    {isSelected && <CheckCircle2 className="size-3 mr-1" />}
                    {key}
                    {alreadyInTemplate && ' ✓'}
                  </Badge>
                );
              })}
            </div>
            {selectedImportKeys.size > 0 && (
              <Button size="sm" onClick={handleImportSelected}>
                <Download className="h-3.5 w-3.5 mr-1" />
                {t('template.importSelected', { count: selectedImportKeys.size })}
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Empty state */}
      {templateColumns.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-4">
          {t('template.emptyTemplate')}
        </p>
      )}

      {/* Column table with value preview */}
      {templateColumns.length > 0 && (
        <Card>
          <CardContent>
            {/* Pending entries header */}
            {extractionData && extractionData.length > 0 && (
              <div className="flex items-center gap-2 mb-3 text-sm text-muted-foreground">
                <Badge variant="secondary" className="text-xs">
                  {t('template.pendingEntries', { count: templateColumns.length })}
                </Badge>
                {previewFileCount > 0 && (
                  <span className="text-xs">{t('template.pendingDesc')}</span>
                )}
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 pr-2 min-w-[160px]">{t('template.key')}</th>
                    <th className="pb-2 pr-2 w-[100px]">{t('template.type')}</th>
                    <th className="pb-2 pr-2 min-w-[200px]">{t('template.desc')}</th>
                    <th className="pb-2 pr-2 min-w-[120px]">{t('template.example')}</th>
                    <th className="pb-2 pr-2 w-[60px]" title={t('template.repeatingHint')}>
                      {t('template.repeating')}
                    </th>
                    {/* Value preview column: only in embedded mode with data */}
                    {embedded && extractionData && extractionData.length > 0 && (
                      <th className="pb-2 pr-2 min-w-[200px]">
                        {t('template.valuePreview', { count: previewFileCount })}
                      </th>
                    )}
                    <th className="pb-2 w-[40px]" />
                  </tr>
                </thead>
                <tbody>
                  {templateColumns.map((col, idx) => {
                    const preview = valuePreviewMap[col.key];
                    return (
                      <tr key={col.key || idx} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="py-1.5 pr-2">
                          <Input
                            value={col.key}
                            onChange={(e) =>
                              updateColumn(idx, { key: e.target.value })
                            }
                            className="h-8"
                          />
                        </td>
                        <td className="py-1.5 pr-2">
                          <Select
                            value={col.type}
                            onValueChange={(v) =>
                              updateColumn(idx, {
                                type: v as ColumnConstraint['type'],
                              })
                            }
                          >
                            <SelectTrigger className="h-8">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="string">string</SelectItem>
                              <SelectItem value="number">number</SelectItem>
                              <SelectItem value="boolean">boolean</SelectItem>
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="py-1.5 pr-2">
                          <Input
                            value={col.description}
                            onChange={(e) =>
                              updateColumn(idx, { description: e.target.value })
                            }
                            className="h-8"
                          />
                        </td>
                        <td className="py-1.5 pr-2">
                          <Input
                            value={col.example || ''}
                            onChange={(e) =>
                              updateColumn(idx, { example: e.target.value })
                            }
                            className="h-8"
                          />
                        </td>
                        <td className="py-1.5 pr-2 text-center">
                          <input
                            type="checkbox"
                            checked={col.repeating || false}
                            onChange={(e) =>
                              updateColumn(idx, { repeating: e.target.checked })
                            }
                            className="size-3.5 rounded"
                            title={t('template.repeatingHint')}
                          />
                        </td>
                        {/* Value preview cells */}
                        {embedded && extractionData && extractionData.length > 0 && (
                          <td className="py-1.5 pr-2">
                            {preview && preview.length > 0 ? (
                              <div className="flex flex-col gap-0.5 max-h-[60px] overflow-y-auto text-xs">
                                {preview.slice(0, 5).map((entry, i) => (
                                  <div key={i} className="flex gap-1 truncate" title={`${entry.fileName}: ${String(entry.value)}`}>
                                    <span className="text-muted-foreground shrink-0">{entry.fileName}:</span>
                                    <span className="truncate">{entry.value != null ? String(entry.value) : t('template.noValue')}</span>
                                  </div>
                                ))}
                                {preview.length > 5 && (
                                  <span className="text-muted-foreground">{t('template.moreItems', { count: preview.length - 5 })}</span>
                                )}
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">{t('template.noValue')}</span>
                            )}
                          </td>
                        )}
                        <td className="py-1.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => removeColumn(idx)}
                            aria-label={t('template.removeColumn', { name: col.key })}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex gap-2">
              <Button variant="outline" size="sm" onClick={addColumn}>
                <Plus className="h-3.5 w-3.5 mr-1" />
                {t('template.addColumn')}
              </Button>
              {templateGenerated && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    resetTemplate();
                  }}
                >
                  {t('common.reset')}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Action buttons */}
      <div className="flex justify-end gap-2">
        {embedded ? (
          <>
            <Button variant="outline" size="sm" onClick={handleSkip}>
              <SkipForward className="h-4 w-4 mr-1" />
              {t('template.skip')}
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="sm" onClick={handleConfirm} disabled={templateColumns.length === 0}>
                  <Check className="h-4 w-4 mr-1" />
                  {t('template.confirmUse')}
                </Button>
              </TooltipTrigger>
              {templateColumns.length === 0 && (
                <TooltipContent>
                  <p>{t('template.confirmDisabledHint')}</p>
                </TooltipContent>
              )}
            </Tooltip>
          </>
        ) : (
          <Button variant="ghost" size="sm" onClick={resetTemplate}>
            <SkipForward className="h-4 w-4 mr-1" />
            {t('template.skip')}
          </Button>
        )}
      </div>
    </div>
  );
}
