'use client';

import { useState, useCallback, useMemo } from 'react';
import { useStore, type ColumnConstraint } from '@/lib/store';
import { useT } from '@/lib/i18n';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
  Sparkles,
  Plus,
  Trash2,
  Loader2,
  SkipForward,
  Check,
  Download,
  Keyboard,
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

  // Single line with space-separated values (3+ items)
  const spaceParts = firstLine.split(/\s+/).filter(Boolean);
  if (spaceParts.length >= 3 && spaceParts.length <= 30) {
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

  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [newKeyName, setNewKeyName] = useState('');

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

  // Auto-fill from prefilledKeys (normalized keys) on mount
  const handleImportPrefilled = useCallback(() => {
    if (!prefilledKeys || prefilledKeys.length === 0) return;
    const existing = new Set(templateColumns.map((c) => c.key));
    const toAdd = prefilledKeys
      .filter((k) => !existing.has(k))
      .map((key) => ({ key, type: 'string' as const, description: key, example: '' }));
    if (toAdd.length > 0) {
      setTemplateColumns([...templateColumns, ...toAdd]);
      setTemplateGenerated(true);
    }
  }, [prefilledKeys, templateColumns, setTemplateColumns, setTemplateGenerated]);

  // Auto-fill from all extracted fields
  const handleImportAllFields = useCallback(() => {
    const existing = new Set(templateColumns.map((c) => c.key));
    const toAdd = allExtractedFields
      .filter((k) => !existing.has(k))
      .map((key) => ({ key, type: 'string' as const, description: key, example: '' }));
    if (toAdd.length > 0) {
      setTemplateColumns([...templateColumns, ...toAdd]);
      setTemplateGenerated(true);
    }
  }, [allExtractedFields, templateColumns, setTemplateColumns, setTemplateGenerated]);

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
      setGenerating(false);
      return;
    }

    // Not tabular data — call AI to generate columns from description
    try {
      const res = await fetch('/api/generate-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: templatePrompt.trim(),
          files: files.map((f) => ({ name: f.name })),
          extractionData: extractionData || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '生成失败');
        return;
      }

      if (data.columns && Array.isArray(data.columns) && data.columns.length > 0) {
        setTemplateColumns(data.columns);
        setTemplatePrompt('');
        setTemplateGenerated(true);
      } else {
        setError('未能生成模板列，请尝试更明确的描述或直接粘贴表头行');
      }
    } catch {
      setError('网络请求失败');
    } finally {
      setGenerating(false);
    }
  }, [templatePrompt, files, extractionData, setTemplateColumns, setTemplatePrompt, setTemplateGenerated]);

  const updateColumn = useCallback(
    (index: number, partial: Partial<ColumnConstraint>) => {
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
    if (templateColumns.length > 0 && onConfirm) {
      onConfirm();
    }
  }, [templateColumns, onConfirm]);

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
      {/* AI / Paste generation section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            {t('template.title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {embedded ? t('template.embeddedDescription') : t('template.description')}
          </p>

          {/* Prompt input */}
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

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
          {generating && (
            <p className="text-sm text-muted-foreground">
              {t('template.generating')}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Manual key input section */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Keyboard className="size-4" />
            {t('template.manualSection')}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {t('template.manualDesc')}
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Single key input */}
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

          {/* Import buttons */}
          <div className="flex gap-2 flex-wrap">
            {prefilledKeys && prefilledKeys.length > 0 && (
              <Button variant="outline" size="sm" onClick={handleImportPrefilled}>
                <Download className="h-3.5 w-3.5 mr-1" />
                {t('template.importFields')}
                <span className="text-muted-foreground text-xs ml-1">
                  ({prefilledKeys.length})
                </span>
              </Button>
            )}
            {allExtractedFields.length > 0 && (
              <Button variant="outline" size="sm" onClick={handleImportAllFields}>
                <Download className="h-3.5 w-3.5 mr-1" />
                {t('template.importFields')}
                <span className="text-muted-foreground text-xs ml-1">
                  ({allExtractedFields.length})
                </span>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

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
                      <tr key={idx} className="border-b last:border-0 hover:bg-muted/30">
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
                                  <span className="text-muted-foreground">+{preview.length - 5} more</span>
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
            <Button size="sm" onClick={handleConfirm} disabled={templateColumns.length === 0}>
              <Check className="h-4 w-4 mr-1" />
              {t('template.confirmUse')}
            </Button>
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
