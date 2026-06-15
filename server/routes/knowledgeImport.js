// server/routes/knowledgeImport.js
// Bulk invoice import + AI-powered assessment report

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getDb } = require('../db/database');
const path = require('path');
const fs = require('fs');
const pdfParse = require('pdf-parse');
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const UPLOAD_DIR = path.join(__dirname, '../../uploads/invoices');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ── EXTRACT structured info from a single invoice via Claude ──────────
async function extractInvoiceData(rawText, filename) {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 3000,
    system: `You are an invoice analysis assistant for a Massachusetts general contractor. 
Extract structured data from old invoices/proposals. Return ONLY valid JSON — no commentary.`,
    messages: [
      {
        role: 'user',
        content: `Analyze this contractor invoice/proposal and extract structured data.

FILENAME: ${filename}

INVOICE TEXT:
${rawText.substring(0, 8000)}

Return this EXACT JSON structure:
{
  "customer": {
    "name": "full name or null",
    "email": "email or null",
    "phone": "phone number or null",
    "address": "street address or null",
    "city": "city or null",
    "state": "2-letter state or null",
    "zip": "zip code or null"
  },
  "invoiceDate": "YYYY-MM-DD or approximate year or null",
  "customerType": "residential|commercial|unknown",
  "projectType": "kitchen|bathroom|addition|basement|roofing|siding|windows|full-renovation|new-construction|other",
  "projectDescription": "2-3 sentence summary of the work",
  "trades": [
    { "name": "trade name", "amount": 0, "scopeNotes": "what was included in scope" }
  ],
  "totalContractValue": 0,
  "depositPercent": 0,
  "paymentTerms": "description or null",
  "scopeLanguage": ["key phrase 1 from their scope writing", "key phrase 2", "...up to 10 phrases"],
  "exclusions": ["item 1", "item 2"],
  "warrantyTerms": "description or null",
  "pricingNotes": "any notable pricing observations",
  "estimatedMarketPosition": "high|mid-high|mid|mid-low|low|unknown"
}`,
      },
    ],
  });

  try {
    const text = response.content[0].text.trim();
    const clean = text.replace(/^```json\s*/i, '').replace(/```\s*$/, '');
    return JSON.parse(clean);
  } catch {
    return null;
  }
}

// ── UPSERT a contact — match by email or name+address ─────────────────
function upsertContact(db, customer, customerType, source) {
  if (!customer) return null;
  const { name, email, phone, address, city, state, zip } = customer;
  if (!name && !email) return null; // not enough info

  // Try to find existing by email first, then by name
  let existing = null;
  if (email) {
    existing = db.prepare('SELECT id FROM contacts WHERE email = ? COLLATE NOCASE').get(email);
  }
  if (!existing && name) {
    existing = db.prepare('SELECT id FROM contacts WHERE name = ? COLLATE NOCASE').get(name);
  }

  if (existing) {
    // Update only fields that are now more complete
    db.prepare(
      `UPDATE contacts SET
      name = COALESCE(NULLIF(?, ''), name),
      email = COALESCE(NULLIF(?, ''), email),
      phone = COALESCE(NULLIF(?, ''), phone),
      address = COALESCE(NULLIF(?, ''), address),
      city = COALESCE(NULLIF(?, ''), city),
      state = COALESCE(NULLIF(?, ''), state),
      zip = COALESCE(NULLIF(?, ''), zip),
      updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    ).run(
      name || '',
      email || '',
      phone || '',
      address || '',
      city || '',
      state || '',
      zip || '',
      existing.id,
    );
    return existing.id;
  } else {
    const result = db
      .prepare(
        `INSERT INTO contacts (name, email, phone, address, city, state, zip, customer_type, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        name || null,
        email || null,
        phone || null,
        address || null,
        city || null,
        state || null,
        zip || null,
        customerType || 'residential',
        source || 'bulk_import',
      );
    return result.lastInsertRowid;
  }
}

// ── POST /api/knowledge/bulk-import — upload multiple PDFs ─────────────
router.post('/bulk-import', requireAuth, async (req, res) => {
  if (!req.files) return res.status(400).json({ error: 'No files uploaded' });

  // Accept single or multiple files under any field name
  let files = req.files.documents || req.files.document;
  if (!files) {
    // Grab whatever was uploaded
    const allFiles = Object.values(req.files).flat();
    if (!allFiles.length) return res.status(400).json({ error: 'No files found' });
    files = allFiles;
  }
  if (!Array.isArray(files)) files = [files];

  const results = [];
  const db = getDb();

  for (const file of files) {
    const result = { filename: file.name, success: false, error: null, id: null };
    try {
      if (file.mimetype !== 'application/pdf' && !file.mimetype.startsWith('text/')) {
        result.error = 'Only PDF and text files supported';
        results.push(result);
        continue;
      }

      let rawText = '';
      const fileBuffer = file.tempFilePath ? fs.readFileSync(file.tempFilePath) : file.data;

      if (file.mimetype === 'application/pdf') {
        // Try text extraction first (fast, works for digital PDFs)
        try {
          const parsed = await pdfParse(fileBuffer);
          rawText = parsed.text?.trim() || '';
        } catch {
          /* ignore */
        }

        // If text is too short (scanned/image PDF), send to Claude natively
        if (rawText.length < 100) {
          console.log(`[Bulk Import] ${file.name} — scanned PDF detected, using Claude vision`);
          try {
            const base64Pdf = fileBuffer.toString('base64');
            const visionRes = await client.messages.create({
              model: 'claude-sonnet-4-5',
              max_tokens: 4000,
              messages: [
                {
                  role: 'user',
                  content: [
                    {
                      type: 'document',
                      source: { type: 'base64', media_type: 'application/pdf', data: base64Pdf },
                    },
                    {
                      type: 'text',
                      text: 'This is a scanned construction estimate or invoice. Extract ALL visible text, line items, dollar amounts, customer info, trade names, and addresses exactly as they appear. Return plain text.',
                    },
                  ],
                },
              ],
            });
            rawText = visionRes.content[0].text?.trim() || '';
          } catch (visionErr) {
            console.error(
              `[Bulk Import] Claude vision failed for ${file.name}:`,
              visionErr.message,
            );
          }
        }
      } else {
        rawText = fileBuffer.toString('utf8');
      }

      if (!rawText || rawText.trim().length < 50) {
        result.error = 'Could not extract readable text. Try a clearer scan or a digital PDF.';
        results.push(result);
        if (file.tempFilePath && fs.existsSync(file.tempFilePath))
          try {
            fs.unlinkSync(file.tempFilePath);
          } catch {
            /* ignore */
          }
        continue;
      }

      // Extract structured data with Claude (before saving file)
      const extracted = await extractInvoiceData(rawText, file.name);

      // Build a rich knowledge base entry
      let content = `SOURCE FILE: ${file.name}\n`;
      content += `IMPORT DATE: ${new Date().toISOString().split('T')[0]}\n\n`;

      if (extracted) {
        if (extracted.projectDescription) content += `PROJECT: ${extracted.projectDescription}\n\n`;
        if (extracted.totalContractValue)
          content += `TOTAL CONTRACT VALUE: $${extracted.totalContractValue.toLocaleString()}\n`;
        if (extracted.invoiceDate) content += `INVOICE DATE: ${extracted.invoiceDate}\n`;
        if (extracted.customerType) content += `CUSTOMER TYPE: ${extracted.customerType}\n`;
        if (extracted.projectType) content += `PROJECT TYPE: ${extracted.projectType}\n`;
        if (extracted.estimatedMarketPosition)
          content += `MARKET POSITION: ${extracted.estimatedMarketPosition}\n\n`;

        if (extracted.trades && extracted.trades.length) {
          content += `TRADE BREAKDOWN:\n`;
          for (const t of extracted.trades) {
            content += `  - ${t.name}: $${(t.amount || 0).toLocaleString()}`;
            if (t.scopeNotes) content += ` (${t.scopeNotes})`;
            content += '\n';
          }
          content += '\n';
        }

        if (extracted.scopeLanguage && extracted.scopeLanguage.length) {
          content += `SCOPE LANGUAGE EXAMPLES:\n`;
          for (const phrase of extracted.scopeLanguage) {
            content += `  - "${phrase}"\n`;
          }
          content += '\n';
        }

        if (extracted.exclusions && extracted.exclusions.length) {
          content += `TYPICAL EXCLUSIONS:\n`;
          for (const ex of extracted.exclusions) content += `  - ${ex}\n`;
          content += '\n';
        }

        if (extracted.paymentTerms) content += `PAYMENT TERMS: ${extracted.paymentTerms}\n`;
        if (extracted.depositPercent) content += `DEPOSIT: ${extracted.depositPercent}%\n`;
        if (extracted.warrantyTerms) content += `WARRANTY: ${extracted.warrantyTerms}\n`;
        if (extracted.pricingNotes) content += `\nPRICING NOTES: ${extracted.pricingNotes}\n`;
      } else {
        // Fallback: store raw text
        content += `RAW EXTRACTED TEXT:\n${rawText.substring(0, 5000)}`;
      }

      const title = extracted?.projectDescription
        ? extracted.projectDescription.substring(0, 80)
        : file.name.replace(/\.[^/.]+$/, '');

      // Save to knowledge base (no file path — we won't keep the file)
      const dbResult = db
        .prepare(
          'INSERT INTO knowledge_base (title, category, content, language) VALUES (?, ?, ?, ?)',
        )
        .run(title, 'past_contracts', content, 'en');

      // Save customer to CRM contacts if info was found
      let contactId = null;
      if (extracted?.customer) {
        try {
          contactId = upsertContact(db, extracted.customer, extracted.customerType, 'bulk_import');
        } catch (e) {
          console.warn('[Bulk Import] Contact upsert failed:', e.message);
        }
      }

      // Save a permanent copy of the file under the contact's folder
      if (contactId) {
        try {
          const contactDir = path.join(__dirname, '../../uploads/contact_docs', String(contactId));
          if (!fs.existsSync(contactDir)) fs.mkdirSync(contactDir, { recursive: true });

          // Sanitize filename and make it unique
          const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
          const unique = `${Date.now()}_${safeName}`;
          const destPath = path.join(contactDir, unique);

          // Copy from temp (don't move — still need to delete temp below)
          fs.copyFileSync(file.tempFilePath || file.data, destPath);

          db.prepare(
            `INSERT INTO contact_documents (contact_id, filename, original_name, mime_type, file_path, source)
             VALUES (?, ?, ?, ?, ?, 'bulk_import')`,
          ).run(contactId, unique, file.name, file.mimetype, destPath);

          console.log(`[Bulk Import] Saved ${file.name} → contact #${contactId}`);
        } catch (docErr) {
          console.warn('[Bulk Import] Failed to save contact doc:', docErr.message);
        }
      }

      // Delete temp file — data extracted and file copied where needed
      if (file.tempFilePath && fs.existsSync(file.tempFilePath)) {
        try {
          fs.unlinkSync(file.tempFilePath);
        } catch {
          /* ignore */
        }
      }

      result.success = true;
      result.id = dbResult.lastInsertRowid;
      result.contactId = contactId;
      result.extracted = extracted
        ? {
            projectType: extracted.projectType,
            totalContractValue: extracted.totalContractValue,
            tradesCount: extracted.trades?.length || 0,
            marketPosition: extracted.estimatedMarketPosition,
            customerFound: !!(extracted.customer?.name || extracted.customer?.email),
          }
        : null;
    } catch (err) {
      result.error = err.message;
      // Still clean up temp file on error
      if (file.tempFilePath && fs.existsSync(file.tempFilePath)) {
        try {
          fs.unlinkSync(file.tempFilePath);
        } catch {
          /* ignore */
        }
      }
    }
    results.push(result);
  }

  res.json({
    success: true,
    total: files.length,
    imported: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).length,
    results,
  });
});

// ── POST /api/knowledge/assessment — generate competitive analysis ──────
router.post('/assessment', requireAuth, async (req, res) => {
  const db = getDb();
  const { runAssessment } = require('../services/assessmentService');
  try {
    const result = await runAssessment(db);
    res.json({ success: true, ...result });
  } catch (err) {
    const code = err.message.includes('No past contracts') ? 400 : 500;
    res.status(code).json({ error: err.message });
  }
});

// ── GET /api/knowledge/assessment — retrieve saved assessment ───────────
router.get('/assessment', requireAuth, (req, res) => {
  const db = getDb();
  const doc = db
    .prepare(
      "SELECT * FROM knowledge_base WHERE title = 'Competitive Assessment Report' AND category = 'pricing' ORDER BY created_at DESC LIMIT 1",
    )
    .get();
  if (!doc) return res.json({ report: null });
  res.json({ report: doc.content, updatedAt: doc.created_at });
});

module.exports = router;
