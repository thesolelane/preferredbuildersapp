// server/routes/agents.js
// Machine-to-machine API for Marbilism agents + admin UI endpoints
/* global AbortController */
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { getDb } = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');
const { requireAgent } = require('../middleware/requireAgent');
const { logAudit } = require('../services/auditService');
const { notifyClients } = require('../services/sseManager');

// ── Agent SSE clients (separate from main dashboard SSE) ─────────────────────
const agentSseClients = new Set();

function notifyAgentClients(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of agentSseClients) {
    try {
      res.write(payload);
    } catch {
      agentSseClients.delete(res);
    }
  }
}

// ── Helper: sign an outbound request from admin to an agent ──────────────────
function signOutbound(body, secretHash) {
  const timestamp = String(Date.now());
  const sig = crypto.createHmac('sha256', secretHash).update(`${timestamp}.${body}`).digest('hex');
  return { timestamp, sig };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MACHINE-TO-MACHINE endpoints — require agent auth
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/agents/connect — agent handshake, records last_seen
router.post('/connect', requireAgent, (req, res) => {
  logAudit(null, 'agent_connect', `Agent connected: ${req.agent.name}`, req.agent.name);
  notifyClients('agent_status', { agentId: req.agent.id, name: req.agent.name, event: 'connect' });
  res.json({ ok: true, agent: req.agent.name, ts: new Date().toISOString() });
});

// GET /api/agents/jobs — returns open jobs the agent may read
router.get('/jobs', requireAgent, (req, res) => {
  const db = getDb();
  const jobs = db
    .prepare(
      `SELECT id, customer_name, project_address, project_city, project_state,
            scope_summary, status, total_value, created_at, updated_at
     FROM jobs WHERE archived = 0 ORDER BY created_at DESC LIMIT 100`,
    )
    .all();
  logAudit(null, 'agent_list_jobs', `Agent listed jobs`, req.agent.name);
  res.json({ jobs });
});

// POST /api/agents/jobs/:id/note — agent appends a note to a job
router.post('/jobs/:id/note', requireAgent, (req, res) => {
  const db = getDb();
  const job = db.prepare('SELECT id FROM jobs WHERE id = ? AND archived = 0').get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const { note } = req.body;
  if (!note || typeof note !== 'string') return res.status(400).json({ error: 'note is required' });

  logAudit(req.params.id, 'agent_note', note.slice(0, 2000), req.agent.name);
  notifyClients('agent_note', { jobId: req.params.id, agentName: req.agent.name, note });
  res.json({ ok: true });
});

// GET /api/agents/tasks — agent reads all open tasks
router.get('/tasks', requireAgent, (req, res) => {
  const db = getDb();
  const tasks = db
    .prepare(
      `SELECT id, title, description, due_at, job_id, contact_id, status, priority, calendar_url, created_at, updated_at
     FROM tasks ORDER BY CASE WHEN due_at IS NULL THEN 1 ELSE 0 END, due_at ASC, created_at DESC`,
    )
    .all();
  logAudit(null, 'agent_list_tasks', `Agent listed tasks`, req.agent.name);
  res.json({ tasks });
});

// POST /api/agents/tasks — agent creates a new task
router.post('/tasks', requireAgent, (req, res) => {
  const db = getDb();
  const { title, description, due_at, priority, job_id, contact_id } = req.body;
  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'title is required' });
  }

  const info = db
    .prepare(
      `INSERT INTO tasks (title, description, due_at, job_id, contact_id, priority)
     VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      title.trim(),
      description?.trim() || null,
      due_at || null,
      job_id || null,
      contact_id || null,
      priority || 'normal',
    );

  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(info.lastInsertRowid);
  logAudit(
    job_id || null,
    'agent_task_created',
    `Agent created task: ${task.title}`,
    req.agent.name,
  );
  notifyClients('agent_task', { task, agentName: req.agent.name });
  res.json({ ok: true, task });
});

// POST /api/agents/message — agent sends a message into its chat thread
router.post('/message', requireAgent, (req, res) => {
  const db = getDb();
  const { message } = req.body;
  if (!message || typeof message !== 'string')
    return res.status(400).json({ error: 'message is required' });

  const result = db
    .prepare("INSERT INTO agent_messages (agent_id, direction, message) VALUES (?, 'inbound', ?)")
    .run(req.agent.id, message.slice(0, 10000));

  logAudit(
    null,
    'agent_message_inbound',
    `Agent message: ${message.slice(0, 200)}`,
    req.agent.name,
  );

  notifyAgentClients('agent_message', {
    id: result.lastInsertRowid,
    agentId: req.agent.id,
    agentName: req.agent.name,
    direction: 'inbound',
    message,
    created_at: new Date().toISOString(),
  });

  res.json({ ok: true, id: result.lastInsertRowid });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN endpoints — require user session (admin/pm only)
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/agents/ — list all agents with status
router.get('/', requireAuth, requireRole('admin', 'pm', 'system_admin'), (req, res) => {
  const db = getDb();
  // Compute online in SQL using SQLite datetime arithmetic to avoid JS/SQLite format mismatch
  const agents = db
    .prepare(
      `
    SELECT id, name, callback_url, last_seen, request_count, created_at,
           CASE WHEN last_seen IS NOT NULL AND last_seen >= datetime('now', '-5 minutes')
                THEN 1 ELSE 0 END AS online
    FROM agent_keys
    ORDER BY id ASC
  `,
    )
    .all();

  res.json({ agents: agents.map((a) => ({ ...a, online: a.online === 1 })) });
});

// GET /api/agents/:id/messages — full thread history for one agent
router.get('/:id/messages', requireAuth, requireRole('admin', 'pm', 'system_admin'), (req, res) => {
  const db = getDb();
  const agent = db.prepare('SELECT id, name FROM agent_keys WHERE id = ?').get(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  const messages = db
    .prepare(
      'SELECT id, direction, message, created_at FROM agent_messages WHERE agent_id = ? ORDER BY created_at ASC',
    )
    .all(agent.id);

  res.json({ agent, messages });
});

// POST /api/agents/:id/send — admin sends a message to agent callback URL
router.post(
  '/:id/send',
  requireAuth,
  requireRole('admin', 'pm', 'system_admin'),
  async (req, res) => {
    const db = getDb();
    const agent = db.prepare('SELECT * FROM agent_keys WHERE id = ?').get(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    const { message } = req.body;
    if (!message || typeof message !== 'string')
      return res.status(400).json({ error: 'message is required' });

    // Store in DB as outbound
    const result = db
      .prepare(
        "INSERT INTO agent_messages (agent_id, direction, message) VALUES (?, 'outbound', ?)",
      )
      .run(agent.id, message.slice(0, 10000));

    const msgRow = {
      id: result.lastInsertRowid,
      agentId: agent.id,
      agentName: agent.name,
      direction: 'outbound',
      message,
      created_at: new Date().toISOString(),
    };

    logAudit(
      null,
      'agent_message_outbound',
      `Admin → ${agent.name}: ${message.slice(0, 200)}`,
      req.session?.name || 'admin',
    );

    // If the agent has a callback URL, post the message signed with the agent's secret
    if (agent.callback_url) {
      try {
        const bodyStr = JSON.stringify({ message, from: 'admin', ts: new Date().toISOString() });
        const { timestamp, sig } = signOutbound(bodyStr, agent.secret_hash);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10000);
        try {
          await fetch(agent.callback_url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-timestamp': timestamp,
              'x-signature': sig,
            },
            body: bodyStr,
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timer);
        }
      } catch (err) {
        console.warn(`Agent callback failed for ${agent.name}: ${err.message}`);
      }
    }

    notifyAgentClients('agent_message', msgRow);
    res.json({ ok: true, message: msgRow });
  },
);

// GET /api/agents/marblism-config — returns webhook URL + API key for Marblism setup
router.get('/marblism-config', requireAuth, requireRole('admin', 'system_admin'), (req, res) => {
  const db = getDb();
  const row = db.prepare("SELECT value FROM settings WHERE key = 'marblism_api_key'").get();
  if (!row) {
    return res.status(404).json({ error: 'Marblism API key not yet generated — restart the server.' });
  }
  const host = process.env.PUBLIC_URL || 'https://preferredbuilders.duckdns.org';
  res.json({
    webhookUrl: `${host}/webhook/marblism/call`,
    apiKey: row.value,
  });
});

// GET /api/agents/events — SSE stream for live agent messages
router.get('/events', requireAuth, requireRole('admin', 'pm', 'system_admin'), (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch {
      /* ignore */
    }
  }, 30000);

  agentSseClients.add(res);
  req.on('close', () => {
    clearInterval(heartbeat);
    agentSseClients.delete(res);
  });
});

module.exports = router;
