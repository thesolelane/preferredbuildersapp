// server/routes/emailLog.js
const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const { requireAuth } = require('../middleware/auth');

// GET /api/email-log — stats + recent emails
router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const limit = Math.min(Number(req.query.limit) || 100, 500);

  const today = db
    .prepare(
      `
    SELECT COUNT(*) as count FROM email_log
    WHERE date(sent_at) = date('now')
  `,
    )
    .get();

  const thisMonth = db
    .prepare(
      `
    SELECT COUNT(*) as count FROM email_log
    WHERE strftime('%Y-%m', sent_at) = strftime('%Y-%m', 'now')
  `,
    )
    .get();

  const thisYear = db
    .prepare(
      `
    SELECT COUNT(*) as count FROM email_log
    WHERE strftime('%Y', sent_at) = strftime('%Y', 'now')
  `,
    )
    .get();

  const total = db.prepare(`SELECT COUNT(*) as count FROM email_log`).get();

  const openedCount = db
    .prepare(`SELECT COUNT(*) as count FROM email_log WHERE opened_at IS NOT NULL`)
    .get();

  const byType = db
    .prepare(
      `
    SELECT email_type, COUNT(*) as count FROM email_log
    GROUP BY email_type ORDER BY count DESC
  `,
    )
    .all();

  const byDay = db
    .prepare(
      `
    SELECT date(sent_at) as day, COUNT(*) as count
    FROM email_log
    WHERE sent_at >= date('now', '-30 days')
    GROUP BY day ORDER BY day DESC
  `,
    )
    .all();

  const byMonth = db
    .prepare(
      `
    SELECT strftime('%Y-%m', sent_at) as month, COUNT(*) as count
    FROM email_log
    GROUP BY month ORDER BY month DESC LIMIT 12
  `,
    )
    .all();

  const emails = db
    .prepare(
      `
    SELECT id, message_id, to_address, subject, email_type, job_id,
           sent_at, opened_at, opened_count,
           CASE WHEN html_body IS NOT NULL THEN 1 ELSE 0 END as has_preview
    FROM email_log
    ORDER BY sent_at DESC LIMIT ?
  `,
    )
    .all(limit);

  res.json({
    stats: {
      today: today.count,
      thisMonth: thisMonth.count,
      thisYear: thisYear.count,
      total: total.count,
      opened: openedCount.count,
    },
    byType,
    byDay,
    byMonth,
    emails,
  });
});

// GET /api/email-log/diag — quick table diagnostic
// NOTE: must be declared before /:id/preview so Express doesn't treat "diag" as an id
router.get('/diag', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const count = db.prepare('SELECT COUNT(*) as n FROM email_log').get();
    const latest = db.prepare('SELECT * FROM email_log ORDER BY sent_at DESC LIMIT 5').all();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all();
    res.json({ emailLogCount: count.n, latest, tables: tables.map((t) => t.name) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/email-log/:id/preview — return stored html_body for a single email
router.get('/:id/preview', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const row = db.prepare('SELECT html_body FROM email_log WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (!row.html_body)
      return res
        .status(410)
        .json({ error: 'Preview not available — wiped after contract signing' });
    res.setHeader('Content-Type', 'text/html');
    res.send(row.html_body);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /resend — Resend email event webhook (mounted at /webhook/resend)
// Register this URL in Resend dashboard → Webhooks → Add endpoint
// Events: email.opened, email.clicked, email.delivered, email.bounced
router.post('/resend', express.json(), async (req, res) => {
  res.json({ ok: true }); // always ack immediately

  try {
    const db = getDb();
    const type = req.body?.type; // e.g. "email.opened"
    const emailData = req.body?.data || {};
    const emailId = emailData.email_id; // matches message_id stored at send time

    if (!type || !emailId) return;

    if (type === 'email.opened' || type === 'email.clicked') {
      const isFirstOpen = db
        .prepare(
          `
        SELECT opened_at FROM email_log WHERE message_id = ?
      `,
        )
        .get(emailId);

      db.prepare(
        `
        UPDATE email_log
        SET opened_at    = COALESCE(opened_at, CURRENT_TIMESTAMP),
            opened_count = opened_count + 1
        WHERE message_id = ?
      `,
      ).run(emailId);

      // Notify owners on first open only
      if (isFirstOpen && !isFirstOpen.opened_at) {
        const logRow = db
          .prepare(
            `
          SELECT to_address, subject, email_type, job_id FROM email_log WHERE message_id = ?
        `,
          )
          .get(emailId);

        if (logRow && logRow.email_type !== 'system_alert') {
          const { sendEmail, getOwnerEmails } = require('../services/emailService');
          const owners = getOwnerEmails();
          if (owners.length) {
            const when = new Date().toLocaleString('en-US', {
              dateStyle: 'medium',
              timeStyle: 'short',
              timeZone: 'America/New_York',
            });
            const typeLabel =
              {
                proposal_signing: 'Proposal signing link',
                contract: 'Contract email',
                acknowledgement: 'Acknowledgement email',
                general: 'Email',
              }[logRow.email_type] || 'Email';

            await sendEmail({
              to: owners,
              subject: `📬 ${typeLabel} opened — ${logRow.to_address}`,
              html: `<p><strong>${typeLabel}</strong> was opened by <strong>${logRow.to_address}</strong>.</p>
                     <p><strong>Subject:</strong> ${logRow.subject || '—'}</p>
                     <p><strong>Time:</strong> ${when}</p>
                     ${logRow.job_id ? `<p><a href="${process.env.APP_URL || ''}/jobs/${logRow.job_id}">View job →</a></p>` : ''}`,
              emailType: 'system_alert',
              jobId: logRow.job_id || null,
            });
          }
        }
      }
    }

    if (type === 'email.bounced') {
      console.warn(`[Resend] Email bounced — id:${emailId} to:${emailData.to?.[0]}`);
    }
  } catch (err) {
    console.error('[Resend webhook]', err.message);
  }
});

module.exports = router;
