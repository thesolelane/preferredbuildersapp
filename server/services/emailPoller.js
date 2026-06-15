// server/services/emailPoller.js
// Polls a dedicated IMAP inbox for new estimate emails
// Set env vars: IMAP_USER, IMAP_PASSWORD, IMAP_HOST (default: imap.gmail.com), IMAP_PORT (default: 993)

const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const pdfParse = require('pdf-parse');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/database');
const { logAudit } = require('./auditService');
const { sendEmail } = require('./emailService');

let _polling = false;

async function pollOnce(processEstimateFn, generatePDFFn) {
  if (!process.env.IMAP_USER || !process.env.IMAP_PASSWORD) return;

  const client = new ImapFlow({
    host: process.env.IMAP_HOST || 'imap.gmail.com',
    port: parseInt(process.env.IMAP_PORT || '993'),
    secure: true,
    auth: { user: process.env.IMAP_USER, pass: process.env.IMAP_PASSWORD },
    logger: false,
  });

  try {
    await client.connect();
    await client.mailboxOpen('INBOX');

    // Search for unread emails
    const messages = await client.search({ seen: false });
    if (!messages.length) {
      await client.logout();
      return;
    }

    console.log(`[Email Poller] Found ${messages.length} unread email(s)`);

    for (const uid of messages) {
      try {
        const msg = await client.fetchOne(uid, { source: true });
        const parsed = await simpleParser(msg.source);

        const from = parsed.from?.value?.[0]?.address?.toLowerCase() || '';
        const subject = parsed.subject || '';
        const bodyText = parsed.text || '';
        const language = detectLanguage(bodyText + subject);
        const fromName = parsed.from?.value?.[0]?.name || from.split('@')[0];
        const firstName = fromName.split(' ')[0];

        console.log(`[Email Poller] Processing: "${subject}" from ${from}`);

        // ── Marblism missed-call handler ────────────────────────────────
        const isMarblism =
          from.includes('marblism.com') || /i['']ve just handled a call/i.test(subject);

        if (isMarblism) {
          try {
            const phoneMatch = bodyText.match(/received a call from\s*([+\d\s\-().]{7,20})/i);
            const nameMatch = bodyText.match(/(?:The user|The caller|caller)[,\s]+([A-Z][a-z]+)/);
            const summaryMatch = bodyText.match(
              /Here['']s the summary[:\s]*([\s\S]+?)(?:\n\n|You can head|Speak soon)/i,
            );

            const callerPhone = phoneMatch ? phoneMatch[1].trim() : 'Unknown number';
            const callerName = nameMatch ? nameMatch[1].trim() : 'Unknown caller';
            const callSummary = summaryMatch
              ? summaryMatch[1].trim()
              : bodyText.slice(0, 400).trim();

            const shortSummary =
              callSummary.length > 120 ? callSummary.slice(0, 117) + '…' : callSummary;

            const db = getDb();

            // Create a Lead instead of a plain task
            const leadResult = db
              .prepare(
                `INSERT INTO leads (caller_name, caller_phone, source, notes, stage, created_at, updated_at)
               VALUES (?, ?, 'marblism', ?, 'incoming', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
              )
              .run(callerName, callerPhone, `Call summary from Marblism:\n\n${callSummary}`);

            logAudit(
              null,
              'marblism_call_lead',
              `Lead #${leadResult.lastInsertRowid} created from Marblism call — ${callerName} ${callerPhone} — "${shortSummary}"`,
              'marblism-poller',
            );
            console.log(
              `[Email Poller] Marblism call → Lead #${leadResult.lastInsertRowid} created for ${callerName} (${callerPhone})`,
            );

            const { notifyClients } = require('./sseManager');
            notifyClients('lead_created', {
              leadId: leadResult.lastInsertRowid,
              title: `📞 New lead: ${callerName} (${callerPhone})`,
              message: `New Marblism missed-call lead — ${callerName}`,
            });

            // Auto-create a follow-up reminder task linked to this lead
            try {
              const leadId = leadResult.lastInsertRowid;
              const dueAt = new Date(Date.now() + 24 * 3600000)
                .toISOString()
                .replace('T', ' ')
                .slice(0, 19);
              const taskTitle = `📞 Follow up: ${callerName} (${callerPhone})`;
              const taskDesc =
                `Auto-created from Marblism missed-call lead #${leadId}.\n` +
                `Caller: ${callerName}\nPhone: ${callerPhone}\n\nSummary:\n${callSummary}`;

              const taskRow = db
                .prepare(
                  `INSERT INTO tasks
                    (title, description, status, priority, lead_id, due_at, remind_at,
                     remind_interval_hours, task_type, created_at, updated_at)
                   VALUES (?, ?, 'pending', 'high', ?, ?, ?, 24, 'lead',
                           CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
                )
                .run(taskTitle, taskDesc, leadId, dueAt, dueAt);

              const taskId = taskRow.lastInsertRowid;
              logAudit(
                null,
                'lead_auto_task',
                `Lead #${leadId}: follow-up task #${taskId} auto-created on intake`,
                'marblism-poller',
              );
              console.log(`[Email Poller] Follow-up task #${taskId} created for lead #${leadId}`);

              // Push to Google Calendar (fallback to "add event" link if API unavailable)
              try {
                const gcal = require('./googleCalendar');
                const calId =
                  db.prepare("SELECT value FROM settings WHERE key = 'gcal.calendarId'").get()
                    ?.value || 'primary';
                const calEnabled =
                  db.prepare("SELECT value FROM settings WHERE key = 'gcal.enabled'").get()
                    ?.value !== 'false';

                // Build a fallback "add event" URL (same pattern as /api/tasks)
                let calURL = null;
                try {
                  const dueIso = new Date(dueAt).toISOString();
                  const start = dueIso
                    .replace(/[-:]/g, '')
                    .replace(/\.\d{3}Z?$/, '')
                    .slice(0, 15);
                  const endDt = new Date(new Date(dueAt).getTime() + 3600000);
                  const end = endDt
                    .toISOString()
                    .replace(/[-:]/g, '')
                    .replace(/\.\d{3}Z?$/, '')
                    .slice(0, 15);
                  calURL =
                    `https://calendar.google.com/calendar/render?action=TEMPLATE` +
                    `&text=${encodeURIComponent(taskTitle)}` +
                    `&dates=${start}/${end}` +
                    `&details=${encodeURIComponent(taskDesc)}`;
                } catch {
                  // fallback URL optional — leave null
                }

                if (calEnabled) {
                  const gcalLink = await gcal.createCalendarEvent(
                    { title: taskTitle, description: taskDesc, due_at: dueAt },
                    calId,
                  );
                  if (gcalLink) {
                    calURL = gcalLink;
                    console.log(
                      `[Email Poller] Google Calendar event created for task #${taskId}: ${gcalLink}`,
                    );
                  }
                }

                if (calURL) {
                  db.prepare('UPDATE tasks SET calendar_url = ? WHERE id = ?').run(calURL, taskId);
                }
              } catch (gcalErr) {
                console.warn(
                  '[Email Poller] Could not create Google Calendar event for follow-up task:',
                  gcalErr.message,
                );
              }
            } catch (taskErr) {
              console.error(
                '[Email Poller] Failed to create follow-up task for Marblism lead:',
                taskErr.message,
              );
            }

            // Send immediate creation email to all admin/system_admin users
            try {
              let adminUsers;
              try {
                adminUsers = db
                  .prepare(
                    `SELECT email FROM users WHERE role IN ('admin','system_admin') AND email IS NOT NULL AND active != 0`,
                  )
                  .all();
              } catch {
                adminUsers = db
                  .prepare(
                    `SELECT email FROM users WHERE role IN ('admin','system_admin') AND email IS NOT NULL`,
                  )
                  .all();
              }
              const adminEmails = adminUsers.map((u) => u.email).filter(Boolean);
              if (adminEmails.length > 0) {
                const appUrl =
                  process.env.APP_URL ||
                  (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : '');
                const leadsLink = appUrl ? `${appUrl}/leads` : '/leads';
                await sendEmail({
                  to: adminEmails,
                  subject: `📞 New Missed Call Lead: ${callerName} (${callerPhone})`,
                  html: `
                    <div style="font-family:sans-serif;max-width:600px">
                      <h2 style="color:#1B3A6B">📞 New Missed Call Lead</h2>
                      <table style="width:100%;border-collapse:collapse">
                        <tr><td style="padding:8px;color:#555">Caller</td><td style="padding:8px;font-weight:bold">${callerName}</td></tr>
                        <tr style="background:#f9f9f9"><td style="padding:8px;color:#555">Phone</td><td style="padding:8px">${callerPhone}</td></tr>
                        <tr><td style="padding:8px;color:#555">Summary</td><td style="padding:8px">${callSummary.replace(/\n/g, '<br>')}</td></tr>
                      </table>
                      <p><a href="${leadsLink}" style="background:#1B3A6B;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;margin-top:12px">View Leads</a></p>
                    </div>`,
                  emailType: 'lead_creation_alert',
                });
                console.log(
                  `[Email Poller] Marblism creation email sent to ${adminEmails.join(', ')}`,
                );
              }
            } catch (emailErr) {
              console.error(
                '[Email Poller] Failed to send Marblism creation email:',
                emailErr.message,
              );
            }
          } catch (err) {
            console.error('[Email Poller] Marblism parse error:', err.message);
          }

          await client.messageFlagsAdd(uid, ['\\Seen']);
          continue;
        }
        // ── end Marblism handler ────────────────────────────────────────

        // Extract text from PDF attachments
        let estimateText = bodyText.trim();
        let _hasPdf = false;

        if (parsed.attachments?.length) {
          for (const att of parsed.attachments) {
            const isImage = att.contentType?.startsWith('image/');
            const isPdf = att.contentType === 'application/pdf' || att.filename?.endsWith('.pdf');

            if (isPdf) {
              try {
                const parsed2 = await pdfParse(att.content);
                const pdfText = parsed2.text?.trim();
                if (pdfText && pdfText.length > 50) {
                  estimateText = pdfText + (estimateText ? '\n\n' + estimateText : '');
                  _hasPdf = true;
                  console.log(`[Email Poller] PDF extracted: ${pdfText.length} chars`);
                }
              } catch (e) {
                console.error('[Email Poller] PDF parse error:', e.message);
              }
            } else if (isImage) {
              // Use Claude vision for image attachments
              try {
                const Anthropic = require('@anthropic-ai/sdk');
                const visionClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
                const base64 = att.content.toString('base64');
                const visionRes = await visionClient.messages.create({
                  model: 'claude-sonnet-4-5',
                  max_tokens: 3000,
                  messages: [
                    {
                      role: 'user',
                      content: [
                        {
                          type: 'image',
                          source: { type: 'base64', media_type: att.contentType, data: base64 },
                        },
                        {
                          type: 'text',
                          text: 'This is a construction estimate or invoice image. Extract ALL text, line items, dollar amounts, trade names, and addresses exactly as they appear. Return plain text.',
                        },
                      ],
                    },
                  ],
                });
                const imageText = visionRes.content[0].text?.trim();
                if (imageText) {
                  estimateText = imageText + (estimateText ? '\n\n' + estimateText : '');
                  _hasPdf = true;
                }
              } catch (e) {
                console.error('[Email Poller] Image vision error:', e.message);
              }
            }
          }
        }

        if (!estimateText || estimateText.length < 30) {
          console.log(`[Email Poller] Email ${uid} has no usable content, skipping`);
          await client.messageFlagsAdd(uid, ['\\Seen']);
          continue;
        }

        // Create job and process immediately
        const db = getDb();
        const jobId = uuidv4();
        const shortId = jobId.slice(0, 8).toUpperCase();

        const fullEstimate = `EMAIL FROM: ${from}\nSUBJECT: ${subject}\n\n${estimateText}`;

        db.prepare(
          `INSERT INTO jobs (id, raw_estimate_data, status, submitted_by) VALUES (?, ?, 'received', ?)`,
        ).run(jobId, fullEstimate, `email:${from}`);

        logAudit(
          jobId,
          'estimate_received_email',
          `Email from ${from} | Subject: ${subject}`,
          'email-poller',
        );

        // Mark email as read
        await client.messageFlagsAdd(uid, ['\\Seen']);

        // Acknowledge receipt
        try {
          await sendEmail({
            to: from,
            subject: `Received — Quote #${shortId}`,
            html:
              language === 'pt-BR'
                ? `<p>Oi ${firstName}! Recebi o orçamento e já estou processando. Ref: <strong>#${shortId}</strong></p><p>Você receberá a proposta em breve.</p>`
                : `<p>Hey ${firstName}! Got your estimate — processing it now. Ref: <strong>#${shortId}</strong></p><p>You'll receive the proposal shortly.</p>`,
            emailType: 'acknowledgement',
            jobId,
          });
        } catch (e) {
          console.error('[Email Poller] Could not send receipt email:', e.message);
        }

        // Process estimate immediately (no confirmation needed)
        db.prepare('UPDATE jobs SET status = ? WHERE id = ?').run('processing', jobId);

        const proposalData = await processEstimateFn(fullEstimate, jobId, language);

        if (
          proposalData.readyToGenerate === false &&
          proposalData.clarificationsNeeded?.length > 0
        ) {
          db.prepare('UPDATE jobs SET status = ? WHERE id = ?').run('clarification', jobId);
          const insertQ = db.prepare('INSERT INTO clarifications (job_id, question) VALUES (?, ?)');
          for (const q of proposalData.clarificationsNeeded) insertQ.run(jobId, q);

          const questions = proposalData.clarificationsNeeded
            .map((q, i) => `${i + 1}. ${q}`)
            .join('\n');
          await sendEmail({
            to: from,
            subject: `A few questions — Quote #${shortId}`,
            html:
              language === 'pt-BR'
                ? `<p>Preciso de mais informações sobre o orçamento:</p><pre style="background:#f5f5f5;padding:12px;border-radius:6px">${questions}</pre><p>Por favor responda este email com as respostas.</p>`
                : `<p>I need a few more details about the estimate:</p><pre style="background:#f5f5f5;padding:12px;border-radius:6px">${questions}</pre><p>Please reply to this email with your answers.</p>`,
            emailType: 'clarification',
            jobId,
          });
          console.log(
            `[Email Poller] Job ${shortId} needs ${proposalData.clarificationsNeeded.length} clarifications — emailed ${from}`,
          );
        } else {
          const pdfPath = await generatePDFFn(proposalData, 'proposal', jobId);
          db.prepare(
            `UPDATE jobs SET proposal_data = ?, proposal_pdf_path = ?, total_value = ?, deposit_amount = ?, status = ? WHERE id = ?`,
          ).run(
            JSON.stringify(proposalData),
            pdfPath,
            proposalData.totalValue,
            proposalData.depositAmount,
            'proposal_ready',
            jobId,
          );

          logAudit(
            jobId,
            'proposal_ready_email',
            `Proposal ready. Total: $${proposalData.totalValue}`,
            'email-poller',
          );

          const { getOwnerEmails } = require('./emailService');
          const recipients = [from];
          for (const ownerEmail of getOwnerEmails()) {
            if (!recipients.map((r) => r.toLowerCase()).includes(ownerEmail.toLowerCase())) {
              recipients.push(ownerEmail);
            }
          }

          await sendEmail({
            to: recipients,
            subject: `Proposal Ready — ${proposalData.customer?.name || 'New Job'} | $${(proposalData.totalValue || 0).toLocaleString()} | Ref #${shortId}`,
            html: `
              <div style="font-family:sans-serif;max-width:600px">
                <h2 style="color:#1B3A6B">Proposal Ready — Ref #${shortId}</h2>
                <table style="width:100%;border-collapse:collapse">
                  <tr><td style="padding:8px;color:#555">Customer</td><td style="padding:8px;font-weight:bold">${proposalData.customer?.name || '—'}</td></tr>
                  <tr style="background:#f9f9f9"><td style="padding:8px;color:#555">Address</td><td style="padding:8px">${proposalData.project?.address || '—'}</td></tr>
                  <tr><td style="padding:8px;color:#555">Total</td><td style="padding:8px;font-weight:bold;color:#1B3A6B">$${(proposalData.totalValue || 0).toLocaleString()}</td></tr>
                  <tr style="background:#f9f9f9"><td style="padding:8px;color:#555">Deposit (33%)</td><td style="padding:8px">$${(proposalData.depositAmount || 0).toLocaleString()}</td></tr>
                </table>
                ${proposalData.flaggedItems?.length ? `<p style="color:#E07B2A">⚠️ ${proposalData.flaggedItems.length} item(s) flagged for review in the dashboard.</p>` : ''}
                <p>PDF proposal attached. Log in to the admin panel to approve and generate the contract.</p>
              </div>`,
            attachmentPath: pdfPath,
            attachmentName: `Proposal_${shortId}.pdf`,
          });

          console.log(
            `[Email Poller] Job ${shortId} — proposal ready. Total: $${proposalData.totalValue}`,
          );
        }
      } catch (err) {
        console.error(`[Email Poller] Error processing email ${uid}:`, err.message);
        // Still mark as read so we don't retry indefinitely
        try {
          await client.messageFlagsAdd(uid, ['\\Seen']);
        } catch {
          /* ignore */
        }
      }
    }

    await client.logout();
  } catch (err) {
    console.error('[Email Poller] Connection error:', err.message);
    try {
      await client.logout();
    } catch {
      /* ignore */
    }
  }
}

function detectLanguage(text) {
  const ptWords =
    /\b(obrigado|orçamento|proposta|serviço|construção|acabamento|banheiro|quarto|sala)\b/i;
  return ptWords.test(text) ? 'pt-BR' : 'en';
}

function startEmailPolling(intervalMs = 60000) {
  if (!process.env.IMAP_USER || !process.env.IMAP_PASSWORD) {
    console.log('[Email Poller] IMAP_USER / IMAP_PASSWORD not set — email polling disabled');
    return;
  }

  const { processEstimate } = require('./claudeService');
  const { generatePDF } = require('./pdfService');

  console.log(
    `[Email Poller] Started — watching ${process.env.IMAP_USER} every ${intervalMs / 1000}s`,
  );

  // Poll immediately on start, then on interval
  pollOnce(processEstimate, generatePDF).catch((e) =>
    console.error('[Email Poller] Initial poll error:', e.message),
  );
  setInterval(() => {
    pollOnce(processEstimate, generatePDF).catch((e) =>
      console.error('[Email Poller] Poll error:', e.message),
    );
  }, intervalMs);
}

module.exports = { startEmailPolling };
