import { tmpdir } from 'os';
import { join } from 'path';

/**
 * Get the temp directory for OCR file storage.
 * Priority: OCR_CACHE_DIR > ELECTRON_TMPDIR > system tmpdir + 'ocr-extract'.
 */
export function getTempDir(): string {
  return process.env.OCR_CACHE_DIR || process.env.ELECTRON_TMPDIR || join(tmpdir(), 'ocr-extract');
}
