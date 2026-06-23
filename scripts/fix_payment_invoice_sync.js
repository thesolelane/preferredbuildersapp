#!/usr/bin/env node
// scripts/fix_payment_invoice_sync.js
// Retroactively links existing unlinked payments to their matching invoices.
// Safe to run multiple times — skips payments that are already linked.
// Run on production: node scripts/fix_payment_invoice_sync.js

const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.resolve(__dirname, '../data/pb_system.db'));

const TOLERANCE_PCT = 0.02; // 2%
const TOLERANCE_MIN = 25; // $25 floor

const unlinked = db
  .prepare(
    `SELECT r.id, r.job_id, r.amount, r.date_received, r.payment_type, r.check_number,
            j.customer_name
     FROM payments_received r
     JOIN jobs j ON j.id = r.job_id
     WHERE r.invoice_id IS NULL
       AND r.credit_debit = 'credit'
       AND r.is_pass_through_reimbursement != 1
     ORDER BY r.date_received`,
  )
  .all();

console.log(`\nFound ${unlinked.length} unlinked credit payments to check.\n`);

let linked = 0;
let skipped = 0;

for (const pmt of unlinked) {
  const tolerance = Math.max(TOLERANCE_MIN, pmt.amount * TOLERANCE_PCT);

  const openInvoices = db
    .prepare(
      `SELECT id, invoice_number, amount, status
       FROM invoices
       WHERE job_id = ? AND status IN ('draft', 'sent', 'pending_send')
       ORDER BY issued_at ASC`,
    )
    .all(pmt.job_id);

  const match = openInvoices.find((inv) => Math.abs(inv.amount - pmt.amount) <= tolerance);

  if (match) {
    const paidAt = pmt.date_received || new Date().toISOString().slice(0, 10);
    db.prepare(
      "UPDATE invoices SET status = 'paid', paid_at = ?, amount_paid = ? WHERE id = ?",
    ).run(paidAt, pmt.amount, match.id);
    db.prepare('UPDATE payments_received SET invoice_id = ? WHERE id = ?').run(match.id, pmt.id);

    console.log(
      `✅ Linked: ${pmt.customer_name} — payment $${pmt.amount} (${pmt.date_received}) → invoice ${match.invoice_number} ($${match.amount})`,
    );
    linked++;
  } else {
    const checkInfo = pmt.check_number ? ` check #${pmt.check_number}` : '';
    console.log(
      `⏭  Skipped: ${pmt.customer_name} — $${pmt.amount}${checkInfo} (${pmt.payment_type}, ${pmt.date_received}) — no matching open invoice`,
    );
    skipped++;
  }
}

db.close();
console.log(`\nDone: ${linked} linked, ${skipped} skipped.\n`);
