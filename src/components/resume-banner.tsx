'use client';

import { RotateCcw, XCircle } from 'lucide-react';
import { useStore } from '@/lib/store';
import { useT } from '@/lib/i18n';
import { clearSession } from '@/lib/idb-storage';
import type { SessionData } from '@/lib/idb-storage';
import { Button } from '@/components/ui/button';

function timeAgo(ms: number): string {
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export default function ResumeBanner() {
  const t = useT();
  const interruptedSession = useStore((s) => s.interruptedSession);
  const restoreFromSession = useStore((s) => s.restoreFromSession);
  const setInterruptedSession = useStore((s) => s.setInterruptedSession);

  if (!interruptedSession) return null;

  const session = interruptedSession;
  const completed = session.results.filter((r) => r.success).length;
  const total = session.files.length;
  const failed = session.results.filter((r) => !r.success).length;

  const handleResume = () => {
    localStorage.removeItem('ocr-extract-interrupted');
    restoreFromSession(session);
  };

  const handleDiscard = async () => {
    // Clear IndexedDB session
    await clearSession(session.sessionId);
    localStorage.removeItem('ocr-extract-interrupted');
    // Clean up server temp files for all session IDs
    const sessionIds = session.sessionIds.length > 0 ? session.sessionIds : [session.sessionId];
    await Promise.allSettled(
      sessionIds.map((sid) =>
        fetch(`/api/upload/${sid}`, { method: 'DELETE' }).catch(() => {}),
      ),
    );
    setInterruptedSession(null);
  };

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
            time: timeAgo(session.createdAt),
          })}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button size="sm" onClick={handleResume}>
          <RotateCcw className="size-3.5 mr-1" />
          {t('resume.resumeBtn')}
        </Button>
        <Button variant="outline" size="sm" onClick={handleDiscard}>
          <XCircle className="size-3.5 mr-1" />
          {t('resume.discardBtn')}
        </Button>
      </div>
    </div>
  );
}
