// server/routes/settings.js
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const os = require('os');
const { requireAuth, requireRole } = require('../middleware/auth');
const { getDb } = require('../db/database');
const { requireOfficeIp, invalidateIpCache } = require('../middleware/ipWhitelist');

const requireAdmin = [requireAuth, requireRole('system_admin'), requireOfficeIp];

// GET all settings grouped by category
router.get('/', requireAdmin, (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM settings ORDER BY category, key').all();
  const grouped = {};
  for (const row of rows) {
    if (!grouped[row.category]) grouped[row.category] = [];
    let value = row.value;
    try {
      value = JSON.parse(row.value);
    } catch {
      /* ignore */
    }
    grouped[row.category].push({
      key: row.key,
      value,
      label: row.label,
      updatedAt: row.updated_at,
    });
  }
  res.json(grouped);
});

// GET single setting
router.get('/:key', requireAdmin, (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM settings WHERE key = ?').get(req.params.key);
  if (!row) return res.status(404).json({ error: 'Setting not found' });
  let value = row.value;
  try {
    value = JSON.parse(row.value);
  } catch {
    /* ignore */
  }
  res.json({ key: row.key, value, label: row.label });
});

// PUT update single setting
router.put('/:key', requireAdmin, (req, res) => {
  const db = getDb();
  const value =
    typeof req.body.value === 'object' ? JSON.stringify(req.body.value) : String(req.body.value);
  db.prepare('UPDATE settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?').run(
    value,
    req.params.key,
  );
  if (req.params.key === 'security.allowed_ips') invalidateIpCache();
  res.json({ success: true, key: req.params.key, value: req.body.value });
});

// PUT bulk update settings
router.put('/', requireAdmin, (req, res) => {
  const db = getDb();
  const updates = req.body;
  const update = db.prepare(
    'UPDATE settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?',
  );
  const updateMany = db.transaction((items) => {
    for (const [key, val] of Object.entries(items)) {
      const value = typeof val === 'object' ? JSON.stringify(val) : String(val);
      update.run(value, key);
    }
  });
  updateMany(updates);
  invalidateIpCache();
  res.json({ success: true, updated: Object.keys(updates).length });
});

// POST reset settings to defaults
router.post('/reset', requireAdmin, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM settings').run();
  invalidateIpCache();
  res.json({ success: true, message: 'Settings reset to defaults' });
});

// GET integration status
router.get('/integrations/status', requireAdmin, (req, res) => {
  const db = getDb();
  const platform =
    db.prepare("SELECT value FROM settings WHERE key = 'integration.platform'").get()?.value ||
    'hearth';
  const whatsappEnabled =
    db.prepare("SELECT value FROM settings WHERE key = 'integration.whatsapp'").get()?.value ===
    'true';
  const emailEnabled =
    db.prepare("SELECT value FROM settings WHERE key = 'integration.email'").get()?.value !==
    'false';

  res.json({
    platform,
    whatsapp: { enabled: whatsappEnabled, configured: !!process.env.TWILIO_ACCOUNT_SID },
    email: { enabled: emailEnabled, configured: !!process.env.RESEND_API_KEY },
    hearth: { configured: !!process.env.HEARTH_API_KEY },
    wave: { configured: false },
    microsoft_footprints: { configured: true, free: true },
    google_solar: { configured: !!process.env.GOOGLE_MAPS_API_KEY, free: true },
    hover: {
      configured: !!(process.env.HOVER_CLIENT_ID && process.env.HOVER_CLIENT_SECRET),
      hasToken: !!process.env.HOVER_ACCESS_TOKEN,
    },
    eagleview: {
      configured: !!(process.env.EAGLEVIEW_CLIENT_ID && process.env.EAGLEVIEW_CLIENT_SECRET),
    },
    perplexity: { configured: !!process.env.PERPLEXITY_API_KEY },
  });
});

// POST switch integration platform
router.post('/integrations/switch', requireAdmin, (req, res) => {
  const db = getDb();
  const { platform } = req.body;
  if (!['hearth', 'wave', 'email'].includes(platform)) {
    return res.status(400).json({ error: 'Invalid platform. Must be: hearth, wave, or email' });
  }
  db.prepare(
    "INSERT OR REPLACE INTO settings (key, value, category, label) VALUES ('integration.platform', ?, 'integrations', 'Active Platform')",
  ).run(platform);
  res.json({ success: true, platform, message: `Switched to ${platform}` });
});

// ── IP ALLOWLIST MANAGEMENT ────────────────────────────────────

// GET allowed IPs list
router.get('/security/allowed-ips', requireAdmin, (req, res) => {
  const db = getDb();
  const row = db.prepare("SELECT value FROM settings WHERE key = 'security.allowed_ips'").get();
  const ips = row ? JSON.parse(row.value) : [];
  res.json({ ips });
});

// POST add an IP to the allowlist
router.post('/security/allowed-ips', requireAdmin, (req, res) => {
  const { ip } = req.body;
  if (!ip || typeof ip !== 'string') return res.status(400).json({ error: 'IP required' });
  const clean = ip.trim().replace(/^::ffff:/, '');
  const db = getDb();
  const row = db.prepare("SELECT value FROM settings WHERE key = 'security.allowed_ips'").get();
  const ips = row ? JSON.parse(row.value) : [];
  if (ips.includes(clean)) return res.json({ success: true, ips });
  ips.push(clean);
  db.prepare(
    "INSERT OR REPLACE INTO settings (key, value, category, label) VALUES ('security.allowed_ips', ?, 'security', 'Allowed IP Addresses')",
  ).run(JSON.stringify(ips));
  invalidateIpCache();
  res.json({ success: true, ips });
});

// DELETE remove an IP from the allowlist
router.delete('/security/allowed-ips/:ip', requireAdmin, (req, res) => {
  const target = decodeURIComponent(req.params.ip).replace(/^::ffff:/, '');
  const db = getDb();
  const row = db.prepare("SELECT value FROM settings WHERE key = 'security.allowed_ips'").get();
  let ips = row ? JSON.parse(row.value) : [];
  ips = ips.filter((i) => i !== target);
  db.prepare(
    "INSERT OR REPLACE INTO settings (key, value, category, label) VALUES ('security.allowed_ips', ?, 'security', 'Allowed IP Addresses')",
  ).run(JSON.stringify(ips));
  invalidateIpCache();
  res.json({ success: true, ips });
});

// GET PM2 logs (last N lines of out + error log)
router.get('/logs', requireAdmin, (req, res) => {
  const lines = Math.min(parseInt(req.query.lines) || 200, 1000);
  const pm2Home = process.env.PM2_HOME || path.join(os.homedir(), '.pm2');
  const logDir = path.join(pm2Home, 'logs');
  const appName = 'preferred-builders';

  const readTail = (filePath, n) => {
    try {
      if (!fs.existsSync(filePath)) return [];
      const content = fs.readFileSync(filePath, 'utf8');
      const all = content.split('\n').filter(Boolean);
      return all.slice(-n);
    } catch {
      return [];
    }
  };

  const outPath = path.join(logDir, `${appName}-out.log`);
  const errPath = path.join(logDir, `${appName}-error.log`);

  res.json({
    out: readTail(outPath, lines),
    error: readTail(errPath, lines),
    paths: { out: outPath, error: errPath },
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
