import React from 'react';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { detectLocale, type Locale } from './i18n';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WizardStep = 'upload' | 'review' | 'export';

export interface AppFile {
  id: string;
  name: string;
  size: number;
  type: string;
  content?: string;
  dataUrl?: string;
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
  error?: string;
}

export type ExtractionStatus = 'idle' | 'extracting' | 'done' | 'error';

export interface ExtractionProgress {
  totalFiles: number;
  completedFiles: number;
  currentFile: string;
  status: ExtractionStatus;
}

export type ExportFormat = 'xlsx' | 'csv' | 'json';

export interface ExportSettings {
  format: ExportFormat;
}

export interface PromptSettings {
  extraction: string;
  schemaAlign: string;
  merge: string;
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

  // Prompt settings (empty string = use default)
  promptSettings: PromptSettings;
  setPromptSettings: (phase: keyof PromptSettings, value: string) => void;
  resetPromptSettings: () => void;

  // Merged export data (synced from review panel after backend pipeline)
  mergedExportData: MergedExportRow[];
  setMergedExportData: (rows: MergedExportRow[]) => void;

  // Reset everything
  resetAll: () => void;
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

const DEFAULT_PROMPT_SETTINGS: PromptSettings = {
  extraction: '',
  schemaAlign: '',
  merge: '',
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
      locale: detectLocale(),
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

      // --- Merged export data ---
      mergedExportData: [],
      setMergedExportData: (rows) => set({ mergedExportData: rows }),

      // --- Review Interaction ---
      selectedField: null,
      selectedFileId: null,
      setSelectedField: (field) => set({ selectedField: field }),
      setSelectedFileId: (fileId) => set({ selectedFileId: fileId }),

      // --- Reset ---
      resetAll: () =>
        set({
          step: 'upload',
          files: [],
          results: [],
          progress: { ...DEFAULT_PROGRESS },
          exportSettings: { ...DEFAULT_EXPORT_SETTINGS },
          promptSettings: { ...DEFAULT_PROMPT_SETTINGS },
          selectedField: null,
          selectedFileId: null,
          mergedExportData: [],
        }),
    }),
    {
      name: 'ai-doc-extraction-store',
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
      partialize: (state) => ({
        exportSettings: state.exportSettings,
        locale: state.locale,
        promptSettings: state.promptSettings,
      }),
      // Skip hydration on server; the `mounted` flag is used client-side
      skipHydration: true,
      // Version migration: clean up old template data from version 0
      version: 1,
      migrate: (persisted, version) => {
        if (version === 0) {
          const p = persisted as any;
          delete p.template;
        }
        return persisted as any;
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
