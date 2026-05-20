# Preferred Builders AI — Suggested Tasks Backlog

_Last updated: May 20, 2026_

This document lists all open and proposed tasks for the Preferred Builders AI system, organized by area. Use the table of contents to jump to any section. Tasks marked **QUEUED** are approved and waiting to run; **PROPOSED** are ready to assign whenever you want them done.

---

## Table of Contents

1. [UI & Navigation](#1-ui--navigation)
   - [#48 — Group left sidebar navigation](#48--group-left-sidebar-navigation)
2. [Financial Accounting & Payments](#2-financial-accounting--payments)
   - [#73 — AR sub-labels on payment type badges](#73--ar-sub-labels-on-payment-type-badges)
   - [#74 — AR / AP totals on the Analytics pipeline summary](#74--ar--ap-totals-on-the-analytics-pipeline-summary)
   - [#77 — Class totals (Contract vs Pass-Through) on global ledger with filter](#77--class-totals-contract-vs-pass-through-on-global-ledger-with-filter)
   - [#80 — Remember which split check panels are open between page visits](#80--remember-which-split-check-panels-are-open-between-page-visits)
   - [#81 — Split check siblings inline on the global payments ledger](#81--split-check-siblings-inline-on-the-global-payments-ledger)
3. [Job Assessment & Scorecard](#3-job-assessment--scorecard)
   - [#72 — Net margin on the job Assessment scorecard](#72--net-margin-on-the-job-assessment-scorecard)
   - [#78 — Cash margin % on the Assessment scorecard](#78--cash-margin--on-the-assessment-scorecard)
4. [Field Measurements & Integrations](#4-field-measurements--integrations)
   - [#58 — Google Solar API for free roof area data](#58--google-solar-api-for-free-roof-area-data)
   - [#59 — Hover account connection for 3D measurement reports](#59--hover-account-connection-for-3d-measurement-reports)
   - [#60 — Track paid measurement orders (Hover / EagleView)](#60--track-paid-measurement-orders-hover--eagleview)
5. [Operations & Housekeeping](#5-operations--housekeeping)
   - [#2 — Daily changelog file](#2--daily-changelog-file)

---

## 1. UI & Navigation

### #48 — Group left sidebar navigation

**Status:** PROPOSED

**What & Why:**
The main nav has grown to 12+ items and is getting long to scan. Grouping items into labeled collapsible sections makes the sidebar cleaner while keeping the most-used items always visible.

**Done looks like:**
- Dashboard and Leads pinned at the top — never hidden or collapsed
- Remaining items organized into labeled collapsible groups:
  - **Jobs & Finance:** Tasks, Payments, Purchase Orders
  - **Field:** Field Camera, Material Take-Off
  - **People:** Contacts, Subs & Vendors
  - **Intelligence:** Ask the Bot, Analytics, Reports
- Each group expands/collapses independently; state remembered in localStorage
- Groups containing the active page auto-expand on load
- Collapsed (icon-only) sidebar still works — groups hidden, items show as icons with tooltips
- Existing Config & Tools section unchanged

**Out of scope:** Changing colors, icons, or labels; reordering items within groups; mobile bottom nav.

**Files:** `client/src/components/Layout.jsx`

---

## 2. Financial Accounting & Payments

### #73 — AR sub-labels on payment type badges

**Status:** PROPOSED

**What & Why:**
The AR section already shows Deposit / Progress / Final as sub-label chips under the section header, but individual payment rows don't carry the type badge. Adding a small colored label to each row (e.g. "Deposit", "Progress", "Final") makes it immediately clear what kind of payment each entry is without opening it.

**Done looks like:**
- Each AR row shows a colored badge next to the amount: `Deposit` (blue), `Progress` (orange), `Final` (green), `Other` (grey)
- Badge reads from the existing `payment_type` field already stored on each payment record
- Applies in both the per-job PaymentsTab and the global Payments ledger AR table

**Out of scope:** Adding new payment types; changing the AP side labels.

---

### #74 — AR / AP totals on the Analytics pipeline summary

**Status:** PROPOSED

**What & Why:**
The Analytics page shows pipeline value, won revenue, and win rate — but nothing about cash actually collected vs outstanding. Adding AR (total invoiced / collected) and AP (total paid to subs and vendors) to the summary cards gives a quick read on cash flow health without going to the Payments page.

**Done looks like:**
- Two new summary cards on the Analytics page alongside the existing ones:
  - **AR Collected** — total payments received across all active jobs
  - **AP Paid** — total payments made to subs/vendors across all active jobs
- Numbers pull from the existing `payments_received` and `payments_made` tables (same query the Payments summary already uses, just scoped to active jobs)
- No new API endpoints needed — can extend the existing `/api/analytics/pipeline` response

**Out of scope:** Time-range filtering (a separate task); per-trade AP breakdown.

---

### #77 — Class totals (Contract vs Pass-Through) on global ledger with filter

**Status:** PROPOSED

**What & Why:**
The per-job Payments tab already shows a breakdown of Contract vs Pass-Through amounts (received and paid). The global ledger shows the same totals but currently can't be filtered — if you want to see just contract payments for a specific month you have to mentally subtract. Adding date and job filters to the class breakdown panel gives a real cash-flow report.

**Done looks like:**
- The class breakdown panel at the top of the global Payments page respects the existing date-range and job filters already on the page
- When a filter is active, the breakdown numbers update to match the filtered subset
- No new UI chrome needed — just wire the existing filter state into the breakdown calculation

**Out of scope:** Exporting to CSV/Excel (a separate task); new filter types beyond date and job.

---

### #80 — Remember which split check panels are open between page visits

**Status:** PROPOSED

**What & Why:**
The per-job PaymentsTab now shows expandable split panels (showing sibling job allocations). If you navigate away and come back, all panels are collapsed again. sessionStorage persistence (same pattern used on the global ledger) would keep them open between page visits within the same session.

**Done looks like:**
- Expanded split panels in the per-job PaymentsTab survive navigation away and back (within the same browser session)
- Uses sessionStorage keyed by job ID so different jobs don't share state
- Mirrors the pattern already used in `Payments.jsx` for the global ledger (Task #76)

**Files:** `client/src/components/PaymentsTab.jsx`

---

### #81 — Split check siblings inline on the global payments ledger

**Status:** PROPOSED

**What & Why:**
The per-job PaymentsTab already has an inline expandable panel showing all jobs on a split check (Task #75). The global Payments ledger shows split groups as collapsible headers, but clicking into a group doesn't show sibling job names inline. Adding the same inline panel to the global ledger makes it consistent.

**Done looks like:**
- In the global AR ledger, each allocation row in an expanded split group has an expand toggle
- Expanding a row shows the same sibling panel already implemented in PaymentsTab (job names, addresses, amounts, "this job" badge)
- Siblings are fetched lazily on first expand and cached — same pattern as PaymentsTab
- Uses the existing `GET /api/payments/split-siblings/:splitGroupId` endpoint (no new backend needed)

**Files:** `client/src/pages/Payments.jsx`

---

## 3. Job Assessment & Scorecard

### #72 — Net margin on the job Assessment scorecard

**Status:** QUEUED (approved, waiting to run)

**What & Why:**
The Assessment tab already shows margin compliance (estimated vs actual) based on proposal data. But now that actual payments are tracked, the scorecard should show the real cash margin — contract payments received minus sub/material costs paid — alongside the estimated margin. This is the single most useful number for evaluating how a job is actually performing.

**Done looks like:**
- New "Net Cash Margin" row in the Assessment scorecard showing:
  - Contract AR received (from `payments_received` where `is_pass_through_reimbursement = 0`)
  - Sub/material AP paid (from `payments_made` where `payment_class = 'cost_of_revenue'`)
  - Net = AR − AP, with color coding (green ≥ target margin, yellow within 5%, red below)
- Pass-through items excluded from both sides (they net to zero and aren't margin)
- Labeled clearly: "Cash Margin (Actual)" vs "Estimated Margin (Proposal)"

**Files:** `client/src/pages/JobDetail.jsx` (Assessment tab), `server/routes/analytics.js`

---

### #78 — Cash margin % on the Assessment scorecard

**Status:** PROPOSED

**What & Why:**
Once #72 adds the net cash margin dollar amount, showing it as a percentage of contract revenue makes it easier to compare across jobs of different sizes. A $20k margin on a $40k job is very different from the same margin on a $200k job.

**Done looks like:**
- Cash Margin % displayed next to the dollar amount in the Assessment scorecard (e.g. "34.2%")
- Color-coded the same as the dollar amount (green/yellow/red vs the target margin %)
- The target margin % comes from the Settings markup configuration (same source the proposal Assessment tab already uses)

**Depends on:** #72 must be merged first.

**Files:** `client/src/pages/JobDetail.jsx` (Assessment tab)

---

## 4. Field Measurements & Integrations

### #58 — Google Solar API for free roof area data

**Status:** PROPOSED

**What & Why:**
Google's Solar API returns roof segment area, pitch, and orientation data from satellite imagery for any US address — completely free. When a new job is created for a roofing scope, the system could auto-fetch this data and pre-fill the MassGIS/property lookup panel with actual measured roof area, reducing the need for manual take-offs on straight replacements.

**Done looks like:**
- On job creation or when the job address is set, a background call to the Google Solar API fetches roof data for that address
- Results (total roof area in sqft, primary pitch, panel count estimate) are stored on the job record and shown in the property data panel
- The AI wizard can reference this data when building the roofing line item (e.g. "Roof area from satellite: 2,340 sqft — does this match what you measured on site?")
- Gracefully degrades when data isn't available (not all addresses have Solar API coverage)

**Out of scope:** Solar panel installation quoting; real-time re-fetch on address change (only fetches on first save).

**Files:** `server/routes/jobs.js`, `server/services/massgisService.js` (extend), `client/src/pages/JobDetail.jsx`

---

### #59 — Connect Hover account for 3D measurement reports

**Status:** PROPOSED

**What & Why:**
Hover is a mobile app that generates professional 3D measurement reports (roof, walls, windows) from photos taken on-site. Jackson already uses it. Connecting the Hover account to the system lets the AI bot order a measurement report directly from chat ("Order a Hover report for this job") and attach the results to the job record when they come back.

**Done looks like:**
- Hover API credentials stored in Settings → Secrets
- Bot tool `order_hover_report(job_id)` — places a measurement order via Hover API, stores the order ID on the job, and replies with a confirmation
- Webhook or polling check for report completion — when Hover delivers the PDF, it's automatically attached to the job's Photos/Documents tab
- Measurement data from the report (roof sqft, wall sqft, window count) parsed and stored as structured fields on the job for the AI to reference in estimates

**Out of scope:** EagleView integration (separate task #60 covers tracking, not ordering).

**Files:** `server/services/hoverService.js` (new), `server/routes/jobs.js`, `server/services/claudeService.js`

---

### #60 — Track paid measurement orders (Hover / EagleView)

**Status:** PROPOSED

**What & Why:**
When PB orders a Hover or EagleView report for a job, it's a real cost — typically $10–$40 — that should be logged against that job. Right now these costs aren't tracked anywhere, so job margin calculations are slightly off on any job that had a paid measurement.

**Done looks like:**
- New "Measurement Orders" section in the job's Payments tab (AP side) for logging measurement report costs
- Fields: provider (Hover / EagleView / Other), order date, amount, order reference number, notes
- Amount flows into the job's AP total and is classified as `cost_of_revenue` for margin calculations
- Can be added manually (no API required — this is just a tracking task)

**Depends on:** Can be done independently of #59 — just tracking, not ordering.

**Files:** `server/routes/payments.js`, `client/src/components/PaymentsTab.jsx`, `server/db/database.js`

---

## 5. Operations & Housekeeping

### #2 — Daily changelog file

**Status:** PROPOSED

**What & Why:**
A simple `CHANGELOG.md` at the project root to track schema and code changes made each day. Gives a running record of what changed and why, making end-of-day migration review easy. No automation, no new dependencies.

**Done looks like:**
- `CHANGELOG.md` exists at project root
- Documents all existing migrations already present in `server/db/database.js` under a "Prior Migrations" section
- Has a clearly formatted section for the current date ready to log new entries
- Instructions at the top explain how to add entries during the day

**Out of scope:** Automated changelog generation; cron jobs; new packages.

**Files:** `server/db/database.js` (reference for existing migrations), `CHANGELOG.md` (new)

---

_End of backlog. To assign any of these tasks, just say the task number or title._
