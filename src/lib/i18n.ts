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
    confirm: 'OK',
    resetAll: 'Reset All',
    resetConfirmTitle: 'Reset All Data?',
    resetConfirmDesc: 'This will clear all uploaded files, results, and export data. This action cannot be undone.',
    resetConfirmAction: 'Reset',
  },
  app: {
    title: 'OCR Extract',
    subtitle: 'Upload documents, AI automatically extracts structured data',
  },
  steps: {
    upload: 'Upload',
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
  pipeline: {
    grouping: 'Grouping files...',
    extracting: 'Extracting...',
    merging: 'Merging: {{label}} ({{count}} files)',
    aligning: 'Aligning schema...',
    phaseGrouping: 'Grouping',
    phaseExtracting: 'Extracting',
    phaseMerging: 'Merging',
    phaseAligning: 'Align & Flatten',
    mergeProgress: '{{current}}/{{total}}',
  },
  merge: {
    aiMerged: 'AI merged {{count}} records',
    fallbackMerged: 'Strategy merged {{count}} records',
  },
  review: {
    title: 'Review & Extract',
    description: 'Start extraction after files are uploaded',
    start: 'Start Extract',
    restart: 'Re-extract',
    stop: 'Stop',
    hintNoFiles: 'Please upload files first',
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
    noData: 'No data extracted',
    noErrorDetail: 'Extraction failed, no error details returned',
    noResults: 'No results yet',
    serverError: 'Server error: {{code}} {{text}}',
    streamError: 'Unable to read response stream',
    systemError: 'System Error',
    unknownError: 'Unknown error during extraction',
    mergeGroups: '{{groups}} groups merged ({{records}} records)',
    hideDetails: 'Hide Details',
    showDetails: 'Show Details',
    fileDetails: 'File Extraction Details',
    mergedRecords: 'Merged',
    completeSummary: 'Complete: {{groups}} groups, {{rows}} rows, {{fields}} fields',
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
  settings: {
    title: 'Prompt Settings',
    extraction: 'Extraction Prompt',
    schemaAlign: 'Schema Alignment Prompt',
    merge: 'Merge Prompt',
    restoreDefaults: 'Restore Defaults',
    restoreConfirmTitle: 'Restore Defaults?',
    restoreConfirmDesc: 'All custom prompts will be replaced with defaults. This cannot be undone.',
  },
} satisfies TranslationMap;

const zh: {
  common: Record<string, string>;
  app: Record<string, string>;
  steps: Record<string, string>;
  upload: Record<string, string>;
  pipeline: Record<string, string>;
  merge: Record<string, string>;
  review: Record<string, string>;
  export: Record<string, string>;
  settings: Record<string, string>;
} = {
  common: {
    loading: '\u52A0\u8F7D\u4E2D...',
    prev: '\u4E0A\u4E00\u6B65',
    next: '\u4E0B\u4E00\u6B65',
    step: '\u6B65\u9AA4 {{current}} / {{total}}',
    cancel: '\u53D6\u6D88',
    confirm: '\u786E\u8BA4',
    resetAll: '\u91CD\u7F6E\u5168\u90E8',
    resetConfirmTitle: '\u91CD\u7F6E\u6240\u6709\u6570\u636E\uFF1F',
    resetConfirmDesc: '\u8FD9\u5C06\u6E05\u9664\u6240\u6709\u4E0A\u4F20\u6587\u4EF6\u3001\u63D0\u53D6\u7ED3\u679C\u548C\u5BFC\u51FA\u6570\u636E\u3002\u6B64\u64CD\u4F5C\u65E0\u6CD5\u64A4\u9500\u3002',
    resetConfirmAction: '\u91CD\u7F6E',
  },
  app: {
    title: 'OCR Extract',
    subtitle: '\u4E0A\u4F20\u6587\u6863\uFF0CAI \u81EA\u52A8\u63D0\u53D6\u7ED3\u6784\u5316\u6570\u636E',
  },
  steps: {
    upload: '\u4E0A\u4F20\u6587\u4EF6',
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
  pipeline: {
    grouping: '\u6B63\u5728\u5206\u7EC4\u6587\u4EF6...',
    extracting: '\u6B63\u5728\u63D0\u53D6...',
    merging: '\u6B63\u5728\u5408\u5E76: {{label}} ({{count}} \u4E2A\u6587\u4EF6)',
    aligning: '\u6B63\u5728\u5BF9\u9F50\u8868\u5934...',
    phaseGrouping: '\u5206\u7EC4',
    phaseExtracting: '\u63D0\u53D6',
    phaseMerging: '\u5408\u5E76',
    phaseAligning: '\u5BF9\u9F50\u5C55\u5E73',
    mergeProgress: '{{current}}/{{total}}',
  },
  merge: {
    aiMerged: 'AI \u5408\u5E76 {{count}} \u6761\u8BB0\u5F55',
    fallbackMerged: '\u7B56\u7565\u5408\u5E76 {{count}} \u6761\u8BB0\u5F55',
  },
  review: {
    title: '\u5BA1\u6838\u4E0E\u63D0\u53D6',
    description: '\u4E0A\u4F20\u6587\u4EF6\u540E\u5F00\u59CB\u63D0\u53D6',
    start: '\u5F00\u59CB\u63D0\u53D6',
    restart: '\u91CD\u65B0\u63D0\u53D6',
    stop: '\u505C\u6B62\u63D0\u53D6',
    hintNoFiles: '\u8BF7\u5148\u4E0A\u4F20\u6587\u4EF6',
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
    noData: '\u672A\u63D0\u53D6\u5230\u4EFB\u4F55\u6570\u636E',
    noErrorDetail: '\u63D0\u53D6\u5931\u8D25\uFF0C\u672A\u8FD4\u56DE\u5177\u4F53\u9519\u8BEF\u4FE1\u606F',
    noResults: '\u6682\u65E0\u63D0\u53D6\u7ED3\u679C',
    serverError: '\u670D\u52A1\u5668\u9519\u8BEF: {{code}} {{text}}',
    streamError: '\u65E0\u6CD5\u8BFB\u53D6\u54CD\u5E94\u6D41',
    systemError: '\u7CFB\u7EDF\u9519\u8BEF',
    unknownError: '\u63D0\u53D6\u8FC7\u7A0B\u4E2D\u53D1\u751F\u672A\u77E5\u9519\u8BEF',
    mergeGroups: '{{groups}} \u7EC4\u5408\u5E76 ({{records}} \u6761)',
    hideDetails: '\u9690\u85CF\u660E\u7EC6',
    showDetails: '\u663E\u793A\u660E\u7EC6',
    fileDetails: '\u5404\u6587\u4EF6\u63D0\u53D6\u660E\u7EC6',
    mergedRecords: '\u5DF2\u5408\u5E76',
    completeSummary: '\u5B8C\u6210: {{groups}} \u7EC4\uFF0C{{rows}} \u884C\uFF0C{{fields}} \u4E2A\u5B57\u6BB5',
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
  settings: {
    title: 'Prompt \u8BBE\u7F6E',
    extraction: '\u63D0\u53D6 Prompt',
    schemaAlign: 'Schema \u5BF9\u9F50 Prompt',
    merge: '\u5408\u5E76 Prompt',
    restoreDefaults: '\u6062\u590D\u9ED8\u8BA4',
    restoreConfirmTitle: '\u6062\u590D\u9ED8\u8BA4\u8BBE\u7F6E\uFF1F',
    restoreConfirmDesc: '\u6240\u6709\u81EA\u5B9A\u4E49 Prompt \u5C06\u88AB\u66FF\u6362\u4E3A\u9ED8\u8BA4\u503C\uFF0C\u6B64\u64CD\u4F5C\u65E0\u6CD5\u64A4\u9500\u3002',
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
  pipeline: Record<string, string>;
  merge: Record<string, string>;
  review: Record<string, string>;
  export: Record<string, string>;
  settings: Record<string, string>;
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
