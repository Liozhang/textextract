'use client';

import { useState, useMemo, useCallback } from 'react';
import { RotateCcw, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useStore } from '@/lib/store';
import { useT } from '@/lib/i18n';
import { clearSession } from '@/lib/idb-storage';
import type { SessionData } from '@/lib/idb-storage';
import { Button } from '@/components/ui/button';

function timeAgo(ms: number, t: ReturnType<typeof useT>): string {
  if (typeof window === 'undefined') return '';
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) return t('resume.timeSeconds', { count: seconds });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t('resume.timeMinutes', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('resume.timeHours', { count: hours });
  return t('resume.timeDays', { count: Math.floor(hours / 24) });
}

export default function ResumeBanner() {
  const t = useT();
  const interruptedSession = useStore((s) => s.interruptedSession);
  const restoreFromSession = useStore((s) => s.restoreFromSession);
  const setInterruptedSession = useStore((s) => s.setInterruptedSession);
  const [discarding, setDiscarding] = useState(false);

  const session = interruptedSession;
  const timeAgoStr = useMemo(
    () => session ? timeAgo(session.createdAt, t) : '',
    [session?.createdAt, t],
  );
  const completed = session?.results.filter((r) => r.success).length ?? 0;
  const total = session?.files.length ?? 0;
  const failed = session?.results.filter((r) => !r.success).length ?? 0;

  const handleResume = useCallback(() => {
    if (!session) return;
    localStorage.removeItem('ocr-extract-interrupted');
    restoreFromSession(session);
  }, [session, restoreFromSession]);

  const handleDiscard = useCallback(async () => {
    if (discarding || !session) return;
    setDiscarding(true);
    try {
      await clearSession(session.sessionId);
      localStorage.removeItem('ocr-extract-interrupted');
      const sessionIds = session.sessionIds.length > 0 ? session.sessionIds : [session.sessionId];
      const results = await Promise.allSettled(
        sessionIds.map((sid) =>
          fetch(`/api/upload/${sid}`, { method: 'DELETE' }),
        ),
      );
      const failedCount = results.filter((r) => r.status === 'rejected').length;
      if (failedCount > 0) {
        toast.error(t('resume.discardCleanupError', { count: failedCount }));
      }
      setInterruptedSession(null);
    } finally {
      setDiscarding(false);
    }
  }, [session, discarding, setInterruptedSession, t]);

  if (!session) return null;

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/50 p-3 flex items-center gap-3">
      <RotateCcw className="size-4 text-amber-600 dark:text-amber-400 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
          {t('resume.title')}
        </p>
        <p className="text-xs text-amber-700 dark:text-amber-300">
          {t('resume.description', {
            completed,
            total,
            failed,
            time: timeAgoStr,
          })}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button size="sm" onClick={handleResume}>
          <RotateCcw className="size-3.5 mr-1" />
          {t('resume.resumeBtn')}
        </Button>
        <Button variant="outline" size="sm" onClick={handleDiscard} disabled={discarding}>
          <XCircle className="size-3.5 mr-1" />
          {discarding ? t('common.loading') : t('resume.discardBtn')}
        </Button>
      </div>
    </div>
  );
}
