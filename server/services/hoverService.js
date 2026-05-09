// server/services/hoverService.js
// Hover (hover.to) API — 3D property measurement reports.
// PAID per job — charge to customer on a per-job basis.
//
// Required env vars:
//   HOVER_CLIENT_ID      — from Hover developer portal
//   HOVER_CLIENT_SECRET  — from Hover developer portal
//   HOVER_ACCESS_TOKEN   — OAuth2 access token (or set up full OAuth flow)
//
// Hover API docs: https://developers.hover.to/reference/welcome
// Authentication: OAuth 2.0 Authorization Code Grant

const https = require('https');

const HOVER_API = 'https://api.hover.to/v3';

function isConfigured() {
  return !!(process.env.HOVER_CLIENT_ID && process.env.HOVER_CLIENT_SECRET);
}

function hasToken() {
  return !!process.env.HOVER_ACCESS_TOKEN;
}

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${HOVER_API}${path}`);
    const opts = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      timeout: 15000,
    };
    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          const text = Buffer.concat(chunks).toString();
          resolve({ status: res.statusCode, body: JSON.parse(text) });
        } catch (e) {
          reject(e);
        }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/**
 * Create a Hover job (measurement order) for a property address.
 *
 * @param {object} params
 * @param {string} params.address     Full property address
 * @param {string} params.name        Customer/job name
 * @param {string} [params.email]     Contact email for capture request
 * @param {string} [params.phone]     Contact phone for capture SMS
 * @param {string} [params.jobId]     Internal job ID for reference
 * @returns {Promise<{hoverId, status, captureUrl}|null>}
 */
async function createHoverJob({ address, name, email, phone, jobId }) {
  if (!isConfigured())
    throw new Error('Hover API credentials not configured (HOVER_CLIENT_ID / HOVER_CLIENT_SECRET)');
  if (!hasToken()) throw new Error('HOVER_ACCESS_TOKEN not set — complete OAuth flow first');

  const token = process.env.HOVER_ACCESS_TOKEN;
  const payload = {
    job: {
      name: name || address,
      location: {
        delivery_line_1: address,
      },
      attachments: [],
    },
  };

  if (email || phone) {
    payload.job.users = [
      {
        email: email || undefined,
        mobile_number: phone || undefined,
        first_name: (name || '').split(' ')[0] || 'Owner',
        last_name: (name || '').split(' ').slice(1).join(' ') || '',
        company: 'Preferred Builders General Services Inc.',
        role: 'contact',
      },
    ];
  }

  const res = await request('POST', '/jobs', payload, token);
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`Hover API error ${res.status}: ${JSON.stringify(res.body)}`);
  }

  const job = res.body.job || res.body;
  return {
    hoverId: job.id,
    status: job.state || 'created',
    captureUrl: job.links?.capture_request_url || null,
    internalJobId: jobId,
  };
}

/**
 * Get the status and measurement data for a Hover job.
 * States: created → started → processing → needs_review → complete | failed
 */
async function getHoverJob(hoverId) {
  if (!hasToken()) throw new Error('HOVER_ACCESS_TOKEN not set');
  const token = process.env.HOVER_ACCESS_TOKEN;
  const res = await request('GET', `/jobs/${hoverId}`, null, token);
  if (res.status !== 200) throw new Error(`Hover API error ${res.status}`);
  return res.body.job || res.body;
}

/**
 * Get measurement data (JSON) from a completed Hover job.
 * Returns structured measurements including wall areas, roof areas, etc.
 */
async function getHoverMeasurements(hoverId) {
  if (!hasToken()) throw new Error('HOVER_ACCESS_TOKEN not set');
  const token = process.env.HOVER_ACCESS_TOKEN;

  // Get list of available attachments for this job
  const res = await request('GET', `/jobs/${hoverId}/attachments`, null, token);
  if (res.status !== 200) throw new Error(`Hover attachments error ${res.status}`);

  const attachments = res.body.attachments || [];

  // Find the JSON measurement report
  const jsonReport = attachments.find(
    (a) => a.file_type === 'application/json' || a.label?.toLowerCase().includes('measure'),
  );

  if (!jsonReport) return { available: attachments.map((a) => a.label), raw: null };

  // Fetch the JSON report
  const reportRes = await request(
    'GET',
    `/jobs/${hoverId}/attachments/${jsonReport.id}`,
    null,
    token,
  );
  return reportRes.body;
}

/**
 * Summary of status for display to staff.
 */
function hoverStatusLabel(state) {
  const labels = {
    created: 'Order placed — waiting for property photos',
    started: 'Capturing property photos',
    processing: 'Building 3D model — usually 24-48 hrs',
    needs_review: 'Under review by Hover team',
    complete: 'Measurements ready',
    failed: 'Order failed — contact Hover support',
  };
  return labels[state] || state;
}

module.exports = {
  createHoverJob,
  getHoverJob,
  getHoverMeasurements,
  hoverStatusLabel,
  isConfigured,
};
