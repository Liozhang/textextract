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
  get keyAlign() { return KEY_ALIGN_SYSTEM_MESSAGE; },
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
- 有分类结构时用连字符拼接：{"基本信息-姓名": "张三", "财务数据-年收入": "120000元"}
- 顶层必须包含多个字段，不得只有单一键
</structure_rules>

<example_output>
正确: {"姓名": "张三", "年龄": "45岁", "血常规-白细胞": "6.5 ×10⁹/L"}
错误: {"提取结果": {"姓名": "张三"}}
错误: {"data": {"姓名": "张三"}}
</example_output>`;

/** User prompt prefix for text-based extraction */
export const TEXT_EXTRACTION_PREFIX = '请从以下文档内容中提取结构化信息，返回纯 JSON。\n\n文档内容：\n';

// ---------------------------------------------------------------------------
// Key alignment — system message (pre-merge step)
// ---------------------------------------------------------------------------

export const KEY_ALIGN_SYSTEM_MESSAGE = `将多份文档提取结果中的字段名进行语义归一。

<input_description>
你将收到一组字段及其出现次数、示例值、类型。用户可能提供参考键名。
</input_description>

<rules>
1. 语义相同的字段映射到同一规范名（如 name/姓名/名称 → 姓名）
2. 区分"同义"和"相关但不同"：
   - 期初余额 ≠ 期末余额，计划金额 ≠ 实际金额
   - 收入 ≠ 支出，数量 ≠ 单价
   - 主联系人 ≠ 备用联系人
3. 用户提供的参考键名优先作为规范名
4. 每个原始字段必须出现在 field_mapping 中
5. 仅在字段完全为空或是其他字段的冗余子集时标记为丢弃，否则保留
</rules>

<output_schema>
{
  "field_mapping": {"原始键名": "规范键名", ...},
  "field_order": ["规范键名1", "规范键名2", ...],
  "field_actions": {"规范键名": "保留 — 原因", ...}
}
</output_schema>

<field_order_priority>
排序优先级：标识(ID/编号/姓名) → 基本信息(性别/年龄/类别) → 日期时间 → 量化数据(金额/数量/指标) → 描述和备注 → 其他
</field_order_priority>

仅返回 JSON。`;

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
2. 语义匹配：字段名不同但含义相同即可映射（"患者姓名"→"姓名"，"联系电话"→"电话"）
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
