#!/usr/bin/env node
// scripts/gen_probe_token.js
// Run ONCE on the production server to generate a secure read-only probe token.
// The token is printed to the console — copy it to both:
//   1. Production: set PROBE_READ_TOKEN in .env, then pm2 restart all
//   2. Replit dev:  add PROD_READ_TOKEN secret via Settings → Secrets

const crypto = require('crypto');
const token = crypto.randomBytes(32).toString('hex');

console.log('\n=== Preferred Builders — Probe Token Setup ===\n');
console.log('Generated token:', token);
console.log('\nStep 1 — On the production server, add to .env:');
console.log(`  PROBE_READ_TOKEN=${token}`);
console.log('\nStep 2 — Then restart:');
console.log('  pm2 restart all');
console.log('\nStep 3 — In Replit, add two secrets (Settings → Secrets):');
console.log('  PROD_BASE_URL  =  https://preferredbuilders.duckdns.org');
console.log('  PROD_READ_TOKEN = ' + token);
console.log('\nStep 4 — Test from Replit shell:');
console.log('  node scripts/prod_query.js health');
console.log('  node scripts/prod_query.js stats');
console.log('  node scripts/prod_query.js jobs');
console.log('\nToken is read-only (GET only). Safe to keep in Replit secrets.\n');
