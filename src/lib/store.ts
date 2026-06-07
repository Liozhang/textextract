import React from 'react';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { detectLocale, type Locale } from './i18n';
import type { SessionData } from './idb-storage';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WizardStep = 'upload' | 'template' | 'extract' | 'align_merge' | 'export';

export interface ColumnConstraint {
  key: string;
  type: 'string' | 'number' | 'boolean';
  description: string;
  example?: string;
  /** If true, this column can have multiple values per document (e.g., table rows) */
  repeating?: boolean;
}

export interface AppFile {
  id: string;
  name: string;
  size: number;
  type: string;
  content?: string;
  dataUrl?: string;
  /** Server session ID — when set, file is read from server temp storage */
  sessionId?: string;
  status: 'pending' | 'parsed' | 'error';
  error?: string;
}

export interface MergedExportRow {
  label: string;
  data: Record<string, unknown>;
  sourceFiles: string[];
  success: boolean;
}

export interface ExtractionResultItem {
  fileId: string;
  fileName: string;
  success: boolean;
  data?: Record<string, unknown>;
  entries?: Array<Record<string, unknown>>;
  headerData?: Record<string, unknown>;
  error?: string;
}

export type ExtractionStatus = 'idle' | 'template_configured' | 'extracting' | 'extraction_done' | 'aligning_merging' | 'done' | 'error';

export interface ExtractionProgress {
  totalFiles: number;
  completedFiles: number;
  currentFile: string;
  status: ExtractionStatus;
}

export type ExportFormat = 'xlsx' | 'csv' | 'json';

export interface CacheSettings {
  expiryHours: number;
}

export interface ExportSettings {
  format: ExportFormat;
}

export interface PromptSettings {
  extraction: string;
}

export interface ApiSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  concurrency: number;
}

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

export interface AppState {
  // Hydration guard - prevents SSR / hydration mismatch
  mounted: boolean;
  setMounted: (value: boolean) => void;

  // Locale
  locale: Locale;
  setLocale: (locale: Locale) => void;

  // Wizard
  step: WizardStep;
  setStep: (step: WizardStep) => void;

  // Uploaded files
  files: AppFile[];
  addFiles: (files: AppFile[]) => void;
  removeFile: (id: string) => void;
  updateFile: (id: string, partial: Partial<AppFile>) => void;
  clearFiles: () => void;

  // Extraction results
  results: ExtractionResultItem[];
  addResult: (result: ExtractionResultItem) => void;
  clearResults: () => void;

  // Extraction progress
  progress: ExtractionProgress;
  setProgress: (partial: Partial<ExtractionProgress> | ((prev: ExtractionProgress) => Partial<ExtractionProgress>)) => void;

  // Review interaction (image annotation)
  selectedField: string | null;
  selectedFileId: string | null;
  setSelectedField: (field: string | null) => void;
  setSelectedFileId: (fileId: string | null) => void;

  // Export settings
  exportSettings: ExportSettings;
  setExportSettings: (settings: Partial<ExportSettings>) => void;

  // Document type
  documentType: string;
  setDocumentType: (type: string) => void;

  // Cache settings
  cacheSettings: CacheSettings;
  setCacheExpiryHours: (hours: number) => void;

  // Prompt settings (empty string = use default)
  promptSettings: PromptSettings;
  setPromptSettings: (phase: keyof PromptSettings, value: string) => void;
  resetPromptSettings: () => void;

  // API settings (user-configurable, persisted except apiKey)
  apiSettings: ApiSettings;
  setApiSettings: (settings: Partial<ApiSettings>) => void;

  // Template columns
  templateColumns: ColumnConstraint[];
  templatePrompt: string;
  templateGenerated: boolean;
  setTemplateGenerated: (val: boolean) => void;
  setTemplateColumns: (columns: ColumnConstraint[]) => void;
  setTemplatePrompt: (prompt: string) => void;
  resetTemplate: () => void;

  // Extraction snapshot (transient, not persisted — used between extract and align-merge)
  extractionSnapshot: {
    results: Array<{
      fileId: string;
      fileName: string;
      groupId: string;
      success: boolean;
      data?: Record<string, unknown>;
      entries?: Array<Record<string, unknown>>;
      headerData?: Record<string, unknown>;
      imageDataUrl?: string;
      error?: string;
    }>;
    groups: Array<{ groupId: string; groupKey: string; fileCount: number }>;
    serverSessionId?: string | null;
  } | null;
  setExtractionSnapshot: (snapshot: AppState['extractionSnapshot']) => void;
  clearExtractionSnapshot: () => void;

  // Merged export data (synced from review panel after backend pipeline)
  mergedExportData: MergedExportRow[];
  setMergedExportData: (rows: MergedExportRow[]) => void;

  // Reset everything
  resetAll: () => void;

  // Resume interrupted session
  interruptedSession: SessionData | null;
  setInterruptedSession: (session: SessionData | null) => void;
  restoreFromSession: (session: SessionData) => void;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_PROGRESS: ExtractionProgress = {
  totalFiles: 0,
  completedFiles: 0,
  currentFile: '',
  status: 'idle',
};

const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  format: 'xlsx',
};

const DEFAULT_DOCUMENT_TYPE = '';

const DEFAULT_CACHE_SETTINGS: CacheSettings = {
  expiryHours: 24,
};

const DEFAULT_PROMPT_SETTINGS: PromptSettings = {
  extraction: '',
};

const DEFAULT_API_SETTINGS: ApiSettings = {
  baseUrl: '',
  apiKey: '',
  model: '',
  concurrency: 0,
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      // --- Hydration ---
      mounted: false,
      setMounted: (value) => set({ mounted: value }),

      // --- Locale ---
      // SSR-safe: use 'zh' as default, detect actual locale after hydration
      locale: 'zh' as Locale,
      setLocale: (locale) => set({ locale }),

      // --- Wizard ---
      step: 'upload',
      setStep: (step) => set({ step }),

      // --- Files ---
      files: [],
      addFiles: (newFiles) =>
        set((state) => ({
          files: [...state.files, ...newFiles],
        })),
      removeFile: (id) =>
        set((state) => ({
          files: state.files.filter((f) => f.id !== id),
        })),
      updateFile: (id, partial) =>
        set((state) => ({
          files: state.files.map((f) =>
            f.id === id ? { ...f, ...partial } : f,
          ),
        })),
      clearFiles: () => set({ files: [] }),

      // --- Results ---
      results: [],
      addResult: (result) =>
        set((state) => ({
          results: [...state.results, result],
        })),
      clearResults: () => set({ results: [] }),

      // --- Progress ---
      progress: { ...DEFAULT_PROGRESS },
      setProgress: (partial) =>
        set((state) => {
          const update = typeof partial === 'function' ? partial(state.progress) : partial;
          return { progress: { ...state.progress, ...update } };
        }),

      // --- Export ---
      exportSettings: { ...DEFAULT_EXPORT_SETTINGS },
      setExportSettings: (partial) =>
        set((state) => ({
          exportSettings: { ...state.exportSettings, ...partial },
        })),

      // --- Prompt Settings ---
      promptSettings: { ...DEFAULT_PROMPT_SETTINGS },
      setPromptSettings: (phase, value) =>
        set((state) => ({
          promptSettings: { ...state.promptSettings, [phase]: value },
        })),
      resetPromptSettings: () =>
        set({ promptSettings: { ...DEFAULT_PROMPT_SETTINGS } }),

      // --- Cache Settings ---
      cacheSettings: { ...DEFAULT_CACHE_SETTINGS },
      setCacheExpiryHours: (hours) =>
        set((state) => ({
          cacheSettings: { ...state.cacheSettings, expiryHours: hours },
        })),

      // --- Document Type ---
      documentType: DEFAULT_DOCUMENT_TYPE,
      setDocumentType: (type) => set({ documentType: type }),

      // --- API Settings ---
      apiSettings: { ...DEFAULT_API_SETTINGS },
      setApiSettings: (partial) =>
        set((state) => ({
          apiSettings: { ...state.apiSettings, ...partial },
        })),

      // --- Template Columns ---
      templateColumns: [],
      templatePrompt: '',
      templateGenerated: false,
      setTemplateGenerated: (val) => set({ templateGenerated: val }),
      setTemplateColumns: (columns) => set({ templateColumns: columns }),
      setTemplatePrompt: (prompt) => set({ templatePrompt: prompt }),
      resetTemplate: () =>
        set({ templateColumns: [], templatePrompt: '', templateGenerated: false }),

      // --- Extraction Snapshot (transient) ---
      extractionSnapshot: null,
      setExtractionSnapshot: (snapshot) => set({ extractionSnapshot: snapshot }),
      clearExtractionSnapshot: () => {
        set({ extractionSnapshot: null });
        if (typeof window !== 'undefined') {
          localStorage.removeItem('ocr-extract-snapshot');
        }
      },

      // --- Merged export data ---
      mergedExportData: [],
      setMergedExportData: (rows) => set({ mergedExportData: rows }),

      // --- Review Interaction ---
      selectedField: null,
      selectedFileId: null,
      setSelectedField: (field) => set({ selectedField: field }),
      setSelectedFileId: (fileId) => set({ selectedFileId: fileId }),

      // --- Resume ---
      interruptedSession: null,
      setInterruptedSession: (session) => set({ interruptedSession: session }),
      restoreFromSession: (session) => {
        // Check if session is too old — use configured cache expiry
        set((state) => {
          const expiryHours = state.cacheSettings.expiryHours || 24;
          const ageMs = Date.now() - (session.createdAt ?? 0);
          const isExpired = ageMs > expiryHours * 60 * 60 * 1000;
          if (isExpired) {
            return { interruptedSession: null };
          }
          return {
            step: 'extract',
            files: session.files.map((f) => ({
              id: f.id,
              name: f.name,
              size: f.size,
              type: f.type,
              status: 'parsed' as const,
              sessionId: f.sessionId,
            })),
            templateColumns: session.templateColumns ?? [],
            extractionSnapshot: session.extractionSnapshot,
            progress: {
              totalFiles: session.files.length,
              completedFiles: session.results.length,
              currentFile: '',
              status: 'extraction_done',
            },
            interruptedSession: null,
            results: [],
            mergedExportData: [],
          };
        });
      },
      resetAll: () => {
        if (typeof window !== 'undefined') {
          localStorage.removeItem('ocr-extract-snapshot');
          localStorage.removeItem('ocr-extract-interrupted');
        }
        set({
          step: 'upload',
          files: [],
          results: [],
          progress: { ...DEFAULT_PROGRESS },
          exportSettings: { ...DEFAULT_EXPORT_SETTINGS },
          promptSettings: { ...DEFAULT_PROMPT_SETTINGS },
          cacheSettings: { ...DEFAULT_CACHE_SETTINGS },
          documentType: DEFAULT_DOCUMENT_TYPE,
          templateColumns: [],
          templatePrompt: '',
          templateGenerated: false,
          extractionSnapshot: null,
          selectedField: null,
          selectedFileId: null,
          mergedExportData: [],
          interruptedSession: null,
        });
      },
    }),
    {
      name: 'message-extract-store',
      storage: createJSONStorage(() => {
        // Avoid referencing localStorage during SSR
        if (typeof window === 'undefined') {
          return {
            getItem: () => null,
            setItem: () => {},
            removeItem: () => {},
          };
        }
        return localStorage;
      }),
      // Only persist these slices - wizard step and progress are transient
      // SECURITY: apiKey is excluded from persistence to avoid plaintext storage in localStorage
      partialize: (state) => {
        const hasApiSettings = state.apiSettings.baseUrl || state.apiSettings.apiKey || state.apiSettings.model || state.apiSettings.concurrency;
        return {
          exportSettings: state.exportSettings,
          locale: state.locale,
          promptSettings: state.promptSettings,
          cacheSettings: state.cacheSettings,
          documentType: state.documentType,
          ...(hasApiSettings ? {
            apiSettings: {
              baseUrl: state.apiSettings.baseUrl,
              model: state.apiSettings.model,
              // SECURITY: apiKey is excluded from persistence
              apiKey: '',
            },
          } : {}),
        };
      },
      // Skip hydration on server; the `mounted` flag is used client-side
      skipHydration: true,
      version: 4,
      migrate: (persisted: any, version: number) => {
        if (version < 4) {
          // Remove keyAlign from promptSettings
          if (persisted?.promptSettings) {
            const { keyAlign, ...rest } = persisted.promptSettings;
            persisted.promptSettings = rest;
          }
        }
        return persisted;
      },
      onRehydrateStorage: () => (state) => {
        if (!state || typeof window === 'undefined') return;
        // Detect locale after hydration (SSR-safe)
        const detected = detectLocale();
        if (detected !== state.locale) {
          useStore.setState({ locale: detected });
        }
        // Try to restore extractionSnapshot from localStorage (survives page refresh)
        // onRehydrateStorage fires AFTER hydration is complete, so setState is safe here
        try {
          const raw = localStorage.getItem('ocr-extract-snapshot');
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed.groups?.length > 0 && (parsed.serverSessionId || parsed.results?.length > 0)) {
              useStore.setState({
                extractionSnapshot: {
                  results: parsed.results ?? [],
                  groups: parsed.groups,
                  serverSessionId: parsed.serverSessionId ?? null,
                },
                progress: { ...state.progress, status: 'extraction_done' },
              });
            }
          }
        } catch { /* ignore */ }
      },
    },
  ),
);

/**
 * Helper hook - returns `null` until the zustand store has been hydrated
 * from localStorage.  Use this in components to prevent hydration
 * mismatch flashes.
 */
export function useHydrated() {
  const mounted = useStore((s) => s.mounted);
  const setMounted = useStore((s) => s.setMounted);

  React.useEffect(() => {
    Promise.resolve(useStore.persist.rehydrate()).then(() => {
      setMounted(true);
    });
  }, [setMounted]);

  return mounted;
}
