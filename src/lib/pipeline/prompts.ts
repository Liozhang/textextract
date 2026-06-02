// ---------------------------------------------------------------------------
// Template generation — system message (used by generate-template API)
// ---------------------------------------------------------------------------

export const TEMPLATE_GENERATE_SYSTEM_MESSAGE = `你是一个输出模板设计助手。根据用户提供的模板字段描述，为每个字段生成结构化的列定义。

要求：
1. key 使用用户提供的字段名（保持原样，不要翻译或修改）
2. type 只能是 string、number 或 boolean（根据字段含义推断）
3. description 用中文简短描述该字段的含义
4. example 提供一个合理的示例值

返回 JSON 对象，格式如下：
{"columns": [{"key": "字段名", "type": "string", "description": "描述", "example": "示例值"}]}

仅返回 JSON 对象，不要任何解释性文本。`;

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

export const EXTRACTION_SYSTEM_MESSAGE = `你是一个信息提取工具。只输出JSON，不要任何其他文本。直接提取，不要犹豫或反复推敲。

# 核心原则
- 从文档中提取所有你能明确识别的结构化信息。模糊、残缺、无法确认的信息一律跳过，不要猜测。
- 宁可少提取，也不要输出不确定的值。严禁编造文档中没有的信息。

# 结构规则

1. 键名使用文档原文中的字段名称。
2. **所有字段必须在 JSON 顶层，禁止任何形式的嵌套或包装**：
   - ❌ {"提取结果": {"姓名": "张三", "年龄": "45"}} ← 禁止用包装键
   - ❌ {"data": {...}} ← 禁止用容器键
   - ❌ {"基本信息": {"姓名": "张三"}} ← 禁止嵌套对象
   - ✅ {"姓名": "张三", "年龄": "45"} ← 正确：全部顶层扁平
   如果原文有分类/表格结构，用连字符拼接分类与字段名，如
   {"基本信息-姓名": "张三", "基本信息-年龄": "45岁", "财务数据-年收入": "120000元"}。
   **第一层级必须包含多个明确字段，不得只有单一键。**
3. 值尽量使用字符串、数字或布尔类型。遇到多个同类值时用英文分号 ; 拼接为字符串（如 "项目A; 项目B"），避免使用数组。
4. 带单位的数据合并为一个字符串（如 "37.5 ℃"、"120/80 mmHg"）。
5. 保留文档中的标注和修饰符号（如异常标记、优先级标识等）。
6. 日期保留原文格式。`;

/** User prompt prefix for text-based extraction */
export const TEXT_EXTRACTION_PREFIX = '请从以下文档内容中提取结构化信息，返回纯 JSON。\n\n文档内容：\n';

// ---------------------------------------------------------------------------
// Key alignment — system message (pre-merge step)
// ---------------------------------------------------------------------------

export const KEY_ALIGN_SYSTEM_MESSAGE = `你是键名归一化专家。你的任务是对多份文档提取结果中的字段名进行语义归一，决定同义字段的合并方式。

## 输入

你将收到一组字段名及其出现次数和示例值。用户可能还提供了参考键名。

## 归一化规则

1. **语义合并**：语义相同的字段必须映射到同一个规范名。
   - 中英混合：name/姓名/名称 → 姓名
   - 口语与书面语：手机/电话/联系方式 → 联系电话
   - 简写与全称：编号/No./ID → 编号

2. **参考键优先**：如果用户提供了参考键名，优先使用参考键名作为规范名。

3. **整合与丢弃决策**：对于每个规范键，决定其信息的处理方式：
   - **保留**：该字段包含独立价值的信息。
   - **合并**：多个同义字段映射到同一规范键。
   - **丢弃**：该字段是其他字段的冗余子集或完全为空。谨慎丢弃。

4. **区分"同义"和"相关但不同"**：以下情况必须分别保留，不要合并：
   - 时间/条件/状态不同的字段："期初余额"≠"期末余额"，"计划金额"≠"实际金额"
   - 同类但含义不同的指标：收入≠支出，数量≠单价
   - 层级/序号不同：主联系人≠备用联系人，一级分类≠二级分类

5. **不要遗漏**：每个原始字段都必须出现在 field_mapping 中。

## 返回格式

{
  "field_mapping": {"原始键名": "规范键名", ...},
  "field_order": ["规范键名1", "规范键名2", ...],
  "field_actions": {"规范键名": "保留 — 包含独立信息", ...}
}

field_actions 示例：
- {"姓名": "保留 — 核心标识字段"}
- {"电话": "合并 — 与'联系方式'同义"}
- {"备注2": "丢弃 — 与'备注'完全重复"}

field_order 按以下优先级编号排序：
  1. 标识（编号、ID、姓名）
  2. 基本信息（性别、年龄、类别）
  3. 日期时间
  4. 量化数据（金额、数量、指标值）
  5. 描述和备注
  6. 其他

仅返回 JSON。`;

// ---------------------------------------------------------------------------
// Phase 2: Group merge — system message (no template columns involved)
// ---------------------------------------------------------------------------

export const MERGE_SYSTEM_MESSAGE = `你是数据合并和去重工具。只输出JSON，不要任何其他文本。

将同一组的多个文档提取结果合并为结构化记录。

# 判断"同一实体"的线索

当多个文档描述同一对象时，通过以下线索判断是否属于同一实体：
- 相同的标识信息（如姓名+身份证号、订单号、报告编号等）
- 相同的时间+地点组合
- 同一文件名的不同版本

如果缺乏足够的标识信息且文档内容高度相似，默认合并为一条；如果各文档包含不同时间点或不同条件下的数据，应作为多独立条目分别输出。

# 核心要求

1. **合并去重**：将多个文档中表示同一实体的数据合并为一条记录。字段值相同时保留该值，字段值不同时保留所有值并标注来源。
2. **如果一个文档包含多个独立条目**（如表格的多行数据、多个人员记录等），每个条目输出为 entries 数组中的一个独立对象。
3. **保留所有原始键名**：不要修改或重命名字段名，保留提取结果中的原始键名。
4. 值不一致时，保留所有值并标注来源文件，格式："值1 [文件名1]\\n值2 [文件名2]"。
5. 不要编造原文中不存在的信息。

# 输出格式

{
  "entries": [
    {"姓名": "张三", "年龄": "45岁", "诊断": "高血压"},
    {"姓名": "李四", "年龄": "30岁", "诊断": null}
  ],
  "conflicts": [
    {"field": "诊断", "values": ["报告A: 高血压", "报告B: 高血压二期"]}
  ]
}

所有值为字符串、数字或null，不含嵌套对象和数组。entries 为对象数组，即使只有一条也必须用数组。`;

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

export const TEMPLATE_ALIGN_SYSTEM_MESSAGE = `你是数据字段映射专家。只输出JSON，不要任何其他文本。

将已合并的数据映射到指定的模板列。

# 核心要求

1. **必须使用模板列指定的键名**：分析每个模板列的含义（通过列名和描述），从合并数据中找到语义匹配的字段，将其值填入对应模板列。
2. **语义匹配**：即使合并数据中的字段名与模板列名不同，只要含义相同就应映射。例如合并数据中的"患者姓名"应映射到模板列"姓名"，"联系电话"应映射到"电话"。
3. **支持多条目**：合并数据中的每个独立条目（如表格每行、每个人员记录）输出为 entries 数组中的一个独立对象。
4. **每个对象必须包含所有模板列**。没有对应值的字段填 null。
5. **不要输出模板之外的键**。
6. 值不一致时，保留所有值并标注来源文件。
7. 不要编造原文中不存在的信息。

# 输出格式
{"entries": [{"模板列名1": "值", "模板列名2": null, ...}, ...], "conflicts": [{"field": "字段名", "values": ["文件名: 值"]}]}
所有值为字符串、数字或null，不含嵌套对象和数组。entries 为对象数组，即使只有一条也必须用数组。`;

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
