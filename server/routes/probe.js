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
    SELECT id, customer_name, project_address, project_city, status,
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

  let rSql = `SELECT r.*, j.customer_name FROM payments_received r
              LEFT JOIN jobs j ON j.id = r.job_id WHERE 1=1`;
  let mSql = `SELECT m.*, j.customer_name FROM payments_made m
              LEFT JOIN jobs j ON j.id = m.job_id WHERE 1=1`;
  const params = [];
  if (job_id) {
    rSql += ' AND r.job_id = ?';
    mSql += ' AND m.job_id = ?';
    params.push(job_id);
  }
  rSql += ' ORDER BY r.date DESC, r.created_at DESC LIMIT ?';
  mSql += ' ORDER BY m.date DESC, m.created_at DESC LIMIT ?';

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
