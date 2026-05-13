#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const outputDir = process.argv[2];
const version = process.argv[3] ?? 'unknown';
const arch = process.argv[4] ?? 'unknown';
const signingStatus = process.argv[5] ?? 'unsigned';

if (!outputDir) {
  console.error('Usage: node scripts/ci/write-macos-signing-note.mjs <outputDir> [version] [arch] [signed|unsigned]');
  process.exit(1);
}

fs.mkdirSync(outputDir, { recursive: true });

const isSigned = signingStatus === 'signed';

const note = isSigned
  ? `Liu Kanshan ${version} macOS ${arch} signed build

This DMG was built with Apple Developer ID signing and notarization secrets available in GitHub Actions.
If macOS still blocks the app, verify the GitHub Actions signing logs and notarization result first.
`
  : `Liu Kanshan ${version} macOS ${arch} unsigned build

This DMG was built without Apple Developer ID signing and notarization.
macOS Gatekeeper may show "刘看山" is damaged and cannot be opened.

For internal testing only:
1. Open the DMG and drag 刘看山.app to /Applications.
2. Run this command in Terminal:

   xattr -dr com.apple.quarantine /Applications/刘看山.app

3. Open 刘看山.app again.

Do not distribute unsigned builds as a public release.
A public macOS release needs an Apple Developer Program account, a Developer ID Application certificate, and notarization.
`;

fs.writeFileSync(path.join(outputDir, `README-macos-${signingStatus}-${arch}.txt`), note);
