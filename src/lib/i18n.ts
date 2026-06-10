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
    title: 'TextExtract',
    subtitle: 'Upload documents, AI automatically extracts structured data',
  },
  steps: {
    upload: 'Upload',
    template: 'Template',
    extract: 'Extract',
    align_merge: 'Align & Merge',
    export: 'Export',
  },
  template: {
    title: 'Output Template',
    description: 'Define output columns before extraction. AI will extract data directly matching these columns.',
    embeddedDescription: 'Paste your desired output headers or describe them — extracted data will be mapped to these columns',
    promptPlaceholder: 'Paste Excel header row (tab-separated), e.g.:\nName\tAge\tDiagnosis\nOr describe: "patient name, age, diagnosis results"',
    generate: 'Generate Template',
    generating: 'Generating...',
    skip: 'Skip (auto-detect columns)',
    confirmUse: 'Use Template & Extract',
    confirmDisabledHint: 'Generate or add template columns first',
    key: 'Column Name',
    type: 'Type',
    desc: 'Description',
    example: 'Example',
    repeating: 'Repeating',
    repeatingHint: 'This column may have multiple values per document (e.g., lab items)',
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
    presetSection: 'Preset Templates',
    presetDesc: 'Select a preset template to get started quickly',
    presetCustom: 'Custom',
    selectPreset: 'Select template...',
    moreItems: '+{{count}} more',
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
    tooLarge: 'File {{name}} exceeds 100MB limit',
    readFailed: 'File read failed',
    maxFilesReached: 'Maximum {{count}} files reached',
    maxFilesExceeded: 'Maximum {{count}} files, excess files ignored',
    uploadingProgress: 'Uploading {{current}}/{{total}}...',
    chunkFailed: 'Upload chunk failed',
    uploadFailed: 'Upload failed',
    chunkFailedDetail: 'Chunk {{current}}/{{total}} failed, {{count}} files skipped',
  },
  resume: {
    title: 'Resume Interrupted Extraction',
    description: '{{completed}} of {{total}} files processed ({{failed}} failed), interrupted {{time}} ago',
    resumeBtn: 'Resume',
    discardBtn: 'Discard',
    discardCleanupError: 'Failed to clean up {{count}} session(s) on server',
    timeSeconds: '{{count}}s',
    timeMinutes: '{{count}}m',
    timeHours: '{{count}}h',
    timeDays: '{{count}}d',
    sessionExpired: 'Session data has expired. Please start a new extraction.',
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
    fields: 'Fields',
    fieldsCount: '{{count}} field(s)',
    entriesCount: '{{count}} row(s)',
    failedBadge: 'Failed',
    noData: 'No data extracted',
    noErrorDetail: 'Extraction failed, no error details returned',
    noResults: 'No results yet',
    serverError: 'Server error: {{code}} {{text}}',
    streamError: 'Unable to read response stream',
    systemError: 'System Error',
    batchFailed: 'Batch {{batch}} failed, remaining files continue',
    apiIncomplete: 'API settings incomplete (Base URL, API Key, and Model are required). Please configure in Settings.',
    retryError: 'Retry failed: {{error}}',
    filesExpired: '{{count}} files\' temp data expired. Existing results will be kept. Re-upload to re-extract.',
    serverTempExpired: 'Server temp files expired, please re-upload',
    unknownError: 'Unknown error during extraction',
    mergeGroups: '{{groups}} groups merged ({{records}} records)',
    hideDetails: 'Hide Details',
    showDetails: 'Show Details',
    fileDetails: 'File Extraction Details',
    mergedRecords: 'Merged',
    mergeMethodAi: 'AI Merged',
    mergeMethodFallback: 'Strategy Fallback',
    mergeMethodSingle: 'Single File',
    mergeMethodProgrammatic: 'Programmatic',
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
    eta: 'ETA: {{time}}',
    etaSeconds: '{{count}}s',
    etaMinutes: '{{count}} min',
    etaHours: '{{count}} hr {{minutes}} min',
    batchProgress: 'Batch {{current}}/{{total}}',
    extractStepTitle: 'Content Extraction',
    extractStepDesc: 'Run AI extraction on uploaded files',
    templateStepTitle: 'Template Configuration',
    templateStepDesc: 'Define output columns to guide AI extraction',
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
    selectColumns: 'Columns',
    selectedColumnsCount: '{{selected}}/{{total}}',
    selectAllColumns: 'Select All',
    deselectAllColumns: 'Deselect All',
    selectedRowsCount: '{{count}}/{{total}} selected',
    selectAllRows: 'Select All',
    deselectAllRows: 'Deselect All',
    noSelection: 'Select at least 1 row and 1 column',
    longData: 'Long Format',
    wideData: 'Wide Format',
    pivotConfig: 'Pivot Configuration',
    pivotNone: '(None)',
    pivotPrefixColumn: 'Prefix Column',
    pivotPrefixColumnDesc: 'Optional. Adds a prefix segment to column names (e.g., category)',
    pivotKeyColumn: 'Pivot Key',
    pivotKeyColumnDesc: 'Column whose unique values become part of column names',
    pivotValueColumns: 'Value Columns',
    pivotValueColumnsDesc: 'Columns whose values fill the pivoted cells',
    pivotNoRepeatingCols: 'Wide format requires template columns with repeating flag. Please configure template first.',
    pivotNeedMoreCols: 'Need at least 2 repeating columns (pivot key + value column)',
    pivotNoPresets: 'Click "Add" to create pivot settings',
    pivotAddPreset: 'Add',
    pivotPreset: 'Set {{n}}',
    pivotColumnNames: 'Column Names',
    pivotColumnNamesDesc: 'Edit column names for export. Left shows the original names.',
    pivotPreview: 'Wide Format Preview',
    pivotResetNames: 'Reset Names',
  },
  settings: {
    title: 'Prompt Settings',
    dialogTitle: 'Settings',
    dialogDesc: 'Configure API, cache, and extraction prompt settings',
    unsavedTitle: 'Unsaved Changes',
    unsavedDesc: 'You have unsaved prompt changes. Are you sure you want to close without saving?',
    extraction: 'Extraction Instructions (supplementary)',
    extractionHint: 'Appended after the built-in extraction rules and column definitions. Leave empty to use defaults.',
    restoreDefaults: 'Restore Defaults',
    restoreConfirmTitle: 'Restore Prompt Defaults?',
    restoreConfirmDesc: 'Custom prompts will be replaced with defaults. API and cache settings are not affected. This cannot be undone.',
    apiBaseUrl: 'API Base URL',
    apiBaseUrlPlaceholder: 'https://api.openai.com/v1',
    apiKey: 'API Key',
    apiKeyPlaceholder: 'sk-...',
    apiModel: 'Model',
    apiModelPlaceholder: 'step-3.7-flash',
    apiModelHint: 'Recommended multimodal model for document OCR extraction',
    apiConcurrency: 'Concurrency',
    apiSection: 'API Configuration',
    cacheSection: 'Cache Settings',
    cacheExpiryHours: 'Expiry Time',
    documentType: 'Document Type',
    documentTypePlaceholder: 'e.g. Medical Pathology Report',
    documentTypeHint: 'Helps AI understand document structure for better extraction',
    hours: 'hours',
    days: 'days',
    cacheHint: 'Temp files are cleaned automatically. Changes take effect on next extraction.',
    discardChanges: 'Discard',
  },
} satisfies TranslationMap;

const zh: {
  common: Record<string, string>;
  app: Record<string, string>;
  steps: Record<string, string>;
  upload: Record<string, string>;
  resume: Record<string, string>;
  template: Record<string, string>;
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
    reset: '\u91CD\u7F6E',
  },
  app: {
    title: 'TextExtract',
    subtitle: '\u4E0A\u4F20\u6587\u6863\uFF0CAI \u81EA\u52A8\u63D0\u53D6\u7ED3\u6784\u5316\u6570\u636E',
  },
  steps: {
    upload: '\u4E0A\u4F20\u6587\u4EF6',
    template: '\u6A21\u677F\u914D\u7F6E',
    extract: '\u5185\u5BB9\u63D0\u53D6',
    align_merge: '\u5BF9\u9F50\u5408\u5E76',
    export: '\u5BFC\u51FA\u7ED3\u679C',
  },
  template: {
    title: '\u8F93\u51FA\u6A21\u677F',
    description: '\u63D0\u53D6\u524D\u5B9A\u4E49\u8F93\u51FA\u5217\uFF0CAI \u5C06\u6309\u5217\u63D0\u53D6\u7ED3\u6784\u5316\u6570\u636E',
    embeddedDescription: '\u7C98\u8D34\u4F60\u5E0C\u671B\u7684\u8F93\u51FA\u8868\u5934\uFF0C\u7CFB\u7EDF\u5C06\u5DF2\u63D0\u53D6\u6570\u636E\u6620\u5C04\u5230\u8FD9\u4E9B\u5217',
    promptPlaceholder: '\u7C98\u8D34 Excel \u8868\u5934\u884C\uFF08Tab \u5206\u9694\uFF09\uFF0C\u4F8B\u5982\uFF1A\n\u59D3\u540D\t\u5E74\u9F84\t\u8BCA\u65AD\n\u6216\u63CF\u8FF0\uFF1A\u201C\u60A3\u8005\u57FA\u672C\u4FE1\u606F\u3001\u5E74\u9F84\u3001\u8BCA\u65AD\u7ED3\u679C\u201D',
    generate: '\u751F\u6210\u6A21\u677F',
    generating: '\u751F\u6210\u4E2D...',
    skip: '\u8DF3\u8FC7\uFF08\u81EA\u52A8\u68C0\u6D4B\u5217\uFF09',
    confirmUse: '\u4F7F\u7528\u6A21\u677F\u5E76\u63D0\u53D6',
    confirmDisabledHint: '\u8BF7\u5148\u751F\u6210\u6216\u6DFB\u52A0\u6A21\u677F\u5217',
    key: '\u5B57\u6BB5\u540D',
    type: '\u7C7B\u578B',
    desc: '\u63CF\u8FF0',
    example: '\u793A\u4F8B\u503C',
    repeating: '\u591A\u503C\u5217',
    repeatingHint: '\u8BE5\u5217\u5728\u6587\u6863\u4E2D\u53EF\u80FD\u6709\u591A\u4E2A\u503C\uFF08\u5982\u68C0\u9A8C\u9879\u76EE\uFF09',
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
    presetSection: '\u9884\u8BBE\u6A21\u677F',
    presetDesc: '\u9009\u62E9\u9884\u8BBE\u6A21\u677F\u5FEB\u901F\u5F00\u59CB',
    presetCustom: '\u81EA\u5B9A\u4E49',
    selectPreset: '\u9009\u62E9\u6A21\u677F...',
    moreItems: '+{{count}} \u66F4\u591A',
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
    tooLarge: '\u6587\u4EF6 {{name}} \u8D85\u8FC7 100MB \u9650\u5236',
    readFailed: '\u6587\u4EF6\u8BFB\u53D6\u5931\u8D25',
    maxFilesReached: '\u5DF2\u8FBE\u5230\u6700\u5927 {{count}} \u4E2A\u6587\u4EF6\u6570',
    maxFilesExceeded: '\u6700\u591A {{count}} \u4E2A\u6587\u4EF6\uFF0C\u8D85\u51FA\u90E8\u5206\u5DF2\u5FFD\u7565',
    uploadingProgress: '\u4E0A\u4F20\u4E2D {{current}}/{{total}}...',
    chunkFailed: '\u4E0A\u4F20\u5206\u5757\u5931\u8D25',
    uploadFailed: '\u4E0A\u4F20\u5931\u8D25',
    chunkFailedDetail: '\u7B2C {{current}}/{{total}} \u6279\u4E0A\u4F20\u5931\u8D25\uFF0C{{count}} \u4E2A\u6587\u4EF6\u5DF2\u8DF3\u8FC7',
  },
  resume: {
    title: '\u6062\u590D\u4E2D\u65AD\u7684\u63D0\u53D6',
    description: '\u5DF2\u5904\u7406 {{completed}}/{{total}} \u4E2A\u6587\u4EF6\uFF08{{failed}} \u4E2A\u5931\u8D25\uFF09\uFF0C\u4E2D\u65AD\u4E8E {{time}} \u524D',
    resumeBtn: '\u6062\u590D\u63D0\u53D6',
    discardBtn: '\u653E\u5F03',
    discardCleanupError: '\u6E05\u7406 {{count}} \u4E2A\u670D\u52A1\u5668\u4F1A\u8BDD\u5931\u8D25',
    timeSeconds: '{{count}}\u79D2',
    timeMinutes: '{{count}}\u5206\u949F',
    timeHours: '{{count}}\u5C0F\u65F6',
    timeDays: '{{count}}\u5929',
    sessionExpired: '\u4F1A\u8BDD\u6570\u636E\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u91CD\u65B0\u5F00\u59CB\u63D0\u53D6\u3002',
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
  review: {
    title: '\u5BA1\u6838\u4E0E\u63D0\u53D6',
    description: '\u4E0A\u4F20\u6587\u4EF6\u540E\u5F00\u59CB\u63D0\u53D6',
    start: '\u5F00\u59CB\u63D0\u53D6',
    restart: '\u91CD\u65B0\u63D0\u53D6',
    stop: '\u505C\u6B62',
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
    fields: '\u5B57\u6BB5',
    fieldsCount: '{{count}} \u4E2A\u5B57\u6BB5',
    entriesCount: '{{count}} \u6761\u8BB0\u5F55',
    failedBadge: '\u5931\u8D25',
    noData: '\u672A\u63D0\u53D6\u5230\u4EFB\u4F55\u6570\u636E',
    noErrorDetail: '\u63D0\u53D6\u5931\u8D25\uFF0C\u672A\u8FD4\u56DE\u5177\u4F53\u9519\u8BEF\u4FE1\u606F',
    noResults: '\u6682\u65E0\u63D0\u53D6\u7ED3\u679C',
    serverError: '\u670D\u52A1\u5668\u9519\u8BEF: {{code}} {{text}}',
    streamError: '\u65E0\u6CD5\u8BFB\u53D6\u54CD\u5E94\u6D41',
    systemError: '\u7CFB\u7EDF\u9519\u8BEF',
    batchFailed: '\u7B2C {{batch}} \u6279\u5931\u8D25\uFF0C\u5176\u4F59\u6587\u4EF6\u7EE7\u7EED\u5904\u7406',
    apiIncomplete: 'API \u8BBE\u7F6E\u4E0D\u5B8C\u6574\uFF08\u9700\u8981 Base URL\u3001API Key \u548C Model\uFF09\uFF0C\u8BF7\u5728\u8BBE\u7F6E\u4E2D\u914D\u7F6E\u3002',
    retryError: '\u91CD\u8BD5\u5931\u8D25\uFF1A{{error}}',
    filesExpired: '{{count}} \u4E2A\u6587\u4EF6\u7684\u4E34\u65F6\u6570\u636E\u5DF2\u8FC7\u671F\uFF0C\u5C06\u4FDD\u7559\u5DF2\u6709\u63D0\u53D6\u7ED3\u679C\u3002\u5982\u9700\u91CD\u65B0\u63D0\u53D6\uFF0C\u8BF7\u91CD\u65B0\u4E0A\u4F20\u8FD9\u4E9B\u6587\u4EF6\u3002',
    serverTempExpired: '\u670D\u52A1\u5668\u4E34\u65F6\u6587\u4EF6\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u91CD\u65B0\u4E0A\u4F20',
    unknownError: '\u63D0\u53D6\u8FC7\u7A0B\u4E2D\u53D1\u751F\u672A\u77E5\u9519\u8BEF',
    mergeGroups: '{{groups}} \u7EC4\u5408\u5E76 ({{records}} \u6761)',
    hideDetails: '\u9690\u85CF\u660E\u7EC6',
    showDetails: '\u663E\u793A\u660E\u7EC6',
    fileDetails: '\u5404\u6587\u4EF6\u63D0\u53D6\u660E\u7EC6',
    mergedRecords: '\u5DF2\u5408\u5E76',
    mergeMethodAi: 'AI \u5408\u5E76',
    mergeMethodFallback: '\u7B56\u7565\u56DE\u9000',
    mergeMethodSingle: '\u5355\u6587\u4EF6',
    mergeMethodProgrammatic: '\u7A0B\u5E8F\u5408\u5E76',
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
    eta: '\u9884\u8BA1\u5269\u4F59: {{time}}',
    etaSeconds: '{{count}} \u79D2',
    etaMinutes: '{{count}} \u5206\u949F',
    etaHours: '{{count}} \u5C0F\u65F6 {{minutes}} \u5206\u949F',
    batchProgress: '\u6279\u6B21 {{current}}/{{total}}',
    extractStepTitle: '\u5185\u5BB9\u63D0\u53D6',
    extractStepDesc: '\u5BF9\u4E0A\u4F20\u6587\u4EF6\u8FD0\u884C AI \u63D0\u53D6',
    templateStepTitle: '\u6A21\u677F\u914D\u7F6E',
    templateStepDesc: '\u5B9A\u4E49\u8F93\u51FA\u5217\u5F15\u5BFC AI \u63D0\u53D6',
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
    selectColumns: '\u9009\u62E9\u5217',
    selectedColumnsCount: '{{selected}}/{{total}}',
    selectAllColumns: '\u5168\u9009',
    deselectAllColumns: '\u53D6\u6D88\u5168\u9009',
    selectedRowsCount: '\u5DF2\u9009 {{count}}/{{total}} \u884C',
    selectAllRows: '\u5168\u9009',
    deselectAllRows: '\u53D6\u6D88\u5168\u9009',
    noSelection: '\u8BF7\u81F3\u5C11\u9009\u62E9 1 \u884C\u548C 1 \u5217',
    longData: '\u957F\u6570\u636E',
    wideData: '\u5BBD\u6570\u636E',
    pivotConfig: '\u900F\u89C6\u8868\u914D\u7F6E',
    pivotNone: '\uFF08\u65E0\uFF09',
    pivotPrefixColumn: '\u524D\u7F00\u5217',
    pivotPrefixColumnDesc: '\u53EF\u9009\uFF0C\u5728\u5217\u540D\u4E2D\u6DFB\u52A0\u5206\u7C7B\u524D\u7F00',
    pivotKeyColumn: '\u900F\u89C6\u952E\u5217',
    pivotKeyColumnDesc: '\u5176\u552F\u4E00\u503C\u5C06\u6210\u4E3A\u65B0\u5217\u540D\u7684\u4E00\u90E8\u5206',
    pivotValueColumns: '\u503C\u5217',
    pivotValueColumnsDesc: '\u5176\u503C\u5C06\u586B\u5145\u5230\u900F\u89C6\u540E\u7684\u5355\u5143\u683C\u4E2D',
    pivotNoRepeatingCols: '\u5BBD\u683C\u5F0F\u9700\u8981\u6A21\u677F\u4E2D\u6709\u591A\u503C\u5217\uFF0C\u8BF7\u5148\u914D\u7F6E\u6A21\u677F\u3002',
    pivotNeedMoreCols: '\u9700\u8981\u81F3\u5C11 2 \u4E2A\u591A\u503C\u5217\uFF08\u900F\u89C6\u952E\u5217 + \u503C\u5217\uFF09',
    pivotNoPresets: '\u70B9\u51FB\u201C\u6DFB\u52A0\u201D\u521B\u5EFA\u900F\u89C6\u8BBE\u7F6E',
    pivotAddPreset: '\u6DFB\u52A0',
    pivotPreset: '\u8BBE\u7F6E {{n}}',
    pivotColumnNames: '\u5217\u540D\u7F16\u8F91',
    pivotColumnNamesDesc: '\u7F16\u8F91\u5BFC\u51FA\u5217\u540D\uFF0C\u5DE6\u4FA7\u663E\u793A\u539F\u59CB\u540D\u79F0\u3002',
    pivotPreview: '\u5BBD\u683C\u5F0F\u9884\u89C8',
    pivotResetNames: '\u91CD\u7F6E\u5217\u540D',
  },
  settings: {
    title: 'Prompt \u8BBE\u7F6E',
    dialogTitle: '\u8BBE\u7F6E',
    dialogDesc: '\u914D\u7F6E API\u3001\u7F13\u5B58\u548C\u63D0\u53D6\u63D0\u793A\u8BCD\u8BBE\u7F6E',
    unsavedTitle: '\u672A\u4FDD\u5B58\u7684\u4FEE\u6539',
    unsavedDesc: '\u60A8\u6709\u672A\u4FDD\u5B58\u7684 Prompt \u4FEE\u6539\uFF0C\u786E\u5B9A\u8981\u4E0D\u4FDD\u5B58\u5C31\u5173\u95ED\u5417\uFF1F',
    extraction: '\u63D0\u53D6\u8865\u5145\u6307\u4EE4',
    extractionHint: '\u8FFD\u52A0\u5728\u5185\u7F6E\u63D0\u53D6\u89C4\u5219\u548C\u5217\u5B9A\u4E49\u4E4B\u540E\uFF0C\u7559\u7A7A\u5373\u53EF\u4F7F\u7528\u9ED8\u8BA4\u503C',
    restoreDefaults: '\u6062\u590D\u9ED8\u8BA4',
    restoreConfirmTitle: '\u6062\u590D Prompt \u9ED8\u8BA4\u8BBE\u7F6E\uFF1F',
    restoreConfirmDesc: '\u81EA\u5B9A\u4E49 Prompt \u5C06\u88AB\u66FF\u6362\u4E3A\u9ED8\u8BA4\u503C\uFF0CAPI \u548C\u7F13\u5B58\u8BBE\u7F6E\u4E0D\u53D7\u5F71\u54CD\u3002\u6B64\u64CD\u4F5C\u65E0\u6CD5\u64A4\u9500\u3002',
    apiBaseUrl: 'API \u5730\u5740',
    apiBaseUrlPlaceholder: 'https://api.openai.com/v1',
    apiKey: 'API \u5BC6\u94A5',
    apiKeyPlaceholder: 'sk-...',
    apiModel: '\u6A21\u578B\u540D\u79F0',
    apiModelPlaceholder: 'step-3.7-flash',
    apiModelHint: '\u63A8\u8350\u4F7F\u7528\u7684\u591A\u6A21\u6001\u6A21\u578B\uFF0C\u9002\u7528\u4E8E\u6587\u6863 OCR \u63D0\u53D6',
    apiConcurrency: '\u5E76\u53D1\u6570',
    apiSection: 'API \u914D\u7F6E',
    cacheSection: '\u7F13\u5B58\u8BBE\u7F6E',
    cacheExpiryHours: '\u8FC7\u671F\u65F6\u95F4',
    documentType: '\u6587\u6863\u7C7B\u578B',
    documentTypePlaceholder: '\u4F8B\u5982\uFF1A\u533B\u7597\u75C5\u7406\u62A5\u544A',
    documentTypeHint: '\u5E2E\u52A9 AI \u7406\u89E3\u6587\u6863\u7ED3\u6784\uFF0C\u63D0\u9AD8\u63D0\u53D6\u51C6\u786E\u6027',
    hours: '\u5C0F\u65F6',
    days: '\u5929',
    cacheHint: '\u4E34\u65F6\u6587\u4EF6\u5C06\u81EA\u52A8\u6E05\u7406\uFF0C\u4FEE\u6539\u540E\u5728\u4E0B\u6B21\u63D0\u53D6\u65F6\u751F\u6565',
    discardChanges: '\u653E\u5F03\u4FEE\u6539',
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
  resume: Record<string, string>;
  template: Record<string, string>;
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
