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

  // Layer 4: Regex to find key:value pairs and construct JSON
  // Avoids splitting by semicolons which would truncate multi-value fields (e.g. "诊断: A;B")
  const kvRegex4 = /["']?([^"',:：\n]+?)["']?\s*[:：]\s*["']?([^"'\n]*?)["']?(?:\s*[,，]\s*|$)/g;
  const kvPairs4: Record<string, string> = {};
  let kvMatch4;
  while ((kvMatch4 = kvRegex4.exec(trimmed)) !== null) {
    const k = kvMatch4[1].trim();
    const v = kvMatch4[2].trim();
    if (k && v) {
      kvPairs4[k] = v;
    }
  }
  if (Object.keys(kvPairs4).length >= 2) {
    return kvPairs4;
  }

  // Layer 5: Regex to find key-value patterns (broader Chinese key support)
  const kvRegex5 = /["']?([\w\u4e00-\u9fff\u3000-\u303f\uff00-\uffef\-()（）]+)["']?\s*[:：]\s*["']?([^"'}\],]+)["']?/g;
  const kvResult: Record<string, string> = {};
  let kvMatch5;
  while ((kvMatch5 = kvRegex5.exec(trimmed)) !== null) {
    kvResult[kvMatch5[1].trim()] = kvMatch5[2].trim();
  }
  if (Object.keys(kvResult).length > 0) {
    return kvResult;
  }

  throw new Error('无法解析模型返回的JSON内容 (长度: ' + trimmed.length + ')');
}
