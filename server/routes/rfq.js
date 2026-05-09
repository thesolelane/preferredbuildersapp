// server/routes/rfq.js
// Request for Quote (RFQ) — generate, save, and email scoped trade quotes to subs
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getDb } = require('../db/database');
const { sendEmail } = require('../services/emailService');
const Anthropic = require('@anthropic-ai/sdk');
const { logTokenUsage } = require('../utils/tokenLogger');
const { claudeWithRetry } = require('../utils/claudeRetry');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── GET /api/rfq/:jobId — list all RFQs for a job ────────────────────────────
router.get('/:jobId', requireAuth, (req, res) => {
  const db = getDb();
  const rfqs = db
    .prepare(
      `SELECT r.*,
              strftime('%m/%d/%Y', r.created_at) AS created_date,
              strftime('%m/%d/%Y', r.sent_at)    AS sent_date
       FROM rfqs r
       WHERE r.job_id = ?
       ORDER BY r.created_at DESC`,
    )
    .all(req.params.jobId);
  res.json(rfqs);
});

// ── POST /api/rfq/generate — Claude expands trade description into RFQ scope ─
router.post('/generate', requireAuth, async (req, res) => {
  const { trade, description, projectAddress, customerName, baseCost } = req.body;
  if (!trade) return res.status(400).json({ error: 'trade is required' });

  const systemPrompt = `You are a construction scope writer for Preferred Builders General Services Inc., a licensed general contractor in Massachusetts (HIC-197400). 
Write professional, specific Request for Quote (RFQ) scope-of-work paragraphs that sub-contractors can use to provide an accurate bid.
Be concise but complete. Use industry-standard language. Do NOT mention dollar amounts.`;

  const userPrompt = `Write an RFQ scope paragraph for the following trade work:

Trade: ${trade}
Project Address: ${projectAddress || 'To be confirmed'}
Customer: ${customerName || 'Client'}
${description ? `Scope notes: ${description}` : ''}

Write 2–4 sentences describing exactly what work the sub is expected to perform, what materials/specifications apply, and any access or coordination requirements. End with: "Please provide your all-in price for labor and materials."`;

  try {
    const response = await claudeWithRetry(
      client,
      {
        model: 'claude-haiku-4-20250514',
        max_tokens: 400,
        temperature: 0.3,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      },
      'rfq-generate',
    );

    logTokenUsage({
      service: 'claude',
      model: 'claude-haiku-4-20250514',
      inputTokens: response.usage?.input_tokens || 0,
      outputTokens: response.usage?.output_tokens || 0,
      operation: 'rfq_generate',
    });

    const scopeText = response.content[0]?.text?.trim() || '';
    res.json({ scopeText });
  } catch (err) {
    console.error('[RFQ generate]', err.message);
    res.status(500).json({ error: 'Failed to generate scope text' });
  }
});

// ── POST /api/rfq — create (save as draft) ───────────────────────────────────
router.post('/', requireAuth, (req, res) => {
  const db = getDb();
  const {
    job_id,
    trade,
    scope_text,
    target_base_cost,
    due_date,
    vendor_id,
    vendor_name,
    vendor_email,
  } = req.body;
  if (!job_id || !trade) return res.status(400).json({ error: 'job_id and trade are required' });

  const result = db
    .prepare(
      `INSERT INTO rfqs (job_id, trade, scope_text, target_base_cost, due_date, vendor_id, vendor_name, vendor_email, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)`,
    )
    .run(
      job_id,
      trade,
      scope_text || null,
      target_base_cost || null,
      due_date || null,
      vendor_id || null,
      vendor_name || null,
      vendor_email || null,
      req.session?.name || 'staff',
    );

  const rfq = db.prepare('SELECT * FROM rfqs WHERE id = ?').get(result.lastInsertRowid);
  res.json(rfq);
});

// ── PATCH /api/rfq/:id — update scope, vendor, due date ──────────────────────
router.patch('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const { scope_text, due_date, vendor_id, vendor_name, vendor_email } = req.body;
  db.prepare(
    `UPDATE rfqs SET scope_text = ?, due_date = ?, vendor_id = ?, vendor_name = ?, vendor_email = ?
     WHERE id = ?`,
  ).run(
    scope_text || null,
    due_date || null,
    vendor_id || null,
    vendor_name || null,
    vendor_email || null,
    req.params.id,
  );
  const rfq = db.prepare('SELECT * FROM rfqs WHERE id = ?').get(req.params.id);
  res.json(rfq);
});

// ── POST /api/rfq/:id/send — email RFQ to vendor ────────────────────────────
router.post('/:id/send', requireAuth, async (req, res) => {
  const db = getDb();
  const rfq = db
    .prepare(
      'SELECT r.*, j.customer_name, j.project_address FROM rfqs r LEFT JOIN jobs j ON r.job_id = j.id WHERE r.id = ?',
    )
    .get(req.params.id);
  if (!rfq) return res.status(404).json({ error: 'RFQ not found' });
  if (!rfq.vendor_email) return res.status(400).json({ error: 'No vendor email on this RFQ' });

  const dueText = rfq.due_date
    ? new Date(rfq.due_date).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    : 'as soon as possible';

  const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
  <div style="background:#1B3A6B;padding:20px 28px;border-radius:6px 6px 0 0;">
    <h2 style="color:#F5A623;margin:0;font-size:20px;">Request for Quote</h2>
    <p style="color:#ccc;margin:4px 0 0;font-size:13px;">Preferred Builders General Services Inc. — LIC# HIC-197400</p>
  </div>
  <div style="padding:24px 28px;border:1px solid #ddd;border-top:none;border-radius:0 0 6px 6px;">
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;font-size:14px;">
      <tr><td style="color:#888;padding:5px 0;width:130px;">Trade</td><td style="color:#222;font-weight:600;">${rfq.trade}</td></tr>
      <tr><td style="color:#888;padding:5px 0;">Project Address</td><td style="color:#222;">${rfq.project_address || 'TBD'}</td></tr>
      <tr><td style="color:#888;padding:5px 0;">Quote Due By</td><td style="color:#c0392b;font-weight:600;">${dueText}</td></tr>
    </table>
    <div style="background:#f7f9fc;border-left:4px solid #1B3A6B;padding:16px 20px;border-radius:4px;margin-bottom:20px;">
      <p style="margin:0 0 6px;font-size:12px;color:#888;text-transform:uppercase;letter-spacing:.5px;">Scope of Work</p>
      <p style="margin:0;font-size:14px;color:#333;line-height:1.6;">${(rfq.scope_text || '').replace(/\n/g, '<br>')}</p>
    </div>
    <p style="font-size:13px;color:#555;">Please reply to this email with your all-in price for labor and materials. If you have any questions about the scope, reply directly to this message.</p>
    <p style="font-size:13px;color:#555;margin-top:16px;">Thank you,<br><strong>Preferred Builders General Services Inc.</strong><br>978-377-1784</p>
  </div>
</div>`;

  try {
    await sendEmail({
      to: rfq.vendor_email,
      subject: `RFQ — ${rfq.trade} @ ${rfq.project_address || 'Project'}`,
      html,
      emailType: 'rfq',
      jobId: rfq.job_id,
    });

    db.prepare(
      `UPDATE rfqs SET status = 'sent', sent_via = 'email', sent_at = CURRENT_TIMESTAMP WHERE id = ?`,
    ).run(rfq.id);
    const updated = db.prepare('SELECT * FROM rfqs WHERE id = ?').get(rfq.id);
    res.json(updated);
  } catch (err) {
    console.error('[RFQ send]', err.message);
    res.status(500).json({ error: 'Failed to send email: ' + err.message });
  }
});

// ── DELETE /api/rfq/:id ───────────────────────────────────────────────────────
router.delete('/:id', requireAuth, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM rfqs WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
