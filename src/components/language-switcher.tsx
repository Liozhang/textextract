'use client';

import { useStore } from '@/lib/store';
import type { Locale } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Globe } from 'lucide-react';

const LOCALE_OPTIONS: { value: Locale; label: string }[] = [
  { value: 'en', label: 'EN' },
  { value: 'zh', label: '中文' },
];

export default function LanguageSwitcher() {
  const locale = useStore((s) => s.locale);
  const setLocale = useStore((s) => s.setLocale);

  return (
    <div className="flex items-center gap-0.5 rounded-md border p-0.5">
      {LOCALE_OPTIONS.map((opt) => (
        <Button
          key={opt.value}
          variant={locale === opt.value ? 'default' : 'ghost'}
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => setLocale(opt.value)}
        >
          {opt.label}
        </Button>
      ))}
    </div>
  );
}
