import { NextResponse } from 'next/server'

/** Return server-side default API settings from .env (apiKey masked) */
export async function GET() {
  const baseUrl = (process.env.API_BASE_URL || '').trim()
  const apiKey = (process.env.API_KEY || '').trim()
  const model = (process.env.API_MODEL || '').trim()
  const concurrency = Number(process.env.MERGE_CONCURRENCY) || 3
  const cacheExpiryHours = Number(process.env.CACHE_EXPIRY_HOURS) || 24

  return NextResponse.json({
    baseUrl,
    apiKey: apiKey ? apiKey.slice(0, 4) + '***' : '',
    apiKeySet: apiKey.length > 0,
    model,
    concurrency,
    cacheExpiryHours,
  })
}
