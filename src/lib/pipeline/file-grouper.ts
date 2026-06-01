import type { FileGroup } from './types';

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
 * Group files by filename prefix. Two files belong to the same group
 * if their names share the same prefix after stripping suffixes.
 */
export function groupFilesByPrefix<T extends { id: string; name: string }>(
  files: T[],
): FileGroup[] {
  const groupMap = new Map<string, T[]>();

  for (const file of files) {
    const key = filenameGroupKey(file.name);
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key)!.push(file);
  }

  const groups: FileGroup[] = [];
  let idx = 0;
  for (const [groupKey, groupFiles] of groupMap) {
    groups.push({
      groupId: `group-${idx++}`,
      groupKey,
      files: groupFiles as unknown as FileGroup['files'],
    });
  }

  return groups;
}

/** Find which group a file (by id) belongs to */
export function findGroupForFile(
  fileGroups: FileGroup[],
  fileId: string,
): FileGroup {
  return (
    fileGroups.find((g) => g.files.some((f) => f.id === fileId)) ?? {
      groupId: 'group-unknown',
      groupKey: 'unknown',
      files: [],
    }
  );
}
