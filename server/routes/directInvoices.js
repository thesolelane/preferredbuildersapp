'use strict';
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getDb } = require('../db/database');
const { generatePDFFromHTML } = require('../services/pdfService');
const { sendEmail } = require('../services/emailService');
const fs = require('fs');

const MA_TAX_RATE = 0.0625;
const ONLINE_FEE_PCT = 0.02;
const ONLINE_FEE_FLAT = 5.0;

function nextInvoiceNumber(db) {
  db.prepare('UPDATE direct_invoice_seq SET seq = seq + 1 WHERE id = 1').run();
  const { seq } = db.prepare('SELECT seq FROM direct_invoice_seq WHERE id = 1').get();
  const year = new Date().getFullYear();
  return `PB-INV-${year}-${String(seq).padStart(4, '0')}`;
}

function computeTotals(lineItems) {
  let materialsSubtotal = 0;
  let laborSubtotal = 0;
  let creditSubtotal = 0;
  for (const dept of lineItems) {
    for (const item of dept.items || []) {
      const amt = parseFloat(item.amount) || 0;
      if (item.type === 'material') materialsSubtotal += Math.abs(amt);
      else if (item.type === 'labor') laborSubtotal += Math.abs(amt);
      else if (item.type === 'credit') creditSubtotal += Math.abs(amt);
    }
  }
  const taxAmount = Math.round(materialsSubtotal * MA_TAX_RATE * 100) / 100;
  const total =
    Math.round((materialsSubtotal + taxAmount + laborSubtotal - creditSubtotal) * 100) / 100;
  return { materialsSubtotal, taxAmount, laborSubtotal, creditSubtotal, total };
}

function buildInvoiceHTML(inv, job, contact) {
  const fmt = (n) =>
    Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  let lineItems = [];
  try {
    lineItems = JSON.parse(inv.line_items || '[]');
  } catch {
    /* ignore */
  }

  const onlineFee = Math.round((inv.total * ONLINE_FEE_PCT + ONLINE_FEE_FLAT) * 100) / 100;
  const onlineTotal = Math.round((inv.total + onlineFee) * 100) / 100;

  const toName = inv.to_name || contact?.name || job?.customer_name || '';
  const toEmail = inv.to_email || contact?.email || job?.customer_email || '';
  const toPhone = inv.to_phone || contact?.phone || job?.customer_phone || '';
  const toAddress = inv.to_address || contact?.address || job?.project_address || '';

  const issueDate = inv.issued_at
    ? new Date(inv.issued_at).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    : new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  let itemsHTML = '';
  for (const dept of lineItems) {
    if (!dept.items || !dept.items.length) continue;
    itemsHTML += `<tr style="background:#1B3A6B0D">
      <td colspan="3" style="padding:8px 12px;font-size:10px;font-weight:700;color:#1B3A6B;
        text-transform:uppercase;letter-spacing:0.8px;border-bottom:1px solid #dbeafe">
        ${dept.dept || 'General'}
      </td>
    </tr>`;
    for (const item of dept.items) {
      const isMat = item.type === 'material';
      const isCredit = item.type === 'credit';
      const qty = item.qty != null ? item.qty : null;
      const unitPrice = item.unit_price != null ? item.unit_price : null;
      const qtyCell =
        isMat && qty != null
          ? `<span style="font-weight:600">${qty}</span>`
          : `<span style="color:#bbb">—</span>`;
      const upCell =
        isMat && unitPrice != null ? `$${fmt(unitPrice)}` : `<span style="color:#bbb">—</span>`;
      const typeBg = isMat ? '#fff3e0' : isCredit ? '#fef2f2' : '#e8f5e9';
      const typeColor = isMat ? '#E07B2A' : isCredit ? '#C62828' : '#2E7D32';
      const typeLabel = isMat ? 'Material' : isCredit ? 'Credit' : 'Labor';
      const amtDisplay = isCredit
        ? `<span style="color:#C62828">- $${fmt(Math.abs(parseFloat(item.amount) || 0))}</span>`
        : `$${fmt(item.amount)}`;
      itemsHTML += `<tr style="border-bottom:1px solid #f0f0f0${isCredit ? ';background:#fff8f8' : ''}">
        <td style="padding:7px 12px 7px 22px;font-size:12px;color:${isCredit ? '#C62828' : '#333'}">
          ${item.description || typeLabel}
        </td>
        <td style="padding:7px 12px;text-align:center;width:90px">
          <span style="font-size:10px;padding:2px 8px;border-radius:10px;font-weight:600;
            background:${typeBg};color:${typeColor}">
            ${typeLabel}
          </span>
        </td>
        <td style="padding:7px 8px;text-align:center;font-size:12px;width:55px;color:#555">
          ${qtyCell}
        </td>
        <td style="padding:7px 8px;text-align:right;font-size:12px;width:90px;color:#555">
          ${upCell}
        </td>
        <td style="padding:7px 12px;text-align:right;font-weight:600;font-size:12px;width:110px">
          ${amtDisplay}
        </td>
      </tr>`;
    }
  }

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; padding: 40px; color: #222; font-size: 13px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 28px; }
  .co-name { font-size: 22px; font-weight: 900; color: #1B3A6B; letter-spacing: -0.5px; }
  .co-sub { font-size: 11px; color: #888; margin-top: 4px; line-height: 1.6; }
  .inv-meta { text-align: right; }
  .inv-title { font-size: 30px; font-weight: 900; color: #1B3A6B; letter-spacing: 2px; }
  .inv-number { font-size: 12px; color: #888; margin-top: 4px; }
  .orange-bar { height: 3px; background: #E07B2A; margin-bottom: 24px; border-radius: 2px; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 24px; }
  .section-label { font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 1px; font-weight: 700; margin-bottom: 6px; }
  .section-value { font-size: 13px; color: #222; line-height: 1.7; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
  thead tr { background: #1B3A6B; color: white; }
  thead th { padding: 9px 12px; text-align: left; font-size: 11px; font-weight: 600; }
  thead th:last-child { text-align: right; }
  .totals-table { margin-left: auto; width: 300px; border: none; }
  .totals-table td { padding: 6px 10px; font-size: 13px; border: none; }
  .totals-table td:last-child { text-align: right; font-weight: 600; }
  .total-row td { font-weight: 900; font-size: 17px; color: #1B3A6B; border-top: 2px solid #1B3A6B; padding-top: 10px; }
  .due-box { background: #1B3A6B; color: white; text-align: center; padding: 14px 20px;
    border-radius: 6px; font-size: 15px; font-weight: 700; letter-spacing: 2px; margin: 20px 0; }
  .payable-line { font-size: 12px; color: #333; font-weight: 600; text-align: center; margin-bottom: 20px; }
  .online-box { border: 1.5px solid #c7d2fe; border-radius: 8px; padding: 16px 18px;
    background: #f8f9ff; margin-bottom: 20px; }
  .online-box-title { font-size: 12px; font-weight: 700; color: #1B3A6B; margin-bottom: 10px;
    display: flex; align-items: center; gap: 8px; }
  .online-fee-row { display: flex; justify-content: space-between; font-size: 11px;
    color: #555; margin-bottom: 4px; }
  .checkbox-row { display: flex; align-items: flex-start; gap: 10px; margin-top: 12px;
    padding-top: 10px; border-top: 1px solid #dbeafe; }
  .checkbox-box { width: 14px; height: 14px; min-width: 14px; border: 1.5px solid #1B3A6B;
    border-radius: 2px; margin-top: 1px; }
  .checkbox-text { font-size: 10px; color: #444; line-height: 1.5; }
  .zero-retention { font-size: 10px; color: #2E7D32; font-weight: 600; margin-top: 6px; }
  .uncheck-warning { font-size: 10px; color: #C62828; font-style: italic; margin-top: 4px; }
  .footer { margin-top: 36px; padding-top: 14px; border-top: 1px solid #eee;
    font-size: 10px; color: #aaa; text-align: center; line-height: 1.8; }
</style>
</head>
<body>

<div class="header">
  <div>
    <div class="co-name">PREFERRED BUILDERS</div>
    <div class="co-sub">
      General Services Inc.<br>
      37 Duck Mill Rd, Fitchburg, MA 01420<br>
      978-377-1784 &nbsp;|&nbsp; HIC-197400 &nbsp;|&nbsp; CSL CS-121662
    </div>
  </div>
  <div class="inv-meta">
    <div class="inv-title">INVOICE</div>
    <div class="inv-number">${inv.invoice_number}</div>
    <div class="inv-number">Date: ${issueDate}</div>
    <div class="inv-number" style="margin-top:6px;font-size:11px;font-weight:700;color:#C62828">
      DUE UPON RECEIPT
    </div>
  </div>
</div>

<div class="orange-bar"></div>

<div class="two-col">
  <div>
    <div class="section-label">Bill To</div>
    <div class="section-value">
      <strong>${toName}</strong><br>
      ${toEmail ? toEmail + '<br>' : ''}
      ${toPhone ? toPhone + '<br>' : ''}
      ${toAddress || ''}
    </div>
  </div>
  ${
    job
      ? `<div>
    <div class="section-label">Project</div>
    <div class="section-value">
      ${job.pb_number || job.quote_number ? '<strong>PB# ' + (job.pb_number || job.quote_number) + '</strong><br>' : ''}
      ${job.project_address || ''}${job.project_city ? ', ' + job.project_city + ', MA' : ''}
    </div>
  </div>`
      : '<div></div>'
  }
</div>

<table>
  <thead>
    <tr>
      <th>Description</th>
      <th style="text-align:center;width:90px">Type</th>
      <th style="text-align:center;width:55px">Qty</th>
      <th style="text-align:right;width:90px">Unit Price</th>
      <th style="text-align:right;width:110px">Amount</th>
    </tr>
  </thead>
  <tbody>
    ${itemsHTML || '<tr><td colspan="5" style="padding:14px;color:#aaa;text-align:center">No line items</td></tr>'}
  </tbody>
</table>

<table class="totals-table">
  <tbody>
    <tr>
      <td style="color:#555">Materials Subtotal</td>
      <td>$${fmt(inv.materials_subtotal)}</td>
    </tr>
    <tr>
      <td style="color:#E07B2A">MA Sales Tax (6.25%)</td>
      <td style="color:#E07B2A">$${fmt(inv.tax_amount)}</td>
    </tr>
    <tr>
      <td style="color:#2E7D32">Labor Subtotal</td>
      <td style="color:#2E7D32">$${fmt(inv.labor_subtotal)}</td>
    </tr>
    ${
      inv.credit_subtotal > 0
        ? `<tr>
      <td style="color:#C62828">Credits / Discounts</td>
      <td style="color:#C62828">- $${fmt(inv.credit_subtotal)}</td>
    </tr>`
        : ''
    }
    <tr class="total-row">
      <td>Invoice Total</td>
      <td>$${fmt(inv.total)}</td>
    </tr>
  </tbody>
</table>

<div class="due-box">DUE UPON RECEIPT</div>

<p class="payable-line">
  Please make your check or money order payable to:
  <strong>Preferred Builders General Services Inc.</strong>
</p>

<div class="online-box">
  <div class="online-box-title">
    <span style="font-size:16px">&#128274;</span>
    Online Payments &mdash; Coming Soon
  </div>
  <div class="online-fee-row">
    <span>Invoice Total</span>
    <span>$${fmt(inv.total)}</span>
  </div>
  <div class="online-fee-row">
    <span>Online Processing Fee (2% + $5.00)</span>
    <span>$${fmt(onlineFee)}</span>
  </div>
  <div class="online-fee-row" style="font-weight:700;color:#1B3A6B;font-size:12px;margin-top:4px">
    <span>Total if Paying Online</span>
    <span>$${fmt(onlineTotal)}</span>
  </div>
  <div class="checkbox-row">
    <div class="checkbox-box"></div>
    <div>
      <div class="checkbox-text">
        By checking this box I agree to pay the processing fee of 2% + $5.00 for online payment.
        This box must be checked before an online payment can be processed.
      </div>
      <div class="zero-retention">
        &#10003; Zero retention of card information after payment is processed.
      </div>
      <div class="uncheck-warning">
        If this box is not checked, online payment cannot be processed.
      </div>
    </div>
  </div>
</div>

${inv.notes ? `<div style="padding:12px 16px;background:#f8f9ff;border-radius:6px;font-size:12px;color:#444;margin-bottom:20px"><strong>Notes:</strong> ${inv.notes}</div>` : ''}

<div class="footer">
  Preferred Builders General Services Inc. &middot; MA HIC-197400 &middot; CSL CS-121662
  &middot; 978-377-1784<br>
  37 Duck Mill Rd, Fitchburg, MA 01420<br>
  Thank you for choosing Preferred Builders!
</div>

</body>
</html>`;
}

router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const invs = db.prepare('SELECT * FROM direct_invoices ORDER BY created_at DESC').all();
  res.json({ invoices: invs });
});

router.get('/job/:jobId', requireAuth, (req, res) => {
  const db = getDb();
  const invs = db
    .prepare('SELECT * FROM direct_invoices WHERE job_id = ? ORDER BY created_at DESC')
    .all(req.params.jobId);
  res.json({ invoices: invs });
});

router.post('/', requireAuth, (req, res) => {
  const db = getDb();
  const { job_id, contact_id, to_name, to_email, to_phone, to_address, line_items, notes } =
    req.body;

  if (!Array.isArray(line_items) || !line_items.length) {
    return res.status(400).json({ error: 'line_items required' });
  }
  if (!to_name && !to_email) {
    return res.status(400).json({ error: 'Recipient name or email required' });
  }

  const { materialsSubtotal, taxAmount, laborSubtotal, creditSubtotal, total } =
    computeTotals(line_items);
  const invNum = nextInvoiceNumber(db);

  const info = db
    .prepare(
      `INSERT INTO direct_invoices
        (invoice_number, job_id, contact_id, to_name, to_email, to_phone, to_address,
         line_items, materials_subtotal, tax_amount, labor_subtotal, credit_subtotal, total, notes, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      invNum,
      job_id || null,
      contact_id || null,
      to_name || null,
      to_email || null,
      to_phone || null,
      to_address || null,
      JSON.stringify(line_items),
      materialsSubtotal,
      taxAmount,
      laborSubtotal,
      creditSubtotal,
      total,
      notes || null,
      req.session?.name || 'staff',
    );

  const invoice = db
    .prepare('SELECT * FROM direct_invoices WHERE id = ?')
    .get(info.lastInsertRowid);
  res.json({ invoice });
});

router.patch('/:id', requireAuth, (req, res) => {
  const { randomUUID } = require('crypto');
  const db = getDb();
  const inv = db.prepare('SELECT * FROM direct_invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Not found' });

  const { status, notes, allocations } = req.body;
  const newStatus = ['draft', 'sent', 'paid'].includes(status) ? status : inv.status;
  const becomingPaid = newStatus === 'paid' && inv.status !== 'paid';
  const paidAt = becomingPaid ? new Date().toISOString() : inv.paid_at;

  // Validate split allocations BEFORE touching the DB
  if (becomingPaid && Array.isArray(allocations) && allocations.length >= 2) {
    const invTotal = Number(inv.total) || 0;
    const allocSum = allocations.reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);
    if (Math.abs(allocSum - invTotal) > 0.02) {
      return res.status(400).json({
        error: `Allocation total ($${allocSum.toFixed(2)}) must equal invoice total ($${invTotal.toFixed(2)})`,
      });
    }
    if (allocations.some((a) => !a.job_id || !(parseFloat(a.amount) > 0))) {
      return res
        .status(400)
        .json({ error: 'Each allocation must have a job and a positive amount' });
    }
    // Verify each job_id exists
    const jobCheck = db.prepare('SELECT id FROM jobs WHERE id = ?');
    for (const alloc of allocations) {
      if (!jobCheck.get(alloc.job_id)) {
        return res.status(400).json({ error: `Job ${alloc.job_id} not found` });
      }
    }
  }

  // All-or-nothing: update invoice status + insert payment rows in one transaction
  const applyUpdate = db.transaction(() => {
    db.prepare(
      'UPDATE direct_invoices SET status=?, notes=?, paid_at=?, updated_at=CURRENT_TIMESTAMP WHERE id=?',
    ).run(newStatus, notes ?? inv.notes, paidAt, inv.id);

    if (!becomingPaid) return;

    const today = new Date().toISOString().slice(0, 10);
    const recorder = req.session?.name || 'system';

    if (Array.isArray(allocations) && allocations.length >= 2) {
      const splitGroupId = randomUUID();
      const VALID_CLASSES = ['contract', 'pass_through_reimbursement'];
      const insertSplit = db.prepare(
        `INSERT INTO payments_received
          (job_id, customer_name, amount, date_received, payment_type, credit_debit,
           recorded_by, notes, split_group_id, payment_class, is_pass_through_reimbursement)
         VALUES (?, ?, ?, ?, 'invoice', 'credit', ?, ?, ?, ?, ?)`,
      );
      for (const alloc of allocations) {
        const payClass = VALID_CLASSES.includes(alloc.payment_class)
          ? alloc.payment_class
          : 'contract';
        insertSplit.run(
          alloc.job_id,
          inv.to_name || null,
          parseFloat(alloc.amount),
          today,
          recorder,
          alloc.notes ||
            `Split from invoice ${inv.invoice_number} — $${Number(inv.total).toFixed(2)} total`,
          splitGroupId,
          payClass,
          payClass === 'pass_through_reimbursement' ? 1 : 0,
        );
      }
    } else if (inv.job_id) {
      // Single auto-record (existing behavior)
      db.prepare(
        `INSERT INTO payments_received
          (job_id, customer_name, amount, date_received, payment_type, credit_debit, recorded_by, notes)
         VALUES (?, ?, ?, ?, 'invoice', 'credit', ?, ?)`,
      ).run(
        inv.job_id,
        inv.to_name || null,
        inv.total,
        today,
        recorder,
        `Auto-recorded from invoice ${inv.invoice_number}`,
      );
    }
  });

  applyUpdate();
  res.json({ invoice: db.prepare('SELECT * FROM direct_invoices WHERE id = ?').get(inv.id) });
});

router.delete('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const inv = db.prepare('SELECT * FROM direct_invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM direct_invoices WHERE id = ?').run(inv.id);
  res.json({ success: true });
});

router.get('/:id/pdf', requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const inv = db.prepare('SELECT * FROM direct_invoices WHERE id = ?').get(req.params.id);
    if (!inv) return res.status(404).json({ error: 'Not found' });
    const job = inv.job_id ? db.prepare('SELECT * FROM jobs WHERE id = ?').get(inv.job_id) : null;
    const contact = inv.contact_id
      ? db.prepare('SELECT * FROM contacts WHERE id = ?').get(inv.contact_id)
      : null;

    const html = buildInvoiceHTML(inv, job, contact);
    const pdfPath = await generatePDFFromHTML(
      html,
      `di_${inv.invoice_number.replace(/[^a-zA-Z0-9-]/g, '_')}`,
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${inv.invoice_number}.pdf"`);
    fs.createReadStream(pdfPath).pipe(res);
  } catch (err) {
    console.error('[DirectInvoice PDF]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/send', requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const inv = db.prepare('SELECT * FROM direct_invoices WHERE id = ?').get(req.params.id);
    if (!inv) return res.status(404).json({ error: 'Not found' });

    const toEmail = req.body.to_email || inv.to_email;
    if (!toEmail) return res.status(400).json({ error: 'No recipient email address' });

    const job = inv.job_id ? db.prepare('SELECT * FROM jobs WHERE id = ?').get(inv.job_id) : null;
    const contact = inv.contact_id
      ? db.prepare('SELECT * FROM contacts WHERE id = ?').get(inv.contact_id)
      : null;

    const html = buildInvoiceHTML(inv, job, contact);
    const pdfPath = await generatePDFFromHTML(
      html,
      `di_${inv.invoice_number.replace(/[^a-zA-Z0-9-]/g, '_')}`,
    );

    const fmt = (n) =>
      Number(n || 0).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    const toName = inv.to_name || contact?.name || job?.customer_name || 'there';
    const onlineFee = Math.round((inv.total * ONLINE_FEE_PCT + ONLINE_FEE_FLAT) * 100) / 100;

    await sendEmail({
      to: toEmail,
      subject: `Invoice ${inv.invoice_number} — Preferred Builders General Services Inc.`,
      attachmentPath: pdfPath,
      attachmentName: `${inv.invoice_number}.pdf`,
      html: `<div style="font-family:Arial,sans-serif;max-width:580px;margin:0 auto">
        <div style="background:#1B3A6B;padding:20px 24px;color:white;border-radius:8px 8px 0 0">
          <div style="font-size:17px;font-weight:700">Preferred Builders General Services Inc.</div>
          <div style="font-size:12px;opacity:.8;margin-top:4px">HIC-197400 · CSL CS-121662 · 978-377-1784</div>
        </div>
        <div style="background:white;padding:28px 24px;border:1px solid #eee;border-top:none">
          <p style="font-size:15px;color:#1B3A6B;font-weight:700;margin-bottom:12px">Hi ${toName},</p>
          <p style="color:#444;font-size:14px;line-height:1.7;margin-bottom:16px">
            Please find your invoice attached. Your invoice number is <strong>${inv.invoice_number}</strong>.
          </p>
          <div style="background:#f8f9ff;border-radius:8px;padding:16px 20px;margin-bottom:20px">
            <p style="margin:0 0 8px;font-size:13px;color:#444"><strong>Invoice #:</strong> ${inv.invoice_number}</p>
            <p style="margin:0 0 8px;font-size:13px;color:#444"><strong>Amount Due:</strong> $${fmt(inv.total)}</p>
            <p style="margin:0 0 8px;font-size:14px;color:#C62828;font-weight:700">DUE UPON RECEIPT</p>
            <p style="margin:0;font-size:12px;color:#555">Please make your check or money order payable to:<br><strong>Preferred Builders General Services Inc.</strong></p>
          </div>
          <div style="background:#f0f4ff;border:1px solid #c7d2fe;border-radius:6px;padding:14px 16px;margin-bottom:16px;font-size:12px;color:#444">
            <strong style="color:#1B3A6B">Online Payments — Coming Soon</strong><br>
            When enabled, a processing fee of 2% + $5.00 will apply (est. fee: <strong>$${fmt(onlineFee)}</strong>).
            You will be required to check a consent box before payment can be processed.
            <strong style="color:#2E7D32;display:block;margin-top:6px">Zero retention of card information after payment is processed.</strong>
          </div>
          <p style="color:#888;font-size:12px;line-height:1.6">Questions? Reply to this email or call us at <strong>978-377-1784</strong>.</p>
        </div>
        <div style="background:#f8f9ff;padding:14px 24px;font-size:10px;color:#aaa;border-radius:0 0 8px 8px;text-align:center">
          Preferred Builders General Services Inc. · 37 Duck Mill Rd, Fitchburg MA 01420 · HIC-197400
        </div>
      </div>`,
      text: `Hi ${toName},\n\nPlease find your invoice attached.\n\nInvoice #: ${inv.invoice_number}\nAmount Due: $${fmt(inv.total)}\nDUE UPON RECEIPT\n\nPlease make your check or money order payable to: Preferred Builders General Services Inc.\n\nOnline payments coming soon. Processing fee: 2% + $5.00 (est. $${fmt(onlineFee)}). Zero retention of card information after payment is processed.\n\nQuestions? Call us at 978-377-1784.\n\n— Preferred Builders General Services Inc.`,
      emailType: 'general',
      jobId: inv.job_id,
    });

    db.prepare(
      "UPDATE direct_invoices SET status='sent', issued_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?",
    ).run(inv.id);
    res.json({ invoice: db.prepare('SELECT * FROM direct_invoices WHERE id = ?').get(inv.id) });
  } catch (err) {
    console.error('[DirectInvoice Send]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
