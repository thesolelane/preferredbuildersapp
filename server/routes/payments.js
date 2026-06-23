'use strict';
const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { requireFields, validateNumber } = require('../middleware/validate');
const { getDb } = require('../db/database');
const { logAudit } = require('../services/auditService');
const { logActivity } = require('./activityLog');

const VALID_PAYMENT_TYPES = ['deposit', 'progress', 'final', 'other'];
const VALID_CREDIT_DEBIT = ['credit', 'debit'];
const VALID_PAYMENT_CLASS_OUT = ['cost_of_revenue', 'pass_through'];

function signedSum(rows, amountCol, defaultSign) {
  return rows.reduce((sum, r) => {
    const amt = Number(r[amountCol]) || 0;
    const sign = r.credit_debit || defaultSign;
    return sum + (sign === defaultSign ? amt : -amt);
  }, 0);
}

function jobSummary(db, jobId) {
  const recRows = db
    .prepare(
      'SELECT amount, credit_debit, is_pass_through_reimbursement FROM payments_received WHERE job_id = ?',
    )
    .all(jobId);
  const paidRows = db
    .prepare('SELECT amount, credit_debit, payment_class FROM payments_made WHERE job_id = ?')
    .all(jobId);

  const contractRecRows = recRows.filter((r) => !r.is_pass_through_reimbursement);
  const ptRecRows = recRows.filter((r) => r.is_pass_through_reimbursement);
  const costRows = paidRows.filter((r) => r.payment_class === 'cost_of_revenue');
  const ptOutRows = paidRows.filter((r) => r.payment_class === 'pass_through');

  const contractReceived = signedSum(contractRecRows, 'amount', 'credit');
  const ptReimbursed = signedSum(ptRecRows, 'amount', 'credit');
  const totalIn = contractReceived + ptReimbursed;

  const subMaterialCosts = signedSum(costRows, 'amount', 'debit');
  const ptAdvances = signedSum(ptOutRows, 'amount', 'debit');
  const totalOut = subMaterialCosts + ptAdvances;

  const netMargin = contractReceived - subMaterialCosts;

  const invRow = db
    .prepare(
      `SELECT COALESCE(SUM(amt), 0) AS total FROM (
        SELECT amount AS amt FROM invoices WHERE job_id = ? AND status NOT IN ('void')
        UNION ALL
        SELECT total  AS amt FROM direct_invoices WHERE job_id = ? AND status NOT IN ('void')
      )`,
    )
    .get(jobId, jobId);
  const invoicedTotal = Number(invRow?.total || 0);

  return {
    total_received: totalIn,
    total_paid_out: totalOut,
    balance: totalIn - totalOut,
    contract_received: contractReceived,
    pt_reimbursed: ptReimbursed,
    sub_material_costs: subMaterialCosts,
    pt_advances: ptAdvances,
    net_margin: netMargin,
    invoiced_total: invoicedTotal,
  };
}

function validateAmount(amount) {
  const n = parseFloat(amount);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function currentTime() {
  return new Date()
    .toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'America/New_York',
    })
    .slice(0, 5);
}

router.get('/summary/:jobId', requireAuth, (req, res) => {
  const db = getDb();
  const { jobId } = req.params;
  const job = db.prepare('SELECT id FROM jobs WHERE id = ?').get(jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(jobSummary(db, jobId));
});

router.get('/received', requireAuth, (req, res) => {
  const db = getDb();
  const { job_id, date_from, date_to, customer } = req.query;
  let sql = `
    SELECT r.*, j.customer_name as job_customer, j.project_address
    FROM payments_received r
    LEFT JOIN jobs j ON j.id = r.job_id
    WHERE 1=1
  `;
  const params = [];
  if (job_id) {
    sql += ' AND r.job_id = ?';
    params.push(job_id);
  }
  if (date_from) {
    sql += ' AND r.date_received >= ?';
    params.push(date_from);
  }
  if (date_to) {
    sql += ' AND r.date_received <= ?';
    params.push(date_to);
  }
  if (customer) {
    sql += ' AND (r.customer_name LIKE ? OR j.customer_name LIKE ?)';
    params.push(`%${customer}%`, `%${customer}%`);
  }
  sql += ' ORDER BY r.date_received DESC, r.created_at DESC';
  res.json({ payments: db.prepare(sql).all(...params) });
});

router.get('/made', requireAuth, (req, res) => {
  const db = getDb();
  const { job_id, date_from, date_to, customer } = req.query;
  let sql = `
    SELECT m.*, j.customer_name as job_customer, j.project_address
    FROM payments_made m
    LEFT JOIN jobs j ON j.id = m.job_id
    WHERE 1=1
  `;
  const params = [];
  if (job_id) {
    sql += ' AND m.job_id = ?';
    params.push(job_id);
  }
  if (date_from) {
    sql += ' AND m.date_paid >= ?';
    params.push(date_from);
  }
  if (date_to) {
    sql += ' AND m.date_paid <= ?';
    params.push(date_to);
  }
  if (customer) {
    sql += ' AND (m.payee_name LIKE ? OR j.customer_name LIKE ?)';
    params.push(`%${customer}%`, `%${customer}%`);
  }
  sql += ' ORDER BY m.date_paid DESC, m.created_at DESC';
  res.json({ payments: db.prepare(sql).all(...params) });
});

router.get('/job/:jobId', requireAuth, (req, res) => {
  const db = getDb();
  const { jobId } = req.params;
  const received = db
    .prepare('SELECT * FROM payments_received WHERE job_id = ? ORDER BY date_received DESC')
    .all(jobId);
  const made = db
    .prepare('SELECT * FROM payments_made     WHERE job_id = ? ORDER BY date_paid     DESC')
    .all(jobId);
  res.json({ received, made, summary: jobSummary(db, jobId) });
});

router.get('/split-siblings/:splitGroupId', requireAuth, (req, res) => {
  const db = getDb();
  const { splitGroupId } = req.params;
  const siblings = db
    .prepare(
      `SELECT r.id, r.job_id, r.amount, r.credit_debit, r.payment_class,
              r.is_pass_through_reimbursement, r.notes,
              j.customer_name AS job_customer, j.project_address
       FROM payments_received r
       LEFT JOIN jobs j ON j.id = r.job_id
       WHERE r.split_group_id = ?
       ORDER BY r.amount DESC`,
    )
    .all(splitGroupId);
  res.json({ siblings });
});

router.get('/contact/:contactId', requireAuth, (req, res) => {
  const db = getDb();
  const { contactId } = req.params;
  const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(contactId);
  if (!contact) return res.status(404).json({ error: 'Contact not found' });

  const jobs = db
    .prepare(
      `
    SELECT id, customer_name, project_address, total_value, status
    FROM jobs WHERE archived = 0 AND (
      (customer_email IS NOT NULL AND customer_email = ?) OR
      (customer_phone IS NOT NULL AND customer_phone = ?) OR
      (customer_name IS NOT NULL AND customer_name = ?)
    )
  `,
    )
    .all(contact.email || '', contact.phone || '', contact.name || '');

  const jobIds = jobs.map((j) => j.id);
  if (jobIds.length === 0) {
    return res.json({
      received: [],
      made: [],
      summary: { total_received: 0, total_paid_out: 0, balance: 0 },
      jobs: [],
    });
  }

  const ph = jobIds.map(() => '?').join(',');
  const received = db
    .prepare(
      `
    SELECT r.*, j.project_address, j.customer_name as job_customer
    FROM payments_received r
    LEFT JOIN jobs j ON j.id = r.job_id
    WHERE r.job_id IN (${ph}) ORDER BY r.date_received DESC
  `,
    )
    .all(...jobIds);
  const made = db
    .prepare(
      `
    SELECT m.*, j.project_address, j.customer_name as job_customer
    FROM payments_made m
    LEFT JOIN jobs j ON j.id = m.job_id
    WHERE m.job_id IN (${ph}) ORDER BY m.date_paid DESC
  `,
    )
    .all(...jobIds);

  const recTotal = signedSum(received, 'amount', 'credit');
  const madeTotal = signedSum(made, 'amount', 'debit');

  res.json({
    received,
    made,
    summary: { total_received: recTotal, total_paid_out: madeTotal, balance: recTotal - madeTotal },
    jobs,
  });
});

router.post('/received/split', requireAuth, (req, res) => {
  const db = getDb();
  const {
    total_amount,
    date_received,
    time_received,
    check_number,
    customer_name,
    payment_type,
    credit_debit,
    allocations,
  } = req.body;

  if (payment_type === 'deposit') {
    return res.status(400).json({ error: 'Deposit payments cannot be split across jobs' });
  }
  if (!Array.isArray(allocations) || allocations.length < 2) {
    return res
      .status(400)
      .json({ error: 'At least 2 allocations are required for a split payment' });
  }
  if (!date_received) {
    return res.status(400).json({ error: 'date_received is required' });
  }

  const parsedTotal = validateAmount(total_amount);
  if (parsedTotal === null) {
    return res.status(400).json({ error: 'total_amount must be a positive number' });
  }

  const allocSum =
    Math.round(allocations.reduce((s, a) => s + (parseFloat(a.amount) || 0), 0) * 100) / 100;
  if (Math.abs(allocSum - parsedTotal) > 0.02) {
    return res.status(400).json({
      error: `Allocation total ($${allocSum.toFixed(2)}) does not match payment total ($${parsedTotal.toFixed(2)})`,
    });
  }

  for (const alloc of allocations) {
    if (!alloc.job_id) return res.status(400).json({ error: 'Each allocation must have a job_id' });
    const job = db.prepare('SELECT id FROM jobs WHERE id = ?').get(alloc.job_id);
    if (!job) return res.status(404).json({ error: `Job not found: ${alloc.job_id}` });
    const allocAmt = parseFloat(alloc.amount) || 0;
    if (allocAmt <= 0)
      return res.status(400).json({ error: 'Each allocation amount must be positive' });
  }

  const pType = VALID_PAYMENT_TYPES.includes(payment_type) ? payment_type : 'progress';
  const crDr = VALID_CREDIT_DEBIT.includes(credit_debit) ? credit_debit : 'credit';
  const recorder = req.session?.name || 'Unknown';
  const timeVal = time_received || currentTime();
  const { randomUUID } = require('crypto');
  const splitGroupId = randomUUID();

  const paidDateLabel = new Date(date_received + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const insertStmt = db.prepare(
    `INSERT INTO payments_received
      (job_id, customer_name, check_number, amount, date_received, time_received,
       payment_type, credit_debit, recorded_by, notes, payment_class,
       is_pass_through_reimbursement, split_group_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const results = db.transaction(() => {
    const rows = [];
    for (const alloc of allocations) {
      const allocAmt = Math.round((parseFloat(alloc.amount) || 0) * 100) / 100;
      const isPTR = alloc.payment_class === 'pass_through_reimbursement' ? 1 : 0;
      const pClass = isPTR ? 'pass_through_reimbursement' : 'contract';
      const splitNote =
        `Split payment — $${parsedTotal.toLocaleString()} received ${paidDateLabel}, ` +
        `$${allocAmt.toLocaleString('en-US', { minimumFractionDigits: 2 })} allocated here` +
        (alloc.notes ? '. ' + alloc.notes : '');
      const info = insertStmt.run(
        alloc.job_id,
        customer_name || null,
        check_number || null,
        allocAmt,
        date_received,
        timeVal,
        pType,
        crDr,
        recorder,
        splitNote,
        pClass,
        isPTR,
        splitGroupId,
      );
      rows.push(
        db.prepare('SELECT * FROM payments_received WHERE id = ?').get(info.lastInsertRowid),
      );
    }
    return rows;
  })();

  for (const row of results) {
    const rowJob = db.prepare('SELECT contact_id FROM jobs WHERE id = ?').get(row.job_id);
    const contact = rowJob?.contact_id
      ? db.prepare('SELECT pb_customer_number FROM contacts WHERE id = ?').get(rowJob.contact_id)
      : null;
    logAudit(
      row.job_id,
      'payment_received',
      `Split check: $${row.amount} of $${parsedTotal} total (${pType})${check_number ? ' check #' + check_number : ''} recorded by ${recorder}`,
      recorder,
    );
    logActivity({
      customer_number: contact?.pb_customer_number || null,
      job_id: row.job_id,
      event_type: 'PAYMENT_RECEIVED',
      description:
        `Split payment: $${row.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })} ` +
        `of $${parsedTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })} total allocated here (${pType})` +
        (check_number ? ' check #' + check_number : ''),
      recorded_by: recorder,
    });
  }

  res.json({ success: true, payments: results, split_group_id: splitGroupId });
});

router.post(
  '/received',
  requireAuth,
  requireFields(['job_id', 'amount', 'date_received']),
  validateNumber('amount', { min: 0.01 }),
  (req, res) => {
    const db = getDb();
    const {
      job_id,
      customer_name,
      check_number,
      amount,
      date_received,
      time_received,
      payment_type,
      credit_debit,
      notes,
      is_pass_through_reimbursement,
      invoice_id,
    } = req.body;
    const parsedAmount = validateAmount(amount);
    if (parsedAmount === null)
      return res.status(400).json({ error: 'amount must be a positive number' });

    const pType = VALID_PAYMENT_TYPES.includes(payment_type) ? payment_type : 'deposit';
    const crDr = VALID_CREDIT_DEBIT.includes(credit_debit) ? credit_debit : 'credit';
    const isPTR = is_pass_through_reimbursement ? 1 : 0;
    const pClass = isPTR ? 'pass_through_reimbursement' : 'contract';

    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(job_id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const recorder = req.session?.name || 'Unknown';
    const timeVal = time_received || currentTime();

    const info = db
      .prepare(
        `
    INSERT INTO payments_received (job_id, customer_name, check_number, amount, date_received, time_received, payment_type, credit_debit, recorded_by, notes, payment_class, is_pass_through_reimbursement, invoice_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
      )
      .run(
        job_id,
        customer_name || null,
        check_number || null,
        parsedAmount,
        date_received,
        timeVal,
        pType,
        crDr,
        recorder,
        notes || null,
        pClass,
        isPTR,
        invoice_id || null,
      );

    const payment = db
      .prepare('SELECT * FROM payments_received WHERE id = ?')
      .get(info.lastInsertRowid);
    logAudit(
      job_id,
      'payment_received',
      `Check received: $${amount} (${payment_type || 'deposit'}, ${credit_debit || 'credit'}) recorded by ${recorder}`,
      recorder,
    );

    const contact = job.contact_id
      ? db.prepare('SELECT pb_customer_number FROM contacts WHERE id = ?').get(job.contact_id)
      : null;
    logActivity({
      customer_number: contact?.pb_customer_number || null,
      job_id,
      event_type: isPTR ? 'PASS_THROUGH_REIMBURSED' : 'PAYMENT_RECEIVED',
      description: `${isPTR ? 'Pass-through reimbursement' : 'Payment'} received: $${parsedAmount.toLocaleString()} (${pType})${check_number ? ' check #' + check_number : ''}`,
      recorded_by: recorder,
    });

    // When final payment is recorded, void all open signing sessions — job is complete
    if (pType === 'final') {
      db.prepare(
        "UPDATE signing_sessions SET status = 'void' WHERE job_id = ? AND status != 'signed'",
      ).run(job_id);
      logAudit(
        job_id,
        'signing_sessions_voided',
        'Signing links voided — final payment recorded',
        recorder,
      );
    }

    // Sync: if a matching outstanding invoice exists for this job, mark it paid.
    // Matching rules:
    //   1. Invoice must be unpaid (draft, sent, or pending_send)
    //   2. Payment amount must be within 2% or $25 of the invoice amount (whichever is larger)
    //      — handles rounding differences and small overpayments on deposits
    if (!isPTR && crDr === 'credit') {
      try {
        const openInvoices = db
          .prepare(
            "SELECT id, invoice_number, amount FROM invoices WHERE job_id = ? AND status IN ('draft', 'sent', 'pending_send') ORDER BY issued_at ASC",
          )
          .all(job_id);

        const tolerance = Math.max(25, parsedAmount * 0.02);
        const matchingInv = openInvoices.find(
          (inv) => Math.abs(inv.amount - parsedAmount) <= tolerance,
        );

        if (matchingInv) {
          const invPaidAt = date_received || new Date().toISOString().slice(0, 10);
          db.prepare(
            "UPDATE invoices SET status = 'paid', paid_at = ?, amount_paid = ? WHERE id = ?",
          ).run(invPaidAt, parsedAmount, matchingInv.id);
          db.prepare(
            'UPDATE payments_received SET invoice_id = ? WHERE id = ? AND invoice_id IS NULL',
          ).run(matchingInv.id, payment.id);
          console.log(
            `[PaymentSync] Invoice ${matchingInv.invoice_number} (${matchingInv.amount}) linked to payment ${payment.id} (${parsedAmount})`,
          );
        }
      } catch (syncErr) {
        console.warn('[PaymentSync]', syncErr.message);
      }
    }

    res.json({ payment, summary: jobSummary(db, job_id) });

    // After responding, send deposit confirmation email if contract is signed
    setImmediate(async () => {
      try {
        const fullJob = db.prepare('SELECT * FROM jobs WHERE id = ?').get(job_id);
        if (!fullJob?.customer_email) return;
        if (
          !['contract_sent', 'contract_signed', 'in_progress', 'completed'].includes(fullJob.status)
        )
          return;

        const { sendEmail } = require('../services/emailService');
        const { mergePDFs } = require('../services/pdfMergeService');
        const paidAmount = `$${Number(parsedAmount).toLocaleString()}`;
        const paidWhen = new Date().toLocaleString('en-US', {
          dateStyle: 'long',
          timeStyle: 'short',
          timeZone: 'America/New_York',
        });
        const pTypeLabel =
          {
            deposit: 'Deposit',
            progress: 'Progress Payment',
            final: 'Final Payment',
            other: 'Payment',
          }[pType] || 'Payment';
        const safeName = (fullJob.customer_name || job_id)
          .replace(/\s+/g, '-')
          .replace(/[^a-zA-Z0-9-]/g, '');

        let mergedPdfPath = fullJob.contract_pdf_path;
        try {
          mergedPdfPath = await mergePDFs(
            [fullJob.proposal_pdf_path, fullJob.contract_pdf_path],
            `pb-payment-${job_id}.pdf`,
          );
        } catch (mergeErr) {
          console.warn('[PaymentEmail] PDF merge failed, using contract only:', mergeErr.message);
        }

        // Auto-save completed file to signed contracts folder (Windows server)
        const contractsDir = process.env.SIGNED_CONTRACTS_DIR;
        if (contractsDir && mergedPdfPath) {
          try {
            const fsSync = require('fs');
            const pathLib = require('path');
            if (!fsSync.existsSync(contractsDir))
              fsSync.mkdirSync(contractsDir, { recursive: true });
            const dateStamp = new Date().toISOString().slice(0, 10);
            const destName = `Preferred-Builders-COMPLETED-${safeName}-${dateStamp}.pdf`;
            const destPath = pathLib.join(contractsDir, destName);
            fsSync.copyFileSync(mergedPdfPath, destPath);
            console.log(`[SignedContracts] Payment-confirmed file saved: ${destPath}`);
          } catch (saveErr) {
            console.warn(
              '[SignedContracts] Failed to save payment-confirmed file:',
              saveErr.message,
            );
          }
        }

        await sendEmail({
          to: fullJob.customer_email,
          subject: `Payment Received — Preferred Builders (${pTypeLabel} ${paidAmount})`,
          attachmentPath: mergedPdfPath,
          attachmentName: `Preferred-Builders-Contract-and-Proposal-${safeName}.pdf`,
          html: `<div style="font-family:Arial,sans-serif;max-width:580px;margin:0 auto">
          <div style="background:#1B3A6B;padding:20px 24px;color:white;border-radius:8px 8px 0 0">
            <div style="font-size:17px;font-weight:700">Preferred Builders General Services Inc.</div>
            <div style="font-size:12px;opacity:.8;margin-top:4px">HIC-197400 · CSL CS-121662 · 978-377-1784</div>
          </div>
          <div style="background:white;padding:28px 24px;border:1px solid #eee;border-top:none">
            <p style="font-size:15px;color:#1B3A6B;font-weight:700;margin-bottom:12px">Hi ${fullJob.customer_name || 'there'},</p>
            <p style="color:#444;font-size:14px;line-height:1.7;margin-bottom:16px">
              We have received your payment — thank you! Your project at <strong>${fullJob.project_address}${fullJob.project_city ? ', ' + fullJob.project_city : ''}</strong>
              is now officially confirmed and scheduled. We will be in touch shortly with your start date.
            </p>
            <div style="background:#F0FFF6;border-radius:8px;padding:16px 20px;margin-bottom:20px">
              <p style="margin:0 0 8px 0;font-size:13px;color:#444"><strong>Payment Type:</strong> ${pTypeLabel}</p>
              <p style="margin:0 0 8px 0;font-size:13px;color:#444"><strong>Amount Received:</strong> ${paidAmount}</p>
              <p style="margin:0 0 8px 0;font-size:13px;color:#444"><strong>Date:</strong> ${paidWhen}</p>
              <p style="margin:0;font-size:13px;color:#444"><strong>Project:</strong> ${fullJob.project_address}${fullJob.project_city ? ', ' + fullJob.project_city : ''}</p>
            </div>
            <p style="color:#444;font-size:14px;line-height:1.7;margin-bottom:16px">
              📎 <strong>Your signed contract and original proposal are attached together as one document</strong> for your records. Please keep this for your files.
            </p>
            <p style="color:#888;font-size:12px;line-height:1.6">
              Questions? Reply to this email or call us at <strong>978-377-1784</strong>.
            </p>
          </div>
          <div style="background:#f8f9ff;padding:14px 24px;font-size:10px;color:#aaa;border-radius:0 0 8px 8px">
            <p style="margin:0 0 4px 0">Preferred Builders General Services Inc. · 37 Duck Mill Rd, Fitchburg MA 01420 · HIC-197400 · CSL CS-121662</p>
            <p style="margin:0 0 4px 0">By receiving this communication you agree to receive digital communications from Preferred Builders General Services Inc. as required for your project.</p>
            <p style="margin:0 0 4px 0">This contract is legally binding. The 3-business-day cancellation period per M.G.L. c. 93 §48 applies from the date of signing.</p>
            <p style="margin:0">The approved Proposal / Scope of Work is non-binding on its own and is incorporated as a Contract Addendum upon execution of this agreement.</p>
          </div>
        </div>`,
          text: `Hi ${fullJob.customer_name || 'there'},\n\nWe received your ${pTypeLabel} of ${paidAmount} on ${paidWhen}.\n\nYour project at ${fullJob.project_address} is confirmed and scheduled. We will follow up with your start date shortly.\n\nA copy of your signed contract is attached.\n\n— Preferred Builders General Services Inc.\n978-377-1784`,
          emailType: 'general',
          jobId: job_id,
        });
        console.log(`[Payment] Deposit confirmation sent to ${fullJob.customer_email}`);
      } catch (e) {
        console.warn('[Payment] Confirmation email failed:', e.message);
      }
    });
  },
);

router.post(
  '/made',
  requireAuth,
  requireFields(['job_id', 'payee_name', 'amount', 'date_paid']),
  validateNumber('amount', { min: 0.01 }),
  (req, res) => {
    const db = getDb();
    const {
      job_id,
      payee_name,
      check_number,
      amount,
      date_paid,
      time_paid,
      category,
      credit_debit,
      notes,
      payment_class,
      dept_code,
      paid_by,
    } = req.body;
    const parsedAmount = validateAmount(amount);
    if (parsedAmount === null)
      return res.status(400).json({ error: 'amount must be a positive number' });

    // Accept proposal-derived trade names (e.g. 'framing', 'roofing', 'hvac') beyond the base whitelist
    const cat =
      category && typeof category === 'string' && category.trim()
        ? category.trim().toLowerCase()
        : 'subcontractor';
    const crDr = VALID_CREDIT_DEBIT.includes(credit_debit) ? credit_debit : 'debit';
    const pClass = VALID_PAYMENT_CLASS_OUT.includes(payment_class)
      ? payment_class
      : cat === 'permit'
        ? 'pass_through'
        : 'cost_of_revenue';
    const isPassThrough = pClass === 'pass_through' ? 1 : 0;
    const paidBy = paid_by === 'customer_direct' ? 'customer_direct' : 'pb';

    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(job_id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const recorder = req.session?.name || 'Unknown';
    const timeVal = time_paid || currentTime();

    let deptCodeVal = dept_code || null;
    if (!deptCodeVal) {
      try {
        const { nextDeptCode } = require('./invoices');
        deptCodeVal = nextDeptCode(db, job_id, job.quote_number);
      } catch {
        /* ignore */
      }
    }

    const info = db
      .prepare(
        `
    INSERT INTO payments_made (job_id, payee_name, check_number, amount, date_paid, time_paid, category, credit_debit, recorded_by, notes, payment_class, dept_code, is_pass_through, paid_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
      )
      .run(
        job_id,
        payee_name.trim(),
        check_number || null,
        parsedAmount,
        date_paid,
        timeVal,
        cat,
        crDr,
        recorder,
        notes || null,
        pClass,
        deptCodeVal,
        isPassThrough,
        paidBy,
      );

    const payment = db
      .prepare('SELECT * FROM payments_made WHERE id = ?')
      .get(info.lastInsertRowid);
    const paidByLabel = paidBy === 'customer_direct' ? 'paid directly by customer' : `paid by PB`;
    logAudit(
      job_id,
      'payment_made',
      `${payee_name}: $${amount} (${cat}, ${paidByLabel}) recorded by ${recorder}`,
      recorder,
    );

    const contact = job.contact_id
      ? db.prepare('SELECT pb_customer_number FROM contacts WHERE id = ?').get(job.contact_id)
      : null;
    const activityDesc =
      paidBy === 'customer_direct'
        ? `Customer paid directly to ${payee_name.trim()}: $${parsedAmount.toLocaleString()}${deptCodeVal ? ' [' + deptCodeVal + ']' : ''} — no PB reimbursement needed`
        : `${isPassThrough ? 'Pass-through cost' : 'Payment'} to ${payee_name.trim()}: $${parsedAmount.toLocaleString()}${deptCodeVal ? ' [' + deptCodeVal + ']' : ''}`;
    logActivity({
      customer_number: contact?.pb_customer_number || null,
      job_id,
      event_type: isPassThrough ? 'PASS_THROUGH_PAID' : 'PAYMENT_MADE',
      description: activityDesc,
      document_ref: deptCodeVal || null,
      recorded_by: recorder,
    });

    res.json({ payment, summary: jobSummary(db, job_id) });
  },
);

router.patch('/received/:id', requireAuth, validateNumber('amount', { min: 0.01 }), (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM payments_received WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Payment not found' });

  const {
    customer_name,
    check_number,
    amount,
    date_received,
    time_received,
    payment_type,
    credit_debit,
    notes,
    invoice_id,
  } = req.body;

  let parsedAmt = row.amount;
  if (amount !== undefined) {
    parsedAmt = validateAmount(amount);
    if (parsedAmt === null)
      return res.status(400).json({ error: 'amount must be a positive number' });
  }
  const pType =
    payment_type !== undefined
      ? VALID_PAYMENT_TYPES.includes(payment_type)
        ? payment_type
        : row.payment_type
      : row.payment_type;
  const crDr =
    credit_debit !== undefined
      ? VALID_CREDIT_DEBIT.includes(credit_debit)
        ? credit_debit
        : row.credit_debit
      : row.credit_debit;

  const newInvoiceId =
    invoice_id !== undefined
      ? invoice_id === null
        ? null
        : Number(invoice_id) || null
      : undefined;

  db.prepare(
    `
    UPDATE payments_received SET
      customer_name = ?, check_number = ?, amount = ?, date_received = ?, time_received = ?,
      payment_type = ?, credit_debit = ?, notes = ?,
      invoice_id = COALESCE(?, invoice_id),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `,
  ).run(
    customer_name ?? row.customer_name,
    check_number ?? row.check_number,
    parsedAmt,
    date_received ?? row.date_received,
    time_received ?? row.time_received,
    pType,
    crDr,
    notes ?? row.notes,
    newInvoiceId !== undefined ? newInvoiceId : null,
    row.id,
  );

  const updated = db.prepare('SELECT * FROM payments_received WHERE id = ?').get(row.id);

  // Sync: on PATCH, check if a matching outstanding invoice now qualifies as paid
  if (!updated.is_pass_through_reimbursement && updated.credit_debit === 'credit') {
    try {
      const matchingInv = db
        .prepare(
          "SELECT id, invoice_number FROM invoices WHERE job_id = ? AND status IN ('sent', 'pending_send') AND amount = ? LIMIT 1",
        )
        .get(updated.job_id, updated.amount);
      if (matchingInv) {
        const invPaidAt = updated.date_received || new Date().toISOString().slice(0, 10);
        db.prepare(
          "UPDATE invoices SET status = 'paid', paid_at = ?, amount_paid = ? WHERE id = ?",
        ).run(invPaidAt, updated.amount, matchingInv.id);
        console.log(`[PaymentSync] Invoice ${matchingInv.invoice_number} auto-marked paid (PATCH)`);
      }
    } catch (syncErr) {
      console.warn('[PaymentSync PATCH]', syncErr.message);
    }
  }

  res.json({ payment: updated, summary: jobSummary(db, row.job_id) });
});

router.patch('/made/:id', requireAuth, validateNumber('amount', { min: 0.01 }), (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM payments_made WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Payment not found' });

  const {
    payee_name,
    check_number,
    amount,
    date_paid,
    time_paid,
    category,
    credit_debit,
    notes,
    paid_by,
    lien_waiver_signed,
  } = req.body;

  let parsedAmt = row.amount;
  if (amount !== undefined) {
    parsedAmt = validateAmount(amount);
    if (parsedAmt === null)
      return res.status(400).json({ error: 'amount must be a positive number' });
  }
  const cat =
    category !== undefined
      ? category && typeof category === 'string' && category.trim()
        ? category.trim().toLowerCase()
        : row.category
      : row.category;
  const crDr =
    credit_debit !== undefined
      ? VALID_CREDIT_DEBIT.includes(credit_debit)
        ? credit_debit
        : row.credit_debit
      : row.credit_debit;
  const paidBy =
    paid_by !== undefined
      ? paid_by === 'customer_direct'
        ? 'customer_direct'
        : 'pb'
      : row.paid_by || 'pb';

  const waiverDate =
    lien_waiver_signed !== undefined
      ? lien_waiver_signed || null
      : (row.lien_waiver_signed ?? null);

  db.prepare(
    `
    UPDATE payments_made SET
      payee_name = ?, check_number = ?, amount = ?, date_paid = ?, time_paid = ?,
      category = ?, credit_debit = ?, notes = ?, paid_by = ?,
      lien_waiver_signed = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `,
  ).run(
    payee_name ?? row.payee_name,
    check_number ?? row.check_number,
    parsedAmt,
    date_paid ?? row.date_paid,
    time_paid ?? row.time_paid,
    cat,
    crDr,
    notes ?? row.notes,
    paidBy,
    waiverDate,
    row.id,
  );

  const updated = db.prepare('SELECT * FROM payments_made WHERE id = ?').get(row.id);
  res.json({ payment: updated, summary: jobSummary(db, row.job_id) });
});

const RECEIPT_DIR = path.join(__dirname, '../../uploads/receipts');
const ALLOWED_RECEIPT_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.pdf']);

function handleReceiptUpload(type, req, res) {
  const db = getDb();
  const table = type === 'received' ? 'payments_received' : 'payments_made';
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Payment not found' });
  if (!req.files?.photo) return res.status(400).json({ error: 'No file uploaded' });

  const file = req.files.photo;
  const ext = path.extname(file.name).toLowerCase();
  if (!ALLOWED_RECEIPT_EXTS.has(ext))
    return res.status(400).json({ error: 'File type not allowed' });

  if (!fs.existsSync(RECEIPT_DIR)) fs.mkdirSync(RECEIPT_DIR, { recursive: true });

  const filename = `rcpt_${type[0]}_${row.id}_${Date.now()}${ext}`;
  const dest = path.join(RECEIPT_DIR, filename);

  if (row.receipt_photo) {
    const old = path.join(RECEIPT_DIR, row.receipt_photo);
    if (fs.existsSync(old)) fs.unlinkSync(old);
  }

  file.mv(dest, (err) => {
    if (err) return res.status(500).json({ error: 'Upload failed' });
    db.prepare(
      `UPDATE ${table} SET receipt_photo = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    ).run(filename, row.id);
    res.json({ filename });
  });
}

router.post('/received/:id/receipt', requireAuth, (req, res) =>
  handleReceiptUpload('received', req, res),
);
router.post('/made/:id/receipt', requireAuth, (req, res) => handleReceiptUpload('made', req, res));

router.delete('/received/:id/receipt', requireAuth, (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM payments_received WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.receipt_photo) {
    const fp = path.join(RECEIPT_DIR, row.receipt_photo);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  }
  db.prepare('UPDATE payments_received SET receipt_photo = NULL WHERE id = ?').run(row.id);
  res.json({ success: true });
});

router.delete('/made/:id/receipt', requireAuth, (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM payments_made WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.receipt_photo) {
    const fp = path.join(RECEIPT_DIR, row.receipt_photo);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  }
  db.prepare('UPDATE payments_made SET receipt_photo = NULL WHERE id = ?').run(row.id);
  res.json({ success: true });
});

router.get('/receipt/:filename', requireAuth, (req, res) => {
  const fp = path.join(RECEIPT_DIR, path.basename(req.params.filename));
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Not found' });
  res.sendFile(fp);
});

router.delete('/received/:id', requireAuth, (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM payments_received WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Payment not found' });
  db.prepare('DELETE FROM payments_received WHERE id = ?').run(row.id);
  logAudit(
    row.job_id,
    'payment_received_deleted',
    `Check record deleted: $${row.amount}`,
    req.session?.name || 'admin',
  );
  res.json({ success: true, summary: jobSummary(db, row.job_id) });
});

router.delete('/made/:id', requireAuth, (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM payments_made WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Payment not found' });
  db.prepare('DELETE FROM payments_made WHERE id = ?').run(row.id);
  logAudit(
    row.job_id,
    'payment_made_deleted',
    `Outgoing check deleted: $${row.amount} to ${row.payee_name}`,
    req.session?.name || 'admin',
  );
  res.json({ success: true, summary: jobSummary(db, row.job_id) });
});

module.exports = router;
