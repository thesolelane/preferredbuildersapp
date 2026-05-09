// server/routes/estimateWizard.js
// Wizard routes: /wizard, /wizard/extract-text, /wizard/questions, /wizard/submit

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getDb } = require('../db/database');
const { sendWhatsApp } = require('../services/whatsappService');
const { logAudit } = require('../services/auditService');
const { logActivity } = require('./activityLog');
const jobMemory = require('../services/jobMemory');
const { tickQuoteCounter } = require('../services/assessmentService');
const { notifyClients } = require('../services/sseManager');
const {
  findOrCreateContact,
  stripPII,
  findPriorQuoteContext,
  mergeContactIntoProposal,
  finalizeJobVersioning,
  saveReviewPending,
  generatePBNumber,
  generateQuoteNumber,
  extractExternalRef,
} = require('../services/jobHelpers');

// Helper: detect potential duplicate jobs (same address OR customer within 30 days)
function checkDuplicateJob(db, customerName, projectAddress) {
  try {
    const conditions = [];
    const params = [];
    const normAddr = (projectAddress || '').trim().toLowerCase();
    const normName = (customerName || '').trim().toLowerCase();
    if (normAddr) {
      conditions.push('LOWER(TRIM(project_address)) = ?');
      params.push(normAddr);
    }
    if (normName) {
      conditions.push('LOWER(TRIM(customer_name)) = ?');
      params.push(normName);
    }
    if (!conditions.length) return [];
    return db
      .prepare(
        `
      SELECT id, pb_number, customer_name, project_address, status,
             strftime('%m/%d/%Y', created_at) AS created_date
      FROM jobs
      WHERE archived = 0
        AND datetime(created_at) >= datetime('now', '-30 days')
        AND (${conditions.join(' OR ')})
      ORDER BY created_at DESC LIMIT 5
    `,
      )
      .all(...params);
  } catch {
    return [];
  }
}

// ── Build trades narrative from selected trades payload ────────────────────
function buildTradesNarrative(selectedTrades) {
  if (!Array.isArray(selectedTrades) || selectedTrades.length === 0) return '';
  const lines = selectedTrades.map((t) => `- ${t.name} (${t.deptName}): ${t.meaning}`);
  return `\n\nEXPLICITLY SELECTED TRADES (user-confirmed):\n${lines.join('\n')}\nUse this list to calibrate line items and pricing — these trades are confirmed to be in scope.`;
}

// ── POST /wizard — simple wizard (scope text only, immediate processing) ──
router.post('/wizard', requireAuth, async (req, res) => {
  const { v4: uuidv4 } = require('uuid');
  const db = getDb();
  const {
    contactName = '',
    contactPhone = '',
    contactEmail = '',
    street = '',
    city = '',
    state = '',
    zip = '',
    scopeText = '',
  } = req.body;

  if (!contactName.trim()) return res.status(400).json({ error: 'Contact name is required' });
  if (!street.trim()) return res.status(400).json({ error: 'Street address is required' });
  if (!city.trim()) return res.status(400).json({ error: 'City is required' });
  if (!scopeText.trim()) return res.status(400).json({ error: 'Scope of work is required' });

  const projectAddress = [street, city, state, zip].filter(Boolean).join(', ');
  const jobId = uuidv4();

  let contactRef = null;
  if (contactName || contactEmail) {
    try {
      contactRef = findOrCreateContact(db, {
        name: contactName,
        email: contactEmail,
        phone: contactPhone,
        address: street,
        city,
        state: state || 'MA',
      });
    } catch (e) {
      console.warn('[Wizard Job] Contact upsert failed:', e.message);
    }
  }

  const wizardBy = req.session?.name ? `web:${req.session.name}` : 'web:wizard';
  db.prepare(
    `
    INSERT INTO jobs (id, customer_name, customer_email, customer_phone, project_address, raw_estimate_data, status, submitted_by, contact_id)
    VALUES (?, ?, ?, ?, ?, ?, 'processing', ?, ?)
  `,
  ).run(
    jobId,
    contactName,
    contactEmail,
    contactPhone,
    projectAddress,
    scopeText,
    wizardBy,
    contactRef?.id || null,
  );

  try {
    const pbNum = generatePBNumber(db);
    const extRef = extractExternalRef(scopeText);
    const qNum = generateQuoteNumber(db);
    db.prepare(
      'UPDATE jobs SET pb_number = ?, external_ref = ?, quote_number = ? WHERE id = ?',
    ).run(pbNum, extRef, qNum, jobId);
  } catch (e) {
    console.warn('[Wizard] PB/Quote number generation failed:', e.message);
  }

  try {
    logActivity({
      customer_number: contactRef?.pb_customer_number || null,
      job_id: jobId,
      event_type: 'ESTIMATE_CREATED',
      description: `Estimate created via wizard for ${projectAddress || contactName}`,
      recorded_by: req.session?.name || 'web:wizard',
    });
  } catch (e) {
    console.warn('[Wizard] logActivity failed:', e.message);
  }

  const wizDupe = checkDuplicateJob(db, contactName, projectAddress);
  notifyClients('job_updated', { jobId, status: 'processing' });
  res.json({
    jobId,
    status: 'processing',
    message: 'Job created. Processing estimate...',
    ...(wizDupe.length ? { duplicateWarning: wizDupe } : {}),
  });

  // Background property enrichment (non-blocking)
  if (projectAddress) {
    const { enrichPropertyBackground } = require('../services/propertyEnrichment');
    enrichPropertyBackground(db, 'job', jobId, projectAddress);
  }

  const { processEstimate } = require('../services/claudeService');
  (async () => {
    try {
      console.log(`[Wizard Job ${jobId}] Starting Claude processEstimate...`);

      const sanitizedScope = stripPII(scopeText);
      const fullEstimate = contactRef
        ? `[Customer Ref: ${contactRef.csn} | Job ID: ${jobId}]\nProject Address: ${projectAddress || 'see estimate'}\n\nSCOPE OF WORK:\n${sanitizedScope}`
        : `[Job ID: ${jobId}]\nProject Address: ${projectAddress || 'see estimate'}\n\nSCOPE OF WORK:\n${sanitizedScope}`;

      const { context: priorCtx } = findPriorQuoteContext(db, {
        rawText: sanitizedScope,
        contactId: contactRef?.id,
        projectAddress,
      });
      const proposalData = await processEstimate(
        fullEstimate,
        jobId,
        'en',
        db,
        projectAddress,
        priorCtx,
      );
      mergeContactIntoProposal(db, jobId, proposalData);
      console.log(
        `[Wizard Job ${jobId}] Claude returned proposal. readyToGenerate=${proposalData.readyToGenerate}`,
      );

      if (proposalData.readyToGenerate === false && proposalData.clarificationsNeeded?.length > 0) {
        finalizeJobVersioning(db, jobId, proposalData);
        db.prepare('UPDATE jobs SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
          'clarification',
          jobId,
        );
        const insertQ = db.prepare('INSERT INTO clarifications (job_id, question) VALUES (?, ?)');
        for (const q of proposalData.clarificationsNeeded) insertQ.run(jobId, q);
        console.log(
          `[Wizard Job ${jobId}] Status: clarification (${proposalData.clarificationsNeeded.length} questions)`,
        );
      } else {
        if (!proposalData.customer) proposalData.customer = {};
        proposalData.customer.name = contactName || proposalData.customer.name || '';
        proposalData.customer.email = contactEmail || proposalData.customer.email || '';
        proposalData.customer.phone = contactPhone || proposalData.customer.phone || '';
        if (!proposalData.project) proposalData.project = {};
        proposalData.project.address = proposalData.project.address || street || '';
        proposalData.project.city = proposalData.project.city || city || '';
        proposalData.project.state = proposalData.project.state || state || 'MA';

        finalizeJobVersioning(db, jobId, proposalData);
        saveReviewPending(db, proposalData, jobId);
        try {
          jobMemory.saveVersion(jobId, {
            quoteNumber: proposalData.quoteNumber,
            versionNumber: proposalData.quoteVersion || 1,
            totalValue: proposalData.totalValue,
            lineItems: proposalData.lineItems,
            scopeSummary: (proposalData.project?.description || '').slice(0, 300),
          });
        } catch (memErr) {
          console.warn('[JobMemory] saveVersion failed:', memErr.message);
        }
        logAudit(jobId, 'wizard_estimate_processed', `Wizard entry — pending review`, 'admin');
        console.log(
          `[Wizard Job ${jobId}] Status: review_pending. Total: $${proposalData.totalValue}`,
        );
        tickQuoteCounter(db);
        notifyClients('job_updated', { jobId, status: 'review_pending' });
      }
    } catch (err) {
      console.error(`[Wizard Job ${jobId}] ERROR:`, err.message, err.stack);
      db.prepare('UPDATE jobs SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
        'error',
        jobId,
      );
    }
  })();
});

// ── POST /wizard/extract-text — extract text from uploaded PDF or image file ──
router.post('/wizard/extract-text', requireAuth, async (req, res) => {
  const pdfParse = require('pdf-parse');
  const Anthropic = require('@anthropic-ai/sdk');

  if (!req.files?.estimate) return res.status(400).json({ error: 'No file uploaded' });
  const file = req.files.estimate;

  let rawText = '';
  try {
    if (file.mimetype === 'application/pdf') {
      const fileBuffer = file.tempFilePath
        ? require('fs').readFileSync(file.tempFilePath)
        : file.data;
      const parsed = await pdfParse(fileBuffer);
      rawText = parsed.text.trim();
    } else if (file.mimetype.startsWith('image/')) {
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const fileBuffer = file.tempFilePath
        ? require('fs').readFileSync(file.tempFilePath)
        : file.data;
      const base64 = fileBuffer.toString('base64');
      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 3000,
        temperature: 0,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: file.mimetype, data: base64 },
              },
              {
                type: 'text',
                text: 'This is a construction estimate. Extract the TECHNICAL SCOPE ONLY: line items, quantities, dollar amounts, material specs, trade names. Do NOT include customer names, emails, or phone numbers. Format as plain text.',
              },
            ],
          },
        ],
      });
      rawText = response.content[0].text.trim();
    } else if (file.mimetype.startsWith('text/')) {
      rawText = file.data.toString('utf8').trim();
    }
  } catch (err) {
    return res.status(500).json({ error: 'Failed to read file: ' + err.message });
  }

  res.json({ text: rawText });
});

// ── POST /wizard/questions — AI generates clarifying questions from scope text ──
router.post('/wizard/questions', requireAuth, async (req, res) => {
  const { scopeText, projectAddress, budgetTarget, selectedTrades } = req.body;
  if (!scopeText || scopeText.trim().length < 20) {
    return res.status(400).json({ error: 'Scope text is required (at least 20 characters).' });
  }

  const { generateWizardQuestions } = require('../services/claudeService');
  try {
    const questions = await generateWizardQuestions(
      scopeText,
      projectAddress || '',
      budgetTarget || null,
      selectedTrades || [],
    );
    res.json({ questions });
  } catch (err) {
    console.error('[Wizard/Questions] Error:', err.message);
    res.status(500).json({ error: 'Failed to generate questions: ' + err.message });
  }
});

// ── POST /wizard/submit — resolve line items from Q&A, create job, kick off processing ──
router.post('/wizard/submit', requireAuth, async (req, res) => {
  const { v4: uuidv4 } = require('uuid');
  const fs = require('fs');
  const path = require('path');
  const db = getDb();
  const {
    customerName,
    customerEmail,
    customerPhone,
    projectAddress,
    scopeText,
    qaAnswers,
    budgetTarget,
    plansTempId,
    selectedTrades,
  } = req.body;

  if (!scopeText || scopeText.trim().length < 10) {
    return res.status(400).json({ error: 'Scope text is required.' });
  }

  const jobId = uuidv4();

  let contactRef = null;
  if (customerName || customerEmail) {
    try {
      contactRef = findOrCreateContact(db, {
        name: customerName,
        email: customerEmail,
        phone: customerPhone,
        address: projectAddress,
        city: '',
        state: 'MA',
      });
    } catch (e) {
      console.warn('[Wizard] Contact upsert failed:', e.message);
    }
  }

  const demoAdditions = (qaAnswers || [])
    .filter((qa) => qa.questionType === 'demo_check' && qa.answer === 'no' && qa.demoCost)
    .map(
      (qa) =>
        `ADDITIONAL DEMO WORK (not in original scope): Remove/demo ${qa.trade} — cost $${qa.demoCost}`,
    )
    .join('\n');

  const answersNarrative =
    (qaAnswers || []).length > 0
      ? '\n\nCLARIFICATION Q&A:\n' +
        (qaAnswers || [])
          .map(
            (qa) =>
              `Q: ${qa.question}\nA: ${qa.answer}${qa.demoCost ? ` ($${qa.demoCost} for demo)` : ''}`,
          )
          .join('\n\n')
      : '';

  const sanitizedScope = stripPII(scopeText);
  const budgetLine = budgetTarget
    ? `\nBUDGET TARGET: $${Number(budgetTarget).toLocaleString()} (soft client-facing total — calibrate line item baseCosts so that after standard markup the total lands within ±8% of this figure)`
    : '';

  const tradesNarrative = buildTradesNarrative(selectedTrades);

  const fullEstimate = contactRef
    ? `[Customer Ref: ${contactRef.csn} | Job ID: ${jobId}]\nProject Address: ${projectAddress || 'see estimate'}${budgetLine}\n\nESTIMATE DETAILS:\n${sanitizedScope}${tradesNarrative}${demoAdditions ? '\n\n' + demoAdditions : ''}${answersNarrative}`
    : `[Job ID: ${jobId}]\nProject Address: ${projectAddress || 'see estimate'}${budgetLine}\n\nESTIMATE DETAILS:\n${sanitizedScope}${tradesNarrative}${demoAdditions ? '\n\n' + demoAdditions : ''}${answersNarrative}`;

  const rawEstimateData = scopeText + answersNarrative;
  const submittedBy = req.session?.name
    ? `web:${req.session.name}`
    : req.session?.email
      ? `web:${req.session.email}`
      : 'web:wizard';

  db.prepare(
    `
    INSERT INTO jobs (id, customer_name, customer_email, customer_phone, project_address, raw_estimate_data, status, submitted_by, contact_id)
    VALUES (?, ?, ?, ?, ?, ?, 'received', ?, ?)
  `,
  ).run(
    jobId,
    customerName || '',
    customerEmail || '',
    customerPhone || '',
    projectAddress || '',
    rawEstimateData,
    submittedBy,
    contactRef?.id || null,
  );

  try {
    const pbNum = generatePBNumber(db);
    const extRef = extractExternalRef(scopeText);
    const qNum = generateQuoteNumber(db);
    db.prepare(
      'UPDATE jobs SET pb_number = ?, external_ref = ?, quote_number = ? WHERE id = ?',
    ).run(pbNum, extRef, qNum, jobId);
  } catch (e) {
    console.warn('[Wizard] PB/Quote number generation failed:', e.message);
  }

  if (plansTempId) {
    try {
      const tempDir = path.join(__dirname, '../uploads/plans', `temp_${plansTempId}`);
      const jobDir = path.join(__dirname, '../uploads/plans', jobId);
      if (fs.existsSync(tempDir)) {
        fs.mkdirSync(jobDir, { recursive: true });
        const files = fs.readdirSync(tempDir);
        const movedPaths = [];
        for (const fname of files) {
          fs.renameSync(path.join(tempDir, fname), path.join(jobDir, fname));
          movedPaths.push(`plans/${jobId}/${fname}`);
        }
        fs.rmdirSync(tempDir);
        let existing = [];
        try {
          existing = JSON.parse(
            db.prepare('SELECT attachments FROM jobs WHERE id = ?').get(jobId)?.attachments || '[]',
          );
        } catch {
          /* ignore */
        }
        db.prepare('UPDATE jobs SET attachments = ? WHERE id = ?').run(
          JSON.stringify([...existing, ...movedPaths]),
          jobId,
        );
        console.log(`[Wizard] Saved ${movedPaths.length} plan file(s) for job ${jobId}`);
      }
    } catch (e) {
      console.warn('[Wizard] Plan file move failed:', e.message);
    }
  }

  try {
    logActivity({
      customer_number: contactRef?.pb_customer_number || null,
      job_id: jobId,
      event_type: 'ESTIMATE_CREATED',
      description: `Estimate created via wizard/submit for ${projectAddress || customerName}`,
      recorded_by: req.session?.name || 'web:wizard',
    });
  } catch (e) {
    console.warn('[WizardSubmit] logActivity failed:', e.message);
  }

  const submitDupe = checkDuplicateJob(db, customerName, projectAddress);
  res.json({
    jobId,
    status: 'received',
    message: 'Wizard submission received. Processing estimate...',
    ...(submitDupe.length ? { duplicateWarning: submitDupe } : {}),
  });

  // Background property enrichment (non-blocking)
  if (projectAddress) {
    const { enrichPropertyBackground } = require('../services/propertyEnrichment');
    enrichPropertyBackground(db, 'job', jobId, projectAddress);
  }

  const { processEstimate } = require('../services/claudeService');
  (async () => {
    try {
      console.log(`[Wizard Job ${jobId}] Starting Claude processEstimate...`);
      db.prepare('UPDATE jobs SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
        'processing',
        jobId,
      );
      const { context: priorCtx } = findPriorQuoteContext(db, {
        rawText: sanitizedScope,
        contactId: contactRef?.id,
        projectAddress,
      });
      const proposalData = await processEstimate(
        fullEstimate,
        jobId,
        'en',
        db,
        projectAddress,
        priorCtx,
      );
      mergeContactIntoProposal(db, jobId, proposalData);
      console.log(
        `[Wizard Job ${jobId}] Claude returned proposal. readyToGenerate=${proposalData.readyToGenerate}`,
      );

      if (proposalData.readyToGenerate === false && proposalData.clarificationsNeeded?.length > 0) {
        finalizeJobVersioning(db, jobId, proposalData);
        db.prepare('UPDATE jobs SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
          'clarification',
          jobId,
        );
        const insertQ = db.prepare('INSERT INTO clarifications (job_id, question) VALUES (?, ?)');
        for (const q of proposalData.clarificationsNeeded) insertQ.run(jobId, q);
      } else {
        finalizeJobVersioning(db, jobId, proposalData);
        saveReviewPending(db, proposalData, jobId);
        logAudit(jobId, 'wizard_estimate_processed', `Wizard submission — pending review`, 'admin');
        console.log(
          `[Wizard Job ${jobId}] Status: review_pending. Total: $${proposalData.totalValue}`,
        );
        notifyClients('job_updated', { jobId, status: 'review_pending' });
        if (process.env.OWNER_WHATSAPP) {
          const ownerTo = process.env.OWNER_WHATSAPP.startsWith('whatsapp:')
            ? process.env.OWNER_WHATSAPP
            : `whatsapp:${process.env.OWNER_WHATSAPP}`;
          const cust = proposalData.customer?.name || customerName || 'Unknown';
          const addr = projectAddress || 'address not provided';
          await sendWhatsApp(
            ownerTo,
            `🧾 Web wizard quote ready for review.\nCustomer: *${cust}*\nAddress: ${addr}\nTotal: $${proposalData.totalValue?.toLocaleString()}\nDeposit: $${proposalData.depositAmount?.toLocaleString()}\n${proposalData.flaggedItems?.length ? `⚠️ ${proposalData.flaggedItems.length} item(s) flagged\n` : '✅ No issues flagged\n'}\nLog in to review and generate proposal.`,
          );
        }
      }
    } catch (err) {
      console.error(`[Wizard Job ${jobId}] ERROR:`, err.message, err.stack);
      db.prepare('UPDATE jobs SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
        'error',
        jobId,
      );
    }
  })();
});

module.exports = router;
