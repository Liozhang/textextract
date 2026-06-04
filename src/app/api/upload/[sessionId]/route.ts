import { NextRequest } from 'next/server'
import { rm } from 'fs/promises'
import { join } from 'path'
import { existsSync, readdirSync } from 'fs'
import { getTempDir } from '@/lib/temp-dir'

/** Check if a session directory exists and list its files */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const { sessionId } = await params
    if (!sessionId) {
      return new Response(JSON.stringify({ error: '缺少 sessionId' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (sessionId.includes('..') || sessionId.includes('/') || sessionId.includes('\\')) {
      return new Response(JSON.stringify({ error: '无效的 sessionId' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const sessionDir = join(getTempDir(), sessionId)
    if (!existsSync(sessionDir)) {
      return new Response(JSON.stringify({ exists: false, files: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const fileNames = readdirSync(sessionDir)
      .filter((n) => n !== '_meta.json')
    return new Response(JSON.stringify({ exists: true, files: fileNames }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : '检查失败'
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const { sessionId } = await params
    if (!sessionId) {
      return new Response(JSON.stringify({ error: '缺少 sessionId' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Prevent path traversal
    if (sessionId.includes('..') || sessionId.includes('/') || sessionId.includes('\\')) {
      return new Response(JSON.stringify({ error: '无效的 sessionId' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const sessionDir = join(getTempDir(), sessionId)

    if (!existsSync(sessionDir)) {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    await rm(sessionDir, { recursive: true, force: true })

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : '清理失败'
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }
}
