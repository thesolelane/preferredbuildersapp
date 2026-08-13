#!/usr/bin/env node
// scripts/record_jenny_deposit.js
// One-time script: record Jenny Cabaral deposit payment ($9,127.00)
// Run on PRODUCTION server: node scripts/record_jenny_deposit.js
// Check number can be updated later via the app (Edit Payment).

const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../data/app.db');
const db = new Database(DB_PATH);

const JOB_ID = '951b461e-df12-4dc2-bd39-c4c6084a4d06';
const CUSTOMER = 'Jenny Cabaral';
const AMOUNT = 9127.00;
const DATE = '2026-08-13';
const NOTES = 'Deposit payment — check number TBD';

// Confirm job exists
const job = db.prepare('SELECT id, customer_name, project_address FROM jobs WHERE id = ?').get(JOB_ID);
if (!job) {
  console.error('❌ Job not found:', JOB_ID);
  process.exit(1);
}
console.log(`✅ Job found: ${job.customer_name} — ${job.project_address}`);

// Check if a deposit is already recorded to avoid duplicates
const existing = db
  .prepare("SELECT id, amount FROM payments_received WHERE job_id = ? AND payment_type = 'deposit'")
  .all(JOB_ID);
if (existing.length > 0) {
  console.warn('⚠️  A deposit is already recorded for this job:');
  existing.forEach(r => console.warn(`   ID ${r.id} — $${r.amount}`));
  console.warn('Aborting to prevent duplicate. Edit the existing record if needed.');
  process.exit(0);
}

// Insert the payment
const stmt = db.prepare(`
  INSERT INTO payments_received
    (job_id, customer_name, amount, date_received, payment_type,
     credit_debit, payment_class, is_pass_through_reimbursement,
     recorded_by, notes)
  VALUES (?, ?, ?, ?, 'deposit', 'credit', 'contract', 0, 'Agent (auto)', ?)
`);

const info = stmt.run(JOB_ID, CUSTOMER, AMOUNT, DATE, NOTES);
console.log(`✅ Payment recorded — row ID: ${info.lastInsertRowid}`);
console.log(`   Customer : ${CUSTOMER}`);
console.log(`   Amount   : $${AMOUNT.toFixed(2)}`);
console.log(`   Date     : ${DATE}`);
console.log(`   Type     : deposit`);
console.log(`   Note     : ${NOTES}`);
console.log('');
console.log('Done. Open the job in the app to verify, then edit to add the check number.');

db.close();
