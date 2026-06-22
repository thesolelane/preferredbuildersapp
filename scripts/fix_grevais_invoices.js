const Database = require('better-sqlite3');
const db = new Database('./data/pb_system.db');

const job = db.prepare("SELECT id, customer_name FROM jobs WHERE customer_name LIKE '%Grevais%'").get();
if (job == null) {
  console.log('Job not found — nothing changed.');
  process.exit(1);
}
console.log('Found job:', job.id, '—', job.customer_name);

// Set payment overrides so the PDF regenerates with correct amounts
db.prepare('UPDATE jobs SET payment_overrides = ? WHERE id = ?').run(
  JSON.stringify({ finalAmount: 10087, middleAmounts: [9000] }),
  job.id
);
console.log('Payment overrides set.');

// Helper: ensure a row exists in invoices table with the right amount
function upsertInvoice(invoiceNumber, invoiceType, amount, notes) {
  const existing = db.prepare('SELECT id FROM invoices WHERE job_id = ? AND invoice_number = ?').get(job.id, invoiceNumber);
  if (existing) {
    db.prepare('UPDATE invoices SET amount = ?, updated_at = CURRENT_TIMESTAMP WHERE job_id = ? AND invoice_number = ?').run(amount, job.id, invoiceNumber);
    console.log(invoiceNumber, 'updated to $' + amount.toLocaleString());
  } else {
    db.prepare(
      'INSERT INTO invoices (job_id, invoice_number, invoice_type, amount, amount_paid, status, notes, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)'
    ).run(job.id, invoiceNumber, invoiceType, amount, 'draft', notes);
    console.log(invoiceNumber, 'inserted at $' + amount.toLocaleString());
  }
}

upsertInvoice('INV-1026/1-001', 'contract_invoice', 9401, 'Contract Deposit');
upsertInvoice('INV-1026/1-002', 'contract_invoice', 9000, 'Progress Payment');
upsertInvoice('INV-1026/1-003', 'contract_invoice', 10087, 'Substantial Completion');

// Deposit was already paid — mark it accordingly
db.prepare(
  "UPDATE invoices SET status = 'paid', amount_paid = 9401, updated_at = CURRENT_TIMESTAMP WHERE job_id = ? AND invoice_number = 'INV-1026/1-001'"
).run(job.id);
console.log('INV-1026/1-001 marked as paid.');

// Final check
const after = db.prepare('SELECT invoice_number, amount, status FROM invoices WHERE job_id = ? ORDER BY id').all(job.id);
console.log('\n--- FINAL STATE ---');
after.forEach((i) => console.log(i.invoice_number, '  $' + i.amount.toLocaleString(), ' ', i.status));
const total = after.reduce((s, i) => s + i.amount, 0);
console.log('Total: $' + total.toLocaleString(), total === 28488 ? '— CORRECT' : '— MISMATCH');
