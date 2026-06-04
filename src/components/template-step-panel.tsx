'use client';

import { LayoutTemplate } from 'lucide-react';
import { useStore } from '@/lib/store';
import { useT } from '@/lib/i18n';
import TemplatePanel from '@/components/template-panel';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export default function TemplateStepPanel() {
  const t = useT();
  const setProgress = useStore((s) => s.setProgress);
  const resetTemplate = useStore((s) => s.resetTemplate);
  const setStep = useStore((s) => s.setStep);

  const handleConfirm = () => {
    setProgress({ status: 'template_configured' });
    setStep('extract');
  };

  const handleSkip = () => {
    resetTemplate();
    setProgress({ status: 'template_configured' });
    setStep('extract');
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

      <CardContent>
        <TemplatePanel
          embedded
          onConfirm={handleConfirm}
          onSkip={handleSkip}
        />
      </CardContent>
    </Card>
  );
}
