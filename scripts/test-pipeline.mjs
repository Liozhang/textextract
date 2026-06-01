/**
 * Pipeline integration test script.
 * Reads image files from disk, sends to /api/extract, parses SSE response,
 * and saves structured results for analysis.
 *
 * Usage: bun scripts/test-pipeline.mjs
 */
import fs from 'fs';
import path from 'path';

const BASE_URL = 'http://localhost:3000';
const DATA_DIR = 'D:/下载/某院临床信息';

// Pick 10 files from 2 patients (smaller files for speed)
const FILES = [
  // Patient 10-刘维斗 (5 files)
  '10-刘维斗1.jpg', '10-刘维斗2.jpg', '10-刘维斗3.jpg',
  '10-刘维斗4.jpg', '10-刘维斗5.jpg',
  // Patient 11-李长平 (5 files)
  '11-李长平1.jpg', '11-李长平2.jpg', '11-李长平3.jpg',
  '11-李长平4.jpg', '11-李长平5.jpg',
];

async function main() {
  console.log(`=== Pipeline Integration Test ===`);
  console.log(`Files: ${FILES.length}`);
  console.log('');

  // Prepare file payloads
  const filePayloads = FILES.map((name, i) => {
    const filePath = path.join(DATA_DIR, name);
    const buffer = fs.readFileSync(filePath);
    const base64 = buffer.toString('base64');
    const ext = name.split('.').pop().toLowerCase();
    const mimeType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
    const dataUrl = `data:${mimeType};base64,${base64}`;
    return {
      id: String(i),
      name,
      size: buffer.length,
      type: mimeType,
      content: base64,
      dataUrl,
    };
  });

  const totalSizeMB = (filePayloads.reduce((acc, f) => acc + f.size, 0) / (1024 * 1024)).toFixed(1);
  console.log(`Total payload size: ${totalSizeMB} MB`);
  console.log('');

  // Build request body
  const body = {
    files: filePayloads.map(f => ({
      id: f.id,
      name: f.name,
      size: f.size,
      type: f.type,
      content: f.content,
      dataUrl: f.dataUrl,
    })),
  };

  console.log('Sending POST to /api/extract ...');
  const startTime = Date.now();

  const response = await fetch(`${BASE_URL}/api/extract`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`HTTP ${response.status}: ${errorText}`);
    process.exit(1);
  }

  console.log(`Connected, reading SSE stream ...`);

  // Parse SSE events
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const events = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Split by double newline (SSE event boundary)
    const parts = buffer.split('\n\n');
    buffer = parts.pop() || ''; // keep incomplete part

    for (const part of parts) {
      const lines = part.trim().split('\n');
      let eventType = 'message';
      let data = '';

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          eventType = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          data = line.slice(6);
        }
      }

      if (data) {
        try {
          const parsed = JSON.parse(data);
          events.push({ event: eventType, data: parsed, time: Date.now() - startTime });
        } catch {
          events.push({ event: eventType, data, time: Date.now() - startTime });
        }
      }
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nDone in ${elapsed}s. Total events: ${events.length}`);
  console.log('');

  // Analyze events
  const analysis = {
    totalDuration: elapsed,
    phases: [],
    fileResults: [],
    grouping: null,
    schema: null,
    mergeResults: [],
    finalResult: null,
    errors: [],
  };

  for (const evt of events) {
    const { event, data, time } = evt;

    if (event === 'phase') {
      console.log(`[${time}s] Phase: ${data.phase}`);
      analysis.phases.push({ phase: data.phase, time });
    }
    else if (event === 'grouping_done') {
      analysis.grouping = data;
      console.log(`[${time}s] Groups: ${JSON.stringify(data.groups.map(g => g.label))}`);
    }
    else if (event === 'file_start') {
      console.log(`[${time}s] Extracting: ${data.fileName}`);
    }
    else if (event === 'file_complete') {
      analysis.fileResults.push(data);
      const status = data.success ? 'OK' : `FAIL: ${data.error}`;
      const fieldCount = data.data ? Object.keys(data.data).length : 0;
      console.log(`[${time}s] ${data.fileName}: ${status} (${fieldCount} fields)`);
    }
    else if (event === 'file_retry') {
      console.log(`[${time}s] Retry ${data.fileName} (attempt ${data.attempt})`);
    }
    else if (event === 'schema_ready') {
      analysis.schema = data;
      console.log(`[${time}s] Schema: ${data.headers.length} headers`);
    }
    else if (event === 'merge_start') {
      console.log(`[${time}s] Merging group: ${data.label} (${data.fileCount} files)`);
    }
    else if (event === 'group_merged') {
      analysis.mergeResults.push(data);
      console.log(`[${time}s] Merged: ${data.groupKey} (method=${data.mergeMethod}, conflicts=${data.conflicts.length})`);
    }
    else if (event === 'all_done') {
      analysis.finalResult = data;
      console.log(`\n[${time}s] === FINAL RESULT ===`);
      console.log(`  Total files: ${data.totalFiles}`);
      console.log(`  Total groups: ${data.totalGroups}`);
      console.log(`  Merged groups: ${data.mergedGroups}`);
      console.log(`  Output rows: ${data.rows.length}`);
    }
    else if (event === 'error') {
      analysis.errors.push(data);
      console.error(`[${time}s] ERROR: ${data.message}`);
    }
  }

  // Detailed output of final rows
  if (analysis.finalResult) {
    console.log('\n=== ROW DETAILS ===\n');
    for (const row of analysis.finalResult.rows) {
      console.log(`--- Row: ${row.label} (merged=${row.isMerged}, method=${row.mergeMethod}) ---`);
      console.log(`  Source files: ${row.sourceFiles.join(', ')}`);
      const fields = Object.entries(row.data);
      console.log(`  Fields (${fields.length}):`);
      for (const [key, value] of fields) {
        const val = String(value);
        const display = val.length > 100 ? val.slice(0, 100) + '...' : val;
        console.log(`    ${key}: ${display}`);
      }
      console.log('');
    }
  }

  // Save raw results to file for analysis
  const outputPath = path.join('D:/github_code/OCR-extract', 'scripts', 'test-results.json');
  fs.writeFileSync(outputPath, JSON.stringify({
    analysis,
    allEvents: events.map(e => ({ event: e.event, data: e.data, time: e.time })),
  }, null, 2));
  console.log(`\nFull results saved to: ${outputPath}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
