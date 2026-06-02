import type { PerFileResult, AlignedPerFileResult, FieldPathInfo, FlattenedSchema, FlattenRule } from './types';

// ---------------------------------------------------------------------------
// Collect field paths from extraction results
// ---------------------------------------------------------------------------

/**
 * Recursively walk all successful PerFileResult.data objects and collect
 * dot-separated paths with type, count, and sample values.
 */
export function collectFieldPaths(results: PerFileResult[]): FieldPathInfo[] {
  const pathMap = new Map<string, { count: number; samples: unknown[]; type: FieldPathInfo['type'] }>();

  for (const r of results) {
    if (!r.success || !r.data) continue;
    walkPaths(r.data, '', pathMap);
  }

  return Array.from(pathMap.entries()).map(([path, info]) => ({
    path,
    count: info.count,
    sampleValues: info.samples.slice(0, 3),
    type: info.type,
  }));
}

function walkPaths(
  obj: Record<string, unknown>,
  prefix: string,
  pathMap: Map<string, { count: number; samples: unknown[]; type: FieldPathInfo['type'] }>,
): void {
  for (const [key, val] of Object.entries(obj)) {
    const fullPath = prefix ? `${prefix}.${key}` : key;

    if (val == null) continue;

    const valueType = detectType(val);

    if (valueType === 'object') {
      // Recurse into nested object
      walkPaths(val as Record<string, unknown>, fullPath, pathMap);
    } else {
      const entry = pathMap.get(fullPath) || { count: 0, samples: [] as unknown[], type: valueType };
      entry.count++;
      // Detect type conflicts and downgrade to 'other'
      if (entry.type !== valueType) {
        entry.type = 'other';
      }
      if (entry.samples.length < 3) {
        const sv = serializeSample(val);
        if (typeof sv === 'string' && sv.length <= 80) entry.samples.push(sv);
        else if (typeof sv !== 'string') entry.samples.push(sv);
      }
      pathMap.set(fullPath, entry);
    }
  }
}

function detectType(val: unknown): FieldPathInfo['type'] {
  if (typeof val === 'string') return 'string';
  if (typeof val === 'number') return 'number';
  if (typeof val === 'boolean') return 'boolean';
  if (Array.isArray(val)) return 'array';
  if (typeof val === 'object' && val !== null) {
    if ('value' in val && 'unit' in val) return 'measurement';
    return 'object';
  }
  return 'other';
}

function serializeSample(val: unknown): unknown {
  if (typeof val === 'string' && val.length <= 80) return val;
  if (typeof val === 'number') return val;
  if (typeof val === 'boolean') return val;
  if (Array.isArray(val)) {
    const items = val.slice(0, 2).map(String);
    return items.length === 1 ? items[0] : items;
  }
  if (typeof val === 'object' && val !== null && 'value' in val) {
    return val;
  }
  return String(val).slice(0, 80);
}

// ---------------------------------------------------------------------------
// Apply flattened schema to a single PerFileResult
// ---------------------------------------------------------------------------

/**
 * Flatten a single PerFileResult using the schema.
 * Recursively walks data to produce (dot_path, value) pairs,
 * then maps each to its canonical name via field_mapping
 * and flattens the value via flatten_rules.
 */
export function applyFlattenedSchema(
  result: PerFileResult,
  schema: FlattenedSchema,
): AlignedPerFileResult {
  if (!result.success || !result.data) {
    return {
      fileId: result.fileId,
      fileName: result.fileName,
      groupId: result.groupId,
      success: false,
      error: result.error,
      imageDataUrl: result.imageDataUrl,
    };
  }

  // Collect all (path, value) pairs
  const pairs: Array<[string, unknown]> = [];
  collectLeafPairs(result.data, '', pairs);

  // Collect all values per canonical name, pick the longest non-empty
  const candidates = new Map<string, string[]>();
  for (const [path, val] of pairs) {
    const canonicalName = schema.field_mapping[path] || path;
    const rule = schema.flatten_rules[path] || 'leaf';
    const flatValue = flattenValue(val, rule);
    const existing = candidates.get(canonicalName) || [];
    existing.push(flatValue);
    candidates.set(canonicalName, existing);
  }

  const flatData: Record<string, string> = {};
  for (const [name, values] of candidates) {
    const best = values.filter((v) => v).sort((a, b) => b.length - a.length)[0] || '';
    flatData[name] = best;
  }

  return {
    fileId: result.fileId,
    fileName: result.fileName,
    groupId: result.groupId,
    success: true,
    data: flatData,
    imageDataUrl: result.imageDataUrl,
    rawData: result.data,
  };
}

function collectLeafPairs(
  obj: Record<string, unknown>,
  prefix: string,
  pairs: Array<[string, unknown]>,
): void {
  for (const [key, val] of Object.entries(obj)) {
    const fullPath = prefix ? `${prefix}.${key}` : key;
    if (val == null) continue;

    if (typeof val === 'object' && !Array.isArray(val)) {
      // measurement objects are leaf values
      if (typeof val === 'object' && val !== null && 'value' in val && 'unit' in val) {
        pairs.push([fullPath, val]);
      } else {
        collectLeafPairs(val as Record<string, unknown>, fullPath, pairs);
      }
    } else {
      pairs.push([fullPath, val]);
    }
  }
}

function flattenValue(val: unknown, rule: FlattenRule): string {
  if (val == null) return '';

  switch (rule) {
    case 'measurement': {
      if (typeof val === 'object' && val !== null && 'value' in val && 'unit' in val) {
        const m = val as { value: unknown; unit: string };
        return `${m.value} ${m.unit}`.trim();
      }
      return String(val);
    }

    case 'join_comma': {
      if (Array.isArray(val)) {
        return val.map((v) => (v != null ? String(v) : '')).filter(Boolean).join(', ');
      }
      return String(val);
    }

    case 'json_stringify':
      return JSON.stringify(val);

    case 'leaf':
    default:
      if (typeof val === 'object' && !Array.isArray(val) && val !== null && 'value' in val && 'unit' in val) {
        const m = val as { value: unknown; unit: string };
        return `${m.value} ${m.unit}`.trim();
      }
      if (Array.isArray(val)) {
        return val.map((v) => (v != null ? String(v) : '')).filter(Boolean).join(', ');
      }
      return String(val);
  }
}

// ---------------------------------------------------------------------------
// Apply schema to all results
// ---------------------------------------------------------------------------

export function applyFlattenedSchemaToResults(
  results: PerFileResult[],
  schema: FlattenedSchema,
): AlignedPerFileResult[] {
  return results.map((r) => applyFlattenedSchema(r, schema));
}
