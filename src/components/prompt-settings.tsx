'use client';

import { useState } from 'react';
import { useStore } from '@/lib/store';
import { useT } from '@/lib/i18n';
import { DEFAULT_PROMPTS } from '@/lib/pipeline/prompts';
import type { PromptSettings } from '@/lib/store';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Settings, RotateCcw } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export default function PromptSettings() {
  const t = useT();
  const promptSettings = useStore((s) => s.promptSettings);
  const setPromptSettings = useStore((s) => s.setPromptSettings);
  const resetPromptSettings = useStore((s) => s.resetPromptSettings);
  const apiSettings = useStore((s) => s.apiSettings);
  const setApiSettings = useStore((s) => s.setApiSettings);
  const cacheSettings = useStore((s) => s.cacheSettings);
  const setCacheExpiryHours = useStore((s) => s.setCacheExpiryHours);
  const [open, setOpen] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showUnsavedConfirm, setShowUnsavedConfirm] = useState(false);

  // Local editing state (synced from store on open)
  const [localExtraction, setLocalExtraction] = useState(promptSettings.extraction);

  const isDirty = (localExtraction ?? '') !== (promptSettings.extraction ?? '');

  const handleOpen = (isOpen: boolean) => {
    if (!isOpen && isDirty) {
      setShowUnsavedConfirm(true);
      return;
    }
    setOpen(isOpen);
    if (isOpen) {
      setLocalExtraction(promptSettings.extraction);
    }
  };

  const handleSave = () => {
    setPromptSettings('extraction', localExtraction);
    setOpen(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpen}>
        <DialogTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={t('settings.title')}>
            <Settings className="size-4" />
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('settings.dialogTitle')}</DialogTitle>
          </DialogHeader>

          {/* ── API Configuration ──────────────────────────────────────── */}
          <div className="space-y-3 mt-4">
            <h4 className="text-sm font-semibold">{t('settings.apiSection')}</h4>
            <div className="flex flex-col gap-2">
              <Label htmlFor="api-base-url" className="text-xs text-muted-foreground">
                {t('settings.apiBaseUrl')}
              </Label>
              <Input
                id="api-base-url"
                value={apiSettings.baseUrl}
                onChange={(e) => setApiSettings({ baseUrl: e.target.value })}
                placeholder={t('settings.apiBaseUrlPlaceholder')}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="api-key" className="text-xs text-muted-foreground">
                {t('settings.apiKey')}
              </Label>
              <Input
                id="api-key"
                type="password"
                value={apiSettings.apiKey}
                onChange={(e) => setApiSettings({ apiKey: e.target.value })}
                placeholder={t('settings.apiKeyPlaceholder')}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="api-model" className="text-xs text-muted-foreground">
                {t('settings.apiModel')}
              </Label>
              <Input
                id="api-model"
                value={apiSettings.model}
                onChange={(e) => setApiSettings({ model: e.target.value })}
                placeholder={t('settings.apiModelPlaceholder')}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="api-concurrency" className="text-xs text-muted-foreground">
                {t('settings.apiConcurrency')}
              </Label>
              <Input
                id="api-concurrency"
                type="number"
                min="1"
                max="10"
                value={apiSettings.concurrency || ''}
                onChange={(e) => {
                  const raw = parseInt(e.target.value);
                  if (isNaN(raw)) {
                    setApiSettings({ concurrency: 0 });
                    return;
                  }
                  const clamped = Math.min(10, Math.max(1, raw));
                  setApiSettings({ concurrency: clamped });
                }}
                placeholder="3"
              />
            </div>
          </div>

          {/* ── Cache Settings ────────────────────────────────────────── */}
          <div className="space-y-3 mt-4">
            <h4 className="text-sm font-semibold">{t('settings.cacheSection')}</h4>
            <div className="flex flex-col gap-2">
              <Label htmlFor="cache-expiry" className="text-xs text-muted-foreground">
                {t('settings.cacheExpiryHours')}
              </Label>
              <Select
                value={String(cacheSettings.expiryHours)}
                onValueChange={(v) => setCacheExpiryHours(Number(v))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="6">6 {t('settings.hours')}</SelectItem>
                  <SelectItem value="12">12 {t('settings.hours')}</SelectItem>
                  <SelectItem value="24">24 {t('settings.hours')}</SelectItem>
                  <SelectItem value="48">48 {t('settings.hours')}</SelectItem>
                  <SelectItem value="72">72 {t('settings.hours')}</SelectItem>
                  <SelectItem value="168">7 {t('settings.days')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">{t('settings.cacheHint')}</p>
          </div>

          {/* ── Extraction Prompt ────────────────────────────────────── */}
          <div className="space-y-3 mt-4">
            <div className="flex flex-col gap-0.5">
              <h4 className="text-sm font-semibold">{t('settings.extraction')}</h4>
              <span className="text-xs text-muted-foreground">{t('settings.extractionHint')}</span>
            </div>
            <Textarea
              className="font-mono"
              rows={10}
              value={localExtraction || DEFAULT_PROMPTS.extraction}
              onChange={(e) => setLocalExtraction(e.target.value)}
              placeholder={DEFAULT_PROMPTS.extraction}
            />
          </div>

          <div className="flex items-center justify-between mt-6">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowResetConfirm(true)}
            >
              <RotateCcw className="size-3.5 mr-1.5" />
              {t('settings.restoreDefaults')}
            </Button>
            <Button size="sm" onClick={handleSave}>
              {t('common.confirm')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Reset confirmation */}
      <AlertDialog open={showResetConfirm} onOpenChange={setShowResetConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('settings.restoreConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('settings.restoreConfirmDesc')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                resetPromptSettings();
                setLocalExtraction('');
                setShowResetConfirm(false);
                setOpen(false);
              }}
            >
              {t('settings.restoreDefaults')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Unsaved changes confirmation */}
      <AlertDialog open={showUnsavedConfirm} onOpenChange={setShowUnsavedConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('settings.unsavedTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('settings.unsavedDesc')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setShowUnsavedConfirm(false);
                setLocalExtraction(promptSettings.extraction);
                setOpen(false);
              }}
            >
              {t('settings.discardChanges')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
