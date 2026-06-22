/**
 * Regenerates the contract PDF for a job, bypassing UI status checks.
 * For the Grevais job, directly patches the milestone amounts to the
 * agreed schedule ($9,401 / $9,000 / $10,087) without needing a git pull.
 *
 * Usage: node scripts/regen_contract.js [customerName]
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
console.log('Job:', job.id, '--', job.customer_name, '-- status:', job.status);

if (!job.proposal_data) {
  console.log('No proposal_data on this job.');
  process.exit(1);
}

async function run() {
  const proposalData = JSON.parse(job.proposal_data);

  // Inject payment_overrides from the DB column so new code uses it
  if (proposalData.job) {
    proposalData.job.payment_overrides = job.payment_overrides
      ? typeof job.payment_overrides === 'string'
        ? JSON.parse(job.payment_overrides)
        : job.payment_overrides
      : null;
  }

  const contractData = adaptToContractSchema(proposalData);

  // ── Direct patch: override milestone amounts regardless of code version ──────
  // Agreed schedule: $9,401 deposit | $9,000 Demo Complete | $10,087 Substantial Completion
  const total = 28488;
  const fmt = (n) => `$${Number(Math.round(n)).toLocaleString()}`;
  const pct = (n) => `${Math.round(n)}%`;
  const qn = proposalData.quoteNumber || '';

  const demoAmt = 9000;
  const finalAmt = 10087;

  contractData.job.milestoneAmounts = { 'RN-2': fmt(demoAmt) };
  contractData.job.milestoneShares = { 'RN-2': pct((demoAmt / total) * 100) };
  contractData.job.invoiceNumbers = {
    'RN-2': qn ? `INV-${qn}-002` : 'Invoice No. 2',
  };
  contractData.job.final_milestone_amount = fmt(finalAmt);
  contractData.job.final_milestone_share = pct((finalAmt / total) * 100);
  contractData.job.final_invoice_number = qn ? `INV-${qn}-003` : 'Invoice No. 3';

  console.log('Milestone patch applied:');
  console.log('  Demo Complete (RN-2):', fmt(demoAmt), pct((demoAmt / total) * 100));
  console.log('  Substantial Completion:', fmt(finalAmt), pct((finalAmt / total) * 100));
  console.log('Generating PDF...');

  const pdfPath = await generatePDF(contractData, 'contract', job.id);
  console.log('PDF generated:', pdfPath);

  db.prepare(
    'UPDATE jobs SET contract_data = ?, contract_pdf_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
  ).run(JSON.stringify(contractData), pdfPath, job.id);

  console.log('\nDone. Open the app → Grevais job → Contract tab to view the updated PDF.');
}

run().catch((e) => {
  console.error('Error:', e.message);
  process.exit(1);
});
