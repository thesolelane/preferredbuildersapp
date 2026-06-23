#!/usr/bin/env node
// scripts/prod_patch.js
// Send a PATCH/POST request to a production probe write endpoint.
// Usage:
//   node scripts/prod_patch.js <endpoint> <json-body>
// Example:
//   node scripts/prod_patch.js jobs/JOBID/payment-overrides '{"middleAmounts":[9000],"finalAmount":10087}'

require('dotenv').config();

const https = require('https');
const http = require('http');

const BASE_URL = process.env.PROD_BASE_URL;
const TOKEN = process.env.PROD_READ_TOKEN;

if (!BASE_URL || !TOKEN) {
  console.error('Missing PROD_BASE_URL or PROD_READ_TOKEN secrets');
  process.exit(1);
}

const endpoint = process.argv[2];
const body = process.argv[3] || '{}';

if (!endpoint) {
  console.error('Usage: node scripts/prod_patch.js <endpoint> <json-body>');
  process.exit(1);
}

const url = `${BASE_URL.replace(/\/$/, '')}/api/probe/${endpoint}`;
console.log(`\n→ PATCH ${url}`);
console.log(`  Body: ${body}\n`);

function request(urlStr, bodyStr) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlStr);
    const lib = parsed.protocol === 'https:' ? https : http;
    const opts = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    };
    const req = lib.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

request(url, body)
  .then(({ status, body: respBody }) => {
    if (status !== 200) {
      console.error(`HTTP ${status}:`, respBody);
      process.exit(1);
    }
    try {
      console.log(JSON.stringify(JSON.parse(respBody), null, 2));
    } catch {
      console.log(respBody);
    }
  })
  .catch((err) => {
    console.error('Request failed:', err.message);
    process.exit(1);
  });
