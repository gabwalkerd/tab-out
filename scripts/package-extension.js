/**
 * package-extension.js
 *
 * Creates a ZIP file of the extension folder that is ready to upload
 * to the Chrome Web Store Developer Dashboard.
 *
 * How it works:
 * - Uses the system `zip` command (available on macOS and Linux) via
 *   Node's built-in child_process module — no npm dependencies needed.
 * - Packages exactly the files Chrome cares about.
 * - Excludes dev/temp files like .DS_Store, icons.html, etc.
 * - Outputs extension.zip in the project root.
 *
 * Run with:  node scripts/package-extension.js
 * Or via:   npm run package-extension
 */

const { execSync } = require('child_process');
const path = require('path');
const fs   = require('fs');

// ── Paths ──────────────────────────────────────────────────────────────────
const projectRoot  = path.join(__dirname, '..');
const extensionDir = path.join(projectRoot, 'extension');
const outputZip    = path.join(projectRoot, 'extension.zip');

// ── Sanity check ───────────────────────────────────────────────────────────
// Make sure the extension folder actually exists before we try to zip it
if (!fs.existsSync(extensionDir)) {
  console.error('ERROR: extension/ folder not found at', extensionDir);
  process.exit(1);
}

// ── Remove old zip if it exists ────────────────────────────────────────────
// We don't want the old zip to accumulate stale files
if (fs.existsSync(outputZip)) {
  fs.unlinkSync(outputZip);
  console.log('Removed old extension.zip');
}

// ── Files to include ───────────────────────────────────────────────────────
// These are paths RELATIVE to the extension/ directory.
// We list them explicitly so we never accidentally bundle dev files.
const filesToInclude = [
  'manifest.json',
  'newtab.html',
  'newtab.js',
  'background.js',
  'icons/icon16.png',
  'icons/icon48.png',
  'icons/icon128.png',
];

// ── Verify all files exist before zipping ─────────────────────────────────
const missing = filesToInclude.filter(
  f => !fs.existsSync(path.join(extensionDir, f))
);

if (missing.length > 0) {
  console.error('ERROR: The following required files are missing:');
  missing.forEach(f => console.error('  •', f));
  console.error('\nRun `node scripts/generate-icons.js` first if icons are missing.');
  process.exit(1);
}

// ── Build the zip command ──────────────────────────────────────────────────
// We cd into the extension/ folder first so that the ZIP's internal paths
// don't include "extension/" as a prefix — Chrome expects files at the root
// of the ZIP (manifest.json at top level, not extension/manifest.json).
const fileList = filesToInclude.join(' ');
const zipCmd   = `cd "${extensionDir}" && zip -r "${outputZip}" ${fileList}`;

console.log('Packaging extension...');
console.log('Files included:');
filesToInclude.forEach(f => console.log(' ', f));
console.log('');

try {
  execSync(zipCmd, { stdio: 'inherit' });
} catch (err) {
  console.error('\nERROR: zip command failed:', err.message);
  process.exit(1);
}

// ── Final report ──────────────────────────────────────────────────────────
const stats   = fs.statSync(outputZip);
const sizeKB  = (stats.size / 1024).toFixed(1);

console.log('\n✓ extension.zip created successfully');
console.log(`  Path: ${outputZip}`);
console.log(`  Size: ${sizeKB} KB`);
console.log('\nYou can now upload extension.zip to the Chrome Web Store Developer Dashboard:');
console.log('  https://chrome.google.com/webstore/devconsole');
