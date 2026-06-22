const Database = require('better-sqlite3');
const db = new Database('./data/pb_system.db');

const job = db.prepare("SELECT id, customer_name FROM jobs WHERE customer_name LIKE '%Grevais%'").get();
if (job == null) {
  console.log('Job not found — nothing changed.');
  process.exit(1);
}
console.log('Found job:', job.id, '—', job.customer_name);

const existing = db.prepare('SELECT invoice_number, amount, status FROM invoices WHERE job_id = ? ORDER BY id').all(job.id);
console.log('Current invoices:', JSON.stringify(existing, null, 2));

db.prepare('UPDATE jobs SET payment_overrides = ? WHERE id = ?').run(
  JSON.stringify({ finalAmount: 10087, middleAmounts: [9000] }),
  job.id
);
console.log('Payment overrides set on job.');

const hasMiddle = existing.some((i) => i.invoice_number === 'INV-1026/1-002');
if (hasMiddle) {
  console.log('INV-1026/1-002 already exists — skipping insert.');
} else {
  db.prepare(
    "INSERT INTO invoices (job_id, invoice_number, invoice_type, amount, amount_paid, status, notes, created_at, updated_at) VALUES (?, 'INV-1026/1-002', 'contract_invoice', 9000.00, 0, 'draft', 'Progress Payment', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
  ).run(job.id);
  console.log('INV-1026/1-002 inserted ($9,000).');
}

db.prepare(
  'UPDATE invoices SET amount = 10087.00, updated_at = CURRENT_TIMESTAMP WHERE job_id = ? AND invoice_number = ?'
).run(job.id, 'INV-1026/1-003');
console.log('INV-1026/1-003 updated to $10,087.');

const after = db.prepare('SELECT invoice_number, amount, status FROM invoices WHERE job_id = ? ORDER BY id').all(job.id);
console.log('Final invoices:', JSON.stringify(after, null, 2));
const total = after.reduce((s, i) => s + i.amount, 0);
console.log('Total:', total, total === 28488 ? '— CORRECT' : '— MISMATCH, check amounts');
