// server/routes/signingAdmin.js
// Admin-only signing routes: send-proposal, send-contract, signing-status.
// Public signing pages and the customer-facing API live in signing.js.

'use strict';
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/database');
const jobMemory = require('../services/jobMemory');
const { requireAuth } = require('../middleware/auth');
const { logAudit } = require('../services/auditService');
const { sendEmail } = require('../services/emailService');
const { notifyClients } = require('../services/sseManager');

function baseURL(req) {
  const dev = process.env.REPLIT_DEV_DOMAIN;
  if (dev) return `https://${dev}`;
  const proto = req.headers['x-forwarded-proto'] || 'http';
  return `${proto}://${req.headers.host}`;
}

// ── POST /api/signing/send-proposal/:jobId ────────────────────────────
router.post('/api/signing/send-proposal/:jobId', requireAuth, async (req, res) => {
  const db = getDb();
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (!job.proposal_pdf_path) return res.status(400).json({ error: 'No proposal PDF ready' });
  if (!job.customer_email) return res.status(400).json({ error: 'No customer email on file' });

  try {
    const token = uuidv4();
    const base = baseURL(req);
    const link = `${base}/sign/p/${token}`;

    db.prepare(
      `UPDATE signing_sessions SET status = 'superseded' WHERE job_id = ? AND doc_type = 'proposal' AND status IN ('sent', 'opened')`,
    ).run(job.id);
    db.prepare(
      `INSERT INTO signing_sessions (job_id, doc_type, token, email_sent_at, status) VALUES (?, 'proposal', ?, CURRENT_TIMESTAMP, 'sent')`,
    ).run(job.id, token);
    db.prepare(
      "UPDATE jobs SET status = 'proposal_sent', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).run(job.id);
    try {
      jobMemory.markSent(job.id);
    } catch {
      /* ignore */
    }
    logAudit(
      job.id,
      'proposal_sent_for_signing',
      `Proposal signing link sent to ${job.customer_email}`,
      'admin',
    );

    // Auto-create a 3-day follow-up task for this proposal
    try {
      const followUpDue = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
        .toISOString()
        .replace('T', ' ')
        .slice(0, 19);
      const taskTitle = `📞 Follow up on proposal — ${job.customer_name || 'Customer'} (${job.project_address || 'project'})`;
      db.prepare(
        `INSERT INTO tasks (title, description, due_at, job_id, priority, task_type, status)
         VALUES (?, ?, ?, ?, 'normal', 'pipeline', 'pending')`,
      ).run(
        taskTitle,
        'Check if customer has reviewed the proposal. Answer any questions and confirm next steps.',
        followUpDue,
        job.id,
      );
    } catch (e) {
      console.warn('[signingAdmin] Could not auto-create follow-up task:', e.message);
    }

    const amount = job.total_value ? `$${Number(job.total_value).toLocaleString()}` : '';

    await sendEmail({
      to: job.customer_email,
      subject: `Your Preferred Builders Proposal is Ready for Your Review`,
      attachmentPath: job.proposal_pdf_path,
      attachmentName: `Preferred-Builders-Proposal-${(job.customer_name || job.id).replace(/\s+/g, '-')}.pdf`,
      html: `<div style="font-family:Arial,sans-serif;max-width:580px;margin:0 auto">
      <div style="background:#1B3A6B;padding:20px 24px;color:white;border-radius:8px 8px 0 0">
        <div style="font-size:17px;font-weight:700">Preferred Builders General Services Inc.</div>
        <div style="font-size:12px;opacity:.8;margin-top:4px">HIC-197400 · 978-377-1784</div>
      </div>
      <div style="background:white;padding:28px 24px;border:1px solid #eee;border-top:none">
        <p style="font-size:15px;color:#1B3A6B;font-weight:700;margin-bottom:12px">Hi ${job.customer_name || 'there'},</p>
        <p style="color:#444;font-size:14px;line-height:1.7;margin-bottom:8px">
          Your project proposal for <strong>${job.project_address}</strong> is ready for your review.
          ${amount ? `The estimated total is <strong>${amount}</strong>.` : ''}
        </p>
        <p style="color:#444;font-size:14px;line-height:1.7;margin-bottom:8px">
          <strong>📎 Your proposal is attached to this email as a PDF</strong> — please open it to review your full scope of work and allowance schedule.
        </p>
        <p style="color:#444;font-size:14px;line-height:1.7;margin-bottom:20px">
          This proposal is your <strong>estimate only — it is not a contract</strong>. Nothing is binding at this stage.
          We want to make sure we are completely on the same page before moving forward.
          Once you are satisfied with the scope, use the button below to sign and approve it.
        </p>
        <div style="text-align:center;margin-bottom:20px">
          <a href="${link}" style="background:#1B3A6B;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:700;display:inline-block">
            📋 Review Your Proposal
          </a>
        </div>
        <p style="color:#888;font-size:12px;line-height:1.6;margin-bottom:24px">
          If the button doesn't work, copy and paste this link into your browser:<br>
          <a href="${link}" style="color:#1B3A6B">${link}</a>
        </p>

        <hr style="border:none;border-top:1px solid #eee;margin:0 0 20px 0" />

        <p style="font-size:13px;font-weight:700;color:#1B3A6B;margin:0 0 12px 0">📌 What Happens Next</p>
        <table style="width:100%;border-collapse:collapse;font-size:13px;color:#444">
          <tr>
            <td style="padding:8px 10px;vertical-align:top;width:28px">
              <div style="background:#1B3A6B;color:white;border-radius:50%;width:22px;height:22px;text-align:center;line-height:22px;font-weight:700;font-size:11px">1</div>
            </td>
            <td style="padding:8px 10px;vertical-align:top"><strong>Review this proposal</strong> — check the scope of work, trades, and allowances. Have questions? Just reply to this email.</td>
          </tr>
          <tr style="background:#f8f9ff">
            <td style="padding:8px 10px;vertical-align:top">
              <div style="background:#1B3A6B;color:white;border-radius:50%;width:22px;height:22px;text-align:center;line-height:22px;font-weight:700;font-size:11px">2</div>
            </td>
            <td style="padding:8px 10px;vertical-align:top"><strong>We get aligned</strong> — once you are comfortable with the scope and pricing, let us know and we will move forward.</td>
          </tr>
          <tr>
            <td style="padding:8px 10px;vertical-align:top">
              <div style="background:#1B3A6B;color:white;border-radius:50%;width:22px;height:22px;text-align:center;line-height:22px;font-weight:700;font-size:11px">3</div>
            </td>
            <td style="padding:8px 10px;vertical-align:top"><strong>You receive the contract</strong> — your approved proposal scope is incorporated into the formal construction contract.</td>
          </tr>
          <tr style="background:#f8f9ff">
            <td style="padding:8px 10px;vertical-align:top">
              <div style="background:#1B3A6B;color:white;border-radius:50%;width:22px;height:22px;text-align:center;line-height:22px;font-weight:700;font-size:11px">4</div>
            </td>
            <td style="padding:8px 10px;vertical-align:top"><strong>Sign &amp; deposit</strong> — once the contract is signed and your deposit is received, your project is officially underway after the 3-business-day cancellation period.</td>
          </tr>
        </table>

        <hr style="border:none;border-top:1px solid #eee;margin:20px 0" />

        <div style="background:#EEF4FF;border-radius:8px;padding:16px 20px;margin-bottom:20px">
          <p style="margin:0 0 6px 0;font-size:13px;font-weight:700;color:#1B3A6B">💳 Need Financing? We Work With Hearth</p>
          <p style="margin:0 0 12px 0;font-size:13px;color:#444;line-height:1.6">
            Preferred Builders partners with Hearth Financial to offer flexible financing options for your project.
            Check your rate in minutes — <strong>no hard credit pull required</strong>.
          </p>
          <a href="https://app.gethearth.com/financing/36650/61771/prequalify?utm_campaign=36650&utm_content=darkblue&utm_medium=contractor-website&utm_source=contractor&utm_term=61771"
             style="background:#E07B2A;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:700;display:inline-block">
            Apply for Financing →
          </a>
        </div>

        <div style="background:#F0FFF6;border-radius:8px;padding:16px 20px">
          <p style="margin:0 0 6px 0;font-size:13px;font-weight:700;color:#059669">🤝 Know Someone Who Needs Work Done?</p>
          <p style="margin:0;font-size:13px;color:#444;line-height:1.6">
            Refer a friend to Preferred Builders. If they sign a contract with us, <strong>you receive $250 off your next project</strong>.
            Just have them mention your name when they reach out — it's that simple.
          </p>
        </div>
      </div>
      <div style="background:#f8f9ff;padding:14px 24px;font-size:11px;color:#aaa;border-radius:0 0 8px 8px;text-align:center">
        Preferred Builders General Services Inc. · 37 Duck Mill Rd, Fitchburg MA 01420 · 978-377-1784<br>
        Questions? Reply to this email or call us directly.
      </div>
    </div>`,
      text: `Hi ${job.customer_name || 'there'},\n\nYour proposal for ${job.project_address} is ready to review. This is your estimate and scope of work — not a contract. Nothing is binding at this stage.\n\nReview it here: ${link}\n\nWhat happens next:\n1. Review the scope and allowances\n2. We get aligned on the details\n3. You receive the formal contract\n4. Sign + deposit = project starts (after 3-business-day cancellation period)\n\nNeed financing? Apply through Hearth: https://app.gethearth.com/financing/36650/61771/prequalify\n\nRefer a friend who signs a contract and get $250 off your next project.\n\n— Preferred Builders General Services Inc.\n978-377-1784`,
      emailType: 'proposal_signing',
      jobId: job.id,
    });

    notifyClients('job_updated', { jobId: job.id, status: 'proposal_sent' });
    res.json({ success: true, message: `Proposal signing link sent to ${job.customer_email}` });
  } catch (err) {
    console.error('[send-proposal] Error:', err.message);
    res.status(500).json({ error: 'Failed to send proposal: ' + err.message });
  }
});

// ── POST /api/signing/send-contract/:jobId ────────────────────────────
router.post('/api/signing/send-contract/:jobId', requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (!job.contract_pdf_path)
      return res.status(400).json({ error: 'No contract PDF ready. Generate the contract first.' });
    if (!job.customer_email) return res.status(400).json({ error: 'No customer email on file' });

    const token = uuidv4();
    const base = baseURL(req);
    const link = `${base}/sign/c/${token}`;

    db.prepare(
      `UPDATE signing_sessions SET status = 'superseded' WHERE job_id = ? AND doc_type = 'contract' AND status IN ('sent', 'opened')`,
    ).run(job.id);
    db.prepare(
      `INSERT INTO signing_sessions (job_id, doc_type, token, email_sent_at, status) VALUES (?, 'contract', ?, CURRENT_TIMESTAMP, 'sent')`,
    ).run(job.id, token);
    db.prepare(
      "UPDATE jobs SET status = 'contract_sent', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).run(job.id);
    logAudit(
      job.id,
      'contract_sent_for_signing',
      `Contract signing link sent to ${job.customer_email}`,
      'admin',
    );

    const amount = job.total_value ? `$${Number(job.total_value).toLocaleString()}` : '';
    const fs = require('fs');
    const proposalAttachment =
      job.proposal_pdf_path && fs.existsSync(job.proposal_pdf_path)
        ? {
            attachmentPath: job.proposal_pdf_path,
            attachmentName: `Preferred-Builders-Proposal-${job.customer_name || job.id}.pdf`,
          }
        : {};

    await sendEmail({
      to: job.customer_email,
      subject: `Your Preferred Builders Contract is Ready to Sign`,
      ...proposalAttachment,
      html: `<div style="font-family:Arial,sans-serif;max-width:580px;margin:0 auto">
      <div style="background:#1B3A6B;padding:20px 24px;color:white;border-radius:8px 8px 0 0">
        <div style="font-size:17px;font-weight:700">Preferred Builders General Services Inc.</div>
        <div style="font-size:12px;opacity:.8;margin-top:4px">HIC-197400 · CSL CS-121662 · 978-377-1784</div>
      </div>
      <div style="background:white;padding:28px 24px;border:1px solid #eee;border-top:none">
        <p style="font-size:15px;color:#1B3A6B;font-weight:700;margin-bottom:12px">Hi ${job.customer_name || 'there'},</p>
        <p style="color:#444;font-size:14px;line-height:1.7;margin-bottom:8px">
          Great news — we are aligned and your formal construction contract for <strong>${job.project_address}</strong> is ready for your signature.
          ${amount ? `The total contract value is <strong>${amount}</strong>.` : ''}
        </p>
        <p style="color:#444;font-size:14px;line-height:1.7;margin-bottom:20px">
          Your approved proposal and full scope of work are included in this contract. Please review everything carefully before signing.
          Your electronic signature creates a <strong>legally binding agreement</strong>.
          ${proposalAttachment.attachmentPath ? `<br><br>📎 <strong>Your signed proposal is attached to this email</strong> for your reference.` : ''}
        </p>
        <div style="text-align:center;margin-bottom:20px">
          <a href="${link}" style="background:#059669;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:700;display:inline-block">
            ✍️ Review &amp; Sign Contract
          </a>
        </div>
        <p style="color:#888;font-size:12px;line-height:1.6;margin-bottom:24px">
          If the button doesn't work, copy and paste this link into your browser:<br>
          <a href="${link}" style="color:#1B3A6B">${link}</a>
        </p>

        <hr style="border:none;border-top:1px solid #eee;margin:0 0 20px 0" />

        <p style="font-size:13px;font-weight:700;color:#1B3A6B;margin:0 0 12px 0">📌 What Happens After You Sign</p>
        <table style="width:100%;border-collapse:collapse;font-size:13px;color:#444">
          <tr>
            <td style="padding:8px 10px;vertical-align:top;width:28px">
              <div style="background:#059669;color:white;border-radius:50%;width:22px;height:22px;text-align:center;line-height:22px;font-weight:700;font-size:11px">1</div>
            </td>
            <td style="padding:8px 10px;vertical-align:top"><strong>Sign the contract</strong> — review every section and sign electronically using the link above.</td>
          </tr>
          <tr style="background:#f8f9ff">
            <td style="padding:8px 10px;vertical-align:top">
              <div style="background:#059669;color:white;border-radius:50%;width:22px;height:22px;text-align:center;line-height:22px;font-weight:700;font-size:11px">2</div>
            </td>
            <td style="padding:8px 10px;vertical-align:top"><strong>Submit your deposit</strong> — your deposit as outlined in the contract secures your place on our schedule.</td>
          </tr>
          <tr>
            <td style="padding:8px 10px;vertical-align:top">
              <div style="background:#059669;color:white;border-radius:50%;width:22px;height:22px;text-align:center;line-height:22px;font-weight:700;font-size:11px">3</div>
            </td>
            <td style="padding:8px 10px;vertical-align:top"><strong>3-business-day window</strong> — per Massachusetts law you have the right to cancel within 3 business days of signing at no penalty.</td>
          </tr>
          <tr style="background:#f8f9ff">
            <td style="padding:8px 10px;vertical-align:top">
              <div style="background:#059669;color:white;border-radius:50%;width:22px;height:22px;text-align:center;line-height:22px;font-weight:700;font-size:11px">4</div>
            </td>
            <td style="padding:8px 10px;vertical-align:top"><strong>We break ground</strong> — once the cancellation window has passed your project is officially underway. We will be in touch with your start date.</td>
          </tr>
        </table>

        <div style="background:#FFF8F0;border-left:3px solid #E07B2A;padding:12px 16px;border-radius:0 6px 6px 0;margin:20px 0">
          <p style="margin:0;font-size:12px;color:#5D3A00;line-height:1.6">
            <strong>⚠️ Your Right to Cancel:</strong> Per M.G.L. c. 93 §48, you have the right to cancel this agreement within 3 business days of signing if it was executed away from our principal place of business. Cancellation must be submitted in writing.
          </p>
        </div>

        <hr style="border:none;border-top:1px solid #eee;margin:0 0 20px 0" />

        <div style="background:#F0FFF6;border-radius:8px;padding:16px 20px">
          <p style="margin:0 0 6px 0;font-size:13px;font-weight:700;color:#059669">🤝 Welcome to the Preferred Builders Family — Refer &amp; Save!</p>
          <p style="margin:0;font-size:13px;color:#444;line-height:1.6">
            Thank you for choosing Preferred Builders. If you refer a friend or family member and they sign a contract with us,
            <strong>you receive $250 off your next project</strong>. Just have them mention your name when they reach out.
            There is no limit — every referral that signs earns you $250.
          </p>
        </div>
      </div>
      <div style="background:#f8f9ff;padding:14px 24px;font-size:11px;color:#aaa;border-radius:0 0 8px 8px;text-align:center">
        Preferred Builders General Services Inc. · 37 Duck Mill Rd, Fitchburg MA 01420 · 978-377-1784<br>
        Questions? Reply to this email or call us directly.
      </div>
    </div>`,
      text: `Hi ${job.customer_name || 'there'},\n\nYour construction contract for ${job.project_address} is ready to sign. Your approved proposal scope is included.\n\nSign here: ${link}\n\nWhat happens next:\n1. Sign the contract\n2. Submit your deposit\n3. 3-business-day cancellation window (Massachusetts law)\n4. We break ground\n\nReferral: Send a friend our way — if they sign a contract you get $250 off your next project.\n\n— Preferred Builders General Services Inc.\n978-377-1784`,
      emailType: 'contract',
      jobId: job.id,
    });

    notifyClients('job_updated', { jobId: job.id, status: 'contract_sent' });
    res.json({ success: true, message: `Contract signing link sent to ${job.customer_email}` });
  } catch (err) {
    console.error('[send-contract] Error:', err.message);
    res.status(500).json({ error: 'Failed to send contract: ' + err.message });
  }
});

// ── GET /api/signing/status/:jobId ────────────────────────────────────
router.get('/api/signing/status/:jobId', requireAuth, (req, res) => {
  const db = getDb();
  const sessions = db
    .prepare(
      'SELECT id, doc_type, status, email_sent_at, opened_at, opened_ip, signed_at, signer_name, decline_reason, created_at FROM signing_sessions WHERE job_id = ? ORDER BY created_at DESC',
    )
    .all(req.params.jobId);
  res.json({ sessions });
});

module.exports = router;
