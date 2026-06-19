// server/routes/management.js
// Job CRUD, status, communications, and reporting routes
const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { requireFields, validateEmail } = require('../middleware/validate');
const { getDb } = require('../db/database');
const { sendEmail } = require('../services/emailService');
const { logAudit } = require('../services/auditService');
const { logActivity } = require('./activityLog');
const { addClient, removeClient, notifyClients } = require('../services/sseManager');
const {
  mergeContactIntoProposal,
  saveReviewPending,
  findPriorQuoteContext,
  finalizeJobVersioning,
} = require('../services/jobHelpers');

// PATCH /:id/takeoff — save material take-off data to a job
router.patch('/:id/takeoff', requireAuth, (req, res) => {
  const db = getDb();
  const job = db.prepare('SELECT id FROM jobs WHERE id = ? AND archived = 0').get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  const { takeoffData } = req.body;
  if (!takeoffData) return res.status(400).json({ error: 'takeoffData is required' });
  db.prepare('UPDATE jobs SET takeoff_data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
    JSON.stringify(takeoffData),
    req.params.id,
  );
  logAudit(req.params.id, 'takeoff_saved', 'Material take-off saved', req.session?.name || 'user');
  res.json({ success: true });
});

// PATCH /:id/pass-through-responsibility — save who pays each pass-through cost before contract generation
router.patch(
  '/:id/pass-through-responsibility',
  requireAuth,
  requireRole('admin', 'pm', 'system_admin'),
  (req, res) => {
    const db = getDb();
    const job = db
      .prepare('SELECT id, proposal_data FROM jobs WHERE id = ? AND archived = 0')
      .get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const { permit_paid_by, engineer_paid_by, architect_paid_by } = req.body;
    const VALID = ['pb', 'customer_direct'];
    if (permit_paid_by && !VALID.includes(permit_paid_by))
      return res.status(400).json({ error: 'Invalid permit_paid_by' });
    if (engineer_paid_by && !VALID.includes(engineer_paid_by))
      return res.status(400).json({ error: 'Invalid engineer_paid_by' });
    if (architect_paid_by && !VALID.includes(architect_paid_by))
      return res.status(400).json({ error: 'Invalid architect_paid_by' });

    let proposal;
    try {
      proposal = JSON.parse(job.proposal_data || '{}');
    } catch {
      proposal = {};
    }
    if (!proposal.job) proposal.job = {};

    if (permit_paid_by !== undefined) proposal.job.permit_paid_by = permit_paid_by;
    if (engineer_paid_by !== undefined) proposal.job.engineer_paid_by = engineer_paid_by;
    if (architect_paid_by !== undefined) proposal.job.architect_paid_by = architect_paid_by;

    db.prepare(
      'UPDATE jobs SET proposal_data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    ).run(JSON.stringify(proposal), req.params.id);
    logAudit(
      req.params.id,
      'pass_through_responsibility_set',
      `Pass-through payment responsibility updated`,
      req.session?.name || 'user',
    );
    res.json({ success: true });
  },
);

// GET archived jobs (must be before /:id route)
router.get('/archived/list', requireAuth, (req, res) => {
  const db = getDb();
  const jobs = db.prepare('SELECT * FROM jobs WHERE archived = 1 ORDER BY archived_at DESC').all();
  res.json({ jobs });
});

// GET all jobs
router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const { status, limit = 50, offset = 0 } = req.query;
  let query = `
    SELECT j.id, j.customer_name, j.customer_email, j.customer_phone,
           j.project_address, j.project_city, j.status, j.total_value,
           j.deposit_amount, j.created_at, j.updated_at, j.submitted_by,
           j.contact_id, j.pb_number, j.external_ref,
           (SELECT COUNT(*) FROM invoices WHERE job_id = j.id AND status = 'draft') AS inv_draft,
           (SELECT COUNT(*) FROM invoices WHERE job_id = j.id AND status = 'pending_send') AS inv_pending_send,
           (SELECT COUNT(*) FROM invoices WHERE job_id = j.id AND status = 'sent') AS inv_sent,
           (SELECT COUNT(*) FROM invoices WHERE job_id = j.id AND status = 'paid') AS inv_paid
    FROM jobs j WHERE j.archived = 0`;
  const params = [];
  if (status) {
    query += ' AND j.status = ?';
    params.push(status);
  }
  query += ' ORDER BY j.created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), parseInt(offset));
  const jobs = db.prepare(query).all(...params);
  const total = db
    .prepare(
      'SELECT COUNT(*) as count FROM jobs WHERE archived = 0' + (status ? ' AND status = ?' : ''),
    )
    .get(...(status ? [status] : []));
  res.json({ jobs, total: total.count });
});

// GET single job with full detail
router.get('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const conversations = db
    .prepare('SELECT * FROM conversations WHERE job_id = ? ORDER BY created_at ASC')
    .all(req.params.id);
  const clarifications = db
    .prepare('SELECT * FROM clarifications WHERE job_id = ? ORDER BY asked_at ASC')
    .all(req.params.id);
  const auditLog = db
    .prepare('SELECT * FROM audit_log WHERE job_id = ? ORDER BY created_at ASC')
    .all(req.params.id);

  if (job.proposal_data) {
    try {
      job.proposal_data = JSON.parse(job.proposal_data);
    } catch {
      /* ignore */
    }
  }
  if (job.contract_data) {
    try {
      job.contract_data = JSON.parse(job.contract_data);
    } catch {
      /* ignore */
    }
  }
  if (job.flagged_items) {
    try {
      job.flagged_items = JSON.parse(job.flagged_items);
    } catch {
      /* ignore */
    }
  }

  let versionHistory = [];
  if (job.quote_number) {
    versionHistory = db
      .prepare(
        `SELECT id, version, status, total_value, created_at, estimate_source, proposal_pdf_path
       FROM jobs WHERE quote_number = ? ORDER BY version ASC`,
      )
      .all(job.quote_number);
  }

  if (job.contact_id) {
    const contact = db
      .prepare(
        'SELECT id, name, email, phone, address, city, customer_number, pb_customer_number FROM contacts WHERE id = ?',
      )
      .get(job.contact_id);
    if (contact) job.contact = contact;
  }

  res.json({ job, conversations, clarifications, auditLog, versionHistory });
});

// PATCH update job notes (and optionally status)
router.patch('/:id/notes', requireAuth, requireFields(['notes']), (req, res) => {
  const db = getDb();
  const { notes, status } = req.body;
  if (status) {
    const allowed = ['admin', 'pm', 'system_admin'];
    if (!req.session || !allowed.includes(req.session.role)) {
      return res.status(403).json({ error: 'Insufficient permissions to change job status' });
    }
    const prevJob = db
      .prepare('SELECT status, contact_id, project_address FROM jobs WHERE id = ?')
      .get(req.params.id);
    db.prepare(
      'UPDATE jobs SET notes = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    ).run(notes, status, req.params.id);
    logAudit(
      req.params.id,
      `status_changed_to_${status}`,
      `Status set to ${status} by admin`,
      'admin',
    );
    if (status === 'complete' && prevJob?.status !== 'complete') {
      try {
        const contactRef3 = prevJob?.contact_id
          ? db
              .prepare('SELECT pb_customer_number FROM contacts WHERE id = ?')
              .get(prevJob.contact_id)
          : null;
        logActivity({
          customer_number: contactRef3?.pb_customer_number || null,
          job_id: req.params.id,
          event_type: 'JOB_COMPLETED',
          description: `Job marked complete for ${prevJob?.project_address || 'project'}`,
          recorded_by: req.session?.name || 'admin',
        });
      } catch {
        /* ignore */
      }
    }
  } else {
    db.prepare('UPDATE jobs SET notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
      notes,
      req.params.id,
    );
  }
  res.json({ success: true });
});

// PATCH /:id/customer — update customer name/email/phone/address on an existing job.
// If updateContact=true and the job has a linked contact, syncs those fields to the contact record too.
// If updateContact=false, only the job record is updated (local override).
router.patch(
  '/:id/customer',
  requireAuth,
  requireRole('admin', 'pm', 'system_admin'),
  validateEmail('email'),
  (req, res) => {
    const db = getDb();
    const { name, email, phone, address, city, updateContact } = req.body;
    const job = db.prepare('SELECT id, contact_id FROM jobs WHERE id = ?').get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const updateJobStmt = db.prepare(
      `UPDATE jobs SET
    customer_name   = COALESCE(NULLIF(?, ''), customer_name),
    customer_email  = COALESCE(NULLIF(?, ''), customer_email),
    customer_phone  = COALESCE(NULLIF(?, ''), customer_phone),
    project_address = COALESCE(NULLIF(?, ''), project_address),
    project_city    = COALESCE(NULLIF(?, ''), project_city),
    updated_at = CURRENT_TIMESTAMP
  WHERE id = ?`,
    );

    try {
      db.transaction(() => {
        updateJobStmt.run(name || '', email || '', phone || '', address || '', city || '', job.id);

        if (job.contact_id && updateContact) {
          db.prepare(
            `UPDATE contacts SET
          name    = COALESCE(NULLIF(?, ''), name),
          email   = COALESCE(NULLIF(?, ''), email),
          phone   = COALESCE(NULLIF(?, ''), phone),
          address = COALESCE(NULLIF(?, ''), address),
          city    = COALESCE(NULLIF(?, ''), city),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
          ).run(name || '', email || '', phone || '', address || '', city || '', job.contact_id);

          db.prepare(
            `UPDATE jobs SET
          customer_name   = COALESCE(NULLIF(?, ''), customer_name),
          customer_email  = COALESCE(NULLIF(?, ''), customer_email),
          customer_phone  = COALESCE(NULLIF(?, ''), customer_phone),
          project_address = COALESCE(NULLIF(?, ''), project_address),
          project_city    = COALESCE(NULLIF(?, ''), project_city),
          updated_at = CURRENT_TIMESTAMP
        WHERE contact_id = ? AND id != ?`,
          ).run(
            name || '',
            email || '',
            phone || '',
            address || '',
            city || '',
            job.contact_id,
            job.id,
          );
        }
      })();
    } catch (err) {
      console.error('[jobs/customer PATCH] transaction failed:', err.message);
      return res.status(500).json({ error: 'Failed to save customer info' });
    }

    logAudit(
      job.id,
      'customer_info_updated',
      `Customer info updated${job.contact_id && updateContact ? ' (contact profile + sibling jobs synced)' : ''}`,
      req.session?.name || 'admin',
    );
    res.json({ success: true });
  },
);

// SSE endpoint — dashboard subscribes here to receive instant push notifications
router.get('/events', requireAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch {
      /* ignore */
    }
  }, 30000);

  addClient(res);
  req.on('close', () => {
    clearInterval(heartbeat);
    removeClient(res);
  });
});

// GET job stats for dashboard
router.get('/stats/summary', requireAuth, (req, res) => {
  const db = getDb();

  const byStatus = db
    .prepare('SELECT status, COUNT(*) as count FROM jobs WHERE archived = 0 GROUP BY status')
    .all();

  const total = db
    .prepare(
      "SELECT COUNT(*) as count FROM jobs WHERE archived = 0 AND created_at >= date('now','start of year')",
    )
    .get();

  const quotesCompleted = db
    .prepare(
      `SELECT COUNT(*) as count FROM jobs WHERE archived = 0
     AND status IN ('proposal_ready','proposal_sent','proposal_approved','customer_approved','contract_ready','contract_sent','contract_signed','complete')
     AND created_at >= date('now','start of year')`,
    )
    .get();

  const pipelineValue = db
    .prepare(
      `SELECT SUM(total_value) as total FROM jobs WHERE archived = 0
     AND status IN ('proposal_sent','proposal_approved','customer_approved','contract_ready','contract_sent')`,
    )
    .get();

  const revenueWon = db
    .prepare(
      `SELECT SUM(total_value) as value FROM jobs WHERE archived = 0
       AND status IN ('complete','contract_signed')
       AND updated_at >= date('now','start of year')`,
    )
    .get();

  res.json({
    total: total.count,
    byStatus,
    totalValue: pipelineValue.total || 0,
    thisMonth: {
      count: quotesCompleted.count,
      value: revenueWon.value || 0,
    },
  });
});

// ARCHIVE a job (soft delete) — with optional outcome capture
router.delete('/:id', requireAuth, requireRole('admin', 'system_admin'), (req, res) => {
  const db = getDb();
  const job = db.prepare('SELECT id FROM jobs WHERE id = ?').get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const { closed_reason, closed_note } = req.body || {};
  const validReasons = [
    'lost_price',
    'lost_timing',
    'lost_competitor',
    'ghosted',
    'mistake',
    'completed',
  ];
  const reason = validReasons.includes(closed_reason) ? closed_reason : null;
  const note = typeof closed_note === 'string' ? closed_note.trim().slice(0, 500) : null;

  db.prepare(
    'UPDATE jobs SET archived = 1, archived_at = CURRENT_TIMESTAMP, closed_reason = ?, closed_note = ? WHERE id = ?',
  ).run(reason, note || null, req.params.id);
  const reasonLabel = reason ? ` (${reason}${note ? ': ' + note : ''})` : '';
  logAudit(req.params.id, 'archived', `Job archived${reasonLabel}`, 'admin');

  // Void all open signing sessions when job is completed
  if (reason === 'completed') {
    db.prepare(
      "UPDATE signing_sessions SET status = 'void' WHERE job_id = ? AND status != 'signed'",
    ).run(req.params.id);
    logAudit(
      req.params.id,
      'signing_sessions_voided',
      'Signing links voided — job marked completed',
      'admin',
    );
  }

  res.json({ success: true, message: 'Job archived' });
});

// RESTORE an archived job
router.post('/:id/restore', requireAuth, requireRole('admin', 'system_admin'), (req, res) => {
  const db = getDb();
  db.prepare(
    'UPDATE jobs SET archived = 0, archived_at = NULL, closed_reason = NULL, closed_note = NULL WHERE id = ?',
  ).run(req.params.id);
  logAudit(req.params.id, 'restored', 'Job restored from archive (outcome cleared)', 'admin');
  res.json({ success: true });
});

// GET /:id/margin — financial profit margin breakdown for a job
router.get('/:id/margin', requireAuth, (req, res) => {
  const db = getDb();
  const job = db.prepare('SELECT proposal_data FROM jobs WHERE id = ?').get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  if (!job.proposal_data) return res.json({ hasData: false });

  let proposalData;
  try {
    proposalData =
      typeof job.proposal_data === 'string' ? JSON.parse(job.proposal_data) : job.proposal_data;
  } catch {
    return res.json({ hasData: false });
  }

  const settingsRows = db
    .prepare('SELECT key, value FROM settings WHERE category = ?')
    .all('markup');
  const settingsMap = {};
  for (const row of settingsRows) settingsMap[row.key] = row.value;
  const targetSubOandP = Number(settingsMap['markup.subOandP']) || 0.15;
  const targetGcOandP = Number(settingsMap['markup.gcOandP']) || 0.25;
  const targetContingency = Number(settingsMap['markup.contingency']) || 0.1;

  const pricing = proposalData.pricing || {};
  const stored = pricing.appliedRates || {};
  const hasStoredRates = stored.subOandP != null;
  const actualSubOandP = hasStoredRates ? Number(stored.subOandP) : targetSubOandP;
  const actualGcOandP = hasStoredRates ? Number(stored.gcOandP) : targetGcOandP;
  const actualContingency = hasStoredRates ? Number(stored.contingency) : targetContingency;

  const items = proposalData.lineItems || [];
  const contractPrice = pricing.totalContractPrice || proposalData.totalValue || 0;

  const implicitDumpsterBaseCost = Number(pricing.implicitDumpsterBaseCost) || 0;

  let markupBaseCost = implicitDumpsterBaseCost;
  let stretchBaseCost = 0;
  for (const item of items) {
    if (item.isStretchCode) {
      stretchBaseCost += item.baseCost || 0;
    } else {
      markupBaseCost += item.baseCost || 0;
    }
  }
  const totalBaseCost = markupBaseCost + stretchBaseCost;

  const afterSubOandP = Math.round(markupBaseCost * (1 + actualSubOandP));
  const afterGcOandP = Math.round(afterSubOandP * (1 + actualGcOandP));
  const afterContingency = Math.round(afterGcOandP * (1 + actualContingency));

  const subOandPDollar = afterSubOandP - markupBaseCost;
  const gcOandPDollar = afterGcOandP - afterSubOandP;
  const contingencyDollar = afterContingency - afterGcOandP;

  const targetAfterSub = Math.round(markupBaseCost * (1 + targetSubOandP));
  const targetAfterGc = Math.round(targetAfterSub * (1 + targetGcOandP));
  const targetAfterCont = Math.round(targetAfterGc * (1 + targetContingency));
  const targetContractPrice = targetAfterCont + stretchBaseCost;

  const actualNetMarginPct =
    contractPrice > 0
      ? Math.round(((contractPrice - totalBaseCost) / contractPrice) * 1000) / 10
      : 0;

  const layerPass = (actual, target) => Math.abs(actual - target) <= 0.01;
  const overallPass =
    contractPrice > 0 && targetContractPrice > 0
      ? Math.abs((contractPrice - targetContractPrice) / targetContractPrice) <= 0.01
      : null;

  res.json({
    hasData: true,
    hasStoredRates,
    baseCost: totalBaseCost,
    markupBaseCost,
    stretchBaseCost,
    contractPrice,
    targetContractPrice,
    actualNetMarginPct,
    layers: [
      {
        label: 'Sub O&P',
        targetPct: targetSubOandP,
        actualPct: actualSubOandP,
        dollarAdded: subOandPDollar,
        pass: layerPass(actualSubOandP, targetSubOandP),
      },
      {
        label: 'GC O&P',
        targetPct: targetGcOandP,
        actualPct: actualGcOandP,
        dollarAdded: gcOandPDollar,
        pass: layerPass(actualGcOandP, targetGcOandP),
      },
      {
        label: 'Contingency',
        targetPct: targetContingency,
        actualPct: actualContingency,
        dollarAdded: contingencyDollar,
        pass: layerPass(actualContingency, targetContingency),
      },
    ],
    overallPass,
  });
});

// POST send contract to customer
router.post(
  '/:id/send-to-customer',
  requireAuth,
  requireRole('admin', 'pm', 'system_admin'),
  async (req, res) => {
    const db = getDb();
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (!job.contract_pdf_path) return res.status(400).json({ error: 'No contract PDF ready' });

    try {
      await sendEmail({
        to: job.customer_email,
        subject: `Your Project Proposal — Preferred Builders General Services`,
        html: `
        <p>Dear ${job.customer_name},</p>
        <p>Thank you for choosing Preferred Builders General Services Inc. Please find your project contract attached for review.</p>
        <p>Please review the document carefully. If you have any questions, please contact us at 978-377-1784.</p>
        <p>Best regards,<br>Jackson Deaquino<br>Preferred Builders General Services Inc.<br>LIC# HIC-197400</p>
      `,
        attachmentPath: job.contract_pdf_path,
        attachmentName: `PB_Contract_${job.customer_name?.replace(/\s/g, '_')}.pdf`,
        emailType: 'contract',
        jobId: job.id,
      });

      db.prepare('UPDATE jobs SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
        'contract_sent',
        job.id,
      );
      logAudit(
        job.id,
        'contract_sent_to_customer',
        `Contract emailed to ${job.customer_email}`,
        'admin',
      );
      res.json({ success: true, message: `Contract sent to ${job.customer_email}` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },
);

// POST /:id/reprocess — retry AI estimation for a job stuck in error status
router.post(
  '/:id/reprocess',
  requireAuth,
  requireRole('admin', 'pm', 'system_admin'),
  async (req, res) => {
    const db = getDb();
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (!job.raw_estimate_data)
      return res.status(400).json({ error: 'No raw estimate data to reprocess' });

    db.prepare('UPDATE jobs SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
      'processing',
      job.id,
    );
    res.json({ success: true, message: 'Reprocessing started' });

    const extraContext = req.body?.extraContext || '';
    const { processEstimate } = require('../services/claudeService');
    (async () => {
      try {
        console.log(`[Reprocess Job ${job.id}] Starting Claude processEstimate...`);
        const fullEstimate = `[Job ID: ${job.id}]\nProject Address: ${job.project_address || 'see estimate'}\n\nESTIMATE DETAILS:\n${job.raw_estimate_data}${extraContext ? `\n\n--- ADDITIONAL CONTEXT FROM NEW FILES ---\n${extraContext}` : ''}`;
        const { context: priorCtx } = findPriorQuoteContext(db, {
          rawText: job.raw_estimate_data,
          contactId: job.contact_id,
          projectAddress: job.project_address,
        });
        const proposalData = await processEstimate(
          fullEstimate,
          job.id,
          'en',
          db,
          job.project_address || null,
          priorCtx,
        );
        mergeContactIntoProposal(db, job.id, proposalData);
        console.log(
          `[Reprocess Job ${job.id}] Claude returned. readyToGenerate=${proposalData.readyToGenerate}`,
        );

        if (
          proposalData.readyToGenerate === false &&
          proposalData.clarificationsNeeded?.length > 0
        ) {
          finalizeJobVersioning(db, job.id, proposalData);
          db.prepare('UPDATE jobs SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
            'clarification',
            job.id,
          );
          const insertQ = db.prepare('INSERT INTO clarifications (job_id, question) VALUES (?, ?)');
          for (const q of proposalData.clarificationsNeeded) insertQ.run(job.id, q);
        } else {
          finalizeJobVersioning(db, job.id, proposalData);
          saveReviewPending(db, proposalData, job.id);
          logAudit(
            job.id,
            'reprocessed',
            'Job reprocessed after error',
            req.session?.name || 'admin',
          );
          notifyClients('job_updated', { jobId: job.id, status: 'review_pending' });
        }
      } catch (err) {
        const errMsg = err.message || String(err);
        console.error(`[Reprocess Job ${job.id}] ERROR: ${errMsg}\n${err.stack || ''}`);
        db.prepare(
          'UPDATE jobs SET status = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        ).run('error', errMsg, job.id);
      }
    })();
  },
);

// POST /:id/import-proposal — system_admin only: paste raw JSON, reprice, regenerate PDF
router.post('/:id/import-proposal', requireAuth, requireRole('system_admin'), async (req, res) => {
  const db = getDb();
  const job = db.prepare('SELECT * FROM jobs WHERE id = ? AND archived = 0').get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const { proposalJson } = req.body;
  if (!proposalJson) return res.status(400).json({ error: 'proposalJson is required' });

  let parsed;
  try {
    parsed = typeof proposalJson === 'string' ? JSON.parse(proposalJson) : proposalJson;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON — could not parse' });
  }

  if (!Array.isArray(parsed.lineItems) || parsed.lineItems.length === 0) {
    return res.status(400).json({ error: 'JSON must contain a non-empty lineItems array' });
  }

  try {
    const { applyPricing, getMarkupRates } = require('../services/claudeEstimate');
    const rates = getMarkupRates();
    applyPricing(parsed, rates);

    finalizeJobVersioning(db, job.id, parsed);

    const { generatePDF } = require('../services/pdfService');
    const pdfPath = await generatePDF(parsed, 'proposal', job.id);

    db.prepare(
      `
        UPDATE jobs SET
          proposal_data = ?, proposal_pdf_path = ?,
          total_value = ?, deposit_amount = ?,
          status = 'proposal_ready',
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
    ).run(
      JSON.stringify(parsed),
      pdfPath,
      parsed.totalValue || 0,
      parsed.depositAmount || 0,
      job.id,
    );

    logAudit(
      job.id,
      'proposal_imported',
      `Proposal JSON imported and regenerated by ${req.session?.name || 'system_admin'}`,
      req.session?.name || 'system_admin',
    );
    notifyClients('job_updated', { jobId: job.id, status: 'proposal_ready' });

    res.json({
      success: true,
      totalValue: parsed.totalValue,
      depositAmount: parsed.depositAmount,
    });
  } catch (err) {
    console.error('[ImportProposal]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Presence: ping (I am viewing this job) ───────────────────────────────────
router.post('/:id/presence', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const editorName = req.session?.name || 'Someone';
    db.prepare(
      'UPDATE jobs SET active_editor = ?, active_editor_at = CURRENT_TIMESTAMP WHERE id = ?',
    ).run(editorName, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Presence: get current active editor ──────────────────────────────────────
router.get('/:id/presence', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const row = db
      .prepare('SELECT active_editor, active_editor_at FROM jobs WHERE id = ?')
      .get(req.params.id);
    if (!row) return res.json({ editor: null });

    const WINDOW_MS = 10 * 60 * 1000; // 10 minutes
    const editedAt = row.active_editor_at ? new Date(row.active_editor_at + 'Z').getTime() : 0;
    const isActive = Date.now() - editedAt < WINDOW_MS;

    res.json({
      editor: isActive ? row.active_editor : null,
      editedAt: row.active_editor_at,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
