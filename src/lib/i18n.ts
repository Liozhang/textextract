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
    reset: 'Reset',
  },
  app: {
    title: 'Message Extract',
    subtitle: 'Upload documents, AI automatically extracts structured data',
  },
  steps: {
    upload: 'Upload',
    extract: 'Extract',
    merge_keys: 'Normalize',
    template: 'Template',
    align_merge: 'Align & Merge',
    export: 'Export',
  },
  template: {
    title: 'Output Template',
    description: 'Paste header row from Excel, or describe columns for AI generation',
    embeddedDescription: 'Paste your desired output headers or describe them — extracted data will be mapped to these columns',
    promptPlaceholder: 'Paste Excel header row (tab-separated), e.g.:\nName\tAge\tDiagnosis\nOr describe: "patient name, age, diagnosis results"',
    generate: 'Generate Template',
    generating: 'Generating...',
    skip: 'Skip (auto-detect columns)',
    confirmUse: 'Use Template',
    confirmDisabledHint: 'Generate or add template columns first',
    key: 'Column Name',
    type: 'Type',
    desc: 'Description',
    example: 'Example',
    addColumn: 'Add Column',
    removeColumn: 'Remove',
    addKeyPlaceholder: 'Enter key name...',
    addKeyButton: 'Add',
    importFields: 'Import all fields',
    importFieldsDesc: 'Auto-fill with all extracted field names',
    selectFields: 'Select fields to import',
    selectFieldsDesc: 'Click to select or deselect fields',
    importSelected: 'Add selected ({{count}})',
    selectAll: 'Select all',
    deselectAll: 'Deselect all',
    valuePreview: 'Value preview ({{count}} files)',
    noValue: '-',
    pendingEntries: 'Pending entries ({{count}})',
    pendingDesc: 'Review extracted values for each key below',
    emptyTemplate: 'No columns yet. Add keys manually, import extracted fields, or use AI generation above.',
    manualSection: 'Manual key input',
    manualDesc: 'Add keys one by one or select from normalized fields below',
    removeFromTemplate: 'Remove',
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
    schemaAlignFallback: 'AI alignment failed, used rule-based fallback',
  },
  merge: {
    aiMerged: 'AI merged {{count}} records',
    fallbackMerged: 'Strategy merged {{count}} records',
  },
  mergeKeys: {
    title: 'Key Normalization',
    description: 'Preview extracted field names and optionally merge synonyms',
    extractionSummary: '{{total}} files, {{succeeded}} succeeded, {{failed}} failed',
    uniqueKeys: 'Unique fields ({{count}})',
    referenceText: 'Custom reference (optional)',
    referenceTextPlaceholder: 'Enter expected key names, one per line...',
    autoMerge: 'Auto-normalize',
    autoMerging: 'Normalizing keys...',
    skip: 'Skip',
    proceed: 'Proceed to Template',
    remap: 'Re-normalize',
    mappingTable: 'Field Mapping',
    originalKey: 'Original',
    canonicalKey: 'Canonical',
    action: 'Action',
    mappingSummary: '{{from}} fields \u2192 {{to}} canonical names',
    noMapping: 'All fields are unique',
    searchMapping: 'Search fields...',
    noSearchResults: 'No matching fields',
    aiFailed: 'AI normalization failed, used rule-based fallback',
    phaseCollecting: 'Collecting fields...',
    phaseAligning: 'AI aligning keys...',
    phaseApplying: 'Applying schema...',
    abort: 'Cancel',
    skipConfirmTitle: 'Skip Key Normalization?',
    skipConfirmDesc: 'Skipping may result in inconsistent field names across files. You can still configure field names in the template step.',
    skipConfirmAction: 'Skip Anyway',
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
    mergeMethodAi: 'AI Merged',
    mergeMethodFallback: 'Strategy Fallback',
    mergeMethodSingle: 'Single File',
    retryAlign: 'Retry Align',
    completeSummary: 'Complete: {{groups}} groups, {{rows}} rows, {{fields}} fields',
    extractionSummary: '{{total}} files processed, {{succeeded}} succeeded, {{failed}} failed',
    extractedFields: 'Extracted fields ({{count}})',
    extractionComplete: 'Extraction Complete',
    configureTemplate: 'Configure output template or skip to auto-detect',
    configureTemplateTitle: 'Configure Template (Optional)',
    configureTemplateDesc: 'Configure output columns based on extraction results, or skip for auto-detection',
    alignMergeInProgress: 'Aligning & Merging...',
    alignMergeReady: 'Align & Merge',
    alignMergeComplete: 'Align & Merge Complete',
    alignMergeStopped: 'Stopped. Click to retry.',
    alignMergeHint: 'Click to start aligning and merging extracted data.',
    startAlignMerge: 'Start Align & Merge',
    retryFailed: 'Retry Failed ({{count}})',
    retrySelected: 'Retry Selected ({{count}})',
    selectAll: 'Select All',
    deselectAll: 'Deselect All',
    multiValueNote: 'Multiple values joined with "; "',
    preview: 'Preview',
    extractStepTitle: 'Content Extraction',
    extractStepDesc: 'Run AI extraction on uploaded files',
    templateStepTitle: 'Template Configuration',
    templateStepDesc: 'Configure output columns and merge results',
    reconfigure: 'Reconfigure Template',
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
    noDataHint: 'No data to export yet. Complete the template configuration step first.',
    goToTemplate: 'Go to Template',
  },
  settings: {
    title: 'Prompt Settings',
    extraction: 'Extraction Prompt',
    keyAlign: 'Key Alignment Prompt',
    merge: 'Merge Prompt',
    templateAlign: 'Template Alignment Prompt',
    templateGenerate: 'Template Generation Prompt',
    restoreDefaults: 'Restore Defaults',
    restoreConfirmTitle: 'Restore Defaults?',
    restoreConfirmDesc: 'All custom prompts will be replaced with defaults. This cannot be undone.',
    apiBaseUrl: 'API Base URL',
    apiBaseUrlPlaceholder: 'https://api.openai.com/v1',
    apiKey: 'API Key',
    apiKeyPlaceholder: 'sk-...',
    apiModel: 'Model',
    apiModelPlaceholder: 'gpt-4o',
    apiConcurrency: 'Concurrency',
    apiSection: 'API Configuration',
  },
} satisfies TranslationMap;

const zh: {
  common: Record<string, string>;
  app: Record<string, string>;
  steps: Record<string, string>;
  upload: Record<string, string>;
  template: Record<string, string>;
  pipeline: Record<string, string>;
  merge: Record<string, string>;
  mergeKeys: Record<string, string>;
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
    reset: '\u91CD\u7F6E',
  },
  app: {
    title: 'Message Extract',
    subtitle: '\u4E0A\u4F20\u6587\u6863\uFF0CAI \u81EA\u52A8\u63D0\u53D6\u7ED3\u6784\u5316\u6570\u636E',
  },
  steps: {
    upload: '\u4E0A\u4F20\u6587\u4EF6',
    extract: '\u5185\u5BB9\u63D0\u53D6',
    merge_keys: '\u952E\u540D\u5F52\u4E00\u5316',
    template: '\u6A21\u677F\u5236\u4F5C',
    align_merge: '\u5BF9\u9F50\u5408\u5E76',
    export: '\u5BFC\u51FA\u7ED3\u679C',
  },
  template: {
    title: '\u8F93\u51FA\u6A21\u677F',
    description: '\u7C98\u8D34 Excel \u8868\u5934\u884C\uFF0C\u6216\u63CF\u8FF0\u5B57\u6BB5\u7531 AI \u751F\u6210',
    embeddedDescription: '\u7C98\u8D34\u4F60\u5E0C\u671B\u7684\u8F93\u51FA\u8868\u5934\uFF0C\u7CFB\u7EDF\u5C06\u5DF2\u63D0\u53D6\u6570\u636E\u6620\u5C04\u5230\u8FD9\u4E9B\u5217',
    promptPlaceholder: '\u7C98\u8D34 Excel \u8868\u5934\u884C\uFF08Tab \u5206\u9694\uFF09\uFF0C\u4F8B\u5982\uFF1A\n\u59D3\u540D\t\u5E74\u9F84\t\u8BCA\u65AD\n\u6216\u63CF\u8FF0\uFF1A\u201C\u60A3\u8005\u57FA\u672C\u4FE1\u606F\u3001\u5E74\u9F84\u3001\u8BCA\u65AD\u7ED3\u679C\u201D',
    generate: '\u751F\u6210\u6A21\u677F',
    generating: '\u751F\u6210\u4E2D...',
    skip: '\u8DF3\u8FC7\uFF08\u81EA\u52A8\u68C0\u6D4B\u5217\uFF09',
    confirmUse: '\u4F7F\u7528\u6A21\u677F',
    confirmDisabledHint: '\u8BF7\u5148\u751F\u6210\u6216\u6DFB\u52A0\u6A21\u677F\u5217',
    key: '\u5B57\u6BB5\u540D',
    type: '\u7C7B\u578B',
    desc: '\u63CF\u8FF0',
    example: '\u793A\u4F8B\u503C',
    addColumn: '\u6DFB\u52A0\u5217',
    removeColumn: '\u5220\u9664',
    addKeyPlaceholder: '\u8F93\u5165\u952E\u540D...',
    addKeyButton: '\u6DFB\u52A0',
    importFields: '\u5BFC\u5165\u6240\u6709\u5B57\u6BB5',
    importFieldsDesc: '\u81EA\u52A8\u586B\u5145\u6240\u6709\u63D0\u53D6\u5230\u7684\u5B57\u6BB5\u540D',
    selectFields: '\u9009\u62E9\u8981\u5BFC\u5165\u7684\u5B57\u6BB5',
    selectFieldsDesc: '\u70B9\u51FB\u9009\u62E9\u6216\u53D6\u6D88\u9009\u62E9\u5B57\u6BB5',
    importSelected: '\u6DFB\u52A0\u5DF2\u9009\uFF08{{count}}\uFF09',
    selectAll: '\u5168\u9009',
    deselectAll: '\u53D6\u6D88\u5168\u9009',
    valuePreview: '\u503C\u9884\u89C8\uFF08{{count}} \u4E2A\u6587\u4EF6\uFF09',
    noValue: '-',
    pendingEntries: '\u5F85\u786E\u8BA4\u6761\u76EE\uFF08{{count}}\uFF09',
    pendingDesc: '\u67E5\u770B\u6BCF\u4E2A\u952E\u5728\u5404\u6587\u4EF6\u4E2D\u7684\u63D0\u53D6\u503C',
    emptyTemplate: '\u8FD8\u6CA1\u6709\u5217\u3002\u53EF\u4EE5\u624B\u52A8\u6DFB\u52A0\u952E\u3001\u5BFC\u5165\u63D0\u53D6\u5B57\u6BB5\uFF0C\u6216\u4F7F\u7528\u4E0A\u65B9 AI \u751F\u6210\u3002',
    manualSection: '\u624B\u52A8\u8F93\u5165\u952E',
    manualDesc: '\u9010\u4E2A\u6DFB\u52A0\u952E\u540D\uFF0C\u6216\u4E00\u952E\u5BFC\u5165\u6240\u6709\u63D0\u53D6\u5B57\u6BB5',
    removeFromTemplate: '\u79FB\u9664',
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
    schemaAlignFallback: 'AI \u5BF9\u9F50\u5931\u8D25\uFF0C\u5DF2\u4F7F\u7528\u89C4\u5219\u56DE\u9000',
  },
  merge: {
    aiMerged: 'AI \u5408\u5E76 {{count}} \u6761\u8BB0\u5F55',
    fallbackMerged: '\u7B56\u7565\u5408\u5E76 {{count}} \u6761\u8BB0\u5F55',
  },
  mergeKeys: {
    title: '\u952E\u540D\u5F52\u4E00\u5316',
    description: '\u9884\u89C8\u63D0\u53D6\u7684\u5B57\u6BB5\u540D\uFF0C\u5C06\u540C\u4E49\u5B57\u6BB5\u5408\u5E76\u4E3A\u89C4\u8303\u540D\u79F0',
    extractionSummary: '\u5171 {{total}} \u4E2A\u6587\u4EF6\uFF0C{{succeeded}} \u6210\u529F\uFF0C{{failed}} \u5931\u8D25',
    uniqueKeys: '\u552F\u4E00\u5B57\u6BB5\uFF08{{count}}\uFF09',
    referenceText: '\u81EA\u5B9A\u4E49\u53C2\u8003\uFF08\u53EF\u9009\uFF09',
    referenceTextPlaceholder: '\u8F93\u5165\u671F\u671B\u7684\u952E\u540D\uFF0C\u6BCF\u884C\u4E00\u4E2A...',
    autoMerge: '\u81EA\u52A8\u5F52\u4E00\u5316',
    autoMerging: '\u6B63\u5728\u5F52\u4E00\u5316\u952E\u540D...',
    skip: '\u8DF3\u8FC7',
    proceed: '\u8FDB\u5165\u6A21\u677F\u5236\u4F5C',
    remap: '\u91CD\u65B0\u5F52\u4E00\u5316',
    mappingTable: '\u5B57\u6BB5\u6620\u5C04',
    originalKey: '\u539F\u59CB\u952E\u540D',
    canonicalKey: '\u89C4\u8303\u540D\u79F0',
    action: '\u5904\u7406\u65B9\u5F0F',
    mappingSummary: '{{from}} \u4E2A\u5B57\u6BB5 \u2192 {{to}} \u4E2A\u89C4\u8303\u952E',
    noMapping: '\u6240\u6709\u5B57\u6BB5\u5DF2\u552F\u4E00',
    searchMapping: '\u641C\u7D22\u5B57\u6BB5...',
    noSearchResults: '\u6CA1\u6709\u5339\u914D\u7684\u5B57\u6BB5',
    aiFailed: 'AI \u5F52\u4E00\u5316\u5931\u8D25\uFF0C\u5DF2\u4F7F\u7528\u89C4\u5219\u56DE\u9000',
    phaseCollecting: '\u6B63\u5728\u6536\u96C6\u5B57\u6BB5...',
    phaseAligning: 'AI \u6B63\u5728\u5BF9\u9F50\u952E\u540D...',
    phaseApplying: '\u6B63\u5728\u5E94\u7528\u65B9\u6848...',
    abort: '\u53D6\u6D88',
    skipConfirmTitle: '\u8DF3\u8FC7\u952E\u540D\u5F52\u4E00\u5316\uFF1F',
    skipConfirmDesc: '\u8DF3\u8FC7\u53EF\u80FD\u5BFC\u81F4\u5404\u6587\u4EF6\u5B57\u6BB5\u540D\u4E0D\u4E00\u81F4\u3002\u60A8\u4ECD\u53EF\u5728\u6A21\u677F\u6B65\u9AA4\u4E2D\u914D\u7F6E\u5B57\u6BB5\u540D\u3002',
    skipConfirmAction: '\u4ECD\u7136\u8DF3\u8FC7',
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
    mergeMethodAi: 'AI \u5408\u5E76',
    mergeMethodFallback: '\u7B56\u7565\u56DE\u9000',
    mergeMethodSingle: '\u5355\u6587\u4EF6',
    retryAlign: '\u91CD\u65B0\u5BF9\u9F50',
    completeSummary: '\u5B8C\u6210: {{groups}} \u7EC4\uFF0C{{rows}} \u884C\uFF0C{{fields}} \u4E2A\u5B57\u6BB5',
    extractionSummary: '\u5171 {{total}} \u4E2A\u6587\u4EF6\uFF0C{{succeeded}} \u6210\u529F\uFF0C{{failed}} \u5931\u8D25',
    extractedFields: '\u5DF2\u63D0\u53D6\u5B57\u6BB5\uFF08{{count}}\uFF09',
    configureTemplate: '\u914D\u7F6E\u8F93\u51FA\u6A21\u677F\u6216\u8DF3\u8FC7\u81EA\u52A8\u68C0\u6D4B',
    configureTemplateTitle: '\u914D\u7F6E\u6A21\u677F\uFF08\u53EF\u9009\uFF09',
    configureTemplateDesc: '\u57FA\u4E8E\u63D0\u53D6\u7ED3\u679C\u914D\u7F6E\u8F93\u51FA\u5217\u6A21\u677F\uFF0C\u6216\u8DF3\u8FC7\u7531\u7CFB\u7EDF\u81EA\u52A8\u68C0\u6D4B',
    extractionComplete: '\u63D0\u53D6\u5B8C\u6210',
    alignMergeInProgress: '\u5BF9\u9F50\u4E0E\u5408\u5E76\u4E2D...',
    alignMergeReady: '\u5BF9\u9F50\u5408\u5E76',
    alignMergeComplete: '\u5BF9\u9F50\u5408\u5E76\u5B8C\u6210',
    alignMergeStopped: '\u5DF2\u505C\u6B62\uFF0C\u70B9\u51FB\u91CD\u8BD5',
    alignMergeHint: '\u70B9\u51FB\u5F00\u59CB\u5BF9\u9F50\u5408\u5E76\u63D0\u53D6\u6570\u636E',
    startAlignMerge: '\u5F00\u59CB\u5BF9\u9F50\u5408\u5E76',
    retryFailed: '\u91CD\u8BD5\u5931\u8D25\u9879 ({{count}})',
    retrySelected: '\u91CD\u8BD5\u9009\u4E2D\u9879 ({{count}})',
    selectAll: '\u5168\u9009',
    deselectAll: '\u53D6\u6D88\u5168\u9009',
    multiValueNote: '\u591A\u4E2A\u503C\u7528"; "\u62FC\u63A5',
    preview: '\u9884\u89C8',
    extractStepTitle: '\u5185\u5BB9\u63D0\u53D6',
    extractStepDesc: '\u5BF9\u4E0A\u4F20\u6587\u4EF6\u8FD0\u884C AI \u63D0\u53D6',
    templateStepTitle: '\u6A21\u677F\u914D\u7F6E',
    templateStepDesc: '\u914D\u7F6E\u8F93\u51FA\u5217\u5E76\u5408\u5E76\u7ED3\u679C',
    reconfigure: '\u91CD\u65B0\u914D\u7F6E\u6A21\u677F',
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
    noDataHint: '\u6682\u65E0\u53EF\u5BFC\u51FA\u6570\u636E\uFF0C\u8BF7\u5148\u5B8C\u6210\u6A21\u677F\u914D\u7F6E\u6B65\u9AA4\u3002',
    goToTemplate: '\u8F6C\u5230\u6A21\u677F\u5236\u4F5C',
  },
  settings: {
    title: 'Prompt \u8BBE\u7F6E',
    extraction: '\u63D0\u53D6 Prompt',
    keyAlign: '\u952E\u540D\u5F52\u4E00\u5316 Prompt',
    merge: '\u5408\u5E76 Prompt',
    templateAlign: '\u6A21\u677F\u5BF9\u9F50 Prompt',
    templateGenerate: '\u6A21\u677F\u751F\u6210 Prompt',
    restoreDefaults: '\u6062\u590D\u9ED8\u8BA4',
    restoreConfirmTitle: '\u6062\u590D\u9ED8\u8BA4\u8BBE\u7F6E\uFF1F',
    restoreConfirmDesc: '\u6240\u6709\u81EA\u5B9A\u4E49 Prompt \u5C06\u88AB\u66FF\u6362\u4E3A\u9ED8\u8BA4\u503C\uFF0C\u6B64\u64CD\u4F5C\u65E0\u6CD5\u64A4\u9500\u3002',
    apiBaseUrl: 'API \u5730\u5740',
    apiBaseUrlPlaceholder: 'https://api.openai.com/v1',
    apiKey: 'API \u5BC6\u94A5',
    apiKeyPlaceholder: 'sk-...',
    apiModel: '\u6A21\u578B\u540D\u79F0',
    apiModelPlaceholder: 'gpt-4o',
    apiConcurrency: '\u5E76\u53D1\u6570',
    apiSection: 'API \u914D\u7F6E',
  },
};

// ---------------------------------------------------------------------------
// Locale detection
// ---------------------------------------------------------------------------

export function detectLocale(): Locale {
  if (typeof window === 'undefined') return 'zh';
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
  pipeline: Record<string, string>;
  merge: Record<string, string>;
  mergeKeys: Record<string, string>;
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
