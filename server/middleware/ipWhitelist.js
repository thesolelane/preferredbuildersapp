// server/middleware/ipWhitelist.js
const { getDb } = require('../db/database');

let cachedIps = null;
let cacheExpiry = 0;

function getAllowedIps() {
  const now = Date.now();
  if (cachedIps && now < cacheExpiry) return cachedIps;
  try {
    const db = getDb();
    const row = db.prepare("SELECT value FROM settings WHERE key = 'security.allowed_ips'").get();
    cachedIps = row ? JSON.parse(row.value) : [];
  } catch {
    cachedIps = [];
  }
  cacheExpiry = now + 60000;
  return cachedIps;
}

function invalidateIpCache() {
  cachedIps = null;
  cacheExpiry = 0;
}

function isLocalIp(ip) {
  const addr = ip.replace(/^::ffff:/, '');
  return (
    addr === '127.0.0.1' ||
    addr === '::1' ||
    addr === 'localhost' ||
    addr.startsWith('192.168.') ||
    addr.startsWith('10.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(addr)
  );
}

const PUBLIC_PREFIXES = [
  '/portal',
  '/api/portal',
  '/sign',
  '/api/signing',
  '/health',
  '/webhook',
  '/api/track',
  '/trade-select',
];

function ipWhitelist(req, res, next) {
  const ip = (req.ip || '').replace(/^::ffff:/, '');
  if (isLocalIp(ip)) return next();

  const p = req.path;
  if (PUBLIC_PREFIXES.some((prefix) => p.startsWith(prefix))) return next();

  const allowed = getAllowedIps();
  if (allowed.includes(ip)) return next();

  console.warn(`[Security] Blocked ${req.method} ${p} from ${ip}`);
  return res.status(403).send(`
    <html><body style="font-family:sans-serif;padding:40px;text-align:center">
      <h2>Access Denied</h2>
      <p>Your IP address (<strong>${ip}</strong>) is not authorized to access this system.</p>
      <p>Contact your administrator to add your IP.</p>
    </body></html>
  `);
}

// Lightweight check — only for specific protected routes (e.g. settings)
function requireOfficeIp(req, res, next) {
  const ip = (req.ip || '').replace(/^::ffff:/, '');
  if (isLocalIp(ip)) return next();
  const allowed = getAllowedIps();
  if (allowed.includes(ip)) return next();
  console.warn(`[Security] Settings access blocked from ${ip}`);
  return res
    .status(403)
    .json({ error: 'Settings can only be accessed from an authorized network.' });
}

module.exports = { ipWhitelist, requireOfficeIp, invalidateIpCache };
