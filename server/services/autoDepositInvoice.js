'use strict';
// Auto-creates Invoice 1 (draft deposit invoice) whenever a job moves to contract_signed.
// Called from signing.js and any manual contract-signed status transition.
// Safe to call multiple times — duplicate guard prevents double-creation.

const { getDb } = require('../db/database');
const { selectPreConAdvances } = require('./milestoneSelector');
const { logActivity } = require('../routes/activityLog');

const PAYMENT_TERMS = [
  'PAYMENT TERMS',
  '─────────────────────────────────────────',
  '• Deposit is due within 5 business days of contract signing.',
  '• Work does not begin until deposit is received.',
  '• Permit and engineering fees are billed at cost and are due in full',
  '  separately from the project deposit.',
  '• Make checks payable to: Preferred Builders General Services Inc.',
  '• Mail to: 37 Duck Mill Rd, Fitchburg MA 01420',
  '• Questions? Call 978-377-1784',
].join('\n');

function parseFee(val) {
  if (!val) return 0;
  const n = parseFloat(String(val).replace(/[^0-9.]/g, ''));
  return isNaN(n) ? 0 : n;
}

function fmtAmt(n) {
  return Number(n || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// Generate a per-job deposit invoice number: <pb_number>-DEP or <jobId>-DEP,
// with a sequence suffix if multiple are ever created for the same job.
function nextDepositInvoiceNumber(db, jobId, pbNumber) {
  db.prepare(
    `
    INSERT INTO invoice_counters (job_id, contract_seq) VALUES (?, 1)
    ON CONFLICT(job_id) DO UPDATE SET contract_seq = contract_seq + 1
  `,
  ).run(jobId);
  const { contract_seq } = db
    .prepare('SELECT contract_seq FROM invoice_counters WHERE job_id = ?')
    .get(jobId);
  const base = pbNumber || String(jobId);
  return contract_seq === 1 ? `${base}-DEP` : `${base}-DEP-${contract_seq}`;
}

/**
 * Auto-create a draft deposit invoice when a contract is signed.
 *
 * Deposit math (matching the proposal pricing engine):
 *   - Permit, engineer, and architect fees are tagged isSeparatelyBilled in
 *     proposal_data.lineItems — they appear as their own line items on the
 *     invoice but are NOT included in the 33% deposit base.
 *   - depositBase   = contractTotal − separatelyBilledTotal
 *   - depositAmount = depositBase × depositPct (default 33%)
 *   - invoiceTotal  = depositAmount + separatelyBilledTotal
 *
 * @param {number|string} jobId
 * @param {object}        [dbOverride]  Reuse an open db instance (avoids re-open)
 */
function autoCreateDepositInvoice(jobId, dbOverride) {
  const db = dbOverride || getDb();

  setImmediate(async () => {
    try {
      const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
      if (!job) return;

      // Guard: draft deposit invoice already exists for this job
      const existing = db
        .prepare(
          "SELECT id FROM invoices WHERE job_id = ? AND invoice_type = 'contract_invoice' LIMIT 1",
        )
        .get(jobId);
      if (existing) {
        console.log(`[AutoDepositInvoice] Invoice already exists for job ${jobId} — skipping`);
        return;
      }

      // ── Pull pricing from stored proposal data ────────────────────────────────
      let proposalData = null;
      try {
        proposalData = job.proposal_data ? JSON.parse(job.proposal_data) : null;
      } catch {
        /* ignore malformed JSON */
      }

      const pricing = proposalData?.pricing || {};
      const lineItems = proposalData?.lineItems || [];

      const contractTotal = parseFloat(job.total_value) || pricing.totalContractPrice || 0;
      const depositPct = pricing.depositPercent || 33;

      // ── Find separately billed items from pricing engine ─────────────────────
      // applyPricing tags items matching /permit|remit|engineer/i as isSeparatelyBilled.
      // Also check milestoneSelector for jobs that have explicit fee fields set.
      let separateItems = lineItems
        .filter((li) => li.isSeparatelyBilled && (li.finalPrice || 0) > 0)
        .map((li) => ({ item: li.trade || 'Fee', amount: li.finalPrice }));

      // Supplement with explicit job fields if proposal data lacks them
      if (separateItems.length === 0) {
        const advances = selectPreConAdvances(job).filter((a) => a.paid_by !== 'customer_direct');
        separateItems = advances
          .map((a) => ({ item: a.item, amount: parseFee(a.amount) }))
          .filter((a) => a.amount > 0);
      }

      const separateTotal = separateItems.reduce((s, a) => s + a.amount, 0);

      // ── Compute deposit ───────────────────────────────────────────────────────
      // Use pre-calculated value when available, otherwise compute from scratch
      const depositBase = pricing.depositBase ?? Math.max(0, contractTotal - separateTotal);
      const depositAmt =
        pricing.depositAmount ?? Math.round(depositBase * (depositPct / 100) * 100) / 100;

      if (depositAmt <= 0 && separateTotal <= 0) {
        console.warn(`[AutoDepositInvoice] Zero deposit computed for job ${jobId} — skipping`);
        return;
      }

      const invoiceTotal = depositAmt + separateTotal;

      // ── Build line items for the invoice record ───────────────────────────────
      const addrParts = [
        job.project_address,
        job.project_city ? job.project_city + ', MA' : '',
      ].filter(Boolean);
      const addrStr = addrParts.join(', ');
      const pbNum = job.pb_number || '';

      const invLineItems = [
        {
          description: [
            `Project deposit — ${depositPct}% of $${fmtAmt(depositBase)} construction cost`,
            pbNum ? `Contract ${pbNum}` : '',
            addrStr,
          ]
            .filter(Boolean)
            .join(' | '),
          amount: depositAmt,
          type: 'contract',
        },
      ];

      for (const sep of separateItems) {
        invLineItems.push({
          description: `${sep.item}${addrStr ? ' — ' + addrStr : ''}`,
          amount: sep.amount,
          type: 'pass_through',
        });
      }

      // ── Build notes with payment terms ────────────────────────────────────────
      const noteLines = [
        pbNum ? `Contract #${pbNum}` : '',
        addrStr ? `Project: ${addrStr}` : '',
        `Contract total: $${fmtAmt(contractTotal)}`,
        `Deposit base (before separately billed fees): $${fmtAmt(depositBase)}`,
      ];
      if (separateItems.length > 0) {
        noteLines.push('');
        noteLines.push('Separately billed (due in full, not part of deposit base):');
        for (const sep of separateItems) {
          noteLines.push(`  • ${sep.item}: $${fmtAmt(sep.amount)}`);
        }
      }
      noteLines.push('');
      noteLines.push(PAYMENT_TERMS);
      const notes = noteLines.filter((l) => l != null).join('\n');

      // ── Insert invoice record ─────────────────────────────────────────────────
      const invNum = nextDepositInvoiceNumber(db, jobId, pbNum);

      const insertResult = db
        .prepare(
          `
        INSERT INTO invoices
          (job_id, invoice_number, invoice_type, status, amount, line_items, notes)
        VALUES (?, ?, 'contract_invoice', 'draft', ?, ?, ?)
      `,
        )
        .run(jobId, invNum, invoiceTotal, JSON.stringify(invLineItems), notes);

      const invId = insertResult.lastInsertRowid;

      // ── Log activity ──────────────────────────────────────────────────────────
      const contact = job.contact_id
        ? db.prepare('SELECT pb_customer_number FROM contacts WHERE id = ?').get(job.contact_id)
        : null;

      logActivity({
        customer_number: contact?.pb_customer_number || null,
        job_id: jobId,
        event_type: 'INVOICE_ISSUED',
        description: `Deposit invoice ${invNum} created — $${fmtAmt(invoiceTotal)} total ($${fmtAmt(depositAmt)} deposit${separateItems.length ? ` + $${fmtAmt(separateTotal)} fees` : ''})`,
        document_ref: invNum,
        recorded_by: 'system',
      });

      console.log(
        `[AutoDepositInvoice] ${invNum} created for job ${jobId} — deposit $${fmtAmt(depositAmt)} + fees $${fmtAmt(separateTotal)} = total $${fmtAmt(invoiceTotal)}`,
      );

      // ── Auto-send to customer ─────────────────────────────────────────────────
      try {
        const { sendInvoiceEmail } = require('./invoiceEmailService');
        await sendInvoiceEmail(invId, db, 'system');
        console.log(`[AutoDepositInvoice] ${invNum} emailed to customer`);
      } catch (sendErr) {
        db.prepare("UPDATE invoices SET status = 'pending_send' WHERE id = ?").run(invId);
        console.warn(
          `[AutoDepositInvoice] Email failed for ${invNum} — flagged pending_send: ${sendErr.message}`,
        );
      }
    } catch (err) {
      console.warn('[AutoDepositInvoice]', err.message);
    }
  });
}

module.exports = { autoCreateDepositInvoice };
