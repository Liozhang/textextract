/**
 * capture-readme-screenshots.mjs
 *
 * Captures README screenshots with fake/dummy data.
 * Requires: dev server running on localhost:3000
 * Usage: node scripts/capture-readme-screenshots.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'docs', 'screenshots');
const BASE = 'http://localhost:3000';

mkdirSync(OUT_DIR, { recursive: true });

// ── Fake data ────────────────────────────────────────────────────────

const FAKE_FILES = [
  { id: 'f1', name: 'report-001.png', size: 245_760, type: 'image/png', status: 'parsed' },
  { id: 'f2', name: 'report-002.jpg', size: 189_440, type: 'image/jpeg', status: 'parsed' },
  { id: 'f3', name: 'report-003.png', size: 312_320, type: 'image/png', status: 'parsed' },
  { id: 'f4', name: 'labresult-001.png', size: 156_000, type: 'image/png', status: 'parsed' },
  { id: 'f5', name: 'labresult-002.jpg', size: 210_500, type: 'image/jpeg', status: 'parsed' },
  { id: 'f6', name: 'pathology-001.png', size: 478_200, type: 'image/png', status: 'parsed' },
];

const FAKE_TEMPLATE_COLUMNS = [
  { key: 'patientName', type: 'string', description: 'Patient Name' },
  { key: 'bedNo', type: 'string', description: 'Bed Number' },
  { key: 'gender', type: 'string', description: 'Gender' },
  { key: 'age', type: 'string', description: 'Age' },
  { key: 'specimen', type: 'string', description: 'Specimen Type' },
  { key: 'testItem', type: 'string', description: 'Test Item' },
  { key: 'result', type: 'string', description: 'Test Result' },
  { key: 'referenceRange', type: 'string', description: 'Reference Range', repeating: true },
  { key: 'abnormalFlag', type: 'boolean', description: 'Abnormal Flag' },
];

const FAKE_RESULTS = FAKE_FILES.map((f, i) => ({
  fileId: f.id,
  fileName: f.name,
  success: true,
  data: {
    patientName: i < 3 ? 'Sample A' : i < 5 ? 'Sample B' : 'Sample C',
    bedNo: `${String(100 + i).padStart(3, '0')}`,
    gender: i % 2 === 0 ? 'Male' : 'Female',
    age: `${45 + i * 3}`,
    specimen: ['Blood', 'Urine', 'Tissue'][i % 3],
    testItem: ['CBC', 'Biochemistry', 'Pathology'][i % 3],
    result: i % 2 === 0 ? 'Normal' : 'Elevated',
    referenceRange: '4.0-10.0',
    abnormalFlag: i % 3 === 0,
  },
}));

const FAKE_GROUPS = [
  { groupId: 'g1', groupKey: 'report', fileCount: 3 },
  { groupId: 'g2', groupKey: 'labresult', fileCount: 2 },
  { groupId: 'g3', groupKey: 'pathology', fileCount: 1 },
];

const FAKE_MERGED_DATA = [
  {
    label: 'report - 3 files',
    groupId: 'g1',
    data: {
      patientName: 'Sample A',
      bedNo: '101',
      gender: 'Male',
      age: '45',
      specimen: 'Blood',
      testItem: 'CBC',
      result: 'Normal',
      referenceRange: '4.0-10.0',
      abnormalFlag: false,
    },
    sourceFiles: ['report-001.png', 'report-002.png', 'report-003.png'],
    success: true,
  },
  {
    label: 'labresult - 2 files',
    groupId: 'g2',
    data: {
      patientName: 'Sample B',
      bedNo: '104',
      gender: 'Female',
      age: '51',
      specimen: 'Urine',
      testItem: 'Biochemistry',
      result: 'Elevated',
      referenceRange: '2.5-7.5',
      abnormalFlag: true,
    },
    sourceFiles: ['labresult-001.png', 'labresult-002.jpg'],
    success: true,
  },
  {
    label: 'pathology - 1 file',
    groupId: 'g3',
    data: {
      patientName: 'Sample C',
      bedNo: '106',
      gender: 'Male',
      age: '57',
      specimen: 'Tissue',
      testItem: 'Pathology',
      result: 'Normal',
      referenceRange: 'N/A',
      abnormalFlag: false,
    },
    sourceFiles: ['pathology-001.png'],
    success: true,
  },
];

// ── Helpers ────────────────────────────────────────────────────────────

async function setStoreState(page, state) {
  await page.evaluate((s) => window.__store.setState(s), state);
}

async function resetStore(page) {
  await page.evaluate(() => window.__store.getState().resetAll());
}

async function screenshot(page, name) {
  const path = join(OUT_DIR, name);
  await page.screenshot({ path, fullPage: false });
  console.log(`  Captured: ${name}`);
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
  });
  const page = await context.newPage();

  // Wait for HMR to pick up store change
  console.log('Connecting to dev server...');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Verify store is exposed
  const storeReady = await page.evaluate(() => typeof window.__store !== 'undefined');
  if (!storeReady) {
    console.error('ERROR: window.__store not available. Make sure the store patch is applied and HMR completed.');
    await browser.close();
    process.exit(1);
  }
  console.log('Store exposed, starting capture...\n');

  // ── 01-initial.png ──────────────────────────────────────────────────
  await resetStore(page);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await screenshot(page, '01-initial.png');

  // ── 02-uploaded.png ─────────────────────────────────────────────────
  await setStoreState(page, {
    files: FAKE_FILES,
  });
  await page.waitForTimeout(500);
  await screenshot(page, '02-uploaded.png');

  // ── 03a-template-preset.png ─────────────────────────────────────────
  // Navigate to template step
  await setStoreState(page, {
    step: 'template',
    files: FAKE_FILES,
  });
  await page.waitForTimeout(800);
  await screenshot(page, '03a-template-preset.png');

  // ── 03b-template-confirm.png ────────────────────────────────────────
  await setStoreState(page, {
    step: 'template',
    files: FAKE_FILES,
    templateColumns: FAKE_TEMPLATE_COLUMNS,
    templateGenerated: true,
    progress: { status: 'template_configured' },
  });
  await page.waitForTimeout(800);
  await screenshot(page, '03b-template-confirm.png');

  // ── 04-extracting.png ───────────────────────────────────────────────
  await setStoreState(page, {
    step: 'extract',
    files: FAKE_FILES,
    templateColumns: FAKE_TEMPLATE_COLUMNS,
    templateGenerated: true,
    progress: {
      totalFiles: 6,
      completedFiles: 3,
      currentFile: 'report-003.png',
      status: 'extracting',
    },
    results: FAKE_RESULTS.slice(0, 3),
  });
  await page.waitForTimeout(800);
  await screenshot(page, '04-extracting.png');

  // ── 05-extraction-done.png ──────────────────────────────────────────
  await setStoreState(page, {
    step: 'extract',
    files: FAKE_FILES,
    templateColumns: FAKE_TEMPLATE_COLUMNS,
    templateGenerated: true,
    progress: {
      totalFiles: 6,
      completedFiles: 6,
      currentFile: '',
      status: 'extraction_done',
    },
    results: FAKE_RESULTS,
    extractionSnapshot: {
      results: FAKE_RESULTS.map((r, i) => ({
        ...r,
        groupId: FAKE_GROUPS[i % 3].groupId,
      })),
      groups: FAKE_GROUPS,
      serverSessionId: 'fake-session-123',
    },
  });
  await page.waitForTimeout(800);
  await screenshot(page, '05-extraction-done.png');

  // ── 06a-align-merge-step.png ──────────────────────────────────────
  await setStoreState(page, {
    step: 'align_merge',
    files: FAKE_FILES,
    templateColumns: FAKE_TEMPLATE_COLUMNS,
    templateGenerated: true,
    progress: {
      totalFiles: 6,
      completedFiles: 6,
      currentFile: '',
      status: 'extraction_done',
    },
    results: FAKE_RESULTS,
    mergedExportData: FAKE_MERGED_DATA,
    extractionSnapshot: {
      results: FAKE_RESULTS.map((r, i) => ({
        ...r,
        groupId: FAKE_GROUPS[i % 3].groupId,
      })),
      groups: FAKE_GROUPS,
      serverSessionId: 'fake-session-123',
    },
  });
  await page.waitForTimeout(800);
  await screenshot(page, '06a-align-merge-step.png');

  // ── 07-export.png ──────────────────────────────────────────────────
  await setStoreState(page, {
    step: 'export',
    files: FAKE_FILES,
    templateColumns: FAKE_TEMPLATE_COLUMNS,
    templateGenerated: true,
    progress: {
      totalFiles: 6,
      completedFiles: 6,
      currentFile: '',
      status: 'done',
    },
    results: FAKE_RESULTS,
    mergedExportData: FAKE_MERGED_DATA,
    extractionSnapshot: null,
  });
  await page.waitForTimeout(800);
  await screenshot(page, '07-export.png');

  // ── 08-settings.png ────────────────────────────────────────────────
  // Navigate to upload step with some files visible
  await setStoreState(page, {
    step: 'upload',
    files: FAKE_FILES,
    templateColumns: FAKE_TEMPLATE_COLUMNS,
    templateGenerated: true,
    progress: { status: 'template_configured' },
    results: [],
    mergedExportData: [],
    extractionSnapshot: null,
  });
  await page.waitForTimeout(500);

  // Settings button: <Button variant="ghost" size="icon" aria-label={t('settings.title')}>
  // It's the 2nd icon button in the header's flex gap-2 container (after reset, before language)
  // The aria-label value depends on locale, so we click by position in the header
  // Header structure: [title area] ... [ResetBtn] [SettingsBtn] [LanguageSwitcher]
  const headerBtns = await page.$$('header button, [class*="sticky"] button');
  // Try aria-label match first (both zh and en)
  let clicked = false;
  for (const btn of headerBtns) {
    const label = await btn.getAttribute('aria-label') || '';
    if (label.includes('\u8BBE\u7F6E') || label.includes('Settings') || label.toLowerCase().includes('setting')) {
      await btn.click();
      clicked = true;
      break;
    }
  }
  // Fallback: click the 2nd icon-sized button in the header actions area
  if (!clicked) {
    // The settings button is the one containing an SVG that looks like a gear
    const allBtns = await page.$$('button');
    for (const btn of allBtns) {
      const svgHtml = await btn.innerHTML();
      // Lucide Settings icon has path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18"
      if (svgHtml.includes('size-4') && svgHtml.includes('M12.22')) {
        await btn.click();
        clicked = true;
        break;
      }
    }
  }
  if (clicked) {
    await page.waitForTimeout(1500);
  } else {
    console.warn('WARNING: Settings button not found, trying direct DOM open');
  }

  await screenshot(page, '08-settings.png');

  // ── Cleanup ─────────────────────────────────────────────────────────
  await browser.close();
  console.log('\nAll screenshots captured successfully!');
}

main().catch((err) => {
  console.error('Screenshot capture failed:', err);
  process.exit(1);
});
