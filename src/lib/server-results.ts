import { writeFile, readFile, mkdir, readdir } from 'fs/promises'
import { join } from 'path'
import { getTempDir } from '@/lib/temp-dir'

// ─── Types ────────────────────────────────────────────────────────────────

interface StoredResult {
  fileId: string
  fileName: string
  groupId: string
  success: boolean
  data?: Record<string, unknown>
  entries?: Array<Record<string, unknown>>
  headerData?: Record<string, unknown>
  error?: string
}

interface GroupManifestEntry {
  groupId: string
  groupKey: string
  fileCount: number
  fileIds: string[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────

async function ensureResultsDir(sessionId: string): Promise<string> {
  const dir = join(getTempDir(), sessionId, 'results')
  await mkdir(dir, { recursive: true })
  return dir
}

// ─── Write ───────────────────────────────────────────────────────────────

/** Write a single file's extraction result to disk (without imageDataUrl). */
export async function writeResult(
  sessionId: string,
  result: StoredResult,
): Promise<void> {
  const dir = await ensureResultsDir(sessionId)
  await writeFile(
    join(dir, `${result.fileId}.json`),
    JSON.stringify(result),
    'utf-8',
  )
}

/** Write groups manifest for a session, merging with any existing entries. */
export async function writeGroupsManifest(
  sessionId: string,
  groups: GroupManifestEntry[],
): Promise<void> {
  const dir = await ensureResultsDir(sessionId)
  // Merge with existing manifest to avoid overwriting groups from previous batches
  const existing = await readGroupsManifest(sessionId)
  if (existing && existing.length > 0) {
    const existingMap = new Map(existing.map((g) => [g.groupId, g]))
    for (const g of groups) {
      const prev = existingMap.get(g.groupId)
      if (prev) {
        // Accumulate fileCount and fileIds for groups split across batches
        prev.fileCount += g.fileCount
        prev.fileIds.push(...g.fileIds)
      } else {
        existing.push(g)
        existingMap.set(g.groupId, g)
      }
    }
    await writeFile(join(dir, '_groups.json'), JSON.stringify(existing), 'utf-8')
  } else {
    await writeFile(join(dir, '_groups.json'), JSON.stringify(groups), 'utf-8')
  }
}

// ─── Read ────────────────────────────────────────────────────────────────

/** Read a single file's extraction result from disk. */
export async function readResult(
  sessionId: string,
  fileId: string,
): Promise<StoredResult | null> {
  try {
    const content = await readFile(
      join(getTempDir(), sessionId, 'results', `${fileId}.json`),
      'utf-8',
    )
    return JSON.parse(content)
  } catch {
    return null
  }
}

/** Check if a cached result exists and is successful. Returns the StoredResult or null. */
export async function resultExists(
  sessionId: string,
  fileId: string,
): Promise<StoredResult | null> {
  try {
    const content = await readFile(
      join(getTempDir(), sessionId, 'results', `${fileId}.json`),
      'utf-8',
    )
    const parsed: StoredResult = JSON.parse(content)
    if (parsed.success) return parsed
    return null
  } catch {
    return null
  }
}

/** Read all results for a specific group from disk. */
export async function readGroupResults(
  sessionId: string,
  fileIds: string[],
): Promise<StoredResult[]> {
  const results: StoredResult[] = []
  for (const fileId of fileIds) {
    const result = await readResult(sessionId, fileId)
    if (result) results.push(result)
  }
  return results
}

/** Read all results for a session (backward compat / test script). */
export async function readAllResults(
  sessionId: string,
): Promise<StoredResult[]> {
  try {
    const dir = join(getTempDir(), sessionId, 'results')
    const files = await readdir(dir)
    const results: StoredResult[] = []
    for (const file of files) {
      if (!file.endsWith('.json') || file.startsWith('_')) continue
      try {
        const content = await readFile(join(dir, file), 'utf-8')
        results.push(JSON.parse(content))
      } catch { /* skip corrupted */ }
    }
    return results
  } catch {
    return []
  }
}

/** Read groups manifest for a session. */
export async function readGroupsManifest(
  sessionId: string,
): Promise<GroupManifestEntry[] | null> {
  try {
    const content = await readFile(
      join(getTempDir(), sessionId, 'results', '_groups.json'),
      'utf-8',
    )
    return JSON.parse(content)
  } catch {
    return null
  }
}
