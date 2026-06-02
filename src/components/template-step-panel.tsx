'use client';

import { CheckCircle2, Sparkles, LayoutTemplate } from 'lucide-react';
import { useStore } from '@/lib/store';
import { useT } from '@/lib/i18n';
import { useExtractionSummary } from '@/lib/hooks/use-extraction-summary';
import TemplatePanel from '@/components/template-panel';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export default function TemplateStepPanel() {
  const t = useT();
  const progress = useStore((s) => s.progress);
  const extractionSnapshot = useStore((s) => s.extractionSnapshot);
  const keyAlignmentResult = useStore((s) => s.keyAlignmentResult);
  const setProgress = useStore((s) => s.setProgress);
  const resetTemplate = useStore((s) => s.resetTemplate);
  const setStep = useStore((s) => s.setStep);

  const { extractedFields, extractionSummary } = useExtractionSummary();
  const isExtractionDone = progress.status === 'extraction_done' || progress.status === 'keys_aligned';

  const handleConfirm = () => {
    setProgress({ status: 'template_done' });
    setStep('align_merge');
  };

  const handleSkip = () => {
    resetTemplate();
    setProgress({ status: 'template_done' });
    setStep('align_merge');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LayoutTemplate className="size-5" />
          {t('review.templateStepTitle')}
        </CardTitle>
        <CardDescription>{t('review.templateStepDesc')}</CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {!isExtractionDone && (
          <p className="text-muted-foreground text-sm">
            {t('review.hintNoFiles')}
          </p>
        )}

        {/* Extraction summary */}
        {isExtractionDone && extractionSummary && (
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="text-emerald-600 size-4" />
            <span className="font-medium">{t('review.extractionComplete')}</span>
            <span className="text-muted-foreground">
              {t('review.extractionSummary', {
                total: extractionSummary.total,
                succeeded: extractionSummary.succeeded,
                failed: extractionSummary.failed,
              })}
            </span>
          </div>
        )}

        {/* Extracted fields badges */}
        {isExtractionDone && extractedFields.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {extractedFields.map((field) => (
              <Badge key={field} variant="outline" className="text-xs">
                {field}
              </Badge>
            ))}
          </div>
        )}

        {/* Template configuration */}
        {isExtractionDone && (
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
                onConfirm={handleConfirm}
                onSkip={handleSkip}
              />
            </CardContent>
          </Card>
        )}
      </CardContent>
    </Card>
  );
}
