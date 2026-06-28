# Preferred Builders AI System — Change Log & Multi-Tenant Import Guide

---

## HOW TO USE THIS DOCUMENT

This file serves two purposes:
1. **Daily change log** — record of every schema, feature, and fix since launch
2. **Multi-tenant import guide** — ordered instructions for porting these changes to another tenant instance

**When importing to a new tenant, work top-to-bottom:**
- Apply **Part 1** (schema) first, in numbered order — each migration assumes the prior ones exist
- Then apply **Part 2** (backend logic) — organized by module so you can port one area at a time
- Then apply **Part 3** (frontend) — each section maps to a page or component
- Read **Part 4** (multi-tenant notes) before going live — flags what is PB-specific and needs parameterizing

**Schema safety:** All migrations in this app use `addColIfMissing()` at startup, so they are
non-destructive and idempotent. Running `pm2 restart` on a new tenant instance with the updated
code is sufficient — no manual `ALTER TABLE` needed unless your platform controls schema separately.

---

## PART 1 — SCHEMA MIGRATIONS (apply in order)

Apply these in sequence. If your platform manages schema separately from the app, run these
`ALTER TABLE` / `CREATE TABLE` statements directly on each tenant's database before deploying code.

---

### M-001 — Core tables (pre-March 2026)

```sql
CREATE TABLE jobs (...);                  -- main job/project records
CREATE TABLE conversations (...);         -- inbound/outbound WhatsApp + email messages
CREATE TABLE clarifications (...);        -- AI clarification Q&A per job
CREATE TABLE settings (...);              -- key/value config (markup %, labor rates, allowances)
CREATE TABLE knowledge_base (...);        -- context documents fed to Claude
CREATE TABLE approved_senders (...);      -- whitelist for inbound message senders
CREATE TABLE audit_log (...);             -- action history per job
CREATE TABLE token_usage (...);           -- Claude/Perplexity API token tracking
CREATE TABLE contacts (...);              -- customer CRM records
CREATE TABLE contact_documents (...);     -- files attached to contacts
CREATE TABLE customer_serial_counter (...); -- per-year contact serial numbers
CREATE TABLE tasks (...);                 -- internal to-do list
CREATE TABLE signing_sessions (...);      -- proposal & contract e-signature sessions
CREATE TABLE users (...);                 -- per-user login accounts
CREATE TABLE job_photos (...);            -- photos attached to a job record
CREATE TABLE whatsapp_processed (...);    -- dedup table for WhatsApp message SIDs
```

Early column additions:
```sql
ALTER TABLE jobs ADD COLUMN archived INTEGER DEFAULT 0;
ALTER TABLE jobs ADD COLUMN archived_at DATETIME;
ALTER TABLE contacts ADD COLUMN customer_number TEXT;
ALTER TABLE jobs ADD COLUMN contact_id INTEGER;
ALTER TABLE jobs ADD COLUMN quote_number TEXT;
ALTER TABLE jobs ADD COLUMN version INTEGER DEFAULT 1;
ALTER TABLE jobs ADD COLUMN parent_job_id TEXT;
ALTER TABLE jobs ADD COLUMN estimate_source TEXT DEFAULT 'ai';
ALTER TABLE users ADD COLUMN phone TEXT;
ALTER TABLE users ADD COLUMN language TEXT DEFAULT 'en';
ALTER TABLE users ADD COLUMN title TEXT DEFAULT 'Team Member';
ALTER TABLE users ADD COLUMN active INTEGER DEFAULT 1;
```

---

### M-002 — Quote versioning + payment tracking (2026-03-17)

```sql
CREATE TABLE payments_received (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER, amount REAL, date_received TEXT,
  payment_type TEXT, check_number TEXT,
  credit_debit TEXT NOT NULL DEFAULT 'credit',
  recorded_by TEXT, notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE payments_made (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER, amount REAL, date_paid TEXT,
  category TEXT, check_number TEXT,
  credit_debit TEXT NOT NULL DEFAULT 'debit',
  recorded_by TEXT, notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE pb_quote_counter (...);   -- year-based PB-YYYY-NNNN counter
CREATE TABLE quote_auto_counter (...); -- sequential customer-facing quote numbers

ALTER TABLE jobs ADD COLUMN pb_number TEXT;
ALTER TABLE jobs ADD COLUMN external_ref TEXT;
ALTER TABLE jobs ADD COLUMN quote_version INTEGER DEFAULT 1;
ALTER TABLE payments_received ADD COLUMN time_received TEXT;
ALTER TABLE payments_made ADD COLUMN time_paid TEXT;
ALTER TABLE jobs ADD COLUMN takeoff_data TEXT;
ALTER TABLE jobs ADD COLUMN closed_reason TEXT;
ALTER TABLE jobs ADD COLUMN closed_note TEXT;
ALTER TABLE jobs ADD COLUMN error_message TEXT;
```

---

### M-003 — Invoice + customer activity system (2026-03-28)

```sql
CREATE TABLE customer_activity_log (...); -- per-customer event log
CREATE TABLE invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER, invoice_number TEXT, invoice_type TEXT,
  status TEXT DEFAULT 'draft', amount REAL,
  contract_amount REAL DEFAULT 0, pass_through_amount REAL DEFAULT 0,
  pb_due_amount REAL DEFAULT 0, full_contract_value REAL DEFAULT 0,
  amount_paid REAL DEFAULT 0, issued_at DATETIME, paid_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE invoice_counters (
  job_id INTEGER PRIMARY KEY, contract_seq INTEGER DEFAULT 0,
  pass_through_seq INTEGER DEFAULT 0, co_seq INTEGER DEFAULT 0
);
CREATE TABLE email_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  to_email TEXT, subject TEXT, status TEXT,
  sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  html_body TEXT
);
CREATE TABLE pb_customer_counter (...); -- simple sequential PB-C-XXXX counter

ALTER TABLE payments_made ADD COLUMN payment_class TEXT NOT NULL DEFAULT 'cost_of_revenue';
ALTER TABLE payments_made ADD COLUMN dept_code TEXT;
ALTER TABLE payments_made ADD COLUMN is_pass_through INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payments_made ADD COLUMN line_item_ref TEXT;
ALTER TABLE payments_made ADD COLUMN paid_by TEXT NOT NULL DEFAULT 'pb';
ALTER TABLE payments_received ADD COLUMN payment_class TEXT NOT NULL DEFAULT 'contract';
ALTER TABLE payments_received ADD COLUMN is_pass_through_reimbursement INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payments_received ADD COLUMN invoice_id INTEGER;
ALTER TABLE payments_received ADD COLUMN line_item_ref TEXT;
ALTER TABLE contacts ADD COLUMN pb_customer_number TEXT;
ALTER TABLE email_log ADD COLUMN html_body TEXT;
```

---

### M-004 — Field photos + users (2026-03-24)

```sql
CREATE TABLE field_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL, original_name TEXT,
  taken_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  lat REAL, lon REAL, location_label TEXT, accuracy REAL,
  job_id TEXT, uploaded_by TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

### M-005 — Tasks enhancements (2026-03 → 2026-06)

```sql
ALTER TABLE tasks ADD COLUMN assigned_to TEXT;
ALTER TABLE tasks ADD COLUMN task_type TEXT DEFAULT 'manual';
ALTER TABLE tasks ADD COLUMN reminded_at DATETIME;
ALTER TABLE tasks ADD COLUMN recurrence TEXT NOT NULL DEFAULT 'none';
-- recurrence values: none | daily | weekly | biweekly | monthly
```

---

### M-006 — Signing sessions enhancements (2026-03 → 2026-05)

```sql
ALTER TABLE signing_sessions ADD COLUMN opened_at DATETIME;
ALTER TABLE signing_sessions ADD COLUMN signed_at DATETIME;
ALTER TABLE signing_sessions ADD COLUMN signature_data TEXT;   -- base64 drawn signature
ALTER TABLE signing_sessions ADD COLUMN signer_ip TEXT;
ALTER TABLE signing_sessions ADD COLUMN signer_name TEXT;
ALTER TABLE signing_sessions ADD COLUMN certificate_html TEXT; -- signing certificate embed
```

---

### M-007 — Marblism / AI agent API (2026-05-27)

```sql
CREATE TABLE agent_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_name TEXT, key_hash TEXT, secret_hash TEXT,
  callback_url TEXT, last_seen DATETIME, request_count INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE agent_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id INTEGER, direction TEXT,  -- 'inbound' | 'outbound'
  body TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (agent_id) REFERENCES agent_keys(id)
);
```

---

### M-008 — Invoice tracking on payments (2026-06-19)

```sql
-- invoice_id already added in M-003; this migration adds the index + back-fill
CREATE INDEX IF NOT EXISTS idx_payments_received_invoice ON payments_received(invoice_id);
```

---

### M-009 — Payment + invoice check number fields (2026-06-23)

```sql
ALTER TABLE payments_received ADD COLUMN check_number TEXT;
ALTER TABLE payments_made ADD COLUMN check_number TEXT;
ALTER TABLE payments_made ADD COLUMN payee_name TEXT;
```

---

### M-010 — Jobs payment overrides (2026-06-22)

```sql
ALTER TABLE jobs ADD COLUMN payment_overrides TEXT;
-- JSON blob: { "middleAmounts": [...], "finalAmount": N }
-- Used to override the default milestone payment schedule on a per-job basis
```

---

### M-011 — Leads pipeline (2026-04 → 2026-06)

```sql
CREATE TABLE leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  caller_name TEXT NOT NULL DEFAULT 'Unknown caller',
  caller_phone TEXT NOT NULL DEFAULT 'Unknown number',
  source TEXT NOT NULL DEFAULT 'marblism',
  stage TEXT NOT NULL DEFAULT 'incoming',
  notes TEXT, contact_id INTEGER, archived INTEGER NOT NULL DEFAULT 0,
  archive_reason TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE lead_documents (...);  -- PDF/file attachments per lead
CREATE TABLE lead_notes (...);      -- timestamped note entries per lead

-- Column additions (run after table exists)
ALTER TABLE leads ADD COLUMN appointment_at DATETIME;
ALTER TABLE leads ADD COLUMN job_address TEXT;
ALTER TABLE leads ADD COLUMN job_city TEXT;
ALTER TABLE leads ADD COLUMN job_email TEXT;
ALTER TABLE leads ADD COLUMN job_scope TEXT;
ALTER TABLE leads ADD COLUMN job_type TEXT;
ALTER TABLE leads ADD COLUMN job_id INTEGER;
ALTER TABLE leads ADD COLUMN contact_id INTEGER;
ALTER TABLE leads ADD COLUMN pb_customer_number TEXT;
ALTER TABLE leads ADD COLUMN wizard_draft TEXT;
ALTER TABLE leads ADD COLUMN stage_entered_at DATETIME;
-- stage_entered_at is set automatically on every stage transition
```

---

### M-012 — Direct invoices (2026-05-09)

```sql
CREATE TABLE direct_invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER, invoice_number TEXT, status TEXT DEFAULT 'draft',
  total REAL DEFAULT 0, amount_paid REAL DEFAULT 0,
  issued_at DATETIME, paid_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

### M-013 — Vendors directory (2026-04 → 2026-06)

```sql
CREATE TABLE vendors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_name TEXT, type TEXT, trade TEXT,
  phone TEXT, website TEXT, email TEXT,
  address TEXT, city TEXT, state TEXT, zip TEXT,
  license_number TEXT, notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE vendor_documents (...); -- workers comp, GL insurance, etc.
```

---

### M-014 — Staff chat (2026-05)

```sql
CREATE TABLE staff_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender TEXT NOT NULL, body TEXT NOT NULL,
  recipient TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## PART 2 — BACKEND CHANGES BY MODULE

Each section describes what was added or changed in the server-side code.
Port these to a new tenant by copying the referenced route/service files and adapting
any company-specific constants (markup rates, email addresses, license numbers).

---

### MODULE: Invoicing & Payments

**What was built:**
- Full invoice lifecycle: draft → sent → paid → void
- Invoice types: contract milestones, pass-through, change orders, direct invoices
- Auto-link incoming payments to open invoices by job + amount matching
- Invoice retry queue — `pending_send` invoices auto-retried every 4 hours
- Per-job customizable payment schedules (override deposit %, milestones, final)
- Next-milestone invoice auto-generated when current milestone is collected
- Invoice status badges on Dashboard, Job Overview, and Payments tabs
- Reconciliation warnings on Analytics when payments are unlinked
- Signed contract upload required before job can be marked `contract_signed`
- Payments auto-recorded when invoice is marked paid
- Check number field on all payment records

**Key files:**
- `server/routes/invoices.js` — invoice CRUD + send + mark-paid
- `server/routes/estimates.js` — payment schedule overrides
- `server/services/invoiceService.js` — milestone logic
- `server/routes/payments.js` — payment ledger

**Multi-tenant notes:**
- Email templates in invoice send routes reference PB brand — update per tenant
- Markup percentages come from `settings` table — each tenant configures their own
- Invoice number format (`PB-INV-YYYY-NNNN`) prefix should be made configurable per tenant

---

### MODULE: Document Signing

**What was built:**
- Proposal and contract e-signing via unique token URLs (no login required for customer)
- Drawn signature captured as base64, embedded in signed PDF
- Signing certificate (date, IP, signer name) appended to PDF
- Old signing links automatically invalidated when new ones are sent
- Read receipt tracking (opened_at timestamp)
- Auto follow-up task (3 days) created when proposal is sent for signing

**Key files:**
- `server/routes/signingAdmin.js` — send-proposal, send-contract (admin side)
- `server/routes/signing.js` — public signing page API
- `client/src/pages/Sign*.jsx` — customer-facing signing pages

**Multi-tenant notes:**
- Email template HTML in `signingAdmin.js` references PB company name, license, phone — parameterize from tenant settings
- Signing page branding (logo, colors) is currently hardcoded — move to per-tenant config

---

### MODULE: Leads Pipeline

**What was built:**
- Full lead pipeline: incoming → callback_done → appointment_booked → site_visit_complete → quote_draft → quote_sent → follow_up_1 → follow_up_2 → signed
- Auto-create pipeline tasks at each stage transition
- Auto-push Google Calendar event when appointment is booked
- Stage duration tracking (`stage_entered_at` resets on transition)
- Stale lead badges — per-stage thresholds (1d, 2d, 3d, 7d)
- Lead card inline editing (name, phone, email, address, job type)
- Lead documents and notes ledger
- Lead → Contact graduation when `quote_sent` or `signed`
- Archive with reason (price / timing / competitor / ghosted / mistake)

**Key files:**
- `server/routes/leads.js` — full CRUD + stage transitions + auto-tasks
- `client/src/pages/Leads.jsx` — pipeline board UI
- `client/src/pages/Tasks.jsx` — tasks linked to leads shown here too

**Multi-tenant notes:**
- Stage labels and pipeline sequence are hardcoded — make configurable per tenant if their sales process differs
- Auto-task titles reference "Preferred Builders" in some places — search for hardcoded strings
- Calendar event auto-push uses Replit Google connector — rebuild with standard OAuth for own server

---

### MODULE: Tasks & Reminders

**What was built:**
- Task list with status (pending / done), priority, due date, assigned_to
- Recurring tasks: daily / weekly / biweekly / monthly — next instance auto-created on done
- Person filter (All / per staff member) on Tasks page
- Snooze / reminder system — set remind_at with repeat interval
- Google Calendar link auto-generated per task
- Auto follow-up task when proposal is sent for signing

**Key files:**
- `server/routes/tasks.js` — CRUD + recurrence logic
- `client/src/pages/Tasks.jsx` — tasks page UI

**Multi-tenant notes:**
- Staff member names in person filter are loaded dynamically from `/api/staff-chat/users` — no hardcoding
- Calendar push uses Replit connector — rebuild with standard OAuth for own server

---

### MODULE: Production Monitoring (Probe API)

**What was built:**
- Read-only `/api/probe/*` endpoints — query production DB from Replit dev environment
- Auth: `PROBE_READ_TOKEN` bearer token
- Endpoints: `health`, `stats`, `jobs`, `jobs/:id`, `jobs/:id/detail`, `payments`, `errors`, `leads`, `tasks`
- Companion scripts: `scripts/prod_query.js`, `scripts/prod_patch.js`, `scripts/gen_probe_token.js`

**Key files:**
- `server/routes/probe.js`
- `scripts/prod_query.js`

**Multi-tenant notes:**
- Each tenant needs its own `PROBE_READ_TOKEN` generated and stored in their env
- Probe route is registered in `server/index.js` — must be mounted before the React catch-all

---

### MODULE: Marblism AI Agent Integration

**What was built:**
- External AI agents can authenticate via SHA-256 hashed API key + secret
- Inbound calls from Marblism forwarded to lead intake pipeline
- Agent message thread stored per agent in `agent_messages` table
- Agent API: `POST /api/agent/message`, `GET /api/agent/thread`

**Key files:**
- `server/routes/agentApi.js` (or equivalent)
- `server/db/database.js` — `agent_keys`, `agent_messages` tables

**Multi-tenant notes:**
- Agent keys are per-tenant — each tenant gets their own key/secret pair
- Marblism callback URL must point to the tenant's domain
- This module can be entirely disabled per tenant if they don't use call forwarding

---

### MODULE: Error Hardening & Server Stability

**What was built:**
- Global error handler catches `entity.parse.failed` (malformed JSON) — returns 400 instead of crash
- Dropped file uploads handled gracefully — 400 response, no server crash
- Send-contract and send-proposal routes wrapped in try/catch
- Contract send error serialization fixed in global error handler
- Application log access fixed (route ordering issue)

**Key files:**
- `server/index.js` — global error handler
- `server/routes/signingAdmin.js` — try/catch on email send

---

## PART 3 — FRONTEND CHANGES BY PAGE

---

### PAGE: Dashboard (`client/src/pages/Dashboard.jsx`)
- Invoice status summary badges on each job card
- Reconciliation warning badge when payments unlinked
- Edit button label clarification

### PAGE: Job Detail (`client/src/pages/JobDetail.jsx`)
- Payments tab: check number field, split payment siblings, AR/AP labels
- Overview tab: invoice status panel (stage-gated), Cash Margin to Date
- Signatures tab: signed contract upload requirement
- Assessment tab: margin scorecard with cash-margin-to-date card
- Contract number displayed and searchable

### PAGE: Invoices (`client/src/pages/Invoices.jsx`)
- New dedicated invoices page (global, not per-job)
- Edit button with activity log
- Link invoice to specific job
- Credit/Discount line item type
- Quantity + unit price fields on material line items

### PAGE: Leads (`client/src/pages/Leads.jsx`)
- Full pipeline board with stage columns
- Stale lead badges (⚠️ Xd stale) + days-in-stage display
- Inline editing of lead fields
- Notes ledger + document upload per lead
- Google Calendar "Add to Calendar" link on appointment

### PAGE: Tasks (`client/src/pages/Tasks.jsx`)
- Person filter (All / per staff member) — green filter buttons
- Recurring task badge (🔁 Weekly etc.) on task rows
- Recurrence dropdown in task creation form
- Snooze / reminder system (already documented)

### PAGE: Analytics (`client/src/pages/Analytics.jsx`)
- Reconciliation warnings panel (unlinked payments flagged)
- Won revenue calculation fix (contract_signed + completed only)

### PAGE: Settings (`client/src/pages/Settings.jsx`)
- Deploy tab — git pull + pm2 restart from browser
- Self-service home IP approval for remote access
- Invoice trigger stage configuration (which job stage shows the invoice panel)

### PAGE: Payments (`client/src/pages/Payments.jsx`)
- Global payment ledger with AR/AP classification
- Split payment group visualization
- Class breakdown column

---

## PART 4 — MULTI-TENANT ADAPTATION NOTES

The following items are currently hardcoded for Preferred Builders and must be
parameterized or overridden per tenant before going live:

| Item | Location | What to do |
|------|----------|------------|
| Company name, license, phone | `config/parameters.js`, email templates in `signingAdmin.js` | Move to tenant `settings` table |
| Markup percentages (15% / 25% / 10%) | `config/parameters.js` | Already overridable via `settings` table — confirm defaults per tenant |
| Google Calendar auth | `server/services/googleCalendar.js` | Uses Replit connector — rebuild with standard OAuth 2.0 per tenant |
| Email sender (Mailgun/Resend) | `server/services/emailService.js` | Move API key + sender domain to per-tenant env vars |
| Twilio WhatsApp | `server/services/whatsappService.js` | Move account SID + auth token to per-tenant env vars |
| Claude AI key | `server/services/claudeService.js` | Move `ANTHROPIC_API_KEY` to per-tenant env |
| Probe read token | `server/routes/probe.js` | Each tenant needs unique `PROBE_READ_TOKEN` |
| Agent API keys (Marblism) | `agent_keys` table | Per-tenant rows — generate separately for each |
| Staff users (Jackson / Anthony) | `server/db/database.js` seed | Re-seed with tenant's actual staff + reset passwords |
| CSL license number | `config/parameters.js`, `server/services/contractTemplate.js` | Move to `settings` table |
| HIC license number | Same as above | Same |
| PB customer number prefix (PB-C-) | `server/db/database.js` | Make prefix configurable per tenant |

**Session storage:** Sessions are currently in-memory (lost on restart). For multi-tenant production,
move to SQLite or Redis with a tenant-scoped session store before launching.

**Database isolation:** Each tenant must have their own `data/pb_system.db` file (or separate
database connection). Never share a SQLite file across tenants.

---

## PART 5 — DAILY CHANGE LOG (chronological, for reference)

_Use this section to log new changes as they happen. Add to the top of PART 1 when schema changes._

---

### 2026-06-26 — Leads pipeline + tasks improvements

- [fix] Lead appointment Google Calendar events now use UTC (`ctz=UTC`)
- [feature] "Appointment" renamed to "Site Visit" throughout leads pipeline and calendar events
- [feature] Auto-push Google Calendar event when lead advances to `appointment_booked`
- [schema] `ALTER TABLE leads ADD COLUMN stage_entered_at DATETIME`
- [feature] Stage duration tracking — `stage_entered_at` resets on every stage transition
- [feature] Stale lead badges — per-stage thresholds (incoming 1d, callback/site-visit 2d, quote_draft 3d, quote_sent/follow-ups 7d)
- [feature] Task person filter — filter by assigned staff member
- [schema] `ALTER TABLE tasks ADD COLUMN recurrence TEXT NOT NULL DEFAULT 'none'`
- [feature] Recurring tasks — next instance auto-created when task is marked done
- [feature] Auto follow-up task (3 days) when proposal is sent for signing
- [feature] Probe API: `/api/probe/leads` and `/api/probe/tasks` endpoints added

---

### 2026-06-24 — Server hardening

- [fix] Global error handler catches malformed JSON (`entity.parse.failed`) → clean 400
- [fix] Multipart file upload Content-Type bug in JobDetail.jsx resolved

---

### 2026-06-23 — Production probe + accounting hardening

- [feature] Read-only API probe (`/api/probe/*`) for querying production from Replit
- [feature] Contract number displayed + searchable on job detail
- [feature] Auto-link incoming payments to open invoices
- [schema] `ALTER TABLE payments_received ADD COLUMN check_number TEXT`
- [schema] `ALTER TABLE payments_made ADD COLUMN check_number TEXT`
- [schema] `ALTER TABLE payments_made ADD COLUMN payee_name TEXT`
- [feature] Milestone auto-adjustment + next-milestone invoice auto-generation
- [feature] 4 lower-priority accounting items: payment overrides, milestone tracking, financial endpoint, query fixes

---

### 2026-06-22 — Payment schedule overrides + print-friendly proposals

- [feature] Per-job customizable payment schedules
- [schema] `ALTER TABLE jobs ADD COLUMN payment_overrides TEXT`
- [feature] Milestone payment amounts manually adjustable
- [feature] Signed contract upload required before `contract_signed`
- [feature] Print-friendly proposals (reduced ink)

---

### 2026-06-19 — Unified invoice & payment sync

- [feature] Unified invoice + payment sync — full reconciliation system
- [feature] Invoice retry queue — auto-resend `pending_send` invoices every 4h
- [feature] `invoice_id` written on all auto-created payment records
- [feature] Invoice status badges on Job Overview + Payments tabs
- [feature] Invoice status summary badges on Dashboard job cards
- [feature] Reconciliation warnings on Analytics page
- [feature] Edit button on master Invoices page
- [feature] InvoiceStatusPanel stage-rank gating (configurable trigger stage)
- [fix] Invoice edit modal only opens clicked invoice
- [fix] Duplicate invoice links on same-amount payments resolved
- [feature] Job dropdowns show address + contract number

---

### 2026-06-15 — Claude model update + lead editing

- [fix] Claude model updated to `claude-sonnet-4-5`
- [feature] Lead card inline editing — email + address editable directly on pipeline card

---

### 2026-06-10 — SOW editing

- [feature] Project description editable when revising an estimate

---

### 2026-06-08 — Invoice + proposal improvements

- [feature] Invoice generation includes permit + engineer fees
- [feature] Invoice balance auto-populated from contract payment history
- [feature] System admin: import + regenerate proposals from raw JSON

---

### 2026-05-27 — Marblism integration

- [feature] Marblism AI agent API — call forwarding + AI-assisted lead intake
- [schema] `CREATE TABLE agent_keys`
- [schema] `CREATE TABLE agent_messages`

---

### 2026-05-20 — Split payments, signed PDF certificates, remote deploy

- [feature] Deploy tab in Settings — git pull + pm2 restart from browser
- [feature] Self-service home IP approval for remote Settings access
- [feature] Split payments — AR/AP classification, pass-through, overhead
- [feature] Invoice 1 auto-created when contract is signed
- [feature] Per-job payment class breakdown
- [feature] Drawn signature + signing certificate embedded in signed PDFs
- [feature] Cash Margin to Date card on Job Assessment scorecard

---

### 2026-05-19 — Error hardening + line item notes

- [fix] Dropped file uploads no longer crash server
- [feature] Note field on estimate line items — visible in proposal PDF
- [fix] Contract send error handling corrected

---

### 2026-05-15 — Invoice auto-pay + mobile fixes

- [feature] Payments auto-recorded when invoice marked paid
- [fix] Blank screen after login resolved
- [feature] Credit/Discount line item type on Direct Invoice modal

---

### 2026-05-13 — Signing link security

- [fix] Old signing links invalidated when new proposal/contract is sent

---

### 2026-05-09 — Direct invoices + invoice management page

- [feature] Direct invoice system — send/manage customer-facing payment invoices
- [feature] Dedicated `/invoices` page (global, not per-job)
- [feature] Quantity + unit price fields on material line items
- [schema] `CREATE TABLE direct_invoices`

---

### 2026-05-08 — Lead task deduplication

- [fix] Prevent duplicate pipeline tasks when lead advances multiple stages quickly

---

### 2026-04-28 — TOLF contract corrections (legal)

- [legal] Applied all 7 Ottley Law Firm (TOLF) review corrections to `contractTemplate.js`
- [legal] Status: AWAITING EXTERNAL ACTION — email corrected files to TOLF, record written confirmation

---

### 2026-03-30 — ESLint/Prettier + code split refactors

- [chore] ESLint + Prettier configured (`npm run lint`)
- [chore] `pdfService.js`, `claudeService.js`, `estimates.js`, `signing.js`, `jobs.js` all split into focused modules

---

### 2026-03-28 — Invoice, ledger & customer activity system

_(See M-003 in Part 1 for schema details)_

---

### 2026-03-24 — Email migration, field camera, error alerting

- [feature] Email switched to Resend (outbound SMTP via Resend API)
- [feature] Standalone field camera with GPS grouping (`field_photos` table)
- [feature] Smart error alerting — critical errors emailed to owner

---

### 2026-03-25 — Auth cleanup

- [fix] PIN system reverted; replaced with per-user bcrypt password auth
- [feature] Claude guardrail added — AI cannot leak internal cost data to customers

---

### 2026-03-19 — Keep-alive + estimate versioning

- [feature] Keep-alive self-ping (pings `/health` every 300s)
- [feature] Claude estimate versioning — increments `version` on each revision

---

### 2026-03-18 — Material Take-Off page

- [feature] Material Take-Off tab added to job detail; `takeoff_data` stores JSON breakdown

---

### 2026-03-17 — Quote versioning + payment tracking

_(See M-002 in Part 1 for schema details)_

---

### Pre-2026-03-14 — Initial schema + early migrations

_(See M-001 in Part 1 for full details)_

---

## ADD NEW ENTRIES ABOVE THIS LINE

### YYYY-MM-DD — Title
- [schema] `ALTER TABLE ...`
- [feature] Description
- [fix] Description
- [chore] Description
