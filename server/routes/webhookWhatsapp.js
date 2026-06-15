// server/routes/webhookWhatsapp.js
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/database');
const { generateContract } = require('../services/claudeService');
const { sendWhatsApp } = require('../services/whatsappService');
const { generatePDF } = require('../services/pdfService');

const { logAudit } = require('../services/auditService');
const { claimMessage } = require('../services/msgDedup');
const { tickQuoteCounter } = require('../services/assessmentService');
const pdfParse = require('pdf-parse');
const https = require('https');
const http = require('http');
const DEPARTMENTS = require('../../shared/departments.json');

// Download media from Twilio (requires basic auth)
function downloadTwilioMedia(url) {
  return new Promise((resolve, reject) => {
    const accountSid = process.env.TWILIO_LIVE_ACCOUNT_SID || process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_LIVE_AUTH_TOKEN || process.env.TWILIO_AUTH_TOKEN;
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { headers: { Authorization: `Basic ${auth}` } }, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        return downloadTwilioMedia(res.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () =>
        resolve({ buffer: Buffer.concat(chunks), contentType: res.headers['content-type'] || '' }),
      );
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

// Submit a new estimate from WhatsApp (PDF, image, or text)
// existingJobId: pass if a job record was already created (smart-detect flow)
async function handleNewEstimateSubmission(
  rawText,
  from,
  db,
  sender,
  senderName,
  language,
  existingJobId = null,
) {
  const isPortuguese = language === 'pt-BR';
  const jobId = existingJobId || uuidv4();
  const shortId = jobId.slice(0, 8).toUpperCase();

  if (!existingJobId) {
    db.prepare(
      `INSERT INTO jobs (id, raw_estimate_data, status, submitted_by) VALUES (?, ?, 'received', ?)`,
    ).run(jobId, rawText, from);
    logAudit(jobId, 'estimate_received', `WhatsApp submission from ${senderName}`, from);
  }

  await sendWhatsApp(
    from,
    isPortuguese
      ? `👍 Recebi, ${senderName}! Analisando o orçamento agora... (Ref #${shortId})`
      : `👍 Got it, ${senderName}! Analyzing the estimate now... (Ref #${shortId})`,
  );

  db.prepare('UPDATE jobs SET status = ? WHERE id = ?').run('processing', jobId);

  const { processEstimate } = require('../services/claudeService');
  const proposalData = await processEstimate(rawText, jobId, language);

  if (!proposalData.readyToGenerate && proposalData.clarificationsNeeded?.length > 0) {
    const insertQ = db.prepare('INSERT INTO clarifications (job_id, question) VALUES (?, ?)');
    for (const q of proposalData.clarificationsNeeded) insertQ.run(jobId, q);

    db.prepare('UPDATE jobs SET status = ?, proposal_data = ? WHERE id = ?').run(
      'awaiting_start',
      JSON.stringify(proposalData),
      jobId,
    );

    const questionCount = proposalData.clarificationsNeeded.length;
    const customerName = proposalData.customer?.name;
    const customerLabel = customerName ? ` para *${customerName}*` : '';

    await sendWhatsApp(
      from,
      isPortuguese
        ? `📋 Orçamento #${shortId}${customerLabel} recebido!\n\nTenho ${questionCount} pergunta${questionCount !== 1 ? 's' : ''} antes de gerar a proposta. Responda *SIM* para começarmos!`
        : `📋 Estimate #${shortId}${customerName ? ` for *${customerName}*` : ''} received!\n\nI have ${questionCount} question${questionCount !== 1 ? 's' : ''} before I can generate the proposal. Reply *YES* and let's get started!`,
    );
  } else {
    // Ready — generate straight away
    const pdfPath = await generatePDF(proposalData, 'proposal', jobId);
    db.prepare(
      'UPDATE jobs SET proposal_data = ?, proposal_pdf_path = ?, total_value = ?, deposit_amount = ?, status = ? WHERE id = ?',
    ).run(
      JSON.stringify(proposalData),
      pdfPath,
      proposalData.totalValue,
      proposalData.depositAmount,
      'proposal_sent',
      jobId,
    );
    tickQuoteCounter(db);

    await sendWhatsApp(
      from,
      isPortuguese
        ? `✅ Proposta pronta, ${senderName}!\n\nCliente: ${proposalData.customer?.name || 'N/A'}\nTotal: $${proposalData.totalValue?.toLocaleString()}\nDepósito: $${proposalData.depositAmount?.toLocaleString()}\n\nResponda *APROVAR* para gerar o contrato.`
        : `✅ Proposal ready, ${senderName}!\n\nCustomer: ${proposalData.customer?.name || 'N/A'}\nTotal: $${proposalData.totalValue?.toLocaleString()}\nDeposit: $${proposalData.depositAmount?.toLocaleString()}\n\nReply *APPROVE* to generate the contract.`,
      pdfPath,
    );
  }
}

// Extract first name from full name
function firstName(fullName) {
  if (!fullName) return 'there';
  return fullName.split(' ')[0];
}

// Detect affirmative responses (yes / sim / sure / yeah / yep / ok / go)
function isYes(text) {
  return /^(yes|yep|yeah|sure|ok|okay|go|ready|sim|claro|pode|bora|vamos|s|y)\b/i.test(text.trim());
}

// Detect negative responses
function isNo(text) {
  return /^(no|nope|not now|later|nao|não|n)\b/i.test(text.trim());
}

async function handleIncomingWhatsApp(data) {
  try {
    const from = data.From;
    const body = (data.Body || '').trim();
    const mediaUrl = data.MediaUrl0;
    const mediaContentType = data.MediaContentType0 || '';

    console.log('WhatsApp processing:', {
      From: from,
      Body: body?.substring(0, 50),
      hasMedia: !!mediaUrl,
    });

    const db = getDb();
    const sender = db
      .prepare('SELECT * FROM approved_senders WHERE identifier = ? AND active = 1')
      .get(from);
    if (!sender) {
      console.warn(`Blocked WhatsApp from unapproved number: ${from}`);
      return;
    }

    const senderName = firstName(sender.name);
    const language = sender.language || 'en';
    const isPortuguese = language === 'pt-BR';
    const upperBody = body.toUpperCase().trim();

    // ── IMAGE ATTACHMENT — Claude vision reads photo, then asks YES/NO ─
    if (mediaUrl && mediaContentType.startsWith('image/')) {
      try {
        await sendWhatsApp(
          from,
          isPortuguese
            ? `📸 Recebi a foto, ${senderName}! Lendo com IA... aguarde.`
            : `📸 Got the photo, ${senderName}! Reading with AI — one moment.`,
        );
        const { buffer } = await downloadTwilioMedia(mediaUrl);
        const base64 = buffer.toString('base64');

        const Anthropic = require('@anthropic-ai/sdk');
        const visionClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const visionRes = await visionClient.messages.create({
          model: 'claude-sonnet-4-5',
          max_tokens: 3000,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: { type: 'base64', media_type: mediaContentType, data: base64 },
                },
                {
                  type: 'text',
                  text: 'This is a construction estimate or invoice photo. Extract ALL visible text, numbers, line items, dollar amounts, trade names, customer info, and addresses exactly as they appear. Return plain text.',
                },
              ],
            },
          ],
        });
        const rawText = visionRes.content[0].text.trim();
        if (rawText.length < 30) {
          await sendWhatsApp(
            from,
            isPortuguese
              ? `⚠️ Não consegui ler o texto da imagem. Tente uma foto mais nítida ou envie como PDF.`
              : `⚠️ Couldn't read text from that image. Try a clearer photo or send it as a PDF.`,
          );
          return;
        }
        const tempId = uuidv4();
        const shortId = tempId.slice(0, 8).toUpperCase();
        db.prepare(
          `INSERT INTO jobs (id, raw_estimate_data, status, submitted_by) VALUES (?, ?, 'awaiting_start', ?)`,
        ).run(tempId, rawText, from);
        await sendWhatsApp(
          from,
          isPortuguese
            ? `✅ Li a imagem! Pré-orçamento *#${shortId}* pronto.\n\nQuer que eu processe e gere uma proposta?\nResponda *SIM* para processar ou *NÃO* para cancelar.`
            : `✅ Read the image! Pre-quote *#${shortId}* is ready.\n\nWant me to process it and generate a proposal?\nReply *YES* to process or *NO* to cancel.`,
        );
      } catch (err) {
        console.error('Image vision error:', err);
        await sendWhatsApp(
          from,
          isPortuguese
            ? `❌ Erro ao processar a imagem. Tente novamente ou envie como PDF.`
            : `❌ Error processing the image. Try again or send it as a PDF.`,
        );
      }
      return;
    }

    // ── PDF / DOCUMENT ATTACHMENT — extract text with pdf-parse, fall back to Claude vision ──
    if (
      mediaUrl &&
      (mediaContentType.includes('pdf') || mediaContentType.includes('application'))
    ) {
      try {
        await sendWhatsApp(
          from,
          isPortuguese
            ? `📎 Recebi o documento, ${senderName}! Extraindo o texto... aguarde.`
            : `📎 Got the document, ${senderName}! Extracting text — one moment.`,
        );
        const { buffer } = await downloadTwilioMedia(mediaUrl);

        // ── Step 1: try pdf-parse (fast, works on text-based PDFs)
        let rawText = '';
        try {
          const parsed = await pdfParse(buffer);
          rawText = parsed.text.trim();
        } catch {
          /* not a text PDF — fall through to Claude vision */
        }

        // ── Step 2: if pdf-parse came up empty (scanned/image PDF or non-PDF doc),
        //    use Claude's native document reading — handles both kinds of PDFs and
        //    most other document formats
        if (rawText.length < 50) {
          console.log('[WhatsApp] pdf-parse empty — trying Claude document vision');
          const Anthropic = require('@anthropic-ai/sdk');
          const docClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
          const base64 = buffer.toString('base64');
          const docMime = mediaContentType.includes('pdf') ? 'application/pdf' : mediaContentType;
          const visionRes = await docClient.messages.create({
            model: 'claude-sonnet-4-5',
            max_tokens: 4000,
            messages: [
              {
                role: 'user',
                content: [
                  {
                    type: 'document',
                    source: { type: 'base64', media_type: docMime, data: base64 },
                  },
                  {
                    type: 'text',
                    text: 'This is a construction estimate or scope-of-work document. Extract ALL visible text, numbers, line items, dollar amounts, trade names, customer info, and addresses exactly as they appear. Return plain text only.',
                  },
                ],
              },
            ],
          });
          rawText = visionRes.content[0].text.trim();
        }

        if (rawText.length < 50) {
          await sendWhatsApp(
            from,
            isPortuguese
              ? `⚠️ Não consegui extrair texto do documento. Tente enviar como PDF pesquisável ou foto.`
              : `⚠️ Couldn't extract text from that document. Try sending a searchable PDF or a photo instead.`,
          );
          return;
        }

        const tempId = uuidv4();
        const shortId = tempId.slice(0, 8).toUpperCase();
        db.prepare(
          `INSERT INTO jobs (id, raw_estimate_data, status, submitted_by) VALUES (?, ?, 'awaiting_start', ?)`,
        ).run(tempId, rawText, from);
        await sendWhatsApp(
          from,
          isPortuguese
            ? `✅ Documento lido! Pré-orçamento *#${shortId}* pronto.\n\nQuer que eu processe e gere uma proposta?\nResponda *SIM* para processar ou *NÃO* para cancelar.`
            : `✅ Document read! Pre-quote *#${shortId}* is ready.\n\nWant me to process it and generate a proposal?\nReply *YES* to process or *NO* to cancel.`,
        );
      } catch (err) {
        console.error('Document attachment error:', err);
        await sendWhatsApp(
          from,
          isPortuguese
            ? `❌ Erro ao processar o documento. Tente novamente ou cole o texto do orçamento.`
            : `❌ Error processing the document. Try again or paste the estimate text directly.`,
        );
      }
      return;
    }

    // ── NEW: command — submit estimate as text ────────────────────────
    if (
      upperBody.startsWith('NEW:') ||
      upperBody.startsWith('NOVO:') ||
      upperBody.startsWith('ESTIMATE:')
    ) {
      const rawText = body.substring(body.indexOf(':') + 1).trim();
      if (rawText.length < 20) {
        await sendWhatsApp(
          from,
          isPortuguese
            ? `⚠️ Por favor inclua os detalhes do orçamento após NOVO: — ex: *NOVO: Cliente João, banheiro completo, 150 sqft, azulejo, vanity...*`
            : `⚠️ Please include the estimate details after NEW: — e.g. *NEW: Client John Smith, full bathroom remodel, 150 sqft, tile, vanity...*`,
        );
        return;
      }
      // Create job record first, then route through trade selection before AI processing
      const newJobId = uuidv4();
      db.prepare(
        `INSERT INTO jobs (id, raw_estimate_data, status, submitted_by) VALUES (?, ?, 'received', ?)`,
      ).run(newJobId, rawText, from);
      logAudit(newJobId, 'estimate_received', `WhatsApp submission from ${senderName}`, from);
      const newJob = db.prepare('SELECT * FROM jobs WHERE id = ?').get(newJobId);
      await startTradeSelection(newJob, from, db, language, senderName);
      return;
    }

    // Find any active job for this sender (includes awaiting_start now)
    const activeJob = db
      .prepare(
        `
      SELECT * FROM jobs 
      WHERE (submitted_by = ? OR submitted_by = 'hearth_api')
      AND status IN ('awaiting_start', 'trade_selection_dept', 'trade_selection_sub', 'clarification', 'proposal_ready', 'proposal_sent')
      ORDER BY created_at DESC LIMIT 1
    `,
      )
      .get(sender.role === 'pm' ? 'hearth_api' : sender.identifier);

    // ── APPROVE ──────────────────────────────────────────────────────
    if (upperBody === 'APROVAR' || upperBody === 'APPROVE') {
      if (!activeJob) {
        await sendWhatsApp(
          from,
          isPortuguese
            ? `⚠️ Nenhuma proposta encontrada aguardando aprovação.`
            : `⚠️ No proposal found waiting for approval.`,
        );
        return;
      }
      await handleApproval(activeJob, from, db, language, senderName);
      return;
    }

    // ── REVISE ───────────────────────────────────────────────────────
    if (upperBody === 'REVISAR' || upperBody === 'REVISE') {
      await sendWhatsApp(
        from,
        isPortuguese
          ? `✏️ Claro, ${senderName}! O que você gostaria de alterar na proposta?\n\nDescreva as mudanças e eu vou regenerar.`
          : `✏️ Sure, ${senderName}! What would you like to change in the proposal?\n\nDescribe the changes and I'll regenerate it.`,
      );
      return;
    }

    if (upperBody.startsWith('REVISAR:') || upperBody.startsWith('REVISE:')) {
      const changes = body.substring(body.indexOf(':') + 1).trim();
      if (activeJob) {
        await handleRevision(activeJob, changes, from, db, language, senderName);
      }
      return;
    }

    // ── STATUS ───────────────────────────────────────────────────────
    if (upperBody === 'STATUS') {
      const jobs = db
        .prepare(
          `
        SELECT customer_name, project_address, total_value, status, created_at 
        FROM jobs ORDER BY created_at DESC LIMIT 5
      `,
        )
        .all();

      const statusEmoji = {
        awaiting_start: '⏳',
        clarification: '❓',
        proposal_ready: '📄',
        proposal_sent: '📤',
        customer_approved: '✅',
        contract_ready: '📋',
      };
      const lines = jobs.map(
        (j) =>
          `${statusEmoji[j.status] || '•'} ${j.customer_name || 'Unknown'} — ${j.status} — $${j.total_value?.toLocaleString() || 'TBD'}`,
      );

      await sendWhatsApp(
        from,
        isPortuguese
          ? `📊 *Últimos Jobs, ${senderName}:*\n\n${lines.join('\n')}`
          : `📊 *Recent Jobs, ${senderName}:*\n\n${lines.join('\n')}`,
      );
      return;
    }

    // ── HELP ─────────────────────────────────────────────────────────
    if (upperBody === 'HELP' || upperBody === 'AJUDA') {
      await sendWhatsApp(
        from,
        isPortuguese
          ? `🤖 *Olá ${senderName}! Comandos disponíveis:*\n\n📎 *Envie um PDF* — Enviar orçamento como PDF diretamente\nNOVO: [detalhes] — Enviar orçamento como texto\nSIM — Iniciar perguntas de clarificação\nAPROVAR — Aprovar proposta atual\nREVISAR — Revisar proposta\nREVISAR: [mudanças] — Revisar com detalhes\nSTATUS — Ver jobs recentes\nAJUDA — Este menu\n\nOu simplesmente escreva sua pergunta!`
          : `🤖 *Hey ${senderName}! Available commands:*\n\n📎 *Send a PDF* — Attach estimate PDF directly\nNEW: [details] — Submit estimate as text\nYES — Start clarification questions\nAPPROVE — Approve current proposal\nREVISE — Revise proposal\nREVISE: [changes] — Revise with details\nSTATUS — View recent jobs\nHELP — This menu\n\nOr just type your question!`,
      );
      return;
    }

    // ── AWAITING START — waiting for yes/no to begin questions ───────
    if (activeJob && activeJob.status === 'awaiting_start') {
      if (isYes(body)) {
        // Before processing, ask the user to select trades
        await startTradeSelection(activeJob, from, db, language, senderName);
      } else if (isNo(body)) {
        const shortId = activeJob.id.slice(0, 8).toUpperCase();
        await sendWhatsApp(
          from,
          isPortuguese
            ? `Tudo bem, ${senderName}! Quando quiser continuar, me responda *SIM* e pegamos de onde paramos. O pré-orçamento #${shortId} está aguardando.`
            : `No problem, ${senderName}! Just reply *YES* when you're ready and we'll pick right up. Pre-quote #${shortId} is waiting for you.`,
        );
      } else {
        // Ambiguous — re-prompt
        const shortId = activeJob.id.slice(0, 8).toUpperCase();
        await sendWhatsApp(
          from,
          isPortuguese
            ? `Ei ${senderName}, tenho um pré-orçamento (#${shortId}) esperando. Responda *SIM* quando tiver um momento para trabalharmos juntos nisso!`
            : `Hey ${senderName}, I have pre-quote #${shortId} waiting. Reply *YES* when you have a moment and we'll work through it together!`,
        );
      }
      return;
    }

    // ── TRADE SELECTION — department selection step ───────────────────
    if (activeJob && activeJob.status === 'trade_selection_dept') {
      await handleTradeSelectionDept(activeJob, body, from, db, language, senderName, sender);
      return;
    }

    // ── TRADE SELECTION — sub-department selection step ───────────────
    if (activeJob && activeJob.status === 'trade_selection_sub') {
      await handleTradeSelectionSub(activeJob, body, from, db, language, senderName, sender);
      return;
    }

    // ── CLARIFICATION REPLY — answering questions one at a time ──────
    if (activeJob && activeJob.status === 'clarification') {
      await handleClarificationReply(activeJob, body, from, db, language, senderName);
      return;
    }

    // ── SMART TEXT DETECTION — long text with no active job ───────────
    // If no active job, message is long, and looks like construction estimate text
    if (!activeJob && body.length > 200) {
      const estimateKeywords =
        /\$[\d,]+|sq\.?\s*ft|square feet|demo|framing|drywall|plumbing|electrical|roofing|siding|hvac|concrete|foundation|insulation|permit|labor|materials|trade|subcontractor|estimate|proposal|scope/i;
      if (estimateKeywords.test(body)) {
        await sendWhatsApp(
          from,
          isPortuguese
            ? `📋 Ei ${senderName}, isso parece um orçamento! Quer que eu processe e gere uma proposta?\n\nResponda *SIM* para processar ou *NÃO* para continuar a conversa.`
            : `📋 Hey ${senderName}, that looks like it might be an estimate! Want me to process it and generate a proposal?\n\nReply *YES* to process it or *NO* to just chat.`,
        );
        // Save the text temporarily in DB as a pending job so we can grab it if they say yes
        const { v4: uuidv4 } = require('uuid');
        const tempJobId = uuidv4();
        db.prepare(
          `INSERT INTO jobs (id, raw_estimate_data, status, submitted_by) VALUES (?, ?, 'awaiting_start', ?)`,
        ).run(tempJobId, body, from);
        return;
      }
    }

    // ── GENERAL CHAT ─────────────────────────────────────────────────
    const { adminChat } = require('../services/claudeService');

    const history = db
      .prepare(
        `
      SELECT direction, message FROM conversations 
      WHERE job_id = ? AND channel = 'whatsapp'
      ORDER BY created_at DESC LIMIT 10
    `,
      )
      .all(activeJob?.id || 'general');

    const messages = history.reverse().map((h) => ({
      role: h.direction === 'inbound' ? 'user' : 'assistant',
      content: h.message,
    }));

    let userMessage = body;
    if (activeJob) {
      userMessage = `[Context: Active job for ${activeJob.customer_name || 'unknown customer'} at ${activeJob.project_address || 'unknown address'}, status: ${activeJob.status}, estimate data: ${(activeJob.raw_estimate_data || '').substring(0, 500)}]\n\n${body}`;
    }
    messages.push({ role: 'user', content: userMessage });

    const { reply: replyText } = await adminChat(messages, language, null, sender);
    await sendWhatsApp(from, replyText);

    if (activeJob) {
      logConversation(db, activeJob.id, 'inbound', 'whatsapp', from, 'bot', body);
      logConversation(db, activeJob.id, 'outbound', 'whatsapp', 'bot', from, replyText);
    }
  } catch (err) {
    console.error('WhatsApp handler error:', err);
  }
}

router.post('/', async (req, res) => {
  res.set('Content-Type', 'text/xml');
  res.send('<Response></Response>');

  if (process.env.DISABLE_WHATSAPP_WEBHOOK === 'true') {
    console.log(
      '📵 WhatsApp webhook disabled (DISABLE_WHATSAPP_WEBHOOK=true) — ignoring incoming message',
    );
    return;
  }

  const sid = req.body.MessageSid;
  if (sid && !claimMessage(sid)) {
    console.log(`WhatsApp webhook: skipping already-processed ${sid}`);
    return;
  }

  console.log('WhatsApp webhook received:', {
    From: req.body.From,
    Body: req.body.Body?.substring(0, 50),
  });
  await handleIncomingWhatsApp(req.body);
});

// ── APPROVAL ─────────────────────────────────────────────────────────────
async function handleApproval(job, from, db, language, senderName) {
  const isPortuguese = language === 'pt-BR';

  db.prepare('UPDATE jobs SET status = ? WHERE id = ?').run('customer_approved', job.id);
  logAudit(job.id, 'proposal_approved', 'Approved via WhatsApp', from);

  await sendWhatsApp(
    from,
    isPortuguese
      ? `✅ Perfeito, ${senderName}! Gerando o contrato completo agora...\n\nIsso leva cerca de 1 minuto.`
      : `✅ Perfect, ${senderName}! Generating the full contract now...\n\nThis takes about a minute.`,
  );

  try {
    const proposalData = JSON.parse(job.proposal_data);
    const contractData = await generateContract(proposalData, job.id, language);

    const contractPDF = await generatePDF(contractData, 'contract', job.id);
    db.prepare(
      'UPDATE jobs SET contract_data = ?, contract_pdf_path = ?, status = ? WHERE id = ?',
    ).run(JSON.stringify(contractData), contractPDF, 'contract_ready', job.id);

    const summary = isPortuguese
      ? `📄 *Contrato pronto, ${senderName}!*\n\n` +
        `Cliente: ${job.customer_name}\n` +
        `Total: $${contractData.totalValue?.toLocaleString()}\n` +
        `Depósito: $${contractData.depositAmount?.toLocaleString()}\n\n` +
        `Pronto para enviar ao cliente. ✅`
      : `📄 *Contract ready, ${senderName}!*\n\n` +
        `Customer: ${job.customer_name}\n` +
        `Total: $${contractData.totalValue?.toLocaleString()}\n` +
        `Deposit: $${contractData.depositAmount?.toLocaleString()}\n\n` +
        `Ready to send to the customer. ✅`;

    await sendWhatsApp(from, summary, contractPDF);
    if (process.env.OWNER_WHATSAPP && from !== process.env.OWNER_WHATSAPP) {
      const ownerSender = db
        .prepare('SELECT * FROM approved_senders WHERE identifier = ? AND active = 1')
        .get(process.env.OWNER_WHATSAPP);
      const ownerName = firstName(ownerSender?.name || 'Cooper');
      await sendWhatsApp(
        process.env.OWNER_WHATSAPP,
        `Hey ${ownerName}! 📄 Contract generated for *${job.customer_name}* — $${contractData.totalValue?.toLocaleString()}. All good!`,
        contractPDF,
      );
    }

    logAudit(
      job.id,
      'contract_generated',
      `Contract ready. Total: $${contractData.totalValue}`,
      'bot',
    );
  } catch (err) {
    console.error('Contract generation error:', err);
    await sendWhatsApp(
      from,
      isPortuguese
        ? `❌ Erro ao gerar o contrato. Tente novamente ou acesse o painel de administração.`
        : `❌ Error generating the contract. Please try again or check the admin panel.`,
    );
  }
}

// ── CLARIFICATION REPLY — one question at a time with confirmation ────────
async function handleClarificationReply(job, answer, from, db, language, senderName) {
  const isPortuguese = language === 'pt-BR';

  // Save the answer to the current pending question
  const pending = db
    .prepare(
      'SELECT * FROM clarifications WHERE job_id = ? AND answer IS NULL ORDER BY asked_at ASC LIMIT 1',
    )
    .get(job.id);

  if (pending) {
    db.prepare(
      'UPDATE clarifications SET answer = ?, answered_at = CURRENT_TIMESTAMP WHERE id = ?',
    ).run(answer, pending.id);
  }

  const remaining = db
    .prepare('SELECT COUNT(*) as count FROM clarifications WHERE job_id = ? AND answer IS NULL')
    .get(job.id);

  const totalQ = db
    .prepare('SELECT COUNT(*) as count FROM clarifications WHERE job_id = ?')
    .get(job.id);
  const answeredCount = totalQ.count - remaining.count;

  if (remaining.count === 0) {
    // All answered — generate proposal
    const confirmation = isPortuguese
      ? `✅ Anotei: *"${answer}"*\n\nPerfeito, ${senderName}! Isso é tudo que eu precisava. Gerando a proposta agora...`
      : `✅ Got it! I wrote down: *"${answer}"*\n\nThat's everything I needed, ${senderName}! Generating the proposal now...`;

    await sendWhatsApp(from, confirmation);
    await finishClarifications(job, from, db, language, senderName);
  } else {
    // Ask next question with confirmation of what was just received
    const nextQ = db
      .prepare(
        'SELECT * FROM clarifications WHERE job_id = ? AND answer IS NULL ORDER BY asked_at ASC LIMIT 1',
      )
      .get(job.id);

    const confirmation = isPortuguese
      ? `✅ Anotei: *"${answer}"*\n\n❓ Pergunta ${answeredCount + 1} de ${totalQ.count}:\n${nextQ.question}`
      : `✅ Got it! I wrote down: *"${answer}"*\n\n❓ Question ${answeredCount + 1} of ${totalQ.count}:\n${nextQ.question}`;

    await sendWhatsApp(from, confirmation);
  }
}

// ── FINISH CLARIFICATIONS — reprocess and generate proposal ───────────────
async function finishClarifications(job, from, db, language, senderName) {
  const isPortuguese = language === 'pt-BR';

  try {
    const allAnswers = db
      .prepare('SELECT question, answer FROM clarifications WHERE job_id = ?')
      .all(job.id);
    const answersText = allAnswers.map((a) => `Q: ${a.question}\nA: ${a.answer}`).join('\n\n');
    const rawEstimate = job.raw_estimate_data || '';

    const { processEstimate } = require('../services/claudeService');
    const proposalData = await processEstimate(
      `${rawEstimate}\n\nCLARIFICATION ANSWERS:\n${answersText}`,
      job.id,
      language,
    );

    const pdfPath = await generatePDF(proposalData, 'proposal', job.id);

    db.prepare(
      'UPDATE jobs SET proposal_data = ?, proposal_pdf_path = ?, total_value = ?, deposit_amount = ?, status = ? WHERE id = ?',
    ).run(
      JSON.stringify(proposalData),
      pdfPath,
      proposalData.totalValue,
      proposalData.depositAmount,
      'proposal_sent',
      job.id,
    );
    tickQuoteCounter(db);

    const shortId = job.id.slice(0, 8).toUpperCase();

    const msg = isPortuguese
      ? `🎉 *Proposta pronta, ${senderName}!*\n\n` +
        `📋 Pré-orçamento #${shortId}\n` +
        `Cliente: ${job.customer_name || 'N/A'}\n` +
        `💰 Total: $${proposalData.totalValue?.toLocaleString()}\n` +
        `📦 Depósito: $${proposalData.depositAmount?.toLocaleString()}\n\n` +
        `Responda *APROVAR* para gerar o contrato ou *REVISAR* para fazer alterações.`
      : `🎉 *Proposal ready, ${senderName}!*\n\n` +
        `📋 Pre-quote #${shortId}\n` +
        `Customer: ${job.customer_name || 'N/A'}\n` +
        `💰 Total: $${proposalData.totalValue?.toLocaleString()}\n` +
        `📦 Deposit: $${proposalData.depositAmount?.toLocaleString()}\n\n` +
        `Reply *APPROVE* to generate the contract or *REVISE* to make changes.`;

    await sendWhatsApp(from, msg, pdfPath);

    // Notify owner if different from sender
    if (process.env.OWNER_WHATSAPP && from !== process.env.OWNER_WHATSAPP) {
      const ownerSender = db
        .prepare('SELECT * FROM approved_senders WHERE identifier = ? AND active = 1')
        .get(process.env.OWNER_WHATSAPP);
      const ownerName = firstName(ownerSender?.name || 'Cooper');
      await sendWhatsApp(
        process.env.OWNER_WHATSAPP,
        `Hey ${ownerName}! 📋 Proposal ready for *${job.customer_name}* — $${proposalData.totalValue?.toLocaleString()}. Waiting on approval.`,
        pdfPath,
      );
    }
  } catch (err) {
    console.error('Error finishing clarifications:', err);
    await sendWhatsApp(
      from,
      isPortuguese
        ? `❌ Erro ao gerar a proposta. Tente novamente.`
        : `❌ Error generating the proposal. Please try again.`,
    );
  }
}

// ── REVISION ─────────────────────────────────────────────────────────────
async function handleRevision(job, changes, from, db, language, senderName) {
  const isPortuguese = language === 'pt-BR';
  db.prepare('UPDATE jobs SET status = ? WHERE id = ?').run('processing', job.id);

  await sendWhatsApp(
    from,
    isPortuguese
      ? `✏️ Entendido, ${senderName}! Revisando a proposta com as suas alterações...`
      : `✏️ On it, ${senderName}! Revising the proposal with your changes...`,
  );

  const rawEstimate = job.raw_estimate_data || '';
  const { processEstimate } = require('../services/claudeService');
  const revised = await processEstimate(
    `${rawEstimate}\n\nREVISION REQUESTED:\n${changes}`,
    job.id,
    language,
  );

  const pdfPath = await generatePDF(revised, 'proposal', job.id);

  db.prepare(
    'UPDATE jobs SET proposal_data = ?, proposal_pdf_path = ?, total_value = ?, deposit_amount = ?, status = ? WHERE id = ?',
  ).run(
    JSON.stringify(revised),
    pdfPath,
    revised.totalValue,
    revised.depositAmount,
    'proposal_sent',
    job.id,
  );

  await sendWhatsApp(
    from,
    isPortuguese
      ? `✅ Proposta revisada, ${senderName}!\nTotal atualizado: $${revised.totalValue?.toLocaleString()}\n\nResponda *APROVAR* para gerar o contrato.`
      : `✅ Revised proposal ready, ${senderName}!\nUpdated total: $${revised.totalValue?.toLocaleString()}\n\nReply *APPROVE* to generate the contract.`,
    pdfPath,
  );
}

function logConversation(db, jobId, direction, channel, from, to, message) {
  db.prepare(
    `
    INSERT INTO conversations (job_id, direction, channel, from_address, to_address, message)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
  ).run(jobId, direction, channel, from, to, message);
}

// ── TRADE SELECTION HELPERS ───────────────────────────────────────────────

function buildDeptListMessage(isPortuguese) {
  const lines = DEPARTMENTS.map((d, i) => `${i + 1}. ${d.name}`);
  const header = isPortuguese
    ? `🔨 *Quais departamentos se aplicam a este projeto?*\nResponda com os números separados por vírgula (ex: *1, 3, 5*) ou *PULAR* para continuar sem selecionar.`
    : `🔨 *Which trade departments apply to this project?*\nReply with the numbers separated by commas (e.g. *1, 3, 5*) or *SKIP* to continue without selecting.`;
  return `${header}\n\n${lines.join('\n')}`;
}

function buildSubListMessage(selectedDeptIndexes, isPortuguese) {
  const header = isPortuguese
    ? `✅ Departamentos selecionados. Agora escolha os *sub-departamentos* que se aplicam:\nResponda com os números separados por vírgula ou *PULAR* para continuar.`
    : `✅ Departments selected. Now choose the *sub-departments* that apply:\nReply with the numbers separated by commas or *SKIP* to continue.`;

  const lines = [];
  let idx = 1;
  for (const di of selectedDeptIndexes) {
    const dept = DEPARTMENTS[di];
    if (!dept) continue;
    lines.push(`*${dept.name}*`);
    for (const sub of dept.subDepartments) {
      lines.push(`  ${idx}. ${sub.name}`);
      idx++;
    }
  }
  return `${header}\n\n${lines.join('\n')}`;
}

function parseNumberList(text) {
  return text
    .split(/[,\s]+/)
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n) && n > 0);
}

function buildTradesNarrativeFromSubs(selectedSubs) {
  if (!selectedSubs || selectedSubs.length === 0) return '';
  const lines = selectedSubs.map((s) => `- ${s.name} (${s.deptName}): ${s.meaning}`);
  return `\n\nEXPLICITLY SELECTED TRADES (user-confirmed via WhatsApp):\n${lines.join('\n')}\nUse this list to calibrate line items and pricing — these trades are confirmed to be in scope.`;
}

async function sendMobileTradeSelectLink(job, from, db, language, _senderName) {
  const isPortuguese = language === 'pt-BR';
  const { v4: uuidv4 } = require('uuid');
  const token = uuidv4();

  let meta = {};
  try {
    meta = JSON.parse(job.metadata || '{}');
  } catch {
    /* ignore */
  }
  meta.tradeSelectToken = token;
  meta.tradeSelectDone = false;

  db.prepare('UPDATE jobs SET status = ?, metadata = ? WHERE id = ?').run(
    'trade_selection_sub',
    JSON.stringify(meta),
    job.id,
  );

  const baseUrl =
    process.env.APP_URL ||
    (process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : 'http://localhost:5000');
  const link = `${baseUrl}/trade-select/${token}`;

  await sendWhatsApp(
    from,
    isPortuguese
      ? `📱 Muitos departamentos selecionados! Use este link para escolher os sub-departamentos:\n\n${link}\n\nApós enviar, o orçamento será processado automaticamente.`
      : `📱 You selected quite a few departments! Use this link to pick the specific sub-departments:\n\n${link}\n\nAfter you submit, the estimate will be processed automatically.`,
  );
}

async function startTradeSelection(job, from, db, language, senderName) {
  const isPortuguese = language === 'pt-BR';
  const shortId = job.id.slice(0, 8).toUpperCase();

  db.prepare('UPDATE jobs SET status = ? WHERE id = ?').run('trade_selection_dept', job.id);

  const intro = isPortuguese
    ? `Ótimo, ${senderName}! Antes de processar o pré-orçamento #${shortId}, me diga quais *departamentos de trade* estão envolvidos neste projeto.`
    : `Great, ${senderName}! Before I process pre-quote #${shortId}, let me know which *trade departments* are involved in this project.`;

  await sendWhatsApp(from, `${intro}\n\n${buildDeptListMessage(isPortuguese)}`);
}

async function handleTradeSelectionDept(job, body, from, db, language, senderName, sender) {
  const isPortuguese = language === 'pt-BR';
  const upperBody = body.toUpperCase().trim();

  if (upperBody === 'SKIP' || upperBody === 'PULAR') {
    await proceedAfterTradeSelection(job, [], from, db, language, senderName, sender);
    return;
  }

  const nums = parseNumberList(body);
  const validNums = nums.filter((n) => n >= 1 && n <= DEPARTMENTS.length);

  if (validNums.length === 0) {
    await sendWhatsApp(
      from,
      isPortuguese
        ? `⚠️ Não entendi. Responda com os números dos departamentos (ex: *1, 3, 5*) ou *PULAR* para continuar.`
        : `⚠️ I didn't catch that. Reply with the department numbers (e.g. *1, 3, 5*) or *SKIP* to continue.`,
    );
    return;
  }

  const selectedDeptIndexes = validNums.map((n) => n - 1);
  const totalSubs = selectedDeptIndexes.reduce(
    (acc, di) => acc + (DEPARTMENTS[di]?.subDepartments?.length || 0),
    0,
  );

  if (totalSubs === 0) {
    await proceedAfterTradeSelection(job, [], from, db, language, senderName, sender);
    return;
  }

  // If the sub-department list would be unwieldy (more than 12 items), send a mobile link instead
  if (totalSubs > 12) {
    await sendMobileTradeSelectLink(job, from, db, language, senderName);
    return;
  }

  const meta = { selectedDeptIndexes };
  db.prepare('UPDATE jobs SET status = ?, metadata = ? WHERE id = ?').run(
    'trade_selection_sub',
    JSON.stringify(meta),
    job.id,
  );

  await sendWhatsApp(from, buildSubListMessage(selectedDeptIndexes, isPortuguese));
}

async function handleTradeSelectionSub(job, body, from, db, language, senderName, sender) {
  const isPortuguese = language === 'pt-BR';
  const upperBody = body.toUpperCase().trim();

  let meta = {};
  try {
    meta = JSON.parse(job.metadata || '{}');
  } catch {
    /* ignore */
  }

  if (upperBody === 'SKIP' || upperBody === 'PULAR') {
    await proceedAfterTradeSelection(job, [], from, db, language, senderName, sender);
    return;
  }

  // If this job is using the mobile link flow (token present), wait for the web submission
  if (meta.tradeSelectToken && !meta.tradeSelectDone) {
    await sendWhatsApp(
      from,
      isPortuguese
        ? `⏳ Aguardando sua seleção pelo link enviado. Complete a seleção no link ou responda *PULAR* para continuar sem selecionar.`
        : `⏳ Waiting for your selection via the link I sent. Complete your selection there, or reply *SKIP* to continue without selecting.`,
    );
    return;
  }

  const selectedDeptIndexes = meta.selectedDeptIndexes || [];

  const nums = parseNumberList(body);

  // Build the sequential sub-department list matching what was shown
  const subList = [];
  for (const di of selectedDeptIndexes) {
    const dept = DEPARTMENTS[di];
    if (!dept) continue;
    for (const sub of dept.subDepartments) {
      subList.push({ ...sub, deptName: dept.name });
    }
  }

  const validNums = nums.filter((n) => n >= 1 && n <= subList.length);

  if (validNums.length === 0) {
    await sendWhatsApp(
      from,
      isPortuguese
        ? `⚠️ Não entendi. Responda com os números dos sub-departamentos ou *PULAR* para continuar.`
        : `⚠️ I didn't catch that. Reply with the sub-department numbers or *SKIP* to continue.`,
    );
    return;
  }

  const selectedSubs = validNums.map((n) => subList[n - 1]).filter(Boolean);
  await proceedAfterTradeSelection(job, selectedSubs, from, db, language, senderName, sender);
}

async function proceedAfterTradeSelection(
  job,
  selectedSubs,
  from,
  db,
  language,
  senderName,
  sender,
) {
  const isPortuguese = language === 'pt-BR';

  const tradesNarrative = buildTradesNarrativeFromSubs(selectedSubs);

  const hasClarifications = db
    .prepare('SELECT COUNT(*) as count FROM clarifications WHERE job_id = ?')
    .get(job.id);
  const firstQ =
    hasClarifications.count > 0
      ? db
          .prepare(
            'SELECT * FROM clarifications WHERE job_id = ? AND answer IS NULL ORDER BY asked_at ASC LIMIT 1',
          )
          .get(job.id)
      : null;

  // Always persist trades narrative into raw_estimate_data so all downstream AI calls
  // (clarifications, finishClarifications, processEstimate) automatically include it.
  if (tradesNarrative) {
    const updatedRaw = (job.raw_estimate_data || '') + tradesNarrative;
    db.prepare('UPDATE jobs SET raw_estimate_data = ? WHERE id = ?').run(updatedRaw, job.id);
    job = { ...job, raw_estimate_data: updatedRaw };
  }

  if (firstQ) {
    db.prepare('UPDATE jobs SET status = ? WHERE id = ?').run('clarification', job.id);
    const shortId = job.id.slice(0, 8).toUpperCase();
    const customerLabel = job.customer_name ? ` for *${job.customer_name}*` : '';

    await sendWhatsApp(
      from,
      isPortuguese
        ? `Ótimo! Vamos começar.\n\n📋 Pré-orçamento #${shortId}${customerLabel}\n\n❓ Pergunta 1 de ${hasClarifications.count}:\n${firstQ.question}`
        : `Got it${selectedSubs.length ? ` — ${selectedSubs.length} trade${selectedSubs.length !== 1 ? 's' : ''} noted` : ''}! Let's go.\n\n📋 Pre-quote #${shortId}${customerLabel}\n\n❓ Question 1 of ${hasClarifications.count}:\n${firstQ.question}`,
    );
  } else {
    db.prepare('UPDATE jobs SET status = ? WHERE id = ?').run('processing', job.id);
    await sendWhatsApp(
      from,
      isPortuguese
        ? `Ótimo! Processando o orçamento agora...`
        : `Got it${selectedSubs.length ? ` — ${selectedSubs.length} trade${selectedSubs.length !== 1 ? 's' : ''} noted` : ''}! Processing the estimate now...`,
    );

    await handleNewEstimateSubmission(
      job.raw_estimate_data,
      from,
      db,
      sender,
      senderName,
      language,
      job.id,
    );
  }
}

module.exports = router;
module.exports.handleIncomingWhatsApp = handleIncomingWhatsApp;
module.exports.proceedAfterTradeSelection = proceedAfterTradeSelection;
