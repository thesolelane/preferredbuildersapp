# Preferred Builders AI — Multi-Tenant Sync Tracker

> **Purpose:** The multi-tenant (MT) version of this app already exists and is based on
> this single-tenant codebase. Many features and fixes built here can be ported directly
> to the MT version with minimal changes (mainly adding `tenant_id` scoping where needed).
>
> This document serves two purposes:
> 1. **Port tracker** — every feature/fix added here is logged so nothing gets missed when syncing to MT
> 2. **Architecture reference** — notes on what each part of the system needs for full MT support
>
> **Rule:** Every time a feature is merged here, add a row to the Feature Changelog at the bottom.
>
> *Last updated: 2026-05-20*

---

## How to Read This File

Each section has a **Status** tag:

| Tag | Meaning |
|-----|---------|
| `[current]` | How it works today (single-tenant) |
| `[mt-change]` | What must change for multi-tenant |
| `[files]` | Files that contain the relevant code |

---

## 1. Database Architecture

**[current]** Single SQLite file at `data/pb_system.db`. All tables are global — no concept of which company a record belongs to.

**[mt-change]**
- Migrate from SQLite to PostgreSQL (SQLite doesn't support concurrent multi-tenant write loads)
- Add a `tenants` table: `id, company_name, subdomain, license_number, plan, created_at, active`
- Add `tenant_id INTEGER NOT NULL` column to every data table (see full list below)
- All queries must include `WHERE tenant_id = ?` — no query should be able to cross tenant boundaries
- Row-level security (RLS) in Postgres is the safest enforcement layer

**Tables that need `tenant_id`:**
- `jobs`
- `contacts`
- `users`
- `whitelist`
- `settings`
- `knowledge_docs`
- `tasks`
- `signing_sessions`
- `job_photos`
- `payments_received`
- `payments_made`
- `agent_keys`
- `agent_messages`
- `vendors`
- `pb_quote_counter`
- `quote_auto_counter`
- `pb_customer_counter`
- `customer_serial_counter`

**[files]** `server/db/database.js`

---

## 2. Authentication & Sessions

**[current]** Two hardcoded users seeded in `database.js`. Sessions stored in an in-memory `Map` — lost on restart. Auth token passed as `x-auth-token` header.

**[mt-change]**
- Users must belong to a tenant: add `tenant_id` to `users` table
- Login must resolve tenant first (by subdomain, custom domain, or email domain)
- Session store must move from in-memory Map to database (PostgreSQL `sessions` table or Redis)
- Session record must carry `{ userId, tenantId, role }` — every authenticated request resolves tenant from session
- Add tenant-aware middleware: `req.tenantId` set from session, injected into all DB queries
- Superadmin role needed to manage tenants without being tied to one

**[files]**
- `server/middleware/auth.js` — session Map + `createSession()`, `destroySession()`
- `server/routes/auth.js` — login route
- `server/db/database.js` — user seed

---

## 3. Company Identity & Branding (Hardcoded Today)

**[current]** Company name, license number, supervisor name, CSL number, and contact info are hardcoded in `config/parameters.js` and embedded in the PDF/contract templates.

**[mt-change]**
- Move all company identity fields to the `tenants` table:
  - `company_name`, `license_number` (HIC), `csl_number`, `supervisor_name`, `phone`, `email`, `address`
- PDF proposal and contract templates must read company info dynamically from the tenant record
- Logo/branding assets must be per-tenant (stored in `uploads/tenants/:tenantId/`)
- The "Preferred Builders" name throughout the UI must be replaced with the tenant's company name

**[files]**
- `config/parameters.js` — all hardcoded company info
- `server/services/pdfService.js` — renders company name/license in PDFs
- `server/services/contractTemplate.js` — MA-compliant contract with hardcoded HIC/CSL
- `client/src/components/Layout.jsx` — sidebar shows company name

---

## 4. Settings

**[current]** `settings` table is a global key/value store. All markup percentages, labor rates, allowances, and integration configs are shared across all users.

**[mt-change]**
- Add `tenant_id` to every row in `settings`
- Settings API routes (`GET/PUT /api/settings`) must scope to `req.tenantId`
- Default settings seeded per tenant at signup time

**[files]**
- `server/routes/settings.js`
- `server/db/database.js` — settings seed

---

## 5. File Storage (Uploads, PDFs, Knowledge Base)

**[current]** All files stored on local disk:
- `uploads/jobs/{jobId}/` — job photos
- `uploads/scan_temp/` — scanner temp files
- `outputs/` — generated PDFs
- `knowledge-base/` — bot knowledge documents

**[mt-change]**
- Move to cloud object storage (S3, Cloudflare R2, or similar)
- All paths must be namespaced: `tenants/{tenantId}/jobs/{jobId}/`, `tenants/{tenantId}/outputs/`, etc.
- PDFs served via signed URLs (not local `/outputs/` route)
- Knowledge base documents partitioned per tenant

**[files]**
- `server/routes/jobPhotos.js`
- `server/routes/scan.js`
- `server/services/pdfService.js`
- `server/routes/jobs.js` — PDF generation + file output
- `server/routes/settings.js` — knowledge doc upload

---

## 6. Quote & Customer Numbering

**[current]** Sequential counters are global:
- `pb_quote_counter` — `PB-YYYY-NNNN` internal quote numbers
- `quote_auto_counter` — sequential customer-facing quote numbers (1001, 1002…)
- `pb_customer_counter` — `PB-C-XXXX` customer serial numbers

**[mt-change]**
- All counters must be per-tenant (add `tenant_id` to each counter table)
- Each tenant gets their own numbering sequences starting from 1
- Tenant may configure their own prefix (e.g., "ABC-2026-0001" instead of "PB-2026-0001")

**[files]** `server/db/database.js`, `server/routes/jobs.js`

---

## 7. AI / Claude Integration

**[current]** Single Anthropic API key from environment variables, shared across all usage.

**[mt-change]**
- Options: (a) platform pays for API usage and bills tenants via subscription, OR (b) each tenant provides their own API key stored in tenant settings
- If platform-managed: add per-tenant token usage tracking for billing
- Claude system prompts include company-specific context (license #, supervisor, etc.) — must be dynamically built per tenant
- `adminChat()` knowledge base lookups must be scoped to the tenant's knowledge docs

**[files]**
- `server/services/claudeService.js` (barrel)
- `server/services/claudeEstimate.js`
- `server/services/claudeChat.js`
- `server/services/claudeContract.js`

---

## 8. Email (Mailgun)

**[current]** Single Mailgun domain and API key. All emails sent from `noreply@preferredbuildersusa.com`.

**[mt-change]**
- Options: (a) platform-managed sending domain with `From: TenantName <noreply@pb-platform.com>`, OR (b) each tenant verifies their own Mailgun domain
- Proposal/contract emails use tenant company name and logo in the HTML template
- "Reply-to" address must route to the tenant's email, not the platform

**[files]** `server/services/emailService.js`

---

## 9. WhatsApp / Twilio

**[current]** Single Twilio sandbox account. WhatsApp inbound messages polled every 5 seconds. Single global whitelist table.

**[mt-change]**
- WhatsApp is the hardest integration to multi-tenant — each tenant needs their own Twilio number and WhatsApp Business account approval
- The poller must run per-tenant or use Twilio webhooks with a tenant-routing middleware (`/webhook/whatsapp/:tenantId`)
- Whitelist must be per-tenant
- Inbound message routing must identify the tenant from the destination Twilio number

**[files]**
- `server/services/whatsappService.js`
- `server/whatsappPoller.js`
- `server/routes/settings.js` — whitelist management

---

## 10. Google Calendar

**[current]** Uses Replit connector (`REPLIT_CONNECTORS_HOSTNAME` + `REPL_IDENTITY`) — this only works inside Replit.

**[mt-change]**
- Must be rebuilt with standard Google OAuth 2.0
- Each tenant connects their own Google account (Client ID + Secret from Google Cloud Console)
- Store per-tenant refresh tokens in the `tenants` or `settings` table
- Calendar picker and task auto-push logic stays the same — only token retrieval changes
- Already documented in `replit.md` under "Google Calendar (Replit-specific)"

**[files]** `server/services/googleCalendar.js`, `server/routes/tasks.js`

---

## 11. PDF E-Signing

**[current]** Signing pages at `/sign/p/:token` and `/sign/c/:token` are public (no auth). Tokens stored in `signing_sessions`.

**[mt-change]**
- Signing session tokens already opaque and per-job — low risk, minimal change needed
- Signing page HTML (`server/routes/signing.js`) renders hardcoded "Preferred Builders" branding — must be per-tenant
- Signed PDF stored in local `outputs/` — must move to cloud storage (see §5)

**[files]** `server/routes/signing.js`, `server/services/contractTemplate.js`

---

## 12. Payment Ledger

**[current]** `payments_received` and `payments_made` tables are global. All payment routes filter only by `job_id` or `contact_id` — no tenant scope.

**[mt-change]**
- Add `tenant_id` to both payment tables
- All payment routes must enforce `tenant_id` from session
- Global payments ledger page (`/payments`) must only show the current tenant's records
- The Assessment tab "Cash Margin to Date" card (`JobAssessmentTab.jsx`) reads from `GET /api/payments/summary/:id` — this route is already scoped by `job_id` but the job itself must be tenant-scoped

**[files]**
- `server/routes/payments.js`
- `client/src/pages/Payments.jsx`
- `client/src/components/PaymentsTab.jsx`
- `client/src/components/job/JobAssessmentTab.jsx`

---

## 13. Analytics

**[current]** Analytics API aggregates all jobs in the database regardless of which user is viewing.

**[mt-change]**
- `GET /api/analytics/pipeline` and `GET /api/analytics/job/:id/context` must filter by `tenant_id`
- Win/loss, revenue, and pipeline metrics must be per-tenant

**[files]** `server/routes/analytics.js`, `client/src/pages/Analytics.jsx`

---

## 14. Secrets Management

**[current]** All secrets in a single `.env` file. The Secrets tab in Settings (`server/routes/secrets.js`) reads and writes this file directly. `MANAGED_KEYS` allowlist is hardcoded.

**[mt-change]**
- Tenant-specific secrets (Twilio SID, Mailgun key, etc.) must be stored in an encrypted column on the `tenants` table — not in `.env`
- Platform-level secrets (database URL, master Anthropic key) stay in environment variables
- The Secrets tab must write to the tenant record, not to `.env`

**[files]** `server/routes/secrets.js`

---

## 15. Agent Keys (Marbilism Integration)

**[current]** `agent_keys` and `agent_messages` tables are global.

**[mt-change]**
- Add `tenant_id` to both tables
- Each tenant can have their own agent integrations

**[files]** Relevant routes in `server/routes/`

---

## 16. Knowledge Base

**[current]** Single `knowledge-base/` directory on disk. `knowledge_docs` table is global. Bot uses all documents as context.

**[mt-change]**
- `knowledge_docs` table needs `tenant_id`
- Files must be namespaced in cloud storage (see §5)
- Bot RAG lookups must filter to the current tenant's documents only

**[files]**
- `server/routes/settings.js` — knowledge doc upload/delete
- `client/src/pages/KnowledgeBase.jsx`
- `server/services/claudeChat.js` — RAG lookup

---

## 17. Field Guide (Public Page)

**[current]** `/guide` is a public bilingual on-site checklist with no auth and hardcoded branding.

**[mt-change]**
- Route will need to resolve tenant by subdomain or token if it's to be tenant-branded
- Or keep it as a shared/generic platform page with no tenant branding

**[files]** `client/src/pages/FieldGuide.jsx`

---

## 18. Pricing Model & Markup Config

**[current]** Default markup multipliers hardcoded in `config/parameters.js`. Overridden by `settings` table at runtime.

**[mt-change]**
- `config/parameters.js` defaults stay as platform defaults
- Each tenant's live settings (already in `settings` table) must be scoped by `tenant_id`
- No cross-tenant bleed on markup rates

**[files]** `config/parameters.js`, `server/routes/settings.js`

---

## 19. Routing & Subdomain Resolution

**[current]** Single domain. No concept of tenant-specific URLs.

**[mt-change]**
- Each tenant gets a subdomain: `acme.pb-platform.com` or custom domain: `estimates.acmeconstruction.com`
- Add tenant-resolution middleware at the top of `server/index.js`:
  - Extract subdomain from `Host` header
  - Look up `tenant_id` in `tenants` table
  - Attach to `req.tenant` for all downstream middleware
- DNS wildcard + reverse proxy (Caddy or nginx) must route all subdomains to the same Node process

**[files]** `server/index.js`, `Caddyfile`

---

## 20. Deployment & Infrastructure

**[current]** Single Node.js process on one Windows machine or Replit. SQLite on local disk. PM2 for process management.

**[mt-change]**
- Move to cloud hosting (Railway, Render, Fly.io, or VPS)
- PostgreSQL managed database (Supabase, Neon, or RDS)
- Object storage for files (S3 or Cloudflare R2)
- Redis for session store and job queue
- Docker image already exists (`Dockerfile`, `docker-compose.yml`) — good starting point
- PM2 → process manager or container orchestration
- CI/CD pipeline (GitHub Actions) for deployments

**[files]** `Dockerfile`, `docker-compose.yml`, `docker/nginx.conf`, `Caddyfile`

---

## 21. Signup & Onboarding Flow (New — Does Not Exist Yet)

**[current]** No signup — accounts seeded manually in `database.js`.

**[mt-change]**
- Build a public signup page: company name, email, password, license number
- Creates a `tenants` record + first `users` record for that tenant
- Seeds default `settings` rows for that tenant
- Sends welcome email with login link
- Optional: Stripe subscription for billing before granting access

---

## 22. Billing

**[current]** No billing — single customer, single install.

**[mt-change]**
- Stripe subscription integration (see `stripe` skill)
- Plans: e.g., Starter (1 user), Pro (5 users), Enterprise (unlimited)
- Usage-based add-ons: Claude token overages, extra storage, WhatsApp messaging
- Tenant access gated on active subscription status
- Billing portal for tenant to manage their plan

---

## Feature Changelog — Port Tracker

Every feature/fix added to the single-tenant app is logged here.
Add a row every time a task is completed. Check the **Port to MT** column before closing any task.

Legend: ✅ Port directly (minimal changes) | ⚠️ Port with care (needs `tenant_id` or config change) | 🔴 Major rework needed | ➖ Not applicable to MT

---

### Invoices & Payments

| Feature | Port to MT | Notes |
|---------|-----------|-------|
| Automatically record payments when invoices are paid | ⚠️ | `payments_received` + `invoices` tables need `tenant_id` filter on all queries |
| Add Credit/Discount line item type to Direct Invoice modal | ⚠️ | UI ports directly; verify `invoices` table schema has `tenant_id` in MT |
| Add ability to link invoices to specific jobs | ⚠️ | `invoices.job_id` — job lookup must be tenant-scoped |
| Add quantity and unit price fields to material line items | ⚠️ | Schema addition on `invoices`; add same columns in MT with `tenant_id` guard |
| Consolidate invoice management into a single page | ✅ | UI refactor only — port directly |
| Add dedicated page for managing all customer invoices | ✅ | UI only — port directly |
| Add ability to send and manage direct invoices | ⚠️ | `invoices` table + email send; email sender config must use per-tenant credentials in MT |
| Cash Margin to Date card on Assessment tab (task #72) | ⚠️ | Reads `GET /api/payments/summary/:id`; route already scoped by `job_id`; job must be tenant-scoped |
| Split payment groups on ledger | ⚠️ | `split_group` queries on `payments_received` need `tenant_id` |
| AR/AP labels on payment type badges | ✅ | UI only — port directly |
| AR/AP totals on Analytics page | ⚠️ | Analytics queries need `tenant_id` |
| Global payments ledger class breakdown | ⚠️ | Ledger queries need `tenant_id` |

---

### Jobs & Contracts

| Feature | Port to MT | Notes |
|---------|-----------|-------|
| Fix white screen error when viewing RFQ details | ✅ | Bug fix — port directly |
| Invalidate old contract/proposal links when new ones are sent | ⚠️ | `signing_sessions` needs `tenant_id`; port logic directly |
| Update contract template with legal corrections (TOLF) | ⚠️ | `contractTemplate.js` has hardcoded PB company identity; MT version must pull company info dynamically from tenant record |
| Add downloadable blank contract (PDF + Word) | ⚠️ | Static file today; MT needs per-tenant branding injected into the template |
| Add ability to attach files when creating/revising estimates | ⚠️ | Files saved to local `uploads/`; MT needs cloud storage path (`tenants/{id}/jobs/{id}/`) |
| Add AI chat doc injection — import lead/contact files into bot | ⚠️ | Claude context must be scoped to tenant's documents only |
| Duplicate estimate detection | ⚠️ | Job queries need `tenant_id` so detection doesn't cross tenant boundaries |
| Proportionality sanity check on line items >40% of total | ✅ | Computed from `lineItems` in proposal JSON — no DB query, port directly |
| Two-slot assessment versioning (ACTIVE + PREVIOUS) | ⚠️ | Stored in `jobs` table; needs `tenant_id` on job lookup |
| Fix blank screen after login (destructuring bug) | ✅ | Bug fix — port directly |
| Various bug fixes and silent catch blocks | ✅ | Port directly |

---

### Dashboard & Analytics

| Feature | Port to MT | Notes |
|---------|-----------|-------|
| Update won revenue and pipeline value calculations | ⚠️ | Analytics queries must filter by `tenant_id` |
| Wire statusUtils across Dashboard, Leads, StaffView | ✅ | Shared utility — port directly |
| Live real-time updates via Socket.io | 🔴 | **Major:** Socket.io rooms must be tenant-namespaced (e.g., `room: tenantId`) to prevent data leaking across tenants; do not share a global broadcast |

---

### Leads & CRM

| Feature | Port to MT | Notes |
|---------|-----------|-------|
| Leads dashboard layout improvements | ✅ | UI only — port directly |
| Lead card 2-column layout + timestamped notes ledger | ✅ | UI only — port directly |
| RFQ generator — AI scope, vendor picker, email send | ⚠️ | `rfq` table (if added) needs `tenant_id`; vendor list must be per-tenant; email uses per-tenant sender |
| Prevent duplicate tasks when lead stages advance | ⚠️ | Task queries need `tenant_id` |
| Fix taskReminder Reach Out query — correct column names | ✅ | Bug fix — port directly |

---

### Customer & Staff Portals

| Feature | Port to MT | Notes |
|---------|-----------|-------|
| Customer Portal — token-gated, signing, photo upload, change orders | 🔴 | **Major:** Public-facing portal tokens must embed `tenant_id` so the portal resolves the right tenant's data and branding; portal pages must show tenant company name/logo, not "Preferred Builders" |
| Staff Portal — route, nav, real address search + photo upload | ⚠️ | Needs tenant auth middleware; address search likely uses shared API — OK; photos need tenant-scoped storage |
| Change order estimatedCost field | ⚠️ | Schema addition; `change_orders` table needs `tenant_id` in MT |

---

### Messaging & Notifications

| Feature | Port to MT | Notes |
|---------|-----------|-------|
| SMS opt-out + proposal/contract 3hr follow-up text | ⚠️ | Twilio credentials are per-tenant in MT; opt-out list must be per-tenant |
| Reach Out WhatsApp/SMS outreach in task reminder scheduler | ⚠️ | Scheduler must pass `tenant_id` when querying tasks and sending messages; Twilio number is per-tenant |

---

### Property & Measurements

| Feature | Port to MT | Notes |
|---------|-----------|-------|
| 4-tier building measurement system (Footprints, Solar, Hover, EagleView) | ⚠️ | Hover/EagleView accounts may be per-tenant (contractors have their own accounts); platform may need to store per-tenant API credentials for these services |
| AI sketch extractor — read dimensions from assessor drawings | ⚠️ | Claude usage; counts against per-tenant token budget |
| MRPC parcel service — assessor field card, last sale, zoning | ⚠️ | MA-specific data source; flag for MT that this only applies to MA-based tenants — non-MA tenants will get no data |
| Property exterior dimensions from MassGIS | ⚠️ | MA-specific; same note — non-MA tenants won't benefit; consider making property data providers pluggable per state/region |

---

### Printing & Scanning

| Feature | Port to MT | Notes |
|---------|-----------|-------|
| WIA scanner — signed contracts, receipts, checks | ➖ | Windows WIA scanner — not applicable in cloud/MT environment; this is a local Windows-only feature |
| Print proposals/contracts directly | ⚠️ | Printing reads from `outputs/`; cloud MT needs signed URLs from object storage |
| Network folder scanning support | ➖ | Windows-only — not applicable in cloud MT |
| Printer detection and selection in settings | ➖ | Windows-only — not applicable in cloud MT |

---

### Google Calendar & Tasks

| Feature | Port to MT | Notes |
|---------|-----------|-------|
| Configurable reminders, location field, event ID stored to jobs | ⚠️ | `tasks` and `jobs` columns need `tenant_id`; each tenant must connect their own Google account via OAuth — see §10 |

---

### Security & Infrastructure

| Feature | Port to MT | Notes |
|---------|-----------|-------|
| Restrict app access to authorized networks (IP allowlist) | ⚠️ | Single global IP list today; MT may need per-tenant IP allowlists or platform-level allow only |
| IP access control + restrict settings to system admins | ⚠️ | Role checks must be tenant-scoped (`system_admin` of tenant X cannot access tenant Y) |
| Trust proxy headers from Caddy | ✅ | Infrastructure config — already likely in MT; verify it's set |
| System health + drive space check script | ⚠️ | Single-server script today; cloud MT needs health checks per service (app, DB, storage) — rework for cloud infra |
| Cache headers fix — prevent stale content on mobile | ✅ | Port directly; no MT impact |
| Socket.io realtime foundation | 🔴 | See Dashboard section — rooms must be tenant-namespaced |

---

### UI & Branding

| Feature | Port to MT | Notes |
|---------|-----------|-------|
| Wire company logo into Login, sidebar, and all PDFs/docs | 🔴 | Currently hardcoded to PB logo; MT must load logo dynamically from tenant record for every surface (login page, sidebar, proposal PDFs, contract PDFs, email templates) |
| Cache-bust favicon | ⚠️ | MT needs per-tenant favicon; serve dynamically or per-subdomain |
| Integrations page (Hover, EagleView, Google Solar, Footprints) | ⚠️ | API credentials entered here must be stored in tenant settings, not global `.env` |
| Hide team chat button on bot chat page | ✅ | UI only — port directly |

---

### Code Quality & Refactors

| Feature | Port to MT | Notes |
|---------|-----------|-------|
| Refactor JobDetail.jsx: 5,421 → 1,037 lines (tab components) | ✅ | Port the refactored structure directly — smaller files are easier to maintain in MT too |

---

## Summary — Things That Need MT-Specific Work Before Porting

These items can't be dropped in without changes. Prioritize these when syncing to MT:

1. **Socket.io** — namespace rooms by `tenantId` before enabling real-time anywhere in MT
2. **Customer Portal** — embed `tenantId` in tokens and load tenant branding on all portal pages
3. **Company logo / branding** — MT must load logo, name, and colors from tenant record dynamically (affects login, sidebar, PDFs, emails, portal)
4. **Contract template** — company identity (name, license #, supervisor) must be read from tenant record, not hardcoded
5. **Windows-only features** (WIA scanner, network folder, printer detection) — skip entirely for cloud MT; flag these features as desktop-only in docs
6. **MassGIS / MRPC** — MA-specific data sources; make property enrichment provider pluggable so non-MA tenants aren't broken
7. **Measurement service credentials** (Hover, EagleView) — store per-tenant API keys in MT settings

---

*Preferred Builders General Services Inc. — HIC-197400 — single-tenant reference build*
