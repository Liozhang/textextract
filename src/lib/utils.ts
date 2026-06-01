import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ---------------------------------------------------------------------------
// Unique ID generation
// ---------------------------------------------------------------------------

/** Generate a cryptographically random unique ID (RFC 4122 v4). */
export function generateId(): string {
  return crypto.randomUUID();
}

// ---------------------------------------------------------------------------
// File size formatting
// ---------------------------------------------------------------------------

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB'] as const;

/** Format a byte count into a human-readable string (e.g. "3.2 MB"). */
export function formatFileSize(bytes: number): string {
  if (bytes < 0) bytes = 0;
  if (bytes === 0) return '0 B';

  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    SIZE_UNITS.length - 1,
  );
  const value = bytes / Math.pow(1024, i);

  // Show integer when >= 1, otherwise show one decimal
  const formatted = value >= 10 ? Math.round(value).toString() : value.toFixed(1);
  return `${formatted} ${SIZE_UNITS[i]}`;
}

// ---------------------------------------------------------------------------
// Text utilities
// ---------------------------------------------------------------------------

/** Truncate text to `maxLength` and append an ellipsis when shortened. */
export function truncateText(text: string, maxLength: number): string {
  if (maxLength < 0) maxLength = 0;
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '…';
}

/** Remove characters that are unsafe for filenames. */
export function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[/\\?%*:|"<>]/g, '') // remove unsafe chars
    .replace(/\s+/g, '_')          // collapse whitespace
    .replace(/_{2,}/g, '_')         // collapse underscores
    .replace(/^_|_$/g, '');          // trim leading/trailing underscores
}

// ---------------------------------------------------------------------------
// Export helpers – flatten nested data for spreadsheets
// ---------------------------------------------------------------------------

/**
 * Flatten an array of objects into { headers, rows } suitable for
 * spreadsheet export (XLSX / CSV).
 *
 * - Nested objects are expanded into dotted-column headers
 *   (e.g. `{ address: { city: "NYC" } }` → header `"address.city"`)
 * - Array values create additional rows (one per element)
 * - The final set of headers is the sorted union of every key encountered
 */
export function buildSheetData(
  data: Record<string, unknown>[],
): { headers: string[]; rows: string[][] } {
  if (data.length === 0) return { headers: [], rows: [] };

  const flatRows: Record<string, unknown>[] = [];

  for (const item of data) {
    const expanded = flattenItem(item);
    flatRows.push(...expanded);
  }

  // Collect the full set of keys, sorted alphabetically
  const headerSet = new Set<string>();
  for (const row of flatRows) {
    for (const key of Object.keys(row)) {
      headerSet.add(key);
    }
  }
  const headers = Array.from(headerSet).sort();

  // Build the 2-D array of string values
  const rows = flatRows.map((row) =>
    headers.map((h) => {
      const val = row[h];
      if (val === undefined || val === null) return '';
      if (typeof val === 'object') return JSON.stringify(val);
      return String(val);
    }),
  );

  return { headers, rows };
}

/**
 * Recursively flatten a single data item. Arrays cause row multiplication.
 */
function flattenItem(
  item: Record<string, unknown>,
  prefix = '',
): Record<string, unknown>[] {
  const entries = Object.entries(item);

  // Check if any value is an array that should be expanded
  const resolved: Array<[string, unknown]> = [];
  for (const [key, value] of entries) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (Array.isArray(value) && value.length > 0 && typeof value[0] !== 'string') {
      // Skip string arrays – they are stored as-is (joined)
      resolved.push([fullKey, value]);
    } else if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'string') {
      resolved.push([fullKey, value.join(', ')]);
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      resolved.push([fullKey, value]);
    } else {
      resolved.push([fullKey, value]);
    }
  }

  // Check for array values that need row multiplication
  const arrayEntries = resolved.filter(
    ([, v]) => Array.isArray(v) && v.length > 0 && typeof (v as unknown[])[0] !== 'string',
  );

  if (arrayEntries.length === 0) {
    // No arrays – produce a single flat row
    const row: Record<string, unknown> = {};
    for (const [key, value] of resolved) {
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        // Recurse into nested object
        const nested = flattenObject(value as Record<string, unknown>, key);
        Object.assign(row, nested);
      } else {
        row[key] = value;
      }
    }
    return [row];
  }

  // Pick the first array entry to multiply rows by
  const [arrayKey, arrayVal] = arrayEntries[0];
  const elements = arrayVal as unknown[];

  const result: Record<string, unknown>[] = [];
  for (const element of elements) {
    // Replace the array key with the current element, then re-flatten
    const newItem = { ...item };
    // Find original key (without prefix) to replace
    const origKey = arrayKey.startsWith(`${prefix}.`) ? arrayKey.slice(prefix.length + 1) : arrayKey;
    newItem[origKey] = element;
    const subRows = flattenItem(newItem, prefix);
    result.push(...subRows);
  }

  return result;
}

/** Flatten a plain object (no arrays) with dotted keys. */
function flattenObject(
  obj: Record<string, unknown>,
  prefix: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = `${prefix}.${key}`;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(out, flattenObject(value as Record<string, unknown>, fullKey));
    } else if (Array.isArray(value)) {
      out[fullKey] = value.join(', ');
    } else {
      out[fullKey] = value;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Data URL validation
// ---------------------------------------------------------------------------

/** Validate that a string looks like a well-formed data URL. */
export function isValidDataUrl(url: string): boolean {
  return /^data:[a-z+\-]+(\/[a-z+\-]+)?(;[\w=]+)*;base64,[A-Za-z0-9+/=]+$/.test(url);
}

// ---------------------------------------------------------------------------
// Async utilities
// ---------------------------------------------------------------------------

/** Promise-based delay. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
