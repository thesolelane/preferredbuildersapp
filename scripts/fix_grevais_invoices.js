const Database = require('better-sqlite3');
const db = new Database('./data/pb_system.db');

const job = db.prepare("SELECT id, customer_name FROM jobs WHERE customer_name LIKE '%Grevais%'").get();
if (job == null) {
  console.log('Job not found — nothing changed.');
  process.exit(1);
}
console.log('Found job:', job.id, '—', job.customer_name);

// Check both invoice tables
const jobInvoices = db.prepare(
  'SELECT invoice_number, amount AS total, status FROM invoices WHERE job_id = ? ORDER BY id'
).all(job.id);
const directInvoices = db.prepare(
  'SELECT invoice_number, total, status FROM direct_invoices WHERE job_id = ? ORDER BY id'
).all(job.id);

console.log('invoices table:', JSON.stringify(jobInvoices, null, 2));
console.log('direct_invoices table:', JSON.stringify(directInvoices, null, 2));

// Set payment overrides on the job so the PDF regenerates with correct amounts
db.prepare('UPDATE jobs SET payment_overrides = ? WHERE id = ?').run(
  JSON.stringify({ finalAmount: 10087, middleAmounts: [9000] }),
  job.id
);
console.log('Payment overrides set on job.');

// Fix INV-1026/1-002 (progress payment) — in invoices table
const hasMiddle = jobInvoices.some((i) => i.invoice_number === 'INV-1026/1-002');
if (hasMiddle) {
  db.prepare(
    'UPDATE invoices SET amount = 9000.00, updated_at = CURRENT_TIMESTAMP WHERE job_id = ? AND invoice_number = ?'
  ).run(job.id, 'INV-1026/1-002');
  console.log('INV-1026/1-002 updated to $9,000.');
} else {
  db.prepare(
    "INSERT INTO invoices (job_id, invoice_number, invoice_type, amount, amount_paid, status, notes, created_at, updated_at) VALUES (?, 'INV-1026/1-002', 'contract_invoice', 9000.00, 0, 'draft', 'Progress Payment', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
  ).run(job.id);
  console.log('INV-1026/1-002 inserted ($9,000).');
}

// Fix INV-1026/1-003 (final) — check direct_invoices first, then invoices
const finalInDirect = directInvoices.some((i) => i.invoice_number === 'INV-1026/1-003');
const finalInJob = jobInvoices.some((i) => i.invoice_number === 'INV-1026/1-003');

if (finalInDirect) {
  db.prepare(
    'UPDATE direct_invoices SET total = 10087.00, updated_at = CURRENT_TIMESTAMP WHERE job_id = ? AND invoice_number = ?'
  ).run(job.id, 'INV-1026/1-003');
  console.log('INV-1026/1-003 updated to $10,087 in direct_invoices.');
} else if (finalInJob) {
  db.prepare(
    'UPDATE invoices SET amount = 10087.00, updated_at = CURRENT_TIMESTAMP WHERE job_id = ? AND invoice_number = ?'
  ).run(job.id, 'INV-1026/1-003');
  console.log('INV-1026/1-003 updated to $10,087 in invoices.');
} else {
  console.log('INV-1026/1-003 not found in either table — adding to invoices table.');
  db.prepare(
    "INSERT INTO invoices (job_id, invoice_number, invoice_type, amount, amount_paid, status, notes, created_at, updated_at) VALUES (?, 'INV-1026/1-003', 'contract_invoice', 10087.00, 0, 'draft', 'Substantial Completion', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
  ).run(job.id);
}

// Final check — show everything
const afterJob = db.prepare(
  'SELECT invoice_number, amount AS total, status FROM invoices WHERE job_id = ? ORDER BY id'
).all(job.id);
const afterDirect = db.prepare(
  'SELECT invoice_number, total, status FROM direct_invoices WHERE job_id = ? ORDER BY id'
).all(job.id);

console.log('\n--- FINAL STATE ---');
console.log('invoices table:', JSON.stringify(afterJob, null, 2));
console.log('direct_invoices table:', JSON.stringify(afterDirect, null, 2));

const allInvoices = [...afterJob, ...afterDirect];
const total = allInvoices.reduce((s, i) => s + i.total, 0);
console.log('Combined total:', total, total === 28488 ? '— CORRECT' : '— MISMATCH');
