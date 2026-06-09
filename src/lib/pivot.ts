/**
 * Pivot transformation: long format → wide format.
 *
 * Converts per-entry rows (one per repeating item) into per-document rows
 * where each unique combination of (prefix, pivotKey) becomes a column.
 *
 * Supports multiple presets — each preset generates its own set of pivoted
 * columns (value columns are auto-computed from remaining repeating cols),
 * and all results are merged into one wide table.
 */

import type { MergedExportRow, ColumnConstraint } from '@/lib/store';

// ─── Types ───────────────────────────────────────────────────────────────

export interface PivotPreset {
  id: string;
  /** Optional prefix column key (e.g., 检验大类) */
  prefixColumn: string | null;
  /** Pivot key column key — unique values form part of column names (e.g., 检验项目) */
  pivotKeyColumn: string;
  /** Value column keys (auto-computed if empty: remaining repeating cols) */
  valueColumns: string[];
}

export interface PivotResult {
  /** Ordered column names: non-repeating first, then pivoted columns */
  columns: string[];
  /** Wide-format rows: one per group (document), plus a _label field for display */
  rows: Array<Record<string, unknown>>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

export function getRepeatingColumns(templateColumns: ColumnConstraint[]): string[] {
  return templateColumns.filter((c) => c.repeating).map((c) => c.key);
}

export function getNonRepeatingColumns(templateColumns: ColumnConstraint[]): string[] {
  return templateColumns.filter((c) => !c.repeating).map((c) => c.key);
}

/** Auto-compute value columns for a preset: all repeating cols minus prefix minus pivotKey. */
export function getAutoValueColumns(
  templateColumns: ColumnConstraint[],
  preset: PivotPreset,
): string[] {
  return getRepeatingColumns(templateColumns).filter(
    (c) => c !== preset.prefixColumn && c !== preset.pivotKeyColumn,
  );
}

function buildColumnName(
  prefixVal: string,
  pivotVal: string,
  valueCol: string,
): string {
  const safePivot = pivotVal || '(empty)';
  if (prefixVal) return `${prefixVal}_${safePivot}_${valueCol}`;
  return `${safePivot}_${valueCol}`;
}

// ─── Core Algorithm ───────────────────────────────────────────────────────

export function pivotLongToWide(
  mergedData: MergedExportRow[],
  templateColumns: ColumnConstraint[],
  presets: PivotPreset[],
): PivotResult {
  const nonRepeatingCols = getNonRepeatingColumns(templateColumns);
  const repeatingCols = getRepeatingColumns(templateColumns);
  const allPivotCols = new Set(repeatingCols);

  // Group rows by groupId
  const groups = new Map<string, MergedExportRow[]>();
  for (const row of mergedData) {
    const key = row.groupId || row.label || `row-${groups.size}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  // Pre-compute value columns for each preset (use explicit list, or auto-compute if empty)
  const presetValueCols = presets.map((p) =>
    p.valueColumns.length > 0
      ? p.valueColumns
      : repeatingCols.filter((c) => c !== p.prefixColumn && c !== p.pivotKeyColumn),
  );

  // First pass: collect all unique pivoted column names across all presets
  const pivotColumnNames: string[] = [];
  const pivotColumnNameSet = new Set<string>();

  for (let pi = 0; pi < presets.length; pi++) {
    const preset = presets[pi];
    const valueColumns = presetValueCols[pi];
    for (const groupRows of groups.values()) {
      for (const row of groupRows) {
        const prefixVal = preset.prefixColumn
          ? String(row.data[preset.prefixColumn] ?? '')
          : '';
        const pivotVal = String(row.data[preset.pivotKeyColumn] ?? '');
        for (const vc of valueColumns) {
          const name = buildColumnName(prefixVal, pivotVal, vc);
          if (!pivotColumnNameSet.has(name)) {
            pivotColumnNameSet.add(name);
            pivotColumnNames.push(name);
          }
        }
      }
    }
  }

  // Second pass: build wide rows
  const wideRows: Array<Record<string, unknown>> = [];

  for (const [groupId, groupRows] of groups) {
    const firstRow = groupRows[0];
    const label = firstRow.label.replace(/ #\d+$/, '');
    const wideRow: Record<string, unknown> = { _label: label };

    // Copy non-repeating columns from first row
    for (const col of nonRepeatingCols) {
      wideRow[col] = firstRow.data[col] ?? null;
    }

    // For each preset, fill pivoted values — dedup by (prefix, pivotKey) per preset
    for (let pi = 0; pi < presets.length; pi++) {
      const preset = presets[pi];
      const valueColumns = presetValueCols[pi];
      const seenKeys = new Set<string>();

      for (const row of groupRows) {
        const prefixVal = preset.prefixColumn
          ? String(row.data[preset.prefixColumn] ?? '')
          : '';
        const pivotVal = String(row.data[preset.pivotKeyColumn] ?? '');

        const dedupKey = `${prefixVal}|${pivotVal}`;
        if (seenKeys.has(dedupKey)) continue;
        seenKeys.add(dedupKey);

        for (const vc of valueColumns) {
          const name = buildColumnName(prefixVal, pivotVal, vc);
          wideRow[name] = row.data[vc] ?? null;
        }
      }
    }

    // Copy non-template keys (first row wins)
    for (const row of groupRows) {
      for (const key of Object.keys(row.data)) {
        if (!nonRepeatingCols.includes(key) && !allPivotCols.has(key)) {
          if (!(key in wideRow)) {
            wideRow[key] = row.data[key];
          }
        }
      }
    }

    // Fill missing pivoted columns with null
    for (const col of pivotColumnNames) {
      if (!(col in wideRow)) wideRow[col] = null;
    }

    wideRows.push(wideRow);
  }

  return {
    columns: [...nonRepeatingCols, ...pivotColumnNames],
    rows: wideRows,
  };
}
