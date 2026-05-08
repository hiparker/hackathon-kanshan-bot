#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, stat, unlink } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'node:https';
import { request as httpRequest } from 'node:http';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const manifestPath = resolve(repoRoot, 'assets/model/manifest.json');
const targetDir = resolve(repoRoot, 'assets/model');

const force = process.argv.includes('--force');

async function main() {
  if (!existsSync(manifestPath)) {
    console.error(`[assets:fetch] manifest not found: ${manifestPath}`);
    process.exit(1);
  }

  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const models = Array.isArray(manifest.models) ? manifest.models : [];

  if (models.length === 0) {
    console.warn('[assets:fetch] manifest has no models, skipping.');
    return;
  }

  await mkdir(targetDir, { recursive: true });

  for (const model of models) {
    if (!model || typeof model.fileName !== 'string' || typeof model.url !== 'string') {
      console.warn('[assets:fetch] skipping malformed entry:', model);
      continue;
    }
    await fetchOne(model);
  }
}

async function fetchOne({ id, fileName, url }) {
  const targetPath = resolve(targetDir, fileName);
  const tag = id ?? fileName;

  if (!force && existsSync(targetPath)) {
    const info = await stat(targetPath);
    console.log(`[assets:fetch] ${tag} already present (${formatBytes(info.size)}), skip.`);
    return;
  }

  const tempPath = `${targetPath}.downloading`;
  if (existsSync(tempPath)) await unlink(tempPath).catch(() => undefined);

  const startedAt = Date.now();
  console.log(`[assets:fetch] downloading ${tag} from ${url} ...`);
  await downloadToFile(url, tempPath);
  await rename(tempPath, targetPath);
  const info = await stat(targetPath);
  const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`[assets:fetch] ${tag} ready: ${formatBytes(info.size)} in ${elapsedSeconds}s -> ${targetPath}`);
}

function downloadToFile(url, destination, redirectsLeft = 5) {
  return new Promise((resolvePromise, rejectPromise) => {
    const startRequest = (currentUrl, redirects) => {
      const parsed = new URL(currentUrl);
      const transport = parsed.protocol === 'http:' ? httpRequest : request;
      const req = transport(parsed, { method: 'GET' }, (res) => {
        const status = res.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(status)) {
          const next = res.headers.location;
          res.resume();
          if (!next) {
            rejectPromise(new Error(`Redirect without Location header from ${currentUrl}`));
            return;
          }
          if (redirects <= 0) {
            rejectPromise(new Error(`Too many redirects fetching ${url}`));
            return;
          }
          startRequest(new URL(next, currentUrl).toString(), redirects - 1);
          return;
        }

        if (status < 200 || status >= 300) {
          res.resume();
          rejectPromise(new Error(`HTTP ${status} fetching ${currentUrl}`));
          return;
        }

        const file = createWriteStream(destination);
        res.pipe(file);
        file.on('finish', () => file.close((err) => (err ? rejectPromise(err) : resolvePromise())));
        file.on('error', (err) => {
          file.close(() => unlink(destination).catch(() => undefined));
          rejectPromise(err);
        });
        res.on('error', (err) => {
          file.close(() => unlink(destination).catch(() => undefined));
          rejectPromise(err);
        });
      });

      req.on('error', rejectPromise);
      req.end();
    };

    startRequest(url, redirectsLeft);
  });
}

function formatBytes(size) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

main().catch((error) => {
  console.error('[assets:fetch] failed:', error?.message ?? error);
  process.exit(1);
});
