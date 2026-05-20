// server/services/autoDepositInvoice.js
// Auto-creates Invoice 1 (draft deposit invoice) whenever a job moves to contract_signed.
// Called from any status-transition path (e-sign, manual upload, scanner attach).
// Safe to call multiple times — duplicate guards prevent double-creation.

const { getDb } = require('../db/database');
const { selectPreConAdvances } = require('./milestoneSelector');
const { logActivity } = require('../routes/activityLog');

function parseFee(str) {
  if (!str) return 0;
  const n = parseFloat(String(str).replace(/[^0-9.]/g, ''));
  return isNaN(n) ? 0 : n;
}

/**
 * Attempt to auto-create a draft deposit invoice for the given job.
 * No-ops silently when:
 *   - A deposit payment is already recorded for the job
 *   - A draft contract_invoice already exists
 *   - The computed deposit amount is zero or negative
 *
 * @param {number|string} jobId
 * @param {object} [dbOverride]  Pass an existing db instance to avoid re-opening
 */
function autoCreateDepositInvoice(jobId, dbOverride) {
  const db = dbOverride || getDb();

  setImmediate(async () => {
    try {
      const { nextInvoiceNumber } = require('../routes/invoices');

      const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
      if (!job) return;

      // Guard: deposit payment already recorded
      const existingDeposit = db
        .prepare(
          "SELECT id FROM payments_received WHERE job_id = ? AND payment_type = 'deposit' AND credit_debit = 'credit' LIMIT 1",
        )
        .get(jobId);
      if (existingDeposit) return;

      // Guard: draft deposit invoice already exists
      const existingInvoice = db
        .prepare(
          "SELECT id FROM invoices WHERE job_id = ? AND invoice_type = 'contract_invoice' AND status = 'draft' LIMIT 1",
        )
        .get(jobId);
      if (existingInvoice) return;

      let proposalData = null;
      try {
        proposalData = job.proposal_data ? JSON.parse(job.proposal_data) : null;
      } catch {
        /* ignore malformed JSON */
      }

      const fullContractValue = job.total_value || proposalData?.pricing?.totalContractPrice || 0;
      const depositPct = proposalData?.pricing?.depositPercent || 33;

      // Filter out customer_direct items — Article 3.3 requires those to be paid
      // directly by the owner to the vendor; they must never appear on a PB invoice.
      const preConAdvances = selectPreConAdvances(job).filter(
        (a) => a.paid_by !== 'customer_direct',
      );

      const totalPT = preConAdvances.reduce((s, a) => s + parseFee(a.amount), 0);
      const contractValueExclPT = Math.max(0, fullContractValue - totalPT);
      const depositAmt = Math.round(contractValueExclPT * (depositPct / 100) * 100) / 100;

      if (depositAmt <= 0) return;

      // Invoice line items: deposit row first, then one row per PB-funded pre-con advance
      const invLineItems = [
        {
          description: `Project Deposit — ${depositPct}% of contract value ($${Number(contractValueExclPT).toLocaleString('en-US', { minimumFractionDigits: 2 })})`,
          amount: depositAmt,
          type: 'contract',
          pay_direct: false,
          pay_direct_received: false,
        },
      ];

      for (const adv of preConAdvances) {
        const amt = parseFee(adv.amount);
        if (amt > 0) {
          invLineItems.push({
            description: adv.item,
            amount: amt,
            type: 'pass_through',
            pay_direct: false,
            pay_direct_received: false,
          });
        }
      }

      const totalInvoiceAmt = invLineItems.reduce((s, li) => s + li.amount, 0);
      const pbDueAmt = invLineItems
        .filter((li) => !li.pay_direct)
        .reduce((s, li) => s + li.amount, 0);
      const ptStoredAmt = invLineItems
        .filter((li) => li.type === 'pass_through')
        .reduce((s, li) => s + li.amount, 0);

      const invNum = nextInvoiceNumber(db, jobId, 'contract_invoice', job.quote_number);
      const contact = job.contact_id
        ? db.prepare('SELECT * FROM contacts WHERE id = ?').get(job.contact_id)
        : null;

      db.prepare(
        `INSERT INTO invoices
            (job_id, invoice_number, invoice_type, status, amount, contract_amount,
             pass_through_amount, pb_due_amount, full_contract_value, line_items, notes)
           VALUES (?, ?, 'contract_invoice', 'draft', ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        jobId,
        invNum,
        totalInvoiceAmt,
        depositAmt,
        ptStoredAmt,
        pbDueAmt,
        fullContractValue,
        JSON.stringify(invLineItems),
        'Deposit invoice — auto-created on contract signing',
      );

      logActivity({
        customer_number: contact?.pb_customer_number || null,
        job_id: jobId,
        event_type: 'INVOICE_ISSUED',
        description: `Deposit invoice ${invNum} created — $${totalInvoiceAmt.toLocaleString('en-US', { minimumFractionDigits: 2 })} total / $${pbDueAmt.toLocaleString('en-US', { minimumFractionDigits: 2 })} due to PB`,
        document_ref: invNum,
        recorded_by: 'system',
      });

      console.log(
        `[AutoDepositInvoice] Invoice ${invNum} created as draft for job ${jobId} — $${totalInvoiceAmt.toFixed(2)} total / $${pbDueAmt.toFixed(2)} due to PB`,
      );
    } catch (e) {
      console.warn('[AutoDepositInvoice]', e.message);
    }
  });
}

module.exports = { autoCreateDepositInvoice };
