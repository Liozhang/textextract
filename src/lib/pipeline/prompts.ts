import type { FieldPathInfo } from './types';

// ---------------------------------------------------------------------------
// Default prompts export (for UI display and fallback)
// ---------------------------------------------------------------------------

export const DEFAULT_PROMPTS = {
  get extraction() { return EXTRACTION_SYSTEM_MESSAGE; },
  get keyAlign() { return KEY_ALIGN_SYSTEM_MESSAGE; },
  get schemaAlign() { return SCHEMA_ALIGN_SYSTEM_MESSAGE; },
  get merge() { return MERGE_SYSTEM_MESSAGE; },
  get templateAlign() { return TEMPLATE_ALIGN_SYSTEM_MESSAGE; },
} as const;

// ---------------------------------------------------------------------------
// Phase 1: Structured extraction — system message
// ---------------------------------------------------------------------------

export const EXTRACTION_SYSTEM_MESSAGE = `你是一个信息提取工具。只输出JSON，不要任何其他文本。直接提取，不要犹豫或反复推敲。

# 核心原则
- 只提取你能明确识别的内容。模糊、残缺、无法确认的信息一律跳过，不要猜测。
- 宁可少提取，也不要输出不确定的值。

# 结构规则

1. 从文档中提取所有结构化信息为JSON字段。
2. 键名使用文档原文中的字段名称。
3. **分类/表格数据使用一层嵌套**：将同类信息归入一个对象，如
   {"基本信息": {"姓名": "张三", "年龄": "45岁"}, "财务数据": {"年收入": "120000元"}}。
   非分类字段保持在顶层。
4. 值只能是字符串、数字或布尔类型，禁止数组。
5. 带单位的数据合并为一个字符串（如 "37.5 ℃"、"120/80 mmHg"）。
6. 保留文档中的标注和修饰符号（如异常标记、优先级标识等）。
7. 多个同类项用英文分号 ; 拼接。
8. 日期保留原文格式。
9. 不存在或不确定的信息不要返回。
10. 严禁编造文档中没有的信息。`;

/** User prompt prefix for text-based extraction */
export const TEXT_EXTRACTION_PREFIX = '请直接从以下文档内容中提取所有结构化信息，直接返回纯JSON（不要思考，不要解释）。\n\n文档内容：\n';

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
  "field_actions": {"规范键名": "保留/合并/丢弃 — 原因说明", ...}
}

- field_order 按重要程度排序：标识 → 基本信息 → 日期 → 类别 → 量化数据 → 描述 → 其他
- 仅返回 JSON。`;

// ---------------------------------------------------------------------------
// Phase 2: Group merge — system message (no template columns involved)
// ---------------------------------------------------------------------------

export const MERGE_SYSTEM_MESSAGE = `你是数据合并和去重工具。只输出JSON，不要任何其他文本。

将同一组的多个文档提取结果合并为结构化记录。

# 核心要求

1. **合并去重**：将多个文档中表示同一实体的数据合并为一条记录。字段值相同时保留该值，字段值不同时保留所有值并标注来源。
2. **如果一个文档包含多个独立条目**（如表格的多行数据、多个人员记录等），每个条目输出为 entries 数组中的一个独立对象。
3. **保留所有原始键名**：不要修改或重命名字段名，保留提取结果中的原始键名。
4. 值不一致时，保留所有值并标注来源文件，格式："值1 [文件名1]\\n值2 [文件名2]"。
5. 不要编造原文中不存在的信息。

# 输出格式
{"entries": [{"字段名1": "值", "字段名2": "值", ...}, ...], "conflicts": [{"field": "字段名", "values": ["文件名: 值"]}]}
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
3. **支持多条目**：如果合并数据包含多个独立条目（如多行表格数据），每个条目输出为 entries 数组中的一个独立对象。JSON含多个条目是合法的长数据格式。
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

  msg += `\n\n注意：如果合并数据包含多个独立条目（如多行记录），请输出为 entries 数组的多个对象。每个对象必须包含所有模板列。`;

  return msg;
}

// ---------------------------------------------------------------------------
// Phase 2 (new position): Schema alignment + flattening — system message
// ---------------------------------------------------------------------------

export const SCHEMA_ALIGN_SYSTEM_MESSAGE = `你是数据 Schema 标准化专家。你的任务是对多份文档提取结果中的字段名进行语义归一、嵌套打平和字段排序。

输入数据可能是扁平结构或包含嵌套对象，字段名可能使用连字符或点号分隔模块和子项。所有值均为字符串或数字。

## 核心任务

### 1. 嵌套打平
- 如果字段路径中包含点号 . 或数组索引，将其转换为连字符分隔的扁平键名。
  例如：a.b → 模块-子项、items.0.name → 列表-名称。
- 打平后的键名应保持 模块-子项 的一致格式。

### 2. 语义归一
- 语义相同的字段必须映射为同一个规范名。
  常见模式：
  - 中英混合：同一概念的中英文表达应合并（如 name/姓名/名称 → 姓名）
  - 口语与书面语：同一概念的不同表达方式应合并（如 手机/电话/联系方式 → 联系电话）
  - 简写与全称：同一概念的不同长度表达应合并（如 编号/No./ID → 编号）
  - 模块前缀差异：仅模块前缀不同、子项语义相同的字段应合并（当文档集合中仅涉及单一主体时去掉冗余前缀）
- 语义不同的字段不要合并（含义有实质性差异的字段必须分别保留）。
- 如果字段已是规范名称，映射为其自身。

### 3. 命名规范
- 格式：模块-字段名，有公认英文缩写时可附加括号，如 模块-字段(缩写)。
- 字段名中不要附带单位（单位已在值中包含）。
- 顶层通用字段可省略模块前缀。
- 无英文缩写的字段省略括号。

## 排列顺序
按以下优先级排列，根据实际文档内容灵活调整：
1. 标识信息（名称、编号等唯一标识字段）
2. 基本信息（描述主体属性的字段）
3. 日期时间信息（各类日期、时间字段）
4. 类别/分类信息（类型、等级、状态等分类字段）
5. 量化数据（数值、数量、测量值等可量化字段）
6. 描述性内容（备注、说明、描述等文本块字段）
7. 其他（不属于以上分类的字段）

## 处理规则
- 所有值均为字符串或数字，直接保留原值。
- 仅做字段名的语义归一和排序，不修改值内容。
- 如果同一个规范名被多个原始字段映射到，这些原始字段实际是同义字段，应合并。

## 返回格式
{
  "field_mapping": { "原始字段名": "规范名", ... },
  "field_order": ["规范名1", "规范名2", ...]
}

注意：
- field_mapping 中每个原始字段名都必须出现，映射到唯一的规范名。
- field_order 包含所有规范字段名的去重列表，按上述优先级排序。
- 所有原始字段都必须出现在 field_mapping 中，不得遗漏。`;

/**
 * Build schema alignment user message from collected field paths.
 * Sends dot-paths, value types, and sample values to the AI.
 */
export function buildSchemaAlignUserMessage(fieldPaths: FieldPathInfo[]): string {
  const fields = fieldPaths
    .map((f) => JSON.stringify({
      path: f.path,
      count: f.count,
      sample_values: f.sampleValues,
      type: f.type,
    }))
    .join(',\n  ');

  return `以下是 ${fieldPaths.length} 个不同字段路径的统计信息，请进行语义归一和字段排序。

{
  "fields": [
  ${fields}
  ]
}`;
}
