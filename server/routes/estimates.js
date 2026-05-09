// server/routes/estimates.js
// AI estimation and document generation routes
const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { requireFields } = require('../middleware/validate');
const { getDb } = require('../db/database');
const { generatePDF } = require('../services/pdfService');
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
  saveProposalReady,
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
      ORDER BY created_at DESC
      LIMIT 5
    `,
      )
      .all(...params);
  } catch {
    return [];
  }
}

// Helper: convert HEIC/HEIF buffer to JPEG buffer
async function convertHeicToJpeg(buffer) {
  const heicConvert = require('heic-convert');
  return await heicConvert({ buffer, format: 'JPEG', quality: 0.92 });
}

function isHeicMime(mimetype) {
  const m = (mimetype || '').toLowerCase();
  return m === 'image/heic' || m === 'image/heif';
}

// POST extract text from uploaded images/PDFs (for wizard file attachments)
router.post('/extract-from-files', requireAuth, async (req, res) => {
  const pdfParse = require('pdf-parse');
  const Anthropic = require('@anthropic-ai/sdk');
  const fs = require('fs');
  const path = require('path');
  const { v4: uuidv4 } = require('uuid');

  if (!req.files || !Object.keys(req.files).length) {
    return res.status(400).json({ error: 'No files uploaded' });
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const allFiles = [];
  for (const key of Object.keys(req.files)) {
    const f = req.files[key];
    if (Array.isArray(f)) allFiles.push(...f);
    else allFiles.push(f);
  }

  const tempId = uuidv4();
  const tempDir = path.join(__dirname, '../uploads/plans', `temp_${tempId}`);
  fs.mkdirSync(tempDir, { recursive: true });

  const extractedParts = [];
  const savedFiles = [];

  for (const file of allFiles) {
    try {
      let fileBuffer = file.tempFilePath ? fs.readFileSync(file.tempFilePath) : file.data;

      const safeName = file.name.replace(/[^a-zA-Z0-9._\-]/g, '_');
      const destPath = path.join(tempDir, safeName);
      fs.writeFileSync(destPath, fileBuffer);
      savedFiles.push(safeName);

      if (file.mimetype === 'application/pdf') {
        const parsed = await pdfParse(fileBuffer);
        const text = parsed.text.trim();
        if (text.length > 20) {
          extractedParts.push(`[From PDF: ${file.name}]\n${text}`);
        }
      } else if (file.mimetype.startsWith('image/')) {
        const SUPPORTED_IMAGE_TYPES = [
          'image/jpeg',
          'image/jpg',
          'image/png',
          'image/gif',
          'image/webp',
        ];
        if (isHeicMime(file.mimetype)) {
          try {
            fileBuffer = Buffer.from(await convertHeicToJpeg(fileBuffer));
          } catch (_e) {
            extractedParts.push(
              `[Could not convert HEIC image "${file.name}" — please try a JPG or PNG export]`,
            );
            continue;
          }
        } else if (!SUPPORTED_IMAGE_TYPES.includes(file.mimetype.toLowerCase())) {
          extractedParts.push(
            `[Unsupported image format "${file.mimetype}" for ${file.name} — please convert to JPG or PNG and re-upload]`,
          );
        }
        if (
          isHeicMime(file.mimetype) ||
          SUPPORTED_IMAGE_TYPES.includes(file.mimetype.toLowerCase())
        ) {
          const base64 = fileBuffer.toString('base64');
          const imgMime = isHeicMime(file.mimetype)
            ? 'image/jpeg'
            : file.mimetype.toLowerCase() === 'image/jpg'
              ? 'image/jpeg'
              : file.mimetype.toLowerCase();
          const response = await anthropic.messages.create({
            model: 'claude-opus-4-5',
            max_tokens: 4000,
            temperature: 0,
            messages: [
              {
                role: 'user',
                content: [
                  {
                    type: 'image',
                    source: { type: 'base64', media_type: imgMime, data: base64 },
                  },
                  {
                    type: 'text',
                    text: `This is a construction document — blueprint, floor plan, building plan, sketch, or site photo.

Extract ALL technically relevant information:
- Project address or job site address (street number, street name, city, state) if visible anywhere on the document
- Room names and dimensions
- Square footage, linear footage, area measurements
- Materials called out (lumber sizes, concrete, tile, roofing type, etc.)
- Trade work visible (electrical panels, plumbing fixtures, HVAC equipment, etc.)
- Structural elements (beams, walls, footings, etc.)
- Any scope notes or annotations written on the plans
- Quantities and specifications if labeled

Format as a clear, detailed construction scope description. Include the project address at the very top if found, labeled "PROJECT ADDRESS: [address]". Do NOT include owner/client personal information (names, phone numbers, email). Focus on the technical scope.`,
                  },
                ],
              },
            ],
          });
          const extracted = response.content[0].text.trim();
          if (extracted.length > 10) {
            extractedParts.push(`[From Image: ${file.name}]\n${extracted}`);
          }
        }
      }
    } catch (err) {
      console.error(`[extract-from-files] Failed on ${file.name}:`, err.message);
      extractedParts.push(`[Could not read: ${file.name}]`);
    }
  }

  if (!extractedParts.length) {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    return res.status(400).json({ error: 'No readable content found in the uploaded files.' });
  }

  const allExtractedText = extractedParts.join('\n\n');

  let extractedAddress = null;
  try {
    const addrRes = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 200,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: `From the following construction document text, extract the PROJECT ADDRESS (job site address, not the owner's mailing address). Return ONLY a JSON object like: {"street":"123 Main St","city":"Boston","state":"MA","zip":"02101"} — or {"street":""} if no address is found. No explanation, just JSON.\n\n${allExtractedText.slice(0, 3000)}`,
        },
      ],
    });
    const raw = addrRes.content[0].text
      .trim()
      .replace(/```json|```/g, '')
      .trim();
    const parsed = JSON.parse(raw);
    if (parsed.street && parsed.street.length > 3) {
      extractedAddress = parsed;
    }
  } catch (e) {
    console.warn('[extract-from-files] Address extraction failed:', e.message);
  }

  res.json({
    extractedText: allExtractedText,
    extractedAddress,
    tempId,
    savedFiles,
  });
});

// POST upload PDF/image(s) as a new job estimate — supports multiple files in one request
router.post('/upload-estimate', requireAuth, async (req, res) => {
  const { v4: uuidv4 } = require('uuid');
  const pdfParse = require('pdf-parse');
  const Anthropic = require('@anthropic-ai/sdk');
  const db = getDb();

  if (!req.files?.estimate) return res.status(400).json({ error: 'No file uploaded' });

  const {
    customerName = '',
    customerEmail = '',
    customerPhone = '',
    projectAddress = '',
  } = req.body;

  const rawFiles = req.files.estimate;
  const fileList = Array.isArray(rawFiles) ? rawFiles : [rawFiles];

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  const textParts = [];

  for (const file of fileList) {
    try {
      if (file.mimetype === 'application/pdf') {
        const fileBuffer = file.tempFilePath
          ? require('fs').readFileSync(file.tempFilePath)
          : file.data;
        const parsed = await pdfParse(fileBuffer);
        const text = parsed.text.trim();
        if (text.length >= 50) {
          textParts.push(`[From: ${file.name}]\n${text}`);
        } else {
          textParts.push(`[${file.name}: PDF appears empty or unreadable]`);
        }
      } else if (file.mimetype.startsWith('image/')) {
        let fileBuffer = file.tempFilePath
          ? require('fs').readFileSync(file.tempFilePath)
          : file.data;
        let imgMime =
          file.mimetype.toLowerCase() === 'image/jpg' ? 'image/jpeg' : file.mimetype.toLowerCase();
        if (isHeicMime(imgMime)) {
          try {
            fileBuffer = Buffer.from(await convertHeicToJpeg(fileBuffer));
            imgMime = 'image/jpeg';
          } catch (_e) {
            textParts.push(`[${file.name}: Could not convert HEIC — skipped]`);
            continue;
          }
        }
        if (!SUPPORTED_IMAGE_TYPES.includes(imgMime)) {
          textParts.push(`[${file.name}: Unsupported image format "${imgMime}" — skipped]`);
          continue;
        }
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
                  source: { type: 'base64', media_type: imgMime, data: base64 },
                },
                {
                  type: 'text',
                  text: 'This is a construction estimate or invoice image. Extract the TECHNICAL SCOPE ONLY: line items, quantities, dollar amounts, material specs, trade names, and project address (for jurisdiction). Do NOT include or repeat any customer personal information such as names, email addresses, or phone numbers — omit those entirely. Format as plain text.',
                },
              ],
            },
          ],
        });
        const extracted = response.content[0].text.trim();
        if (extracted.length > 10) {
          textParts.push(`[From: ${file.name}]\n${extracted}`);
        }
      } else if (file.mimetype.startsWith('text/')) {
        const text = file.data.toString('utf8').trim();
        if (text.length > 0) textParts.push(`[From: ${file.name}]\n${text}`);
      } else {
        textParts.push(`[${file.name}: Unsupported file type "${file.mimetype}" — skipped]`);
      }
    } catch (err) {
      textParts.push(`[${file.name}: Failed to read — ${err.message}]`);
    }
  }

  const rawText = textParts.join('\n\n');

  if (!rawText.trim()) {
    return res.status(400).json({ error: 'No readable content found in the uploaded file(s).' });
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
      console.warn('[Upload] Contact upsert failed:', e.message);
    }
  }

  const sanitizedText = stripPII(rawText);
  const fileCount = fileList.length;
  const fullEstimate = contactRef
    ? `[Customer Ref: ${contactRef.csn} | Job ID: ${jobId}${fileCount > 1 ? ` | ${fileCount} files` : ''}]\n\nESTIMATE DETAILS:\n${sanitizedText}`
    : `[Job ID: ${jobId}${fileCount > 1 ? ` | ${fileCount} files` : ''}]\n\nESTIMATE DETAILS:\n${sanitizedText}`;

  const uploadedBy = req.session?.name ? `web:${req.session.name}` : 'web:upload';
  db.prepare(
    `INSERT INTO jobs (id, customer_name, customer_email, customer_phone, project_address, raw_estimate_data, status, submitted_by, contact_id)
    VALUES (?, ?, ?, ?, ?, ?, 'received', ?, ?)`,
  ).run(
    jobId,
    customerName,
    customerEmail,
    customerPhone,
    projectAddress,
    fullEstimate,
    uploadedBy,
    contactRef?.id || null,
  );

  try {
    const pbNum = generatePBNumber(db);
    const extRef = extractExternalRef(rawText);
    const qNum = generateQuoteNumber(db);
    db.prepare(
      'UPDATE jobs SET pb_number = ?, external_ref = ?, quote_number = ? WHERE id = ?',
    ).run(pbNum, extRef, qNum, jobId);
  } catch (e) {
    console.warn('[Upload] PB/Quote number generation failed:', e.message);
  }

  try {
    logActivity({
      customer_number: contactRef?.pb_customer_number || null,
      job_id: jobId,
      event_type: 'ESTIMATE_CREATED',
      description: `Estimate created via file upload (${fileCount} file${fileCount > 1 ? 's' : ''}) for ${projectAddress || customerName}`,
      recorded_by: req.session?.name || 'web:upload',
    });
  } catch (e) {
    console.warn('[Upload] logActivity failed:', e.message);
  }

  const dupeWarning = checkDuplicateJob(db, customerName, projectAddress);
  res.json({
    jobId,
    status: 'received',
    message: `${fileCount > 1 ? fileCount + ' files' : 'File'} uploaded. Processing estimate...`,
    ...(dupeWarning.length ? { duplicateWarning: dupeWarning } : {}),
  });

  // Background property enrichment (non-blocking)
  if (projectAddress) {
    const { enrichPropertyBackground } = require('../services/propertyEnrichment');
    enrichPropertyBackground(db, 'job', jobId, projectAddress);
  }

  const { processEstimate } = require('../services/claudeService');
  (async () => {
    try {
      db.prepare('UPDATE jobs SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
        'processing',
        jobId,
      );
      const { context: priorCtx } = findPriorQuoteContext(db, {
        rawText: sanitizedText,
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
      if (proposalData.readyToGenerate === false && proposalData.clarificationsNeeded?.length > 0) {
        finalizeJobVersioning(db, jobId, proposalData);
        db.prepare('UPDATE jobs SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
          'clarification',
          jobId,
        );
        const insertQ = db.prepare('INSERT INTO clarifications (job_id, question) VALUES (?, ?)');
        for (const q of proposalData.clarificationsNeeded) insertQ.run(jobId, q);
        logAudit(
          jobId,
          'upload_estimate_clarification',
          `${proposalData.clarificationsNeeded.length} questions needed`,
          'admin',
        );
      } else {
        finalizeJobVersioning(db, jobId, proposalData);
        const pdfPath = await generatePDF(proposalData, 'proposal', jobId);
        saveProposalReady(db, proposalData, pdfPath, jobId);
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
        logAudit(
          jobId,
          'upload_estimate_processed',
          `Proposal ready. Total: $${proposalData.totalValue}`,
          'admin',
        );
        tickQuoteCounter(db);
        notifyClients('job_updated', { jobId, status: 'proposal_ready' });
        if (process.env.OWNER_WHATSAPP) {
          const ownerTo = process.env.OWNER_WHATSAPP.startsWith('whatsapp:')
            ? process.env.OWNER_WHATSAPP
            : `whatsapp:${process.env.OWNER_WHATSAPP}`;
          await sendWhatsApp(
            ownerTo,
            `📋 Upload job ready for review.\nCustomer: *${proposalData.customer?.name || 'Unknown'}*\nTotal: $${proposalData.totalValue?.toLocaleString()}\nDeposit: $${proposalData.depositAmount?.toLocaleString()}\n${proposalData.flaggedItems?.length ? `⚠️ ${proposalData.flaggedItems.length} item(s) flagged\n` : '✅ No issues flagged\n'}\nLog in to review line items.`,
          );
        }
      }
    } catch (err) {
      console.error(`[Upload Job ${jobId}] ERROR:`, err.message);
      db.prepare('UPDATE jobs SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
        'error',
        jobId,
      );
    }
  })();
});

// POST manual estimate input (fallback if no Hearth/Wave)
router.post(
  '/manual',
  requireAuth,
  requireFields(['customerName', 'projectAddress', 'estimateText']),
  async (req, res) => {
    const { v4: uuidv4 } = require('uuid');
    const db = getDb();
    const { customerName, customerEmail, customerPhone, projectAddress, estimateText } = req.body;

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
        console.warn('[Manual Job] Contact upsert failed:', e.message);
      }
    }

    const manualBy = req.session?.name ? `web:${req.session.name}` : 'web:manual';
    db.prepare(
      `
    INSERT INTO jobs (id, customer_name, customer_email, customer_phone, project_address, raw_estimate_data, status, submitted_by, contact_id)
    VALUES (?, ?, ?, ?, ?, ?, 'received', ?, ?)
  `,
    ).run(
      jobId,
      customerName,
      customerEmail,
      customerPhone,
      projectAddress,
      estimateText,
      manualBy,
      contactRef?.id || null,
    );

    try {
      const pbNum = generatePBNumber(db);
      const extRef = extractExternalRef(estimateText);
      const qNum = generateQuoteNumber(db);
      db.prepare(
        'UPDATE jobs SET pb_number = ?, external_ref = ?, quote_number = ? WHERE id = ?',
      ).run(pbNum, extRef, qNum, jobId);
    } catch (e) {
      console.warn('[Manual] PB/Quote number generation failed:', e.message);
    }

    const manualDupe = checkDuplicateJob(db, customerName, projectAddress);
    res.json({
      jobId,
      status: 'received',
      message: 'Job created. Processing estimate...',
      ...(manualDupe.length ? { duplicateWarning: manualDupe } : {}),
    });

    try {
      logActivity({
        customer_number: contactRef?.pb_customer_number || null,
        job_id: jobId,
        event_type: 'ESTIMATE_CREATED',
        description: `New estimate created for ${customerName || 'unknown customer'} at ${projectAddress || 'unknown address'}`,
        recorded_by: req.session?.name || 'staff',
      });
    } catch {
      /* ignore */
    }

    // Background property enrichment (non-blocking)
    if (projectAddress) {
      const { enrichPropertyBackground } = require('../services/propertyEnrichment');
      enrichPropertyBackground(db, 'job', jobId, projectAddress);
    }

    const { processEstimate } = require('../services/claudeService');
    (async () => {
      try {
        console.log(`[Manual Job ${jobId}] Starting Claude processEstimate...`);
        db.prepare('UPDATE jobs SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
          'processing',
          jobId,
        );

        const sanitizedScope = stripPII(estimateText);
        const fullEstimate = contactRef
          ? `[Customer Ref: ${contactRef.csn} | Job ID: ${jobId}]\nProject Address: ${projectAddress || 'see estimate'}\n\nESTIMATE DETAILS:\n${sanitizedScope}`
          : `[Job ID: ${jobId}]\nProject Address: ${projectAddress || 'see estimate'}\n\nESTIMATE DETAILS:\n${sanitizedScope}`;
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
          `[Manual Job ${jobId}] Claude returned proposal. readyToGenerate=${proposalData.readyToGenerate}`,
        );

        if (
          proposalData.readyToGenerate === false &&
          proposalData.clarificationsNeeded?.length > 0
        ) {
          finalizeJobVersioning(db, jobId, proposalData);
          db.prepare('UPDATE jobs SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
            'clarification',
            jobId,
          );
          const insertQ = db.prepare('INSERT INTO clarifications (job_id, question) VALUES (?, ?)');
          for (const q of proposalData.clarificationsNeeded) {
            insertQ.run(jobId, q);
          }
          console.log(
            `[Manual Job ${jobId}] Status: clarification (${proposalData.clarificationsNeeded.length} questions)`,
          );

          const ownerWhatsApp = process.env.OWNER_WHATSAPP;
          if (ownerWhatsApp) {
            const to = ownerWhatsApp.startsWith('whatsapp:')
              ? ownerWhatsApp
              : `whatsapp:${ownerWhatsApp}`;
            const firstQ = proposalData.clarificationsNeeded[0];
            const total = proposalData.clarificationsNeeded.length;
            await sendWhatsApp(
              to,
              `Hey! 👋 I'm working on the estimate for *${customerName}* at ${projectAddress} but I'm missing a few details.\n\nI'll ask you one question at a time — just reply and I'll move to the next one.\n\n❓ Question 1 of ${total}:\n${firstQ}`,
            );
          }
        } else {
          finalizeJobVersioning(db, jobId, proposalData);
          saveReviewPending(db, proposalData, jobId);
          logAudit(jobId, 'manual_estimate_processed', `Manual entry — pending review`, 'admin');
          console.log(
            `[Manual Job ${jobId}] Status: review_pending. Total: $${proposalData.totalValue}`,
          );
          tickQuoteCounter(db);
          notifyClients('job_updated', { jobId, status: 'review_pending' });
        }
      } catch (err) {
        console.error(`[Manual Job ${jobId}] ERROR:`, err.message, err.stack);
        db.prepare('UPDATE jobs SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
          'error',
          jobId,
        );
      }
    })();
  },
);

// POST answer a clarification question
router.post('/:id/clarify/:clarId', requireAuth, async (req, res) => {
  const db = getDb();
  const { answer } = req.body;
  if (!answer) return res.status(400).json({ error: 'Answer is required' });

  db.prepare(
    'UPDATE clarifications SET answer = ?, answered_at = CURRENT_TIMESTAMP WHERE id = ? AND job_id = ?',
  ).run(answer, req.params.clarId, req.params.id);

  const remaining = db
    .prepare('SELECT COUNT(*) as count FROM clarifications WHERE job_id = ? AND answer IS NULL')
    .get(req.params.id);

  if (remaining.count === 0) {
    res.json({
      success: true,
      allAnswered: true,
      message: 'All questions answered. Generating proposal...',
    });

    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
    if (job) {
      (async () => {
        try {
          console.log(`[Job ${job.id}] All clarifications answered. Generating proposal...`);
          db.prepare('UPDATE jobs SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
            'processing',
            job.id,
          );

          const allAnswers = db
            .prepare('SELECT question, answer FROM clarifications WHERE job_id = ?')
            .all(job.id);
          const answersText = allAnswers
            .map((a) => `Q: ${a.question}\nA: ${a.answer}`)
            .join('\n\n');
          const rawEstimate = job.raw_estimate_data || '';

          const { processEstimate } = require('../services/claudeService');
          const { context: priorCtx } = findPriorQuoteContext(db, {
            rawText: rawEstimate,
            contactId: job.contact_id,
            projectAddress: job.project_address,
          });
          const proposalData = await processEstimate(
            `${rawEstimate}\n\nCLARIFICATION ANSWERS:\n${answersText}`,
            job.id,
            'en',
            db,
            job.project_address || null,
            priorCtx,
          );
          mergeContactIntoProposal(db, job.id, proposalData);

          finalizeJobVersioning(db, job.id, proposalData);
          const pdfPath = await generatePDF(proposalData, 'proposal', job.id);
          saveProposalReady(db, proposalData, pdfPath, job.id);
          logAudit(job.id, 'proposal_generated', `Proposal generated after clarification`, 'admin');
          console.log(`[Job ${job.id}] Proposal ready. Total: $${proposalData.totalValue}`);
          tickQuoteCounter(db);
          notifyClients('job_updated', { jobId: job.id, status: 'proposal_ready' });
        } catch (err) {
          console.error(`[Job ${job.id}] Proposal generation error:`, err.message);
          db.prepare('UPDATE jobs SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
            'error',
            job.id,
          );
        }
      })();
    }
  } else {
    res.json({ success: true, allAnswered: false, remaining: remaining.count });
  }
});

// PATCH /:id/line-items — save edited line items back to proposal_data (stays review_pending)
router.patch(
  '/:id/line-items',
  requireAuth,
  requireRole('admin', 'pm', 'system_admin'),
  async (req, res) => {
    const db = getDb();
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (!job.proposal_data)
      return res.status(400).json({
        error:
          'No editable estimate data found. This estimate was revised but has no stored line items — use the AI to regenerate the estimate from the original scope.',
      });

    const { lineItems } = req.body;
    if (!Array.isArray(lineItems))
      return res.status(400).json({ error: 'lineItems must be an array' });
    if (lineItems.length === 0) return res.status(400).json({ error: 'lineItems cannot be empty' });

    for (const [i, li] of lineItems.entries()) {
      if (!li.trade || typeof li.trade !== 'string' || !li.trade.trim()) {
        return res.status(400).json({ error: `Line item ${i + 1} is missing a trade name` });
      }
      const cost = Number(li.baseCost);
      if (isNaN(cost) || cost < 0) {
        return res
          .status(400)
          .json({ error: `Line item "${li.trade}" has an invalid cost (must be 0 or greater)` });
      }
    }

    const proposalData = JSON.parse(job.proposal_data);
    const settings = (() => {
      const rows = db.prepare('SELECT key, value FROM settings').all();
      const s = {};
      for (const r of rows) {
        try {
          s[r.key] = JSON.parse(r.value);
        } catch {
          s[r.key] = r.value;
        }
      }
      return s;
    })();
    const subOandP = Number(settings['markup.subOandP']) || 0.15;
    const gcOandP = Number(settings['markup.gcOandP']) || 0.25;
    const contingency = Number(settings['markup.contingency']) || 0.1;
    const deposit = Number(settings['markup.deposit']) || 0.33;
    const multiplier = (1 + subOandP) * (1 + gcOandP) * (1 + contingency);

    const updatedItems = lineItems.map((li) => ({
      ...li,
      trade: li.trade.trim(),
      baseCost: Math.max(0, Number(li.baseCost) || 0),
      finalPrice: li.isStretchCode
        ? Math.max(0, Number(li.baseCost))
        : Math.round(Math.max(0, Number(li.baseCost) || 0) * multiplier),
    }));

    const dumpsterItem = updatedItems.find((i) =>
      /dumpster|waste\s*removal|debris\s*removal/i.test(i.trade || ''),
    );
    const dumpsterExplicitlyExcluded = dumpsterItem && (Number(dumpsterItem.baseCost) || 0) === 0;
    const hasDumpster = !!dumpsterItem && !dumpsterExplicitlyExcluded;

    // $0 dumpster = explicitly excluded — remove so it never appears in scope
    if (dumpsterExplicitlyExcluded) {
      const idx = updatedItems.indexOf(dumpsterItem);
      if (idx !== -1) updatedItems.splice(idx, 1);
    }

    if (!hasDumpster && !dumpsterExplicitlyExcluded) {
      const totalBase = updatedItems.reduce((s, i) => s + (i.baseCost || 0), 0);
      const dumpsterBase =
        totalBase < 10000
          ? 600
          : totalBase <= 25000
            ? 1200
            : 1200 + Math.ceil((totalBase - 25000) / 15000) * 1200;
      updatedItems.push({
        trade: 'Waste Removal',
        baseCost: dumpsterBase,
        finalPrice: Math.round(dumpsterBase * multiplier),
        description: 'Dumpster rental and debris disposal for project duration.',
        scopeIncluded: ['Dumpster rental', 'Debris hauling and disposal'],
        scopeExcluded: ['Hazardous material disposal'],
        autoAdded: true,
      });
    }

    const total = updatedItems.reduce((s, i) => s + (i.finalPrice || 0), 0);

    // Tag permit/engineering items and calculate deposit on remaining balance
    const SEPARATE_FEE_RE = /permit|remit|engineer/i;
    for (const item of updatedItems) {
      item.isSeparatelyBilled =
        SEPARATE_FEE_RE.test(item.trade || '') || SEPARATE_FEE_RE.test(item.description || '');
    }
    const separatelyBilledTotal = updatedItems.reduce(
      (s, i) => s + (i.isSeparatelyBilled ? i.finalPrice || 0 : 0),
      0,
    );
    const depositBase = Math.max(0, total - separatelyBilledTotal);
    const depositAmount = Math.round(depositBase * deposit);

    const editor = req.session?.name || req.session?.email || 'admin';
    const prevTotal = proposalData.totalValue || 0;

    proposalData.lineItems = updatedItems;
    proposalData.pricing = {
      markupMultiplier: Math.round(multiplier * 10000) / 10000,
      totalContractPrice: total,
      depositPercent: Math.round(deposit * 100),
      depositAmount,
      separatelyBilledTotal,
      depositBase,
      appliedRates: { subOandP, gcOandP, contingency },
      dumpsterExcluded: dumpsterExplicitlyExcluded || false,
    };
    proposalData.totalValue = total;
    proposalData.depositAmount = depositAmount;

    db.prepare(
      'UPDATE jobs SET proposal_data = ?, total_value = ?, deposit_amount = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    ).run(JSON.stringify(proposalData), total, depositAmount, job.id);

    logAudit(
      job.id,
      'line_items_edited',
      `Line items edited by ${editor}. Total changed from $${prevTotal.toLocaleString()} → $${total.toLocaleString()}`,
      editor,
    );

    res.json({ success: true, total, depositAmount, lineItems: updatedItems });
  },
);

// POST /:id/generate-proposal — generate PDF from stored (possibly edited) proposal_data
router.post(
  '/:id/generate-proposal',
  requireAuth,
  requireRole('admin', 'pm', 'system_admin'),
  async (req, res) => {
    const db = getDb();
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (!job.proposal_data)
      return res.status(400).json({
        error:
          'No estimate data to generate from. Edit and save line items first, or reprocess the job to regenerate from the original scope.',
      });

    try {
      const proposalData = JSON.parse(job.proposal_data);
      mergeContactIntoProposal(db, job.id, proposalData);
      const pdfPath = await generatePDF(proposalData, 'proposal', job.id);
      saveProposalReady(db, proposalData, pdfPath, job.id);
      logAudit(
        job.id,
        'proposal_generated',
        'Proposal PDF generated after line item review',
        req.session?.name || 'admin',
      );
      notifyClients('job_updated', { jobId: job.id, status: 'proposal_ready' });
      res.json({ success: true, pdfPath: `/outputs/${require('path').basename(pdfPath)}` });
    } catch (err) {
      console.error('[generate-proposal] Error:', err.message);
      res.status(500).json({ error: 'Failed to generate proposal: ' + err.message });
    }
  },
);

// POST manually mark proposal as approved (in-person/verbal approval)
router.post(
  '/:id/mark-approved',
  requireAuth,
  requireRole('admin', 'pm', 'system_admin'),
  async (req, res) => {
    const db = getDb();
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (!job.proposal_data) return res.status(400).json({ error: 'No proposal to approve' });
    db.prepare('UPDATE jobs SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
      'proposal_approved',
      job.id,
    );
    logAudit(
      job.id,
      'proposal_approved',
      'Proposal manually approved via admin panel',
      req.session?.name || 'admin',
    );
    res.json({ success: true, message: 'Proposal marked as approved' });
  },
);

// POST mark proposal as rejected by customer — resets to review_pending for revision
router.post(
  '/:id/reject-proposal',
  requireAuth,
  requireRole('admin', 'pm', 'system_admin'),
  async (req, res) => {
    const db = getDb();
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (!['proposal_ready', 'proposal_sent'].includes(job.status)) {
      return res.status(400).json({
        error: 'Can only reject a proposal that is in proposal_ready or proposal_sent status',
      });
    }

    db.prepare('UPDATE jobs SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
      'review_pending',
      job.id,
    );

    try {
      jobMemory.markOutcome(job.id, 'rejected');
    } catch {
      /* ignore */
    }

    logAudit(
      job.id,
      'proposal_rejected',
      `Proposal v${job.version} marked as rejected by customer — returned to review_pending for revision`,
      req.session?.name || 'admin',
    );

    const { notifyClients } = require('../services/sseManager');
    notifyClients('job_updated', { jobId: job.id, status: 'review_pending' });

    res.json({
      success: true,
      message: 'Proposal marked as rejected. Job returned to review pending for revision.',
    });
  },
);

// POST approve proposal → generate contract
router.post(
  '/:id/approve',
  requireAuth,
  requireRole('admin', 'pm', 'system_admin'),
  async (req, res) => {
    const db = getDb();
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (!job.proposal_data) return res.status(400).json({ error: 'No proposal to approve' });

    try {
      db.prepare('UPDATE jobs SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
        'customer_approved',
        job.id,
      );

      const { generateContract } = require('../services/claudeService');
      const proposalData = JSON.parse(job.proposal_data);
      mergeContactIntoProposal(db, job.id, proposalData);

      if (!proposalData.customer) proposalData.customer = {};
      if (!proposalData.customer.address_line1 && job.contact_id) {
        const contact = db
          .prepare('SELECT address, city, state, zip FROM contacts WHERE id = ?')
          .get(job.contact_id);
        if (contact?.address) {
          proposalData.customer.address_line1 = contact.address;
          proposalData.customer.city_state_zip = [contact.city, contact.state, contact.zip]
            .filter(Boolean)
            .join(', ');
        }
      }
      if (!proposalData.customer.address_line1 && job.project_address) {
        proposalData.customer.address_line1 = job.project_address;
        proposalData.customer.city_state_zip = [job.project_city, 'MA'].filter(Boolean).join(', ');
      }

      const contractData = await generateContract(proposalData, job.id, 'en');

      const contractPDF = await generatePDF(contractData, 'contract', job.id);
      db.prepare(
        'UPDATE jobs SET contract_data = ?, contract_pdf_path = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      ).run(JSON.stringify(contractData), contractPDF, 'contract_ready', job.id);

      logAudit(job.id, 'contract_generated', 'Contract approved via admin panel', 'admin');
      try {
        const contactRef2 = job.contact_id
          ? db.prepare('SELECT pb_customer_number FROM contacts WHERE id = ?').get(job.contact_id)
          : null;
        logActivity({
          customer_number: contactRef2?.pb_customer_number || null,
          job_id: job.id,
          event_type: 'CONTRACT_GENERATED',
          description: `Contract generated for ${job.project_address || 'project'}`,
          recorded_by: req.session?.name || 'admin',
        });
      } catch {
        /* ignore */
      }
      res.json({
        success: true,
        message: 'Contract generated',
        contractPDF: `/outputs/${require('path').basename(contractPDF)}`,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },
);

// POST /:id/revise — reopen any estimate for editing
router.post('/:id/revise', requireAuth, requireRole('admin', 'pm', 'system_admin'), (req, res) => {
  const db = getDb();
  const job = db.prepare('SELECT * FROM jobs WHERE id = ? AND archived = 0').get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (!job.proposal_pdf_path && !job.proposal_data)
    return res.status(400).json({ error: 'No estimate found — generate one first' });

  const nextVersion = (job.version || 1) + 1;

  let proposalDataStr = job.proposal_data;
  if (proposalDataStr) {
    try {
      const pd = JSON.parse(proposalDataStr);
      pd.quoteVersion = nextVersion;
      proposalDataStr = JSON.stringify(pd);
    } catch {
      /* leave as-is */
    }
  }

  db.prepare(
    `
    UPDATE jobs
    SET status = 'review_pending', version = ?, proposal_data = ?, contract_pdf_path = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `,
  ).run(nextVersion, proposalDataStr, job.id);

  logAudit(
    job.id,
    'estimate_revised',
    `Estimate reopened for revision — now version ${nextVersion}`,
    req.session?.name || 'admin',
  );
  res.json({ success: true, version: nextVersion });
});

// Wizard routes (/wizard, /wizard/extract-text, /wizard/questions, /wizard/submit)
// live in estimateWizard.js
router.use('/', require('./estimateWizard'));

module.exports = router;
