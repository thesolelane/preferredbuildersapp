'use strict';
// server/services/taskReminder.js
// Background scheduler that sends reminder emails for open tasks.
//
// Rules enforced on every tick:
//   • Business hours gate — Mon–Sat 7:00–19:00 Eastern (UTC-5 conservative)
//   • Minimum interval floor — 4 hours; any task set below 4h is treated as 4h
//   • Max remind count — after 8 reminders the interval doubles (cap 168h);
//     after 15 reminders the task's remind_at is cleared and email stops
//   • Digest email — all due tasks for a recipient arrive in ONE email per tick
//   • Reach Out tasks — also sends WhatsApp SMS to customer + real-time push

const { getDb } = require('../db/database');
const { sendEmail } = require('./emailService');
const { sendWhatsApp } = require('./whatsappService');
const { notifyJobUpdate } = require('./realtimeService');
const { team } = require('../../config/parameters');

const MIN_INTERVAL_HOURS = 4;
const DOUBLE_AFTER = 8;
const STOP_AFTER = 15;
const MAX_INTERVAL_HOURS = 168;

function isBusinessHours() {
  const etOffset = -5 * 60 * 60 * 1000;
  const etNow = new Date(Date.now() + etOffset);
  const dow = etNow.getUTCDay();
  const hour = etNow.getUTCHours();
  return dow >= 1 && dow <= 6 && hour >= 7 && hour < 19;
}

function resolveRecipients(db, task) {
  const seen = new Set();
  const recipients = [];

  const add = (email) => {
    if (email && !seen.has(email)) {
      seen.add(email);
      recipients.push(email);
    }
  };

  add(process.env.OWNER_EMAIL || team.owner.email);
  add(team.jackson.email);

  if (task.assigned_to) {
    try {
      const user = db
        .prepare(`SELECT email FROM users WHERE name = ? AND active = 1`)
        .get(task.assigned_to);
      add(user?.email);
    } catch {
      // fall through
    }
  }

  return recipients;
}

function effectiveInterval(task) {
  const raw = task.remind_interval_hours || 168;
  let hours = Math.max(MIN_INTERVAL_HOURS, Math.min(raw, 8760));
  const count = task.remind_count || 0;
  if (count >= DOUBLE_AFTER) {
    hours = Math.min(hours * 2, MAX_INTERVAL_HOURS);
  }
  return hours;
}

function formatDt(isoStr) {
  if (!isoStr) return '—';
  try {
    return new Date(isoStr).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoStr;
  }
}

function buildDigestHtml(tasks, tasksLink) {
  const rows = tasks
    .map(
      (t) => `
      <tr>
        <td style="padding:8px 10px;border-bottom:1px solid #eee;font-weight:600;color:#1B3A6B">${t.title}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #eee">${t.status}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #eee">${t.assigned_to || '—'}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #eee">${formatDt(t.due_at)}</td>
      </tr>`,
    )
    .join('');

  return `
    <div style="font-family:sans-serif;max-width:640px">
      <h2 style="color:#1B3A6B;margin-bottom:4px">🔔 Task Reminders — ${tasks.length} pending</h2>
      <p style="color:#666;margin-top:0">The following tasks need your attention:</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <thead>
          <tr style="background:#1B3A6B;color:white">
            <th style="padding:8px 10px;text-align:left">Task</th>
            <th style="padding:8px 10px;text-align:left">Status</th>
            <th style="padding:8px 10px;text-align:left">Assigned</th>
            <th style="padding:8px 10px;text-align:left">Due</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p>
        <a href="${tasksLink}"
           style="background:#1B3A6B;color:white;padding:10px 22px;border-radius:6px;
                  text-decoration:none;display:inline-block;margin-top:16px;font-weight:600">
          View All Tasks
        </a>
      </p>
    </div>`;
}

async function runReminderTick() {
  if (!isBusinessHours()) {
    return;
  }

  const db = getDb();

  const dueTasks = db
    .prepare(
      `SELECT * FROM tasks
       WHERE status NOT IN ('done','cancelled')
         AND remind_at IS NOT NULL
         AND remind_at <= datetime('now')`,
    )
    .all();

  if (!dueTasks.length) return;

  const appUrl =
    process.env.APP_URL ||
    (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : '');
  const tasksLink = appUrl ? `${appUrl}/tasks` : '/tasks';

  const activeTasks = [];
  const stopTasks = [];

  for (const task of dueTasks) {
    const isLeadTask = task.task_type === 'lead' || task.lead_id != null;
    const hasExplicitReminder = task.remind_interval_hours !== 168;
    if (!isLeadTask && !hasExplicitReminder) {
      db.prepare(`UPDATE tasks SET remind_at = NULL WHERE id = ?`).run(task.id);
      continue;
    }

    const count = task.remind_count || 0;
    if (count >= STOP_AFTER) {
      stopTasks.push(task);
      continue;
    }

    activeTasks.push(task);
  }

  for (const task of stopTasks) {
    db.prepare(`UPDATE tasks SET remind_at = NULL WHERE id = ?`).run(task.id);
    console.log(`[TaskReminder] Task #${task.id} hit max remind count (${STOP_AFTER}) — stopped`);
  }

  if (!activeTasks.length) return;

  const recipientMap = new Map();
  const taskRecipients = new Map();

  for (const task of activeTasks) {
    const recipients = resolveRecipients(db, task);
    if (!recipients.length) {
      console.log(`[TaskReminder] No recipients for task #${task.id} — skipping`);
      continue;
    }
    taskRecipients.set(task.id, new Set(recipients));
    for (const email of recipients) {
      if (!recipientMap.has(email)) recipientMap.set(email, []);
      recipientMap.get(email).push(task);
    }
  }

  const successfulEmails = new Set();

  for (const [email, tasks] of recipientMap) {
    const subject =
      tasks.length === 1
        ? `🔔 Reminder: ${tasks[0].title}`
        : `🔔 Task Reminders — ${tasks.length} tasks need attention`;

    try {
      await sendEmail({
        to: [email],
        subject,
        html: buildDigestHtml(tasks, tasksLink),
        emailType: 'task_reminder',
      });
      console.log(
        `[TaskReminder] Digest sent to ${email} — ${tasks.length} task(s): ${tasks.map((t) => `#${t.id}`).join(', ')}`,
      );
      successfulEmails.add(email);
    } catch (err) {
      console.warn(`[TaskReminder] Failed to send digest to ${email}:`, err.message);
    }
  }

  for (const task of activeTasks) {
    const intended = taskRecipients.get(task.id);
    if (!intended) continue;
    const allDelivered = [...intended].every((e) => successfulEmails.has(e));
    if (!allDelivered) continue;
    const intervalHours = effectiveInterval(task);
    db.prepare(
      `UPDATE tasks
          SET remind_at    = datetime('now', '+' || ? || ' hours'),
              remind_count = COALESCE(remind_count, 0) + 1
        WHERE id = ?`,
    ).run(intervalHours, task.id);
  }
}

// ── Reach Out SMS outreach ────────────────────────────────────────────────────
// For due "Reach Out" tasks: sends WhatsApp/SMS to the customer directly,
// emails the owner, marks the task as reminded, fires real-time push.
// Respects sms_opt_out flag. Works for both job tasks and lead-only tasks.
async function runReachOutSMS() {
  if (!isBusinessHours()) return;

  const db = getDb();
  const dueTasks = db
    .prepare(
      `
    SELECT t.*,
           COALESCE(j.customer_name, l.caller_name)    AS customer_name,
           COALESCE(j.project_address, l.job_address)  AS project_address,
           COALESCE(j.customer_phone, l.caller_phone)  AS customer_phone,
           COALESCE(j.sms_opt_out, 0)                   AS sms_opt_out
    FROM tasks t
    LEFT JOIN jobs j ON t.job_id = j.id
    LEFT JOIN leads l ON t.lead_id = l.id
    WHERE t.status = 'pending'
      AND (t.title LIKE '%Reach Out%' OR t.task_type LIKE '%reach_out%')
      AND datetime(t.due_at) <= datetime('now')
      AND (t.reminded_at IS NULL OR datetime(t.reminded_at) <= datetime('now', '-23 hours'))
  `,
    )
    .all();

  for (const task of dueTasks) {
    const customerName = task.customer_name || 'Customer';
    const address = task.project_address || '';
    const phone = task.customer_phone;

    if (phone && !task.sms_opt_out) {
      const smsText = `Hi ${customerName}, just following up on your project${address ? ` at ${address}` : ''}. Any updates? Reply here or call us at 978-377-1784.`;
      await sendWhatsApp(phone, smsText).catch((e) =>
        console.warn('[TaskReminder] WhatsApp failed:', e.message),
      );
    } else if (task.sms_opt_out) {
      console.log(`[TaskReminder] Reach Out skipped — customer opted out (task #${task.id})`);
    }

    await sendEmail({
      to: [process.env.OWNER_EMAIL || team.owner.email],
      subject: `📌 Reach Out Reminder — ${customerName}`,
      html: `<p>Task <strong>"${task.title}"</strong> for <strong>${customerName}</strong> is due.</p>
             <p><strong>Address:</strong> ${address || '—'}</p>
             <p><strong>Job ID:</strong> ${task.job_id || '—'}</p>`,
      emailType: 'task_reminder',
    }).catch((e) => console.warn('[TaskReminder] Reach Out email failed:', e.message));

    db.prepare(
      `UPDATE tasks SET status = 'reminded', reminded_at = CURRENT_TIMESTAMP WHERE id = ?`,
    ).run(task.id);
    if (task.job_id)
      notifyJobUpdate(task.job_id, 'task_reminder', { taskId: task.id, title: task.title });
    console.log(`[TaskReminder] Reach Out processed for task #${task.id} — ${customerName}`);
  }
}

// ── Proposal / Contract follow-up SMS ────────────────────────────────────────
// If a signing email was sent 3+ hours ago and the customer hasn't opened the
// signing link yet, send a WhatsApp nudge. One follow-up per session only.
async function runDocumentFollowUp() {
  if (!isBusinessHours()) return;

  const db = getDb();
  const sessions = db
    .prepare(
      `
    SELECT ss.*, j.customer_name, j.customer_phone, j.project_address, j.sms_opt_out
    FROM signing_sessions ss
    JOIN jobs j ON ss.job_id = j.id
    WHERE ss.status = 'sent'
      AND ss.email_sent_at IS NOT NULL
      AND ss.opened_at IS NULL
      AND ss.followup_sms_at IS NULL
      AND datetime(ss.email_sent_at) <= datetime('now', '-3 hours')
  `,
    )
    .all();

  for (const session of sessions) {
    const customerName = session.customer_name || 'Customer';
    const phone = session.customer_phone;
    const docLabel = session.doc_type === 'contract' ? 'Contract' : 'Proposal';

    if (phone && !session.sms_opt_out) {
      const msg = `Hi ${customerName}, did you get our ${docLabel} from Preferred Builders? It should be in your inbox — if you don't see it, check your junk/spam folder. Questions? Call us at 978-377-1784.`;
      await sendWhatsApp(phone, msg).catch((e) =>
        console.warn('[TaskReminder] Doc follow-up WhatsApp failed:', e.message),
      );
      console.log(
        `[TaskReminder] ${docLabel} follow-up SMS sent — ${customerName} (session #${session.id})`,
      );
    }

    db.prepare(`UPDATE signing_sessions SET followup_sms_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
      session.id,
    );
    if (session.job_id)
      notifyJobUpdate(session.job_id, 'document_followup_sent', { doc_type: session.doc_type });
  }
}

function startTaskReminderScheduler() {
  console.log('[TaskReminder] Scheduler started — checking every 60 minutes');
  runReminderTick().catch((e) => console.warn('[TaskReminder] Initial tick error:', e.message));
  runReachOutSMS().catch((e) =>
    console.warn('[TaskReminder] Reach Out initial tick error:', e.message),
  );
  runDocumentFollowUp().catch((e) =>
    console.warn('[TaskReminder] Doc follow-up initial tick error:', e.message),
  );
  setInterval(
    () => {
      runReminderTick().catch((e) => console.warn('[TaskReminder] Tick error:', e.message));
      runReachOutSMS().catch((e) =>
        console.warn('[TaskReminder] Reach Out tick error:', e.message),
      );
      runDocumentFollowUp().catch((e) =>
        console.warn('[TaskReminder] Doc follow-up tick error:', e.message),
      );
    },
    60 * 60 * 1000,
  );
}

module.exports = { startTaskReminderScheduler };
