'use strict';
const { generatePDFFromHTML } = require('./pdfService');
const { sendEmail } = require('./emailService');
const { logActivity } = require('../routes/activityLog');

const TYPE_LABELS = {
  contract_invoice: 'Contract Invoice',
  pass_through_invoice: 'Pass-Through Invoice',
  change_order: 'Change Order',
  combined_invoice: 'Invoice',
};

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function buildInvoiceEmailHTML(inv, job, contact, customerEmail) {
  const typeLabel = TYPE_LABELS[inv.invoice_type] || 'Invoice';
  const isPT = inv.invoice_type === 'pass_through_invoice';
  const issuedDate = new Date().toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  body{font-family:Arial,sans-serif;margin:0;padding:40px;color:#222}
  .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px}
  .logo-block h1{color:#1B3A6B;margin:0;font-size:22px}
  .logo-block p{color:#888;margin:4px 0;font-size:12px}
  .inv-meta{text-align:right}
  .inv-num{font-size:20px;font-weight:bold;color:#1B3A6B}
  .status{font-size:12px;color:#888}
  .divider{border:none;border-top:2px solid #E07B2A;margin:16px 0}
  .section{margin-bottom:24px}
  .section h3{font-size:12px;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px}
  .amount-box{background:#f8f9ff;border:2px solid #1B3A6B;border-radius:8px;padding:20px;text-align:center;margin:24px 0}
  .amount-box .amt{font-size:36px;font-weight:bold;color:#1B3A6B}
  .amount-box .lbl{font-size:12px;color:#888}
  .pt-notice{background:#fffbeb;border:1px solid #fbbf24;border-radius:6px;padding:12px;font-size:12px;color:#92400e;margin-bottom:16px}
  .footer{margin-top:48px;padding-top:16px;border-top:1px solid #eee;font-size:11px;color:#888;text-align:center}
</style></head><body>
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
    <div class="status">Status: <strong>SENT</strong></div>
    <div class="status">Issued: ${issuedDate}</div>
  </div>
</div>
<hr class="divider">
${isPT ? `<div class="pt-notice"><strong>PASS-THROUGH COST — NOT A REVENUE ITEM</strong><br>Billed for direct reimbursement only (permits, engineers, consultants, etc.)</div>` : ''}
${
  contact || job
    ? `<div class="section"><h3>Billed To</h3>
  ${contact?.pb_customer_number ? `<div style="font-family:monospace;font-size:11px;background:#e0e8ff;color:#1B3A6B;padding:2px 8px;border-radius:4px;display:inline-block;margin-bottom:6px;font-weight:bold">${contact.pb_customer_number}</div><br>` : ''}
  <strong>${contact?.name || job?.customer_name || '—'}</strong><br>
  ${customerEmail}<br>
  ${contact?.phone || job?.customer_phone || ''}
</div>`
    : ''
}
${
  job
    ? `<div class="section"><h3>Project</h3>
  ${job.pb_number || job.quote_number ? `<strong>PB# ${job.pb_number || job.quote_number}</strong><br>` : ''}
  ${job.project_address || ''}${job.project_city ? ', ' + job.project_city + ', MA' : ''}
</div>`
    : ''
}
<div class="amount-box">
  <div class="lbl">Invoice Amount</div>
  <div class="amt">$${fmt(inv.amount)}</div>
</div>
${inv.notes ? `<div class="section"><h3>Notes</h3><p style="font-size:13px">${String(inv.notes).replace(/\n/g, '<br>')}</p></div>` : ''}
<div class="footer">Preferred Builders General Services Inc. · MA License #CS-109171 · 978-377-1784<br>
Please make checks payable to: <strong>Preferred Builders General Services Inc.</strong></div>
</body></html>`;
}

/**
 * Send a job invoice (from the `invoices` table) to the customer email.
 * Updates invoice status to 'sent' and sets issued_at on success.
 *
 * @param {string|number} invId       Invoice ID
 * @param {object}        db          SQLite database instance
 * @param {string}        [recordedBy] Name for activity log
 * @returns {Promise<{success: boolean, to: string}>}
 * @throws {Error} if invoice not found, no customer email, or send fails
 */
async function sendInvoiceEmail(invId, db, recordedBy = 'system') {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invId);
  if (!inv) throw new Error(`Invoice ${invId} not found`);

  const job = inv.job_id ? db.prepare('SELECT * FROM jobs WHERE id = ?').get(inv.job_id) : null;
  const contact = job?.contact_id
    ? db.prepare('SELECT * FROM contacts WHERE id = ?').get(job.contact_id)
    : null;

  const customerEmail = contact?.email || job?.customer_email;
  if (!customerEmail) throw new Error('No customer email on file for this job');

  const typeLabel = TYPE_LABELS[inv.invoice_type] || 'Invoice';
  const isPT = inv.invoice_type === 'pass_through_invoice';

  const html = buildInvoiceEmailHTML(inv, job, contact, customerEmail);
  const pdfPath = await generatePDFFromHTML(
    html,
    `invoice_${inv.invoice_number.replace(/[^a-zA-Z0-9-]/g, '_')}_email`,
  );

  const subject = `Invoice ${inv.invoice_number} from Preferred Builders${job ? ' — ' + (job.project_address || 'Your Project') : ''}`;
  const emailBody = `<p>Dear ${contact?.name || job?.customer_name || 'Valued Customer'},</p>
<p>Please find your invoice <strong>${inv.invoice_number}</strong> (${typeLabel}) attached for <strong>$${fmt(inv.amount)}</strong>.</p>
${isPT ? '<p><em>Note: This is a pass-through cost invoice billed for direct reimbursement of permits, engineering fees, or other third-party costs paid on your behalf.</em></p>' : ''}
<p>If you have any questions, please don't hesitate to contact us.</p>
<p>Thank you for choosing Preferred Builders.</p>
<p>— Preferred Builders General Services Inc.<br>978-377-1784 | Fitchburg, MA</p>`;

  await sendEmail({
    to: customerEmail,
    subject,
    html: emailBody,
    attachments: [{ path: pdfPath, filename: `${inv.invoice_number}.pdf` }],
    emailType: 'invoice',
    jobId: inv.job_id,
    db,
  });

  const now = new Date().toISOString();
  db.prepare(
    "UPDATE invoices SET status = 'sent', issued_at = ? WHERE id = ? AND status IN ('draft', 'pending_send')",
  ).run(now, inv.id);

  logActivity({
    customer_number: contact?.pb_customer_number || null,
    job_id: inv.job_id || null,
    event_type: 'INVOICE_ISSUED',
    description: `Invoice ${inv.invoice_number} emailed to ${customerEmail}`,
    document_ref: inv.invoice_number,
    recorded_by: recordedBy,
  });

  return { success: true, to: customerEmail };
}

module.exports = { sendInvoiceEmail };
