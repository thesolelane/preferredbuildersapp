// server/routes/scan.js
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getDb } = require('../db/database');
const { autoCreateDepositInvoice } = require('../services/autoDepositInvoice');
const path = require('path');
const fs = require('fs');

// ── GET /api/scan/inbox — list files waiting in the scan inbox folder ─────────
router.get('/inbox', requireAuth, (req, res) => {
  const db = getDb();
  const setting = db.prepare("SELECT value FROM settings WHERE key = 'scan_inbox_folder'").get();
  const folder = setting?.value?.trim();

  if (!folder) {
    return res.json({ files: [], configured: false });
  }

  if (!fs.existsSync(folder)) {
    return res.json({ files: [], configured: true, warning: `Folder not found: ${folder}` });
  }

  try {
    const all = fs.readdirSync(folder);
    const files = all
      .filter((f) => /\.(jpg|jpeg|png|pdf|tif|tiff|bmp)$/i.test(f))
      .map((f) => {
        const full = path.join(folder, f);
        const stat = fs.statSync(full);
        return { name: f, size: stat.size, modifiedAt: stat.mtime.toISOString() };
      })
      .sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt))
      .slice(0, 20); // show last 20 scans

    res.json({ files, configured: true, folder });
  } catch (err) {
    res.json({ files: [], configured: true, warning: err.message });
  }
});

// ── GET /api/scan/preview — return a scanned file as base64 for preview ───────
router.get('/preview', requireAuth, (req, res) => {
  const db = getDb();
  const setting = db.prepare("SELECT value FROM settings WHERE key = 'scan_inbox_folder'").get();
  const folder = setting?.value?.trim();
  const { filename } = req.query;

  if (!folder || !filename) return res.status(400).json({ error: 'Missing folder or filename' });

  // Prevent path traversal
  const safeName = path.basename(filename);
  const filePath = path.join(folder, safeName);

  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

  try {
    const buf = fs.readFileSync(filePath);
    const ext = path.extname(safeName).toLowerCase();
    const mime =
      ext === '.pdf'
        ? 'application/pdf'
        : ext === '.png'
          ? 'image/png'
          : ext === '.tif' || ext === '.tiff'
            ? 'image/tiff'
            : 'image/jpeg';
    const preview = `data:${mime};base64,${buf.toString('base64')}`;
    res.json({ preview, mime });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/scan/attach/:jobId — attach an inbox file to a job ──────────────
router.post('/attach/:jobId', requireAuth, (req, res) => {
  const { filename, attachType, docType, deleteAfter } = req.body;
  // attachType: 'signature' | 'photo'
  // docType (signature): 'contract' | 'proposal'
  // docType (photo): 'receipt' | 'check' | other

  if (!filename) return res.status(400).json({ error: 'No filename provided' });

  const db = getDb();
  const setting = db.prepare("SELECT value FROM settings WHERE key = 'scan_inbox_folder'").get();
  const folder = setting?.value?.trim();

  if (!folder) return res.status(400).json({ error: 'Scan inbox folder not configured' });

  const safeName = path.basename(filename);
  const srcPath = path.join(folder, safeName);

  if (!fs.existsSync(srcPath)) return res.status(404).json({ error: 'File not found in inbox' });

  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  try {
    const jobDir = path.resolve(__dirname, '../../uploads/jobs', req.params.jobId);
    if (!fs.existsSync(jobDir)) fs.mkdirSync(jobDir, { recursive: true });

    const ext = path.extname(safeName) || '.jpg';
    const ts = Date.now();

    if (attachType === 'signature') {
      const destFilename = `signed_${docType}_${ts}${ext}`;
      const destPath = path.join(jobDir, destFilename);
      fs.copyFileSync(srcPath, destPath);

      const newStatus = docType === 'contract' ? 'contract_signed' : 'proposal_approved';
      const pdfCol = docType === 'contract' ? 'contract_pdf_path' : 'proposal_pdf_path';

      db.prepare(
        `UPDATE jobs SET status = ?, ${pdfCol} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      ).run(newStatus, destPath, req.params.jobId);

      if (newStatus === 'contract_signed') {
        autoCreateDepositInvoice(req.params.jobId, db);
      }

      db.prepare(
        'INSERT INTO job_photos (job_id, filename, original_name, caption) VALUES (?, ?, ?, ?)',
      ).run(req.params.jobId, destFilename, safeName, `Scanned signed ${docType}`);

      if (deleteAfter) fs.unlinkSync(srcPath);

      res.json({ ok: true, attachType, docType, status: newStatus, filename: destFilename });
    } else {
      const label = docType || 'scan';
      const destFilename = `${label}_${ts}${ext}`;
      const destPath = path.join(jobDir, destFilename);
      fs.copyFileSync(srcPath, destPath);

      const caption =
        docType === 'receipt'
          ? 'Receipt / Check'
          : docType === 'check'
            ? 'Check'
            : 'Scanned document';

      const result = db
        .prepare(
          'INSERT INTO job_photos (job_id, filename, original_name, caption) VALUES (?, ?, ?, ?)',
        )
        .run(req.params.jobId, destFilename, safeName, caption);

      if (deleteAfter) fs.unlinkSync(srcPath);

      res.json({
        ok: true,
        attachType,
        caption,
        filename: destFilename,
        photoId: result.lastInsertRowid,
      });
    }
  } catch (err) {
    console.error('[scan] attach error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
