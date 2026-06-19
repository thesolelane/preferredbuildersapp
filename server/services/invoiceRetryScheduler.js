'use strict';
// server/services/invoiceRetryScheduler.js
// Background scheduler that retries failed invoice email sends.
//
// Behaviour:
//   • Runs immediately on startup, then every RETRY_INTERVAL_MS
//   • Scans invoices with status = 'pending_send'
//   • Attempts sendInvoiceEmail for each; increments send_attempts on every try
//   • On success: status becomes 'sent' (handled inside sendInvoiceEmail)
//   • On 3+ failed attempts: logs a warning and sends a WhatsApp alert to the owner

const { getDb } = require('../db/database');
const { sendInvoiceEmail } = require('./invoiceEmailService');
const { sendWhatsApp } = require('./whatsappService');
const { team } = require('../../config/parameters');

const MAX_ATTEMPTS_BEFORE_ALERT = 3;
const RETRY_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

async function runInvoiceRetryTick() {
  const db = getDb();

  const pending = db.prepare("SELECT * FROM invoices WHERE status = 'pending_send'").all();

  if (!pending.length) return;

  console.log(`[InvoiceRetry] ${pending.length} pending invoice(s) found — retrying`);

  for (const inv of pending) {
    const attempts = (inv.send_attempts || 0) + 1;

    db.prepare('UPDATE invoices SET send_attempts = ? WHERE id = ?').run(attempts, inv.id);

    try {
      await sendInvoiceEmail(inv.id, db, 'system (retry)');
      console.log(
        `[InvoiceRetry] Invoice ${inv.invoice_number} sent successfully (attempt ${attempts})`,
      );
    } catch (err) {
      console.warn(
        `[InvoiceRetry] Invoice ${inv.invoice_number} send failed (attempt ${attempts}): ${err.message}`,
      );

      if (attempts >= MAX_ATTEMPTS_BEFORE_ALERT) {
        const alertMsg =
          `⚠️ Invoice ${inv.invoice_number} failed to send after ${attempts} attempt(s). ` +
          `Please check the Invoices page and resend manually. Error: ${err.message}`;

        const ownerPhone = process.env.OWNER_WHATSAPP || team.owner.whatsapp;
        if (ownerPhone) {
          sendWhatsApp(ownerPhone, alertMsg).catch((e) =>
            console.warn('[InvoiceRetry] WhatsApp alert failed:', e.message),
          );
        }

        const jacksonPhone = process.env.JACKSON_WHATSAPP || team.jackson?.whatsapp;
        if (jacksonPhone && jacksonPhone !== ownerPhone) {
          sendWhatsApp(jacksonPhone, alertMsg).catch((e) =>
            console.warn('[InvoiceRetry] WhatsApp alert (Jackson) failed:', e.message),
          );
        }
      }
    }
  }
}

function startInvoiceRetryScheduler() {
  console.log('[InvoiceRetry] Scheduler started — running on startup + every 4 hours');
  runInvoiceRetryTick().catch((e) => console.warn('[InvoiceRetry] Initial tick error:', e.message));
  setInterval(() => {
    runInvoiceRetryTick().catch((e) => console.warn('[InvoiceRetry] Tick error:', e.message));
  }, RETRY_INTERVAL_MS);
}

module.exports = { startInvoiceRetryScheduler };
