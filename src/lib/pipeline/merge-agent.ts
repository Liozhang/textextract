import type { OpenAI } from 'openai';
import type { AlignedPerFileResult, MergedRecord, ConflictInfo } from './types';
import {
  MERGE_SYSTEM_MESSAGE,
  buildMergeUserMessage,
  TEMPLATE_ALIGN_SYSTEM_MESSAGE,
  buildTemplateAlignUserMessage,
} from './prompts';
import { parseJsonResponse } from './json-parser';
import { isReasoningModel, supportsJsonResponseFormat } from '@/lib/merge-utils';

// ─── Shared utilities ─────────────────────────────────────────────────────

/**
 * Normalize a key for fuzzy matching against template columns.
 * Handles whitespace, fullwidth characters, and zero-width chars.
 */
export function normalizeKey(key: string): string {
  return key
    .trim()
    .normalize('NFKC')
    .replace(/[\s\u200B-\u200D\uFEFF]+/g, '');
}

/**
 * Normalize any value to a string. Handles measurement objects and arrays
 * safely, avoiding the "[object Object]" problem from raw String(v).
 */
export function normalizeValue(v: unknown): string {
  if (v == null) return '';

  // Measurement object: { value, unit }
  if (typeof v === 'object' && !Array.isArray(v) && v !== null
    && 'value' in v && 'unit' in v) {
    const m = v as { value: unknown; unit: string };
    return `${m.value} ${m.unit}`.trim();
  }

  if (Array.isArray(v)) {
    return v
      .map((item) => normalizeValue(item))
      .filter(Boolean)
      .join('; ');
  }

  if (typeof v === 'object') {
    try { return JSON.stringify(v); } catch { return String(v); }
  }

  return String(v);
}

// ─── Filter suspicious keys ─────────────────────────────────────────────

/**
 * Filter suspicious keys from AI merge output.
 * Only removes structural/meta keys that AI may hallucinate,
 * never removes user-facing field names like "Note" or "Warning".
 */
const SUSPICIOUS_KEY_PATTERNS = [
  /^(system_prompt|instructions|task|_meta|merged|entries|conflicts)$/i,
];

function filterSuspiciousKeys(
  merged: Record<string, unknown>,
): Record<string, unknown> {
  const filtered: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(merged)) {
    const isSuspicious = SUSPICIOUS_KEY_PATTERNS.some((re) => re.test(key));
    if (!isSuspicious) {
      filtered[key] = val;
    }
  }
  return filtered;
}

/**
 * Enforce template columns: only keep template keys, fill missing with null.
 * Uses normalizeKey for fuzzy matching to tolerate whitespace/encoding variants.
 */
function enforceTemplateColumns(
  data: Record<string, unknown>,
  columns: Array<{ key: string }>,
): Record<string, unknown> {
  // Build normalized → original key index for fuzzy lookup
  const normalizedIdx = new Map<string, string>();
  for (const k of Object.keys(data)) {
    normalizedIdx.set(normalizeKey(k), k);
  }

  const result: Record<string, unknown> = {};
  for (const col of columns) {
    const originalKey = normalizedIdx.get(normalizeKey(col.key));
    result[col.key] = originalKey !== undefined ? data[originalKey] : null;
  }
  return result;
}

/**
 * Check if data matches template columns. Returns mismatched info.
 * Uses normalizeKey for fuzzy comparison.
 */
function checkTemplateMatch(
  entries: Array<Record<string, unknown>>,
  templateColumns: Array<{ key: string; description?: string }>,
): { matched: boolean; mismatches: string[] } {
  const templateNormalizedKeys = new Set(templateColumns.map((c) => normalizeKey(c.key)));
  const mismatches: string[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const entryNormalizedKeys = new Set(Object.keys(entry).map(normalizeKey));

    // Check for extra keys not in template (normalized comparison)
    const extraKeys = Object.keys(entry).filter((k) => !templateNormalizedKeys.has(normalizeKey(k)));
    if (extraKeys.length > 0) {
      mismatches.push(`条目${i + 1}包含模板之外的键: ${extraKeys.join(', ')}`);
    }

    // Check for missing template keys (normalized comparison)
    const missingKeys = templateColumns
      .filter((c) => !entryNormalizedKeys.has(normalizeKey(c.key)))
      .map((c) => c.key);
    if (missingKeys.length > 0) {
      mismatches.push(`条目${i + 1}缺少模板列: ${missingKeys.join(', ')}`);
    }
  }

  return { matched: mismatches.length === 0, mismatches };
}

// ─── Shared helpers ─────────────────────────────────────────────────────────

/** Parse AI response into entries + conflicts */
function parseEntriesFromResponse(
  parsed: unknown,
): { entries: Array<Record<string, unknown>>; conflicts: ConflictInfo[] } {
  const conflicts: ConflictInfo[] = [];
  const entries: Array<Record<string, unknown>> = [];

  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;

    if (Array.isArray(obj.conflicts)) {
      for (const c of obj.conflicts) {
        const conflict = c as Record<string, unknown>;
        if (conflict.field && Array.isArray(conflict.values)) {
          conflicts.push({
            fieldName: String(conflict.field),
            values: (conflict.values as string[]).map((v) =>
              typeof v === 'string' ? v : JSON.stringify(v),
            ),
          });
        }
      }
    }

    if (Array.isArray(obj.entries)) {
      for (const entry of obj.entries) {
        if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
          entries.push(entry as Record<string, unknown>);
        }
      }
    } else if (obj.merged && typeof obj.merged === 'object') {
      entries.push(obj.merged as Record<string, unknown>);
    } else if (!('conflicts' in obj)) {
      entries.push(obj);
    }
  }

  return { entries, conflicts };
}

/** Build base request options for AI calls */
function buildRequestOptions(model: string, messages: Array<{ role: string; content: string }>): Record<string, unknown> {
  const opts: Record<string, unknown> = {
    model,
    messages,
    temperature: 0.1,
    stream: false,
  };
  if (supportsJsonResponseFormat(model)) {
    opts.response_format = { type: 'json_object' };
  }
  if (isReasoningModel(model)) {
    opts.reasoning_effort = 'low';
  }
  return opts;
}

// ─── Merge (Phase 1) ────────────────────────────────────────────────────────

/**
 * Merge a group of aligned extraction results using AI.
 * No template columns — preserves all original keys, only merges duplicates.
 * Returns an array of MergedRecords (supports multi-entry output).
 */
export async function mergeGroupWithAI(
  openai: OpenAI,
  model: string,
  groupKey: string,
  groupId: string,
  successfulResults: AlignedPerFileResult[],
  abortSignal: AbortSignal,
  customSystemPrompt?: string,
): Promise<MergedRecord[]> {
  const sourceData = successfulResults.map((r) => ({
    fileName: r.fileName,
    data: r.data! as Record<string, unknown>,
  }));

  const userMessage = buildMergeUserMessage(groupKey, sourceData);

  const completion = await openai.chat.completions.create(
    buildRequestOptions(model, [
      { role: 'system', content: customSystemPrompt || MERGE_SYSTEM_MESSAGE },
      { role: 'user', content: userMessage },
    ]) as any,
    {
      signal: AbortSignal.any([abortSignal, AbortSignal.timeout(300_000)]),
    },
  );

  const msg = completion.choices?.[0]?.message;
  const content = typeof msg?.content === 'string' ? msg.content : '';

  const parsed = parseJsonResponse(content);
  const { entries, conflicts } = parseEntriesFromResponse(parsed);

  if (entries.length === 0) {
    entries.push({});
  }

  // Collect union of all input keys for enforceOriginalKeys
  const inputKeyUnion = new Set<string>();
  for (const r of successfulResults) {
    if (r.data) {
      for (const k of Object.keys(r.data)) {
        inputKeyUnion.add(k);
      }
    }
  }

  const primaryResult = successfulResults.find((r) => r.imageDataUrl);

  return entries.map((entry) => {
    const data = filterSuspiciousKeys(entry);

    // Enforce original keys: fill missing keys with null
    const stringData: Record<string, unknown> = {};
    const missingKeys: string[] = [];
    for (const k of inputKeyUnion) {
      if (k in data) {
        stringData[k] = normalizeValue(data[k]);
      } else {
        stringData[k] = null;
        missingKeys.push(k);
      }
    }
    // Preserve keys that AI produced but input didn't have
    for (const [k, v] of Object.entries(data)) {
      if (!(k in stringData)) {
        stringData[k] = normalizeValue(v);
      }
    }

    const enhancedConflicts = [...conflicts];
    if (missingKeys.length > 0) {
      enhancedConflicts.push({ fieldName: '_missing_keys', values: missingKeys });
    }

    return {
      groupId,
      groupKey,
      data: stringData,
      imageDataUrl: primaryResult?.imageDataUrl,
      sourceFileNames: successfulResults.map((r) => r.fileName),
      mergedCount: successfulResults.length,
      mergeMethod: 'ai' as const,
      conflicts: enhancedConflicts,
    };
  });
}

// ─── Template Alignment (Phase 2) ───────────────────────────────────────────

const MAX_ALIGN_RETRIES = 3;

/**
 * Align merged data to template columns using AI.
 * Supports multi-entry output and retries with mismatch feedback.
 */
export async function alignToTemplateWithAI(
  openai: OpenAI,
  model: string,
  groupKey: string,
  groupId: string,
  mergedRecords: MergedRecord[],
  templateColumns: Array<{ key: string; description?: string }>,
  abortSignal: AbortSignal,
  customSystemPrompt?: string,
): Promise<MergedRecord[]> {
  const mergedData = mergedRecords.map((r) => r.data);
  const sourceFileNames = mergedRecords[0]?.sourceFileNames ?? [];
  const imageDataUrl = mergedRecords.find((r) => r.imageDataUrl)?.imageDataUrl;
  const mergedCount = mergedRecords[0]?.mergedCount ?? 1;

  const systemPrompt = customSystemPrompt || TEMPLATE_ALIGN_SYSTEM_MESSAGE;
  let userMessage = buildTemplateAlignUserMessage(groupKey, mergedData, templateColumns);
  const messages: Array<{ role: string; content: string }> = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];

  let allConflicts: ConflictInfo[] = [];

  for (let attempt = 1; attempt <= MAX_ALIGN_RETRIES; attempt++) {
    const completion = await openai.chat.completions.create(
      buildRequestOptions(model, messages) as any,
      {
        signal: AbortSignal.any([abortSignal, AbortSignal.timeout(300_000)]),
      },
    );

    const msg = completion.choices?.[0]?.message;
    const content = typeof msg?.content === 'string' ? msg.content : '';

    const parsed = parseJsonResponse(content);
    const { entries, conflicts } = parseEntriesFromResponse(parsed);

    if (entries.length === 0) {
      entries.push({});
    }

    allConflicts = conflicts;

    // Check against AI's raw output (not enforced) so mismatch feedback is accurate
    const filteredEntries = entries.map((entry) => filterSuspiciousKeys(entry));
    const { matched, mismatches } = checkTemplateMatch(filteredEntries, templateColumns);

    if (matched || attempt >= MAX_ALIGN_RETRIES) {
      // Final enforce — only now apply strict column constraint
      const finalEntries = filteredEntries.map((entry) =>
        enforceTemplateColumns(entry, templateColumns),
      );

      return finalEntries.map((entry) => {
        const stringData: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(entry)) {
          stringData[k] = v != null ? normalizeValue(v) : '';
        }

        return {
          groupId,
          groupKey,
          data: stringData,
          imageDataUrl,
          sourceFileNames,
          mergedCount,
          mergeMethod: 'ai' as const,
          conflicts: allConflicts,
        };
      });
    }

    // Retry with mismatch feedback — push AI's raw output + user correction
    messages.push(
      { role: 'assistant', content },
      {
        role: 'user',
        content: `上次输出与模板列不匹配，请修正：\n${mismatches.join('\n')}\n\n要求：每个对象必须包含所有模板列（${templateColumns.map((c) => c.key).join(', ')}），不要输出模板之外的键。`,
      },
    );
  }

  // Unreachable (loop always returns inside)
  return [];
}