---
name: Production access setup
description: How Replit dev connects to production server for read-only diagnostics and how deploys work
---

## Read-only probe access
- Production server: https://preferredbuilders.duckdns.org
- Query from Replit shell: `node scripts/prod_query.js <endpoint>`
- Endpoints: health, stats, jobs, jobs/:id, payments, errors
- Auth: PROBE_READ_TOKEN set in production .env via Settings → Secrets; PROD_READ_TOKEN + PROD_BASE_URL set as Replit secrets

**Why:** Allows querying live production data to diagnose bugs without SSH or needing the user at the office.

## Deploy workflow
1. Fix code in Replit (committed automatically)
2. User opens production browser → Settings → Remote Update → Deploy
3. Server runs: git pull → npm install --legacy-peer-deps → pm2 restart (~15s downtime)

**Why:** No SSH or Git Bash needed for routine deploys. The remoteUpdate route (system_admin only) handles the full sequence.

## Pending production tasks (when back at office)
- Grevais job (John Grevais, 437 Blossom St Fitchburg, contract_ready, $28,488): run `node scripts/fix_grevais_final.js` then `node scripts/regen_contract.js Grevais` to patch payment_overrides and regenerate PDF
