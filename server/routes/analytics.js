const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const { requireAuth } = require('../middleware/auth');

router.get('/pipeline', requireAuth, (req, res) => {
  const db = getDb();

  const statusOrder = [
    'received',
    'processing',
    'clarification',
    'review_pending',
    'proposal_ready',
    'proposal_sent',
    'proposal_approved',
    'contract_ready',
    'contract_sent',
    'contract_signed',
    'complete',
  ];
  const statusLabels = {
    received: 'Received',
    processing: 'Processing',
    clarification: 'Clarification',
    review_pending: 'Review Pending',
    proposal_ready: 'Proposal Ready',
    proposal_sent: 'Proposal Sent',
    proposal_approved: 'Approved',
    contract_ready: 'Contract Ready',
    contract_sent: 'Contract Sent',
    contract_signed: 'Contract Signed',
    complete: 'Complete',
  };

  const allCounts = db
    .prepare('SELECT status, COUNT(*) as count FROM jobs WHERE archived = 0 GROUP BY status')
    .all();
  const countMap = {};
  for (const r of allCounts) countMap[r.status] = r.count;
  const pipeline = statusOrder.map((s) => ({
    status: s,
    label: statusLabels[s] || s,
    count: countMap[s] || 0,
  }));

  const { range } = req.query;
  let dateFilter = '';
  if (range === '30') dateFilter = "AND archived_at >= date('now', '-30 days')";
  else if (range === '90') dateFilter = "AND archived_at >= date('now', '-90 days')";
  else if (range === '365') dateFilter = "AND archived_at >= date('now', '-365 days')";

  let wonDateFilter = dateFilter.replace(/archived_at/g, 'updated_at');
  const wonCount = db
    .prepare(
      `SELECT COUNT(*) as count FROM jobs WHERE status IN ('complete','contract_signed') ${wonDateFilter}`,
    )
    .get().count;
  const lostCount = db
    .prepare(
      `SELECT COUNT(*) as count FROM jobs WHERE archived = 1 AND closed_reason IN ('lost_price','lost_timing','lost_competitor','ghosted') ${dateFilter}`,
    )
    .get().count;
  const totalClosed = wonCount + lostCount;
  const winRate = totalClosed > 0 ? Math.round((wonCount / totalClosed) * 100) : null;

  const lossReasons = db
    .prepare(
      `
    SELECT closed_reason, COUNT(*) as count FROM jobs
    WHERE archived = 1 AND closed_reason IN ('lost_price','lost_timing','lost_competitor','ghosted') ${dateFilter}
    GROUP BY closed_reason ORDER BY count DESC
  `,
    )
    .all();

  const lossLabels = {
    lost_price: 'Price',
    lost_timing: 'Timing',
    lost_competitor: 'Competitor',
    ghosted: 'Ghosted',
  };
  const lossBreakdown = lossReasons.map((r) => ({
    reason: r.closed_reason,
    label: lossLabels[r.closed_reason] || r.closed_reason,
    count: r.count,
  }));

  const velocityRows = db
    .prepare(
      `
    SELECT id, created_at FROM jobs
    WHERE status IN ('complete','contract_signed') ${wonDateFilter}
  `,
    )
    .all();

  const auditRows =
    velocityRows.length > 0
      ? db
          .prepare(
            `
        SELECT job_id, action, created_at FROM audit_log
        WHERE action IN ('proposal_sent_for_signing','contract_signed')
        ORDER BY created_at ASC
      `,
          )
          .all()
      : [];

  const auditByJob = {};
  for (const a of auditRows) {
    if (!auditByJob[a.job_id]) auditByJob[a.job_id] = {};
    if (!auditByJob[a.job_id][a.action]) auditByJob[a.job_id][a.action] = a.created_at;
  }

  let intakeToProposalDays = [];
  let proposalToSignedDays = [];
  for (const row of velocityRows) {
    const audit = auditByJob[row.id] || {};
    const created = new Date(row.created_at).getTime();
    if (audit.proposal_sent_for_signing) {
      const sentDate = new Date(audit.proposal_sent_for_signing).getTime();
      const days = (sentDate - created) / 86400000;
      if (days >= 0) intakeToProposalDays.push(days);
    }
    if (audit.proposal_sent_for_signing && audit.contract_signed) {
      const sentDate = new Date(audit.proposal_sent_for_signing).getTime();
      const signedDate = new Date(audit.contract_signed).getTime();
      const days = (signedDate - sentDate) / 86400000;
      if (days >= 0) proposalToSignedDays.push(days);
    }
  }

  const avg = (arr) =>
    arr.length > 0 ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10 : null;
  const proposalVelocity = {
    intakeToProposal: avg(intakeToProposalDays),
    proposalToSigned: avg(proposalToSignedDays),
    sampleSize: velocityRows.length,
    intakeToProposalCount: intakeToProposalDays.length,
    proposalToSignedCount: proposalToSignedDays.length,
  };

  const revenueRows = db
    .prepare(
      `
    SELECT total_value, updated_at FROM jobs
    WHERE status IN ('complete','contract_signed') AND total_value > 0 ${wonDateFilter}
    ORDER BY updated_at ASC
  `,
    )
    .all();

  const revenueByMonth = {};
  for (const r of revenueRows) {
    const d = new Date(r.updated_at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    revenueByMonth[key] = (revenueByMonth[key] || 0) + (r.total_value || 0);
  }

  const monthlyRevenue = Object.entries(revenueByMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, value]) => ({ month, value: Math.round(value) }));

  const totalJobs = db
    .prepare("SELECT COUNT(*) as count FROM jobs WHERE created_at >= date('now', 'start of year')")
    .get().count;
  const quotesYTD = db
    .prepare(
      "SELECT COUNT(*) as count FROM jobs WHERE created_at >= date('now', 'start of year') AND status NOT IN ('received','processing')",
    )
    .get().count;
  const pipelineValue = db
    .prepare('SELECT COALESCE(SUM(total_value), 0) as total FROM jobs WHERE archived = 0')
    .get().total;
  const wonRevenueYTD = db
    .prepare(
      "SELECT COALESCE(SUM(total_value), 0) as total FROM jobs WHERE status IN ('complete','contract_signed') AND updated_at >= date('now', 'start of year')",
    )
    .get().total;

  const avgMarginRows = db
    .prepare(
      `
    SELECT proposal_data FROM jobs
    WHERE status IN ('complete','contract_signed') AND proposal_data IS NOT NULL
  `,
    )
    .all();

  let marginSum = 0,
    marginCount = 0;
  for (const row of avgMarginRows) {
    try {
      const pd = JSON.parse(row.proposal_data);
      const lineItems = pd?.lineItems || [];
      const subTotal = lineItems.reduce((s, li) => s + (Number(li.baseCost) || 0), 0);
      const clientTotal = lineItems.reduce((s, li) => s + (Number(li.finalPrice) || 0), 0);
      if (subTotal > 0 && clientTotal > 0) {
        marginSum += ((clientTotal - subTotal) / clientTotal) * 100;
        marginCount++;
      }
    } catch {
      /* skip malformed row */
    }
  }

  const avgWonMargin = marginCount > 0 ? Math.round((marginSum / marginCount) * 10) / 10 : null;

  // Reconciliation: count paid invoices with no matching payment row linked via invoice_id
  const unlinkedPaidInvoices = db
    .prepare(
      `SELECT COUNT(*) as count FROM invoices i
       WHERE i.status = 'paid'
         AND NOT EXISTS (
           SELECT 1 FROM payments_received pr WHERE pr.invoice_id = i.id
         )`,
    )
    .get().count;

  // Reconciliation: count payment rows that reference an invoice_id but that invoice is not paid
  const paymentInvoiceMismatch = db
    .prepare(
      `SELECT COUNT(*) as count FROM payments_received pr
       JOIN invoices i ON i.id = pr.invoice_id
       WHERE i.status != 'paid' AND pr.credit_debit = 'credit'`,
    )
    .get().count;

  res.json({
    pipeline,
    winRate: { won: wonCount, lost: lostCount, total: totalClosed, rate: winRate },
    lossBreakdown,
    proposalVelocity,
    monthlyRevenue,
    summary: {
      totalJobs,
      quotesYTD,
      pipelineValue: Math.round(pipelineValue),
      wonRevenueYTD: Math.round(wonRevenueYTD),
      avgWonMargin,
    },
    reconciliation: {
      unlinkedPaidInvoices,
      paymentInvoiceMismatch,
    },
  });
});

router.get('/job/:id/context', requireAuth, (req, res) => {
  const db = getDb();
  const job = db
    .prepare('SELECT id, status, created_at, updated_at FROM jobs WHERE id = ?')
    .get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const STATUS_ACTIONS = [
    'status_changed',
    'archived',
    'restored',
    'proposal_generated',
    'proposal_sent_for_signing',
    'proposal_approved',
    'contract_generated',
    'contract_sent',
    'contract_signed',
    'customer_approved',
    'marked_complete',
  ];

  const lastStatusChange = db
    .prepare(
      `
    SELECT created_at FROM audit_log
    WHERE job_id = ? AND action IN (${STATUS_ACTIONS.map(() => '?').join(',')})
    ORDER BY created_at DESC LIMIT 1
  `,
    )
    .get(req.params.id, ...STATUS_ACTIONS);

  const now = Date.now();
  const stageEnteredAt = lastStatusChange
    ? new Date(lastStatusChange.created_at).getTime()
    : new Date(job.updated_at || job.created_at).getTime();
  const daysAtCurrentStage = Math.round(((now - stageEnteredAt) / 86400000) * 10) / 10;

  const wonJobs = db
    .prepare(
      `
    SELECT id, created_at FROM jobs WHERE status IN ('complete','contract_signed')
  `,
    )
    .all();

  const wonAudits =
    wonJobs.length > 0
      ? db
          .prepare(
            `
        SELECT job_id, action, created_at FROM audit_log
        WHERE action IN ('proposal_sent_for_signing','contract_signed')
        AND job_id IN (${wonJobs.map(() => '?').join(',')})
        ORDER BY created_at ASC
      `,
          )
          .all(...wonJobs.map((j) => j.id))
      : [];

  const wonAuditByJob = {};
  for (const a of wonAudits) {
    if (!wonAuditByJob[a.job_id]) wonAuditByJob[a.job_id] = {};
    if (!wonAuditByJob[a.job_id][a.action]) wonAuditByJob[a.job_id][a.action] = a.created_at;
  }

  let closeDays = [];
  for (const wj of wonJobs) {
    const audit = wonAuditByJob[wj.id] || {};
    const signedDate = audit.contract_signed;
    if (signedDate) {
      const days = (new Date(signedDate).getTime() - new Date(wj.created_at).getTime()) / 86400000;
      if (days >= 0) closeDays.push(days);
    }
  }

  const avgDaysToClose =
    closeDays.length > 0
      ? Math.round((closeDays.reduce((a, b) => a + b, 0) / closeDays.length) * 10) / 10
      : null;

  const wonMargins = db
    .prepare(
      `
    SELECT proposal_data FROM jobs
    WHERE status IN ('complete','contract_signed') AND proposal_data IS NOT NULL
  `,
    )
    .all();

  let margins = [];
  let sqftPrices = [];
  for (const row of wonMargins) {
    try {
      const pd = JSON.parse(row.proposal_data);
      const lineItems = pd?.lineItems || [];
      const subTotal = lineItems.reduce((s, li) => s + (Number(li.baseCost) || 0), 0);
      const clientTotal = lineItems.reduce((s, li) => s + (Number(li.finalPrice) || 0), 0);
      if (subTotal > 0 && clientTotal > 0) {
        margins.push(((clientTotal - subTotal) / clientTotal) * 100);
      }
      const sqft = Number(pd?.project?.sqft) || 0;
      if (sqft > 0 && clientTotal > 0) {
        sqftPrices.push(Math.round(clientTotal / sqft));
      }
    } catch {
      /* skip malformed row */
    }
  }

  const avgWonMargin =
    margins.length > 0
      ? Math.round((margins.reduce((a, b) => a + b, 0) / margins.length) * 10) / 10
      : null;
  const avgWonSqftPrice =
    sqftPrices.length > 0
      ? Math.round(sqftPrices.reduce((a, b) => a + b, 0) / sqftPrices.length)
      : null;

  res.json({
    daysAtCurrentStage,
    avgDaysToClose,
    avgDaysToCloseSample: closeDays.length,
    avgWonMargin,
    avgWonMarginSample: margins.length,
    avgWonSqftPrice,
    avgWonSqftPriceSample: sqftPrices.length,
  });
});

module.exports = router;
