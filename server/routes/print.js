// server/routes/print.js
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getDb } = require('../db/database');
const fs = require('fs');
const { exec } = require('child_process');

// ── GET /api/print/printers — list available printers via PowerShell ─────────
router.get('/printers', requireAuth, (req, res) => {
  const db = getDb();
  const setting = db.prepare("SELECT value FROM settings WHERE key = 'print_printer_name'").get();
  const currentPrinter = setting?.value || '';

  exec(
    'powershell -NoProfile -NonInteractive -Command "Get-Printer | Select-Object -ExpandProperty Name | ConvertTo-Json -Compress"',
    { timeout: 15000 },
    (err, stdout) => {
      if (err) {
        return res.json({
          printers: [],
          currentPrinter,
          warning: 'PowerShell not available in this environment',
        });
      }
      let printers = [];
      try {
        const parsed = JSON.parse(stdout.trim());
        printers = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        // single printer returns a plain string, not an array
        const line = stdout.trim().replace(/^"|"$/g, '');
        if (line) printers = [line];
      }
      res.json({ printers, currentPrinter });
    },
  );
});

// ── POST /api/print/job/:id — send proposal or contract PDF to printer ───────
router.post('/job/:id', requireAuth, async (req, res) => {
  const { docType, printerName } = req.body; // docType: 'proposal' | 'contract'
  if (!docType || !['proposal', 'contract'].includes(docType)) {
    return res.status(400).json({ error: 'docType must be "proposal" or "contract"' });
  }

  const db = getDb();
  const job = db
    .prepare('SELECT proposal_pdf_path, contract_pdf_path, customer_name FROM jobs WHERE id = ?')
    .get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const pdfPath = docType === 'proposal' ? job.proposal_pdf_path : job.contract_pdf_path;
  if (!pdfPath) return res.status(400).json({ error: `No ${docType} PDF available for this job` });
  if (!fs.existsSync(pdfPath))
    return res.status(404).json({ error: `PDF file not found on server: ${pdfPath}` });

  try {
    const printer = require('pdf-to-printer');

    const options = {};
    if (printerName && printerName.trim()) {
      options.printer = printerName.trim();
    } else {
      const setting = db
        .prepare("SELECT value FROM settings WHERE key = 'print_printer_name'")
        .get();
      if (setting?.value && setting.value.trim()) {
        options.printer = setting.value.trim();
      }
    }

    await printer.print(pdfPath, options);

    console.log(
      `[print] Sent ${docType} PDF for job ${req.params.id} to printer "${options.printer || 'default'}"`,
    );
    res.json({
      ok: true,
      printer: options.printer || 'default',
      docType,
      customer: job.customer_name,
    });
  } catch (err) {
    console.error('[print] Print error:', err.message);
    res.status(500).json({ error: `Print failed: ${err.message}` });
  }
});

module.exports = router;
