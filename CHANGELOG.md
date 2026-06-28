# Preferred Builders AI System — Changelog

## How to use
Add an entry under **today's date** whenever you make a schema change, major feature, or anything
that affects a Windows deploy. At end of day, note which `ALTER TABLE` statements (if any)
need to be run manually on the Windows machine before `git pull` + `pm2 restart`.

Format for each entry:
```
### YYYY-MM-DD
- [schema] ALTER TABLE jobs ADD COLUMN foo TEXT  ← copy exact SQL if needed on Windows
- [feature] Brief description of what changed
- [fix] Brief description of what was fixed
```

---

## Prior History

### Pre-2026-03-14 (initial schema + early migrations)

**Core tables created at launch:**
- `jobs` — main job/project records
- `conversations` — inbound/outbound messages (WhatsApp, email)
- `clarifications` — AI clarification Q&A per job
- `settings` — key/value store for markup, labor rates, allowances
- `knowledge_base` — context documents fed to Claude
- `approved_senders` — whitelist for inbound messages
- `audit_log` — action history per job
- `token_usage` — Claude/Perplexity API token tracking
- `contacts` — customer CRM records
- `contact_documents` — files attached to contacts

**Early migrations (run on existing DBs at startup):**
```sql
ALTER TABLE jobs ADD COLUMN archived INTEGER DEFAULT 0;
ALTER TABLE jobs ADD COLUMN archived_at DATETIME;
ALTER TABLE contacts ADD COLUMN customer_number TEXT;       -- PB-C-YEAR-NNNN format
ALTER TABLE jobs ADD COLUMN contact_id INTEGER;
ALTER TABLE jobs ADD COLUMN quote_number TEXT;
ALTER TABLE jobs ADD COLUMN version INTEGER DEFAULT 1;
ALTER TABLE jobs ADD COLUMN parent_job_id TEXT;
ALTER TABLE jobs ADD COLUMN estimate_source TEXT DEFAULT 'ai';
```

**Tables added in early phase:**
- `customer_serial_counter` — tracks per-year contact serial numbers
- `tasks` — internal to-do list
- `signing_sessions` — proposal & contract e-signature sessions (token, status, IP, signature data)
- `users` — per-user login (Anthony = system_admin, Jackson = admin)
- `job_photos` — photos attached to a job record
- `whatsapp_processed` — dedup table for WhatsApp message SIDs (auto-purged after 24h)

**User profile migration:**
```sql
ALTER TABLE users ADD COLUMN phone TEXT;
ALTER TABLE users ADD COLUMN language TEXT DEFAULT 'en';
ALTER TABLE users ADD COLUMN title TEXT DEFAULT 'Team Member';
ALTER TABLE users ADD COLUMN active INTEGER DEFAULT 1;
```

---

### 2026-03-17 — Quote versioning + payment tracking

**New tables:**
- `payments_received` — checks/deposits in from customers
- `payments_made` — checks out to subs/vendors
- `pb_quote_counter` — year-based quote number counter (PB-YYYY-NNNN)
- `quote_auto_counter` — sequential customer-facing quote numbers (1001, 1002…)

**Schema additions:**
```sql
ALTER TABLE jobs ADD COLUMN pb_number TEXT;
ALTER TABLE jobs ADD COLUMN external_ref TEXT;
ALTER TABLE jobs ADD COLUMN quote_version INTEGER DEFAULT 1;
ALTER TABLE payments_received ADD COLUMN time_received TEXT;
ALTER TABLE payments_received ADD COLUMN credit_debit TEXT NOT NULL DEFAULT 'credit';
ALTER TABLE payments_received ADD COLUMN recorded_by TEXT;
ALTER TABLE payments_made ADD COLUMN time_paid TEXT;
ALTER TABLE payments_made ADD COLUMN credit_debit TEXT NOT NULL DEFAULT 'debit';
ALTER TABLE payments_made ADD COLUMN recorded_by TEXT;
ALTER TABLE jobs ADD COLUMN takeoff_data TEXT;
ALTER TABLE jobs ADD COLUMN closed_reason TEXT;
ALTER TABLE jobs ADD COLUMN closed_note TEXT;
ALTER TABLE jobs ADD COLUMN error_message TEXT;
```

---

### 2026-03-18 — Material Take-Off page

- [feature] Material Take-Off tab added to job detail; `takeoff_data` column stores JSON breakdown

---

### 2026-03-19 — Keep-alive + estimate versioning

- [feature] Keep-alive self-ping service (pings `/health` every 300s to prevent Replit sleep)
- [feature] Claude estimate versioning — estimates increment `version` on each revision

---

### 2026-03-20 — Proposal Assessment, Win/Loss, Profit breakdown

- [feature] Proposal Assessment tab on job detail (AI-powered scope gap analysis)
- [feature] Win/Loss tracking + pipeline analytics dashboard
- [feature] Job audit profit margin breakdown

---

### 2026-03-24 — Email migration, field camera, error alerting

- [feature] Email service switched to Resend (outbound SMTP via Resend API)
- [feature] Standalone field camera with GPS grouping — `field_photos` table

**New table:**
```sql
CREATE TABLE field_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  original_name TEXT,
  taken_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  lat REAL, lon REAL,
  location_label TEXT,
  accuracy REAL,
  job_id TEXT,
  uploaded_by TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

- [feature] Smart error alerting — critical server errors emailed to owner + logged to GitHub Issues

---

### 2026-03-25 — Auth cleanup

- [fix] Reverted PIN system; replaced with per-user password auth
- [feature] Claude guardrail added to prevent AI from leaking internal cost data in customer-facing outputs

---

### 2026-03-28 — Invoice, Ledger & Customer Activity System

**New tables:**
- `customer_activity_log` — per-customer event log (proposals sent, contracts signed, payments, etc.)
- `invoices` — contract invoices, pass-through invoices, change-order invoices
- `invoice_counters` — per-job sequence counters for each invoice type
- `email_log` — outbound email log with open tracking

**Schema additions:**
```sql
-- Invoices
ALTER TABLE invoices ADD COLUMN contract_amount REAL NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN pass_through_amount REAL NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN pb_due_amount REAL NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN full_contract_value REAL NOT NULL DEFAULT 0;
ALTER TABLE invoice_counters ADD COLUMN co_seq INTEGER NOT NULL DEFAULT 0;

-- Payments classification
ALTER TABLE payments_made ADD COLUMN payment_class TEXT NOT NULL DEFAULT 'cost_of_revenue';
ALTER TABLE payments_made ADD COLUMN dept_code TEXT;
ALTER TABLE payments_made ADD COLUMN is_pass_through INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payments_made ADD COLUMN line_item_ref TEXT;
ALTER TABLE payments_made ADD COLUMN paid_by TEXT NOT NULL DEFAULT 'pb';
ALTER TABLE payments_received ADD COLUMN payment_class TEXT NOT NULL DEFAULT 'contract';
ALTER TABLE payments_received ADD COLUMN is_pass_through_reimbursement INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payments_received ADD COLUMN invoice_id INTEGER;
ALTER TABLE payments_received ADD COLUMN line_item_ref TEXT;

-- Email preview storage
ALTER TABLE email_log ADD COLUMN html_body TEXT;

-- New customer number format (PB-C-XXXX, simpler than year-based)
ALTER TABLE contacts ADD COLUMN pb_customer_number TEXT;
```

**New helper table:**
- `pb_customer_counter` — simple sequential counter for `PB-C-XXXX` customer IDs

---

### 2026-03-29 — ESLint/Prettier + code split refactors

- [chore] ESLint + Prettier configured for server-side code (`npm run lint`)
- [chore] `pdfService.js` split: HTML builders extracted to `pdfHtmlBuilder.js`
- [chore] `claudeService.js` split into `claudeEstimate.js`, `claudeContract.js`, `claudeChat.js` (barrel re-export kept)
- [chore] `estimates.js` wizard routes extracted to `estimateWizard.js`
- [chore] `signing.js` admin routes extracted to `signingAdmin.js`
- [chore] `jobs.js` split into focused route modules

---

### 2026-03-30 — Daily changelog added

- [chore] This file created; all prior migrations documented above

---

### 2026-04-28 — TOLF-corrected contract ready for attorney submission (awaiting external sign-off)

- [legal] Applied all 7 Ottley Law Firm (TOLF) contract review corrections to `server/services/contractTemplate.js`
- [legal] Corrected contract artifacts verified ready for delivery: `PB_Contract_CORRECTED.docx` and `PB_Contract_CORRECTED.pdf`
- [legal] Created attorney sign-off tracking record: `knowledge-base/legal/contract-attorney-signoff-2026-04-28.md`
- [legal] Status: AWAITING EXTERNAL ACTION — Preferred Builders staff must email files to Ottley Law Firm and record attorney written confirmation in the tracking doc before template is activated

---

---

### 2026-05-08 — Lead task deduplication

- [fix] Prevent duplicate pipeline tasks accumulating when a lead advances multiple stages quickly

---

### 2026-05-09 — Direct invoices + invoice management page

- [feature] Direct invoice system — create and send customer-facing payment invoices
- [feature] Dedicated `/invoices` page consolidating all invoice management across jobs
- [feature] Quantity + unit price fields on material line items in direct invoices
- [feature] Invoices can be linked to specific jobs for per-job financial tracking
- [feature] Credit/Discount line item type on Direct Invoice modal

---

### 2026-05-12 — Analytics calculation fixes

- [fix] Won revenue and pipeline value calculations corrected (contract_signed + completed jobs only)

---

### 2026-05-13 — Signing link security

- [fix] Old proposal/contract signing links are invalidated (status → superseded) when new ones are sent

---

### 2026-05-14 — Bug fixes

- [fix] White screen crash on RFQ detail page resolved
- [fix] Team chat button hidden when already on bot chat page (no duplicate nav)

---

### 2026-05-15 — Invoice auto-pay + mobile fixes

- [feature] Payments automatically recorded when invoices are marked paid
- [fix] Blank screen after login resolved (auth race condition)
- [fix] Stale content on mobile preview suppressed (cache-control headers)

---

### 2026-05-16 — Email log fix

- [fix] Email log refresh button and route ordering issue resolved

---

### 2026-05-19 — Error hardening + line item notes

- [fix] Dropped file uploads no longer crash the server — handled gracefully with 400
- [feature] Note field added to estimate line items; notes appear in proposal PDF
- [fix] Application log access restored
- [fix] Contract send missing try/catch fixed; global error handler serialization corrected

---

### 2026-05-20 — Split payments, signed PDF certificates, remote deploy

- [feature] **Deploy tab in Settings** — git pull + pm2 restart from the browser (no SSH needed)
- [feature] Self-service home IP approval for remote Settings access
- [feature] **Split payments** — classify payments as contract / pass-through / overhead; AR/AP financial section labels
- [feature] Invoice 1 auto-created when contract is signed (deposit amount)
- [feature] Per-job payment class breakdown on financial summary card
- [feature] Split payment groups linked visually in global payments ledger
- [feature] Class breakdown column on global payments ledger
- [feature] Split payment siblings shown inline in per-job payments tab
- [feature] Split-group expanded state persists across navigation
- [feature] **Drawn signature + signing certificate** embedded in signed proposal/contract PDFs
- [feature] Cash Margin to Date card added to Job Assessment scorecard

---

### 2026-05-27 — Marblism integration

- [feature] Marblism AI agent API — call forwarding + AI-assisted lead intake
- [schema] `CREATE TABLE agent_keys` (SHA-256 key/secret, callback_url, request_count)
- [schema] `CREATE TABLE agent_messages` (inbound/outbound chat thread per agent)

---

### 2026-06-08 — Invoice + proposal improvements

- [feature] Invoice generation includes permit fees and engineer fees as line items
- [feature] Invoice balance auto-populated from contract payment history
- [feature] System admin: import and regenerate proposals from raw JSON (admin-only tool)

---

### 2026-06-10 — SOW editing

- [feature] Project description (scope of work) editable when revising an estimate

---

### 2026-06-15 — Claude model update + lead editing

- [fix] Claude model updated to `claude-sonnet-4-5`
- [feature] Lead card inline editing — email + address editable directly on the pipeline card
- [fix] Dashboard edit button label clarified

---

### 2026-06-19 — Unified invoice & payment sync (major)

- [feature] **Unified invoice + payment sync** — full reconciliation system ensuring every contract payment maps to an invoice
- [feature] Invoice retry queue — `pending_send` invoices are auto-retried every 4 hours
- [schema] `ALTER TABLE payments_received ADD COLUMN invoice_id INTEGER`
- [feature] `invoice_id` written on all auto-created payment records (no more orphaned payments)
- [feature] Back-fill script ran to link `invoice_id` on all historical payment records
- [feature] Invoice status badges on Job Overview tab and Payments tab
- [feature] Invoice status summary badges on Dashboard job cards
- [feature] Reconciliation warnings on Analytics page (unlinked payments flagged)
- [feature] Edit button on master Invoices page with activity log
- [feature] InvoiceStatusPanel hidden on early-stage jobs (stage-rank gating — configurable)
- [fix] Invoice edit modal only opens the clicked invoice (not all)
- [feature] Admin-configurable stage that triggers the invoice panel (Settings)
- [feature] Invoice threshold stage context shown on job overview when panel is hidden
- [fix] Duplicate invoice links on same-amount same-job payments resolved
- [feature] Job dropdowns throughout app now show address + contract number for faster lookup

---

### 2026-06-22 — Payment schedule overrides + print-friendly proposals

- [feature] **Per-job customizable payment schedules** — override deposit %, milestone amounts, final amount
- [feature] Payment overrides carried through to contract PDF generation
- [feature] Milestone payment amounts manually adjustable (Admin only)
- [feature] Next-milestone invoice auto-generated when current milestone is collected
- [feature] Signed contract upload required before job can be marked contract_signed
- [feature] Print-friendly proposals — ink usage reduced (lighter backgrounds, no dark header fill)

---

### 2026-06-23 — Production probe + accounting hardening

- [feature] **Read-only API probe** (`/api/probe/*`) — query production DB from Replit dev environment
  - Endpoints: `health`, `stats`, `jobs`, `jobs/:id`, `jobs/:id/detail`, `payments`, `errors`
  - Auth: `PROBE_READ_TOKEN` bearer token set on production server
- [feature] Contract number displayed and searchable on job detail page
- [feature] Auto-link incoming payments to matching open invoices
- [feature] Payment processing + receipt email improvements
- [schema] `ALTER TABLE payments_received ADD COLUMN check_number TEXT`
- [schema] `ALTER TABLE payments_made ADD COLUMN check_number TEXT`
- [schema] `ALTER TABLE payments_made ADD COLUMN payee_name TEXT`
- [feature] 4 lower-priority accounting items: milestone tracking, detailed financial endpoint, accounting query date-column fixes, financial stats real-time refresh

---

### 2026-06-24 — Server hardening

- [fix] Global error handler catches malformed JSON (`entity.parse.failed`) — returns 400 instead of crash
- [fix] Multipart file upload Content-Type bug in JobDetail.jsx — FormData was being sent with `application/json` header causing body-parser crash

---

### 2026-06-26 — Leads pipeline + tasks improvements

- [fix] Lead appointment Google Calendar events now use UTC timezone (`ctz=UTC` added)
- [feature] "Appointment" renamed to "Site Visit" throughout leads pipeline and calendar events
- [feature] Auto-push Google Calendar event when lead advances to `appointment_booked` stage
- [schema] `ALTER TABLE leads ADD COLUMN stage_entered_at DATETIME`
- [feature] **Stage duration tracking** — `stage_entered_at` resets on every stage transition
- [feature] **Stale lead badges** — per-stage thresholds: incoming 1d, callback_done/site_visit_complete 2d, quote_draft 3d, quote_sent/follow_up_1/follow_up_2 7d; appointment_booked never flagged
- [feature] **Task person filter** — filter task list by assigned staff member (All / Jackson / Anthony)
- [schema] `ALTER TABLE tasks ADD COLUMN recurrence TEXT NOT NULL DEFAULT 'none'`
- [feature] **Recurring tasks** — daily/weekly/biweekly/monthly; next instance auto-created when task is marked done
- [feature] **Auto follow-up task on proposal send** — 3-day follow-up task auto-created when proposal is emailed for signing
- [feature] Probe API expanded: `/api/probe/leads` and `/api/probe/tasks` endpoints added

---

## Template for next entry

### YYYY-MM-DD
- [schema] `ALTER TABLE ...`
- [feature] ...
- [fix] ...
- [chore] ...
