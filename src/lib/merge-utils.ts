import type { ExtractionResultItem } from './store';

// ---------------------------------------------------------------------------
// File-name prefix grouping
// ---------------------------------------------------------------------------

/**
 * Extract a grouping key from a filename by:
 * 1. Removing extension
 * 2. Removing trailing digits, separators (-_.), and sequences like (1), _copy
 * 3. Using the remaining prefix as the group key
 */
function filenameGroupKey(fileName: string): string {
  let name = fileName.replace(/\.[^.]+$/, ''); // strip extension
  // Remove trailing patterns: (1), _copy, -001, _2, etc.
  name = name.replace(/[\s\-_.]*[\[(]?\d+[\])]?\s*$/, '');
  name = name.replace(/[\s\-_.]*copy\s*$/i, '');
  name = name.replace(/[\s\-_]+$/, '');
  return name || fileName;
}

/**
 * Group results by filename prefix. Two files belong to the same group
 * if their names share the same prefix after stripping suffixes.
 */
export function mergeByFilename(
  results: ExtractionResultItem[],
  options?: { fallbackLabel?: string; strategy?: MergeStrategy },
): MergeReport {
  const strategy = options?.strategy ?? 'first_wins';
  const successful = results.filter((r) => r.success && r.data);
  if (successful.length < 2) {
    return { groups: [], unmerged: results, mergedCount: 0, mergeKeys: { patients: [], dates: [] } };
  }

  // Build groups by filename prefix
  const groupMap = new Map<string, ExtractionResultItem[]>();
  for (const r of successful) {
    const key = filenameGroupKey(r.fileName);
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key)!.push(r);
  }

  // Only keep groups with 2+ files
  const mergeGroups: MergeGroup[] = [];
  const mergedFileIds = new Set<string>();

  for (const [prefix, items] of groupMap) {
    if (items.length < 2) continue;
    for (const item of items) mergedFileIds.add(item.fileId);

    const mergedData: Record<string, unknown> = { ...items[0].data };
    const mergedRegions: Record<string, { x: number; y: number; width: number; height: number }> = {
      ...(items[0].regions || {}),
    };
    const fileNames: string[] = [items[0].fileName];

    for (let i = 1; i < items.length; i++) {
      if (items[i].data) {
        for (const [key, val] of Object.entries(items[i].data!)) {
          const v = val != null ? String(val).trim() : '';
          const current = mergedData[key] != null ? String(mergedData[key]).trim() : '';
          const shouldOverwrite =
            strategy === 'latest_wins' ? v !== '' :
            strategy === 'longest_wins' ? v.length > current.length :
            v !== '' && current === '';
          if (shouldOverwrite) mergedData[key] = val;
        }
      }
      if (items[i].regions) Object.assign(mergedRegions, items[i].regions);
      fileNames.push(items[i].fileName);
    }

    const imageResult = items.find((item) => item.imageDataUrl);

    // Compute per-field consistency
    const fieldConsistency: Record<string, boolean> = {};
    const allKeys = new Set(items.flatMap((item) => Object.keys(item.data || {})));
    for (const key of allKeys) {
      const values = items
        .map((item) => item.data?.[key])
        .filter((v) => v != null && String(v).trim() !== '')
        .map((v) => String(v).trim());
      fieldConsistency[key] = values.length <= 1 || values.every((v) => v === values[0]);
    }

    mergeGroups.push({
      label: prefix,
      fileNames,
      data: mergedData,
      regions: mergedRegions,
      imageDataUrl: imageResult?.imageDataUrl,
      fileId: `merged-${mergeGroups.length}`,
      fieldConsistency,
    });
  }

  const unmerged = results.filter((r) => !mergedFileIds.has(r.fileId));
  return { groups: mergeGroups, unmerged, mergedCount: mergedFileIds.size, mergeKeys: { patients: [], dates: [] } };
}

// ---------------------------------------------------------------------------
// Heuristic field name matchers
// ---------------------------------------------------------------------------

/** Field names that likely identify a patient/person. */
const PATIENT_KEY_PATTERNS = [
  /姓名/,
  /患者姓名/,
  /病人姓名/,
  /患者/,
  /病人/,
  /受试者编号/,
  /受试者/,
  /住院号/,
  /病历号/,
  /门诊号/,
  /就诊卡号/,
  /身份证号/,
  /床号/,
  /住院次数/,
  /医保号/,
  /patient/i,
  /name/i,
  /subject.*id/i,
  /pid/i,
  /mrn/i,
];

/** Field names that likely represent a date. */
const DATE_KEY_PATTERNS = [
  /日期/,
  /入院日期/,
  /出院日期/,
  /检查日期/,
  /报告日期/,
  /开票日期/,
  /签订日期/,
  /入组日期/,
  /门诊日期/,
  /手术日期/,
  /出生日期/,
  /date/i,
  /时间/,
];

function matchesAny(key: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(key));
}

/**
 * Try to find a patient identifier value and a date value from the extracted data.
 * Returns null if neither can be confidently identified.
 */
function detectMergeKeys(
  data: Record<string, unknown>,
): { patientKey: string; patientValue: string; dateKey: string; dateValue: string } | null {
  const keys = Object.keys(data);

  // Find patient identifier fields
  const patientCandidates = keys.filter((k) => matchesAny(k, PATIENT_KEY_PATTERNS));
  // Find date fields
  const dateCandidates = keys.filter((k) => matchesAny(k, DATE_KEY_PATTERNS));

  if (patientCandidates.length === 0 && dateCandidates.length === 0) return null;

  // Pick the first patient field that has a value
  let patientKey = '';
  let patientValue = '';
  for (const k of patientCandidates) {
    const v = data[k];
    if (v != null && String(v).trim()) {
      patientKey = k;
      patientValue = String(v).trim();
      break;
    }
  }

  // Pick the first date field that has a value
  let dateKey = '';
  let dateValue = '';
  for (const k of dateCandidates) {
    const v = data[k];
    if (v != null && String(v).trim()) {
      dateKey = k;
      dateValue = String(v).trim();
      break;
    }
  }

  if (!patientValue && !dateValue) return null;

  return { patientKey, patientValue, dateKey, dateValue };
}

// ---------------------------------------------------------------------------
// Merge logic
// ---------------------------------------------------------------------------

export type MergeStrategy = 'first_wins' | 'latest_wins' | 'longest_wins';

export interface MergeGroup {
  /** Display label: e.g. "张三 - 2024-01-15" */
  label: string;
  /** Files that were merged */
  fileNames: string[];
  /** Merged data (later records' fields overwrite earlier ones; non-overlapping fields are combined) */
  data: Record<string, unknown>;
  /** Combined regions from all merged files */
  regions: Record<string, { x: number; y: number; width: number; height: number }>;
  /** The imageDataUrl from the first file that has one */
  imageDataUrl?: string;
  fileId: string; // synthetic ID
  /** Per-field consistency: true = all source files agree, false = conflicting values */
  fieldConsistency?: Record<string, boolean>;
}

export interface MergeReport {
  /** Merged groups */
  groups: MergeGroup[];
  /** Records that could not be merged (no patient/date match or singletons) */
  unmerged: ExtractionResultItem[];
  /** How many original records were merged into groups */
  mergedCount: number;
  /** Which fields were used as merge keys */
  mergeKeys: { patients: string[]; dates: string[] };
}

/**
 * Auto-detect patient/date fields and merge records that match on both.
 * Only successful results with data are considered.
 */
export function mergeByPatientAndDate(
  results: ExtractionResultItem[],
  options?: { fallbackLabel?: string; strategy?: MergeStrategy },
): MergeReport {
  const strategy = options?.strategy ?? 'first_wins';
  const successful = results.filter((r) => r.success && r.data);
  if (successful.length < 2) {
    return {
      groups: [],
      unmerged: results,
      mergedCount: 0,
      mergeKeys: { patients: [], dates: [] },
    };
  }

  // Detect merge keys from first result that has candidates
  const patientKeySet = new Set<string>();
  const dateKeySet = new Set<string>();

  // Build merge key signatures for each result
  interface Signature {
    result: ExtractionResultItem;
    patientValue: string;
    dateValue: string;
    patientKey: string;
    dateKey: string;
  }

  const signatures: Signature[] = [];

  for (const r of successful) {
    const keys = detectMergeKeys(r.data!);
    if (keys) {
      if (keys.patientKey) patientKeySet.add(keys.patientKey);
      if (keys.dateKey) dateKeySet.add(keys.dateKey);
      signatures.push({
        result: r,
        patientValue: keys.patientValue,
        dateValue: keys.dateValue,
        patientKey: keys.patientKey,
        dateKey: keys.dateKey,
      });
    }
  }

  // If no signatures found, nothing to merge
  if (signatures.length === 0) {
    return {
      groups: [],
      unmerged: results,
      mergedCount: 0,
      mergeKeys: { patients: [], dates: [] },
    };
  }

  // Group by patient value — same person merges into one row
  // Records with no patient identifier are grouped by date as fallback
  const groups = new Map<string, Signature[]>();

  for (const sig of signatures) {
    const groupKey = sig.patientValue || `__date__${sig.dateValue}` || '__no_match__';
    if (!groups.has(groupKey)) {
      groups.set(groupKey, []);
    }
    groups.get(groupKey)!.push(sig);
  }

  // Build merge groups (only for groups with 2+ records)
  const mergeGroups: MergeGroup[] = [];
  const mergedFileIds = new Set<string>();

  for (const [, sigs] of groups) {
    if (sigs.length < 2) continue;

    // Mark these records as merged
    for (const s of sigs) {
      mergedFileIds.add(s.result.fileId);
    }

    // Build label: patient name + all dates found in merged records
    const patientName = sigs.find((s) => s.patientValue)?.patientValue;
    const dates = [...new Set(sigs.map((s) => s.dateValue).filter(Boolean))];
    const labelParts: string[] = [];
    if (patientName) labelParts.push(patientName);
    if (dates.length > 0) labelParts.push(dates.join(', '));
    const label = labelParts.join(' - ') || options?.fallbackLabel || 'Merged Records';

    // Merge data: start with first record, overlay subsequent ones
    const mergedData: Record<string, unknown> = { ...sigs[0].result.data };
    const mergedRegions: Record<string, { x: number; y: number; width: number; height: number }> = {
      ...(sigs[0].result.regions || {}),
    };
    const fileNames: string[] = [sigs[0].result.fileName];

    for (let i = 1; i < sigs.length; i++) {
      const s = sigs[i];
      // Merge data according to strategy
      if (s.result.data) {
        for (const [key, val] of Object.entries(s.result.data)) {
          const v = val != null ? String(val).trim() : '';
          const current = mergedData[key] != null ? String(mergedData[key]).trim() : '';
          const shouldOverwrite =
            strategy === 'latest_wins' ? v !== '' :
            strategy === 'longest_wins' ? v.length > current.length :
            /* first_wins */ v !== '' && current === '';
          if (shouldOverwrite) {
            mergedData[key] = val;
          }
        }
      }
      // Merge regions
      if (s.result.regions) {
        Object.assign(mergedRegions, s.result.regions);
      }
      fileNames.push(s.result.fileName);
    }

    // Use imageDataUrl from first result that has one
    const imageResult = sigs.find((s) => s.result.imageDataUrl);

    // Compute per-field consistency across source files
    const fieldConsistency: Record<string, boolean> = {};
    const allKeys = new Set(sigs.flatMap((s) => Object.keys(s.result.data || {})));
    for (const key of allKeys) {
      const values = sigs
        .map((s) => s.result.data?.[key])
        .filter((v) => v != null && String(v).trim() !== '')
        .map((v) => String(v).trim());
      fieldConsistency[key] = values.length <= 1 || values.every((v) => v === values[0]);
    }

    mergeGroups.push({
      label,
      fileNames,
      data: mergedData,
      regions: mergedRegions,
      imageDataUrl: imageResult?.result.imageDataUrl,
      fileId: `merged-${mergeGroups.length}`,
      fieldConsistency,
    });
  }

  // Collect unmerged records
  const unmerged = results.filter((r) => !mergedFileIds.has(r.fileId));

  return {
    groups: mergeGroups,
    unmerged,
    mergedCount: mergedFileIds.size,
    mergeKeys: {
      patients: Array.from(patientKeySet),
      dates: Array.from(dateKeySet),
    },
  };
}