// server/config.js
// ─────────────────────────────────────────────────────────────────────────────
// Configuration loader for Mission Control.
//
// Think of this file as the "settings reader" for the whole app.
// It looks for a config file at ~/.mission-control/config.json on your Mac.
// If that file exists, it reads it. If a key is missing from the file, it
// falls back to the sensible default values defined below.
//
// This means you can override any setting by editing ~/.mission-control/config.json
// without touching the source code at all.
// ─────────────────────────────────────────────────────────────────────────────

const fs   = require('fs');
const path = require('path');
const os   = require('os');

// The folder where all Mission Control data lives on your Mac.
// os.homedir() gives us your home directory (e.g. /Users/zara)
const CONFIG_DIR  = path.join(os.homedir(), '.mission-control');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

// Default values — used whenever a key is absent from the config file.
const DEFAULTS = {
  // Which local port the web server listens on.
  // 3456 is arbitrary but unlikely to conflict with other apps.
  port: 3456,

  // How often (in minutes) the server re-reads Chrome history and re-clusters.
  refreshIntervalMinutes: 30,

  // How many history entries to pull per refresh batch.
  // Keeping this reasonable avoids hammering the AI API with huge requests.
  batchSize: 200,

  // How many days back to look in Chrome's browsing history.
  historyDays: 7,

  // DeepSeek API key — no default, must come from config file.
  deepseekApiKey: '',

  // The base URL for DeepSeek's API (compatible with OpenAI's SDK).
  deepseekBaseUrl: 'https://api.deepseek.com',

  // Which DeepSeek model to call for clustering.
  deepseekModel: 'deepseek-chat',
};

// ─────────────────────────────────────────────────────────────────────────────
// Load config from disk and merge with defaults.
//
// Object.assign works left-to-right: later sources overwrite earlier ones.
// So: start with defaults, then layer on whatever's in the file.
// If the file doesn't exist, we just get the defaults.
// ─────────────────────────────────────────────────────────────────────────────
function loadConfig() {
  let fileConfig = {};

  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
      fileConfig = JSON.parse(raw);
    } catch (err) {
      // If the file is malformed JSON, warn but don't crash — just use defaults.
      console.warn(`[config] Warning: could not parse ${CONFIG_FILE}: ${err.message}`);
      console.warn('[config] Falling back to defaults.');
    }
  } else {
    console.warn(`[config] No config file found at ${CONFIG_FILE}. Using defaults.`);
  }

  // Merge: defaults first, then file values on top.
  return Object.assign({}, DEFAULTS, fileConfig);
}

// Export both the loaded config object and the path constants so other modules
// can reference them (e.g. install.js needs CONFIG_DIR and CONFIG_FILE).
const config = loadConfig();

module.exports = {
  config,
  CONFIG_DIR,
  CONFIG_FILE,
  DEFAULTS,
};
