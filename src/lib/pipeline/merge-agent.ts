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

/**
 * Filter suspicious keys from AI merge output.
 */
const SUSPICIOUS_KEY_PATTERNS = [
  /^(system_prompt|instructions|task|_meta|merged|entries|conflicts)$/i,
  /^(please|note|remember|warning|important|hint|tip)\b/i,
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
 */
function enforceTemplateColumns(
  data: Record<string, unknown>,
  columns: Array<{ key: string }>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const col of columns) {
    result[col.key] = col.key in data ? data[col.key] : null;
  }
  return result;
}

/**
 * Check if data matches template columns. Returns mismatched info.
 */
function checkTemplateMatch(
  entries: Array<Record<string, unknown>>,
  templateColumns: Array<{ key: string; description?: string }>,
): { matched: boolean; mismatches: string[] } {
  const templateKeys = new Set(templateColumns.map((c) => c.key));
  const mismatches: string[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const entryKeys = Object.keys(entry);

    // Check for extra keys not in template
    const extraKeys = entryKeys.filter((k) => !templateKeys.has(k));
    if (extraKeys.length > 0) {
      mismatches.push(`条目${i + 1}包含模板之外的键: ${extraKeys.join(', ')}`);
    }

    // Check for missing template keys
    const missingKeys = templateColumns
      .map((c) => c.key)
      .filter((k) => !(k in entry));
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

  const primaryResult = successfulResults.find((r) => r.imageDataUrl);

  return entries.map((entry) => {
    const data = filterSuspiciousKeys(entry);

    const stringData: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      stringData[k] = v != null ? String(v) : '';
    }

    return {
      groupId,
      groupKey,
      data: stringData,
      imageDataUrl: primaryResult?.imageDataUrl,
      sourceFileNames: successfulResults.map((r) => r.fileName),
      mergedCount: successfulResults.length,
      mergeMethod: 'ai' as const,
      conflicts,
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

    // Enforce template columns on each entry
    const enforcedEntries = entries.map((entry) =>
      enforceTemplateColumns(filterSuspiciousKeys(entry), templateColumns),
    );

    // Check if output matches template
    const { matched, mismatches } = checkTemplateMatch(enforcedEntries, templateColumns);

    if (matched || attempt >= MAX_ALIGN_RETRIES) {
      return enforcedEntries.map((entry) => {
        const stringData: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(entry)) {
          stringData[k] = v != null ? String(v) : '';
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

    // Retry with mismatch feedback
    messages.push(
      { role: 'assistant', content },
      {
        role: 'user',
        content: `上次输出与模板列不匹配，请修正：\n${mismatches.join('\n')}\n\n要求：每个对象必须包含所有模板列（${templateColumns.map((c) => c.key).join(', ')}），不要输出模板之外的键。`,
      },
    );
  }

  // Fallback (should not reach here, but satisfy TypeScript)
  return [];
}