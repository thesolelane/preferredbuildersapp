/**
 * ============================================================
 *  EXPORT DEV DATABASE — scrubs customer PII for safe dev use
 * ============================================================
 *
 * WHAT THIS DOES
 *   Copies your production database, replaces all real customer
 *   names / emails / phones / addresses with safe placeholders,
 *   and saves the result as  data/dev_export.db
 *
 *   Everything else is kept exactly as-is:
 *     ✓ Dollar amounts, markups, line items
 *     ✓ Job statuses and audit trail
 *     ✓ Invoices, payments, tasks
 *     ✓ Settings, vendors, knowledge docs
 *
 * ─── HOW TO USE ─────────────────────────────────────────────
 *
 *  STEP 1 — Run on the production server (Git Bash):
 *    node scripts/export_dev_db.js
 *    → Creates:  data/dev_export.db
 *
 *  STEP 2 — Transfer the file to Replit:
 *    Option A (easiest): open the production folder in Windows
 *    Explorer → data/ → drag dev_export.db into the Replit
 *    file browser sidebar.
 *
 *    Option B (command line from your laptop):
 *    scp user@server:/path/to/project/data/dev_export.db .
 *    then drag the downloaded file into Replit.
 *
 *  STEP 3 — In the Replit shell, swap the dev database:
 *    cp data/dev_export.db data/pb_system.db
 *    rm -f data/pb_system.db-shm data/pb_system.db-wal
 *
 *  STEP 4 — Restart the "Start application" workflow in Replit.
 *
 *  STEP 5 — Done. Log in with your normal credentials and you
 *    will see all real jobs/payments with fake customer info.
 *
 * ─── REFRESH ────────────────────────────────────────────────
 *  Run again any time you want to pull a fresh copy from prod.
 *  Repeat Steps 1–4.
 *
 * ─── SAFETY ─────────────────────────────────────────────────
 *  This script NEVER modifies production. It reads the live DB
 *  and writes a separate file. Your production data is safe.
 * ============================================================
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const SRC = path.resolve('./data/pb_system.db');
const DEST = path.resolve('./data/dev_export.db');

if (!fs.existsSync(SRC)) {
  console.error('Production DB not found at', SRC);
  process.exit(1);
}

// Copy the file
fs.copyFileSync(SRC, DEST);
// Remove any stale WAL journal from the copy
fs.rmSync(DEST + '-shm', { force: true });
fs.rmSync(DEST + '-wal', { force: true });

const db = new Database(DEST);

console.log('Scrubbing customer PII...');

// ── helpers ───────────────────────────────────────────────────────────────────
const fakeName = (id) => `Customer #${String(id).padStart(4, '0')}`;
const fakeEmail = (id) => `customer-${id}@example.com`;
const fakePhone = (id) => `555-000-${String(id).padStart(4, '0')}`;
const fakeAddr = (id) => `${100 + id} Sample Street`;

// ── jobs table ────────────────────────────────────────────────────────────────
const jobs = db.prepare('SELECT id, customer_name, proposal_data FROM jobs').all();
const updateJob = db.prepare(
  'UPDATE jobs SET customer_name = ?, customer_email = ?, customer_phone = ?, project_address = ? WHERE id = ?',
);

const scrubJobData = db.transaction(() => {
  for (const job of jobs) {
    updateJob.run(fakeName(job.id), fakeEmail(job.id), fakePhone(job.id), fakeAddr(job.id), job.id);

    // Scrub PII inside the proposal_data JSON blob
    if (job.proposal_data) {
      try {
        const pd = JSON.parse(job.proposal_data);
        if (pd.customer) {
          pd.customer.name = fakeName(job.id);
          pd.customer.email = fakeEmail(job.id);
          pd.customer.phone = fakePhone(job.id);
          pd.customer.address_line1 = fakeAddr(job.id);
          pd.customer.city_state_zip = 'Anytown, MA 01000';
        }
        db.prepare('UPDATE jobs SET proposal_data = ? WHERE id = ?').run(
          JSON.stringify(pd),
          job.id,
        );
      } catch {
        /* leave malformed JSON as-is */
      }
    }
  }
});
scrubJobData();
console.log(`  jobs: ${jobs.length} rows scrubbed`);

// ── contacts table ────────────────────────────────────────────────────────────
const contacts = db.prepare('SELECT id FROM contacts').all();
const updateContact = db.prepare(
  'UPDATE contacts SET name = ?, email = ?, phone = ?, address = ? WHERE id = ?',
);
const scrubContacts = db.transaction(() => {
  for (const c of contacts) {
    updateContact.run(fakeName(c.id), fakeEmail(c.id), fakePhone(c.id), fakeAddr(c.id), c.id);
  }
});
scrubContacts();
console.log(`  contacts: ${contacts.length} rows scrubbed`);

// ── signing_sessions — remove signature images and signer info ────────────────
db.prepare(
  "UPDATE signing_sessions SET signer_name = 'Redacted', signer_email = 'redacted@example.com', signature_data = NULL",
).run();
console.log('  signing_sessions: signer info cleared');

// ── email_log — clear recipient addresses ─────────────────────────────────────
db.prepare("UPDATE email_log SET to_address = 'redacted@example.com'").run();
console.log('  email_log: to_address cleared');

// ── whitelist — clear personal phone/email entries ───────────────────────────
// Keeps the row structure but blanks the contact identifier
db.prepare("UPDATE whitelist SET identifier = 'redacted-' || id").run();
console.log('  whitelist: identifiers cleared');

db.close();

console.log('\n✅ Done. Scrubbed database saved to:');
console.log('   ' + DEST);
console.log('\nNext step: transfer data/dev_export.db to Replit, then run:');
console.log('   cp data/dev_export.db data/pb_system.db');
console.log('   rm -f data/pb_system.db-shm data/pb_system.db-wal');
console.log('   (restart the Start application workflow)');
