'use strict';
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { requireFields, validateEnum } = require('../middleware/validate');
const { getDb } = require('../db/database');
const { logAudit } = require('../services/auditService');
const gcal = require('../services/googleCalendar');

// ── Google Calendar "add link" URL (fallback if API push fails) ───────────────
function calDate(iso) {
  return iso
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z?$/, '')
    .slice(0, 15);
}

function makeCalendarURL(task) {
  if (!task.due_at) return null;
  try {
    const start = calDate(task.due_at);
    const endDt = new Date(new Date(task.due_at).getTime() + 60 * 60 * 1000);
    const end = calDate(endDt.toISOString());
    const parts = [`action=TEMPLATE`, `text=${encodeURIComponent(task.title)}`];
    parts.push(`dates=${start}/${end}`);
    if (task.description) parts.push(`details=${encodeURIComponent(task.description)}`);
    const job = task.job_id
      ? getDb().prepare('SELECT project_address FROM jobs WHERE id = ?').get(task.job_id)
      : null;
    if (job?.project_address) parts.push(`location=${encodeURIComponent(job.project_address)}`);
    return `https://calendar.google.com/calendar/render?${parts.join('&')}`;
  } catch {
    return null;
  }
}

// ── Get calendar settings ─────────────────────────────────────────────────────
function getCalSettings(db) {
  const calId =
    db.prepare("SELECT value FROM settings WHERE key = 'gcal.calendarId'").get()?.value ||
    'primary';
  const enabled = db.prepare("SELECT value FROM settings WHERE key = 'gcal.enabled'").get()?.value;
  return { calendarId: calId, enabled: enabled !== 'false' };
}

// ── Enrich task with related job/contact/lead info ────────────────────────────
function enrichTask(task) {
  if (!task) return null;
  const db = getDb();
  let jobInfo = null,
    contactInfo = null,
    leadInfo = null;
  if (task.job_id) {
    jobInfo = db
      .prepare('SELECT id, customer_name, project_address, status FROM jobs WHERE id = ?')
      .get(task.job_id);
  }
  if (task.contact_id) {
    contactInfo = db
      .prepare('SELECT id, name, email, phone FROM contacts WHERE id = ?')
      .get(task.contact_id);
  }
  if (task.lead_id) {
    leadInfo = db
      .prepare(
        'SELECT id, caller_name, caller_phone, stage, archived, job_address, job_city FROM leads WHERE id = ?',
      )
      .get(task.lead_id);
  }
  return { ...task, job: jobInfo, contact: contactInfo, lead: leadInfo || null };
}

// ── GET /api/tasks ────────────────────────────────────────────────────────────
router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const { status, job_id, contact_id, range } = req.query;
  let sql = 'SELECT * FROM tasks WHERE 1=1';
  const params = [];
  if (status) {
    sql += ' AND status = ?';
    params.push(status);
  }
  if (job_id) {
    sql += ' AND job_id = ?';
    params.push(job_id);
  }
  if (contact_id) {
    sql += ' AND contact_id = ?';
    params.push(contact_id);
  }
  if (range === 'today') {
    sql +=
      " AND (date(due_at) = date('now') OR (due_at IS NULL AND date(remind_at) = date('now')))";
  } else if (range === 'week') {
    sql +=
      " AND (due_at <= datetime('now', '+7 days') OR (due_at IS NULL AND remind_at <= datetime('now', '+7 days')))";
  }
  // Sort by effective date: due_at takes priority, falls back to remind_at; nulls last
  sql += ` ORDER BY
    CASE WHEN due_at IS NULL AND remind_at IS NULL THEN 1 ELSE 0 END,
    COALESCE(due_at, remind_at) ASC,
    created_at DESC`;
  const tasks = db
    .prepare(sql)
    .all(...params)
    .map(enrichTask);
  const todayCount = db
    .prepare("SELECT COUNT(*) as n FROM tasks WHERE status='pending' AND date(due_at)=date('now')")
    .get().n;
  const overdue = db
    .prepare(
      "SELECT COUNT(*) as n FROM tasks WHERE status='pending' AND due_at < datetime('now') AND due_at IS NOT NULL",
    )
    .get().n;
  res.json({ tasks, todayCount, overdue });
});

// ── GET /api/tasks/calendars — list user's Google Calendars ──────────────────
router.get('/calendars', requireAuth, async (req, res) => {
  try {
    const cals = await gcal.listCalendars();
    res.json({
      calendars: cals.map((c) => ({ id: c.id, summary: c.summary, primary: c.primary })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/tasks ───────────────────────────────────────────────────────────
router.post('/', requireAuth, requireFields(['title']), async (req, res) => {
  const db = getDb();
  const {
    title,
    description,
    due_at,
    job_id,
    contact_id,
    priority,
    assigned_to,
    remind_at,
    remind_interval_hours,
    recurrence,
  } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Title is required' });

  const VALID_RECURRENCE = ['none', 'daily', 'weekly', 'biweekly', 'monthly'];
  const resolvedRecurrence = VALID_RECURRENCE.includes(recurrence) ? recurrence : 'none';

  // Manual tasks: only set remind_at if the caller explicitly provides one.
  // Lead pipeline tasks pass remind_at from their own logic (taskDefs in leads.js).
  const explicitRemindAt = remind_at || null;
  const explicitInterval = remind_interval_hours ? parseInt(remind_interval_hours, 10) : null;

  const info = db
    .prepare(
      `
    INSERT INTO tasks (title, description, due_at, job_id, contact_id, priority, calendar_url,
      remind_at, remind_interval_hours, assigned_to, task_type, recurrence)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?)
  `,
    )
    .run(
      title.trim(),
      description?.trim() || null,
      due_at || null,
      job_id || null,
      contact_id || null,
      priority || 'normal',
      null,
      explicitRemindAt,
      explicitInterval,
      assigned_to || null,
      resolvedRecurrence,
    );

  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(info.lastInsertRowid);

  // Try to push to Google Calendar; fall back to "add link" URL
  let calURL = makeCalendarURL(task);
  const { calendarId, enabled } = getCalSettings(db);

  if (enabled && task.due_at) {
    try {
      const customerEmailRow = task.job_id
        ? db.prepare('SELECT customer_email FROM jobs WHERE id = ?').get(task.job_id)
        : null;
      const extraEmails = customerEmailRow?.customer_email ? [customerEmailRow.customer_email] : [];
      const gcalLink = await gcal.createCalendarEvent(task, calendarId, extraEmails);
      if (gcalLink) calURL = gcalLink;
    } catch (e) {
      console.warn('[GCal] Could not auto-create event:', e.message);
    }
  }

  if (calURL) {
    db.prepare('UPDATE tasks SET calendar_url = ? WHERE id = ?').run(calURL, task.id);
    task.calendar_url = calURL;
  }

  if (job_id) logAudit(job_id, 'task_created', `Task created: ${task.title}`, 'admin');
  res.json({ task: enrichTask(task) });
});

// ── Recurrence helpers ────────────────────────────────────────────────────────
const RECURRENCE_HOURS = { daily: 24, weekly: 168, biweekly: 336, monthly: 720 };

function nextDueDate(currentDue, recurrence) {
  const hours = RECURRENCE_HOURS[recurrence];
  if (!hours || !currentDue) return null;
  return new Date(new Date(currentDue).getTime() + hours * 3_600_000)
    .toISOString()
    .replace('T', ' ')
    .slice(0, 19);
}

// ── PATCH /api/tasks/:id ──────────────────────────────────────────────────────
router.patch(
  '/:id',
  requireAuth,
  validateEnum('status', ['pending', 'in_progress', 'done', 'cancelled']),
  validateEnum('priority', ['low', 'normal', 'high', 'urgent']),
  (req, res) => {
    const db = getDb();
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    const {
      title,
      description,
      due_at,
      status,
      priority,
      remind_at,
      remind_interval_hours,
      assigned_to,
      recurrence,
    } = req.body;
    const newTitle = title !== undefined ? title.trim() : task.title;
    const newDescription = description !== undefined ? description.trim() : task.description;
    const newDueAt = due_at !== undefined ? due_at : task.due_at;
    const newStatus = status !== undefined ? status : task.status;
    const newPriority = priority !== undefined ? priority : task.priority;
    const newRemindAt = remind_at !== undefined ? remind_at : task.remind_at;
    const newAssignedTo = assigned_to !== undefined ? assigned_to || null : task.assigned_to;
    const VALID_INTERVALS = [2, 3, 24, 48, 72, 168, 336];
    const parsedInterval =
      remind_interval_hours !== undefined ? parseInt(remind_interval_hours, 10) : null;
    const newRemindIntervalHours =
      parsedInterval !== null && VALID_INTERVALS.includes(parsedInterval)
        ? parsedInterval
        : task.remind_interval_hours || null;
    const VALID_RECURRENCE = ['none', 'daily', 'weekly', 'biweekly', 'monthly'];
    const newRecurrence =
      recurrence !== undefined && VALID_RECURRENCE.includes(recurrence)
        ? recurrence
        : task.recurrence || 'none';

    const updated = { ...task, title: newTitle, description: newDescription, due_at: newDueAt };
    const calURL = makeCalendarURL(updated);

    db.prepare(
      `UPDATE tasks SET title=?, description=?, due_at=?, status=?, priority=?, calendar_url=?,
        remind_at=?, remind_interval_hours=?, assigned_to=?, recurrence=?,
        updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    ).run(
      newTitle,
      newDescription,
      newDueAt,
      newStatus,
      newPriority,
      calURL,
      newRemindAt,
      newRemindIntervalHours,
      newAssignedTo,
      newRecurrence,
      task.id,
    );

    if (task.job_id && status && status !== task.status) {
      logAudit(task.job_id, 'task_status_changed', `Task "${newTitle}" → ${newStatus}`, 'admin');
    }

    // Auto-create next recurrence when task is marked done
    if (newStatus === 'done' && task.status !== 'done' && newRecurrence && newRecurrence !== 'none') {
      const nextDue = nextDueDate(newDueAt, newRecurrence);
      if (nextDue) {
        db.prepare(
          `INSERT INTO tasks (title, description, due_at, job_id, contact_id, priority,
            recurrence, remind_interval_hours, assigned_to, task_type, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        ).run(
          newTitle,
          newDescription || null,
          nextDue,
          task.job_id || null,
          task.contact_id || null,
          newPriority,
          newRecurrence,
          newRemindIntervalHours || null,
          newAssignedTo || null,
          task.task_type || 'manual',
        );
        console.log(`[Tasks] Recurring task scheduled: "${newTitle}" → ${nextDue}`);
      }
    }

    res.json({ task: enrichTask(db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id)) });
  },
);

// ── DELETE /api/tasks/:id ─────────────────────────────────────────────────────
router.delete('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = { router, makeCalendarURL };
