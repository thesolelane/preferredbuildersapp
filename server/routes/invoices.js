'use strict';
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { requireFields, validateEnum, validateNumber } = require('../middleware/validate');
const { getDb } = require('../db/database');
const { logActivity } = require('./activityLog');
const { generatePDFFromHTML } = require('../services/pdfService');
const { sendInvoiceEmail } = require('../services/invoiceEmailService');

const VALID_TYPES = [
  'contract_invoice',
  'pass_through_invoice',
  'change_order',
  'combined_invoice',
];
const VALID_STATUSES = ['draft', 'sent', 'pending_send', 'paid', 'void'];

function getOrCreateCounters(db, jobId) {
  let row = db.prepare('SELECT * FROM invoice_counters WHERE job_id = ?').get(jobId);
  if (!row) {
    db.prepare('INSERT OR IGNORE INTO invoice_counters (job_id) VALUES (?)').run(jobId);
    row = db.prepare('SELECT * FROM invoice_counters WHERE job_id = ?').get(jobId);
  }
  return row;
}

function nextInvoiceNumber(db, jobId, invoiceType, quoteNumber) {
  const base = quoteNumber || jobId.slice(0, 6);
  const prefix = `PB-${base}`;

  const counters = getOrCreateCounters(db, jobId);

  if (invoiceType === 'pass_through_invoice') {
    const seq = counters.pass_through_seq + 1;
    db.prepare('UPDATE invoice_counters SET pass_through_seq = ? WHERE job_id = ?').run(seq, jobId);
    return `${prefix}-INV-PT-${String(seq).padStart(2, '0')}`;
  } else if (invoiceType === 'change_order') {
    const seq = (counters.co_seq || 0) + 1;
    db.prepare('UPDATE invoice_counters SET co_seq = ? WHERE job_id = ?').run(seq, jobId);
    return `${prefix}-CO-${String(seq).padStart(2, '0')}`;
  } else {
    const seq = counters.contract_seq + 1;
    db.prepare('UPDATE invoice_counters SET contract_seq = ? WHERE job_id = ?').run(seq, jobId);
    return `${prefix}-INV-${String(seq).padStart(2, '0')}`;
  }
}

function nextDeptCode(db, jobId, quoteNumber) {
  const base = quoteNumber || jobId.slice(0, 6);
  const counters = getOrCreateCounters(db, jobId);
  const seq = counters.dept_seq + 1;
  db.prepare('UPDATE invoice_counters SET dept_seq = ? WHERE job_id = ?').run(seq, jobId);
  return `PB-${base}-D${String(seq).padStart(2, '0')}`;
}

// GET /all — unified list of all invoices (job + direct) sorted by date
router.get('/all', requireAuth, (req, res) => {
  const db = getDb();
  const { status, job_id, date_from, date_to } = req.query;

  const jobParams = [];
  let jobWhere = '';
  if (job_id) {
    jobWhere += ' AND i.job_id = ?';
    jobParams.push(job_id);
  }
  if (status) {
    jobWhere += ' AND i.status = ?';
    jobParams.push(status);
  }
  if (date_from) {
    jobWhere += ' AND i.created_at >= ?';
    jobParams.push(date_from);
  }
  if (date_to) {
    jobWhere += ' AND i.created_at <= ?';
    jobParams.push(date_to + 'T23:59:59');
  }

  const jobInvoices = db
    .prepare(
      `
    SELECT i.id, i.invoice_number, i.invoice_type, i.status, i.amount,
           i.issued_at, i.paid_at, i.created_at, i.job_id,
           j.project_address, j.pb_number, j.customer_name, j.customer_email,
           'job' AS source
    FROM invoices i
    LEFT JOIN jobs j ON j.id = i.job_id
    WHERE 1=1 ${jobWhere}
    ORDER BY i.created_at DESC
  `,
    )
    .all(...jobParams);

  const dirParams = [];
  let dirWhere = '';
  if (job_id) {
    dirWhere += ' AND d.job_id = ?';
    dirParams.push(job_id);
  }
  if (status) {
    dirWhere += ' AND d.status = ?';
    dirParams.push(status);
  }
  if (date_from) {
    dirWhere += ' AND d.created_at >= ?';
    dirParams.push(date_from);
  }
  if (date_to) {
    dirWhere += ' AND d.created_at <= ?';
    dirParams.push(date_to + 'T23:59:59');
  }

  const directInvoices = db
    .prepare(
      `
      SELECT d.id, d.invoice_number, 'direct' AS invoice_type, d.status, d.total AS amount,
             d.issued_at, d.paid_at, d.created_at, d.job_id,
             j.project_address, j.pb_number, d.to_name AS customer_name, d.to_email AS customer_email,
             'direct' AS source
      FROM direct_invoices d
      LEFT JOIN jobs j ON j.id = d.job_id
      WHERE 1=1 ${dirWhere}
      ORDER BY d.created_at DESC
    `,
    )
    .all(...dirParams);

  const all = [...jobInvoices, ...directInvoices].sort(
    (a, b) => new Date(b.created_at) - new Date(a.created_at),
  );

  res.json({ invoices: all });
});

router.get('/job/:jobId', requireAuth, (req, res) => {
  const db = getDb();
  const { jobId } = req.params;
  const job = db.prepare('SELECT id FROM jobs WHERE id = ?').get(jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const invoices = db
    .prepare('SELECT * FROM invoices WHERE job_id = ? ORDER BY created_at ASC')
    .all(jobId);
  res.json({ invoices });
});

router.post(
  '/job/:jobId',
  requireAuth,
  requireFields(['invoice_type', 'amount']),
  validateEnum('invoice_type', VALID_TYPES),
  validateNumber('amount', { min: 0 }),
  (req, res) => {
    const db = getDb();
    const { jobId } = req.params;
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const { invoice_type, amount, notes, line_items } = req.body;

    // ── Compute amounts from line items if provided ──────────────────────────
    let items = Array.isArray(line_items) && line_items.length ? line_items : null;
    let contractAmt = 0;
    let passThroughAmt = 0;
    let totalAmt = parseFloat(amount) || 0;

    if (items) {
      items = items
        .map((li) => ({
          description: String(li.description || '').trim(),
          amount: parseFloat(li.amount) || 0,
          type: ['contract', 'pass_through'].includes(li.type) ? li.type : 'contract',
        }))
        .filter((li) => li.description || li.amount);

      for (const li of items) {
        if (li.type === 'pass_through') passThroughAmt += li.amount;
        else contractAmt += li.amount;
      }
      totalAmt = contractAmt + passThroughAmt;
    }

    // Auto-determine invoice type from line item composition
    let invType = VALID_TYPES.includes(invoice_type) ? invoice_type : 'contract_invoice';
    if (items && items.length) {
      const hasContract = items.some((li) => li.type === 'contract');
      const hasPT = items.some((li) => li.type === 'pass_through');
      if (hasContract && hasPT) invType = 'combined_invoice';
      else if (hasPT) invType = 'pass_through_invoice';
      else invType = 'contract_invoice';
    }

    const invNum = nextInvoiceNumber(db, jobId, invType, job.quote_number);

    const info = db
      .prepare(
        `
    INSERT INTO invoices
      (job_id, invoice_number, invoice_type, status, amount, contract_amount, pass_through_amount, line_items, notes)
    VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?)
  `,
      )
      .run(
        jobId,
        invNum,
        invType,
        totalAmt,
        contractAmt,
        passThroughAmt,
        items ? JSON.stringify(items) : null,
        notes || null,
      );

    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(info.lastInsertRowid);

    const contact = job.contact_id
      ? db.prepare('SELECT pb_customer_number FROM contacts WHERE id = ?').get(job.contact_id)
      : null;
    const recorder = req.session?.name || 'staff';

    logActivity({
      customer_number: contact?.pb_customer_number || null,
      job_id: jobId,
      event_type: 'INVOICE_ISSUED',
      description: `Invoice ${invNum} created (${invType.replace(/_/g, ' ')}) — $${totalAmt.toLocaleString()}`,
      document_ref: invNum,
      recorded_by: recorder,
    });

    res.json({ invoice });
  },
);

router.patch(
  '/:id',
  requireAuth,
  validateNumber('amount', { min: 0 }),
  validateNumber('amount_paid', { min: 0 }),
  (req, res) => {
    const db = getDb();
    const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });

    const { status, amount, amount_paid, notes, line_items, issued_at, paid_at, check_number } = req.body;

    const newStatus = VALID_STATUSES.includes(status) ? status : inv.status;
    const newAmount = amount !== undefined ? parseFloat(amount) : inv.amount;
    const newAmtPaid = amount_paid !== undefined ? parseFloat(amount_paid) : inv.amount_paid;

    db.prepare(
      `
    UPDATE invoices SET
      status = ?, amount = ?, amount_paid = ?, notes = ?, line_items = ?,
      issued_at = ?, paid_at = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `,
    ).run(
      newStatus,
      newAmount,
      newAmtPaid,
      notes ?? inv.notes,
      line_items !== undefined ? (line_items ? JSON.stringify(line_items) : null) : inv.line_items,
      issued_at ?? inv.issued_at,
      paid_at ?? inv.paid_at,
      inv.id,
    );

    const editChanges = [];
    if (newStatus !== inv.status && newStatus !== 'paid') editChanges.push(`status → ${newStatus}`);
    if (Math.abs(newAmount - inv.amount) > 0.001)
      editChanges.push(`amount → $${newAmount.toFixed(2)}`);
    if (notes !== undefined && notes !== inv.notes) editChanges.push('notes updated');
    if (editChanges.length > 0) {
      const editJob = db.prepare('SELECT * FROM jobs WHERE id = ?').get(inv.job_id);
      const editContact = editJob?.contact_id
        ? db.prepare('SELECT pb_customer_number FROM contacts WHERE id = ?').get(editJob.contact_id)
        : null;
      logActivity({
        customer_number: editContact?.pb_customer_number || null,
        job_id: inv.job_id,
        event_type: 'INVOICE_UPDATED',
        description: `Invoice ${inv.invoice_number} edited — ${editChanges.join(', ')}`,
        document_ref: inv.invoice_number,
        recorded_by: req.session?.name || 'staff',
      });
    }

    if (newStatus === 'paid' && inv.status !== 'paid') {
      const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(inv.job_id);
      const contact = job?.contact_id
        ? db.prepare('SELECT pb_customer_number FROM contacts WHERE id = ?').get(job.contact_id)
        : null;

      logActivity({
        customer_number: contact?.pb_customer_number || null,
        job_id: inv.job_id,
        event_type:
          inv.invoice_type === 'pass_through_invoice'
            ? 'PASS_THROUGH_REIMBURSED'
            : 'PAYMENT_RECEIVED',
        description: `Invoice ${inv.invoice_number} marked paid — $${newAmtPaid.toLocaleString()}`,
        document_ref: inv.invoice_number,
        recorded_by: req.session?.name || 'staff',
      });

      // Auto-create a payments_received record if no matching record already exists
      if (inv.job_id) {
        const existing = db
          .prepare(
            "SELECT id FROM payments_received WHERE invoice_id = ? OR (job_id = ? AND ABS(amount - ?) < 0.01 AND credit_debit = 'credit' AND (invoice_id IS NULL OR invoice_id = ?)) LIMIT 1",
          )
          .get(inv.id, inv.job_id, newAmount, inv.id);
        if (!existing) {
          const today = new Date().toISOString().slice(0, 10);
          const recorder = req.session?.name || 'system';
          const invoiceTypeToPaymentType = {
            contract_invoice: 'progress',
            pass_through_invoice: 'other',
            change_order: 'progress',
            combined_invoice: 'progress',
          };
          const autoPaymentType = invoiceTypeToPaymentType[inv.invoice_type] || 'progress';
          db.prepare(
            `INSERT INTO payments_received
              (job_id, customer_name, amount, date_received, payment_type, credit_debit,
               recorded_by, notes, invoice_id, check_number)
             VALUES (?, ?, ?, ?, ?, 'credit', ?, ?, ?, ?)`,
          ).run(
            inv.job_id,
            job?.customer_name || null,
            newAmount,
            today,
            autoPaymentType,
            recorder,
            `Auto-recorded from invoice ${inv.invoice_number} marked paid`,
            inv.id,
            check_number || null,
          );
        }
      }
    }

    const updated = db.prepare('SELECT * FROM invoices WHERE id = ?').get(inv.id);
    res.json({ invoice: updated });
  },
);

// PATCH /:id/pay-direct — toggle pay_direct flag on a specific line item, recompute pb_due_amount
router.patch('/:id/pay-direct', requireAuth, (req, res) => {
  const db = getDb();
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });

  const { line_item_index, pay_direct, pay_direct_received } = req.body;
  if (line_item_index === undefined)
    return res.status(400).json({ error: 'line_item_index required' });

  let items = [];
  try {
    items = inv.line_items ? JSON.parse(inv.line_items) : [];
  } catch {
    /* ignore */
  }
  if (line_item_index < 0 || line_item_index >= items.length) {
    return res.status(400).json({ error: 'line_item_index out of range' });
  }

  if (pay_direct !== undefined) items[line_item_index].pay_direct = !!pay_direct;
  if (pay_direct_received !== undefined)
    items[line_item_index].pay_direct_received = !!pay_direct_received;

  // Recompute pb_due_amount: sum of items where pay_direct is false
  const newPbDue = items.filter((li) => !li.pay_direct).reduce((s, li) => s + (li.amount || 0), 0);

  db.prepare(
    'UPDATE invoices SET line_items = ?, pb_due_amount = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
  ).run(JSON.stringify(items), newPbDue, inv.id);

  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(inv.job_id);
  const contact = job?.contact_id
    ? db.prepare('SELECT pb_customer_number FROM contacts WHERE id = ?').get(job.contact_id)
    : null;
  const item = items[line_item_index];
  logActivity({
    customer_number: contact?.pb_customer_number || null,
    job_id: inv.job_id,
    event_type: 'INVOICE_UPDATED',
    description: `Invoice ${inv.invoice_number} line item "${item.description}" marked ${item.pay_direct ? 'Pay Direct' : 'Pay to PB'}${item.pay_direct_received ? ' (received)' : ''}`,
    document_ref: inv.invoice_number,
    recorded_by: req.session?.name || 'staff',
  });

  const updated = db.prepare('SELECT * FROM invoices WHERE id = ?').get(inv.id);
  res.json({ invoice: updated });
});

router.delete('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  db.prepare('DELETE FROM invoices WHERE id = ?').run(inv.id);
  res.json({ success: true });
});

// GET /:id/pdf — generate and stream a simple invoice PDF
router.get('/:id/pdf', requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });

    const job = inv.job_id ? db.prepare('SELECT * FROM jobs WHERE id = ?').get(inv.job_id) : null;
    const contact = job?.contact_id
      ? db.prepare('SELECT * FROM contacts WHERE id = ?').get(job.contact_id)
      : null;

    const typeLabels = {
      contract_invoice: 'Contract Invoice',
      pass_through_invoice: 'Pass-Through Invoice',
      change_order: 'Change Order',
      combined_invoice: 'Invoice',
    };
    const typeLabel = typeLabels[inv.invoice_type] || 'Invoice';
    const isPT = inv.invoice_type === 'pass_through_invoice';
    const isCombined = inv.invoice_type === 'combined_invoice';
    const fmt = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2 });

    // Parse stored line items (from the new multi-line system)
    let storedItems = [];
    try {
      storedItems = inv.line_items ? JSON.parse(inv.line_items) : [];
    } catch {
      /* ignore */
    }

    // Build itemized line items HTML — shows pay_direct status when present
    const buildLineItemsHTML = () => {
      if (!storedItems.length) return '';
      const hasPayDirect = storedItems.some(
        (li) => li.type === 'pass_through' && li.pay_direct !== undefined,
      );
      const grandTotal = storedItems.reduce((s, li) => s + (li.amount || 0), 0);
      const pbDue =
        inv.pb_due_amount > 0
          ? inv.pb_due_amount
          : storedItems.filter((li) => !li.pay_direct).reduce((s, li) => s + (li.amount || 0), 0);

      let html = `<div class="section"><h3>Invoice Line Items</h3>
<table style="width:100%;border-collapse:collapse;font-size:12px">
  <tr style="background:#1B3A6B;color:white">
    <th style="text-align:left;padding:7px 10px;font-size:10px">#</th>
    <th style="text-align:left;padding:7px 10px;font-size:10px">Description</th>
    <th style="text-align:center;padding:7px 10px;font-size:10px">Payment</th>
    <th style="text-align:right;padding:7px 10px;font-size:10px">Amount</th>
  </tr>`;

      storedItems.forEach((li, i) => {
        const isPtRow = li.type === 'pass_through';
        const isPayDirect = !!li.pay_direct;
        const isReceived = !!li.pay_direct_received;
        let badge;
        if (isPtRow && isPayDirect) {
          badge = isReceived
            ? `<span style="background:#dcfce7;color:#16a34a;border:1px solid #86efac;padding:2px 7px;border-radius:10px;font-size:9px;font-weight:bold">Pay Direct ✓ Received</span>`
            : `<span style="background:#fef3c7;color:#b45309;border:1px solid #fcd34d;padding:2px 7px;border-radius:10px;font-size:9px;font-weight:bold">Pay Direct — Pending</span>`;
        } else if (isPtRow) {
          badge = `<span style="background:#fffbeb;color:#92400e;border:1px solid #fbbf24;padding:2px 7px;border-radius:10px;font-size:9px;font-weight:bold">Pass-Through</span>`;
        } else {
          badge = `<span style="background:#f0f4ff;color:#1B3A6B;border:1px solid #93c5fd;padding:2px 7px;border-radius:10px;font-size:9px;font-weight:bold">Deposit</span>`;
        }
        const rowBg = isPtRow && isPayDirect ? '#f0fdf4' : isPtRow ? '#fffef5' : '#ffffff';
        html += `<tr style="background:${rowBg};border-bottom:1px solid #eee">
    <td style="padding:7px 10px;color:#888;font-size:11px">${i + 1}</td>
    <td style="padding:7px 10px;color:#222;font-size:12px">${li.description || '—'}</td>
    <td style="padding:7px 10px;text-align:center">${badge}</td>
    <td style="padding:7px 10px;text-align:right;font-weight:600;font-size:12px;${isPayDirect && !isReceived ? 'color:#888;text-decoration:line-through' : ''}">$${fmt(li.amount)}</td>
  </tr>`;
      });

      html += `<tr style="background:#f0f0f0;border-top:1px solid #ddd">
    <td colspan="3" style="padding:7px 10px;font-size:11px;color:#555;font-weight:600">Invoice Total</td>
    <td style="padding:7px 10px;text-align:right;font-weight:700;color:#333;font-size:12px">$${fmt(grandTotal)}</td>
  </tr>
  <tr style="background:#1B3A6B;color:white">
    <td colspan="3" style="padding:9px 10px;font-weight:bold;font-size:13px">Amount Due to Preferred Builders</td>
    <td style="padding:9px 10px;text-align:right;font-weight:bold;font-size:15px">$${fmt(pbDue)}</td>
  </tr>`;

      html += `</table>`;
      if (hasPayDirect) {
        html += `<p style="font-size:11px;color:#92400e;margin:8px 0 0;background:#fffbeb;padding:8px 12px;border-radius:4px;border-left:3px solid #f59e0b">Items marked <strong>Pay Direct</strong> are paid by the client directly to the permit office or design professional. Strikethrough amounts are excluded from the balance due to Preferred Builders.</p>`;
      }
      html += `</div>`;
      return html;
    };

    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: Arial, sans-serif; margin: 0; padding: 40px; color: #222; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; }
  .logo-block h1 { color: #1B3A6B; margin: 0; font-size: 22px; }
  .logo-block p  { color: #888; margin: 4px 0; font-size: 12px; }
  .inv-meta { text-align: right; }
  .inv-meta .inv-num { font-size: 20px; font-weight: bold; color: #1B3A6B; }
  .inv-meta .status  { font-size: 12px; color: #888; }
  .divider { border: none; border-top: 2px solid #E07B2A; margin: 16px 0; }
  .section { margin-bottom: 24px; }
  .section h3 { font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }
  .amount-box { background: #f8f9ff; border: 2px solid #1B3A6B; border-radius: 8px; padding: 20px; text-align: center; margin: 24px 0; }
  .amount-box .amt { font-size: 36px; font-weight: bold; color: #1B3A6B; }
  .amount-box .lbl { font-size: 12px; color: #888; }
  .pt-notice { background: #fffbeb; border: 1px solid #fbbf24; border-radius: 6px; padding: 12px; font-size: 12px; color: #92400e; margin-bottom: 16px; }
  .footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid #eee; font-size: 11px; color: #888; text-align: center; }
</style></head>
<body>
<div class="header">
  <div class="logo-block">
    <h1>PREFERRED BUILDERS</h1>
    <p>General Services Inc.</p>
    <p>978-377-1784 | Fitchburg, MA</p>
    <p>License #CS-109171</p>
  </div>
  <div class="inv-meta">
    <div class="inv-num">${inv.invoice_number}</div>
    <div class="status">${typeLabel}</div>
    <div class="status">Status: <strong>${(inv.status || 'draft').toUpperCase()}</strong></div>
    <div class="status">Issued: ${inv.created_at ? new Date(inv.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '—'}</div>
  </div>
</div>
<hr class="divider">

${isPT || isCombined ? `<div class="pt-notice"><strong>${isCombined ? 'COMBINED INVOICE — CONTAINS PASS-THROUGH ITEMS' : 'PASS-THROUGH COST — NOT A REVENUE ITEM'}</strong><br>${isCombined ? 'This invoice includes both contract charges (revenue to Preferred Builders) and pass-through reimbursement costs (not income to PB). Totals are broken out below.' : 'This invoice covers costs paid by Preferred Builders on behalf of the customer (permits, engineers, consultants, etc.) and is billed for direct reimbursement only.'}</div>` : ''}

${
  contact || job
    ? `<div class="section">
  <h3>Billed To</h3>
  ${contact?.pb_customer_number ? `<div style="font-family:monospace;font-size:11px;background:#e0e8ff;color:#1B3A6B;padding:2px 8px;border-radius:4px;display:inline-block;margin-bottom:6px;font-weight:bold">${contact.pb_customer_number}</div><br>` : ''}
  <strong>${contact?.name || job?.customer_name || '—'}</strong><br>
  ${contact?.email || job?.customer_email || ''}${contact?.email || job?.customer_email ? '<br>' : ''}
  ${contact?.phone || job?.customer_phone || ''}${contact?.phone || job?.customer_phone ? '<br>' : ''}
  ${[contact?.address || '', contact?.city || job?.project_city || '', contact?.state || 'MA'].filter(Boolean).join(', ') || job?.project_address || ''}
</div>`
    : ''
}

${
  job
    ? `<div class="section">
  <h3>Project</h3>
  ${job.pb_number || job.quote_number ? `<strong>PB# ${job.pb_number || job.quote_number}</strong><br>` : ''}
  ${job.project_address || ''}${job.project_city ? ', ' + job.project_city + ', MA' : ''}
</div>`
    : ''
}

${buildLineItemsHTML()}

${
  !storedItems.length
    ? `<div class="amount-box">
  <div class="lbl">Invoice Amount</div>
  <div class="amt">$${fmt(inv.amount)}</div>
  ${inv.amount_paid > 0 ? `<div class="lbl" style="margin-top:8px;color:#2E7D32">Paid: $${fmt(inv.amount_paid)}</div>` : ''}
</div>`
    : `<div class="amount-box" style="border-color:${isCombined ? '#E07B2A' : isPT ? '#f59e0b' : '#1B3A6B'}">
  ${isCombined && inv.contract_amount > 0 ? `<div style="font-size:13px;color:#555;margin-bottom:4px">Contract Charges: <strong style="color:#1B3A6B">$${fmt(inv.contract_amount)}</strong></div>` : ''}
  ${isCombined && inv.pass_through_amount > 0 ? `<div style="font-size:13px;color:#555;margin-bottom:8px">Pass-Through Costs: <strong style="color:#92400e">$${fmt(inv.pass_through_amount)}</strong></div>` : ''}
  <div class="lbl">Total Due</div>
  <div class="amt" style="color:${isCombined ? '#E07B2A' : isPT ? '#92400e' : '#1B3A6B'}">$${fmt(inv.amount)}</div>
  ${inv.amount_paid > 0 ? `<div class="lbl" style="margin-top:8px;color:#2E7D32">Paid: $${fmt(inv.amount_paid)}</div>` : ''}
</div>`
}

${inv.notes ? `<div class="section"><h3>Notes</h3><p style="font-size:13px">${inv.notes}</p></div>` : ''}

<div class="footer">
  Preferred Builders General Services Inc. · MA License #CS-109171 · 978-377-1784<br>
  Please make your check or money order payable to: <strong>Preferred Builders General Services Inc.</strong>
</div>
</body></html>`;

    const pdfPath = await generatePDFFromHTML(
      html,
      `invoice_${inv.invoice_number.replace(/[^a-zA-Z0-9-]/g, '_')}`,
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${inv.invoice_number}.pdf"`);
    const fs = require('fs');
    fs.createReadStream(pdfPath).pipe(res);
  } catch (err) {
    console.error('[Invoice PDF]', err.message);
    res.status(500).json({ error: 'PDF generation failed: ' + err.message });
  }
});

// POST /:id/pdf — generate invoice PDF (alias for GET; supports clients expecting POST)
router.post('/:id/pdf', requireAuth, (req, res) => {
  // Redirect to GET which streams the PDF (preserves token from header or body)
  const token = req.query.token || req.body?.token || '';
  res.redirect(307, `/api/invoices/${req.params.id}/pdf?token=${encodeURIComponent(token)}`);
});

// POST /:id/email — email invoice PDF to customer (uses shared invoiceEmailService)
router.post('/:id/email', requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const inv = db.prepare('SELECT id FROM invoices WHERE id = ?').get(req.params.id);
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    const result = await sendInvoiceEmail(inv.id, db, req.session?.name || 'staff');
    res.json(result);
  } catch (err) {
    console.error('[Invoice Email]', err.message);
    res.status(500).json({ error: 'Failed to email invoice: ' + err.message });
  }
});

module.exports = { router, nextInvoiceNumber, nextDeptCode };
