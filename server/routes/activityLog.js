'use strict';
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getDb } = require('../db/database');

const VALID_EVENT_TYPES = [
  'ESTIMATE_CREATED',
  'ESTIMATE_APPROVED',
  'CONTRACT_GENERATED',
  'CONTRACT_SIGNED',
  'INVOICE_ISSUED',
  'PAYMENT_RECEIVED',
  'PAYMENT_MADE',
  'PASS_THROUGH_PAID',
  'PASS_THROUGH_REIMBURSED',
  'CHANGE_ORDER_CREATED',
  'INVOICE_UPDATED',
  'JOB_COMPLETED',
  'NOTE',
];

function logActivity({
  customer_number,
  job_id,
  event_type,
  description,
  document_ref,
  recorded_by,
}) {
  try {
    const db = getDb();
    db.prepare(
      `
      INSERT INTO customer_activity_log (customer_number, job_id, event_type, description, document_ref, recorded_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    ).run(
      customer_number || null,
      job_id || null,
      event_type,
      description,
      document_ref || null,
      recorded_by || 'system',
    );
  } catch (e) {
    console.warn('[activityLog] Failed to log:', e.message);
  }
}

router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const {
    customer_number,
    job_id,
    event_type,
    date_from,
    date_to,
    recorded_by,
    limit = 200,
    offset = 0,
  } = req.query;

  let sql = 'SELECT * FROM customer_activity_log WHERE 1=1';
  const params = [];

  if (customer_number) {
    sql += ' AND customer_number = ?';
    params.push(customer_number);
  }
  if (job_id) {
    sql += ' AND job_id = ?';
    params.push(job_id);
  }
  if (event_type) {
    sql += ' AND event_type = ?';
    params.push(event_type);
  }
  if (date_from) {
    sql += ' AND created_at >= ?';
    params.push(date_from);
  }
  if (date_to) {
    sql += ' AND created_at <= ?';
    params.push(date_to + ' 23:59:59');
  }
  if (recorded_by) {
    sql += ' AND recorded_by = ?';
    params.push(recorded_by);
  }

  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), parseInt(offset));

  const entries = db.prepare(sql).all(...params);

  const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as total').replace(/ ORDER BY.*/, '');
  const total = db.prepare(countSql).get(...params.slice(0, -2))?.total || 0;

  res.json({ entries, total });
});

router.post('/', requireAuth, (req, res) => {
  const { customer_number, job_id, event_type, description, document_ref } = req.body;

  if (!description) return res.status(400).json({ error: 'description is required' });
  const evType = VALID_EVENT_TYPES.includes(event_type) ? event_type : 'NOTE';
  const recorder = req.session?.name || 'staff';

  logActivity({
    customer_number,
    job_id,
    event_type: evType,
    description,
    document_ref,
    recorded_by: recorder,
  });

  const db = getDb();
  const entry = db.prepare('SELECT * FROM customer_activity_log ORDER BY id DESC LIMIT 1').get();
  res.json({ entry });
});

module.exports = { router, logActivity };
