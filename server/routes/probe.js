// server/routes/probe.js
// Read-only diagnostic probe — for Replit dev environment to query production
// Auth: Bearer token matched against PROBE_READ_TOKEN env var (set on prod server)
// ALL endpoints are GET only — no writes possible through this router

const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');

function requireProbeToken(req, res, next) {
  const token = process.env.PROBE_READ_TOKEN;
  if (!token) return res.status(503).json({ error: 'Probe not configured on this server' });

  const auth = req.headers['authorization'] || '';
  const provided = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!provided || provided !== token) {
    return res.status(401).json({ error: 'Invalid probe token' });
  }
  next();
}

// GET /api/probe/health — quick liveness + env check
router.get('/health', requireProbeToken, (req, res) => {
  res.json({
    ok: true,
    env: process.env.NODE_ENV || 'development',
    ts: new Date().toISOString(),
  });
});

// GET /api/probe/jobs?status=&limit= — job list summary
router.get('/jobs', requireProbeToken, (req, res) => {
  const db = getDb();
  const { status, limit = 20 } = req.query;
  let sql = `
    SELECT id, pb_number, customer_name, project_address, project_city, status,
           total_value, created_at, updated_at
    FROM jobs
    WHERE archived = 0
  `;
  const params = [];
  if (status) {
    sql += ' AND status = ?';
    params.push(status);
  }
  sql += ' ORDER BY updated_at DESC LIMIT ?';
  params.push(Number(limit));
  const jobs = db.prepare(sql).all(...params);
  res.json({ count: jobs.length, jobs });
});

// GET /api/probe/jobs/:id — single job with payment summary
router.get('/jobs/:id', requireProbeToken, (req, res) => {
  const db = getDb();
  const job = db
    .prepare(
      `SELECT id, customer_name, project_address, project_city, status,
              total_value, deposit_amount, created_at, updated_at, closed_reason
       FROM jobs WHERE id = ?`,
    )
    .get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const received = db
    .prepare('SELECT COALESCE(SUM(amount),0) AS total FROM payments_received WHERE job_id = ?')
    .get(job.id);
  const paid = db
    .prepare('SELECT COALESCE(SUM(amount),0) AS total FROM payments_made WHERE job_id = ?')
    .get(job.id);
  const invRow = db
    .prepare(
      `SELECT COALESCE(SUM(amt),0) AS total FROM (
        SELECT amount AS amt FROM invoices WHERE job_id = ? AND status NOT IN ('void')
        UNION ALL
        SELECT total  AS amt FROM direct_invoices WHERE job_id = ? AND status NOT IN ('void')
      )`,
    )
    .get(job.id, job.id);

  res.json({
    ...job,
    payments_received: received.total,
    payments_made: paid.total,
    invoiced_total: invRow.total,
  });
});

// GET /api/probe/jobs/:id/detail — all payments + invoices for one job
router.get('/jobs/:id/detail', requireProbeToken, (req, res) => {
  const db = getDb();
  const job = db
    .prepare(
      `SELECT id, pb_number, customer_name, customer_email, project_address, project_city,
              status, total_value, deposit_amount
       FROM jobs WHERE id = ?`,
    )
    .get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const paymentsIn = db
    .prepare(
      `SELECT id, amount, date_received, payment_type, check_number, payment_class, invoice_id, notes
       FROM payments_received WHERE job_id = ? ORDER BY date_received`,
    )
    .all(job.id);

  const paymentsOut = db
    .prepare(
      `SELECT id, amount, date_paid, category, check_number, payee_name, notes
       FROM payments_made WHERE job_id = ? ORDER BY date_paid`,
    )
    .all(job.id);

  const invoices = db
    .prepare(
      `SELECT id, invoice_number, invoice_type, status, amount, amount_paid, issued_at, paid_at
       FROM invoices WHERE job_id = ? ORDER BY issued_at`,
    )
    .all(job.id);

  const directInvoices = db
    .prepare(
      `SELECT id, invoice_number, status, total, issued_at, paid_at
       FROM direct_invoices WHERE job_id = ? ORDER BY issued_at`,
    )
    .all(job.id);

  const totalIn = paymentsIn.reduce((s, r) => s + r.amount, 0);
  const totalOut = paymentsOut.reduce((s, r) => s + r.amount, 0);
  const totalInvoiced =
    invoices.filter((i) => i.status !== 'void').reduce((s, i) => s + i.amount, 0) +
    directInvoices.filter((i) => i.status !== 'void').reduce((s, i) => s + i.total, 0);

  res.json({
    job,
    summary: {
      contract: job.total_value,
      invoiced: totalInvoiced,
      collected: totalIn,
      paid_out: totalOut,
      balance_due: job.total_value - totalIn,
      over_under_invoiced: totalInvoiced - totalIn,
    },
    payments_in: paymentsIn,
    payments_out: paymentsOut,
    invoices,
    direct_invoices: directInvoices,
  });
});

// GET /api/probe/stats — dashboard-level counts + totals
router.get('/stats', requireProbeToken, (req, res) => {
  const db = getDb();

  const statusCounts = db
    .prepare(
      `SELECT status, COUNT(*) AS cnt, COALESCE(SUM(total_value),0) AS value
       FROM jobs WHERE archived = 0 GROUP BY status`,
    )
    .all();

  const archived = db.prepare(`SELECT COUNT(*) AS cnt FROM jobs WHERE archived = 1`).get();

  const totalReceived = db
    .prepare(`SELECT COALESCE(SUM(amount),0) AS total FROM payments_received`)
    .get();

  const totalPaid = db.prepare(`SELECT COALESCE(SUM(amount),0) AS total FROM payments_made`).get();

  res.json({
    pipeline: statusCounts,
    archived: archived.cnt,
    all_time_received: totalReceived.total,
    all_time_paid_out: totalPaid.total,
  });
});

// GET /api/probe/payments?job_id= — recent payment records
router.get('/payments', requireProbeToken, (req, res) => {
  const db = getDb();
  const { job_id, limit = 30 } = req.query;

  let rSql = `SELECT r.id, r.job_id, r.amount, r.date_received, r.payment_type,
                     r.check_number, r.notes, r.payment_class, j.customer_name
              FROM payments_received r
              LEFT JOIN jobs j ON j.id = r.job_id WHERE 1=1`;
  let mSql = `SELECT m.id, m.job_id, m.amount, m.date_paid, m.category,
                     m.check_number, m.notes, m.payee_name, j.customer_name
              FROM payments_made m
              LEFT JOIN jobs j ON j.id = m.job_id WHERE 1=1`;
  const params = [];
  if (job_id) {
    rSql += ' AND r.job_id = ?';
    mSql += ' AND m.job_id = ?';
    params.push(job_id);
  }
  rSql += ' ORDER BY r.date_received DESC, r.created_at DESC LIMIT ?';
  mSql += ' ORDER BY m.date_paid DESC, m.created_at DESC LIMIT ?';

  const received = db.prepare(rSql).all(...params, Number(limit));
  const made = db.prepare(mSql).all(...params, Number(limit));
  res.json({ received, made });
});

// GET /api/probe/errors?limit= — last N server errors from error_log (if table exists)
router.get('/errors', requireProbeToken, (req, res) => {
  const db = getDb();
  const { limit = 20 } = req.query;
  try {
    const rows = db
      .prepare(
        `SELECT level, message, stack, created_at
         FROM error_log ORDER BY created_at DESC LIMIT ?`,
      )
      .all(Number(limit));
    res.json({ count: rows.length, errors: rows });
  } catch {
    res.json({ count: 0, errors: [], note: 'error_log table not present on this server' });
  }
});

module.exports = router;
