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

// ── POST /api/remote-update/sync-payments — retroactive payment↔invoice linker ──

router.post('/sync-payments', requireAuth, requireRole('system_admin'), (req, res) => {
  const { getDb } = require('../db/database');
  const db = getDb();

  const TOLERANCE_PCT = 0.02;
  const TOLERANCE_MIN = 25;

  const unlinked = db
    .prepare(
      `SELECT r.id, r.job_id, r.amount, r.date_received, r.payment_type, r.check_number,
              j.customer_name
       FROM payments_received r
       JOIN jobs j ON j.id = r.job_id
       WHERE r.invoice_id IS NULL
         AND r.credit_debit = 'credit'
         AND (r.is_pass_through_reimbursement IS NULL OR r.is_pass_through_reimbursement != 1)
       ORDER BY r.date_received`,
    )
    .all();

  const results = [];
  for (const pmt of unlinked) {
    const tolerance = Math.max(TOLERANCE_MIN, pmt.amount * TOLERANCE_PCT);
    const openInvoices = db
      .prepare(
        `SELECT id, invoice_number, amount FROM invoices
         WHERE job_id = ? AND status IN ('draft', 'sent', 'pending_send')
         ORDER BY issued_at ASC`,
      )
      .all(pmt.job_id);

    const match = openInvoices.find((inv) => Math.abs(inv.amount - pmt.amount) <= tolerance);
    if (match) {
      const paidAt = pmt.date_received || new Date().toISOString().slice(0, 10);
      db.prepare(
        "UPDATE invoices SET status = 'paid', paid_at = ?, amount_paid = ? WHERE id = ?",
      ).run(paidAt, pmt.amount, match.id);
      db.prepare('UPDATE payments_received SET invoice_id = ? WHERE id = ?').run(match.id, pmt.id);
      results.push({
        linked: true,
        customer: pmt.customer_name,
        payment: pmt.amount,
        invoice: match.invoice_number,
        invoice_amount: match.amount,
      });
    } else {
      results.push({
        linked: false,
        customer: pmt.customer_name,
        payment: pmt.amount,
        payment_type: pmt.payment_type,
        date: pmt.date_received,
      });
    }
  }

  const linked = results.filter((r) => r.linked).length;
  const skipped = results.filter((r) => !r.linked).length;
  res.json({ ok: true, linked, skipped, results });
});

module.exports = router;
