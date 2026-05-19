// ============================================================
// server/index.js — Main Application Server
// Preferred Builders AI System
// ============================================================

require('dotenv').config();

// Sanitize all env var values at startup:
// 1. Strip Windows CRLF \r characters (Notepad saves .env with CRLF)
// 2. Strip surrounding quotes (copy-paste or Replit secrets can include them)
for (const key of Object.keys(process.env)) {
  if (typeof process.env[key] === 'string') {
    let v = process.env[key].replace(/\r/g, '').trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1).trim();
    }
    process.env[key] = v;
  }
}

require('./services/errorLogger'); // must load early to capture all errors
require('./services/crashLogger'); // must load early to register signal handlers
const http = require('http');
const express = require('express');
const cors = require('cors');
const fileUpload = require('express-fileupload');
const fs = require('fs');
const path = require('path');
const { initDatabase } = require('./db/database');
const { requireAuth } = require('./middleware/auth');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const { Server: SocketIOServer } = require('socket.io');
const { setIO } = require('./services/realtimeService');

const app = express();
app.set('trust proxy', 1); // trust Caddy reverse proxy X-Forwarded-For headers
const httpServer = http.createServer(app);
const PORT = process.env.PORT || 3001;

// ── SOCKET.IO — real-time push ─────────────────────────────────
const io = new SocketIOServer(httpServer, {
  cors: { origin: '*' },
  path: '/socket.io',
});
setIO(io);
io.on('connection', (socket) => {
  socket.on('join-job', (jobId) => {
    if (jobId) socket.join(String(jobId));
  });
  socket.on('leave-job', (jobId) => {
    if (jobId) socket.leave(String(jobId));
  });
});

// ── SECURITY MIDDLEWARE ───────────────────────────────────────
app.disable('x-powered-by'); // hide framework fingerprint
app.use(
  helmet({
    contentSecurityPolicy: false, // React handles its own; enabling would break the UI
    crossOriginEmbedderPolicy: false, // required for Puppeteer/PDF generation
    crossOriginOpenerPolicy: false, // required for Replit preview iframe
    crossOriginResourcePolicy: false, // required for Replit preview iframe
    frameguard: false, // allow Replit preview iframe (removes X-Frame-Options)
  }),
);
app.use(cors({ origin: process.env.NODE_ENV === 'production' ? false : '*' }));
// Capture raw body for agent M2M routes (needed for HMAC signature verification).
// express.raw() runs before express.json() so the body stream is not consumed twice.
// Admin/SSE agent endpoints that don't send a body are unaffected (rawBody = '').
app.use(
  '/api/agents',
  express.raw({
    type: '*/*',
    limit: '1mb',
    verify: (req, _res, buf) => {
      req.rawBody = buf.toString('utf8');
    },
  }),
  (req, res, next) => {
    // Parse JSON body from rawBody for convenience on endpoints that need it
    if (req.rawBody) {
      try {
        req.body = JSON.parse(req.rawBody);
      } catch {
        req.body = {};
      }
    }
    next();
  },
);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(fileUpload({ limits: { fileSize: 50 * 1024 * 1024 }, useTempFiles: true }));

// ── AUTH-PROTECTED FILE SERVING ───────────────────────────────
// PDFs (proposals, contracts) — requires staff login OR a valid signing session token
const OUTPUTS_DIR = path.resolve(__dirname, '../outputs');
const CONTACT_DOCS_DIR = path.resolve(__dirname, '../uploads/contact_docs');
const LEAD_DOCS_DIR = path.resolve(__dirname, '../uploads/lead_docs');
const MANUAL_SIGS_DIR = path.resolve(__dirname, '../uploads/manual_signatures');
const PO_ATTACHMENTS_DIR = path.resolve(__dirname, '../uploads/po_attachments');

app.get('/outputs/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(OUTPUTS_DIR, filename);
  if (!filePath.startsWith(OUTPUTS_DIR) || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  // Accept staff auth token (header or query param) — checked against in-memory sessions
  const authToken = req.headers['x-auth-token'] || req.query.token;
  if (authToken) {
    const { isValidSession } = require('./middleware/auth');
    if (isValidSession(authToken)) return res.sendFile(filePath);
  }

  // Also accept a valid signing session token (customers viewing their own docs)
  const signToken = req.query.sign_token;
  if (signToken) {
    const { getDb } = require('./db/database');
    const db = getDb();
    const session = db
      .prepare(
        "SELECT id, status, email_sent_at, created_at FROM signing_sessions WHERE token = ? AND status != 'void'",
      )
      .get(signToken);
    if (session) {
      const sentAt = session.email_sent_at || session.created_at;
      const cutoff = sentAt
        ? new Date(new Date(sentAt).getTime() + 10 * 24 * 60 * 60 * 1000)
        : null;
      const expired = session.status !== 'signed' && cutoff && new Date() > cutoff;
      if (expired) return res.status(410).json({ error: 'Link expired' });
      if (req.query.download === '1') {
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      }
      return res.sendFile(filePath);
    }
  }

  return res.status(401).json({ error: 'Unauthorized' });
});

app.get('/contact-docs/:contactId/:filename', requireAuth, (req, res) => {
  const contactId = path.basename(req.params.contactId);
  const filename = path.basename(req.params.filename);
  const filePath = path.join(CONTACT_DOCS_DIR, contactId, filename);
  if (!filePath.startsWith(CONTACT_DOCS_DIR) || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  res.sendFile(filePath);
});

app.get('/lead-docs/:leadId/:filename', requireAuth, (req, res) => {
  const leadId = path.basename(req.params.leadId);
  const filename = path.basename(req.params.filename);
  const filePath = path.join(LEAD_DOCS_DIR, leadId, filename);
  if (!filePath.startsWith(LEAD_DOCS_DIR) || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  res.sendFile(filePath);
});

app.get('/manual-signatures/:jobId/:filename', requireAuth, (req, res) => {
  const jobId = path.basename(req.params.jobId);
  const filename = path.basename(req.params.filename);
  const filePath = path.join(MANUAL_SIGS_DIR, jobId, filename);
  if (!filePath.startsWith(MANUAL_SIGS_DIR) || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  res.sendFile(filePath);
});

app.get('/po-attachments/:poId/:filename', requireAuth, (req, res) => {
  const poId = path.basename(req.params.poId);
  const filename = path.basename(req.params.filename);
  const filePath = path.join(PO_ATTACHMENTS_DIR, poId, filename);
  if (!filePath.startsWith(PO_ATTACHMENTS_DIR) || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  res.sendFile(filePath);
});

// Job photo uploads served through authenticated route in jobPhotos.js

// ── REQUEST LOGGER (catch all incoming) ─────────────────────
app.use((req, res, next) => {
  if (req.path.startsWith('/webhook') || req.path === '/health') {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} from ${req.ip}`);
  }
  next();
});

// ── RATE LIMITING ─────────────────────────────────────────────
app.set('trust proxy', 1);

// Broad API limiter — 300 requests per minute per IP (protects against scanning/scraping)
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  message: { error: 'Too many requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/health', // don't limit keep-alive pings
});
app.use('/api/', apiLimiter);

// Strict login limiter — 10 attempts per 15 minutes
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/auth/login', loginLimiter);

// Webhook limiter — 60 calls per minute (Resend/Twilio webhooks)
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Webhook rate limit exceeded.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/webhook/', webhookLimiter);

// ── BLANK CONTRACT DOWNLOAD ───────────────────────────────────
app.get('/api/blank-contract', requireAuth, async (req, res) => {
  try {
    const { generateBlankContractDocx } = require('./services/pdfService');
    const buffer = await generateBlankContractDocx();
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    res.setHeader('Content-Disposition', 'attachment; filename="PB_Contract_Template_BLANK.docx"');
    res.send(buffer);
  } catch (err) {
    console.error('Blank contract error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── HEALTH CHECK ─────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.4.0' });
});

// ── API ROUTES ────────────────────────────────────────────────
app.use('/api/auth', require('./routes/auth'));
app.use('/api/jobs', require('./routes/jobs'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/knowledge', require('./routes/knowledge'));
app.use('/api/knowledge', require('./routes/knowledgeImport'));
app.use('/api/conversations', require('./routes/conversations'));
app.use('/api/chat', require('./routes/adminChat'));
app.use('/api/whitelist', require('./routes/whitelist'));
app.use('/api/contacts', require('./routes/contacts'));
app.use('/api/vendors', require('./routes/vendors'));
app.use('/api/rfq', require('./routes/rfq'));
app.use('/api/tasks', require('./routes/tasks').router);
app.use('/api/jobs', require('./routes/jobPhotos'));
app.use('/api/secrets', require('./routes/secrets'));
app.use('/api/status', require('./routes/status'));
app.use('/api/users', require('./routes/users'));
app.use('/api/remote-update', require('./routes/remoteUpdate'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/invoices', require('./routes/invoices').router);
app.use('/api/activity-log', require('./routes/activityLog').router);
app.use('/api/analytics', require('./routes/analytics'));
app.use('/api/departments', require('./routes/departments'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/email-log', require('./routes/emailLog'));
app.use(require('./routes/emailTracking'));
app.use('/api/field-photos', require('./routes/fieldPhotos'));
app.use('/api/agents', require('./routes/agents'));
app.use('/api/leads', require('./routes/leads'));
app.use('/api/ai', require('./routes/aiDocs'));
app.use('/api/lead-check', require('./routes/leadCheck'));
app.use('/api/purchase-orders', require('./routes/purchaseOrders'));
app.use('/api/staff-chat', require('./routes/staffChat'));
app.use('/api/direct-invoices', require('./routes/directInvoices'));

// ── SIGNING (public pages at /sign/* + api at /api/signing/*) ─
app.use(require('./routes/signing'));
// ── SIGNING ADMIN (send-proposal, send-contract, status) ──────
app.use(require('./routes/signingAdmin'));
app.use('/api/manual-signature', require('./routes/manualSignature'));
app.use('/api/print', require('./routes/print'));
app.use('/api/scan', require('./routes/scan'));

// ── CUSTOMER PORTAL (public page at /portal/:token + api at /api/portal/*) ─
app.use(require('./routes/customerPortal'));

// ── WEBHOOKS (no auth — verified by signature) ────────────────
app.use('/webhook/hearth', require('./routes/webhookHearth'));
app.use('/webhook/email', require('./routes/webhookEmail'));
app.use('/webhook/whatsapp', require('./routes/webhookWhatsapp'));
app.use('/webhook', require('./routes/emailLog'));

// ── TRADE SELECT (public — tokenized one-time mobile selection page) ──
app.use(require('./routes/tradeSelect'));

// ── SERVE REACT FRONTEND (production) ────────────────────────
const clientBuild = path.join(__dirname, '../client/build');
if (fs.existsSync(clientBuild)) {
  app.use(
    express.static(clientBuild, {
      etag: false,
      maxAge: 0,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
          res.setHeader('Pragma', 'no-cache');
        }
      },
    }),
  );
  app.get('*', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.sendFile(path.join(clientBuild, 'index.html'));
  });
}

// ── ERROR HANDLER ─────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('Server error:', err.message || err, err.stack || '');
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

// ── START ─────────────────────────────────────────────────────
function listenWithRetry(port, maxRetries = 5, delayMs = 2000) {
  return new Promise((resolve, reject) => {
    let attempts = 0;

    function attempt() {
      httpServer.listen(port, () => resolve(httpServer));
      httpServer.on('error', (err) => {
        if (err.code === 'EADDRINUSE' && attempts < maxRetries) {
          attempts++;
          console.log(
            `Port ${port} in use, retrying in ${delayMs}ms (attempt ${attempts}/${maxRetries})...`,
          );
          setTimeout(attempt, delayMs);
        } else {
          reject(err);
        }
      });
    }
    attempt();
  });
}

async function start() {
  try {
    await initDatabase();
    console.log('✅ Database initialized');

    await listenWithRetry(PORT);

    console.log(`
╔═══════════════════════════════════════════╗
║   PREFERRED BUILDERS AI SYSTEM            ║
║   Running on port ${PORT}                    ║
║   Admin panel: http://localhost:${PORT}      ║
╚═══════════════════════════════════════════╝
    `);

    // Also listen on port 3001 for Replit webview (external port 80 → local 3001)
    // Socket.io is attached to this server too so real-time works through the proxy.
    if (String(PORT) !== '3001') {
      const secondary = http.createServer(app);
      io.attach(secondary);
      secondary
        .listen(3001, () => {
          console.log('📡 Also listening on port 3001 (Replit webview proxy, Socket.io attached)');
        })
        .on('error', (e) => {
          if (e.code !== 'EADDRINUSE') console.warn('Port 3001 listen error:', e.message);
        });
    }

    const { startKeepAlive } = require('./services/keepAlive');
    startKeepAlive(PORT);

    const { startStatusScheduler } = require('./services/statusScheduler');
    startStatusScheduler();

    const { startBackupScheduler } = require('./services/backupService');
    startBackupScheduler();

    const { startPolling } = require('./services/whatsappPoller');
    const { handleIncomingWhatsApp } = require('./routes/webhookWhatsapp');
    if (process.env.DISABLE_WHATSAPP_POLLER !== 'true') {
      startPolling(handleIncomingWhatsApp, 5000);
    } else {
      console.log('📵 WhatsApp poller disabled (DISABLE_WHATSAPP_POLLER=true)');
    }

    const { startEmailPolling } = require('./services/emailPoller');
    startEmailPolling(15 * 60 * 1000);

    const { startTaskReminderScheduler } = require('./services/taskReminder');
    startTaskReminderScheduler();
  } catch (err) {
    console.error('Failed to start:', err);
    process.exit(1);
  }
}

start();
