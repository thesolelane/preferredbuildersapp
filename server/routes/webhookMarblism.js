'use strict';
// server/routes/webhookMarblism.js
// Marblism AI receptionist webhook — receives inbound call data and creates a lead
const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const { logAudit } = require('../services/auditService');
const { notifyClients } = require('../services/sseManager');

const VALID_JOB_TYPES = ['residential', 'commercial', 'new_construction', 'renovation'];

function getStoredApiKey(db) {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'marblism_api_key'").get();
  return row?.value || null;
}

function remindAt(hours) {
  return new Date(Date.now() + hours * 3600000).toISOString().replace('T', ' ').slice(0, 19);
}

// GET /webhook/marblism/ping — health check (no auth)
router.get('/ping', (_req, res) => res.json({ ok: true, service: 'Marblism webhook' }));

// POST /webhook/marblism/call — Marblism posts call summary here after each call ends
router.post('/call', (req, res) => {
  const db = getDb();
  const storedKey = getStoredApiKey(db);

  const providedKey =
    req.headers['x-api-key'] || (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');

  if (!storedKey || providedKey !== storedKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const {
    caller_name = 'Unknown caller',
    caller_phone = 'Unknown number',
    caller_email = '',
    notes = '',
    job_address = '',
    job_city = '',
    job_scope = '',
    job_type = '',
    call_duration_seconds,
    call_id,
  } = req.body || {};

  const noteParts = [];
  if (notes) noteParts.push(notes.trim());
  if (call_duration_seconds != null) {
    const m = Math.floor(call_duration_seconds / 60);
    const s = call_duration_seconds % 60;
    noteParts.push(`Call duration: ${m}m ${s}s`);
  }
  if (call_id) noteParts.push(`Call ID: ${call_id}`);
  const fullNotes = noteParts.join('\n');

  const jt = VALID_JOB_TYPES.includes(job_type) ? job_type : '';

  try {
    const result = db
      .prepare(
        `INSERT INTO leads
           (caller_name, caller_phone, source, stage, notes,
            job_address, job_city, job_email, job_scope, job_type,
            created_at, updated_at)
         VALUES (?, ?, 'marblism', 'incoming', ?, ?, ?, ?, ?, ?,
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      )
      .run(
        String(caller_name).trim(),
        String(caller_phone).trim(),
        fullNotes,
        String(job_address).trim(),
        String(job_city).trim(),
        String(caller_email).trim(),
        String(job_scope).trim(),
        jt,
      );

    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(result.lastInsertRowid);

    // Auto-create high-priority callback task (48h)
    try {
      db.prepare(
        `INSERT INTO tasks
           (title, description, status, priority, lead_id,
            due_at, remind_at, remind_interval_hours, task_type,
            created_at, updated_at)
         VALUES (?, ?, 'pending', 'high', ?, ?, ?, 48, 'lead',
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      ).run(
        `📞 Callback: ${caller_name} (${caller_phone})`,
        [
          `Marblism inbound call from ${caller_name}.`,
          `Phone: ${caller_phone}`,
          fullNotes ? '\n' + fullNotes : '',
        ]
          .filter(Boolean)
          .join('\n')
          .trim(),
        lead.id,
        remindAt(48),
        remindAt(48),
      );
    } catch (taskErr) {
      console.error('[Marblism] Task creation error:', taskErr.message);
    }

    logAudit(
      null,
      'marblism_call',
      `Inbound call: ${caller_name} (${caller_phone}) → lead #${lead.id}`,
      'marblism',
    );

    notifyClients('new_lead', {
      leadId: lead.id,
      callerName: caller_name,
      callerPhone: caller_phone,
      source: 'marblism',
    });

    console.log(`[Marblism] Lead #${lead.id} created — ${caller_name} (${caller_phone})`);
    res.json({ ok: true, lead_id: lead.id });
  } catch (err) {
    console.error('[Marblism] Webhook error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
