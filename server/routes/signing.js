'use strict';
const express = require('express');
const path = require('path');
const { requireFields } = require('../middleware/validate');
const { getDb } = require('../db/database');
const jobMemory = require('../services/jobMemory');
const { logAudit } = require('../services/auditService');
const { logActivity } = require('./activityLog');
const { sendEmail } = require('../services/emailService');
const { notifyClients } = require('../services/sseManager');
const { autoCreateDepositInvoice } = require('../services/autoDepositInvoice');
const {
  buildSignatureBlockHTML,
  buildCertificatePageHTML,
  hashFile,
} = require('../services/signingCertificate');
const { generateSignedPDF } = require('../services/pdfService');

const router = express.Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clientIP(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || '';
}

function baseURL(req) {
  const dev = process.env.REPLIT_DEV_DOMAIN;
  if (dev) return `https://${dev}`;
  const proto = req.headers['x-forwarded-proto'] || 'http';
  return `${proto}://${req.headers.host}`;
}

function pdfPublicURL(pdfPath) {
  if (!pdfPath) return null;
  return `/outputs/${path.basename(pdfPath)}`;
}

const SIGNING_EXPIRY_DAYS = 10;

function isSessionExpired(session) {
  if (session.status === 'signed') return false;
  const sentAt = session.email_sent_at || session.created_at;
  if (!sentAt) return false;
  const cutoff = new Date(sentAt);
  cutoff.setDate(cutoff.getDate() + SIGNING_EXPIRY_DAYS);
  return new Date() > cutoff;
}

function supersededPageHTML(docLabel) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Link No Longer Active</title>
  <style>body{font-family:system-ui,sans-serif;background:#f5f7fb;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
  .box{background:#fff;border-radius:12px;padding:48px 36px;max-width:440px;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.08)}
  h2{color:#1B3A6B;margin-bottom:12px}p{color:#555;font-size:15px;line-height:1.6}
  .badge{display:inline-block;background:#fff3cd;color:#856404;border:1px solid #ffc107;border-radius:8px;padding:6px 14px;font-size:13px;font-weight:700;margin-bottom:24px}</style>
  </head><body><div class="box">
  <div style="font-size:48px;margin-bottom:16px">🔄</div>
  <div class="badge">Link Replaced</div>
  <h2>This link is no longer active</h2>
  <p>A newer ${docLabel} signing link was sent to your email.<br><br>
  Please check your inbox for the most recent email from Preferred Builders and use that link to sign.<br><br>
  If you need help, call us at <strong>978-377-1784</strong>.</p>
  </div></body></html>`;
}

function expiredPageHTML(docLabel) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Link Expired</title>
  <style>body{font-family:system-ui,sans-serif;background:#f5f7fb;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
  .box{background:#fff;border-radius:12px;padding:48px 36px;max-width:420px;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.08)}
  h2{color:#1B3A6B;margin-bottom:12px}p{color:#555;font-size:15px;line-height:1.6}
  .badge{display:inline-block;background:#fff3cd;color:#856404;border:1px solid #ffc107;border-radius:8px;padding:6px 14px;font-size:13px;font-weight:700;margin-bottom:24px}</style>
  </head><body><div class="box">
  <div class="badge">⏰ Link Expired</div>
  <h2>This signing link has expired</h2>
  <p>The ${docLabel} signing link is only valid for ${SIGNING_EXPIRY_DAYS} days from when it was sent.<br><br>
  Please contact <strong>Preferred Builders General Services Inc.</strong> to receive a new link.</p>
  <p style="font-size:13px;color:#888;margin-top:24px">📞 You can reach us by replying to the original email.</p>
  </div></body></html>`;
}

// ─── Signing page HTML generator ──────────────────────────────────────────────

function signingPageHTML({ docType, job, session, base: _base }) {
  const isProposal = docType === 'proposal';
  const docLabel = isProposal ? 'Proposal' : 'Contract';
  const pdfURLBase = pdfPublicURL(isProposal ? job.proposal_pdf_path : job.contract_pdf_path);
  const pdfURL = pdfURLBase
    ? `${pdfURLBase}?sign_token=${encodeURIComponent(session.token)}`
    : null;
  const amount = job.total_value ? `$${Number(job.total_value).toLocaleString()}` : '';
  const already = session.status === 'signed';
  const alreadyDeclined = session.status === 'declined';

  const alreadySigned = `
    <div style="text-align:center;padding:60px 20px">
      <div style="font-size:64px;margin-bottom:20px">✅</div>
      <h2 style="color:#1B3A6B;margin-bottom:10px">Already Signed</h2>
      <p style="color:#555;font-size:14px">This document was signed on ${new Date(session.signed_at).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/New_York' })}.<br>Thank you!</p>
    </div>`;

  const alreadyDeclinedHTML = `
    <div style="text-align:center;padding:60px 20px">
      <div style="font-size:64px;margin-bottom:20px">📬</div>
      <h2 style="color:#C62828;margin-bottom:10px">Feedback Submitted</h2>
      <p style="color:#555;font-size:14px;line-height:1.6">Your change request has already been submitted.<br>Our team will follow up with you shortly with a revised proposal.</p>
    </div>`;

  const downloadURL = pdfURLBase
    ? `${pdfURLBase}?sign_token=${encodeURIComponent(session.token)}&download=1`
    : null;

  const formHTML = `
    ${
      pdfURL
        ? `
    <div style="margin-bottom:24px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <p style="font-size:12px;color:#888;margin:0">
          Scroll through the full ${docLabel.toLowerCase()} before signing
        </p>
        <a href="${downloadURL}" download style="font-size:12px;font-weight:700;color:#1B3A6B;text-decoration:none;background:#f0f4ff;border:1px solid #c7d7f5;border-radius:6px;padding:5px 12px;display:inline-flex;align-items:center;gap:5px">
          ⬇ Download PDF
        </a>
      </div>
      <iframe src="${pdfURL}" style="width:100%;height:540px;border:1px solid #C8D4E4;border-radius:8px;background:#f5f5f5"></iframe>
    </div>`
        : `
    <div style="background:#f8f9ff;border:1px solid #C8D4E4;border-radius:8px;padding:20px;margin-bottom:24px;font-size:13px;color:#444">
      <strong>Document details:</strong><br>
      Customer: ${job.customer_name || '—'}<br>
      Property: ${job.project_address || '—'}<br>
      ${amount ? `Contract Value: ${amount}` : ''}
    </div>`
    }

    <div id="sigSection">
    <div style="background:#f8f9ff;border-left:4px solid #1B3A6B;padding:14px 16px;margin-bottom:20px;border-radius:0 8px 8px 0">
      <p style="margin:0;font-size:13px;color:#1B3A6B;font-weight:700">
        ${
          isProposal
            ? 'By signing below, you approve this proposal and authorize Preferred Builders General Services Inc. to proceed with contract preparation.'
            : 'By signing below, you acknowledge that you have read, understand, and agree to all terms and conditions of this Home Improvement Construction Contract.'
        }
      </p>
    </div>

    <div style="margin-bottom:16px">
      <label style="font-size:12px;font-weight:700;color:#333;display:block;margin-bottom:6px">Your Full Name</label>
      <input id="signerName" type="text" placeholder="Type your full name"
        style="width:100%;padding:10px 12px;border:1.5px solid #C8D4E4;border-radius:6px;font-size:14px;box-sizing:border-box;outline:none"
        onfocus="this.style.borderColor='#1B3A6B'" onblur="this.style.borderColor='#C8D4E4'">
    </div>

    <div style="margin-bottom:8px">
      <label style="font-size:12px;font-weight:700;color:#333;display:block;margin-bottom:6px">Signature</label>
      <div style="position:relative">
        <canvas id="sigPad" width="640" height="180"
          style="width:100%;height:180px;border:1.5px solid #C8D4E4;border-radius:6px;background:white;cursor:crosshair;touch-action:none;display:block"></canvas>
        <button onclick="clearSig()" type="button"
          style="position:absolute;top:8px;right:8px;background:white;border:1px solid #ddd;border-radius:4px;padding:4px 10px;font-size:11px;cursor:pointer;color:#888">
          Clear
        </button>
      </div>
      <p style="font-size:11px;color:#aaa;margin:4px 0 0">Sign with your mouse or finger</p>
    </div>

    <div style="margin:16px 0">
      <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;font-size:12px;color:#444">
        <input id="agreeCheck" type="checkbox" style="margin-top:2px;flex-shrink:0">
        <span>I confirm that I have read and reviewed this ${docLabel.toLowerCase()} and my electronic signature constitutes a legally binding agreement under the Electronic Signatures in Global and National Commerce Act (E-SIGN).</span>
      </label>
    </div>

    <div id="errMsg" style="color:#C62828;font-size:12px;margin-bottom:10px;display:none"></div>

    <button id="submitBtn" onclick="submitSig()" type="button"
      style="width:100%;padding:14px;background:#1B3A6B;color:white;border:none;border-radius:8px;font-size:15px;font-weight:700;cursor:pointer;letter-spacing:.3px">
      ✍️ ${isProposal ? 'Approve &amp; Sign Proposal' : 'Sign Contract'}
    </button>
    </div>

    ${
      isProposal
        ? `
    <div id="declineToggle" style="margin-top:16px;text-align:center">
      <button onclick="toggleDecline()" type="button"
        style="background:none;border:none;color:#888;font-size:13px;cursor:pointer;text-decoration:underline;padding:4px">
        Request Changes / Decline
      </button>
    </div>

    <div id="declinePanel" style="display:none;margin-top:16px;border-top:1px solid #eee;padding-top:16px">
      <p style="font-size:13px;color:#555;margin-bottom:10px;font-weight:600">Request Changes</p>
      <p style="font-size:12px;color:#888;margin-bottom:10px">Please describe your concerns or what you'd like changed. Our team will follow up with you shortly.</p>
      <textarea id="declineReason" rows="5" placeholder="Describe the changes you'd like or your concerns..."
        style="width:100%;padding:10px 12px;border:1.5px solid #C8D4E4;border-radius:6px;font-size:13px;box-sizing:border-box;resize:vertical;outline:none;font-family:inherit"
        onfocus="this.style.borderColor='#C62828'" onblur="this.style.borderColor='#C8D4E4'"></textarea>
      <div id="declineErr" style="color:#C62828;font-size:12px;margin-top:6px;display:none"></div>
      <div style="display:flex;gap:10px;margin-top:12px">
        <button onclick="toggleDecline()" type="button"
          style="flex:1;padding:11px;background:white;border:1.5px solid #C8D4E4;border-radius:8px;font-size:13px;cursor:pointer;color:#666">
          Cancel
        </button>
        <button id="declineBtn" onclick="submitDecline()" type="button"
          style="flex:2;padding:11px;background:#C62828;color:white;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer">
          Send Feedback
        </button>
      </div>
    </div>`
        : ''
    }`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${docLabel} — Preferred Builders General Services Inc.</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; background: #f4f6fb; min-height: 100vh; }
    .hdr { background: #1B3A6B; color: white; padding: 16px 24px; display: flex; align-items: center; gap: 14px; }
    .hdr .co { font-size: 15px; font-weight: 700; }
    .hdr .sub { font-size: 11px; opacity: .75; margin-top: 2px; }
    .badge { background: rgba(255,255,255,.15); border-radius: 20px; padding: 4px 12px; font-size: 11px; margin-left: auto; }
    .card { max-width: 720px; margin: 28px auto; background: white; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,.10); padding: 32px; }
    .doc-title { font-size: 20px; font-weight: 800; color: #1B3A6B; margin-bottom: 4px; }
    .doc-sub { font-size: 12px; color: #888; margin-bottom: 24px; }
    .info-row { display: flex; gap: 24px; background: #f8f9ff; border-radius: 8px; padding: 14px 16px; margin-bottom: 24px; flex-wrap: wrap; }
    .info-item .lbl { font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: .5px; }
    .info-item .val { font-size: 13px; font-weight: 600; color: #1B3A6B; margin-top: 2px; }
    .ftr { text-align: center; padding: 20px; font-size: 11px; color: #aaa; }
  </style>
</head>
<body>

<div class="hdr">
  <div>
    <div class="co">Preferred Builders General Services Inc.</div>
    <div class="sub">HIC-197400 · CSL CS-121662 · 37 Duck Mill Rd, Fitchburg MA · 978-377-1784</div>
  </div>
  <div class="badge">🔒 Secure Document</div>
</div>

<div class="card">
  <div class="doc-title">${isProposal ? 'Project Proposal — Approval & Signature' : 'Construction Contract — Signature'}</div>
  <div class="doc-sub">${isProposal ? 'Review and approve your project proposal' : 'Review and sign your construction contract'}</div>

  <div class="info-row">
    <div class="info-item"><div class="lbl">Customer</div><div class="val">${job.customer_name || '—'}</div></div>
    <div class="info-item"><div class="lbl">Property</div><div class="val">${job.project_address || '—'}${job.project_city ? ', ' + job.project_city : ''}</div></div>
    ${amount ? `<div class="info-item"><div class="lbl">${isProposal ? 'Proposal Value' : 'Contract Value'}</div><div class="val">${amount}</div></div>` : ''}
  </div>

  ${already ? alreadySigned : alreadyDeclined ? alreadyDeclinedHTML : formHTML}
</div>

<div class="ftr">
  This is a secure, encrypted document link for ${job.customer_name || 'the authorized signatory'} only.<br>
  Preferred Builders General Services Inc. · HIC-197400 · <a href="https://preferredbuildersusa.com" style="color:#aaa">preferredbuildersusa.com</a>
</div>

${
  already || alreadyDeclined
    ? ''
    : `
<script>
(function() {
  // ── Record open on page load ──
  fetch('/api/signing/opened/${session.token}', { method: 'POST' }).catch(()=>{});

  // ── Signature pad ──
  const canvas = document.getElementById('sigPad');
  const ctx    = canvas.getContext('2d');
  let drawing  = false;
  let hasSig   = false;

  function scale() {
    const r = canvas.getBoundingClientRect();
    canvas.width  = r.width  * window.devicePixelRatio;
    canvas.height = r.height * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    ctx.strokeStyle = '#1B3A6B';
    ctx.lineWidth   = 2;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
  }
  scale();
  window.addEventListener('resize', scale);

  function pos(e) {
    const r = canvas.getBoundingClientRect();
    const src = e.touches ? e.touches[0] : e;
    return { x: src.clientX - r.left, y: src.clientY - r.top };
  }

  canvas.addEventListener('mousedown',  e => { drawing = true; ctx.beginPath(); const p = pos(e); ctx.moveTo(p.x, p.y); });
  canvas.addEventListener('mousemove',  e => { if (!drawing) return; const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); hasSig = true; });
  canvas.addEventListener('mouseup',    () => { drawing = false; });
  canvas.addEventListener('mouseleave', () => { drawing = false; });
  canvas.addEventListener('touchstart', e => { e.preventDefault(); drawing = true; ctx.beginPath(); const p = pos(e); ctx.moveTo(p.x, p.y); }, { passive: false });
  canvas.addEventListener('touchmove',  e => { e.preventDefault(); if (!drawing) return; const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); hasSig = true; }, { passive: false });
  canvas.addEventListener('touchend',   e => { e.preventDefault(); drawing = false; }, { passive: false });

  window.clearSig = function() {
    ctx.clearRect(0, 0, canvas.width / window.devicePixelRatio, canvas.height / window.devicePixelRatio);
    hasSig = false;
  };

  window.toggleDecline = function() {
    const panel = document.getElementById('declinePanel');
    const toggle = document.getElementById('declineToggle');
    if (!panel) return;
    const isHidden = panel.style.display === 'none';
    panel.style.display = isHidden ? 'block' : 'none';
    if (toggle) toggle.style.display = isHidden ? 'none' : 'block';
    // Hide / restore the signature form when decline mode is active
    const sigSection = document.getElementById('sigSection');
    if (sigSection) sigSection.style.display = isHidden ? 'none' : 'block';
  };

  window.submitDecline = async function() {
    const reason = (document.getElementById('declineReason')?.value || '').trim();
    const err = document.getElementById('declineErr');
    err.style.display = 'none';
    if (!reason) {
      err.textContent = 'Please describe your concerns before submitting.';
      err.style.display = 'block';
      return;
    }
    const btn = document.getElementById('declineBtn');
    btn.disabled = true;
    btn.textContent = 'Sending…';
    try {
      const res = await fetch('/api/signing/declined/${session.token}', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decline_reason: reason })
      });
      const data = await res.json();
      if (res.ok) {
        document.querySelector('.card').innerHTML = \`
          <div style="text-align:center;padding:40px 20px">
            <div style="font-size:64px;margin-bottom:20px">📬</div>
            <h2 style="color:#1B3A6B;margin-bottom:10px">Feedback Received</h2>
            <p style="color:#555;font-size:14px;line-height:1.6">
              Thank you for letting us know. Our team has been notified and will follow up with you shortly to address your concerns.
            </p>
            <p style="color:#aaa;font-size:12px;margin-top:16px">Submitted: \${new Date().toLocaleString()}</p>
          </div>\`;
      } else {
        btn.disabled = false;
        btn.textContent = 'Send Feedback';
        err.textContent = data.error || 'Submission failed. Please try again.';
        err.style.display = 'block';
      }
    } catch (ex) {
      btn.disabled = false;
      btn.textContent = 'Send Feedback';
      err.textContent = 'Network error. Please try again.';
      err.style.display = 'block';
    }
  };

  window.submitSig = async function() {
    const name  = document.getElementById('signerName').value.trim();
    const agree = document.getElementById('agreeCheck').checked;
    const err   = document.getElementById('errMsg');
    err.style.display = 'none';

    if (!name)   { err.textContent = 'Please enter your full name.'; err.style.display = 'block'; return; }
    if (!hasSig) { err.textContent = 'Please draw your signature above.'; err.style.display = 'block'; return; }
    if (!agree)  { err.textContent = 'Please check the agreement checkbox.'; err.style.display = 'block'; return; }

    const btn = document.getElementById('submitBtn');
    btn.disabled = true;
    btn.textContent = 'Submitting…';

    const sigData = canvas.toDataURL('image/png');
    try {
      const res = await fetch('/api/signing/signed/${session.token}', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signer_name: name, signature_data: sigData, user_agent: navigator.userAgent, consent_accepted: true })
      });
      const data = await res.json();
      if (res.ok) {
        document.querySelector('.card').innerHTML = \`
          <div style="text-align:center;padding:40px 20px">
            <div style="font-size:64px;margin-bottom:20px">✅</div>
            <h2 style="color:#1B3A6B;margin-bottom:10px">Thank you, \${name}!</h2>
            <p style="color:#555;font-size:14px;line-height:1.6">
              ${
                isProposal
                  ? 'Your proposal has been approved. Preferred Builders will now prepare your contract and reach out shortly.'
                  : 'Your contract has been signed. You will receive a copy by email. Welcome to the Preferred Builders family!'
              }
            </p>
            <p style="color:#aaa;font-size:12px;margin-top:16px">Signed: \${new Date().toLocaleString()}</p>
          </div>\`;
      } else {
        btn.disabled = false;
        btn.textContent = '✍️ ${isProposal ? 'Approve & Sign Proposal' : 'Sign Contract'}';
        err.textContent = data.error || 'Submission failed. Please try again.';
        err.style.display = 'block';
      }
    } catch (ex) {
      btn.disabled = false;
      btn.textContent = '✍️ ${isProposal ? 'Approve & Sign Proposal' : 'Sign Contract'}';
      err.textContent = 'Network error. Please try again.';
      err.style.display = 'block';
    }
  };
})();
</script>`
}

</body>
</html>`;
}

// ─── Public signing pages ──────────────────────────────────────────────────────

router.get('/sign/p/:token', (req, res) => {
  const db = getDb();
  const session = db
    .prepare('SELECT * FROM signing_sessions WHERE token = ? AND doc_type = ?')
    .get(req.params.token, 'proposal');
  if (!session) return res.status(404).send('<h2>Link not found or expired.</h2>');
  if (session.status === 'superseded') return res.status(410).send(supersededPageHTML('proposal'));
  if (isSessionExpired(session)) return res.status(410).send(expiredPageHTML('proposal'));
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(session.job_id);
  if (!job) return res.status(404).send('<h2>Job not found.</h2>');
  res.send(signingPageHTML({ docType: 'proposal', job, session, base: baseURL(req) }));
});

router.get('/sign/c/:token', (req, res) => {
  const db = getDb();
  const session = db
    .prepare('SELECT * FROM signing_sessions WHERE token = ? AND doc_type = ?')
    .get(req.params.token, 'contract');
  if (!session) return res.status(404).send('<h2>Link not found or expired.</h2>');
  if (session.status === 'superseded') return res.status(410).send(supersededPageHTML('contract'));
  if (isSessionExpired(session)) return res.status(410).send(expiredPageHTML('contract'));
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(session.job_id);
  if (!job) return res.status(404).send('<h2>Job not found.</h2>');
  res.send(signingPageHTML({ docType: 'contract', job, session, base: baseURL(req) }));
});

// ─── Record open (called by client JS on page load) ───────────────────────────

router.post('/api/signing/opened/:token', (req, res) => {
  const db = getDb();
  const session = db
    .prepare('SELECT * FROM signing_sessions WHERE token = ?')
    .get(req.params.token);
  if (!session) return res.status(404).json({ error: 'Not found' });

  if (!session.opened_at) {
    const ip = clientIP(req);
    db.prepare(
      'UPDATE signing_sessions SET opened_at = CURRENT_TIMESTAMP, opened_ip = ?, status = ? WHERE token = ?',
    ).run(ip, 'opened', req.params.token);

    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(session.job_id);
    const docLabel = session.doc_type === 'proposal' ? 'Proposal' : 'Contract';
    logAudit(
      session.job_id,
      `${session.doc_type}_opened`,
      `${docLabel} opened by customer (IP: ${ip})`,
      'customer',
    );
    notifyClients('job_updated', {
      jobId: session.job_id,
      event: `${session.doc_type}_opened`,
      message: `📬 ${job?.customer_name || 'Customer'} opened the ${docLabel.toLowerCase()} — ${new Date().toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/New_York' })}`,
    });

    // Email owners on first open
    setImmediate(async () => {
      try {
        const { sendEmail, getOwnerEmails } = require('../services/emailService');
        const owners = getOwnerEmails();
        if (owners.length) {
          const when = new Date().toLocaleString('en-US', {
            dateStyle: 'medium',
            timeStyle: 'short',
            timeZone: 'America/New_York',
          });
          await sendEmail({
            to: owners,
            subject: `📬 ${docLabel} opened — ${job?.customer_name || 'Customer'}`,
            html: `<p><strong>${job?.customer_name || 'The customer'}</strong> just opened their <strong>${docLabel.toLowerCase()}</strong> signing link.</p>
                   <p><strong>Project:</strong> ${job?.project_address || '—'}</p>
                   <p><strong>Time:</strong> ${when}</p>
                   <p><a href="${process.env.APP_URL || ''}/jobs/${session.job_id}">View job →</a></p>`,
            emailType: 'system_alert',
            jobId: session.job_id,
          });
        }
      } catch (e) {
        console.warn('[SigningOpenedAlert]', e.message);
      }
    });
  }
  res.json({ ok: true });
});

// ─── Record decline ───────────────────────────────────────────────────────────

router.post('/api/signing/declined/:token', async (req, res) => {
  const db = getDb();
  const session = db
    .prepare('SELECT * FROM signing_sessions WHERE token = ?')
    .get(req.params.token);
  if (!session) return res.status(404).json({ error: 'Not found' });
  if (session.status === 'signed')
    return res.status(400).json({ error: 'This session has already been signed' });
  if (session.status === 'declined') return res.status(400).json({ error: 'Already declined' });
  if (session.doc_type !== 'proposal')
    return res.status(400).json({ error: 'Decline is only available for proposals' });

  const { decline_reason } = req.body;
  if (!decline_reason || !String(decline_reason).trim()) {
    return res.status(400).json({ error: 'Please provide a reason for requesting changes' });
  }

  if (isSessionExpired(session))
    return res.status(410).json({
      error: 'This signing link has expired. Please contact Preferred Builders for a new link.',
    });

  const ip = clientIP(req);
  const reason = String(decline_reason).trim();

  db.prepare(
    `UPDATE signing_sessions SET status = 'declined', decline_reason = ? WHERE token = ?`,
  ).run(reason, req.params.token);

  db.prepare(
    "UPDATE jobs SET status = 'proposal_declined', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
  ).run(session.job_id);

  try {
    jobMemory.markOutcome(session.job_id, 'rejected');
  } catch {
    /* ignore */
  }

  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(session.job_id);

  logAudit(
    session.job_id,
    'proposal_declined',
    `Proposal declined by customer (IP: ${ip}). Reason: ${reason}`,
    'customer',
  );

  notifyClients('job_updated', {
    jobId: session.job_id,
    status: 'proposal_declined',
    message: `❌ ${job?.customer_name || 'Customer'} requested changes — ${reason.slice(0, 80)}${reason.length > 80 ? '…' : ''}`,
  });

  setImmediate(async () => {
    try {
      const { getOwnerEmails } = require('../services/emailService');
      const owners = getOwnerEmails();
      if (owners.length) {
        const when = new Date().toLocaleString('en-US', {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: 'America/New_York',
        });
        const jobLink = `${process.env.APP_URL || ''}/jobs/${session.job_id}`;
        const escapeHtml = (s) =>
          s
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
        await sendEmail({
          to: owners,
          subject: `❌ Proposal changes requested — ${job?.customer_name || 'Customer'}`,
          html: `<p><strong>${escapeHtml(job?.customer_name || 'The customer')}</strong> has requested changes to their proposal.</p>
                 <p><strong>Project:</strong> ${escapeHtml(job?.project_address || '—')}</p>
                 <p><strong>Time:</strong> ${when}</p>
                 <div style="background:#fff3f3;border-left:4px solid #c62828;padding:12px 16px;margin:12px 0;border-radius:0 6px 6px 0">
                   <strong>Customer comments:</strong><br>${escapeHtml(reason).replace(/\n/g, '<br>')}
                 </div>
                 <p><a href="${jobLink}">View job →</a></p>`,
          emailType: 'system_alert',
          jobId: session.job_id,
        });
      }
    } catch (e) {
      console.warn('[ProposalDeclinedAlert]', e.message);
    }
  });

  res.json({ ok: true });
});

// ─── Record signature ─────────────────────────────────────────────────────────

router.post('/api/signing/signed/:token', requireFields(['signer_name']), async (req, res) => {
  const db = getDb();
  const session = db
    .prepare('SELECT * FROM signing_sessions WHERE token = ?')
    .get(req.params.token);
  if (!session) return res.status(404).json({ error: 'Not found' });
  if (session.status === 'signed') return res.status(400).json({ error: 'Already signed' });
  if (session.status === 'declined')
    return res.status(400).json({
      error:
        'This session has been declined. Please contact Preferred Builders for a revised proposal.',
    });
  if (isSessionExpired(session))
    return res.status(410).json({
      error: 'This signing link has expired. Please contact Preferred Builders for a new link.',
    });

  const { signer_name, signature_data, user_agent, consent_accepted } = req.body;
  if (!signer_name || !signature_data)
    return res.status(400).json({ error: 'Missing name or signature' });

  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(session.job_id);

  const ip = clientIP(req);
  const docPdfPath =
    session.doc_type === 'proposal' ? job?.proposal_pdf_path : job?.contract_pdf_path;
  const docHash = hashFile(docPdfPath);
  const signerEmail = job?.customer_email || '';
  const signerUA = user_agent || req.headers['user-agent'] || '';

  db.prepare(
    `UPDATE signing_sessions SET
       signed_at = CURRENT_TIMESTAMP, signed_ip = ?, signer_name = ?, signature_data = ?,
       status = 'signed', consent_accepted = ?, signer_user_agent = ?,
       signer_email = ?, document_hash = ?
     WHERE token = ?`,
  ).run(
    ip,
    signer_name,
    signature_data,
    consent_accepted ? 1 : 0,
    signerUA,
    signerEmail,
    docHash,
    req.params.token,
  );

  if (session.doc_type === 'proposal') {
    db.prepare(
      "UPDATE jobs SET status = 'proposal_approved', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).run(session.job_id);
    try {
      jobMemory.markOutcome(session.job_id, 'approved');
    } catch {
      /* ignore */
    }
    logAudit(
      session.job_id,
      'proposal_signed',
      `Proposal signed by ${signer_name} (IP: ${ip})`,
      'customer',
    );
    notifyClients('job_updated', {
      jobId: session.job_id,
      status: 'proposal_approved',
      message: `✅ Proposal signed by ${signer_name}`,
    });
    {
      const contact = job?.contact_id
        ? db.prepare('SELECT pb_customer_number FROM contacts WHERE id = ?').get(job.contact_id)
        : null;
      logActivity({
        customer_number: contact?.pb_customer_number || null,
        job_id: session.job_id,
        event_type: 'ESTIMATE_APPROVED',
        description: `Proposal approved & signed by ${signer_name}`,
        recorded_by: 'customer',
      });
    }

    // Notify owners that proposal was signed
    setImmediate(async () => {
      try {
        const { sendEmail, getOwnerEmails } = require('../services/emailService');
        const owners = getOwnerEmails();
        if (owners.length) {
          const when = new Date().toLocaleString('en-US', {
            dateStyle: 'medium',
            timeStyle: 'short',
            timeZone: 'America/New_York',
          });
          await sendEmail({
            to: owners,
            subject: `✅ Proposal signed — ${job?.customer_name || signer_name}`,
            html: `<p><strong>${signer_name}</strong> just signed the proposal for <strong>${job?.customer_name || 'a customer'}</strong>.</p>
                   <p><strong>Project:</strong> ${job?.project_address || '—'}</p>
                   <p><strong>Total:</strong> $${Number(job?.total_value || 0).toLocaleString()}</p>
                   <p><strong>Time:</strong> ${when}</p>
                   <p>The contract is now being auto-generated.</p>
                   <p><a href="${process.env.APP_URL || ''}/jobs/${session.job_id}">View job →</a></p>`,
            emailType: 'system_alert',
            jobId: session.job_id,
          });
        }
      } catch (e) {
        console.warn('[ProposalSignedAlert]', e.message);
      }
    });

    // Auto-generate contract in background (+ embed signature in proposal PDF first)
    setImmediate(async () => {
      // Embed drawn signature + certificate into the proposal PDF before auto-generating contract
      try {
        const updatedSession = db
          .prepare('SELECT * FROM signing_sessions WHERE token = ?')
          .get(req.params.token);
        const appendHtml =
          buildSignatureBlockHTML(updatedSession) + buildCertificatePageHTML(updatedSession, job);
        const proposalData =
          typeof job.proposal_data === 'string' ? JSON.parse(job.proposal_data) : job.proposal_data;
        const signedProposalPath = await generateSignedPDF(
          proposalData,
          'proposal',
          job.id,
          appendHtml,
        );
        db.prepare('UPDATE jobs SET proposal_pdf_path = ? WHERE id = ?').run(
          signedProposalPath,
          job.id,
        );
      } catch (signErr) {
        console.warn('[SignedPDF] Failed to embed signature in proposal PDF:', signErr.message);
      }

      try {
        const { generateContract } = require('../services/claudeService');
        const { generatePDF } = require('../services/pdfService');
        const proposalData =
          typeof job.proposal_data === 'string' ? JSON.parse(job.proposal_data) : job.proposal_data;
        if (!proposalData.job) proposalData.job = {};
        proposalData.job.payment_overrides = job.payment_overrides || null;
        const contractData = await generateContract(proposalData, session.job_id, 'en');
        const contractPDF = await generatePDF(contractData, 'contract', session.job_id);
        db.prepare(
          "UPDATE jobs SET contract_data = ?, contract_pdf_path = ?, status = 'contract_ready', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        ).run(JSON.stringify(contractData), contractPDF, session.job_id);
        logAudit(
          session.job_id,
          'contract_auto_generated',
          'Contract auto-generated after proposal approval',
          'system',
        );
        try {
          const contactRow = db
            .prepare(
              'SELECT pb_customer_number FROM contacts WHERE id = (SELECT contact_id FROM jobs WHERE id = ?)',
            )
            .get(session.job_id);
          logActivity({
            customer_number: contactRow?.pb_customer_number || null,
            job_id: session.job_id,
            event_type: 'CONTRACT_GENERATED',
            description: 'Contract auto-generated and ready to send',
            recorded_by: 'system',
          });
        } catch {
          /* ignore */
        }
        notifyClients('job_updated', {
          jobId: session.job_id,
          status: 'contract_ready',
          message: '📋 Contract auto-generated and ready to send',
        });
      } catch (e) {
        console.error('[AutoContract]', e.message);
      }
    });
  } else {
    db.prepare(
      "UPDATE jobs SET status = 'contract_signed', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).run(session.job_id);
    try {
      jobMemory.lock(session.job_id, 'contract_signed');
    } catch {
      /* ignore */
    }
    logAudit(
      session.job_id,
      'contract_signed',
      `Contract signed by ${signer_name} (IP: ${ip})`,
      'customer',
    );
    // Auto-wipe stored email HTML previews for this job now that contract is signed
    try {
      db.prepare('UPDATE email_log SET html_body = NULL WHERE job_id = ?').run(session.job_id);
    } catch {
      /* ignore */
    }
    notifyClients('job_updated', {
      jobId: session.job_id,
      status: 'contract_signed',
      message: `🎉 Contract signed by ${signer_name}`,
    });
    {
      const contact = job?.contact_id
        ? db.prepare('SELECT pb_customer_number FROM contacts WHERE id = ?').get(job.contact_id)
        : null;
      logActivity({
        customer_number: contact?.pb_customer_number || null,
        job_id: session.job_id,
        event_type: 'CONTRACT_SIGNED',
        description: `Contract signed by ${signer_name}`,
        recorded_by: 'customer',
      });
    }
    // Auto-create draft deposit invoice (Invoice 1) via shared service
    autoCreateDepositInvoice(session.job_id, db);

    // Email signed confirmation to customer — attach merged proposal + signed contract PDF
    try {
      if (job?.customer_email) {
        // Embed drawn signature + certificate into the contract PDF before merging
        let signedContractPath = job.contract_pdf_path;
        let signedProposalPath = job.proposal_pdf_path;
        try {
          const updatedSession = db
            .prepare('SELECT * FROM signing_sessions WHERE token = ?')
            .get(req.params.token);
          const appendHtml =
            buildSignatureBlockHTML(updatedSession) + buildCertificatePageHTML(updatedSession, job);
          const contractData =
            typeof job.contract_data === 'string'
              ? JSON.parse(job.contract_data)
              : job.contract_data;
          signedContractPath = await generateSignedPDF(
            contractData,
            'contract',
            job.id,
            appendHtml,
          );
          db.prepare('UPDATE jobs SET contract_pdf_path = ? WHERE id = ?').run(
            signedContractPath,
            job.id,
          );
          // Re-fetch proposal path in case it was updated when the proposal was signed
          const refreshed = db
            .prepare('SELECT proposal_pdf_path FROM jobs WHERE id = ?')
            .get(job.id);
          signedProposalPath = refreshed?.proposal_pdf_path || job.proposal_pdf_path;
        } catch (signErr) {
          console.warn('[SignedPDF] Failed to embed signature in contract PDF:', signErr.message);
        }

        const signedWhen = new Date().toLocaleString('en-US', {
          dateStyle: 'long',
          timeStyle: 'short',
          timeZone: 'America/New_York',
        });
        const { mergePDFs } = require('../services/pdfMergeService');
        const safeName = (job.customer_name || job.id)
          .replace(/\s+/g, '-')
          .replace(/[^a-zA-Z0-9-]/g, '');
        let mergedPdfPath = null;
        let mergedPdfName = `Preferred-Builders-Signed-Contract-${safeName}.pdf`;
        try {
          mergedPdfPath = await mergePDFs(
            [signedProposalPath, signedContractPath],
            `pb-signed-${job.id}.pdf`,
          );
        } catch (mergeErr) {
          console.warn('[MergePDF] Merge failed, falling back to contract only:', mergeErr.message);
          mergedPdfPath = signedContractPath;
        }

        // Save combined contract + addendum to signed contracts folder (Windows server)
        const contractsDir = process.env.SIGNED_CONTRACTS_DIR;
        if (contractsDir && mergedPdfPath) {
          try {
            const fsSync = require('fs');
            if (!fsSync.existsSync(contractsDir))
              fsSync.mkdirSync(contractsDir, { recursive: true });
            const destPath = require('path').join(contractsDir, mergedPdfName);
            fsSync.copyFileSync(mergedPdfPath, destPath);
            console.log(`[SignedContracts] Combined contract+addendum saved: ${destPath}`);
          } catch (saveErr) {
            console.warn('[SignedContracts] Failed to save combined file:', saveErr.message);
          }
        }

        await sendEmail({
          to: job.customer_email,
          subject: `Your Preferred Builders Contract is Signed — Copy Enclosed`,
          attachmentPath: mergedPdfPath,
          attachmentName: mergedPdfName,
          html: `<div style="font-family:Arial,sans-serif;max-width:580px;margin:0 auto">
            <div style="background:#059669;padding:20px 24px;color:white;border-radius:8px 8px 0 0">
              <div style="font-size:17px;font-weight:700">✅ Contract Signed — Preferred Builders General Services Inc.</div>
              <div style="font-size:12px;opacity:.8;margin-top:4px">HIC-197400 · CSL CS-121662 · 978-377-1784</div>
            </div>
            <div style="background:white;padding:28px 24px;border:1px solid #eee;border-top:none">
              <p style="font-size:15px;color:#1B3A6B;font-weight:700;margin-bottom:12px">Hi ${job.customer_name || 'there'},</p>
              <p style="color:#444;font-size:14px;line-height:1.7;margin-bottom:16px">
                Thank you — your construction contract with Preferred Builders General Services Inc. has been signed and is on file.
                <strong>📎 Your signed contract and original proposal are combined into one document and attached to this email</strong> for your records. Please save it in a safe place.
              </p>
              <div style="background:#F0FFF6;border-radius:8px;padding:16px 20px;margin-bottom:20px">
                <p style="margin:0 0 8px 0;font-size:13px;color:#444"><strong>Project:</strong> ${job.project_address}${job.project_city ? ', ' + job.project_city : ''}</p>
                <p style="margin:0 0 8px 0;font-size:13px;color:#444"><strong>Contract Value:</strong> ${job.total_value ? '$' + Number(job.total_value).toLocaleString() : '—'}</p>
                <p style="margin:0;font-size:13px;color:#444"><strong>Signed:</strong> ${signedWhen}</p>
              </div>
              <p style="color:#444;font-size:14px;line-height:1.7;margin-bottom:16px">
                Your deposit is due as outlined in the contract. Once your deposit is received, your project will be officially scheduled.
                We will follow up shortly with your start date and project timeline.
              </p>
              <div style="background:#FFF8F0;border-left:3px solid #E07B2A;padding:12px 16px;border-radius:0 6px 6px 0;margin-bottom:20px">
                <p style="margin:0 0 6px 0;font-size:12px;color:#5D3A00;line-height:1.6">
                  <strong>⚠️ 3-Day Right to Cancel:</strong> Per M.G.L. c. 93 §48, you have the right to cancel this agreement within 3 business days of signing if it was executed away from our principal place of business. Cancellation must be submitted in writing to jackson.deaquino@preferredbuildersusa.com.
                </p>
              </div>
              <div style="background:#F0FFF6;border-radius:8px;padding:16px 20px;margin-bottom:20px">
                <p style="margin:0 0 6px 0;font-size:13px;font-weight:700;color:#059669">🤝 Refer a Friend &amp; Save $250</p>
                <p style="margin:0;font-size:13px;color:#444;line-height:1.6">
                  Welcome to the Preferred Builders family! Refer a friend or family member — if they sign a contract with us,
                  <strong>you receive $250 off your next project</strong>. Just have them mention your name when they reach out.
                </p>
              </div>
              <p style="color:#888;font-size:12px;line-height:1.6">
                Questions? Reply to this email or call us at <strong>978-377-1784</strong>.
              </p>
            </div>
            <div style="background:#f8f9ff;padding:14px 24px;font-size:10px;color:#aaa;border-radius:0 0 8px 8px">
              <p style="margin:0 0 4px 0">Preferred Builders General Services Inc. · 37 Duck Mill Rd, Fitchburg MA 01420 · HIC-197400 · CSL CS-121662</p>
              <p style="margin:0 0 4px 0">By receiving this contract you agree to receive digital communications from Preferred Builders General Services Inc. as required for your project.</p>
              <p style="margin:0 0 4px 0">This contract is legally binding once signed and deposit is received and the 3-business-day cancellation period has elapsed.</p>
              <p style="margin:0">The approved Proposal / Scope of Work is non-binding on its own and is incorporated herein as a Contract Addendum upon execution of this agreement.</p>
            </div>
          </div>`,
          text: `Hi ${job.customer_name || 'there'},\n\nYour construction contract with Preferred Builders is signed and on file. A copy is attached.\n\nProject: ${job.project_address}\nSigned: ${signedWhen}\n\nYour deposit is due per the contract. Once received your project will be scheduled.\n\nNote: You have 3 business days to cancel per M.G.L. c. 93 §48.\n\nRefer a friend who signs a contract and receive $250 off your next project.\n\n— Preferred Builders General Services Inc.\n978-377-1784`,
          emailType: 'contract_signed',
          jobId: job.id,
        });
      }
    } catch (e) {
      console.warn('[ContractSignedEmail]', e.message);
    }

    // Notify owners that contract was signed
    setImmediate(async () => {
      try {
        const { sendEmail, getOwnerEmails } = require('../services/emailService');
        const owners = getOwnerEmails();
        if (owners.length) {
          const when = new Date().toLocaleString('en-US', {
            dateStyle: 'medium',
            timeStyle: 'short',
            timeZone: 'America/New_York',
          });
          await sendEmail({
            to: owners,
            subject: `🎉 Contract signed — ${job?.customer_name || signer_name}`,
            html: `<p><strong>${signer_name}</strong> just signed the construction contract.</p>
                   <p><strong>Customer:</strong> ${job?.customer_name || '—'}</p>
                   <p><strong>Project:</strong> ${job?.project_address || '—'}</p>
                   <p><strong>Contract Value:</strong> $${Number(job?.total_value || 0).toLocaleString()}</p>
                   <p><strong>Time:</strong> ${when}</p>
                   <p><a href="${process.env.APP_URL || ''}/jobs/${session.job_id}">View job →</a></p>`,
            emailType: 'system_alert',
            jobId: session.job_id,
          });
        }
      } catch (e) {
        console.warn('[ContractSignedAlert]', e.message);
      }
    });
  }

  res.json({ ok: true });
});

// Admin routes (send-proposal, send-contract, status)
// live in signingAdmin.js

module.exports = router;
