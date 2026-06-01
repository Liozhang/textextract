/**
 * Build JSON payload for curl testing, then call API.
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const DATA_DIR = 'D:/下载/某院临床信息';
const OUTPUT_JSON = path.join('D:/github_code/OCR-extract', 'scripts', 'test-payload.json');
const OUTPUT_SSE = path.join('D:/github_code/OCR-extract', 'scripts', 'test-sse-output.txt');

// Use 10 files from 2 patients
const FILES = [
  '10-刘维斗1.jpg', '10-刘维斗2.jpg', '10-刘维斗3.jpg',
  '10-刘维斗4.jpg', '10-刘维斗5.jpg',
  '11-李长平1.jpg', '11-李长平2.jpg', '11-李长平3.jpg',
  '11-李长平4.jpg', '11-李长平5.jpg',
];

const files = FILES.map((name, i) => {
  const filePath = path.join(DATA_DIR, name);
  const buffer = fs.readFileSync(filePath);
  const base64 = buffer.toString('base64');
  const ext = name.split('.').pop().toLowerCase();
  const mimeType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
  return {
    id: String(i),
    name,
    size: buffer.length,
    type: mimeType,
    content: base64,
    dataUrl: `data:${mimeType};base64,${base64}`,
  };
});

const totalSizeMB = (files.reduce((acc, f) => acc + f.size, 0) / (1024 * 1024)).toFixed(1);
console.log(`Payload: ${FILES.length} files, ${totalSizeMB} MB`);

const body = { files };
fs.writeFileSync(OUTPUT_JSON, JSON.stringify(body));
console.log(`Payload saved to ${OUTPUT_JSON}`);
console.log(`\nCalling API via curl (this will take several minutes)...`);
console.log(`Output will stream to ${OUTPUT_SSE}`);

try {
  execSync(
    `curl -s -N --max-time 900 -X POST http://localhost:3000/api/extract -H "Content-Type: application/json" -d @${OUTPUT_JSON} > ${OUTPUT_SSE}`,
    { stdio: 'inherit', maxBuffer: 1024 * 1024 * 500 }
  );
  console.log('\nDone!');
} catch (err) {
  console.error('Curl error:', err.message);
}
