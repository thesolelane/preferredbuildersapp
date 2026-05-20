// server/services/errorLogger.js
// Keeps a rolling in-memory buffer of recent server errors + smart alerting

const MAX_ERRORS = 50;
const errors = [];

// In-memory dedup map: hash -> lastAlertedMs
const dedupMap = {};
const DEDUP_WINDOW_MS = 60 * 60 * 1000; // 1 hour

// In-memory alert log for status page summary
const alertLog = [];
const MAX_ALERTS = 200;

// ─── Error classifier ───────────────────────────────────────────────────────

function classifyError(message, stack) {
  // Lowercase once; all patterns below must use lowercase literals only
  const text = ((message || '') + ' ' + (stack || '')).toLowerCase();

  // ── Noise / client-fault errors — suppress alerts entirely ──

  // Dropped file upload — client navigated away or lost connection mid-stream
  if (/unexpected end of form/.test(text)) {
    return {
      type: 'user',
      severity: 'info',
      source: 'upload',
      suggestedCause: 'Client dropped connection during file upload — no action needed.',
    };
  }

  // ── System-specific patterns — evaluated FIRST to avoid false suppression ──

  // Claude / Anthropic (check before generic auth patterns)
  if (/anthropic|claude|overloaded_error/.test(text)) {
    if (/credit|billing|quota|payment|balance/.test(text)) {
      return {
        type: 'system',
        severity: 'critical',
        source: 'claude',
        suggestedCause:
          'Claude credits may be exhausted — check Anthropic billing at console.anthropic.com.',
      };
    }
    if (/rate.?limit|too many requests/.test(text) || /\b429\b/.test(text)) {
      return {
        type: 'system',
        severity: 'warning',
        source: 'claude',
        suggestedCause:
          'Anthropic rate limit hit — requests are being throttled. Consider adding retry delays.',
      };
    }
    if (/overloaded|service unavailable/.test(text) || /\b529\b/.test(text)) {
      return {
        type: 'system',
        severity: 'warning',
        source: 'claude',
        suggestedCause: 'Anthropic API is overloaded — temporary outage, will likely self-resolve.',
      };
    }
    return {
      type: 'system',
      severity: 'warning',
      source: 'claude',
      suggestedCause: 'Claude API error — check Anthropic status page and API key validity.',
    };
  }

  // PDF / Puppeteer / Chromium (check before generic "not found" user pattern)
  if (
    /puppeteer|chromium|chrome|headless|browser/.test(text) ||
    (/pdf/.test(text) && /error|fail|crash|timeout/.test(text))
  ) {
    if (/not found|no such file|enoent/.test(text)) {
      return {
        type: 'system',
        severity: 'critical',
        source: 'pdf',
        suggestedCause:
          'Chromium binary not found — PDF generation is broken. Reinstall or check Nix configuration.',
      };
    }
    return {
      type: 'system',
      severity: 'warning',
      source: 'pdf',
      suggestedCause:
        'PDF/browser error — Chromium may have crashed or timed out. Check available memory.',
    };
  }

  // Database / SQLite (check before generic patterns; all uppercase tokens lowercased)
  if (/sqlite|better-sqlite|db\.prepare|sqlite_/.test(text)) {
    if (/corrupt|malformed|sqlite_corrupt/.test(text)) {
      return {
        type: 'system',
        severity: 'critical',
        source: 'database',
        suggestedCause:
          'SQLite database appears corrupted — immediate attention required. Take a backup.',
      };
    }
    if (/locked|sqlite_busy|sqlite_locked/.test(text)) {
      return {
        type: 'system',
        severity: 'warning',
        source: 'database',
        suggestedCause:
          'Database is locked — too many concurrent writes. Check for long-running queries.',
      };
    }
    return {
      type: 'system',
      severity: 'warning',
      source: 'database',
      suggestedCause: 'Database error — check SQLite file integrity and disk space.',
    };
  }

  // Email / Resend (check before generic "unauthorized"/"not found" user patterns)
  if (/resend|smtp|email send/.test(text)) {
    if (/unauthorized|invalid key|\b403\b/.test(text)) {
      return {
        type: 'system',
        severity: 'critical',
        source: 'email',
        suggestedCause: 'Email API key rejected — check RESEND_API_KEY is correct and active.',
      };
    }
    return {
      type: 'system',
      severity: 'warning',
      source: 'email',
      suggestedCause: 'Email delivery failed — check Resend dashboard for bounce/block details.',
    };
  }

  // Port / network (all uppercase tokens lowercased)
  if (/eaddrinuse|address already in use/.test(text)) {
    return {
      type: 'system',
      severity: 'critical',
      source: 'server',
      suggestedCause:
        'Server port is already in use — another process may be running. Restart the server.',
    };
  }
  if (/econnrefused|econnreset|etimedout|enotfound/.test(text)) {
    return {
      type: 'system',
      severity: 'warning',
      source: 'server',
      suggestedCause: 'Network connection failed — an external service may be down or unreachable.',
    };
  }

  // Unhandled rejection / crash
  if (/unhandled (rejection|exception)|uncaughtexception/.test(text)) {
    return {
      type: 'system',
      severity: 'critical',
      source: 'server',
      suggestedCause:
        'Unhandled error crashed an async operation — check server logs for full stack trace.',
    };
  }

  // 5xx server errors
  if (/5\d\d\s|internal server error/.test(text)) {
    return {
      type: 'system',
      severity: 'warning',
      source: 'server',
      suggestedCause: 'Server returned a 5xx error — check server logs for the root cause.',
    };
  }

  // ── User / auth errors — evaluated LAST, only when no system pattern matched ──
  // Narrow patterns: explicit 4xx codes, specific auth/validation context words
  const userPatterns = [
    /\b4[0-9]{2}\b/,
    /invalid (password|credentials|token|session)/,
    /session (expired|invalid)/,
    /validation (error|failed)/,
    /bad request/,
    /wrong password/,
    /login (failed|required)/,
    /\bunauthorized\b/,
    /\bforbidden\b/,
    /\baccess denied\b/,
  ];
  for (const p of userPatterns) {
    if (p.test(text)) {
      return {
        type: 'user',
        severity: 'warning',
        source: 'auth',
        suggestedCause: 'User-level error (auth/validation) — no action needed.',
      };
    }
  }

  // Default: treat as system warning
  return {
    type: 'system',
    severity: 'warning',
    source: 'server',
    suggestedCause: 'Unexpected server error — review logs for details.',
  };
}

// ─── Deduplication ───────────────────────────────────────────────────────────

function makeHash(source, message) {
  // Simple key: source + first 120 chars of message
  return `${source}::${String(message).slice(0, 120)}`;
}

function shouldAlert(hash) {
  const last = dedupMap[hash];
  if (!last) return true;
  return Date.now() - last > DEDUP_WINDOW_MS;
}

function markAlerted(hash) {
  dedupMap[hash] = Date.now();
}

// ─── GitHub Issue creator ────────────────────────────────────────────────────

async function createGithubIssue(title, body, labels) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.warn('[GitHub] GITHUB_TOKEN not set — skipping issue creation.');
    return;
  }
  const https = require('https');
  const payload = JSON.stringify({ title, body, labels: labels || [] });
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: 'api.github.com',
        path: '/repos/thesolelane/preferredbuildersapp/issues',
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/vnd.github+json',
          'User-Agent': 'PreferredBuilders-AlertBot/1.0',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          if (res.statusCode === 201) {
            try {
              const issue = JSON.parse(data);
              console.log(`[GitHub] Created issue #${issue.number}: ${title}`);
            } catch {
              /* ignore */
            }
          } else {
            console.warn(
              `[GitHub] Issue creation returned HTTP ${res.statusCode}: ${data.slice(0, 200)}`,
            );
          }
          resolve();
        });
      },
    );
    req.on('error', (e) => {
      console.warn('[GitHub] Issue creation failed:', e.message);
      resolve();
    });
    req.setTimeout(8000, () => {
      req.destroy();
      resolve();
    });
    req.write(payload);
    req.end();
  });
}

// ─── Alert sender ─────────────────────────────────────────────────────────────

async function sendSystemAlert({ classification, rawMessage, jobId, timestamp }) {
  const { severity, source, suggestedCause } = classification;
  const ownerEmails = (() => {
    const raw = process.env.OWNER_EMAIL || process.env.REPLY_TO_EMAIL || '';
    return raw
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean);
  })();

  const truncatedRaw = String(rawMessage).slice(0, 800);
  const ts = timestamp || new Date().toISOString();
  const severityColor = severity === 'critical' ? '#C62828' : '#E07B2A';
  const severityLabel = severity === 'critical' ? '🔴 CRITICAL' : '🟡 WARNING';

  const subject = `[${severityLabel}] ${source.toUpperCase()} error — Preferred Builders`;
  const html = `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <div style="background: ${severityColor}; color: white; padding: 16px 20px; border-radius: 8px 8px 0 0;">
    <h2 style="margin:0; font-size:18px;">${severityLabel} — ${source.toUpperCase()} Error</h2>
  </div>
  <div style="background: #f9f9f9; border: 1px solid #ddd; border-top: none; padding: 20px; border-radius: 0 0 8px 8px;">
    <table style="width:100%; border-collapse:collapse; font-size:14px;">
      <tr><td style="padding:8px 0; color:#666; width:140px;"><strong>Source</strong></td><td>${source}</td></tr>
      <tr><td style="padding:8px 0; color:#666;"><strong>Severity</strong></td><td style="color:${severityColor}; font-weight:bold;">${severity.toUpperCase()}</td></tr>
      <tr><td style="padding:8px 0; color:#666;"><strong>Timestamp</strong></td><td>${ts}</td></tr>
      ${jobId ? `<tr><td style="padding:8px 0; color:#666;"><strong>Job ID</strong></td><td>${jobId}</td></tr>` : ''}
      <tr><td style="padding:8px 0; color:#666;"><strong>Suggested Cause</strong></td><td style="color:#1B3A6B; font-weight:500;">${suggestedCause}</td></tr>
    </table>
    <div style="margin-top:16px; padding:12px; background:#fff3f3; border:1px solid #fecaca; border-radius:6px;">
      <div style="font-size:12px; color:#666; margin-bottom:6px; font-weight:bold;">Raw Error Message</div>
      <pre style="margin:0; font-size:12px; color:#333; white-space:pre-wrap; word-break:break-word;">${truncatedRaw}</pre>
    </div>
    <p style="margin-top:20px; font-size:12px; color:#888;">
      This alert was generated automatically by the Preferred Builders server.<br>
      Duplicate alerts are suppressed for 1 hour per unique error type.
    </p>
  </div>
</div>`;

  // Send email
  if (ownerEmails.length > 0) {
    try {
      const { sendEmail } = require('./emailService');
      await sendEmail({ to: ownerEmails, subject, html, emailType: 'system_alert', jobId });
    } catch (e) {
      console.warn('[Alert] Failed to send alert email:', e.message);
    }
  } else {
    console.warn('[Alert] No OWNER_EMAIL configured — skipping alert email.');
  }

  // Create GitHub issue
  const issueTitle = `[${severity.toUpperCase()}] ${source} error: ${String(rawMessage).slice(0, 80)}`;
  const issueBody = `## System Error Alert\n\n**Source:** ${source}\n**Severity:** ${severity}\n**Timestamp:** ${ts}\n${jobId ? `**Job ID:** ${jobId}\n` : ''}\n**Suggested Cause:**\n> ${suggestedCause}\n\n**Raw Error:**\n\`\`\`\n${truncatedRaw}\n\`\`\`\n\n*Auto-generated by Preferred Builders error alerting system.*`;
  const labels = ['bug', severity, source];
  await createGithubIssue(issueTitle, issueBody, labels);

  // Record in alert log
  alertLog.push({
    ts,
    source,
    severity,
    suggestedCause,
    message: String(rawMessage).slice(0, 200),
  });
  if (alertLog.length > MAX_ALERTS) alertLog.shift();
}

// ─── Core capture ─────────────────────────────────────────────────────────────

function captureError(message, source, { jobId } = {}) {
  const ts = new Date().toISOString();
  errors.push({
    ts,
    source: source || 'server',
    message: String(message).slice(0, 500),
  });
  if (errors.length > MAX_ERRORS) errors.shift();

  // Classify and maybe alert
  const classification = classifyError(message, '');
  if (classification.type === 'system') {
    const hash = makeHash(classification.source, message);
    if (shouldAlert(hash)) {
      markAlerted(hash);
      // Fire-and-forget (don't block callers)
      sendSystemAlert({ classification, rawMessage: message, jobId, timestamp: ts }).catch(
        () => {},
      );
    }
  }
}

function getRecentErrors(limit = 20) {
  return errors.slice(-limit).reverse();
}

function clearErrors() {
  errors.length = 0;
}

function getAlertsSummary() {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const last24h = alertLog.filter((a) => new Date(a.ts).getTime() >= cutoff);
  return {
    last24hCount: last24h.length,
    last24h: last24h.slice(-20).reverse(),
  };
}

// ─── Patch console.error ──────────────────────────────────────────────────────

const _origError = console.error.bind(console);
console.error = (...args) => {
  _origError(...args);
  captureError(args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '));
};

// Also capture unhandled promise rejections
process.on('unhandledRejection', (reason) => {
  captureError('Unhandled rejection: ' + (reason?.message || reason), 'process');
});

module.exports = { captureError, getRecentErrors, clearErrors, classifyError, getAlertsSummary };
