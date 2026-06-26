'use strict';
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { requireAuth } = require('../middleware/auth');
const { getDb } = require('../db/database');
const { logAudit } = require('../services/auditService');
const { findOrCreateContact, generatePbCustomerNumber } = require('../services/jobHelpers');
const { enrichPropertyBackground } = require('../services/propertyEnrichment');
const gcal = require('../services/googleCalendar');

const FIELD_PHOTOS_DIR = path.resolve(__dirname, '../../uploads/field_photos');
const LEAD_DOCS_DIR = path.resolve(__dirname, '../../uploads/lead_docs');
const CONTACT_DOCS_DIR = path.resolve(__dirname, '../../uploads/contact_docs');

const VALID_STAGES = [
  'incoming',
  'callback_done',
  'appointment_booked',
  'site_visit_complete',
  'quote_draft',
  'quote_sent',
  'follow_up_1',
  'follow_up_2',
  'signed',
  'rejected',
];
const VALID_SOURCES = ['marblism', 'referral', 'web', 'walk-in', 'other'];
const VALID_ARCHIVE_REASONS = ['price', 'timing', 'no_response', 'other'];
const VALID_JOB_TYPES = ['residential', 'commercial', 'new_construction', 'renovation'];

// ── Google Calendar add-event URL ─────────────────────────────────────────────
function calDate(iso) {
  return iso
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z?$/, '')
    .slice(0, 15);
}
function makeCalURL({ title, startIso, durationHours = 1, description = '', location = '' }) {
  try {
    const start = calDate(new Date(startIso).toISOString());
    const endDt = new Date(new Date(startIso).getTime() + durationHours * 3600000);
    const end = calDate(endDt.toISOString());
    // ctz=UTC tells Google Calendar that the floating date/time values are UTC,
    // so it converts to the viewer's local timezone correctly (fixes 3-4h offset).
    const parts = [
      'action=TEMPLATE',
      `text=${encodeURIComponent(title)}`,
      `dates=${start}/${end}`,
      'ctz=UTC',
    ];
    if (description) parts.push(`details=${encodeURIComponent(description)}`);
    if (location) parts.push(`location=${encodeURIComponent(location)}`);
    return `https://calendar.google.com/calendar/render?${parts.join('&')}`;
  } catch {
    return null;
  }
}

// ── Calendar settings from DB (mirrors tasks.js) ──────────────────────────────
function getCalSettings(db) {
  const calId =
    db.prepare("SELECT value FROM settings WHERE key = 'gcal.calendarId'").get()?.value ||
    'primary';
  const enabled = db.prepare("SELECT value FROM settings WHERE key = 'gcal.enabled'").get()?.value;
  return { calendarId: calId, enabled: enabled !== 'false' };
}

// ── Remind-at helper ──────────────────────────────────────────────────────────
function remindAt(hours) {
  return new Date(Date.now() + hours * 3600000).toISOString().replace('T', ' ').slice(0, 19);
}

// ── Contact lookup: phone-first, then name, then create ──────────────────────
function resolveContact(db, { name, phone, email, address, city }) {
  let contact = null;
  if (phone && phone !== 'Unknown number') {
    contact = db.prepare('SELECT * FROM contacts WHERE phone = ? LIMIT 1').get(phone.trim());
  }
  if (!contact && email) {
    contact = db
      .prepare('SELECT * FROM contacts WHERE email = ? COLLATE NOCASE LIMIT 1')
      .get(email.trim());
  }
  if (!contact && name && name !== 'Unknown caller') {
    contact = db
      .prepare('SELECT * FROM contacts WHERE name = ? COLLATE NOCASE LIMIT 1')
      .get(name.trim());
  }

  if (contact) {
    const sets = [];
    const vals = [];
    if (!contact.phone && phone && phone !== 'Unknown number') {
      sets.push('phone = ?');
      vals.push(phone.trim());
    }
    if (!contact.email && email) {
      sets.push('email = ?');
      vals.push(email.trim());
    }
    if (!contact.address && address) {
      sets.push('address = ?');
      vals.push(address.trim());
    }
    if (!contact.city && city) {
      sets.push('city = ?');
      vals.push(city.trim());
    }
    if (sets.length) {
      sets.push('updated_at = CURRENT_TIMESTAMP');
      vals.push(contact.id);
      db.prepare(`UPDATE contacts SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    }
    if (!contact.pb_customer_number) {
      const pbn = generatePbCustomerNumber(db);
      if (pbn) {
        db.prepare('UPDATE contacts SET pb_customer_number = ? WHERE id = ?').run(pbn, contact.id);
        contact.pb_customer_number = pbn;
      }
    }
    return { id: contact.id, pb_customer_number: contact.pb_customer_number };
  }

  return findOrCreateContact(db, {
    name,
    phone,
    email: email || '',
    address: address || '',
    city: city || '',
    state: 'MA',
  });
}

// ── Auto-create task on stage transitions ─────────────────────────────────────
function autoTask(db, lead, nextStage, performer) {
  const name = lead.caller_name;
  const phone = lead.caller_phone;
  const addr = [lead.job_address, lead.job_city].filter(Boolean).join(', ') || '';

  const taskDefs = {
    callback_done: {
      title: `📞 Callback: ${name} (${phone})`,
      description: `Follow up with ${name} — Marblism missed call.\nPhone: ${phone}`,
      priority: 'high',
      remind_at: remindAt(48),
      remind_interval_hours: 48,
      due_at: remindAt(48),
    },
    appointment_booked: lead.appointment_at
      ? {
          title: `📅 Site Visit: ${name}${addr ? ' — ' + addr : ''}`,
          description: `Site visit with ${name} (${phone}).\n${addr ? 'Address: ' + addr : ''}`,
          priority: 'high',
          due_at: lead.appointment_at,
          remind_at: lead.appointment_at,
          remind_interval_hours: 168,
          calendar_url: makeCalURL({
            title: `Site Visit: ${name}`,
            startIso: lead.appointment_at,
            durationHours: 2,
            description: `Site visit with ${name} (${phone})`,
            location: addr,
          }),
        }
      : null,
    site_visit_complete: {
      title: `📋 Create Proposal: ${name}${addr ? ' — ' + addr : ''}`,
      description: `Site visit complete for ${name} (${phone}). Next step: create scope of work / proposal.${addr ? '\nAddress: ' + addr : ''}${lead.job_scope ? '\nScope: ' + lead.job_scope : ''}`,
      priority: 'high',
      due_at: remindAt(48),
      remind_at: remindAt(48),
      remind_interval_hours: 48,
    },
    quote_draft: {
      title: `📋 Proposal Draft: ${name}${addr ? ' — ' + addr : ''}`,
      description: `Create scope of work / proposal for ${name} (${phone}).${addr ? '\nAddress: ' + addr : ''}${lead.job_scope ? '\nScope: ' + lead.job_scope : ''}`,
      priority: 'normal',
      due_at: remindAt(48),
      remind_at: remindAt(48),
      remind_interval_hours: 48,
    },
    quote_sent: {
      title: `✉ Proposal Sent: ${name}${addr ? ' — ' + addr : ''}`,
      description: `Proposal sent to ${name} (${phone}). Follow up if no response within 7 days.${addr ? '\nAddress: ' + addr : ''}`,
      priority: 'normal',
      due_at: remindAt(7 * 24),
      remind_at: remindAt(7 * 24),
      remind_interval_hours: 168,
    },
    follow_up_1: {
      title: `📞 Follow-up 1: ${name} (${phone})`,
      description: `First follow-up call after proposal sent to ${name}.\nPhone: ${phone}`,
      priority: 'normal',
      due_at: remindAt(7 * 24),
      remind_at: remindAt(7 * 24),
      remind_interval_hours: 168,
    },
    follow_up_2: {
      title: `📞 Follow-up 2: ${name} (${phone})`,
      description: `Second follow-up call — ${name} has not responded.\nPhone: ${phone}`,
      priority: 'high',
      due_at: remindAt(7 * 24),
      remind_at: remindAt(7 * 24),
      remind_interval_hours: 168,
    },
  };

  const def = taskDefs[nextStage];
  if (!def) return null;

  try {
    db.prepare(
      `UPDATE tasks SET status = 'done', updated_at = CURRENT_TIMESTAMP
       WHERE lead_id = ? AND task_type = 'lead' AND status IN ('pending', 'in_progress')`,
    ).run(lead.id);

    const row = db
      .prepare(
        `
      INSERT INTO tasks
        (title, description, status, priority, contact_id, lead_id, due_at, remind_at, remind_interval_hours, calendar_url, task_type, created_at, updated_at)
      VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, 'lead', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `,
      )
      .run(
        def.title,
        def.description || '',
        def.priority || 'normal',
        lead.contact_id || null,
        lead.id,
        def.due_at || null,
        def.remind_at || null,
        def.remind_interval_hours || 168,
        def.calendar_url || null,
      );
    logAudit(
      null,
      'lead_auto_task',
      `Lead #${lead.id}: task #${row.lastInsertRowid} auto-created for stage ${nextStage}`,
      performer,
    );

    // Push appointment_booked tasks to Google Calendar automatically
    if (nextStage === 'appointment_booked' && def.due_at) {
      const taskId = row.lastInsertRowid;
      const taskRow = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
      const { calendarId, enabled } = getCalSettings(db);
      if (enabled && taskRow) {
        gcal
          .createCalendarEvent(
            { ...taskRow, project_address: addr },
            calendarId,
            [],
          )
          .then((link) => {
            if (link) db.prepare('UPDATE tasks SET calendar_url = ? WHERE id = ?').run(link, taskId);
          })
          .catch((e) => console.warn('[Leads] GCal push failed:', e.message));
      }
    }

    return row.lastInsertRowid;
  } catch (e) {
    console.error('[Leads] autoTask error:', e.message);
    return null;
  }
}

// ── GET /api/leads ─────────────────────────────────────────────────────────────
router.get('/', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const archived = req.query.archived === '1' ? 1 : 0;
    const leads = db
      .prepare(
        `
        SELECT l.*, j.pb_number AS job_pb_number, j.status AS job_status
        FROM leads l
        LEFT JOIN jobs j ON l.job_id = j.id
        WHERE l.archived = ?
        ORDER BY l.updated_at DESC
      `,
      )
      .all(archived);
    res.json({ leads });
  } catch (err) {
    console.error('[Leads] list error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/leads/:id ─────────────────────────────────────────────────────────
router.get('/:id', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    res.json({ lead });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/leads — create a lead manually ──────────────────────────────────
router.post('/', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const {
      caller_name,
      caller_phone,
      source = 'other',
      notes = '',
      job_address = '',
      job_city = '',
      job_email = '',
      job_scope = '',
      job_type = '',
    } = req.body;
    if (!caller_name || !caller_phone) {
      return res.status(400).json({ error: 'caller_name and caller_phone are required' });
    }
    const src = VALID_SOURCES.includes(source) ? source : 'other';
    const jt = VALID_JOB_TYPES.includes(job_type) ? job_type : '';
    const result = db
      .prepare(
        `
      INSERT INTO leads
        (caller_name, caller_phone, source, notes, job_address, job_city, job_email, job_scope, job_type, stage, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'incoming', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `,
      )
      .run(
        caller_name.trim(),
        caller_phone.trim(),
        src,
        notes || '',
        job_address,
        job_city,
        job_email,
        job_scope,
        jt,
      );

    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(result.lastInsertRowid);
    logAudit(
      null,
      'lead_created',
      `Lead #${lead.id} created — ${caller_name} (${caller_phone}) source=${src}`,
      req.session?.name || 'admin',
    );
    res.status(201).json({ lead });

    // Background property enrichment (non-blocking)
    const fullAddr = [job_address, job_city, 'MA'].filter(Boolean).join(', ');
    if (job_address) enrichPropertyBackground(db, 'lead', lead.id, fullAddr);
  } catch (err) {
    console.error('[Leads] create error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/leads/:id — update stage, notes, job details ──────────────────
router.patch('/:id', requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const leadId = parseInt(req.params.id, 10);
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const performer = req.session?.name || 'admin';
    const {
      stage,
      notes,
      archive_reason,
      appointment_at,
      job_address,
      job_city,
      job_email,
      job_scope,
      job_type,
      job_id,
    } = req.body;

    const updates = [];
    const params = [];

    // ── Plain field updates ─────────────────────────────────────────────────
    const textFields = { notes, job_address, job_city, job_email, job_scope };
    for (const [col, val] of Object.entries(textFields)) {
      if (val !== undefined) {
        updates.push(`${col} = ?`);
        params.push(val);
      }
    }
    if (job_id !== undefined) {
      updates.push('job_id = ?');
      params.push(job_id || null);
    }
    if (job_type !== undefined && (VALID_JOB_TYPES.includes(job_type) || job_type === '')) {
      updates.push('job_type = ?');
      params.push(job_type);
    }
    if (appointment_at !== undefined) {
      updates.push('appointment_at = ?');
      params.push(appointment_at || null);
    }

    // ── Stage transition ────────────────────────────────────────────────────
    if (stage !== undefined) {
      if (!VALID_STAGES.includes(stage)) {
        return res.status(400).json({ error: `Invalid stage: ${stage}` });
      }
      updates.push('stage = ?');
      params.push(stage);

      // Merge any incoming job details into the lead before using them
      const merged = {
        ...lead,
        job_address: job_address ?? lead.job_address,
        job_city: job_city ?? lead.job_city,
        job_email: job_email ?? lead.job_email,
        job_scope: job_scope ?? lead.job_scope,
        appointment_at: appointment_at ?? lead.appointment_at,
      };

      // Archiving
      if (stage === 'rejected') {
        updates.push('archived = 1');
        if (archive_reason) {
          const reason = VALID_ARCHIVE_REASONS.includes(archive_reason) ? archive_reason : 'other';
          updates.push('archive_reason = ?');
          params.push(reason);
        }
      }

      // Contact creation on quote_sent OR signed (idempotent — whichever comes first)
      if ((stage === 'quote_sent' || stage === 'signed') && !lead.contact_id) {
        try {
          const ref = resolveContact(db, {
            name: lead.caller_name,
            phone: lead.caller_phone,
            email: merged.job_email || '',
            address: merged.job_address || '',
            city: merged.job_city || '',
          });
          updates.push('contact_id = ?');
          params.push(ref.id);
          updates.push('pb_customer_number = ?');
          params.push(ref.pb_customer_number || '');
          merged.contact_id = ref.id;
          logAudit(
            null,
            'lead_contact_created',
            `Lead #${leadId}: contact #${ref.id} (${ref.pb_customer_number || 'n/a'}) created — ${lead.caller_name}`,
            performer,
          );

          // Graduate lead documents → contact_documents
          try {
            const leadDocs = db
              .prepare('SELECT * FROM lead_documents WHERE lead_id = ?')
              .all(leadId);
            if (leadDocs.length > 0) {
              const contactDocDir = path.join(CONTACT_DOCS_DIR, String(ref.id));
              if (!fs.existsSync(contactDocDir)) fs.mkdirSync(contactDocDir, { recursive: true });
              const alreadyLinked = db
                .prepare(
                  `SELECT filename FROM contact_documents WHERE contact_id = ? AND source = 'lead_graduation'`,
                )
                .all(ref.id)
                .map((r) => r.filename);
              const insertDoc = db.prepare(
                `INSERT INTO contact_documents
                   (contact_id, filename, original_name, mime_type, file_path, source, created_at)
                 VALUES (?, ?, ?, ?, ?, 'lead_graduation', CURRENT_TIMESTAMP)`,
              );
              let copied = 0;
              for (const doc of leadDocs) {
                if (alreadyLinked.includes(doc.filename)) continue;
                const src = path.join(LEAD_DOCS_DIR, String(leadId), doc.filename);
                const dest = path.join(contactDocDir, doc.filename);
                if (fs.existsSync(src) && !fs.existsSync(dest)) {
                  fs.copyFileSync(src, dest);
                }
                insertDoc.run(
                  ref.id,
                  doc.filename,
                  doc.original_name || doc.filename,
                  doc.mime_type || null,
                  dest,
                );
                copied++;
              }
              if (copied > 0) {
                console.log(
                  `[Leads] Graduated ${copied} document(s) from lead #${leadId} to contact #${ref.id}`,
                );
              }
            }
          } catch (docErr) {
            console.error('[Leads] document graduation error:', docErr.message);
          }
        } catch (e) {
          console.error('[Leads] contact creation error:', e.message);
        }
      }

      // Auto-create task for this stage transition
      autoTask(db, merged, stage, performer);

      // Contract task on signed
      if (stage === 'signed' && lead.stage !== 'signed') {
        try {
          const contactId = merged.contact_id || lead.contact_id || null;
          const pbNum = merged.pb_customer_number || lead.pb_customer_number || '';
          const addrLine = [merged.job_address, merged.job_city].filter(Boolean).join(', ');
          db.prepare(
            `
            INSERT INTO tasks
              (title, description, status, priority, contact_id, lead_id, remind_at, remind_interval_hours, created_at, updated_at)
            VALUES (?, ?, 'pending', 'high', ?, ?, ?, 168, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          `,
          ).run(
            `Generate contract — ${lead.caller_name}`,
            [
              `Auto-created from signed lead #${leadId}.`,
              `Caller: ${lead.caller_name} (${lead.caller_phone})`,
              pbNum ? `PB#: ${pbNum}` : '',
              addrLine ? `Address: ${addrLine}` : '',
            ]
              .filter(Boolean)
              .join('\n'),
            contactId,
            leadId,
            remindAt(24),
          );
          logAudit(
            null,
            'lead_contract_task_created',
            `Lead #${leadId}: contract task created for ${lead.caller_name}`,
            performer,
          );
        } catch (e) {
          console.error('[Leads] contract task error:', e.message);
        }
      }

      logAudit(
        null,
        'lead_stage_changed',
        `Lead #${leadId}: ${lead.stage} → ${stage} by ${performer}`,
        performer,
      );
    }

    if (updates.length === 0) return res.json({ lead });

    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(leadId);
    db.prepare(`UPDATE leads SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    const updated = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId);
    res.json({ lead: updated });

    // ── Migrate lead photos to job when job_id is newly assigned ─────────────
    if (job_id && job_id !== lead.job_id) {
      try {
        const photos = db.prepare('SELECT * FROM field_photos WHERE lead_id = ?').all(leadId);
        if (photos.length > 0) {
          const jobDir = path.resolve(__dirname, '../../uploads/jobs', job_id);
          if (!fs.existsSync(jobDir)) fs.mkdirSync(jobDir, { recursive: true });
          const copyStmt = db.prepare(
            `INSERT OR IGNORE INTO job_photos (job_id, filename, original_name, caption) VALUES (?, ?, ?, '')`,
          );
          const updateStmt = db.prepare('UPDATE field_photos SET job_id = ? WHERE id = ?');
          for (const ph of photos) {
            const src = path.join(FIELD_PHOTOS_DIR, ph.filename);
            const dest = path.join(jobDir, ph.filename);
            if (fs.existsSync(src) && !fs.existsSync(dest)) {
              fs.copyFileSync(src, dest);
            }
            copyStmt.run(job_id, ph.filename, ph.original_name || ph.filename);
            updateStmt.run(job_id, ph.id);
          }
          console.log(
            `[Leads] Migrated ${photos.length} photo(s) from lead #${leadId} to job ${job_id}`,
          );
        }
      } catch (photoErr) {
        console.error('[Leads] photo migration error:', photoErr.message);
      }
    }

    // Re-run property enrichment if job_address was changed
    if (job_address !== undefined && updated.job_address) {
      const fullAddr = [updated.job_address, updated.job_city, 'MA'].filter(Boolean).join(', ');
      enrichPropertyBackground(db, 'lead', leadId, fullAddr);
    }
  } catch (err) {
    console.error('[Leads] patch error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/leads/:id ──────────────────────────────────────────────────────
router.delete('/:id', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    db.prepare('DELETE FROM leads WHERE id = ?').run(req.params.id);
    logAudit(
      null,
      'lead_deleted',
      `Lead #${req.params.id} deleted — ${lead.caller_name}`,
      req.session?.name || 'admin',
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET  /api/leads/:id/wizard-draft — load saved wizard draft ───────────────
router.get('/:id/wizard-draft', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const row = db.prepare('SELECT wizard_draft FROM leads WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Lead not found' });
    const draft = row.wizard_draft ? JSON.parse(row.wizard_draft) : null;
    res.json({ draft });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/leads/:id/wizard-draft — save wizard draft ─────────────────────
router.post('/:id/wizard-draft', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const draft = req.body.draft || null;
    db.prepare('UPDATE leads SET wizard_draft = ? WHERE id = ?').run(
      draft ? JSON.stringify(draft) : null,
      req.params.id,
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Lead Documents ─────────────────────────────────────────────────────────────

// GET /api/leads/:id/documents
router.get('/:id/documents', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const docs = db
      .prepare(
        `SELECT id, filename, original_name, mime_type, file_size, uploaded_by, created_at
           FROM lead_documents WHERE lead_id = ? ORDER BY created_at DESC`,
      )
      .all(req.params.id);
    res.json({ documents: docs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/leads/:id/documents — upload a file (PDF, Word, images, etc.)
router.post('/:id/documents', requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const lead = db.prepare('SELECT id FROM leads WHERE id = ?').get(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    if (!req.files?.file) return res.status(400).json({ error: 'No file uploaded' });
    const file = Array.isArray(req.files.file) ? req.files.file[0] : req.files.file;

    const allowedMime = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'text/plain',
    ];
    if (!allowedMime.includes(file.mimetype)) {
      return res.status(400).json({ error: 'File type not allowed' });
    }
    if (file.size > 20 * 1024 * 1024) {
      return res.status(400).json({ error: 'File too large (max 20 MB)' });
    }

    const leadDir = path.join(LEAD_DOCS_DIR, String(req.params.id));
    if (!fs.existsSync(leadDir)) fs.mkdirSync(leadDir, { recursive: true });

    const ext = path.extname(file.name) || '';
    const safeBase = Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const filename = safeBase + ext;
    const dest = path.join(leadDir, filename);
    await file.mv(dest);

    const row = db
      .prepare(
        `INSERT INTO lead_documents (lead_id, filename, original_name, mime_type, file_size, uploaded_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(req.params.id, filename, file.name, file.mimetype, file.size, req.user?.name || 'staff');

    const doc = db.prepare('SELECT * FROM lead_documents WHERE id = ?').get(row.lastInsertRowid);
    logAudit(
      null,
      'lead_doc_upload',
      `Lead #${req.params.id}: uploaded "${file.name}"`,
      req.user?.name,
    );
    res.json({ document: doc });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/leads/:id/documents/:docId
router.delete('/:id/documents/:docId', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const doc = db
      .prepare('SELECT * FROM lead_documents WHERE id = ? AND lead_id = ?')
      .get(req.params.docId, req.params.id);
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    const filePath = path.join(LEAD_DOCS_DIR, String(req.params.id), doc.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    db.prepare('DELETE FROM lead_documents WHERE id = ?').run(doc.id);
    logAudit(
      null,
      'lead_doc_delete',
      `Lead #${req.params.id}: deleted "${doc.original_name}"`,
      req.user?.name,
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET  /api/leads/:id/notes — list all notes for a lead (newest first) ──────
router.get('/:id/notes', requireAuth, (req, res) => {
  const db = getDb();
  const notes = db
    .prepare(
      `SELECT id, lead_id, body, created_by,
              strftime('%m/%d/%Y', created_at, 'localtime')     AS note_date,
              strftime('%I:%M %p', created_at, 'localtime')     AS note_time,
              created_at
       FROM lead_notes
       WHERE lead_id = ?
       ORDER BY created_at DESC`,
    )
    .all(req.params.id);
  res.json(notes);
});

// ── POST /api/leads/:id/notes — add a new timestamped note ───────────────────
router.post('/:id/notes', requireAuth, (req, res) => {
  const { body } = req.body || {};
  if (!body || !String(body).trim()) return res.status(400).json({ error: 'body is required' });
  const db = getDb();
  const created_by = req.session?.name || req.user?.name || 'Staff';
  const result = db
    .prepare('INSERT INTO lead_notes (lead_id, body, created_by) VALUES (?, ?, ?)')
    .run(req.params.id, String(body).trim(), created_by);
  const note = db
    .prepare(
      `SELECT id, lead_id, body, created_by,
              strftime('%m/%d/%Y', created_at, 'localtime') AS note_date,
              strftime('%I:%M %p', created_at, 'localtime') AS note_time,
              created_at
       FROM lead_notes WHERE id = ?`,
    )
    .get(result.lastInsertRowid);
  res.json(note);
});

// ── POST /api/leads/:id/enrich — manually trigger property enrichment ──────────
router.post('/:id/enrich', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    const fullAddr = [lead.job_address, lead.job_city, 'MA'].filter(Boolean).join(', ');
    if (!lead.job_address) return res.status(400).json({ error: 'Lead has no job address' });
    enrichPropertyBackground(db, 'lead', lead.id, fullAddr);
    res.json({ ok: true, message: 'Property lookup started — refresh in a few seconds' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
