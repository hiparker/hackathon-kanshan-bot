#!/usr/bin/env node
import { renameSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const reactHostDir = resolve(import.meta.dirname, '../apps/react-host');
/** Windows: spawnSync('vite') does not resolve vite.cmd; invoke CLI via Node. */
const viteCli = resolve(reactHostDir, 'node_modules/vite/bin/vite.js');

const args = process.argv.slice(2);
const isDesktopBuild = args.includes('--mode') && args[args.indexOf('--mode') + 1] === 'desktop';
const envLocalPath = resolve(import.meta.dirname, '../apps/react-host/.env.local');
const hiddenEnvLocalPath = `${envLocalPath}.desktop-build-ignore`;
let envLocalHidden = false;
const buildEnv = {
  ...process.env,
  VITE_KANSHAN_AUTH_MODE: process.env.VITE_KANSHAN_AUTH_MODE || 'oauth',
  VITE_KANSHAN_API_BASE_URL: process.env.VITE_KANSHAN_API_BASE_URL || 'https://kanshan.bedebug.com',
};

try {
  if (isDesktopBuild && existsSync(envLocalPath)) {
    if (existsSync(hiddenEnvLocalPath)) {
      throw new Error(`${hiddenEnvLocalPath} already exists; refusing to overwrite it.`);
    }
    renameSync(envLocalPath, hiddenEnvLocalPath);
    envLocalHidden = true;
  }

  const result = spawnSync(process.execPath, [viteCli, 'build', ...args], {
    cwd: reactHostDir,
    env: buildEnv,
    stdio: 'inherit',
  });

  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(`[build-react-host] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  if (envLocalHidden) {
    renameSync(hiddenEnvLocalPath, envLocalPath);
  }
}
