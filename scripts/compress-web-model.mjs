import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2).filter((arg) => arg !== '--');

function readOption(name, fallback) {
  const prefix = `--${name}=`;
  const found = args.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return args.includes(`--${name}`);
}

const input = resolve(rootDir, readOption('input', 'assets/model/kanshan-model-v5.glb'));
const output = resolve(rootDir, readOption('output', 'assets/model/kanshan-model-v5-web.glb'));
const backup = resolve(rootDir, readOption('backup', 'assets/model/kanshan-model-v5.original.glb'));
const textureSize = readOption('texture-size', '1024');
const textureFormat = readOption('texture-format', 'none');
const useMeshopt = hasFlag('meshopt');
const noBackup = hasFlag('no-backup');
const copyOnly = hasFlag('copy-only');

if (!existsSync(input)) {
  console.error(`[model:compress] input not found: ${input}`);
  console.error('[model:compress] run `pnpm assets:fetch` first.');
  process.exit(1);
}

mkdirSync(dirname(output), { recursive: true });

if (copyOnly) {
  copyFileSync(input, output);
  console.log('[model:compress] copy only:', relativeSize(output));
  process.exit(0);
}

if (input === output && !noBackup && !existsSync(backup)) {
  copyFileSync(input, backup);
  console.log('[model:compress] backup:', relativeSize(backup));
}

const tempOutput = input === output ? `${output}.tmp-${Date.now()}.glb` : output;
const commandArgs = [
  '@gltf-transform/cli',
  'optimize',
  input,
  tempOutput,
  '--texture-size',
  textureSize,
];

if (textureFormat !== 'none' && textureFormat !== 'false') {
  commandArgs.push('--texture-compress', textureFormat);
}

if (useMeshopt) {
  commandArgs.push('--compress', 'meshopt');
}

console.log('[model:compress] input:', relativeSize(input));
console.log('[model:compress] output:', output.replace(`${rootDir}/`, ''));
console.log('[model:compress] texture size:', textureSize);
console.log('[model:compress] texture format:', textureFormat);
console.log('[model:compress] meshopt:', useMeshopt ? 'on' : 'off');

const result = spawnSync('npx', commandArgs, {
  cwd: rootDir,
  stdio: 'inherit',
  env: {
    ...process.env,
    npm_config_registry: process.env.npm_config_registry || 'https://registry.npmjs.org',
  },
});

if (result.status !== 0) {
  if (tempOutput !== output && existsSync(tempOutput)) {
    rmSync(tempOutput, { force: true });
  }
  process.exit(result.status ?? 1);
}

if (tempOutput !== output) {
  renameSync(tempOutput, output);
}

console.log('[model:compress] done:', relativeSize(output));

function relativeSize(file) {
  const bytes = statSync(file).size;
  const mib = bytes / 1024 / 1024;
  return `${file.replace(`${rootDir}/`, '')} (${mib.toFixed(1)} MiB)`;
}
