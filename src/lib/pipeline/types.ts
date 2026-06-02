// ---------------------------------------------------------------------------
// File Group (Phase 0 output)
// ---------------------------------------------------------------------------

export interface FileGroup {
  groupId: string;
  groupKey: string; // filename prefix, used as display label
  files: Array<{
    id: string;
    name: string;
    size: number;
    type: string;
    content?: string;
    dataUrl?: string;
  }>;
}

// ---------------------------------------------------------------------------
// Per-file extraction result (Phase 1 output)
// ---------------------------------------------------------------------------

export interface PerFileResult {
  fileId: string;
  fileName: string;
  groupId: string;
  success: boolean;
  data?: Record<string, unknown>;
  imageDataUrl?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Group merged record (Phase 2 output)
// ---------------------------------------------------------------------------

export interface ConflictInfo {
  fieldName: string;
  values: string[];
}

export interface MergedRecord {
  groupId: string;
  groupKey: string;
  data: Record<string, unknown>;
  imageDataUrl?: string;
  sourceFileNames: string[];
  mergedCount: number;
  mergeMethod: 'ai' | 'single';
  conflicts: ConflictInfo[];
}

// ---------------------------------------------------------------------------
// Display row (used in review table and export)
// ---------------------------------------------------------------------------

export interface DisplayRow {
  id: string;
  label: string;
  data: Record<string, unknown>;
  imageDataUrl?: string;
  isMerged: boolean;
  sourceFiles: string[];
  fieldConsistency?: Record<string, boolean>;
  mergeMethod?: string;
}

// ---------------------------------------------------------------------------
// Unified schema (final pipeline output)
// ---------------------------------------------------------------------------

export interface UnifiedSchema {
  headers: string[];
  rows: DisplayRow[];
}

// ---------------------------------------------------------------------------
// Flattened schema (Phase 2 output — AI or static fallback)
// ---------------------------------------------------------------------------

export type FlattenRule = 'leaf' | 'measurement' | 'join_comma' | 'json_stringify';

export interface FlattenedSchema {
  /** Dot-path → canonical flat name (e.g. "检查结果.血常规.白细胞" → "血常规-白细胞(WBC)") */
  field_mapping: Record<string, string>;
  /** Ordered list of unique canonical names */
  field_order: string[];
  /** Dot-path → how to flatten the value */
  flatten_rules: Record<string, FlattenRule>;
}

// ---------------------------------------------------------------------------
// Aligned per-file result (after schema applied, before merge)
// ---------------------------------------------------------------------------

export interface AlignedPerFileResult {
  fileId: string;
  fileName: string;
  groupId: string;
  success: boolean;
  data?: Record<string, string>;       // always flat, always string values
  imageDataUrl?: string;
  error?: string;
  rawData?: Record<string, unknown>;   // original nested data for JSON export
}

// ---------------------------------------------------------------------------
// Field path info (collected from extraction results for schema AI)
// ---------------------------------------------------------------------------

export interface FieldPathInfo {
  path: string;
  count: number;
  sampleValues: unknown[];
  type: 'string' | 'number' | 'boolean' | 'measurement' | 'array' | 'object' | 'other';
}
