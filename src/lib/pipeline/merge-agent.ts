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
  /^(system_prompt|instructions|task|_meta|merged|conflicts)$/i,
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
 * Merge a group of aligned extraction results using AI.
 * Input: AlignedPerFileResult[] (fields already normalized and flattened).
 * Returns a MergedRecord with mergeMethod = 'ai'.
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
): Promise<MergedRecord> {
  // Prepare source data (data is Record<string, string> but buildMergeUserMessage accepts Record<string, unknown>)
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
      signal: AbortSignal.any([abortSignal, AbortSignal.timeout(60_000)]),
    },
  );

  const msg = completion.choices?.[0]?.message;
  const content = typeof msg?.content === 'string' ? msg.content : '';

  const parsed = parseJsonResponse(content);

  let mergedData: Record<string, unknown> = {};
  const conflicts: ConflictInfo[] = [];

  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    if (obj.merged && typeof obj.merged === 'object') {
      mergedData = obj.merged as Record<string, unknown>;
    }
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
    if (!obj.merged && !('conflicts' in obj)) {
      mergedData = obj;
    }
  }

  mergedData = filterSuspiciousKeys(mergedData);

  // Convert all merged values to strings for consistency
  const stringData: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(mergedData)) {
    stringData[k] = v != null ? String(v) : '';
  }

  const primaryResult = successfulResults.find((r) => r.imageDataUrl);

  return {
    groupId,
    groupKey,
    data: stringData,
    imageDataUrl: primaryResult?.imageDataUrl,
    sourceFileNames: successfulResults.map((r) => r.fileName),
    mergedCount: successfulResults.length,
    mergeMethod: 'ai',
    conflicts,
  };
}
