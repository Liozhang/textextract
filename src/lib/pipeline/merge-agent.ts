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
 * Handles whitespace, fullwidth characters, zero-width chars,
 * strips numeric/list prefixes (e.g. "1-病理诊断" → "病理诊断"),
 * and strips common section/category prefixes (e.g. "基本信息-姓名" → "姓名").
 */

/** Section prefixes that are category labels, not content-specific.
 *  IMPORTANT: Sorted longest-first so "诊断意见-" matches before "诊断-". */
const SECTION_PREFIXES = [
  '全血细胞计数-',
  '补充报告-',
  '检验结果-',
  '检验信息-',
  '检验项目-',
  '检验方法-',
  '检测方法-',
  '患者信息-',
  '病理信息-',
  '病理报告-',
  '标本信息-',
  '就诊信息-',
  '诊断意见-',
  '镜下诊断-',
  '基本信息-',
  '血常规-',
  '患者-',
  '诊断-',
  '常规-',
];

/** Section prefix patterns that include a numeric suffix (e.g. "检验结果4-", "检验12-"). */
const NUMBERED_SECTION_RE = /^(检验结果|检验)\d+\s*[-—–]\s*/;

export function normalizeKey(key: string): string {
  let result = key
    .trim()
    .normalize('NFKC')
    .replace(/[\s\u200B-\u200D\uFEFF]+/g, '');
  // Loop: strip prefixes until no more changes
  let changed = true;
  while (changed) {
    changed = false;
    // Strip numbered section prefixes: "检验结果4-", "检验12-", etc.
    const before = result;
    result = result.replace(NUMBERED_SECTION_RE, '');
    if (result !== before) changed = true;
    // Strip numeric/ordinal prefixes: "1-", "10-", "1 -", "10—", etc.
    if (/^\d+\s*[-—–]\s*/.test(result)) {
      result = result.replace(/^\d+\s*[-—–]\s*/, '');
      changed = true;
    }
    // Strip section/category prefixes
    for (const prefix of SECTION_PREFIXES) {
      if (result.startsWith(prefix)) {
        result = result.slice(prefix.length);
        changed = true;
        break;
      }
    }
  }
  // Strip AI artifact suffixes: trailing {, {:, {', etc.
  result = cleanKeySuffix(result);
  // Guard: if stripping produced empty string, return original (trimmed)
  if (result.length === 0) return key.trim();
  return result;
}

// ─── Key suffix cleaning ────────────────────────────────────────────────

/**
 * Strip AI artifact suffixes from key names.
 * Removes trailing "{", "{:", "{'," and similar artifacts
 * that the AI sometimes appends to field names.
 */
export function cleanKeySuffix(key: string): string {
  // Strip trailing AI artifact characters: {, }, :, ', ", ,
  return key.replace(/[{:\'",}\s]+$/g, '').trim();
}

// ─── Key validation ─────────────────────────────────────────────────────

/** Known-good single-letter medical abbreviations that should not be filtered. */
const VALID_SINGLE_LETTERS = new Set(['T', 'N', 'M']);

/**
 * Check whether a key looks like a valid field name (not a measurement value,
 * date, ID, or special character that the AI mistakenly used as a key).
 *
 * Returns false for high-confidence garbage keys that should be filtered out.
 */
export function isValidKey(key: string): boolean {
  if (!key || key.length === 0) return false;

  // Single special character
  if (/^[\)\*\+,\\.><↑→↓\-—]$/.test(key)) return false;

  // Single Latin letter (except known medical abbreviations like TNM)
  if (/^[A-Za-z]$/.test(key) && !VALID_SINGLE_LETTERS.has(key)) return false;

  // Pure integer — could be an ID, index, or AI hallucination
  if (/^\d+$/.test(key)) return false;

  // Date pattern: YYYY/MM/DD or YYYY-MM-DD
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(key)) return false;

  // Time pattern: HH:MM or HH:MM:SS
  if (/^\d{1,2}:\d{2}/.test(key)) return false;

  // Measurement value as key: starts with decimal number + contains unit letters
  // e.g. "0.0027L/L", "4.20mmol/L", "0.01mg/dL"
  if (/^\d+\.\d+/.test(key) && /[a-zA-Z]/.test(key)) return false;

  // Measurement with reference range: starts with number + unit + ( or {
  // e.g. "1.19mmol/L(0.85-1.51)", "0.0027L/L(0.0011-0.0030){'"
  if (/^\d+\.?\d*[a-zA-Z]+/.test(key) && /[\(\{]/.test(key)) return false;

  // Percent-as-key: "14.1%{", "11.8%{'," etc.
  if (/^\d+\.?\d*%/.test(key)) return false;

  // Pure decimal number (no unit letters) — measurement without unit, e.g. "1.78", "5.722"
  if (/^\d+\.\d+$/.test(key)) return false;

  // IP address pattern: e.g. "16.22.184.45"
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(key)) return false;

  return true;
}

/**
 * Resolve a value from a data map using fuzzy matching.
 * Handles compound slash keys: e.g. colKey "检验项目/病理项目/诊断项目"
 * matches AI output key "检验项目" by checking each slash segment.
 */
export function resolveTemplateColumnValue(
  colKey: string,
  normIndex: Map<string, unknown>,
): unknown | undefined {
  const normCol = normalizeKey(colKey)
  const exact = normIndex.get(normCol)
  if (exact !== undefined) return exact
  if (colKey.includes('/')) {
    for (const seg of colKey.split('/')) {
      const segVal = normIndex.get(normalizeKey(seg))
      if (segVal !== undefined) return segVal
    }
  }
  return undefined
}

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
  // Build normalized → value index for fuzzy lookup
  const normIndex = new Map<string, unknown>();
  for (const [k, v] of Object.entries(data)) {
    normIndex.set(normalizeKey(k), v);
  }

  const result: Record<string, unknown> = {};
  for (const col of columns) {
    result[col.key] = resolveTemplateColumnValue(col.key, normIndex) ?? null;
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
      signal: AbortSignal.any([abortSignal, AbortSignal.timeout(600_000)]),
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
        signal: AbortSignal.any([abortSignal, AbortSignal.timeout(600_000)]),
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