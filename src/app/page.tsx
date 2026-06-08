'use client';

import { useState, useEffect } from 'react';
import { useStore } from '@/lib/store';
import { useHydrated } from '@/lib/store';
import { useT } from '@/lib/i18n';
import FileUploadPanel from '@/components/file-upload-panel';
import ExtractionPanel from '@/components/extraction-panel';
import TemplateStepPanel from '@/components/template-step-panel';
import AlignMergePanel from '@/components/align-merge-panel';
import ExportPanel from '@/components/export-panel';
import LanguageSwitcher from '@/components/language-switcher';
import PromptSettings from '@/components/prompt-settings';
import ResumeBanner from '@/components/resume-banner';
import { getInterruptedSessions } from '@/lib/idb-storage';
import type { SessionData } from '@/lib/idb-storage';
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
  GitMerge,
} from 'lucide-react';

const STEPS = [
  { key: 'upload', icon: Upload },
  { key: 'template', icon: LayoutTemplate },
  { key: 'extract', icon: Layers },
  { key: 'align_merge', icon: GitMerge },
  { key: 'export', icon: Download },
] as const;

export default function Home() {
  const step = useStore((s) => s.step);
  const setStep = useStore((s) => s.setStep);
  const progress = useStore((s) => s.progress);
  const files = useStore((s) => s.files);
  const resetAll = useStore((s) => s.resetAll);
  const setInterruptedSession = useStore((s) => s.setInterruptedSession);
  const hydrated = useHydrated();
  const t = useT();

  const [showResetDialog, setShowResetDialog] = useState(false);

  const locale = useStore((s) => s.locale);

  // Sync html lang attribute with locale
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  // Check for interrupted sessions on mount (IndexedDB + localStorage fallback)
  useEffect(() => {
    if (!hydrated) return;
    getInterruptedSessions().then((sessions) => {
      if (sessions.length > 0) {
        // Take the most recent session
        const latest = sessions.sort((a, b) => b.createdAt - a.createdAt)[0];
        setInterruptedSession(latest);
        return;
      }
      // Check localStorage for beforeunload-persisted session
      try {
        const raw = localStorage.getItem('ocr-extract-interrupted');
        if (raw) {
          const session = JSON.parse(raw) as SessionData;
          if (session.status === 'extracting' && session.results?.length > 0) {
            setInterruptedSession(session);
          }
        }
      } catch { /* ignore */ }
    });
  }, [hydrated, setInterruptedSession]);

  // Warn before leaving page when there is unsaved progress
  useEffect(() => {
    const hasProgress = files.length > 0 || progress.status !== 'idle';
    if (!hasProgress) return;

    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [files.length, progress.status]);

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
    if (step === 'upload') return files.length > 0;
    if (step === 'template') return progress.status === 'template_configured' || progress.status === 'extraction_done' || progress.status === 'done';
    if (step === 'extract') return progress.status === 'extraction_done' || progress.status === 'done';
    if (step === 'align_merge') return progress.status === 'done';
    if (step === 'export') return true;
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
    if (stepKey === 'upload') return files.length > 0;
    if (stepKey === 'template') return progress.status === 'template_configured' || progress.status === 'extraction_done' || progress.status === 'done';
    if (stepKey === 'extract') return progress.status === 'extraction_done' || progress.status === 'done';
    if (stepKey === 'align_merge') return progress.status === 'extraction_done' || progress.status === 'done';
    // Mark previous steps as completed if we're past them
    const idx = STEPS.findIndex((s) => s.key === stepKey);
    return idx < currentStepIndex;
  };

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-8 flex items-start justify-between">
        <div className="flex-1">
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
              const clickable = (idx <= currentStepIndex || isStepCompleted(s.key)) && !isPipelineActive;

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

      {/* Resume Banner */}
      <ResumeBanner />

      {/* Step Content */}
      <div className="space-y-6">
        {step === 'upload' && <FileUploadPanel />}
        {step === 'template' && <TemplateStepPanel />}
        {step === 'extract' && <ExtractionPanel />}
        {step === 'align_merge' && <AlignMergePanel />}
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
