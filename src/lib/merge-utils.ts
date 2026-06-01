// ---------------------------------------------------------------------------
// Merge strategy types
// ---------------------------------------------------------------------------

export type MergeStrategy = 'first_wins' | 'latest_wins' | 'longest_wins';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Check if a model name indicates a reasoning model (requires reasoning_effort param) */
export function isReasoningModel(model: string): boolean {
  const lower = model.toLowerCase()
  return /^(o[1-9]|o4-|step-|deepseek-r|claude)/.test(lower)
}

// ---------------------------------------------------------------------------
// strategyMerge — pure function for fallback merging
// ---------------------------------------------------------------------------

/**
 * Merge multiple data records using a strategy.
 * Used as fallback when AI merge fails.
 */
export function strategyMerge(
  results: Array<{ data: Record<string, unknown> }>,
  strategy: MergeStrategy = 'first_wins',
): { data: Record<string, unknown> } {
  if (results.length === 0) return { data: {} };
  const mergedData: Record<string, unknown> = { ...results[0].data };

  for (let i = 1; i < results.length; i++) {
    const r = results[i];
    if (r.data) {
      for (const [key, val] of Object.entries(r.data)) {
        const v = val != null ? String(val).trim() : '';
        const current = mergedData[key] != null ? String(mergedData[key]).trim() : '';
        const shouldOverwrite =
          strategy === 'latest_wins' ? v !== '' :
          strategy === 'longest_wins' ? v.length > current.length :
          v !== '' && current === '';
        if (shouldOverwrite) {
          mergedData[key] = val;
        }
      }
    }
  }

  return { data: mergedData };
}

/**
 * Compute per-field consistency across multiple source records.
 */
export function computeFieldConsistency(
  results: Array<{ data?: Record<string, unknown> }>,
): Record<string, boolean> {
  const consistency: Record<string, boolean> = {};
  const allKeys = new Set(results.flatMap((r) => Object.keys(r.data || {})));
  for (const key of allKeys) {
    const values = results
      .map((r) => r.data?.[key])
      .filter((v) => v != null && String(v).trim() !== '')
      .map((v) => String(v).trim());
    consistency[key] = values.length <= 1 || values.every((v) => v === values[0]);
  }
  return consistency;
}
