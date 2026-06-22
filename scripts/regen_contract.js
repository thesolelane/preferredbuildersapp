/**
 * Regenerates the contract PDF for a job, bypassing UI status checks.
 * Usage: node scripts/regen_contract.js [customerName]
 * Example: node scripts/regen_contract.js Grevais
 */

const Database = require('better-sqlite3');
const path = require('path');

const { generatePDF } = require('./server/services/pdfService');
const { adaptToContractSchema } = require('./server/services/contractTemplate');

const db = new Database('./data/pb_system.db');

const search = process.argv[2] || 'Grevais';
const job = db
  .prepare('SELECT * FROM jobs WHERE customer_name LIKE ? AND deleted = 0')
  .get(`%${search}%`);

if (!job) {
  console.log('No job found matching:', search);
  process.exit(1);
}
console.log('Job found:', job.id, '--', job.customer_name, '-- status:', job.status);

if (!job.proposal_data) {
  console.log('No proposal_data on this job.');
  process.exit(1);
}

async function run() {
  const proposalData = JSON.parse(job.proposal_data);

  // Inject payment_overrides exactly as the approve route does
  if (proposalData.job) {
    proposalData.job.payment_overrides = job.payment_overrides || null;
  }
  if (job.payment_overrides) {
    console.log('Payment overrides:', job.payment_overrides);
  } else {
    console.log('WARNING: No payment_overrides on this job — amounts will be auto-calculated.');
  }

  const contractData = adaptToContractSchema(proposalData);
  console.log('Contract data built. Generating PDF...');

  const pdfPath = await generatePDF(contractData, 'contract', job.id);
  console.log('PDF generated:', pdfPath);

  db.prepare(
    'UPDATE jobs SET contract_data = ?, contract_pdf_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
  ).run(JSON.stringify(contractData), pdfPath, job.id);

  console.log('\nDone. Contract PDF updated in DB.');
  console.log('Open the app → job → Contract tab to view it.');
}

run().catch((e) => {
  console.error('Error:', e.message);
  process.exit(1);
});
