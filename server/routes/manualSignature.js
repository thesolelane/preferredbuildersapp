// server/routes/manualSignature.js
// POST /api/manual-signature/:jobId
// Accepts a scanned/uploaded paper proposal or contract PDF/image,
// saves it, updates job status, logs to audit trail, and fires a
// real-time notification so the Dashboard refreshes automatically.

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { requireAuth } = require('../middleware/auth');
const { getDb } = require('../db/database');
const { notifyJobUpdate } = require('../services/realtimeService');
const { logAudit } = require('../services/auditService');
const { autoCreateDepositInvoice } = require('../services/autoDepositInvoice');

const UPLOAD_ROOT = path.resolve(__dirname, '../../uploads/manual_signatures');

router.post('/:jobId', requireAuth, async (req, res) => {
  const db = getDb();
  const { jobId } = req.params;
  const { doc_type } = req.body; // 'proposal' | 'contract'

  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  if (!req.files || !req.files.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const file = req.files.file;
  const ext = path.extname(file.name) || '.pdf';
  const timestamp = Date.now();
  const filename = `${doc_type || 'signed'}_${jobId}_${timestamp}${ext}`;

  const destDir = path.join(UPLOAD_ROOT, String(jobId));
  fs.mkdirSync(destDir, { recursive: true });
  const destPath = path.join(destDir, filename);

  try {
    await file.mv(destPath);
  } catch (err) {
    console.error('[manualSignature] File move error:', err);
    return res.status(500).json({ error: 'Failed to save file' });
  }

  // Determine new job status from document type
  const newStatus =
    doc_type === 'contract'
      ? 'contract_signed'
      : doc_type === 'proposal'
        ? 'proposal_approved'
        : null;

  if (newStatus) {
    db.prepare('UPDATE jobs SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
      newStatus,
      jobId,
    );
    if (newStatus === 'contract_signed') {
      autoCreateDepositInvoice(jobId, db);
    }
  }

  // Audit log
  const actor = req.user?.name || req.user?.email || 'staff';
  const label = doc_type === 'contract' ? 'Contract' : 'Proposal';
  logAudit(
    jobId,
    'manual_signature_upload',
    `${label} manually signed doc uploaded by ${actor}. File: ${filename}`,
  );

  // Real-time push — triggers Dashboard to reload
  notifyJobUpdate(jobId, 'manual_signature', { doc_type, filename });
  notifyJobUpdate('dashboard', 'manual_signature', { jobId, doc_type });

  res.json({
    ok: true,
    filename,
    path: `/uploads/manual_signatures/${jobId}/${filename}`,
    new_status: newStatus,
  });
});

module.exports = router;
