import { NextRequest } from 'next/server'
import { writeFile, mkdir, readFile } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'
import { randomUUID } from 'crypto'
import { cleanupExpiredSessions } from '@/lib/server-cleanup'
import { getTempDir } from '@/lib/temp-dir'

export const maxDuration = 60

const MAX_FILE_SIZE = 100 * 1024 * 1024 // 100MB per file
const MAX_TOTAL_SIZE = 2 * 1024 * 1024 * 1024 // 2GB total per chunk

/** Repair double-encoded UTF-8 filenames from multipart/form-data on Windows. */
function repairFilename(name: string): string {
  // Already valid ASCII or already correct → skip
  if (/^[\x00-\x7F]*$/.test(name)) return name
  // Already contains CJK → likely correct
  if (/[\u4e00-\u9fff\u3400-\u4dbf]/.test(name)) return name
  try {
    // Encode current string to UTF-8 bytes, then reinterpret as Latin-1 → UTF-8
    const bytes = new TextEncoder().encode(name)
    const uint8 = new Uint8Array(bytes)
    const repaired = new TextDecoder('utf-8', { fatal: false }).decode(uint8)
    if (repaired !== name && /[\u4e00-\u9fff]/.test(repaired)) return repaired
  } catch { /* ignore */ }
  return name
}

export async function POST(request: NextRequest) {
  // Fire-and-forget: clean up expired temp sessions
  cleanupExpiredSessions()

  try {
    const formData = await request.formData()
    const files: File[] = []

    // Collect all file entries from FormData
    for (const [, value] of formData.entries()) {
      if (value instanceof File) {
        files.push(value)
      }
    }

    if (files.length === 0) {
      return new Response(JSON.stringify({ error: '没有上传文件' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      })
    }

    // Validate total size
    let totalSize = 0
    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        return new Response(JSON.stringify({ error: `文件 ${file.name} 超过 100MB 限制` }), {
          status: 400,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        })
      }
      totalSize += file.size
    }
    if (totalSize > MAX_TOTAL_SIZE) {
      return new Response(JSON.stringify({ error: '总文件大小超过 2GB 限制' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      })
    }

    // Support appending to existing session via X-Session-ID header
    let sessionId = request.headers.get('x-session-id')
    if (sessionId) {
      const existingDir = join(getTempDir(), sessionId)
      if (!existsSync(existingDir)) {
        sessionId = null // Invalid session, create new
      }
    }
    if (!sessionId) {
      sessionId = randomUUID()
    }
    const sessionDir = join(getTempDir(), sessionId)

    // Create session directory
    await mkdir(sessionDir, { recursive: true })

    const savedFiles: Array<{ fileId: string; name: string; size: number; type: string }> = []

    for (const file of files) {
      const fileId = randomUUID()
      const buffer = Buffer.from(await file.arrayBuffer())
      const filePath = join(sessionDir, fileId)
      await writeFile(filePath, buffer)

      savedFiles.push({
        fileId,
        name: repairFilename(file.name),
        size: file.size,
        type: file.type || 'application/octet-stream',
      })
    }

    // Write session metadata for cleanup tracking
    const metaPath = join(sessionDir, '_meta.json')
    let existingMeta: { createdAt?: number; fileCount?: number } = {}
    if (existsSync(metaPath)) {
      try { existingMeta = JSON.parse(await readFile(metaPath, 'utf-8')) } catch {}
    }
    await writeFile(
      metaPath,
      JSON.stringify({
        createdAt: existingMeta.createdAt || Date.now(),
        fileCount: (existingMeta.fileCount || 0) + savedFiles.length,
      }),
    )

    return new Response(
      JSON.stringify({ sessionId, files: savedFiles }),
      { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : '上传失败'
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8' } },
    )
  }
}
