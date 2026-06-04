import { NextRequest } from 'next/server'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'
import { randomUUID } from 'crypto'
import { cleanupExpiredSessions } from '@/lib/server-cleanup'
import { getTempDir } from '@/lib/temp-dir'

export const maxDuration = 60

const MAX_FILE_SIZE = 100 * 1024 * 1024 // 100MB per file
const MAX_TOTAL_SIZE = 2 * 1024 * 1024 * 1024 // 2GB total per chunk

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
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Validate total size
    let totalSize = 0
    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        return new Response(JSON.stringify({ error: `文件 ${file.name} 超过 50MB 限制` }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      totalSize += file.size
    }
    if (totalSize > MAX_TOTAL_SIZE) {
      return new Response(JSON.stringify({ error: '总文件大小超过 500MB 限制' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const sessionId = randomUUID()
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
        name: file.name,
        size: file.size,
        type: file.type || 'application/octet-stream',
      })
    }

    // Write session metadata for cleanup tracking
    await writeFile(
      join(sessionDir, '_meta.json'),
      JSON.stringify({ createdAt: Date.now(), fileCount: savedFiles.length }),
    )

    return new Response(
      JSON.stringify({ sessionId, files: savedFiles }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : '上传失败'
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }
}
