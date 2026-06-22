/**
 * Usage:  node scripts/fix_grevais_final.js
 *
 * Cleans up duplicate invoices for John Grevais and sets correct amounts.
 * After running, open the app and click Generate Contract on the job.
 */

const Database = require('better-sqlite3');
const db = new Database('./data/pb_system.db');

// 1. Find job
const job = db
  .prepare("SELECT id, customer_name FROM jobs WHERE customer_name LIKE '%Grevais%'")
  .get();
if (job == null) {
  console.log('Job not found');
  process.exit(1);
}
console.log('Job:', job.id, '--', job.customer_name);

// 2. Show all current invoices
const all = db
  .prepare(
    'SELECT id, invoice_number, amount, status FROM invoices WHERE job_id = ? ORDER BY invoice_number, id',
  )
  .all(job.id);
console.log('\nAll invoices before cleanup (' + all.length + '):');
all.forEach((i) => console.log('  id=' + i.id, i.invoice_number, '$' + i.amount, i.status));

// 3. Delete duplicates — keep only the first (lowest id) per invoice number
const keepers = {};
all.forEach((i) => {
  if (keepers[i.invoice_number] == null || i.id < keepers[i.invoice_number]) {
    keepers[i.invoice_number] = i.id;
  }
});
const keepIds = Object.values(keepers);
const toDelete = all.filter((i) => !keepIds.includes(i.id));
if (toDelete.length > 0) {
  toDelete.forEach((i) => {
    db.prepare('DELETE FROM invoices WHERE id = ?').run(i.id);
    console.log('  Deleted duplicate id=' + i.id, i.invoice_number);
  });
} else {
  console.log('  No duplicates to remove.');
}

// 4. Upsert the 3 correct invoices
function upsert(num, amount, status, notes) {
  const existing = db
    .prepare('SELECT id FROM invoices WHERE job_id = ? AND invoice_number = ?')
    .get(job.id, num);
  const amountPaid = status === 'paid' ? amount : 0;
  if (existing) {
    db.prepare(
      'UPDATE invoices SET amount = ?, amount_paid = ?, status = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE job_id = ? AND invoice_number = ?',
    ).run(amount, amountPaid, status, notes, job.id, num);
    console.log('  Updated', num, '$' + amount, status);
  } else {
    db.prepare(
      'INSERT INTO invoices (job_id, invoice_number, invoice_type, amount, amount_paid, status, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
    ).run(job.id, num, 'contract_invoice', amount, amountPaid, status, notes);
    console.log('  Inserted', num, '$' + amount, status);
  }
}

console.log('\nSetting correct invoices:');
upsert('INV-1026/1-001', 9401, 'paid', 'Contract Deposit');
upsert('INV-1026/1-002', 9000, 'draft', 'Progress Payment');
upsert('INV-1026/1-003', 10087, 'draft', 'Substantial Completion');

// 5. Ensure payment_overrides is set on the job
db.prepare('UPDATE jobs SET payment_overrides = ? WHERE id = ?').run(
  JSON.stringify({ finalAmount: 10087, middleAmounts: [9000] }),
  job.id,
);

// 6. Final confirmation
const after = db
  .prepare(
    'SELECT invoice_number, amount, status FROM invoices WHERE job_id = ? ORDER BY invoice_number',
  )
  .all(job.id);
console.log('\nFinal state:');
after.forEach((i) => console.log('  ', i.invoice_number, '$' + i.amount, i.status));
const total = after.reduce((s, i) => s + i.amount, 0);
console.log('Total: $' + total, total === 28488 ? '-- CORRECT' : '-- MISMATCH');
console.log('\nPayment overrides set on job.');
console.log('\nDone. Now open the app, go to the John Grevais job,');
console.log('and click Generate Contract to get the updated PDF.');
