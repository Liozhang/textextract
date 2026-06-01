'use client';

import { useState, useRef, useCallback } from 'react';
import {
  Upload,
  X,
  FileText,
  FileSpreadsheet,
  FileImage,
  FileType2,
  File,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

import { useStore } from '@/lib/store';
import { useT } from '@/lib/i18n';
import type { AppFile } from '@/lib/store';
import { generateId, formatFileSize } from '@/lib/utils';

// ---- helpers ----

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB per file
const MAX_FILE_COUNT = 100;

const ACCEPTED_EXTENSIONS = [
  '.pdf',
  '.docx',
  '.xlsx',
  '.txt',
  '.md',
  '.csv',
  '.json',
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
];

const ACCEPT_STRING = ACCEPTED_EXTENSIONS.join(',');

function getFileExtension(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx >= 0 ? name.slice(idx).toLowerCase() : '';
}

function getFileIcon(name: string) {
  const ext = getFileExtension(name);
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) return <FileImage className="size-5 text-emerald-500" />;
  if (['.xlsx', '.xls', '.csv'].includes(ext)) return <FileSpreadsheet className="size-5 text-green-600" />;
  if (['.docx'].includes(ext)) return <FileType2 className="size-5 text-blue-500" />;
  if (['.pdf'].includes(ext)) return <FileText className="size-5 text-red-500" />;
  if (['.txt', '.md', '.json'].includes(ext)) return <FileText className="size-5 text-orange-500" />;
  return <File className="size-5 text-muted-foreground" />;
}

function getStatusBadge(t: ReturnType<typeof useT>, status: AppFile['status']) {
  switch (status) {
    case 'pending':
      return <Badge variant="secondary">{t('upload.pending')}</Badge>;
    case 'parsed':
      return <Badge variant="default">{t('upload.parsed')}</Badge>;
    case 'error':
      return <Badge variant="destructive">{t('upload.error')}</Badge>;
  }
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.replace(/^data:[^;]+;base64,/, '');
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('File read failed'));
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('File read failed'));
    reader.readAsText(file);
  });
}

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('File read failed'));
    reader.readAsDataURL(file);
  });
}

// ---- component ----

export default function FileUploadPanel() {
  const t = useT();
  const files = useStore((s) => s.files);
  const addFiles = useStore((s) => s.addFiles);
  const removeFile = useStore((s) => s.removeFile);
  const updateFile = useStore((s) => s.updateFile);
  const clearFiles = useStore((s) => s.clearFiles);
  const progress = useStore((s) => s.progress);

  const isPipelineActive = progress.status === 'extracting' || progress.status === 'aligning_merging';

  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Process each file using FileReader based on type
  const processFile = useCallback(
    async (rawFile: File, appFile: AppFile) => {
      const ext = getFileExtension(rawFile.name);

      try {
        if (['.txt', '.md', '.csv', '.json'].includes(ext)) {
          const content = await readFileAsText(rawFile);
          updateFile(appFile.id, { content, status: 'parsed' });
        } else if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
          const dataUrl = await readFileAsDataURL(rawFile);
          updateFile(appFile.id, { dataUrl, status: 'parsed' });
        } else {
          // Binary files: .pdf, .docx, .xlsx etc.
          const base64 = await readFileAsBase64(rawFile);
          updateFile(appFile.id, { dataUrl: `data:application/octet-stream;base64,${base64}`, status: 'parsed' });
        }
      } catch {
        updateFile(appFile.id, {
          status: 'error',
          error: t('upload.readFailed'),
        });
      }
    },
    [updateFile, t],
  );

  // Add files from a FileList
  const handleFileList = useCallback(
    (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;
      if (isPipelineActive) return;

      // Enforce max file count
      const remaining = MAX_FILE_COUNT - files.length;
      if (remaining <= 0) {
        toast.error(t('upload.maxFilesReached', { count: MAX_FILE_COUNT }));
        return;
      }

      const newAppFiles: AppFile[] = [];

      for (let i = 0; i < fileList.length; i++) {
        if (newAppFiles.length >= remaining) {
          toast.error(t('upload.maxFilesExceeded', { count: MAX_FILE_COUNT }));
          break;
        }
        const rawFile = fileList[i];
        const ext = getFileExtension(rawFile.name);

        if (!ACCEPTED_EXTENSIONS.includes(ext)) {
          toast.error(t('upload.unsupported', { format: ext }));
          continue;
        }

        const id = generateId();

        if (rawFile.size > MAX_FILE_SIZE) {
          toast.error(t('upload.tooLarge', { name: rawFile.name }));
          continue;
        }

        const appFile: AppFile = {
          id,
          name: rawFile.name,
          size: rawFile.size,
          type: rawFile.type || ext,
          status: 'pending',
        };
        newAppFiles.push(appFile);
        // Fire-and-forget processing
        processFile(rawFile, appFile);
      }

      if (newAppFiles.length > 0) {
        addFiles(newAppFiles);
      }
    },
    [addFiles, processFile, t, isPipelineActive],
  );

  // Drag events
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isPipelineActive) setDragOver(true);
  }, [isPipelineActive]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      if (!isPipelineActive) handleFileList(e.dataTransfer.files);
    },
    [handleFileList, isPipelineActive],
  );

  // Click to open file picker
  const handleZoneClick = useCallback(() => {
    if (!isPipelineActive) inputRef.current?.click();
  }, [isPipelineActive]);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      handleFileList(e.target.files);
      // Reset so same file can be re-selected
      e.target.value = '';
    },
    [handleFileList],
  );

  // Totals
  const totalCount = files.length;
  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('upload.title')}</CardTitle>
        <CardDescription>{t('upload.description')}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Drop zone */}
        <div
          role="button"
          tabIndex={0}
          onClick={handleZoneClick}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') handleZoneClick();
          }}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`
            flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed
            p-10 transition-colors select-none
            ${
              isPipelineActive
                ? 'border-muted-foreground/10 cursor-not-allowed opacity-50'
                : dragOver
                  ? 'border-primary bg-primary/5 cursor-pointer'
                  : 'border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50 cursor-pointer'
            }
          `}
        >
          <Upload className={`size-10 ${dragOver ? 'text-primary' : 'text-muted-foreground'}`} />
          <p className="text-sm text-center text-muted-foreground">
            {t('upload.dropzone')}
          </p>
          <p className="text-xs text-muted-foreground/70">
            {t('upload.supported')} {ACCEPTED_EXTENSIONS.join(', ')}
          </p>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_STRING}
          multiple
          className="hidden"
          onChange={handleInputChange}
        />

        {/* File list */}
        {files.length > 0 && (
          <>
            {/* Stats bar */}
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                {t('upload.stats', { count: totalCount, size: formatFileSize(totalSize) })}
              </span>
              <Button variant="ghost" size="sm" onClick={clearFiles} disabled={isPipelineActive} className="gap-1.5 text-destructive hover:text-destructive">
                <Trash2 className="size-4" />
                {t('upload.clearAll')}
              </Button>
            </div>

            {/* List */}
            <div className="max-h-64 space-y-2 overflow-y-auto rounded-md border p-2">
              {files.map((file) => (
                <div
                  key={file.id}
                  className="flex items-center gap-3 rounded-md px-3 py-2 hover:bg-muted/50 transition-colors"
                >
                  {getFileIcon(file.name)}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{file.name}</p>
                    <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {getStatusBadge(t, file.status)}
                    <button
                      onClick={() => removeFile(file.id)}
                      disabled={isPipelineActive}
                      className={`rounded-sm p-1 transition-colors ${
                        isPipelineActive
                          ? 'text-muted-foreground/30 cursor-not-allowed'
                          : 'text-muted-foreground hover:text-destructive'
                      }`}
                      aria-label={t('upload.remove', { name: file.name })}
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
