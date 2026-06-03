// ---------------------------------------------------------------------------
// Template generation — system message (used by generate-template API)
// ---------------------------------------------------------------------------

export const TEMPLATE_GENERATE_SYSTEM_MESSAGE = `将用户描述的字段转为结构化列定义。

<rules>
- key: 照搬用户原文，不改不译
- type: 推断为 string | number | boolean
- description: 中文简述含义
- example: 给一个合理示例值
</rules>

<output_schema>
{"columns": [{"key": "字段名", "type": "string", "description": "描述", "example": "示例值"}]}
</output_schema>

仅返回 JSON，无解释文本。`;

// ---------------------------------------------------------------------------
// Default prompts export (for UI display and fallback)
// ---------------------------------------------------------------------------

export const DEFAULT_PROMPTS = {
  get extraction() { return EXTRACTION_SYSTEM_MESSAGE; },
  get merge() { return MERGE_SYSTEM_MESSAGE; },
  get templateAlign() { return TEMPLATE_ALIGN_SYSTEM_MESSAGE; },
  get templateGenerate() { return TEMPLATE_GENERATE_SYSTEM_MESSAGE; },
} as const;

// ---------------------------------------------------------------------------
// Phase 1: Structured extraction — system message
// ---------------------------------------------------------------------------

export const EXTRACTION_SYSTEM_MESSAGE = `从文档中提取结构化信息。

<constraints>
- 只输出 JSON 对象，无任何解释文本
- 值必须来自文档原文，不可编造、推测或补全
- 模糊、残缺、无法确认的信息跳过，宁缺毋滥
- 日期保留原文格式
- 带单位的数据合并为一个字符串（"37.5 ℃"、"120/80 mmHg"）
- 多个同类值用分号拼接（"项目A; 项目B"），不用数组
- 保留文档中的标注和修饰符号
</constraints>

<structure_rules>
- 键名使用文档原文中的字段名称
- 所有字段必须在 JSON 顶层，禁止嵌套对象和包装键
- 每个语义字段必须是独立的 key，禁止将多个字段名合并为一个 key
- 有分组时，用连字符做短前缀（最多 2 段）：{"检验结果-钾": "4.36 mmol/L", "基本信息-姓名": "张三"}
- 顶层必须包含多个字段，不得只有单一键
</structure_rules>

<table_rules>
- 表格是最常见的结构。表头每列名是一个独立 key，对应单元格值是 value
- 多行数据表：每行用数字前缀区分：{"1-姓名": "张三", "1-性别": "男", "2-姓名": "李四", "2-性别": "女"}
- 禁止将整行表头拼接为一个 key
- 错误示例（绝对禁止）: {"性别-年龄-病历号-就诊卡号-医生-科室": "value"}
- 正确示例: {"性别": "男", "年龄": "45岁", "病历号": "12345", "就诊卡号": "67890", "医生": "王医生", "科室": "内科"}
</table_rules>

<key_constraints>
- 每个 key 必须是有意义的短字段名
- 禁止 key 以特殊字符开头（如 ": :", 空白, 符号等）
- 禁止 key 为空字符串
- key 中连字符分隔的段数不超过 3 段
</key_constraints>

<minimum_output>
- 只要文档图像中有可读文字，就必须至少提取一个字段
- 绝对不允许返回空对象 {}
- 即使文档模糊或部分遮挡，也请提取你能识别的所有字段
</minimum_output>

<example_output>
正确: {"姓名": "张三", "年龄": "45岁", "血常规-白细胞": "6.5 ×10⁹/L"}
正确（表格）: {"姓名": "张三", "性别": "男", "WBC": "6.5 ×10⁹/L(3.5-9.5)", "RBC": "4.5 ×10¹²/L(4.3-5.8)"}
错误: {"提取结果": {"姓名": "张三"}}
错误: {"data": {"姓名": "张三"}}
错误: {"性别-年龄-血型-白细胞计数-红细胞计数": "..."}
错误: {}
</example_output>`;

/** User prompt prefix for text-based extraction */
export const TEXT_EXTRACTION_PREFIX = '请从以下文档内容中提取结构化信息，返回纯 JSON。\n\n文档内容：\n';

// ---------------------------------------------------------------------------
// Phase 2: Group merge — system message (no template columns involved)
// ---------------------------------------------------------------------------

export const MERGE_SYSTEM_MESSAGE = `将同一组多个文档提取结果合并为结构化记录。只输出 JSON。

<entity_matching>
判断多条记录是否属于同一实体：
- 匹配线索：相同标识信息（姓名+证件号、订单号）、相同时间+地点、同一文件名的不同版本
- 缺乏标识信息且内容高度相似 → 默认合并为一条
- 包含不同时间点或不同条件的数据 → 作为独立条目
</entity_matching>

<rules>
1. 同一实体的数据合并为一条，字段值相同取其一，不同则全部保留并标注来源
2. 文档含多个独立条目（表格多行、多个人员）时，每条独立输出到 entries 数组
3. 保留所有原始键名，不修改不重命名
4. 值冲突格式："值1 [文件名1]\\n值2 [文件名2]"
5. 只输出文档中存在的信息，不可编造
</rules>

<output_schema>
{
  "entries": [
    {"姓名": "张三", "年龄": "45岁", "诊断": "高血压"},
    {"姓名": "李四", "年龄": "30岁", "诊断": null}
  ],
  "conflicts": [
    {"field": "诊断", "values": ["报告A: 高血压", "报告B: 高血压二期"]}
  ]
}
</output_schema>

<value_rules>
- 所有值为 string | number | null，禁止嵌套对象和数组
- entries 为对象数组，即使只有一条也必须用数组
</value_rules>`;

/**
 * Build merge user message from a group's extraction results.
 */
export function buildMergeUserMessage(
  groupKey: string,
  results: Array<{ fileName: string; data: Record<string, unknown> }>,
): string {
  const filesSection = '[\n' +
    results.map((r) => JSON.stringify({ file_name: r.fileName, extracted_data: r.data })).join(',\n') +
    '\n]';

  return `以下是同一组文档（"${groupKey}"）的提取结果，请合并去重为结构化记录。\n\n${filesSection}`;
}

// ---------------------------------------------------------------------------
// Phase 3: Template alignment — system message (AI maps merged data to template columns)
// ---------------------------------------------------------------------------

export const TEMPLATE_ALIGN_SYSTEM_MESSAGE = `将合并数据映射到指定模板列。只输出 JSON。

<rules>
1. 必须使用模板列的键名，不输出模板之外的键
2. 语义匹配：字段名不同但含义相同即可映射
3. 每个独立条目输出为 entries 数组中的一个对象
4. 每个对象必须包含所有模板列，无对应值填 null
5. 值冲突时保留所有值并标注来源文件
6. 只输出源数据中存在的信息，不可编造
</rules>

<output_schema>
{"entries": [{"模板列1": "值", "模板列2": null}], "conflicts": [{"field": "字段名", "values": ["文件名: 值"]}]}
</output_schema>

<value_rules>
- 所有值为 string | number | null，禁止嵌套对象和数组
- entries 为对象数组，即使只有一条也必须用数组
- 长格式：每个检验项目必须独立成行，不允许用分号拼接多个项目
</value_rules>`;

/**
 * Build template alignment user message from merged records and template columns.
 */
export function buildTemplateAlignUserMessage(
  groupKey: string,
  mergedData: Array<Record<string, unknown>>,
  templateColumns: Array<{ key: string; description?: string }>,
): string {
  const dataSection = JSON.stringify(mergedData, null, 2);

  let msg = `以下是"${groupKey}"组合并后的数据，请将数据映射到以下模板列。\n\n合并数据：\n${dataSection}`;

  msg += `\n\n模板列（必须使用以下键名，将合并数据中的信息语义映射到对应列，没有对应信息的列填 null）：\n${templateColumns.map((c) => `- ${c.key}${c.description ? ` (${c.description})` : ''}`).join('\n')}`;

  // Detect if template has long-format columns (检验项目 as individual rows)
  const hasLongFormatCols = templateColumns.some(
    (c) => c.key === '检验项目' || c.key === '检验结果',
  );
  if (hasLongFormatCols) {
    msg += '\n\n长格式要求：每个检验项目独立成行，患者信息重复填写。禁止用分号拼接多个项目。';
  }

  // Data-driven hint: detect if merged data has multiple entries with different key patterns
  if (mergedData.length > 1) {
    const firstKeys = Object.keys(mergedData[0] ?? {}).sort().join(',');
    const hasDifferentKeys = mergedData.some(
      (d) => Object.keys(d).sort().join(',') !== firstKeys,
    );
    if (hasDifferentKeys) {
      msg += '\n\n提示：合并数据中各条目的字段不完全一致，请分别处理每个条目。';
    }
  }

  return msg;
}

// ---------------------------------------------------------------------------
// Schema-guided extraction — system message (template-first mode)
// ---------------------------------------------------------------------------

/** Extraction context rules (placed at the beginning of the prompt) */
export const SCHEMA_GUIDED_EXTRACTION_CONTEXT = `从文档中提取结构化信息，严格按照给定的输出列进行提取。

<value_rules>
- 值必须来自文档原文，不可编造、推测或补全
- 模糊、残缺、无法确认的信息填 null，宁缺毋滥
- 日期保留原文格式
- 带单位的数据合并为一个字符串
</value_rules>

<semantic_integration>
- 文档中存在但不在输出列中的重要信息，应整合到语义最接近的输出列中，不要遗漏
- 例如：文档中有"诊断/印象/结论"等关键信息但无对应列时，整合到"备注"或其他语义合适的列
- 整合时保持信息完整，可拼接为"诊断: xxx"的形式
</semantic_integration>

<long_format_rules>
- 如果文档包含表格或多条重复记录，每个记录独立成行
- 单值信息（如姓名、日期）在每个 entry 中重复
- 禁止用分号拼接多个值到一个字段
- 每个检验项目/测量指标独立成行
</long_format_rules>

<minimum_output>
- 只要文档中有可读文字，就必须至少输出一个 entry
- 绝对不允许返回空 entries 数组
</minimum_output>`;

/** Output format rules (placed at the end of the prompt for better compliance) */
export const SCHEMA_GUIDED_OUTPUT_FORMAT = `<output_rules>
- 只输出 JSON，无任何解释文本
- 输出格式为 {"entries": [{...}]}
- 每个 entry 必须包含所有输出列，没有对应值填 null
- 禁止输出输出列之外的键
</output_rules>`;

/**
 * Build a schema-guided extraction system message by injecting template columns.
 */
export function buildSchemaGuidedPrompt(
  columns: Array<{ key: string; description?: string; example?: string; repeating?: boolean }>,
  userInstructions?: string,
): string {
  const singleValueCols = columns.filter((c) => !c.repeating);
  const multiValueCols = columns.filter((c) => c.repeating);

  const singleSection = singleValueCols.length > 0
    ? `单值列（每份文档只出现一次，每个 entry 中重复填写）：\n${singleValueCols.map((c) => `- ${c.key}${c.description ? `: ${c.description}` : ''}`).join('\n')}`
    : '无单值列';

  const multiSection = multiValueCols.length > 0
    ? `多值列（每份文档可能出现多次，每个值独立成行）：\n${multiValueCols.map((c) => `- ${c.key}${c.description ? `: ${c.description}` : ''}`).join('\n')}`
    : '无多值列（所有列均为单值）';

  // Build: context → column definitions → user instructions → output format (at the end)
  let prompt = SCHEMA_GUIDED_EXTRACTION_CONTEXT +
    `\n\n<column_definitions>\n${singleSection}\n\n${multiSection}\n</column_definitions>` +
    `\n\n<output_columns>\n${columns.map((c) => `- "${c.key}"${c.example ? ` (示例: ${c.example})` : ''}`).join('\n')}\n</output_columns>`;

  if (userInstructions?.trim()) {
    prompt += `\n\n<user_instructions>\n${userInstructions.trim()}\n</user_instructions>`;
  }

  prompt += `\n\n${SCHEMA_GUIDED_OUTPUT_FORMAT}`;

  return prompt;
}
