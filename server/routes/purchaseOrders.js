// server/routes/purchaseOrders.js
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getDb } = require('../db/database');

// Status lifecycle: draft → issued → received → closed

// ── PO number generator: PO-YYYY-NNNN ────────────────────────────────────────
function generatePONumber(db) {
  const year = new Date().getFullYear();
  try {
    const existing = db.prepare('SELECT next_seq FROM po_counter WHERE year = ?').get(year);
    let seq;
    if (existing) {
      seq = existing.next_seq;
      db.prepare('UPDATE po_counter SET next_seq = ? WHERE year = ?').run(seq + 1, year);
    } else {
      seq = 1;
      db.prepare('INSERT INTO po_counter (year, next_seq) VALUES (?, ?)').run(year, seq + 1);
    }
    return `PO-${year}-${String(seq).padStart(4, '0')}`;
  } catch (e) {
    console.warn('[PO] po_number gen failed:', e.message);
    return `PO-${year}-${String(Date.now()).slice(-4)}`;
  }
}

// ── Lifecycle timestamp helper ────────────────────────────────────────────────
// When status transitions, set the appropriate timestamp if not already set
function lifecyclePatch(existing, newStatus) {
  const now = new Date().toISOString();
  const patch = {};
  if (newStatus === 'issued' && !existing.issued_at) patch.issued_at = now;
  if (newStatus === 'received' && !existing.received_at) patch.received_at = now;
  if (newStatus === 'closed' && !existing.closed_at) patch.closed_at = now;
  return patch;
}

// ── GET /api/purchase-orders ──────────────────────────────────────────────────
// Supports: ?job_id=, ?contact_id=, ?status=open|draft|issued|received|closed
router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const { job_id, contact_id, status } = req.query;

  const conditions = ['1=1'];
  const params = [];

  if (job_id) {
    conditions.push('po.job_id = ?');
    params.push(job_id);
  }
  if (contact_id) {
    conditions.push('po.contact_id = ?');
    params.push(contact_id);
  }
  if (status === 'open') {
    conditions.push(`po.status != 'closed'`);
  } else if (status) {
    conditions.push('po.status = ?');
    params.push(status);
  }

  const sql = `
    SELECT po.*,
           v.company_name AS vendor_company,
           j.pb_number, j.customer_name, j.project_address
    FROM purchase_orders po
    LEFT JOIN vendors v ON v.id = po.vendor_id
    LEFT JOIN jobs j    ON j.id = po.job_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY po.created_at DESC
  `;

  const rows = db.prepare(sql).all(...params);
  res.json({ purchase_orders: rows });
});

// ── GET /api/purchase-orders/report?period=ytd ────────────────────────────────
router.get('/report', requireAuth, (req, res) => {
  const db = getDb();
  const { period } = req.query;

  const now = new Date();
  const yr = now.getFullYear();
  const mo = now.getMonth();
  let from = null;
  if (period === 'mtd') from = `${yr}-${String(mo + 1).padStart(2, '0')}-01`;
  else if (period === 'qtd') {
    const q = Math.floor(mo / 3);
    from = `${yr}-${String(q * 3 + 1).padStart(2, '0')}-01`;
  } else if (period === 'ytd') from = `${yr}-01-01`;
  else if (period === '12mo') {
    const d = new Date(now);
    d.setFullYear(d.getFullYear() - 1);
    from = d.toISOString().slice(0, 10);
  }

  const dFilter = from ? `AND po.created_at >= '${from}'` : '';

  const totals = db
    .prepare(
      `
    SELECT
      COUNT(*) AS count,
      SUM(CASE WHEN po.status NOT IN ('closed') THEN po.amount ELSE 0 END) AS total_spend,
      SUM(CASE WHEN po.status IN ('draft','issued') THEN po.amount ELSE 0 END) AS open_total,
      SUM(CASE WHEN po.status = 'received' THEN po.amount ELSE 0 END) AS received,
      SUM(CASE WHEN po.status = 'closed'   THEN po.amount ELSE 0 END) AS closed
    FROM purchase_orders po
    WHERE 1=1 ${dFilter}
  `,
    )
    .get();

  const byCategory = db
    .prepare(
      `
    SELECT po.category, COUNT(*) AS count, SUM(po.amount) AS total
    FROM purchase_orders po
    WHERE po.status != 'closed' ${dFilter}
    GROUP BY po.category
    ORDER BY total DESC
  `,
    )
    .all();

  // Open PO spend by job (draft + issued = "open")
  const openByJob = db
    .prepare(
      `
    SELECT po.job_id, j.pb_number, j.customer_name, j.project_address,
           COUNT(*) AS po_count,
           SUM(po.amount) AS po_total
    FROM purchase_orders po
    LEFT JOIN jobs j ON j.id = po.job_id
    WHERE po.status IN ('draft','issued') ${dFilter}
    GROUP BY po.job_id
    ORDER BY po_total DESC
    LIMIT 20
  `,
    )
    .all();

  const byStatus = db
    .prepare(
      `
    SELECT po.status, COUNT(*) AS count, SUM(po.amount) AS total
    FROM purchase_orders po
    WHERE 1=1 ${dFilter}
    GROUP BY po.status
    ORDER BY total DESC
  `,
    )
    .all();

  const recent = db
    .prepare(
      `
    SELECT po.*, j.pb_number, j.customer_name, j.project_address
    FROM purchase_orders po
    LEFT JOIN jobs j ON j.id = po.job_id
    WHERE 1=1 ${dFilter}
    ORDER BY po.created_at DESC
    LIMIT 50
  `,
    )
    .all();

  res.json({ totals, byCategory, openByJob, byStatus, recent });
});

// ── POST /api/purchase-orders ─────────────────────────────────────────────────
router.post('/', requireAuth, (req, res) => {
  const db = getDb();
  const {
    job_id,
    contact_id,
    vendor_id,
    vendor_name,
    description,
    category,
    amount,
    status,
    notes,
    created_by,
  } = req.body;

  if (!job_id || !job_id.trim()) return res.status(400).json({ error: 'job_id is required' });
  if (!description || !description.trim())
    return res.status(400).json({ error: 'description is required' });

  const initialStatus = status || 'draft';
  const poNumber = generatePONumber(db);
  const now = new Date().toISOString();

  // Set lifecycle timestamps for initial status
  const issued_at = initialStatus === 'issued' ? now : null;
  const received_at = initialStatus === 'received' ? now : null;
  const closed_at = initialStatus === 'closed' ? now : null;

  const result = db
    .prepare(
      `
    INSERT INTO purchase_orders
      (po_number, job_id, contact_id, vendor_id, vendor_name, description,
       category, amount, status, issued_at, received_at, closed_at, created_by, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    )
    .run(
      poNumber,
      job_id.trim(),
      contact_id || null,
      vendor_id || null,
      vendor_name || null,
      description.trim(),
      category || 'materials',
      Number(amount) || 0,
      initialStatus,
      issued_at,
      received_at,
      closed_at,
      created_by || null,
      notes || null,
    );

  const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(result.lastInsertRowid);
  res.json({ success: true, purchase_order: po });
});

// ── PATCH /api/purchase-orders/:id ───────────────────────────────────────────
router.patch('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Purchase order not found' });

  const { vendor_id, vendor_name, description, category, amount, status, notes, contact_id } =
    req.body;

  const newStatus = status || existing.status;
  const tsPatches = lifecyclePatch(existing, newStatus);

  db.prepare(
    `
    UPDATE purchase_orders SET
      contact_id  = ?,
      vendor_id   = ?,
      vendor_name = ?,
      description = ?,
      category    = ?,
      amount      = ?,
      status      = ?,
      issued_at   = COALESCE(?, issued_at),
      received_at = COALESCE(?, received_at),
      closed_at   = COALESCE(?, closed_at),
      notes       = ?,
      updated_at  = CURRENT_TIMESTAMP
    WHERE id = ?
  `,
  ).run(
    contact_id !== undefined ? contact_id || null : existing.contact_id,
    vendor_id !== undefined ? vendor_id || null : existing.vendor_id,
    vendor_name !== undefined ? vendor_name || null : existing.vendor_name,
    description !== undefined ? description || null : existing.description,
    category || existing.category,
    amount !== undefined ? Number(amount) || 0 : existing.amount,
    newStatus,
    tsPatches.issued_at || null,
    tsPatches.received_at || null,
    tsPatches.closed_at || null,
    notes !== undefined ? notes || null : existing.notes,
    req.params.id,
  );

  const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id);
  res.json({ success: true, purchase_order: po });
});

// ── POST /api/purchase-orders/:id/attachment ──────────────────────────────────
router.post('/:id/attachment', requireAuth, async (req, res) => {
  const path = require('path');
  const fs = require('fs');
  const db = getDb();
  const existing = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Purchase order not found' });

  if (!req.files || !req.files.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const file = req.files.file;
  const ext = path.extname(file.name) || '.pdf';
  const filename = `po_${req.params.id}_${Date.now()}${ext}`;
  const destDir = path.resolve(__dirname, '../../uploads/po_attachments', String(req.params.id));
  fs.mkdirSync(destDir, { recursive: true });
  const destPath = path.join(destDir, filename);

  try {
    await file.mv(destPath);
  } catch (err) {
    console.error('[PO attachment] File move error:', err);
    return res.status(500).json({ error: 'Failed to save file' });
  }

  db.prepare(
    'UPDATE purchase_orders SET attachment_path = ?, attachment_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
  ).run(`/po-attachments/${req.params.id}/${filename}`, file.name, req.params.id);

  const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id);
  res.json({ success: true, purchase_order: po });
});

// ── DELETE /api/purchase-orders/:id ──────────────────────────────────────────
router.delete('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM purchase_orders WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Purchase order not found' });
  db.prepare('DELETE FROM purchase_orders WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
