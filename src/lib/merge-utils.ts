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
  return /^(o[1-9]|o4-|deepseek-r|claude)/.test(lower)
}

/** Check if a model supports `response_format: { type: 'json_object' }` */
export function supportsJsonResponseFormat(model: string): boolean {
  const lower = model.toLowerCase()
  // OpenAI o-series does not support response_format json_object
  if (/^o[1-9]/.test(lower) || /^o4-/.test(lower)) return false
  return true
}

// ---------------------------------------------------------------------------
// strategyMerge — pure function for fallback merging
// ---------------------------------------------------------------------------

/**
 * Merge multiple data records using a strategy.
 * Used as fallback when AI merge fails.
 */
export interface StrategyMergeResult {
  data: Record<string, unknown>;
  conflicts: Array<{ fieldName: string; values: string[] }>;
}

export function strategyMerge(
  results: Array<{ data: Record<string, unknown>; fileName?: string }>,
  strategy: MergeStrategy = 'first_wins',
): StrategyMergeResult {
  if (results.length === 0) return { data: {}, conflicts: [] };
  const mergedData: Record<string, unknown> = { ...results[0].data };
  const conflicts: Array<{ fieldName: string; values: string[] }> = [];

  for (let i = 1; i < results.length; i++) {
    const r = results[i];
    if (r.data) {
      for (const [key, val] of Object.entries(r.data)) {
        const v = val != null ? String(val).trim() : '';
        const current = mergedData[key] != null ? String(mergedData[key]).trim() : '';
        // Detect conflicts: non-empty and different values
        if (v && current && v !== current) {
          const existing = conflicts.find((c) => c.fieldName === key);
          if (existing) {
            existing.values.push(`${r.fileName || `文件${i + 1}`}: ${v}`);
          } else {
            conflicts.push({
              fieldName: key,
              values: [
                `${results[0].fileName || '文件1'}: ${current}`,
                `${r.fileName || `文件${i + 1}`}: ${v}`,
              ],
            });
          }
        }
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

  return { data: mergedData, conflicts };
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
