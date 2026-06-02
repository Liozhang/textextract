// ---------------------------------------------------------------------------
// Shared helpers for LLM model compatibility
// ---------------------------------------------------------------------------

/** Check if a model name indicates a reasoning model (requires reasoning_effort param) */
export function isReasoningModel(model: string): boolean {
  const lower = model.toLowerCase()
  return /^(o[1-9]|o4-|deepseek-r|claude)/.test(lower)
}

/** Check if a model supports `response_format: { type: 'json_object' }` */
export function supportsJsonResponseFormat(model: string): boolean {
  const lower = model.toLowerCase()
  // OpenAI o-series does not support response_format json_object
  if (/^o[1-9]/.test(lower) || /^o4-/.test(lower)) return false
  return true
}
