#!/usr/bin/env node
import { renameSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

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

  const result = spawnSync('vite', ['build', ...args], {
    cwd: resolve(import.meta.dirname, '../apps/react-host'),
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
