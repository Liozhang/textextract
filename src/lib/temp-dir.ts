import { tmpdir } from 'os';
import { join } from 'path';

/**
 * Get the temp directory for OCR file storage.
 * In Electron, uses ELECTRON_TMPDIR env var (set by main process).
 * In web/server mode, falls back to system tmpdir + 'ocr-extract'.
 */
export function getTempDir(): string {
  return process.env.ELECTRON_TMPDIR || join(tmpdir(), 'ocr-extract');
}
