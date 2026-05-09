'use strict';
// server/routes/customerPortal.js
// Public customer portal — no auth required, gated by portal_token on job
const express = require('express');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const { logAudit } = require('../services/auditService');
const { sendEmail, getOwnerEmails } = require('../services/emailService');
const { notifyClients } = require('../services/sseManager');

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, '../../uploads/portal_photos');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function baseURL(req) {
  const dev = process.env.REPLIT_DEV_DOMAIN;
  if (dev) return `https://${dev}`;
  const proto = req.headers['x-forwarded-proto'] || 'http';
  return `${proto}://${req.headers.host}`;
}

function escHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function portalPageHTML({ job, sessions }) {
  const proposalSession = sessions.find((s) => s.doc_type === 'proposal' && s.status !== 'void');
  const contractSession = sessions.find((s) => s.doc_type === 'contract' && s.status !== 'void');

  const statusLabel =
    {
      received: 'Received',
      callback_done: 'Callback Done',
      appointment_booked: 'Appointment Booked',
      site_visit_complete: 'Site Visit Complete',
      quote_draft: 'Proposal Being Prepared',
      quote_sent: 'Proposal Sent',
      proposal_sent: 'Proposal Sent',
      follow_up_1: 'Follow-Up Sent',
      follow_up_2: 'Follow-Up Sent',
      proposal_declined: 'Changes Requested',
      signed: 'Contract Signed',
      contract_signed: 'Contract Signed',
      complete: 'Complete',
      lost: 'Closed',
    }[job.status] ||
    job.status ||
    'In Progress';

  const statusColor =
    {
      signed: '#16a34a',
      contract_signed: '#16a34a',
      complete: '#16a34a',
      proposal_declined: '#c62828',
      lost: '#c62828',
    }[job.status] || '#1B3A6B';

  const amount = job.total_value ? `$${Number(job.total_value).toLocaleString()}` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Your Project Portal — Preferred Builders</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,Helvetica,sans-serif;background:#f4f6fb;min-height:100vh}
    .hdr{background:#1B3A6B;color:white;padding:16px 24px;display:flex;align-items:center;gap:14px}
    .hdr img{width:44px;height:44px;border-radius:50%;object-fit:contain;background:white;padding:2px}
    .hdr .co{font-size:15px;font-weight:700}
    .hdr .sub{font-size:11px;opacity:.75;margin-top:2px}
    .badge{background:rgba(255,255,255,.15);border-radius:20px;padding:4px 12px;font-size:11px;margin-left:auto;white-space:nowrap}
    .wrap{max-width:640px;margin:28px auto;padding:0 16px 80px}
    .card{background:white;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.09);padding:24px;margin-bottom:18px}
    .card-title{font-size:15px;font-weight:800;color:#1B3A6B;margin-bottom:14px;display:flex;align-items:center;gap:8px}
    .info-row{display:flex;gap:20px;flex-wrap:wrap;background:#f8f9ff;border-radius:8px;padding:14px 16px;margin-bottom:0}
    .info-item .lbl{font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.5px}
    .info-item .val{font-size:13px;font-weight:600;color:#1B3A6B;margin-top:2px}
    .btn{display:block;width:100%;padding:13px;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;text-align:center;text-decoration:none;margin-bottom:10px}
    .btn-primary{background:#1B3A6B;color:white}
    .btn-orange{background:#E07B2A;color:white}
    .btn-outline{background:white;color:#1B3A6B;border:1.5px solid #1B3A6B}
    .btn:last-child{margin-bottom:0}
    .status-badge{display:inline-block;padding:5px 14px;border-radius:20px;font-size:12px;font-weight:700;color:white}
    textarea{width:100%;padding:10px 12px;border:1.5px solid #C8D4E4;border-radius:6px;font-size:13px;resize:vertical;font-family:inherit;outline:none}
    textarea:focus{border-color:#1B3A6B}
    input[type=text],input[type=email]{width:100%;padding:10px 12px;border:1.5px solid #C8D4E4;border-radius:6px;font-size:13px;margin-bottom:10px;outline:none;font-family:inherit}
    input:focus{border-color:#1B3A6B}
    .success{background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:14px 16px;color:#166534;font-size:13px;font-weight:600;margin-top:12px}
    .error{background:#fff5f5;border:1px solid #fca5a5;border-radius:8px;padding:10px 14px;color:#c62828;font-size:12px;margin-top:8px;display:none}
    .upload-btn{background:#E07B2A;color:white;border:none;border-radius:8px;padding:14px;width:100%;font-size:14px;font-weight:700;cursor:pointer}
    .upload-btn:disabled{opacity:.5;cursor:not-allowed}
    label.file-label{display:block;background:#E07B2A;color:white;border-radius:8px;padding:14px;text-align:center;font-size:14px;font-weight:700;cursor:pointer}
    label.file-label:hover{background:#c96d1f}
    .ftr{text-align:center;padding:20px;font-size:11px;color:#aaa}
    @media(max-width:480px){.info-row{flex-direction:column}}
  </style>
</head>
<body>

<div class="hdr">
  <img src="/images/PB logo Round.png" alt="PB" onerror="this.style.display='none'">
  <div>
    <div class="co">Preferred Builders General Services Inc.</div>
    <div class="sub">HIC-197400 · CSL CS-121662 · 978-377-1784</div>
  </div>
  <div class="badge">🏠 Customer Portal</div>
</div>

<div class="wrap">

  <!-- Project Status Card -->
  <div class="card">
    <div class="card-title">📋 Your Project</div>
    <div class="info-row">
      <div class="info-item"><div class="lbl">Customer</div><div class="val">${escHtml(job.customer_name)}</div></div>
      <div class="info-item"><div class="lbl">Property</div><div class="val">${escHtml(job.project_address)}${job.project_city ? ', ' + escHtml(job.project_city) : ''}</div></div>
      ${amount ? `<div class="info-item"><div class="lbl">Project Value</div><div class="val">${escHtml(amount)}</div></div>` : ''}
      <div class="info-item"><div class="lbl">Status</div><div class="val"><span class="status-badge" style="background:${statusColor}">${escHtml(statusLabel)}</span></div></div>
    </div>
  </div>

  <!-- Documents Card -->
  ${
    proposalSession || contractSession
      ? `
  <div class="card">
    <div class="card-title">📄 Documents</div>
    ${
      proposalSession
        ? `
    <a href="/sign/p/${escHtml(proposalSession.token)}" class="btn ${proposalSession.status === 'signed' ? 'btn-outline' : 'btn-primary'}">
      ${proposalSession.status === 'signed' ? '✅ Proposal Signed' : '✍️ Review & Sign Proposal'}
    </a>`
        : ''
    }
    ${
      contractSession
        ? `
    <a href="/sign/c/${escHtml(contractSession.token)}" class="btn ${contractSession.status === 'signed' ? 'btn-outline' : 'btn-primary'}">
      ${contractSession.status === 'signed' ? '✅ Contract Signed' : '✍️ Review & Sign Contract'}
    </a>`
        : ''
    }
  </div>`
      : ''
  }

  <!-- Photo Upload Card -->
  <div class="card">
    <div class="card-title">📷 Upload Site Photos</div>
    <p style="font-size:13px;color:#666;margin-bottom:14px">Share site photos directly with our team. Photos of existing conditions, areas of concern, or anything relevant to your project.</p>
    <label class="file-label" id="photoLabel">
      📷 Choose Photos to Upload
      <input type="file" id="photoInput" multiple accept="image/*" style="display:none">
    </label>
    <div id="photoStatus" style="margin-top:10px;font-size:13px;color:#666"></div>
    <div id="photoSuccess" class="success" style="display:none">✅ <span id="photoCount"></span> photo(s) uploaded successfully! Our team has been notified.</div>
    <div id="photoError" class="error">Upload failed. Please try again.</div>
  </div>

  <!-- Change Order Card -->
  <div class="card">
    <div class="card-title">📝 Request a Change</div>
    <p style="font-size:13px;color:#666;margin-bottom:14px">Need to add, remove, or modify something in your project scope? Submit a change request and our team will follow up with an updated proposal.</p>
    <input type="text" id="coName" placeholder="Your name">
    <textarea id="coDesc" rows="5" placeholder="Describe the change you'd like to make…"></textarea>
    <input type="text" id="coCost" placeholder="Estimated cost (optional, e.g. 500)" style="margin-top:10px">
    <div style="margin-top:10px">
      <button class="btn btn-orange" onclick="submitChangeOrder()">📋 Submit Change Request</button>
    </div>
    <div id="coSuccess" class="success" style="display:none">✅ Change request submitted! Our team will follow up with you shortly.</div>
    <div id="coError" class="error">Submission failed. Please try again.</div>
  </div>

</div>

<div class="ftr">
  Preferred Builders General Services Inc. · HIC-197400 · <a href="https://preferredbuildersusa.com" style="color:#aaa">preferredbuildersusa.com</a><br>
  37 Duck Mill Rd, Fitchburg MA · 978-377-1784
</div>

<script>
(function() {
  const token = '${escHtml(job.portal_token)}';

  // ── Photo upload ──
  const photoInput = document.getElementById('photoInput');
  const photoLabel = document.getElementById('photoLabel');
  const photoStatus = document.getElementById('photoStatus');
  const photoSuccess = document.getElementById('photoSuccess');
  const photoError = document.getElementById('photoError');

  photoInput.addEventListener('change', async function() {
    const files = Array.from(this.files);
    if (!files.length) return;
    photoLabel.style.pointerEvents = 'none';
    photoLabel.style.opacity = '0.6';
    photoLabel.textContent = 'Uploading…';
    photoError.style.display = 'none';
    photoSuccess.style.display = 'none';

    let ok = 0;
    for (const file of files) {
      try {
        const form = new FormData();
        form.append('photo', file, file.name);
        const res = await fetch('/api/portal/' + token + '/photos', { method: 'POST', body: form });
        if (res.ok) ok++;
      } catch(e) { console.error('[Portal photo upload]', e); }
    }

    photoLabel.style.pointerEvents = '';
    photoLabel.style.opacity = '';
    photoLabel.textContent = '📷 Upload More Photos';
    if (ok > 0) {
      document.getElementById('photoCount').textContent = ok;
      photoSuccess.style.display = 'block';
    } else {
      photoError.style.display = 'block';
    }
    photoInput.value = '';
  });

  // ── Change order ──
  window.submitChangeOrder = async function() {
    const name = (document.getElementById('coName').value || '').trim();
    const desc = (document.getElementById('coDesc').value || '').trim();
    const estimatedCost = parseFloat(document.getElementById('coCost').value) || 0;
    const coErr = document.getElementById('coError');
    const coSuc = document.getElementById('coSuccess');
    coErr.style.display = 'none';
    if (!desc) { coErr.textContent = 'Please describe the change you need.'; coErr.style.display = 'block'; return; }
    try {
      const res = await fetch('/api/portal/' + token + '/change-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description: desc, estimatedCost })
      });
      if (res.ok) {
        coSuc.style.display = 'block';
        document.getElementById('coDesc').value = '';
        document.getElementById('coName').value = '';
        document.getElementById('coCost').value = '';
      } else {
        coErr.textContent = 'Submission failed. Please try again.';
        coErr.style.display = 'block';
      }
    } catch(e) {
      coErr.textContent = 'Network error. Please try again.';
      coErr.style.display = 'block';
    }
  };
})();
</script>
</body>
</html>`;
}

// ─── Public: GET /portal/:token ───────────────────────────────────────────────
router.get('/portal/:token', (req, res) => {
  const db = getDb();
  const job = db.prepare('SELECT * FROM jobs WHERE portal_token = ?').get(req.params.token);
  if (!job)
    return res
      .status(404)
      .send(
        '<h2 style="font-family:sans-serif;padding:40px">Portal link not found. Please contact Preferred Builders.</h2>',
      );

  const sessions = db
    .prepare(
      "SELECT * FROM signing_sessions WHERE job_id = ? AND status != 'void' ORDER BY created_at DESC",
    )
    .all(job.id);

  res.send(portalPageHTML({ job, sessions }));
});

// ─── Public: POST /api/portal/:token/photos ───────────────────────────────────
router.post('/api/portal/:token/photos', async (req, res) => {
  const db = getDb();
  const job = db.prepare('SELECT * FROM jobs WHERE portal_token = ?').get(req.params.token);
  if (!job) return res.status(404).json({ error: 'Not found' });

  const file = req.files && req.files.photo;
  if (!file) return res.status(400).json({ error: 'No photo provided' });

  const jobDir = path.join(UPLOAD_DIR, String(job.id));
  if (!fs.existsSync(jobDir)) fs.mkdirSync(jobDir, { recursive: true });

  const ext = path.extname(file.name) || '.jpg';
  const filename = `portal_${Date.now()}_${uuidv4().slice(0, 8)}${ext}`;
  const dest = path.join(jobDir, filename);

  try {
    await file.mv(dest);
  } catch (e) {
    return res.status(500).json({ error: 'Upload failed' });
  }

  db.prepare(
    `INSERT INTO job_photos (job_id, filename, original_name, caption, location_label) VALUES (?, ?, ?, ?, ?)`,
  ).run(
    job.id,
    path.join('portal_photos', String(job.id), filename),
    file.name,
    '',
    'Customer Upload',
  );

  logAudit(
    job.id,
    'customer_photo_uploaded',
    `Customer uploaded photo via portal: ${file.name}`,
    'customer',
  );

  notifyClients('job_updated', {
    jobId: job.id,
    event: 'customer_photo_uploaded',
    message: `📷 ${job.customer_name || 'Customer'} uploaded a photo via the portal`,
  });

  setImmediate(async () => {
    try {
      const owners = getOwnerEmails();
      if (owners.length) {
        await sendEmail({
          to: owners,
          subject: `📷 Customer photo uploaded — ${job.customer_name || 'Customer'}`,
          html: `<p><strong>${escHtml(job.customer_name || 'The customer')}</strong> uploaded a site photo via their customer portal.</p>
                 <p><strong>Project:</strong> ${escHtml(job.project_address || '—')}</p>
                 <p><strong>File:</strong> ${escHtml(file.name)}</p>
                 <p><a href="${process.env.APP_URL || ''}/jobs/${job.id}">View job →</a></p>`,
          emailType: 'system_alert',
          jobId: job.id,
        });
      }
    } catch (e) {
      console.warn('[PortalPhotoAlert]', e.message);
    }
  });

  res.json({ ok: true });
});

// ─── Public: POST /api/portal/:token/change-order ─────────────────────────────
router.post('/api/portal/:token/change-order', async (req, res) => {
  const db = getDb();
  const job = db.prepare('SELECT * FROM jobs WHERE portal_token = ?').get(req.params.token);
  if (!job) return res.status(404).json({ error: 'Not found' });

  const { name, description, estimatedCost = 0 } = req.body;
  if (!description || String(description).trim() === '') {
    return res.status(400).json({ error: 'Description is required' });
  }

  const submitterName = (name || job.customer_name || 'Customer').trim();
  const desc = String(description).trim();
  const cost = Number(estimatedCost) || 0;

  logAudit(
    job.id,
    'customer_change_order',
    `Change order submitted via portal by ${submitterName}: ${desc.slice(0, 200)} | Est. Cost: $${cost}`,
    'customer',
  );

  notifyClients('job_updated', {
    jobId: job.id,
    event: 'customer_change_order',
    message: `📝 ${submitterName} submitted a change request`,
    estimatedCost: cost,
  });

  setImmediate(async () => {
    try {
      const owners = getOwnerEmails();
      if (owners.length) {
        await sendEmail({
          to: owners,
          subject: `📝 Change order request — ${job.customer_name || 'Customer'}`,
          html: `<p><strong>${escHtml(submitterName)}</strong> submitted a change order request via their customer portal.</p>
                 <p><strong>Project:</strong> ${escHtml(job.project_address || '—')}</p>
                 <div style="background:#fff8f0;border-left:4px solid #E07B2A;padding:12px 16px;margin:12px 0;border-radius:0 6px 6px 0">
                   <strong>Change Request:</strong><br>${escHtml(desc).replace(/\n/g, '<br>')}
                   ${cost ? `<br><strong>Estimated Cost:</strong> $${cost}` : ''}
                 </div>
                 <p><a href="${process.env.APP_URL || ''}/jobs/${job.id}">View job →</a></p>`,
          emailType: 'system_alert',
          jobId: job.id,
        });
      }
    } catch (e) {
      console.warn('[PortalChangeOrderAlert]', e.message);
    }
  });

  res.json({ ok: true, message: 'Change order submitted successfully' });
});

// ─── Admin: POST /api/portal/generate/:jobId ──────────────────────────────────
// Generates (or returns existing) portal token for a job
router.post('/api/portal/generate/:jobId', requireAuth, (req, res) => {
  const db = getDb();
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  let token = job.portal_token;
  if (!token) {
    token = uuidv4();
    db.prepare('UPDATE jobs SET portal_token = ? WHERE id = ?').run(token, job.id);
  }

  const base = baseURL(req);
  res.json({ token, url: `${base}/portal/${token}` });
});

module.exports = router;
