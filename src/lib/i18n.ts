import { useStore } from './store';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Locale = 'en' | 'zh';

// ---------------------------------------------------------------------------
// Translation Maps
// ---------------------------------------------------------------------------

const en = {
  common: {
    loading: 'Loading...',
    prev: 'Previous',
    next: 'Next',
    step: 'Step {{current}} / {{total}}',
    cancel: 'Cancel',
    resetAll: 'Reset All',
    resetConfirmTitle: 'Reset All Data?',
    resetConfirmDesc: 'This will clear all uploaded files, templates, results, and export data. This action cannot be undone.',
    resetConfirmAction: 'Reset',
  },
  app: {
    title: 'OCR Extract',
    subtitle: 'Upload documents, configure templates, AI extracts structured data',
  },
  steps: {
    upload: 'Upload',
    template: 'Template',
    review: 'Extract',
    export: 'Export',
  },
  upload: {
    title: 'File Upload',
    description: 'Upload files to extract content from',
    dropzone: 'Drag files here, or click to select',
    supported: 'Supported:',
    stats: '{{count}} file(s), {{size}}',
    clearAll: 'Clear All',
    remove: 'Remove {{name}}',
    pending: 'Pending',
    parsed: 'Parsed',
    error: 'Error',
    unsupported: 'Unsupported format: {{format}}',
    tooLarge: 'File {{name}} exceeds 50MB limit',
    docUnsupported: '.doc format is not supported, please convert to .docx',
    readFailed: 'File read failed',
    maxFilesReached: 'Maximum {{count}} files reached',
    maxFilesExceeded: 'Maximum {{count}} files, excess files ignored',
  },
  template: {
    title: 'Extraction Template',
    description: 'Define the fields to extract from files',
    promptLabel: 'Extraction Prompt',
    promptPlaceholder:
      'Describe the information you want to extract, e.g.: Please extract the following: contract number, signing date, party A, party B, contract amount, validity period',
    promptCount: '{{count}} chars',
    presetTemplates: 'Preset Templates',
    categoryBusiness: 'Business',
    categoryClinical: 'Clinical & Research',
    fieldDefs: 'Field Definitions',
    addField: 'Add Field',
    noFields: 'No fields defined yet. Click "Add Field" or use a preset template',
    fieldCount: '{{count}} field(s) defined (minimum 1)',
    fieldName: 'Field name',
    required: 'Required',
    desc: 'Description (optional)',
    fieldPlaceholder: 'field_{{index}}',
    removeField: 'Remove field {{name}}',
    confirmOverride:
      'Applying a preset template will overwrite all current field definitions. Continue?',
    confirmOverrideTitle: 'Apply Preset Template',
    confirmOverrideAction: 'Apply',
    warnNoPrompt: 'Adding a prompt helps AI understand context',
    warnNoFields: 'Fields define the extraction structure',
    warnShortPrompt: 'Consider adding more detail to the prompt',
    warnNoRequired: 'No required fields defined',
  },
  review: {
    title: 'Review & Extract',
    description: 'Start extraction after configuration is complete',
    start: 'Start Extract',
    restart: 'Re-extract',
    stop: 'Stop',
    hintNoFiles: 'Please upload files first',
    hintNoFields: 'Please define extraction fields first',
    hintNoKey: 'Please configure API Key first',
    processing: 'Processing: {{file}}',
    preparing: 'Preparing...',
    progress: '{{done}} / {{total}}',
    complete: 'Extraction Complete',
    error: 'Extraction Error',
    summary: '{{total}} file(s) total',
    succeeded: '{{count}} succeeded',
    failed: '{{count}} failed',
    allData: 'All Data',
    fileName: 'File Name',
    field: 'Field',
    value: 'Value',
    fieldsCount: '{{count}} field(s)',
    failedBadge: 'Failed',
    rawResponse: 'Raw Response',
    noData: 'No data extracted',
    noErrorDetail: 'Extraction failed, no error details returned',
    serverError: 'Server error: {{code}} {{text}}',
    streamError: 'Unable to read response stream',
    systemError: 'System Error',
    unknownError: 'Unknown error during extraction',
    imagePreview: 'Image Preview',
    noImageForField: 'No image annotation for this field',
    clickToViewRegion: 'Click a field to view its region in the original image',
    mergeGroups: '{{groups}} groups merged ({{records}} records)',
    mergeSelected: 'Merge selected ({{count}})',
    hideDetails: 'Hide Details',
    showDetails: 'Show Details',
    fileDetails: 'File Extraction Details',
    mergedRecords: 'Merged Records',
    mergeStrategy: 'Merge Strategy',
    mergeFirstWins: 'First non-empty',
    mergeLatestWins: 'Latest value',
    mergeLongestWins: 'Longest value',
  },
  export: {
    title: 'Export Results',
    description: 'Select format and export extracted data',
    format: 'Export Format',
    filename: 'File Name',
    preview: 'Data Preview',
    dataCount: '{{count}} record(s) total',
    noData: 'No data available',
    advanced: 'Advanced Options',
    onlySuccess: 'Only export successful records',
    includeRaw: 'Include raw responses',
    exportBtn: 'Export',
    exporting: 'Exporting...',
    exportSuccess: 'Export successful',
    exportSuccessDesc: '{{count}} record(s) exported',
    exportFailed: 'Export failed',
    exportRetry: 'Export failed, please try again later',
    xlsxDesc: 'Excel format, ideal for further editing and analysis',
    csvDesc: 'Comma-separated values, universal data exchange format',
    jsonDesc: 'JSON format, ideal for developers and programmatic processing',
    exportFailedDetail: 'Export failed ({{code}})',
  },
} satisfies TranslationMap;

const zh: {
  common: Record<string, string>;
  app: Record<string, string>;
  steps: Record<string, string>;
  upload: Record<string, string>;
  template: Record<string, string>;
  review: Record<string, string>;
  export: Record<string, string>;
} = {
  common: {
    loading: '\u52A0\u8F7D\u4E2D...',
    prev: '\u4E0A\u4E00\u6B65',
    next: '\u4E0B\u4E00\u6B65',
    step: '\u6B65\u9AA4 {{current}} / {{total}}',
    cancel: '\u53D6\u6D88',
    resetAll: '\u91CD\u7F6E\u5168\u90E8',
    resetConfirmTitle: '\u91CD\u7F6E\u6240\u6709\u6570\u636E\uFF1F',
    resetConfirmDesc: '\u8FD9\u5C06\u6E05\u9664\u6240\u6709\u4E0A\u4F20\u6587\u4EF6\u3001\u6A21\u677F\u3001\u63D0\u53D6\u7ED3\u679C\u548C\u5BFC\u51FA\u6570\u636E\u3002\u6B64\u64CD\u4F5C\u65E0\u6CD5\u64A4\u9500\u3002',
    resetConfirmAction: '\u91CD\u7F6E',
  },
  app: {
    title: 'OCR Extract',
    subtitle: '\u4E0A\u4F20\u6587\u6863\uFF0C\u914D\u7F6E\u63D0\u53D6\u6A21\u677F\uFF0CAI \u81EA\u52A8\u63D0\u53D6\u7ED3\u6784\u5316\u6570\u636E',
  },
  steps: {
    upload: '\u4E0A\u4F20\u6587\u4EF6',
    template: '\u63D0\u53D6\u6A21\u677F',
    review: '\u5BA1\u6838\u63D0\u53D6',
    export: '\u5BFC\u51FA\u7ED3\u679C',
  },
  upload: {
    title: '\u6587\u4EF6\u4E0A\u4F20',
    description: '\u4E0A\u4F20\u9700\u8981\u63D0\u53D6\u5185\u5BB9\u7684\u6587\u4EF6',
    dropzone: '\u62D6\u62FD\u6587\u4EF6\u5230\u6B64\u5904\uFF0C\u6216\u70B9\u51FB\u9009\u62E9\u6587\u4EF6',
    supported: '\u652F\u6301:',
    stats: '\u5171 {{count}} \u4E2A\u6587\u4EF6\uFF0C{{size}}',
    clearAll: '\u6E05\u9664\u6240\u6709',
    remove: '\u79FB\u9664 {{name}}',
    pending: '\u7B49\u5F85\u4E2D',
    parsed: '\u5DF2\u89E3\u6790',
    error: '\u9519\u8BEF',
    unsupported: '\u4E0D\u652F\u6301\u7684\u6587\u4EF6\u683C\u5F0F: {{format}}',
    tooLarge: '\u6587\u4EF6 {{name}} \u8D85\u8FC7 50MB \u9650\u5236',
    docUnsupported: '\u4E0D\u652F\u6301 .doc \u683C\u5F0F\uFF0C\u8BF7\u8F6C\u6362\u4E3A .docx',
    readFailed: '\u6587\u4EF6\u8BFB\u53D6\u5931\u8D25',
    maxFilesReached: '\u5DF2\u8FBE\u5230\u6700\u5927 {{count}} \u4E2A\u6587\u4EF6\u6570',
    maxFilesExceeded: '\u6700\u591A {{count}} \u4E2A\u6587\u4EF6\uFF0C\u8D85\u51FA\u90E8\u5206\u5DF2\u5FFD\u7565',
  },
  template: {
    title: '\u63D0\u53D6\u6A21\u677F',
    description: '\u5B9A\u4E49\u8981\u4ECE\u6587\u4EF6\u4E2D\u63D0\u53D6\u7684\u4FE1\u606F\u5B57\u6BB5',
    promptLabel: '\u63D0\u53D6\u63D0\u793A\u8BCD',
    promptPlaceholder:
      '\u8BF7\u63CF\u8FF0\u4F60\u9700\u8981\u4ECE\u6587\u4EF6\u4E2D\u63D0\u53D6\u7684\u4FE1\u606F\uFF0C\u4F8B\u5982\uFF1A\u8BF7\u63D0\u53D6\u4EE5\u4E0B\u4FE1\u606F\uFF1A\u5408\u540C\u7F16\u53F7\u3001\u7B7E\u8BA2\u65E5\u671F\u3001\u7532\u65B9\u540D\u79F0\u3001\u4E59\u65B9\u540D\u79F0\u3001\u5408\u540C\u91D1\u989D\u3001\u5408\u540C\u6709\u6548\u671F',
    promptCount: '{{count}} \u5B57',
    presetTemplates: '\u9884\u8BBE\u6A21\u677F',
    categoryBusiness: '\u5546\u52A1\u529E\u516C',
    categoryClinical: '\u79D1\u7814\u4E34\u5E8A',
    fieldDefs: '\u5B57\u6BB5\u5B9A\u4E49',
    addField: '\u6DFB\u52A0\u5B57\u6BB5',
    noFields: '\u5C1A\u672A\u5B9A\u4E49\u4EFB\u4F55\u5B57\u6BB5\uFF0C\u8BF7\u70B9\u51FB\u300C\u6DFB\u52A0\u5B57\u6BB5\u300D\u6216\u4F7F\u7528\u9884\u8BBE\u6A21\u677F',
    fieldCount: '\u5DF2\u5B9A\u4E49 {{count}} \u4E2A\u5B57\u6BB5\uFF08\u81F3\u5C11\u9700\u8981 1 \u4E2A\u5B57\u6BB5\uFF09',
    fieldName: '\u5B57\u6BB5\u540D\u79F0',
    required: '\u5FC5\u586B',
    desc: '\u63CF\u8FF0\uFF08\u53EF\u9009\uFF09',
    fieldPlaceholder: '\u5B57\u6BB5{{index}}',
    removeField: '\u5220\u9664\u5B57\u6BB5 {{name}}',
    confirmOverride: '\u5E94\u7528\u9884\u8BBE\u6A21\u677F\u5C06\u8986\u76D6\u5F53\u524D\u6240\u6709\u5B57\u6BB5\u5B9A\u4E49\uFF0C\u662F\u5426\u7EE7\u7EED\uFF1F',
    confirmOverrideTitle: '\u5E94\u7528\u9884\u8BBE\u6A21\u677F',
    confirmOverrideAction: '\u5E94\u7528',
    warnNoPrompt: '添加提示词有助于AI理解上下文',
    warnNoFields: '字段定义了提取的结构',
    warnShortPrompt: '建议补充更多提示词细节',
    warnNoRequired: '未定义必填字段',
  },
  review: {
    title: '\u5BA1\u6838\u4E0E\u63D0\u53D6',
    description: '\u914D\u7F6E\u5B8C\u6210\u540E\u5F00\u59CB\u4ECE\u6587\u4EF6\u4E2D\u63D0\u53D6\u4FE1\u606F',
    start: '\u5F00\u59CB\u63D0\u53D6',
    restart: '\u91CD\u65B0\u63D0\u53D6',
    stop: '\u505C\u6B62\u63D0\u53D6',
    hintNoFiles: '\u8BF7\u5148\u4E0A\u4F20\u6587\u4EF6',
    hintNoFields: '\u8BF7\u5148\u5B9A\u4E49\u63D0\u53D6\u5B57\u6BB5',
    hintNoKey: '\u8BF7\u5148\u914D\u7F6E API Key',
    processing: '\u6B63\u5728\u5904\u7406: {{file}}',
    preparing: '\u51C6\u5907\u4E2D...',
    progress: '{{done}} / {{total}}',
    complete: '\u63D0\u53D6\u5B8C\u6210',
    error: '\u63D0\u53D6\u51FA\u9519',
    summary: '\u5171 {{total}} \u4E2A\u6587\u4EF6',
    succeeded: '{{count}} \u6210\u529F',
    failed: '{{count}} \u5931\u8D25',
    allData: '\u5168\u90E8\u6570\u636E',
    fileName: '\u6587\u4EF6\u540D',
    field: '\u5B57\u6BB5\u540D',
    value: '\u503C',
    fieldsCount: '{{count}} \u4E2A\u5B57\u6BB5',
    failedBadge: '\u5931\u8D25',
    rawResponse: '\u539F\u59CB\u54CD\u5E94',
    noData: '\u672A\u63D0\u53D6\u5230\u4EFB\u4F55\u6570\u636E',
    noErrorDetail: '\u63D0\u53D6\u5931\u8D25\uFF0C\u672A\u8FD4\u56DE\u5177\u4F53\u9519\u8BEF\u4FE1\u606F',
    serverError: '\u670D\u52A1\u5668\u9519\u8BEF: {{code}} {{text}}',
    streamError: '\u65E0\u6CD5\u8BFB\u53D6\u54CD\u5E94\u6D41',
    systemError: '\u7CFB\u7EDF\u9519\u8BEF',
    unknownError: '\u63D0\u53D6\u8FC7\u7A0B\u4E2D\u53D1\u751F\u672A\u77E5\u9519\u8BEF',
    imagePreview: '\u56FE\u7247\u9884\u89C8',
    noImageForField: '\u5F53\u524D\u5B57\u6BB5\u65E0\u56FE\u7247\u6807\u6CE8',
    clickToViewRegion: '\u70B9\u51FB\u5B57\u6BB5\u67E5\u770B\u539F\u56FE\u4F4D\u7F6E',
    mergeGroups: '{{groups}} \u7EC4\u5408\u5E76 ({{records}} \u6761)',
    mergeSelected: '\u5408\u5E76\u9009\u4E2D\u884C ({{count}})',
    hideDetails: '\u9690\u85CF\u660E\u7EC6',
    showDetails: '\u663E\u793A\u660E\u7EC6',
    fileDetails: '\u5404\u6587\u4EF6\u63D0\u53D6\u660E\u7EC6',
    mergedRecords: '\u5DF2\u5408\u5E76\u8BB0\u5F55',
    mergeStrategy: '合并策略',
    mergeFirstWins: '首个非空值',
    mergeLatestWins: '最新值',
    mergeLongestWins: '最长值',
  },
  export: {
    title: '\u5BFC\u51FA\u7ED3\u679C',
    description: '\u9009\u62E9\u683C\u5F0F\u5BFC\u51FA\u63D0\u53D6\u7684\u6570\u636E',
    format: '\u5BFC\u51FA\u683C\u5F0F',
    filename: '\u6587\u4EF6\u540D',
    preview: '\u6570\u636E\u9884\u89C8',
    dataCount: '\u5171 {{count}} \u6761\u6570\u636E',
    noData: '\u6682\u65E0\u6570\u636E',
    advanced: '\u9AD8\u7EA7\u9009\u9879',
    onlySuccess: '\u4EC5\u5BFC\u51FA\u6210\u529F\u7684\u8BB0\u5F55',
    includeRaw: '\u5305\u542B\u539F\u59CB\u54CD\u5E94',
    exportBtn: '\u5BFC\u51FA',
    exporting: '\u5BFC\u51FA\u4E2D\u2026',
    exportSuccess: '\u5BFC\u51FA\u6210\u529F',
    exportSuccessDesc: '\u5DF2\u5BFC\u51FA {{count}} \u6761\u6570\u636E',
    exportFailed: '\u5BFC\u51FA\u5931\u8D25',
    exportRetry: '\u5BFC\u51FA\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5',
    xlsxDesc: 'Excel \u683C\u5F0F\uFF0C\u9002\u5408\u8FDB\u4E00\u6B65\u7F16\u8F91\u548C\u5206\u6790',
    csvDesc: '\u9017\u53F7\u5206\u9694\u503C\uFF0C\u901A\u7528\u6570\u636E\u4EA4\u6362\u683C\u5F0F',
    jsonDesc: 'JSON \u683C\u5F0F\uFF0C\u9002\u5408\u5F00\u53D1\u8005\u548C\u7A0B\u5E8F\u5904\u7406',
    exportFailedDetail: '\u5BFC\u51FA\u5931\u8D25 ({{code}})',
  },
};

// ---------------------------------------------------------------------------
// Locale detection
// ---------------------------------------------------------------------------

export function detectLocale(): Locale {
  if (typeof window === 'undefined') return 'en';
  const lang = navigator.language?.toLowerCase() ?? '';
  return lang.startsWith('zh') ? 'zh' : 'en';
}

// ---------------------------------------------------------------------------
// Translations record
// ---------------------------------------------------------------------------

type TranslationMap = {
  common: Record<string, string>;
  app: Record<string, string>;
  steps: Record<string, string>;
  upload: Record<string, string>;
  template: Record<string, string>;
  review: Record<string, string>;
  export: Record<string, string>;
};

const translations: Record<Locale, TranslationMap> = { en, zh };

// ---------------------------------------------------------------------------
// Hook: useT()
// ---------------------------------------------------------------------------

type SectionKey = keyof typeof en;

/**
 * Translation hook. Returns a function `t(section.key, vars?)`.
 *
 * @example
 * const t = useT();
 * t('app.title') // => "DocExtract AI"
 * t('upload.stats', { count: 3, size: '1.2 MB' }) // => "3 file(s), 1.2 MB"
 */
export function useT() {
  const locale = useStore((s) => s.locale);

  return function t(
    path: string,
    vars?: Record<string, string | number>,
  ): string {
    const map = translations[locale] as Record<string, unknown>;
    const keys = path.split('.');
    let value: unknown = map;

    for (const k of keys) {
      if (value && typeof value === 'object' && k in (value as Record<string, unknown>)) {
        value = (value as Record<string, unknown>)[k];
      } else {
        // Fallback: try English
        const enMap = translations.en as Record<string, unknown>;
        let fallback: unknown = enMap;
        for (const fk of keys) {
          if (fallback && typeof fallback === 'object' && fk in (fallback as Record<string, unknown>)) {
            fallback = (fallback as Record<string, unknown>)[fk];
          } else {
            return path; // ultimate fallback: return the key path
          }
        }
        value = fallback;
        break;
      }
    }

    if (typeof value !== 'string') return path;

    // Replace {{var}} placeholders
    if (vars) {
      let result = value;
      for (const [k, v] of Object.entries(vars)) {
        result = result.replace(
          new RegExp('\\{\\{' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\}\\}', 'g'),
          String(v),
        );
      }
      return result;
    }

    return value;
  };
}
