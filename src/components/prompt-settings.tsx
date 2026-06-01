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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Settings, RotateCcw, ChevronDown } from 'lucide-react';

const PHASES: Array<{ key: keyof PromptSettings; defaultKey: keyof typeof DEFAULT_PROMPTS }> = [
  { key: 'extraction', defaultKey: 'extraction' },
  { key: 'schemaAlign', defaultKey: 'schemaAlign' },
  { key: 'merge', defaultKey: 'merge' },
];

export default function PromptSettings() {
  const t = useT();
  const promptSettings = useStore((s) => s.promptSettings);
  const setPromptSettings = useStore((s) => s.setPromptSettings);
  const resetPromptSettings = useStore((s) => s.resetPromptSettings);

  const [open, setOpen] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['extraction']));

  // Local editing state (synced from store on open)
  const [localValues, setLocalValues] = useState<PromptSettings>({ ...promptSettings });

  const handleOpen = (isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen) {
      setLocalValues({ ...promptSettings });
    }
  };

  const handleChange = (phase: keyof PromptSettings, value: string) => {
    setLocalValues((prev) => ({ ...prev, [phase]: value }));
  };

  const handleSave = () => {
    for (const phase of PHASES) {
      setPromptSettings(phase.key, localValues[phase.key]);
    }
    setOpen(false);
  };

  const toggleExpand = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
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
            <DialogTitle>{t('settings.title')}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3 mt-4">
            {PHASES.map(({ key, defaultKey }) => (
              <Collapsible
                key={key}
                open={expanded.has(key)}
                onOpenChange={() => toggleExpand(key)}
              >
                <CollapsibleTrigger asChild>
                  <button className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent transition-colors">
                    {t(`settings.${key}`)}
                    <ChevronDown
                      className={`size-4 transition-transform ${expanded.has(key) ? 'rotate-180' : ''}`}
                    />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-2">
                  <textarea
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-ring"
                    rows={10}
                    value={localValues[key] || DEFAULT_PROMPTS[defaultKey]}
                    onChange={(e) => handleChange(key, e.target.value)}
                    placeholder={DEFAULT_PROMPTS[defaultKey]}
                  />
                </CollapsibleContent>
              </Collapsible>
            ))}
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
                setLocalValues({ extraction: '', schemaAlign: '', merge: '' });
                setShowResetConfirm(false);
              }}
            >
              {t('settings.restoreDefaults')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
