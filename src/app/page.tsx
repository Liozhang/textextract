'use client';

import { useState } from 'react';
import { useStore } from '@/lib/store';
import { useHydrated } from '@/lib/store';
import { useT } from '@/lib/i18n';
import FileUploadPanel from '@/components/file-upload-panel';
import ExtractionPanel from '@/components/extraction-panel';
import TemplateStepPanel from '@/components/template-step-panel';
import ExportPanel from '@/components/export-panel';
import LanguageSwitcher from '@/components/language-switcher';
import PromptSettings from '@/components/prompt-settings';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Upload,
  Layers,
  LayoutTemplate,
  Download,
  Check,
  RotateCcw,
} from 'lucide-react';

const STEPS = [
  { key: 'upload', icon: Upload },
  { key: 'extract', icon: Layers },
  { key: 'template', icon: LayoutTemplate },
  { key: 'export', icon: Download },
] as const;

export default function Home() {
  const step = useStore((s) => s.step);
  const setStep = useStore((s) => s.setStep);
  const progress = useStore((s) => s.progress);
  const files = useStore((s) => s.files);
  const resetAll = useStore((s) => s.resetAll);
  const hydrated = useHydrated();
  const t = useT();

  const [showResetDialog, setShowResetDialog] = useState(false);

  // Prevent hydration mismatch - show nothing until store is hydrated
  if (!hydrated) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-muted-foreground">{t('common.loading')}</div>
        </div>
      </main>
    );
  }

  const currentStepIndex = STEPS.findIndex((s) => s.key === step);

  const canGoNext = () => {
    if (step === 'upload') return files.length > 0 && progress.status !== 'extracting';
    if (step === 'extract') return progress.status === 'extraction_done';
    if (step === 'template') return progress.status === 'done';
    return false;
  };

  const goNext = () => {
    const idx = STEPS.findIndex((s) => s.key === step);
    if (idx < STEPS.length - 1 && canGoNext()) {
      setStep(STEPS[idx + 1].key as typeof step);
    }
  };

  const isPipelineActive = progress.status === 'extracting' || progress.status === 'aligning_merging';

  const goPrev = () => {
    const idx = STEPS.findIndex((s) => s.key === step);
    if (idx > 0 && !isPipelineActive) {
      setStep(STEPS[idx - 1].key as typeof step);
    }
  };

  const isStepCompleted = (stepKey: (typeof STEPS)[number]['key']) => {
    if (stepKey === 'extract') return progress.status === 'extraction_done' || progress.status === 'done';
    if (stepKey === 'template') return progress.status === 'done';
    // Mark previous steps as completed if we're past them
    const idx = STEPS.findIndex((s) => s.key === stepKey);
    return idx < currentStepIndex;
  };

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-8 flex items-start justify-between">
        <div className="text-center flex-1">
          <h1 className="text-3xl font-bold tracking-tight">
            {t('app.title')}
          </h1>
          <p className="mt-2 text-muted-foreground">
            {t('app.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowResetDialog(true)}
            aria-label={t('common.resetAll')}
          >
            <RotateCcw className="size-4" />
          </Button>
          <PromptSettings />
          <LanguageSwitcher />
        </div>
      </div>

      {/* Step Indicator */}
      <Card className="mb-8">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            {STEPS.map((s, idx) => {
              const Icon = s.icon;
              const isActive = s.key === step;
              const completed = isStepCompleted(s.key);
              const clickable = idx <= currentStepIndex || isStepCompleted(s.key);

              return (
                <div key={s.key} className="flex items-center flex-1 last:flex-none">
                  <button
                    onClick={() => clickable && setStep(s.key as typeof step)}
                    disabled={!clickable}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-all ${
                      isActive
                        ? 'bg-primary text-primary-foreground shadow-md'
                        : completed
                          ? 'bg-primary/10 text-primary hover:bg-primary/20'
                          : 'text-muted-foreground cursor-not-allowed opacity-50'
                    }`}
                  >
                    {completed && !isActive ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Icon className="h-4 w-4" />
                    )}
                    <span className="text-sm font-medium hidden sm:inline">
                      {t('steps.' + s.key)}
                    </span>
                  </button>
                  {idx < STEPS.length - 1 && (
                    <div
                      className={`flex-1 h-0.5 mx-2 ${
                        idx < currentStepIndex ? 'bg-primary' : 'bg-muted'
                      }`}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Step Content */}
      <div className="space-y-6">
        {step === 'upload' && <FileUploadPanel />}
        {step === 'extract' && <ExtractionPanel />}
        {step === 'template' && <TemplateStepPanel />}
        {step === 'export' && <ExportPanel />}
      </div>

      {/* Navigation Buttons */}
      <div className="mt-8 flex items-center justify-between">
        <Button
          variant="outline"
          onClick={goPrev}
          disabled={currentStepIndex === 0 || isPipelineActive}
        >
          {t('common.prev')}
        </Button>
        <div className="text-sm text-muted-foreground">
          {t('common.step', { current: currentStepIndex + 1, total: STEPS.length })}
        </div>
        <Button
          onClick={goNext}
          disabled={currentStepIndex === STEPS.length - 1 || !canGoNext()}
        >
          {t('common.next')}
        </Button>
      </div>

      {/* Reset confirmation dialog */}
      <AlertDialog open={showResetDialog} onOpenChange={setShowResetDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('common.resetConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('common.resetConfirmDesc')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => { resetAll(); setShowResetDialog(false); }}>
              {t('common.resetConfirmAction')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
