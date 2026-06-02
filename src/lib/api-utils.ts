// ---------------------------------------------------------------------------
// Shared utilities for API routes
// ---------------------------------------------------------------------------

// ─── API settings ────────────────────────────────────────────────────────

export interface ApiSettingsResolved {
  baseUrl: string
  apiKey: string
  model: string
  concurrency: number
}

/**
 * Resolve API settings from request body overrides (user-provided) with
 * environment variables as fallback.
 */
export function resolveApiSettings(
  overrides?: { baseUrl?: string; apiKey?: string; model?: string; concurrency?: number } | null,
): ApiSettingsResolved {
  return {
    baseUrl: (overrides?.baseUrl || process.env.API_BASE_URL || '').trim(),
    apiKey: (overrides?.apiKey || process.env.API_KEY || '').trim(),
    model: (overrides?.model || process.env.API_MODEL || '').trim(),
    concurrency: overrides?.concurrency || Number(process.env.MERGE_CONCURRENCY) || 3,
  }
}

// ─── Security: URL validation ────────────────────────────────────────────

const PRIVATE_HOSTS = [
  /^localhost$/i,
  /^127(?:\.\d{1,3}){3}$/,
  /^10(?:\.\d{1,3}){3}$/,
  /^172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}$/,
  /^192\.168(?:\.\d{1,3}){2}$/,
  /^169\.254(?:\.\d{1,3}){2}$/,
  /^0\.0\.0\.0$/,
  /^::1$/,
  /^\[::1\]$/,
]

export function isPrivateHost(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return true
    return PRIVATE_HOSTS.some((re) => re.test(parsed.hostname))
  } catch {
    return true
  }
}

// ─── SSE event formatting ───────────────────────────────────────────────

export function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

// ─── Worker pool for concurrent processing ──────────────────────────────

export async function workerPool<T>(
  items: T[],
  concurrency: number,
  handler: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let nextIndex = 0

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex++
      await handler(items[index], index)
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  await Promise.all(workers)
}
