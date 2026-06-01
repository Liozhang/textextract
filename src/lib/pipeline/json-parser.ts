/**
 * 5-layer JSON parsing fallback strategy.
 * Extracted from route.ts for reuse in merge-agent.ts.
 */
export function parseJsonResponse(text: string): unknown {
  if (!text || !text.trim()) {
    throw new Error('模型返回内容为空');
  }

  const trimmed = text.trim();

  // Layer 1: Direct JSON.parse
  try {
    return JSON.parse(trimmed);
  } catch {
    // continue to next layer
  }

  // Layer 2: Extract JSON from markdown code blocks
  const codeBlockRegex = /```(?:json)?\s*\n?([\s\S]*?)\n?```/;
  const codeBlockMatch = trimmed.match(codeBlockRegex);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch {
      // continue
    }
  }

  // Layer 3: Find JSON object/array using regex
  const objectMatch = trimmed.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    try {
      return JSON.parse(objectMatch[0]);
    } catch {
      let bestMatch = '';
      let depth = 0;
      let start = -1;
      for (let i = 0; i < trimmed.length; i++) {
        if (trimmed[i] === '{') {
          if (depth === 0) start = i;
          depth++;
        } else if (trimmed[i] === '}') {
          depth--;
          if (depth === 0 && start >= 0) {
            const candidate = trimmed.substring(start, i + 1);
            if (candidate.length > bestMatch.length) bestMatch = candidate;
          }
        }
      }
      if (bestMatch) {
        try {
          return JSON.parse(bestMatch);
        } catch {
          // continue
        }
      }
    }
  }

  const arrayMatch = trimmed.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      return JSON.parse(arrayMatch[0]);
    } catch {
      // continue
    }
  }

  // Layer 4: Split by commas/semicolons and try to parse segments
  const segments = trimmed
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const seg of segments) {
    for (const wrapper of ['{', '[']) {
      const closing = wrapper === '{' ? '}' : ']';
      try {
        return JSON.parse(wrapper + seg + closing);
      } catch {
        // continue
      }
    }
    try {
      const parsed = JSON.parse(seg);
      if (typeof parsed === 'object' && parsed !== null) return parsed;
    } catch {
      // continue
    }
  }

  // Layer 5: Regex to find key-value patterns and construct JSON
  const kvRegex = /["']?(\w+)["']?\s*[:：]\s*["']?([^"'}\],]+)["']?/g;
  const kvResult: Record<string, string> = {};
  let kvMatch;
  while ((kvMatch = kvRegex.exec(trimmed)) !== null) {
    kvResult[kvMatch[1].trim()] = kvMatch[2].trim();
  }
  if (Object.keys(kvResult).length > 0) {
    return kvResult;
  }

  throw new Error('无法解析模型返回的JSON内容 (长度: ' + trimmed.length + ')');
}
