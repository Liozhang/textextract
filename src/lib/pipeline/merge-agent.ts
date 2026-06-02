import type { OpenAI } from 'openai';
import type { AlignedPerFileResult, MergedRecord, ConflictInfo } from './types';
import {
  MERGE_SYSTEM_MESSAGE,
  buildMergeUserMessage,
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
 * Merge a group of aligned extraction results using AI.
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
  templateColumns?: Array<{ key: string; description?: string }>,
): Promise<MergedRecord[]> {
  // Prepare source data
  const sourceData = successfulResults.map((r) => ({
    fileName: r.fileName,
    data: r.data! as Record<string, unknown>,
  }));

  const userMessage = buildMergeUserMessage(groupKey, sourceData, templateColumns);

  const requestOptions: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: customSystemPrompt || MERGE_SYSTEM_MESSAGE },
      { role: 'user', content: userMessage },
    ],
    temperature: 0.1,
    stream: false,
  };

  if (supportsJsonResponseFormat(model)) {
    requestOptions.response_format = { type: 'json_object' };
  }

  if (isReasoningModel(model)) {
    requestOptions.reasoning_effort = 'low';
  }

  const completion = await openai.chat.completions.create(
    requestOptions as any,
    {
      signal: AbortSignal.any([abortSignal, AbortSignal.timeout(300_000)]),
    },
  );

  const msg = completion.choices?.[0]?.message;
  const content = typeof msg?.content === 'string' ? msg.content : '';

  const parsed = parseJsonResponse(content);

  const conflicts: ConflictInfo[] = [];
  const entries: Array<Record<string, unknown>> = [];

  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;

    // Parse conflicts
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

    // New format: entries array (takes priority)
    if (Array.isArray(obj.entries)) {
      for (const entry of obj.entries) {
        if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
          entries.push(entry as Record<string, unknown>);
        }
      }
    }
    // Backward compat: merged object
    else if (obj.merged && typeof obj.merged === 'object') {
      entries.push(obj.merged as Record<string, unknown>);
    }
    // Backward compat: plain object is the merged data
    else if (!('conflicts' in obj)) {
      entries.push(obj);
    }
  }

  // Fallback: if nothing parsed, create empty entry
  if (entries.length === 0) {
    entries.push({});
  }

  const primaryResult = successfulResults.find((r) => r.imageDataUrl);

  return entries.map((entry) => {
    let data = filterSuspiciousKeys(entry);

    // Enforce template columns if provided
    if (templateColumns && templateColumns.length > 0) {
      data = enforceTemplateColumns(data, templateColumns);
    }

    // Convert all values to strings for consistency
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
