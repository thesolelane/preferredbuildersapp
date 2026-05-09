// server/services/eagleViewService.js
// EagleView API — aerial roof measurement reports (paid per order).
// Charge to customer on a per-job basis.
//
// Required env vars:
//   EAGLEVIEW_CLIENT_ID      — from developer.eagleview.com
//   EAGLEVIEW_CLIENT_SECRET  — from developer.eagleview.com
//
// EagleView API docs: https://developer.eagleview.com/documentation/measurement-orders/v1/overview
// Auth: OAuth 2.0 client credentials → Bearer token

const https = require('https');

const AUTH_URL = 'https://api.eagleview.com/v1/oauth/token';
const BASE = 'https://webservices.eagleview.com/v1';

// In-memory token cache
let _tokenCache = null;
let _tokenExpiresAt = 0;

function isConfigured() {
  return !!(process.env.EAGLEVIEW_CLIENT_ID && process.env.EAGLEVIEW_CLIENT_SECRET);
}

async function getAccessToken() {
  if (_tokenCache && Date.now() < _tokenExpiresAt - 60000) return _tokenCache;

  const credentials = Buffer.from(
    `${process.env.EAGLEVIEW_CLIENT_ID}:${process.env.EAGLEVIEW_CLIENT_SECRET}`,
  ).toString('base64');

  const body = 'grant_type=client_credentials';
  const token = await new Promise((resolve, reject) => {
    const url = new URL(AUTH_URL);
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname,
        method: 'POST',
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 10000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString()));
          } catch (e) {
            reject(e);
          }
        });
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });

  if (!token.access_token) throw new Error(`EagleView auth failed: ${JSON.stringify(token)}`);
  _tokenCache = token.access_token;
  _tokenExpiresAt = Date.now() + (token.expires_in || 3600) * 1000;
  return _tokenCache;
}

function apiRequest(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${BASE}${path}`);
    const bodyStr = body ? JSON.stringify(body) : null;
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
        },
        timeout: 15000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) });
          } catch (e) {
            reject(e);
          }
        });
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

/**
 * Place an EagleView measurement order for a property.
 *
 * Report types:
 *   - 'PremiumCommercial'   — full wall & roof breakdown (most detail)
 *   - 'Premium'             — standard residential roof measurements
 *   - 'Essentials'          — basic roof area and pitch
 *
 * @param {object} params
 * @param {string} params.address        Street address
 * @param {string} params.city           City
 * @param {string} params.state          State (e.g. "MA")
 * @param {string} params.zip            ZIP code
 * @param {string} [params.reportType]   Default: 'Premium'
 * @param {string} [params.jobId]        Internal job reference
 * @returns {Promise<{eagleViewOrderId, status, estimatedDelivery}|null>}
 */
async function createOrder({ address, city, state, zip, reportType = 'Premium', jobId }) {
  if (!isConfigured())
    throw new Error(
      'EagleView credentials not configured (EAGLEVIEW_CLIENT_ID / EAGLEVIEW_CLIENT_SECRET)',
    );

  const token = await getAccessToken();

  const payload = {
    report_type: reportType,
    property: {
      address: { street: address, city, state, zip },
    },
    options: {
      include_walls: true,
      include_gutters: true,
    },
    reference_id: jobId || undefined,
  };

  const res = await apiRequest('POST', '/measurement-orders', payload, token);
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`EagleView order error ${res.status}: ${JSON.stringify(res.body)}`);
  }

  const order = res.body;
  return {
    eagleViewOrderId: order.order_id || order.id,
    status: order.status || 'placed',
    estimatedDelivery: order.estimated_delivery_date || '24-48 hours',
    internalJobId: jobId,
  };
}

/**
 * Get status of an EagleView order.
 * Statuses: placed → processing → complete | failed
 */
async function getOrderStatus(orderId) {
  if (!isConfigured()) throw new Error('EagleView credentials not configured');
  const token = await getAccessToken();
  const res = await apiRequest('GET', `/measurement-orders/${orderId}`, null, token);
  if (res.status !== 200) throw new Error(`EagleView status error ${res.status}`);
  return res.body;
}

/**
 * Download measurement report from a completed EagleView order.
 * Returns structured data including roof area, pitch, wall areas.
 */
async function getOrderMeasurements(orderId) {
  if (!isConfigured()) throw new Error('EagleView credentials not configured');
  const token = await getAccessToken();

  // Get order details (contains report download link)
  const orderRes = await apiRequest('GET', `/measurement-orders/${orderId}`, null, token);
  if (orderRes.status !== 200) throw new Error(`EagleView get order error ${orderRes.status}`);

  const order = orderRes.body;
  if (order.status !== 'complete') {
    return { status: order.status, message: eagleViewStatusLabel(order.status) };
  }

  // Fetch the measurement JSON report
  const reportUrl = order.report_urls?.find((u) => u.format === 'json')?.url;
  if (!reportUrl) return { status: 'complete', message: 'No JSON report available', order };

  const reportRes = await apiRequest('GET', reportUrl.replace(BASE, ''), null, token);
  return reportRes.body;
}

function eagleViewStatusLabel(status) {
  const labels = {
    placed: 'Order placed — aerial capture in progress',
    processing: 'Processing aerial imagery — usually 24-48 hrs',
    complete: 'Measurements ready',
    failed: 'Order failed — contact EagleView support',
    on_hold: 'On hold — EagleView needs more info',
  };
  return labels[status] || status;
}

module.exports = {
  createOrder,
  getOrderStatus,
  getOrderMeasurements,
  eagleViewStatusLabel,
  isConfigured,
};
