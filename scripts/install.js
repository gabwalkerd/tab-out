// scripts/install.js
// ─────────────────────────────────────────────────────────────────────────────
// One-time setup script for Mission Control.
//
// Run this once with: npm run install-service
//
// What it does:
//   1. Creates the ~/.mission-control/ directory (where data + config live)
//   2. Creates ~/.mission-control/logs/ (where the server's output goes)
//   3. Creates a default config.json IF one doesn't already exist
//      (IMPORTANT: if a config already exists, we leave it untouched —
//       you may have a real API key in there!)
//   4. Installs a macOS "Launch Agent" — think of this as telling macOS
//      "please run this server automatically when I log in."
//      The Launch Agent is a small XML file (called a .plist) that macOS
//      reads from ~/Library/LaunchAgents/.
//   5. Tells macOS to load (activate) that Launch Agent right now,
//      so you don't have to log out and back in.
// ─────────────────────────────────────────────────────────────────────────────

const fs         = require('fs');
const path       = require('path');
const os         = require('os');
const { execSync } = require('child_process');

// Import the paths and defaults from config.js so we stay DRY
// (DRY = "Don't Repeat Yourself" — a core engineering principle)
const { CONFIG_DIR, CONFIG_FILE, DEFAULTS } = require('../server/config.js');

// ── Directory paths ───────────────────────────────────────────────────────────
const LOGS_DIR    = path.join(CONFIG_DIR, 'logs');

// The Launch Agent plist lives in a standard macOS location.
// macOS automatically scans this folder on login.
const PLIST_DIR   = path.join(os.homedir(), 'Library', 'LaunchAgents');
const PLIST_FILE  = path.join(PLIST_DIR, 'com.mission-control.plist');
const PLIST_LABEL = 'com.mission-control';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Creates a directory if it doesn't already exist.
 * The { recursive: true } option means: create parent dirs too, no error if
 * dir already exists. Safe to call multiple times.
 */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`[install] Created directory: ${dirPath}`);
  } else {
    console.log(`[install] Directory already exists: ${dirPath}`);
  }
}

/**
 * Build the XML content for the macOS Launch Agent plist.
 *
 * A Launch Agent is macOS's built-in way to run background services.
 * Think of it like a startup item but with more control.
 *
 * Key settings:
 *   - Label: a unique reverse-DNS identifier for this service
 *   - ProgramArguments: the command to run (node + our server entry point)
 *   - KeepAlive: true means macOS will restart it if it crashes
 *   - RunAtLoad: true means start immediately when the agent is loaded
 *   - StandardOutPath / StandardErrorPath: where to write logs
 */
function buildPlistContent() {
  // We need the absolute path to the node binary currently running this script
  const nodeBin     = process.execPath;

  // Absolute path to our server entry point
  const serverEntry = path.join(__dirname, '..', 'server', 'index.js');

  // Resolve to a clean absolute path (no ".." segments)
  const serverPath  = path.resolve(serverEntry);

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>

    <!-- Unique identifier for this Launch Agent -->
    <key>Label</key>
    <string>${PLIST_LABEL}</string>

    <!-- The command macOS will run: node /path/to/server/index.js -->
    <key>ProgramArguments</key>
    <array>
      <string>${nodeBin}</string>
      <string>${serverPath}</string>
    </array>

    <!-- KeepAlive: if the server crashes or is killed, macOS restarts it -->
    <key>KeepAlive</key>
    <true/>

    <!-- RunAtLoad: start the service as soon as the agent is loaded -->
    <key>RunAtLoad</key>
    <true/>

    <!-- Standard output log (normal messages) -->
    <key>StandardOutPath</key>
    <string>${path.join(LOGS_DIR, 'mission-control.log')}</string>

    <!-- Standard error log (error messages) -->
    <key>StandardErrorPath</key>
    <string>${path.join(LOGS_DIR, 'mission-control.error.log')}</string>

    <!-- Working directory for the server process -->
    <key>WorkingDirectory</key>
    <string>${path.resolve(__dirname, '..')}</string>

  </dict>
</plist>
`;
}

// ── Main install steps ────────────────────────────────────────────────────────

function main() {
  console.log('\n=== Mission Control — Install Script ===\n');

  // Step 1: Create ~/.mission-control/
  console.log('Step 1: Setting up data directory...');
  ensureDir(CONFIG_DIR);

  // Step 2: Create ~/.mission-control/logs/
  console.log('\nStep 2: Setting up logs directory...');
  ensureDir(LOGS_DIR);

  // Step 3: Create config.json ONLY if it doesn't already exist.
  // We are very careful here — if you already have a config with a real
  // API key, we must not blow it away!
  console.log('\nStep 3: Checking config file...');
  if (fs.existsSync(CONFIG_FILE)) {
    console.log(`[install] Config already exists at ${CONFIG_FILE} — leaving it untouched.`);
  } else {
    const defaultConfig = JSON.stringify(DEFAULTS, null, 2);
    fs.writeFileSync(CONFIG_FILE, defaultConfig, 'utf8');
    console.log(`[install] Created default config at ${CONFIG_FILE}`);
    console.log('[install] IMPORTANT: Add your DeepSeek API key to that file before starting the server.');
  }

  // Step 4: Create the macOS Launch Agent plist.
  console.log('\nStep 4: Installing macOS Launch Agent...');
  ensureDir(PLIST_DIR); // Should already exist, but let's be safe

  const plistContent = buildPlistContent();
  fs.writeFileSync(PLIST_FILE, plistContent, 'utf8');
  console.log(`[install] Wrote Launch Agent plist to: ${PLIST_FILE}`);

  // Step 5: Load the Launch Agent with launchctl.
  // launchctl is macOS's command for managing Launch Agents/Daemons.
  // "load" tells macOS to read the plist and start the service.
  // We pass -w to also enable it (remove any disabled override).
  console.log('\nStep 5: Loading Launch Agent with launchctl...');
  try {
    // First, try to unload any existing instance (ignore errors if it wasn't loaded)
    try {
      execSync(`launchctl unload "${PLIST_FILE}" 2>/dev/null`, { stdio: 'pipe' });
      console.log('[install] Unloaded existing Launch Agent (if any).');
    } catch (_) {
      // It's fine if unload fails — it just means it wasn't loaded yet
    }

    // Now load the new plist
    execSync(`launchctl load -w "${PLIST_FILE}"`, { stdio: 'inherit' });
    console.log('[install] Launch Agent loaded successfully.');
    console.log(`[install] Mission Control server will start automatically on login.`);
  } catch (err) {
    // launchctl can fail for various reasons (e.g. if server/index.js doesn't exist yet).
    // This is non-fatal during initial setup — the server just won't auto-start until
    // that file exists.
    console.warn(`[install] Warning: launchctl load failed: ${err.message}`);
    console.warn('[install] You can manually load it later with:');
    console.warn(`[install]   launchctl load -w "${PLIST_FILE}"`);
  }

  // Done!
  console.log('\n=== Installation complete! ===\n');
  console.log('To start the server manually: npm start');
  console.log(`Config file: ${CONFIG_FILE}`);
  console.log(`Logs: ${LOGS_DIR}`);
  console.log('');
}

main();
