// server/routes/remoteUpdate.js
// Trigger git pull + rebuild + restart from the Settings UI or external secret
const express = require('express');
const router = express.Router();
const { exec, spawn } = require('child_process');
const path = require('path');
const { requireAuth, requireRole } = require('../middleware/auth');

const UPDATE_SECRET = process.env.UPDATE_SECRET;
const PROJECT_DIR = path.resolve(__dirname, '../../');
const IS_WINDOWS = process.platform === 'win32';
const SHELL = IS_WINDOWS ? 'cmd' : '/bin/sh';
const SHELL_FLAG = IS_WINDOWS ? '/c' : '-c';

// ── Shared helpers ────────────────────────────────────────────────────────────

function getCommitInfo() {
  const { execSync } = require('child_process');
  const opts = { cwd: PROJECT_DIR };
  const commit = execSync('git rev-parse --short HEAD', opts).toString().trim();
  const message = execSync('git log -1 --pretty=%s', opts).toString().trim();
  const date = execSync('git log -1 --pretty=%cd --date=format:"%Y-%m-%d %H:%M"', opts)
    .toString()
    .trim();
  const branch = execSync('git rev-parse --abbrev-ref HEAD', opts).toString().trim();
  return { commit, message, date, branch, platform: process.platform };
}

function runStep(cmd) {
  return new Promise((resolve) => {
    exec(
      `${SHELL} ${SHELL_FLAG} "${cmd}"`,
      { cwd: PROJECT_DIR, timeout: 120000 },
      (err, stdout, stderr) => {
        resolve({ ok: !err, stdout: stdout.trim(), stderr: stderr.trim(), error: err?.message });
      },
    );
  });
}

function scheduleRestart() {
  // Delay so the HTTP response can be flushed before the process is replaced
  setTimeout(() => {
    const child = spawn('pm2', ['restart', 'preferred-builders'], {
      detached: true,
      stdio: 'ignore',
      shell: IS_WINDOWS,
    });
    child.unref();
  }, 1500);
}

// ── GET /api/remote-update/commit — current commit info (session auth) ────────

router.get('/commit', requireAuth, requireRole('system_admin'), (req, res) => {
  try {
    res.json(getCommitInfo());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/remote-update/deploy — pull + install + restart (session auth) ──

router.post('/deploy', requireAuth, requireRole('system_admin'), async (req, res) => {
  const steps = [];

  const pull = await runStep('git pull');
  steps.push({ step: 'git pull', ...pull });

  if (!pull.ok) {
    return res.json({ ok: false, steps, message: 'git pull failed — deploy aborted.' });
  }

  const install = await runStep('npm install --legacy-peer-deps');
  steps.push({ step: 'npm install', ...install });

  if (!install.ok) {
    return res.json({ ok: false, steps, message: 'npm install failed — deploy aborted.' });
  }

  res.json({
    ok: true,
    steps,
    message: 'Update applied — server restarting now. Refresh in ~15 seconds.',
  });
  scheduleRestart();
});

// ── POST /api/remote-update — legacy secret-based endpoint (external use) ────

router.post('/', (req, res) => {
  if (!UPDATE_SECRET) {
    return res.status(503).json({ error: 'Remote update not configured (UPDATE_SECRET not set)' });
  }
  const secret = req.headers['x-update-secret'] || req.body?.secret;
  if (!secret || secret !== UPDATE_SECRET) {
    return res.status(403).json({ error: 'Invalid secret' });
  }

  res.json({ ok: true, message: 'Update started — check back in 60 seconds' });

  const cmd = `git pull && npm install --legacy-peer-deps && pm2 restart preferred-builders`;
  exec(
    `${SHELL} ${SHELL_FLAG} "${cmd}"`,
    { cwd: PROJECT_DIR, timeout: 180000 },
    (err, stdout, stderr) => {
      if (err) {
        console.error('[RemoteUpdate] Failed:', err.message);
        console.error('[RemoteUpdate] stderr:', stderr);
      } else {
        console.log('[RemoteUpdate] Success:', stdout.slice(-500));
      }
    },
  );
});

// ── GET /api/remote-update/status — commit info via secret (legacy external) ──

router.get('/status', (req, res) => {
  const secret = req.headers['x-update-secret'] || req.query.secret;
  if (!UPDATE_SECRET || !secret || secret !== UPDATE_SECRET) {
    return res.status(403).json({ error: 'Invalid secret' });
  }
  try {
    res.json(getCommitInfo());
  } catch (e) {
    res.json({ error: e.message });
  }
});

module.exports = router;
