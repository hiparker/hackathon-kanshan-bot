#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const repoRoot = path.resolve(import.meta.dirname, '..');

const targets = {
  desktop: {
    tagPrefix: 'v',
    versionFiles: [
      {
        path: 'apps/desktop-tauri/src-tauri/tauri.conf.json',
        jsonPath: ['version'],
      },
    ],
  },
  // Future example:
  // extension: {
  //   tagPrefix: 'extension-v',
  //   versionFiles: [
  //     { path: 'apps/extension/manifest.json', jsonPath: ['version'] },
  //   ],
  // },
};

const args = process.argv.slice(2).filter((arg) => arg !== '--');
const targetName = args.find((arg) => !arg.startsWith('-')) ?? 'desktop';
const target = targets[targetName];

if (!target || args.includes('--help') || args.includes('-h')) {
  printHelp();
  process.exit(target ? 0 : 1);
}

const options = parseOptions(args.filter((arg) => arg !== targetName));
const currentVersion = readJsonValue(target.versionFiles[0]);
const nextVersion = options.version ?? bumpVersion(currentVersion, options.bump);
const tagName = `${options.tagPrefix ?? target.tagPrefix}${nextVersion}`;

if (!isSemver(nextVersion)) {
  fail(`Invalid version: ${nextVersion}`);
}

if (!options.allowDirty && !options.dryRun) {
  const status = git(['status', '--porcelain']);
  if (status.trim()) {
    fail('Working tree is not clean. Commit/stash changes first, or pass --allow-dirty.');
  }
}

if (tagExists(tagName)) {
  fail(`Tag already exists: ${tagName}`);
}

log(`Target: ${targetName}`);
log(`Version: ${currentVersion} -> ${nextVersion}`);
log(`Tag: ${tagName}`);

for (const file of target.versionFiles) {
  updateJsonValue(file, nextVersion, options.dryRun);
}

if (options.dryRun) {
  log('Dry run complete. No files changed.');
  process.exit(0);
}

if (options.commit) {
  const files = target.versionFiles.map((file) => file.path);
  git(['add', ...files]);
  git(['commit', '-m', `release: ${tagName}`], { stdio: 'inherit' });
}

if (options.tag) {
  git(['tag', tagName]);
}

if (options.push) {
  git(['push', 'origin', 'HEAD'], { stdio: 'inherit' });
  if (options.tag) {
    git(['push', 'origin', tagName], { stdio: 'inherit' });
  }
  log('Pushed commit and tag. GitHub Actions will build and publish release assets.');
} else {
  log('Done locally. Pass --push to push commit/tag and trigger GitHub Actions.');
}

function parseOptions(optionArgs) {
  const options = {
    allowDirty: false,
    bump: 'patch',
    commit: true,
    dryRun: false,
    push: false,
    tag: true,
    tagPrefix: undefined,
    version: undefined,
  };

  for (let i = 0; i < optionArgs.length; i += 1) {
    const arg = optionArgs[i];
    const value = () => {
      const next = optionArgs[i + 1];
      if (!next || next.startsWith('-')) fail(`Missing value for ${arg}`);
      i += 1;
      return next;
    };

    if (arg === '--allow-dirty') options.allowDirty = true;
    else if (arg === '--bump') options.bump = value();
    else if (arg === '--commit') options.commit = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--no-commit') options.commit = false;
    else if (arg === '--no-tag') options.tag = false;
    else if (arg === '--push') options.push = true;
    else if (arg === '--tag-prefix') options.tagPrefix = value();
    else if (arg === '--version') options.version = value();
    else fail(`Unknown option: ${arg}`);
  }

  if (!['patch', 'minor', 'major'].includes(options.bump)) {
    fail('--bump must be one of: patch, minor, major');
  }

  if (options.push && !options.tag) {
    fail('--push requires tag creation; remove --no-tag');
  }

  return options;
}

function readJsonValue(file) {
  const data = readJson(file.path);
  return getByPath(data, file.jsonPath);
}

function updateJsonValue(file, version, dryRun) {
  const data = readJson(file.path);
  setByPath(data, file.jsonPath, version);
  log(`${dryRun ? 'Would update' : 'Update'} ${file.path} ${file.jsonPath.join('.')}=${version}`);
  if (!dryRun) {
    fs.writeFileSync(path.join(repoRoot, file.path), `${JSON.stringify(data, null, 2)}\n`);
  }
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));
}

function getByPath(value, jsonPath) {
  return jsonPath.reduce((current, key) => current?.[key], value);
}

function setByPath(value, jsonPath, nextValue) {
  let current = value;
  for (const key of jsonPath.slice(0, -1)) {
    current = current[key];
  }
  current[jsonPath.at(-1)] = nextValue;
}

function bumpVersion(version, bump) {
  if (!isSemver(version)) fail(`Current version is not semver: ${version}`);
  const [major, minor, patch] = version.split('.').map(Number);
  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function isSemver(version) {
  return /^\d+\.\d+\.\d+$/.test(version);
}

function tagExists(tagName) {
  try {
    git(['rev-parse', '--verify', '--quiet', `refs/tags/${tagName}`]);
    return true;
  } catch {
    return false;
  }
}

function git(args_, options = {}) {
  return execFileSync('git', args_, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: options.stdio ?? 'pipe',
  });
}

function log(message) {
  console.log(`[release] ${message}`);
}

function fail(message) {
  console.error(`[release] ${message}`);
  process.exit(1);
}

function printHelp() {
  console.log(`Usage:
  pnpm release [target] [options]

Targets:
  ${Object.keys(targets).join(', ')}

Options:
  --bump patch|minor|major   Version bump type (default: patch)
  --version x.y.z            Use an explicit version
  --push                     Push commit and tag to origin
  --no-commit                Update files without committing
  --no-tag                   Do not create a git tag
  --tag-prefix prefix        Override target tag prefix
  --allow-dirty              Allow running with existing local changes
  --dry-run                  Print changes without writing files

Examples:
  pnpm release desktop -- --dry-run
  pnpm release desktop -- --version 1.0.3 --push
  pnpm release desktop -- --bump patch --push
`);
}
