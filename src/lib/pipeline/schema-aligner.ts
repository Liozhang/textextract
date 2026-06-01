import type { OpenAI } from 'openai';
import type { PerFileResult, FlattenedSchema, FieldPathInfo, FlattenRule, MergedRecord, UnifiedSchema } from './types';
import {
  SCHEMA_ALIGN_SYSTEM_MESSAGE,
  buildSchemaAlignUserMessage,
} from './prompts';
import { parseJsonResponse } from './json-parser';
import { isReasoningModel } from '@/lib/merge-utils';
import { collectFieldPaths } from './schema-flattener';

// ---------------------------------------------------------------------------
// Static synonym mapping (fallback when AI alignment fails)
// ---------------------------------------------------------------------------

const FIELD_SYNONYMS: Record<string, string> = {
  '姓名': '患者姓名',
  '病人姓名': '患者姓名',
  'name': '患者姓名',
  '病人': '患者姓名',
  '患者': '患者姓名',
  '患者名称': '患者姓名',
  '性别': '性别',
  'patient_gender': '性别',
  '年龄': '年龄',
  '患者年龄': '年龄',
  'age': '年龄',
  '出生日期': '出生日期',
  '生日': '出生日期',
  '身份证号': '身份证号',
  '身份证': '身份证号',
  'id_number': '身份证号',
  '联系电话': '联系电话',
  '电话': '联系电话',
  'phone': '联系电话',
  '手机': '联系电话',
  '手机号': '联系电话',
  '住址': '住址',
  '地址': '住址',
  'address': '住址',
  '住院号': '住院号',
  '病案号': '住院号',
  '病历号': '住院号',
  '住院编号': '住院号',
  '门诊号': '门诊号',
  '就诊号': '门诊号',
  '科室': '科室',
  'department': '科室',
  '床位号': '床位号',
  '床号': '床位号',
  '主治医师': '主治医师',
  '主管医生': '主治医师',
  '医生': '主治医师',
  '主治医生': '主治医师',
  '入院时间': '入院日期',
  '入院': '入院日期',
  'admission_date': '入院日期',
  '出院时间': '出院日期',
  'discharge_date': '出院日期',
  '门诊时间': '门诊日期',
  '就诊日期': '门诊日期',
  '诊断日期': '诊断日期',
  '主诉': '主诉',
  'chief_complaint': '主诉',
  '入院诊断': '入院诊断',
  'admission_diagnosis': '入院诊断',
  '出院诊断': '出院诊断',
  'discharge_diagnosis': '出院诊断',
  '病理诊断': '病理诊断',
  'icd编码': 'ICD编码',
  'icd_code': 'ICD编码',
  'icd': 'ICD编码',
  '手术名称': '手术名称',
  '手术': '手术名称',
  '手术记录': '手术记录',
  '用药方案': '用药方案',
  '用药': '用药方案',
  '治疗方案': '治疗方案',
  '治疗': '治疗方案',
  '过敏史': '过敏史',
  '既往史': '既往史',
  '家族史': '家族史',
};

const MODULE_ORDER = [
  '患者姓名', '性别', '年龄', '出生日期', '身份证号', '联系电话', '住址',
  '住院号', '病历号', '门诊号', '科室', '床位号', '主治医师',
  '入院日期', '出院日期', '门诊日期', '检查日期', '手术日期',
  '主诉', '入院诊断', '出院诊断', '病理诊断', 'ICD编码',
  '检查检验', '实验室检查', '影像学检查', '病理检查',
  '手术名称', '手术记录', '用药方案', '治疗方案',
  '过敏史', '既往史', '家族史',
];

// ---------------------------------------------------------------------------
// Schema cache — LRU eviction, bounded to MAX_CACHE_SIZE
// ---------------------------------------------------------------------------

const MAX_CACHE_SIZE = 100;
const schemaCache = new Map<string, FlattenedSchema>();

function cacheSet(key: string, schema: FlattenedSchema): void {
  if (schemaCache.size >= MAX_CACHE_SIZE) {
    const firstKey = schemaCache.keys().next().value;
    if (firstKey) schemaCache.delete(firstKey);
  }
  schemaCache.set(key, schema);
}

function buildFieldPathSetKey(paths: FieldPathInfo[]): string {
  return paths.map((p) => p.path).sort().join('|');
}

// ---------------------------------------------------------------------------
// alignSchemaWithAI — AI-driven schema alignment + flattening
// ---------------------------------------------------------------------------

/**
 * Build a FlattenedSchema from PerFileResult extraction data.
 * Collects all field paths, sends to AI for mapping/flattening rules,
 * caches result, and falls back on failure.
 */
export async function alignSchemaWithAI(
  openai: OpenAI,
  model: string,
  fieldPaths: FieldPathInfo[],
  abortSignal: AbortSignal,
): Promise<FlattenedSchema> {
  if (fieldPaths.length === 0) return emptySchema();

  // Check cache
  const cacheKey = buildFieldPathSetKey(fieldPaths);
  const cached = schemaCache.get(cacheKey);
  if (cached) return cached;

  // Build AI request
  const userMessage = buildSchemaAlignUserMessage(fieldPaths);
  const requestOptions: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: SCHEMA_ALIGN_SYSTEM_MESSAGE },
      { role: 'user', content: userMessage },
    ],
    temperature: 0.1,
    stream: false,
    response_format: { type: 'json_object' },
  };

  if (isReasoningModel(model)) {
    requestOptions.reasoning_effort = 'low';
  }

  const completion = await openai.chat.completions.create(
    requestOptions as any,
    { signal: AbortSignal.any([abortSignal, AbortSignal.timeout(30_000)]) },
  );

  const msg = completion.choices?.[0]?.message;
  const content = typeof msg?.content === 'string' ? msg.content : '';
  const parsed = parseJsonResponse(content);

  const schema = parseFlattenedSchema(parsed, fieldPaths);

  // Cache result
  cacheSet(cacheKey, schema);

  return schema;
}

function parseFlattenedSchema(
  parsed: unknown,
  fieldPaths: FieldPathInfo[],
): FlattenedSchema {
  let fieldMapping: Record<string, string> = {};
  let fieldOrder: string[] = [];
  let flattenRules: Record<string, FlattenRule> = {};

  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    if (obj.field_mapping && typeof obj.field_mapping === 'object') {
      fieldMapping = obj.field_mapping as Record<string, string>;
    }
    if (Array.isArray(obj.field_order)) {
      fieldOrder = (obj.field_order as string[]).filter((v) => typeof v === 'string');
    }
    if (obj.flatten_rules && typeof obj.flatten_rules === 'object') {
      flattenRules = obj.flatten_rules as Record<string, FlattenRule>;
    }
  }

  // Ensure every field path has a mapping (identity fallback)
  for (const fp of fieldPaths) {
    if (!fieldMapping[fp.path]) {
      fieldMapping[fp.path] = fp.path;
    }
  }

  // Ensure every field path has a flatten rule
  for (const fp of fieldPaths) {
    if (!flattenRules[fp.path]) {
      flattenRules[fp.path] = inferRule(fp.type);
    }
  }

  // Build ordered headers
  const allCanonical = new Set(Object.values(fieldMapping));
  const headers = deduplicateHeaders(fieldOrder, allCanonical);

  return {
    field_mapping: fieldMapping,
    field_order: headers,
    flatten_rules: flattenRules,
  };
}

function inferRule(type: string): FlattenRule {
  switch (type) {
    case 'measurement': return 'measurement';
    case 'array': return 'join_comma';
    default: return 'leaf';
  }
}

/**
 * Build final headers list: AI-ordered canonical names first,
 * then append any canonical names the AI missed.
 */
function deduplicateHeaders(aiOrder: string[], allCanonical: Set<string>): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const name of aiOrder) {
    if (!seen.has(name) && allCanonical.has(name)) {
      result.push(name);
      seen.add(name);
    }
  }
  for (const canonical of allCanonical) {
    if (!seen.has(canonical)) {
      result.push(canonical);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// alignSchema — pure code fallback (static synonym table)
// ---------------------------------------------------------------------------

/**
 * Fallback: Build FlattenedSchema using static synonym mapping + heuristic flattening.
 * Used when AI alignment fails or is unavailable.
 */
export function alignSchema(fieldPaths: FieldPathInfo[]): FlattenedSchema {
  if (fieldPaths.length === 0) return emptySchema();

  const fieldMapping: Record<string, string> = {};
  const flattenRules: Record<string, FlattenRule> = {};
  const canonicalKeys = new Set<string>();

  for (const fp of fieldPaths) {
    // Check leaf key and top-level key against synonym table
    const leafKey = fp.path.split('.').pop() || fp.path;
    const topKey = fp.path.split('.')[0];
    const canonical = FIELD_SYNONYMS[leafKey] || FIELD_SYNONYMS[topKey] || leafKey;
    fieldMapping[fp.path] = canonical;
    canonicalKeys.add(canonical);
    flattenRules[fp.path] = inferRule(fp.type);
  }

  // Sort: known fields by module order, then unknown by first-appearance
  const knownOrder = new Set(MODULE_ORDER);
  const orderedHeaders: string[] = [];
  for (const key of MODULE_ORDER) {
    if (canonicalKeys.has(key)) orderedHeaders.push(key);
  }
  for (const key of canonicalKeys) {
    if (!knownOrder.has(key)) orderedHeaders.push(key);
  }

  return {
    field_mapping: fieldMapping,
    field_order: orderedHeaders,
    flatten_rules: flattenRules,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptySchema(): FlattenedSchema {
  return { field_mapping: {}, field_order: [], flatten_rules: {} };
}
