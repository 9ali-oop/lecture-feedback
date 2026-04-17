/**
 * Convert every .md file in report/usability-study/ into a print-ready PDF.
 *
 * Usage:
 *   node scripts/convert-md-to-pdf.mjs
 *
 * Output:
 *   report/usability-study/print-ready/*.pdf
 *
 * Pipeline: marked (MD → HTML) → Edge headless (HTML → PDF).
 * Requires Microsoft Edge on Windows. Already present on Ali's machine.
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join, relative, basename, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { marked } = require('marked');

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(__dirname);
const SRC_DIR = join(REPO_ROOT, 'report', 'usability-study');
const OUT_DIR = join(SRC_DIR, 'print-ready');

const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
const EDGE_PATH = EDGE_CANDIDATES.find((p) => {
  try { statSync(p); return true; } catch { return false; }
});
if (!EDGE_PATH) {
  console.error('Microsoft Edge not found. Install Edge or edit EDGE_CANDIDATES in this script.');
  process.exit(1);
}

const PRINT_CSS = `
  @page { size: A4; margin: 18mm; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;
    font-size: 11pt;
    line-height: 1.5;
    color: #111;
  }
  .doc-title {
    font-size: 9pt;
    color: #888;
    margin-bottom: 10pt;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 500;
  }
  h1 { font-size: 22pt; margin: 0 0 12pt 0; line-height: 1.2; }
  h2 { font-size: 15pt; margin: 18pt 0 8pt 0; border-bottom: 1px solid #ddd; padding-bottom: 3pt; }
  h3 { font-size: 13pt; margin: 14pt 0 6pt 0; }
  h4 { font-size: 12pt; margin: 10pt 0 4pt 0; }
  p { margin: 0 0 8pt 0; }
  code {
    font-family: 'Cascadia Code', 'Consolas', 'Monaco', monospace;
    background: #f2f2f2;
    padding: 1px 5px;
    border-radius: 3px;
    font-size: 0.9em;
  }
  pre {
    background: #f6f6f6;
    padding: 10pt;
    border-radius: 4pt;
    overflow-x: auto;
    font-size: 9pt;
    line-height: 1.4;
    page-break-inside: avoid;
  }
  pre code { background: none; padding: 0; font-size: 9pt; }
  blockquote {
    border-left: 3px solid #bbb;
    margin: 0 0 8pt 0;
    padding: 2pt 0 2pt 12pt;
    color: #444;
    font-style: italic;
  }
  table {
    border-collapse: collapse;
    margin: 8pt 0 12pt 0;
    width: 100%;
    font-size: 10pt;
    page-break-inside: avoid;
  }
  th, td {
    border: 1px solid #bbb;
    padding: 5pt 8pt;
    text-align: left;
    vertical-align: top;
  }
  th { background: #efefef; font-weight: 600; }
  ul, ol { margin: 0 0 8pt 0; padding-left: 22pt; }
  li { margin-bottom: 3pt; }
  li p { margin: 0; }
  hr { border: none; border-top: 1px solid #ccc; margin: 14pt 0; }
  a { color: #0a66c2; text-decoration: none; }
  strong { color: #000; }
  input[type="checkbox"] { margin-right: 4pt; }
`;

marked.setOptions({
  breaks: false,
  gfm: true,
});

function findMarkdownFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      // Skip output dirs and working dirs
      if (['print-ready', 'results', 'evidence', 'node_modules'].includes(entry)) continue;
      results.push(...findMarkdownFiles(full));
    } else if (entry.toLowerCase().endsWith('.md')) {
      results.push(full);
    }
  }
  return results;
}

function renderHtml(mdContent, title, relPath) {
  const body = marked.parse(mdContent);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<style>${PRINT_CSS}</style>
</head>
<body>
<div class="doc-title">${relPath}</div>
${body}
</body>
</html>`;
}

function flatName(relPath) {
  // Convert subdir paths to flat filenames: WALK-IN-PACK/04-script.md -> WALK-IN-PACK__04-script
  return relPath.split(sep).join('__').replace(/\.md$/i, '');
}

// ---- main ----
mkdirSync(OUT_DIR, { recursive: true });
const files = findMarkdownFiles(SRC_DIR).sort();
console.log(`Found ${files.length} markdown files under ${relative(REPO_ROOT, SRC_DIR)}`);

let converted = 0;
let failed = 0;

for (const file of files) {
  const rel = relative(SRC_DIR, file);
  const md = readFileSync(file, 'utf8');
  const title = basename(file, '.md');
  const html = renderHtml(md, title, rel.split(sep).join('/'));

  const name = flatName(rel);
  const htmlPath = join(OUT_DIR, `${name}.html`);
  const pdfPath = join(OUT_DIR, `${name}.pdf`);

  writeFileSync(htmlPath, html);

  const htmlUrl = pathToFileURL(htmlPath).href;
  try {
    execFileSync(
      EDGE_PATH,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-pdf-header-footer',
        `--print-to-pdf=${pdfPath}`,
        htmlUrl,
      ],
      { stdio: 'pipe', timeout: 30000 },
    );
    console.log(`  ✓ ${rel} → ${name}.pdf`);
    converted++;
  } catch (err) {
    console.error(`  ✗ ${rel} failed: ${err.message.split('\n')[0]}`);
    failed++;
  } finally {
    try { unlinkSync(htmlPath); } catch { /* leave it */ }
  }
}

console.log('');
console.log(`Converted: ${converted}`);
if (failed) console.log(`Failed:    ${failed}`);
console.log(`Output:    ${OUT_DIR}`);
console.log('');
console.log('Open the folder, select all PDFs, right-click → Print.');
console.log('Or print individual ones from File Explorer or a PDF viewer.');
