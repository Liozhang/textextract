/**
 * Phase 1.5: Post-Extraction Normalization
 *
 * Deterministic code layer between Phase 1 (LLM extraction) and Phase 2 (schema alignment).
 * Standardizes extraction output without AI calls:
 * 1. Path prefix normalization (e.g. 肿瘤标志物检测 → 肿瘤标志物)
 * 2. Value format normalization (age, dates, measurements)
 * 3. Structure protection (array-of-objects detection)
 * 4. Key alias normalization (费别/籍贯 → 医保类型)
 */
import type { PerFileResult } from './types';

// ---------------------------------------------------------------------------
// Path prefix normalization
// ---------------------------------------------------------------------------

/** Map of known variant prefixes to canonical form */
const PATH_PREFIX_MAP: Record<string, string> = {
  '肿瘤标志物检测': '肿瘤标志物',
  '肿瘤标志物组合': '肿瘤标志物',
  '检验结果': '检验',
  '检验申请信息': '就诊信息',
  '门诊信息': '就诊信息',
  '基本信息': '患者信息',
  '人口学信息': '患者信息',
  '网络信息': '系统信息',
};

function normalizePathPrefix(path: string): string {
  const parts = path.split('.');
  if (parts.length > 1) {
    const normalized = PATH_PREFIX_MAP[parts[0]];
    if (normalized) parts[0] = normalized;
  }
  return parts.join('.');
}

// ---------------------------------------------------------------------------
// Key alias normalization (within objects)
// ---------------------------------------------------------------------------

/** Map of known field-name variants to canonical form */
const KEY_ALIASES: Record<string, string> = {
  '费别': '医保类型',
  '医保': '医保类型',
  '病人姓名': '姓名',
  '病人': '姓名',
  'name': '姓名',
  'patient_name': '姓名',
  '性别': '性别',
  '年龄': '年龄',
  '出生日期': '出生日期',
  '生日': '出生日期',
  '身份证号': '身份证号',
  '身份证': '身份证号',
  'id_number': '身份证号',
  '联系电话': '联系电话',
  '电话': '联系电话',
  '手机': '联系电话',
  '手机号': '联系电话',
  '住院号': '住院号',
  '病案号': '病案号',
  '病历号': '病案号',
  '住院编号': '住院号',
  '门诊号': '门诊号',
  '就诊号': '门诊号',
  '科室': '科室',
  '床号': '床位号',
  '床位号': '床位号',
  '主治医师': '主治医师',
  '主管医生': '主治医师',
  '医生': '主治医师',
  '主治医生': '主治医师',
  '管床医生': '主治医师',
  '申请医生': '主治医师',
  '送检科室': '科室',
  '诊断': '诊断',
  '入院诊断': '入院诊断',
  '出院诊断': '出院诊断',
  '临床诊断': '临床诊断',
  '病理诊断': '病理诊断',
  '本单号': '标本条码号',
  '标本条码号': '标本条码号',
  '标本号': '标本条码号',
  '条码号': '标本条码号',
  '标本类型': '标本类型',
  '样本类型': '标本类型',
  '样本条码号': '标本条码号',
  '样本号': '标本条码号',
  '标本状态': '标本状态',
  '样本状态': '标本状态',
  '标本采集时间': '标本采集时间',
  '样本采集时间': '标本采集时间',
  '发送报告时间': '发送报告时间',
  '报告发送时间': '发送报告时间',
  '检验日期': '检验日期',
  '报告日期': '报告日期',
  '检验项目': '检验项目',
  '检验项目名称': '检验项目',
  '医院': '医院',
  '医院名称': '医院',
};

// ---------------------------------------------------------------------------
// Tumor marker indicator name normalization
// ---------------------------------------------------------------------------

const TUMOR_MARKER_MAP: Record<string, string> = {
  '糖类抗原19-9': 'CA19-9',
  '糖类抗原72-4': 'CA72-4',
  '糖类抗原242': 'CA242',
  '糖类抗原125': 'CA125',
  '糖类抗原15-3': 'CA15-3',
  '甲胎蛋白': 'AFP',
  '癌胚抗原': 'CEA',
  '神经元特异性烯醇化酶': 'NSE',
  '细胞角蛋白19片段': 'CYFRA21-1',
  '鳞状细胞癌抗原': 'SCC',
  '前列腺特异性抗原': 'PSA',
  '游离前列腺特异性抗原': 'fPSA',
  '人绒毛膜促性腺激素': 'HCG',
  '铁蛋白': 'SF',
  '维生素B12': 'VitB12',
  '叶酸': 'FA',
};

function normalizeIndicatorName(key: string): string {
  return TUMOR_MARKER_MAP[key] || key;
}

// ---------------------------------------------------------------------------
// Lab category name normalization
// ---------------------------------------------------------------------------

const LAB_CATEGORY_MAP: Record<string, string> = {
  '血常规': '血常规',
  '全血细胞计数': '血常规',
  '血细胞分析': '血常规',
  '肝功能': '肝功能',
  '肝功': '肝功能',
  '肝脏功能': '肝功能',
  '肾功能': '肾功能',
  '肾功': '肾功能',
  '肾脏功能': '肾功能',
  '电解质': '电解质',
  '血糖': '血糖',
  '血糖与炎症': '血糖',
  '蛋白质': '蛋白质',
  '蛋白质与营养': '蛋白质',
  '微量元素': '微量元素',
  '血脂': '血脂',
  '血脂四项': '血脂',
  '尿常规': '尿常规',
  '凝血功能': '凝血功能',
  '凝血': '凝血功能',
  '免疫功能': '免疫功能',
  '免疫': '免疫功能',
  '甲状腺功能': '甲状腺功能',
  '甲功': '甲状腺功能',
};

// ---------------------------------------------------------------------------
// Value normalization
// ---------------------------------------------------------------------------

function normalizeAge(key: string, value: unknown): unknown {
  if (typeof key !== 'string' || !key.includes('年龄')) return value;
  if (typeof value === 'number') return value;
  const s = String(value ?? '').trim();
  const match = s.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : value;
}

function normalizeDateTime(key: string, value: unknown): unknown {
  if (typeof key !== 'string') return value;
  if (!key.includes('时间') && !key.includes('日期')) return value;
  const s = String(value ?? '').trim();
  if (!s) return value;

  // Already YYYY-MM-DD or YYYY-MM-DD HH:mm:ss
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s;

  // YYYY年MM月DD日 → YYYY-MM-DD
  const cnFull = s.match(/(\d{4})年(\d{1,2})月(\d{1,2})日?\s*(\d{1,2}:\d{2}:\d{2})?/);
  if (cnFull) {
    const base = `${cnFull[1]}-${cnFull[2].padStart(2, '0')}-${cnFull[3].padStart(2, '0')}`;
    return cnFull[4] ? `${base} ${cnFull[4]}` : base;
  }

  // YYYY/MM/DD or YYYY.MM.DD
  const sepMatch = s.match(/(\d{4})[\/.](\d{1,2})[\/.](\d{1,2})\s*(\d{1,2}:\d{2}:\d{2})?/);
  if (sepMatch) {
    const base = `${sepMatch[1]}-${sepMatch[2].padStart(2, '0')}-${sepMatch[3].padStart(2, '0')}`;
    return sepMatch[4] ? `${base} ${sepMatch[4]}` : base;
  }

  // DD/MM/YYYY or DD-MM-YYYY (reverse order)
  const reverseMatch = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (reverseMatch) {
    return `${reverseMatch[3]}-${reverseMatch[2].padStart(2, '0')}-${reverseMatch[1].padStart(2, '0')}`;
  }

  return value;
}

// ---------------------------------------------------------------------------
// Array-of-objects protection (e.g. pathology reports)
// ---------------------------------------------------------------------------

/**
 * Detect if an array contains complex objects that should be preserved
 * as a structured block rather than join_comma flattened.
 * Returns the original array if it looks like structured records,
 * otherwise returns undefined (let normal processing continue).
 */
function protectStructuredArray(key: string, value: unknown[]): unknown[] | undefined {
  // Known structured array keys
  if ((key.includes('病理') || key.includes('手术') || key.includes('诊断')) && Array.isArray(value)) {
    if (value.length > 0 && typeof value[0] === 'object' && value[0] !== null && !Array.isArray(value[0])) {
      const keys = Object.keys(value[0] as Record<string, unknown>);
      // If objects have 3+ keys, they are structured records
      if (keys.length >= 3) {
        return value;
      }
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Main: normalize a single PerFileResult's data
// ---------------------------------------------------------------------------

/**
 * Apply post-extraction normalization to a PerFileResult's data.
 * Mutates the data object in place and returns it.
 * Detects flat vs nested structure and dispatches accordingly.
 */
export function normalizePostExtraction(result: PerFileResult): PerFileResult {
  if (!result.success || !result.data) return result;

  result.data = isDataFlat(result.data) ? normalizeFlatData(result.data) : normalizeDataObject(result.data);
  return result;
}

/**
 * Check if extracted data is completely flat (no nested objects or arrays).
 */
function isDataFlat(data: Record<string, unknown>): boolean {
  for (const val of Object.values(data)) {
    if (val !== null && typeof val === 'object') return false;
  }
  return true;
}

/**
 * Normalize a flat data object (all values are primitives).
 * Handles flat keys like "血常规-白细胞 (WBC)" or "诊断-出院诊断".
 */
function normalizeFlatData(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(obj)) {
    const normalizedKey = normalizeFlatKey(key);

    // Normalize primitive values (age, dates)
    result[normalizedKey] = normalizePrimitiveValue(normalizedKey, val);
  }

  return result;
}

/**
 * Normalize a flat key (e.g. "血常规-白细胞 (WBC)" or "诊断-出院诊断" or "患者姓名").
 * 1. Extract module prefix (before first `-`) and normalize via PATH_PREFIX_MAP
 * 2. Extract indicator name (after first `-`) and normalize via TUMOR_MARKER_MAP / KEY_ALIASES
 * 3. Preserve `诊断-` and `病理描述-` prefixes as-is (only normalize the sub-key)
 */
function normalizeFlatKey(key: string): string {
  const dashIdx = key.indexOf('-');
  if (dashIdx === -1) {
    return KEY_ALIASES[key] || key;
  }

  const prefix = key.substring(0, dashIdx);
  const subKey = key.substring(dashIdx + 1);

  // Preserve special prefixes — only normalize sub-key via alias
  if (prefix === '诊断' || prefix === '病理描述') {
    return `${prefix}-${KEY_ALIASES[subKey] || subKey}`;
  }

  // Normalize module prefix
  const normalizedPrefix = PATH_PREFIX_MAP[prefix] || prefix;

  // Normalize indicator name: strip parenthetical, check maps, re-append if changed
  const parenMatch = subKey.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  const baseName = parenMatch ? parenMatch[1].trim() : subKey;
  const abbr = parenMatch ? parenMatch[2] : null;
  const mappedBase = TUMOR_MARKER_MAP[baseName] || KEY_ALIASES[baseName];
  const normalizedSub = mappedBase
    ? (abbr ? `${mappedBase} (${abbr})` : mappedBase)
    : subKey;

  return `${normalizedPrefix}-${normalizedSub}`;
}

/**
 * Normalize a data object recursively.
 * - Normalizes path prefixes and key aliases
 * - Normalizes values (age, dates)
 * - Normalizes lab indicator names
 * - Protects structured arrays
 */
function normalizeDataObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  // First pass: normalize top-level keys with prefix mapping
  for (const [key, val] of Object.entries(obj)) {
    const normalizedKey = normalizePathPrefix(key);
    result[normalizedKey] = processValue(normalizedKey, val);
  }

  return result;
}

/**
 * Process a value: recurse into objects, normalize primitives, protect arrays.
 */
function processValue(parentKey: string, val: unknown): unknown {
  if (val == null) return val;

  // Array handling
  if (Array.isArray(val)) {
    const protected_ = protectStructuredArray(parentKey, val);
    if (protected_) return protected_;

    // Array of strings/numbers → keep as-is (will be join_comma by schema)
    return val.map((item) => {
      if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
        return normalizeNestedObject(item as Record<string, unknown>);
      }
      return item;
    });
  }

  // Object handling
  if (typeof val === 'object' && !Array.isArray(val)) {
    return normalizeNestedObject(val as Record<string, unknown>);
  }

  // Primitive value normalization
  return normalizePrimitiveValue(parentKey, val);
}

/**
 * Normalize a nested object (e.g. 患者信息, 血常规).
 * Applies key alias normalization and value normalization.
 */
function normalizeNestedObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  // Check if this is a lab category with indicators (sub-objects containing value/unit)
  const isLabCategory = isLabCategoryObject(obj);

  for (const [key, val] of Object.entries(obj)) {
    // Normalize the key
    let normalizedKey = KEY_ALIASES[key] || key;

    // For lab categories, normalize indicator names
    if (isLabCategory && typeof val === 'object' && val !== null && !Array.isArray(val)) {
      normalizedKey = normalizeIndicatorName(normalizedKey);
    }

    // Recurse
    result[normalizedKey] = processValue(normalizedKey, val);
  }

  return result;
}

/**
 * Check if an object looks like a lab category (contains measurement sub-objects).
 */
function isLabCategoryObject(obj: Record<string, unknown>): boolean {
  let measurementCount = 0;
  for (const val of Object.values(obj)) {
    if (typeof val === 'object' && val !== null && !Array.isArray(val) && 'value' in val) {
      measurementCount++;
    }
  }
  return measurementCount >= 2;
}

/**
 * Normalize a primitive value based on its key.
 */
function normalizePrimitiveValue(key: string, val: unknown): unknown {
  // Skip non-string values for most normalizations
  // (but allow number→string conversions for specific fields)

  // Age normalization: always return a number
  const ageNormalized = normalizeAge(key, val);
  if (ageNormalized !== val) return ageNormalized;

  // Date/time normalization
  const dateNormalized = normalizeDateTime(key, val);
  if (dateNormalized !== val) return dateNormalized;

  return val;
}

// ---------------------------------------------------------------------------
// Batch normalization
// ---------------------------------------------------------------------------

/**
 * Normalize all PerFileResults in an array.
 */
export function normalizeAllResults(results: PerFileResult[]): PerFileResult[] {
  return results.map(normalizePostExtraction);
}
