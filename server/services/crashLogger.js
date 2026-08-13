// server/services/crashLogger.js
// Saves a snapshot of PM2 logs and process state to disk on any crash or shutdown signal.
// Only active on the Windows production server — no-op on Linux/Replit.

if (process.platform !== 'win32') {
  module.exports = { saveCrashSnapshot: () => Promise.resolve() };
  return;
}

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const DEFAULT_CRASH_LOG_DIR = 'C:\\Users\\theso\\Desktop\\PB_Backups\\crash_logs';

const OUT_LOG = 'C:\\Users\\theso\\.pm2\\logs\\preferred-builders-out.log';
const ERROR_LOG = 'C:\\Users\\theso\\.pm2\\logs\\preferred-builders-error.log';

const ONE_HOUR_BYTES = 512 * 1024; // read up to 512 KB from each log file (covers ~1 hour of output)

function getCrashLogDir() {
  const envDir = process.env.CRASH_LOG_DIR;
  if (envDir && envDir.trim().length > 0) return envDir.trim();
  return DEFAULT_CRASH_LOG_DIR;
}

function formatTimestamp(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `_${pad(date.getHours())}-${pad(date.getMinutes())}`
  );
}

function readLogTail(filePath, maxBytes) {
  try {
    if (!fs.existsSync(filePath)) return `(log file not found: ${filePath})`;
    const stat = fs.statSync(filePath);
    const size = stat.size;
    if (size === 0) return '(empty)';
    const start = Math.max(0, size - maxBytes);
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(Math.min(maxBytes, size));
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    const raw = buf.toString('utf8');
    // Drop partial first line if we started mid-file
    if (start > 0) {
      const newline = raw.indexOf('\n');
      return newline !== -1 ? raw.slice(newline + 1) : raw;
    }
    return raw;
  } catch (e) {
    return `(could not read log: ${e.message})`;
  }
}

function getPm2List() {
  return new Promise((resolve) => {
    execFile(
      'pm2',
      ['list', '--no-color'],
      { shell: true, timeout: 8000 },
      (err, stdout, stderr) => {
        if (err) {
          resolve(`(pm2 list failed: ${err.message})\n${stderr || ''}`);
        } else {
          resolve(stdout || '(no output)');
        }
      },
    );
  });
}

let _saving = false;

async function saveCrashSnapshot(reason) {
  if (_saving) return; // prevent double-save on overlapping signals
  _saving = true;

  const now = new Date();
  const ts = now.toISOString();
  const fileTs = formatTimestamp(now);
  const dir = getCrashLogDir();

  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    console.error('[CrashLogger] Could not create crash log directory:', e.message);
    return;
  }

  const outTail = readLogTail(OUT_LOG, ONE_HOUR_BYTES);
  const errTail = readLogTail(ERROR_LOG, ONE_HOUR_BYTES);
  const pm2List = await getPm2List();

  const divider = '='.repeat(72);

  const content = [
    divider,
    `PREFERRED BUILDERS — CRASH SNAPSHOT`,
    divider,
    `Timestamp  : ${ts}`,
    `Reason     : ${reason}`,
    `Process ID : ${process.pid}`,
    `Node.js    : ${process.version}`,
    `CWD        : ${process.cwd()}`,
    '',
    divider,
    'PM2 PROCESS LIST (at time of crash)',
    divider,
    pm2List.trim(),
    '',
    divider,
    `STDOUT LOG TAIL  (${OUT_LOG})`,
    divider,
    outTail.trim(),
    '',
    divider,
    `STDERR LOG TAIL  (${ERROR_LOG})`,
    divider,
    errTail.trim(),
    '',
  ].join('\n');

  const fileName = `crash_${fileTs}.txt`;
  const filePath = path.join(dir, fileName);

  try {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`[CrashLogger] Snapshot saved → ${filePath}`);
  } catch (e) {
    console.error('[CrashLogger] Failed to write snapshot:', e.message);
  }
}

// ── Signal handlers ───────────────────────────────────────────────────────────

let _exitHandled = false;

async function handleExit(reason, exitCode) {
  if (_exitHandled) return;
  _exitHandled = true;

  await saveCrashSnapshot(reason);

  if (typeof exitCode === 'number') {
    process.exit(exitCode);
  }
}

process.on('SIGTERM', () => {
  handleExit('SIGTERM (PM2 restart or OS shutdown)', 0);
});

process.on('SIGINT', () => {
  handleExit('SIGINT (Ctrl-C / manual interrupt)', 0);
});

process.on('uncaughtException', (err) => {
  console.error('[CrashLogger] uncaughtException:', err);
  handleExit(`uncaughtException: ${err.message}`, 1);
});

// Unhandled promise rejections — log and save a snapshot, but do NOT exit
// for known non-fatal errors (e.g. Puppeteer EBUSY temp-file cleanup on Windows).
// For truly unexpected rejections we still save a snapshot and exit.
const KNOWN_NON_FATAL = [
  /EBUSY.*puppeteer/i,
  /EBUSY.*chrome/i,
  /ENOENT.*puppeteer/i,
  /Target closed/i,
  /Session closed/i,
];

process.on('unhandledRejection', (reason, promise) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : msg;

  if (KNOWN_NON_FATAL.some((re) => re.test(msg) || re.test(String(promise)))) {
    // Non-fatal: log and continue — do not kill the server
    console.warn('[CrashLogger] Non-fatal unhandledRejection (suppressed):', msg);
    return;
  }

  console.error('[CrashLogger] unhandledRejection — saving snapshot and exiting:', stack);
  handleExit(`unhandledRejection: ${msg}`, 1);
});

module.exports = { saveCrashSnapshot };
