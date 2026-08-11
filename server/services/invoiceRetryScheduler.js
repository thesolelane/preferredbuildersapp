'use strict';
// server/services/invoiceRetryScheduler.js
// Background scheduler that retries failed invoice email sends.
//
// Behaviour:
//   • Runs immediately on startup, then every RETRY_INTERVAL_MS
//   • Scans invoices with status = 'pending_send'
//   • retry_count is the single authoritative failure counter; incremented only on failure
//   • On success: status becomes 'sent' (handled inside sendInvoiceEmail); last_error cleared
//   • After MAX_RETRY_ATTEMPTS failures: status set to 'failed'; retrying stops automatically
//   • Manual retry via POST /:id/retry resets retry_count to 0, giving a fresh window

const { getDb } = require('../db/database');
const { sendInvoiceEmail } = require('./invoiceEmailService');
const { sendWhatsApp } = require('./whatsappService');
const { team } = require('../../config/parameters');

const MAX_RETRY_ATTEMPTS = 5;
const ALERT_AFTER_ATTEMPTS = 3;
const RETRY_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

async function runInvoiceRetryTick() {
  const db = getDb();

  // Only process pending invoices; failed invoices are excluded until manually retried
  const pending = db.prepare("SELECT * FROM invoices WHERE status = 'pending_send'").all();

  if (!pending.length) return;

  console.log(`[InvoiceRetry] ${pending.length} pending invoice(s) found — retrying`);

  for (const inv of pending) {
    // send_attempts tracks total lifetime attempts (including successes) for auditing
    const totalAttempts = (inv.send_attempts || 0) + 1;
    db.prepare('UPDATE invoices SET send_attempts = ? WHERE id = ?').run(totalAttempts, inv.id);

    try {
      await sendInvoiceEmail(inv.id, db, 'system (retry)');
      console.log(
        `[InvoiceRetry] Invoice ${inv.invoice_number} sent successfully (total attempt ${totalAttempts})`,
      );
      // Clear last_error on successful send
      db.prepare('UPDATE invoices SET last_error = NULL WHERE id = ?').run(inv.id);
    } catch (err) {
      const errMsg = err.message || 'Unknown error';

      // retry_count is authoritative: only incremented on failure
      const failCount = (inv.retry_count || 0) + 1;
      db.prepare('UPDATE invoices SET retry_count = ?, last_error = ? WHERE id = ?').run(
        failCount,
        errMsg,
        inv.id,
      );

      console.warn(
        `[InvoiceRetry] Invoice ${inv.invoice_number} send failed (failure ${failCount}/${MAX_RETRY_ATTEMPTS}): ${errMsg}`,
      );

      // After MAX_RETRY_ATTEMPTS consecutive failures, permanently mark as failed
      if (failCount >= MAX_RETRY_ATTEMPTS) {
        db.prepare(
          "UPDATE invoices SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        ).run(inv.id);
        console.warn(
          `[InvoiceRetry] Invoice ${inv.invoice_number} permanently FAILED after ${failCount} failures — manual retry required`,
        );

        const failedMsg =
          `🚨 Invoice ${inv.invoice_number} has PERMANENTLY FAILED after ${failCount} send attempts. ` +
          `Please go to the Invoices page, fix the issue, and click Retry. Last error: ${errMsg}`;

        const ownerPhone = process.env.OWNER_WHATSAPP || team.owner.whatsapp;
        if (ownerPhone) {
          sendWhatsApp(ownerPhone, failedMsg).catch((e) =>
            console.warn('[InvoiceRetry] WhatsApp alert failed:', e.message),
          );
        }
        const jacksonPhone = process.env.JACKSON_WHATSAPP || team.jackson?.whatsapp;
        if (jacksonPhone && jacksonPhone !== ownerPhone) {
          sendWhatsApp(jacksonPhone, failedMsg).catch((e) =>
            console.warn('[InvoiceRetry] WhatsApp alert (Jackson) failed:', e.message),
          );
        }
        continue;
      }

      // Intermediate alert after ALERT_AFTER_ATTEMPTS failures (before permanent failure)
      if (failCount >= ALERT_AFTER_ATTEMPTS) {
        const alertMsg =
          `⚠️ Invoice ${inv.invoice_number} failed to send after ${failCount} attempt(s). ` +
          `Will retry up to ${MAX_RETRY_ATTEMPTS} times total. Error: ${errMsg}`;

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
