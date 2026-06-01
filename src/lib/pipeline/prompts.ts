import type { FieldPathInfo } from './types';

// ---------------------------------------------------------------------------
// Phase 1: Structured extraction — system message
// ---------------------------------------------------------------------------

export const EXTRACTION_SYSTEM_MESSAGE = `你是专业的文档信息提取助手。从文档中提取所有有意义的结构化信息，以JSON格式返回。

## 提取步骤
1. 通读文档全文，理解文档类型和内容主题
2. 识别文档中包含的所有信息类别（如实体、属性、数值、日期、列表等）
3. 按信息类别组织字段名，使用简洁清晰的中文命名
4. 逐一提取每个字段对应的值

## 原则
- 提取文档中所有有意义的结构化信息，不遗漏重要内容
- 字段名应准确反映信息含义，避免过于笼统或过于冗长
- 同类信息应使用统一的命名风格

## 检验检查结果的提取
检验检查结果（如血常规、肝功能、影像学检查、病理检查等）必须按检查类别分组为嵌套对象，每个具体指标作为子字段。这是重点要求。
- 示例：{"血常规": {"白细胞": {"value": 5.0, "unit": "×10⁹/L"}, "红细胞": {"value": 4.2, "unit": "×10¹²/L"}, "血红蛋白": {"value": 120, "unit": "g/L"}}}
- 示例：{"肝功能": {"谷丙转氨酶": {"value": 45, "unit": "U/L"}, "谷草转氨酶": {"value": 30, "unit": "U/L"}}}
- 示例：{"影像学检查": {"CT": "双肺未见明显异常", "X线": "心影不大"}}
- 指标名称使用标准医学检验名称
- 有参考值的指标，值使用 {"value": 数值, "unit": "单位"} 格式

## 注意事项
- 日期统一为 YYYY-MM-DD 格式
- 测量值（非检验类的，如体温、血压等）返回 {"value": 数值, "unit": "单位"} 格式
- 存在多个同类项时（如多个诊断、多个药品），使用 JSON 数组表示
- 文档中不存在的信息不要返回，不要设为null
- 不要编造文档中没有的信息
- 仅返回JSON，不要返回其他文本`;

/** User prompt prefix for text-based extraction */
export const TEXT_EXTRACTION_PREFIX = '请从以下文档内容中提取所有结构化信息。\n\n文档内容：\n';

// ---------------------------------------------------------------------------
// Phase 2: Group merge — system message
// ---------------------------------------------------------------------------

export const MERGE_SYSTEM_MESSAGE = `你是数据合并专家。你的任务是将同一组的多个文档提取结果合并为一条完整记录。

输入数据的字段名已经过标准化处理，所有值均为字符串。

合并规则：
1. 互补信息全部保留（如一份有入院日期，另一份有出院日期）
2. 相同字段的值如果完全一致，保留任意一个
3. 相同字段的值如果不一致，保留信息更完整、更详细的那个
4. 逗号分隔的列表取所有来源的并集，去重
5. 不要编造文档中不存在的信息

返回JSON格式：
{
  "merged": { ... 合并后的完整数据对象 ... },
  "conflicts": [
    {"field": "字段名", "values": ["值A(来源文件名)", "值B(来源文件名)"]}
  ]
}

如果所有字段完全一致，conflicts 返回空数组。`;

/**
 * Build Phase 2 user message from a group's extraction results.
 * Formats the input data for the merge AI call.
 */
export function buildMergeUserMessage(
  groupKey: string,
  results: Array<{ fileName: string; data: Record<string, unknown> }>,
): string {
  const filesSection = '[\n' +
    results.map((r) => JSON.stringify({ file_name: r.fileName, extracted_data: r.data })).join(',\n') +
    '\n]';

  return `以下是同一组文档（"${groupKey}"）的提取结果，请合并为一条完整记录。

${filesSection}`;
}

// ---------------------------------------------------------------------------
// Phase 2 (new position): Schema alignment + flattening — system message
// ---------------------------------------------------------------------------

export const SCHEMA_ALIGN_SYSTEM_MESSAGE = `你是数据 Schema 设计专家。你的任务是对多份文档提取结果中的字段进行语义归一、嵌套结构扁平化和标准化命名。

## 职责
1. **语义归一**：语义相同的字段映射为同一个规范名
2. **扁平化**：嵌套结构（如"检查结果.血常规.白细胞"）展平为单层字段
3. **标准化命名**：使用标准术语，格式为"模块-字段名(英文缩写)"

## 命名规范
- 使用标准专业术语（医学、工程等领域术语）
- 格式：模块-字段名(英文缩写)，如 "血常规-红细胞(RBC)"、"肝功能-谷丙转氨酶(ALT)"
- 有固定单位的指标可在字段名中附参考单位，如 "血常规-血红蛋白(g/L)"
- 基本信息、就诊信息等模块前缀可省略模块名，如 "患者姓名" 而非 "基本信息-患者姓名"
- 无标准英文缩写的字段可省略括号部分

## 归一规则
- 语义相同的字段映射为同一个规范名（如"姓名"、"name"、"病人姓名" → "患者姓名"）
- 语义不同的字段不要合并（如"入院诊断"和"出院诊断"必须分别保留）
- 如果字段已经是规范名称，映射为其自身

## 展平规则
- leaf: 普通字符串或数值，直接保留
- measurement: {"value": 数值, "unit": "单位"} 格式，展平时保留单位（如 "36.5 °C"）
- join_comma: 数组，用逗号连接（如 ["阿莫西林","布洛芬"] → "阿莫西林, 布洛芬"）

## 检验检查结果的展平（重点）
检验检查类数据（血常规、尿常规、肝功能、肾功能、血脂、血糖、影像学、病理等）是展平的重点对象：
- 嵌套路径"检查类别.指标名"必须展平为"检查类别-指标名(英文缩写)"
- 示例："血常规.白细胞" → "血常规-白细胞(WBC)"，"血常规.血红蛋白" → "血常规-血红蛋白(g/L)"
- 示例："肝功能.谷丙转氨酶" → "肝功能-谷丙转氨酶(ALT)"，"肝功能.总胆红素" → "肝功能-总胆红素(TBIL)"
- 示例："尿常规.尿蛋白" → "尿常规-尿蛋白"（无英文缩写则省略）
- 示例："影像学检查.CT" → "影像学检查-CT"，"影像学检查.检查所见" → "影像学检查-检查所见"
- 如果指标值为 {"value": 数值, "unit": "单位"} 格式，对应 flatten_rules 必须设为 measurement
- json_stringify: 无法处理的复杂对象，回退为 JSON 字符串

## 排列顺序
按信息模块重要性排列：
1. 患者基本信息（姓名、性别、年龄、身份证号等）
2. 就诊信息（住院号、科室、主治医师等）
3. 日期信息（入院日期、出院日期等）
4. 诊断信息（主诉、诊断等）
5. 检查检验
6. 治疗信息
7. 其他（过敏史、既往史等）

## 返回格式
{
  "field_mapping": { "原始路径": "规范扁平名", ... },
  "field_order": ["规范名1", "规范名2", ...],
  "flatten_rules": { "原始路径": "leaf|measurement|join_comma|json_stringify", ... }
}

注意：
- field_mapping 中，嵌套路径用点号分隔（如 "检查结果.血常规.白细胞"）
- field_order 包含所有规范字段名的去重列表，按模块优先级排序
- 所有原始字段路径都必须出现在 field_mapping 和 flatten_rules 中
- measurement 类型的字段，命名时可考虑在括号中附参考单位`;

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

  return `以下是 ${fieldPaths.length} 个不同字段路径的统计信息（path 为嵌套结构时用点号分隔），请进行语义归一和扁平化设计。

{
  "fields": [
  ${fields}
  ]
}`;
}
