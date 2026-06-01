'use client';

import { useState, useCallback } from 'react';
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
import { Sparkles, Plus, Trash2, Loader2, SkipForward, Check } from 'lucide-react';

interface TemplatePanelProps {
  /** Embedded mode: used inside review panel after extraction */
  embedded?: boolean;
  /** Extraction data for field-aware AI generation (embedded mode) */
  extractionData?: Array<{ data?: Record<string, unknown> }>;
  /** Callback when user confirms template columns (embedded mode) */
  onConfirm?: (columns: ColumnConstraint[]) => void;
  /** Callback when user skips template (embedded mode) */
  onSkip?: () => void;
}

export default function TemplatePanel({
  embedded = false,
  extractionData,
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

  const handleGenerate = useCallback(async () => {
    if (!templatePrompt.trim()) return;
    setGenerating(true);
    setError('');

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

      if (data.columns && Array.isArray(data.columns)) {
        setTemplateColumns(data.columns);
        setTemplatePrompt('');
        setTemplateGenerated(true);
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
      onConfirm(templateColumns);
    }
  }, [templateColumns, onConfirm]);

  const handleSkip = useCallback(() => {
    if (onSkip) {
      onSkip();
    }
  }, [onSkip]);

  return (
    <div className="space-y-4">
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

      {/* Column table */}
      {templateColumns.length > 0 && (
        <Card>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 pr-2 min-w-[160px]">{t('template.key')}</th>
                    <th className="pb-2 pr-2 w-[100px]">{t('template.type')}</th>
                    <th className="pb-2 pr-2 min-w-[200px]">{t('template.desc')}</th>
                    <th className="pb-2 pr-2 min-w-[120px]">{t('template.example')}</th>
                    <th className="pb-2 w-[40px]" />
                  </tr>
                </thead>
                <tbody>
                  {templateColumns.map((col, idx) => (
                    <tr key={idx} className="border-b last:border-0">
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
                  ))}
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
