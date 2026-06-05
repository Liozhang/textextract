import { useMemo } from 'react';
import { useStore } from '@/lib/store';

interface ExtractionSummary {
  total: number;
  succeeded: number;
  failed: number;
}

/** Collect all keys from both r.data and r.entries[]. */
function collectKeysFromResult(r: { success: boolean; data?: Record<string, unknown>; entries?: Array<Record<string, unknown>> }): string[] {
  if (!r.success) return [];
  const keys: string[] = [];
  if (r.data) keys.push(...Object.keys(r.data));
  if (r.entries) {
    for (const entry of r.entries) {
      keys.push(...Object.keys(entry));
    }
  }
  return keys;
}

/**
 * Shared hook to compute extraction summary and field lists from the
 * extraction snapshot. Replaces duplicate useMemo logic across 3 panels.
 */
export function useExtractionSummary() {
  const extractionSnapshot = useStore((s) => s.extractionSnapshot);

  const extractionSummary = useMemo<ExtractionSummary | null>(() => {
    if (!extractionSnapshot) return null;
    const results = extractionSnapshot.results;
    return {
      total: results.length,
      succeeded: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
    };
  }, [extractionSnapshot]);

  const extractedFields = useMemo<string[]>(() => {
    if (!extractionSnapshot) return [];
    const fieldSet = new Set<string>();
    for (const r of extractionSnapshot.results) {
      for (const key of collectKeysFromResult(r)) {
        fieldSet.add(key);
      }
    }
    return Array.from(fieldSet);
  }, [extractionSnapshot]);

  const uniqueKeys = useMemo<Array<{ key: string; count: number }>>(() => {
    if (!extractionSnapshot) return [];
    const keyCount = new Map<string, number>();
    for (const r of extractionSnapshot.results) {
      for (const key of collectKeysFromResult(r)) {
        keyCount.set(key, (keyCount.get(key) || 0) + 1);
      }
    }
    return Array.from(keyCount.entries())
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  }, [extractionSnapshot]);

  return { extractionSummary, extractedFields, uniqueKeys };
}
