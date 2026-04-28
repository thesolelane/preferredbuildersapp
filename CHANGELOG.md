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

## Template for next entry

### YYYY-MM-DD
- [schema] `ALTER TABLE ...`
- [feature] ...
- [fix] ...
- [chore] ...
