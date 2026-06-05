// ---------------------------------------------------------------------------
// IndexedDB session persistence for extraction pipeline resume
// ---------------------------------------------------------------------------

import type { ColumnConstraint } from './store';

export interface SessionData {
  sessionId: string
  status: 'uploading' | 'extracting' | 'extraction_done'
  results: Array<{
    fileId: string
    fileName: string
    groupId: string
    success: boolean
    data?: Record<string, unknown>
    entries?: Array<Record<string, unknown>>
    headerData?: Record<string, unknown>
    error?: string
  }>
  groups: Array<{ groupId: string; groupKey: string; fileCount: number }>
  completedBatches: number
  totalBatches: number
  createdAt: number

  // Resume support (v2+)
  files: Array<{
    id: string
    name: string
    size: number
    type: string
    sessionId: string
    status: string
  }>
  sessionIds: string[]
  templateColumns: ColumnConstraint[] | null
  extractionSnapshot: {
    results: SessionData['results']
    groups: SessionData['groups']
    serverSessionId?: string | null
  } | null
  batchTimings: number[]
}

const DB_NAME = 'message-extract'
const DB_VERSION = 2
const STORE_NAME = 'sessions'

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'sessionId' })
      }
      // v1→v2: no schema migration needed — new fields default to undefined
      // which is handled by consumers (fallback to null/[])
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/** Fill missing v2 fields for sessions created with v1 schema */
function hydrateSession(session: SessionData): SessionData {
  return {
    ...session,
    files: session.files ?? [],
    sessionIds: session.sessionIds ?? [],
    templateColumns: session.templateColumns ?? null,
    extractionSnapshot: session.extractionSnapshot ?? null,
    batchTimings: session.batchTimings ?? [],
  }
}

export async function saveSession(session: SessionData): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(session)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function loadSession(sessionId: string): Promise<SessionData | null> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const request = tx.objectStore(STORE_NAME).get(sessionId)
    request.onsuccess = () => {
      const raw = request.result
      resolve(raw ? hydrateSession(raw) : null)
    }
    request.onerror = () => reject(request.error)
  })
}

export async function clearSession(sessionId: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(sessionId)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/** Get all sessions with status === 'extracting' (interrupted sessions) */
export async function getInterruptedSessions(): Promise<SessionData[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const request = store.getAll()
    request.onsuccess = () => {
      const sessions: SessionData[] = request.result || []
      resolve(
        sessions
          .filter((s) => s.status === 'extracting')
          .map(hydrateSession),
      )
    }
    request.onerror = () => reject(request.error)
  })
}
