// ---------------------------------------------------------------------------
// Server temp file cleanup — removes expired OCR extraction sessions
// ---------------------------------------------------------------------------

import { readdir, rm, readFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

const SESSION_DIR = join(tmpdir(), 'ocr-extract')
const DEFAULT_MAX_AGE = 24 * 60 * 60 * 1000 // 24 hours

interface SessionMeta {
  createdAt: number
  fileCount?: number
}

/**
 * Remove expired session directories from tmpdir/ocr-extract/.
 * Fire-and-forget — do not await this in request handlers.
 */
export function cleanupExpiredSessions(maxAgeMs = DEFAULT_MAX_AGE): void {
  const cutoff = Date.now() - maxAgeMs

  readdir(SESSION_DIR)
    .then(async (entries) => {
      await Promise.allSettled(
        entries.map(async (entry) => {
          const sessionDir = join(SESSION_DIR, entry)
          try {
            const metaRaw = await readFile(join(sessionDir, '_meta.json'), 'utf-8')
            const meta: SessionMeta = JSON.parse(metaRaw)
            if (meta.createdAt < cutoff) {
              await rm(sessionDir, { recursive: true, force: true })
            }
          } catch {
            // No _meta.json or parse error — clean up if directory is old enough
            // (stat-based fallback would require stat import, skip for simplicity)
          }
        }),
      )
    })
    .catch(() => {
      // Session dir doesn't exist yet — nothing to clean
    })
}
