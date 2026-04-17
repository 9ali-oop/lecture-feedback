#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const outFile = path.join(repoRoot, 'apps', 'api', '.tunnel-url');

const child = spawn('cloudflared', ['tunnel', '--url', 'http://localhost:5173'], {
  stdio: ['inherit', 'pipe', 'pipe'],
  shell: true,
});

const urlRegex = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;
let captured = false;

function onData(buf) {
  const s = buf.toString();
  process.stdout.write(s);
  if (!captured) {
    const m = s.match(urlRegex);
    if (m) {
      captured = true;
      const url = m[0];
      writeFile(outFile, url, 'utf8').then(() => {
        console.log(`\n[dev-tunnel] wrote ${outFile} -> ${url}\n`);
      }).catch((err) => {
        console.error('[dev-tunnel] failed to write tunnel file:', err);
      });
    }
  }
}

child.stdout.on('data', onData);
child.stderr.on('data', onData);

async function cleanup() {
  try { await unlink(outFile); } catch {}
  child.kill();
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
child.on('exit', async (code) => {
  try { await unlink(outFile); } catch {}
  process.exit(code ?? 0);
});
