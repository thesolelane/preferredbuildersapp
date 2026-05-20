// server/services/pdfService.js
// Generates Proposal and Contract PDFs using Puppeteer.
// All HTML template builders live in pdfHtmlBuilder.js.

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const {
  buildContractHTML: buildContractHTMLNew,
  adaptToContractSchema,
  blankContractSchema,
} = require('./contractTemplate');

const { buildProposalHTML, buildNoticeOfContractHTML } = require('./pdfHtmlBuilder');

// Resolve Chromium: prefer env var, then OS-specific paths, then puppeteer bundled
function resolveChromiumPath() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;

  if (process.platform === 'win32') {
    try {
      const p = execSync('where chrome', { timeout: 3000 }).toString().split('\n')[0].trim();
      if (p && fs.existsSync(p)) return p;
    } catch {
      /* ignore */
    }
    const winPaths = [
      'C:\\Users\\theso\\.cache\\puppeteer\\chrome\\win64-146.0.7680.76\\chrome-win64\\chrome.exe',
      'C:\\Users\\theso\\.cache\\puppeteer\\chrome\\win64-127.0.6533.88\\chrome-win64\\chrome.exe',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Users\\theso\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files\\Chromium\\Application\\chrome.exe',
      (process.env.LOCALAPPDATA || '') + '\\Google\\Chrome\\Application\\chrome.exe',
      (process.env.PROGRAMFILES || '') + '\\Google\\Chrome\\Application\\chrome.exe',
    ];
    for (const p of winPaths) {
      try {
        if (p && fs.existsSync(p)) return p;
      } catch {
        /* ignore */
      }
    }
    return undefined;
  }

  try {
    const p = execSync(
      'which chromium 2>/dev/null || which chromium-browser 2>/dev/null || which google-chrome 2>/dev/null',
      { timeout: 3000 },
    )
      .toString()
      .trim();
    if (p) return p;
  } catch {
    /* ignore */
  }
  return undefined;
}

const CHROMIUM_PATH = resolveChromiumPath();
if (CHROMIUM_PATH) console.log('[PDF] Using Chromium:', CHROMIUM_PATH);

const OUTPUT_DIR = path.join(__dirname, '../../outputs');
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

async function generatePDF(data, type, jobId) {
  let html;
  if (type === 'proposal') {
    html = buildProposalHTML(data);
  } else {
    html = buildContractHTMLNew(adaptToContractSchema(data));
  }

  const filename = `PB_${type === 'proposal' ? 'Proposal' : 'Contract'}_${jobId.slice(0, 8)}_${Date.now()}.pdf`;
  const outputPath = path.join(OUTPUT_DIR, filename);

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: CHROMIUM_PATH,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.pdf({
      path: outputPath,
      format: 'Letter',
      margin: { top: '0.8in', right: '1in', bottom: '0.8in', left: '1in' },
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: `<div style="font-size:7.5px;color:#aaa;width:100%;text-align:center;font-family:Arial,sans-serif;padding-top:6px;letter-spacing:0.3px;">
        Preferred Builders General Services Inc. &nbsp;|&nbsp; LIC# HIC-197400 &nbsp;|&nbsp; 978-377-1784
      </div>`,
      footerTemplate: `<div style="width:100%;font-family:Arial,sans-serif;font-size:8px;color:#555;display:flex;justify-content:space-between;align-items:center;padding:0 72px;box-sizing:border-box;">
        <span style="color:#888;">Preferred Builders General Services Inc.</span>
        <span style="font-weight:bold;color:#1B3A6B;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
        <span style="color:#888;">${type === 'proposal' ? 'PROPOSAL' : 'CONTRACT'} — Confidential</span>
      </div>`,
    });
  } finally {
    await browser.close();
  }

  return outputPath;
}

async function generateSignedPDF(data, docType, jobId, appendHtml) {
  let baseHtml;
  if (docType === 'proposal') {
    baseHtml = buildProposalHTML(data);
  } else {
    baseHtml = buildContractHTMLNew(adaptToContractSchema(data));
  }

  const html = baseHtml.includes('</body>')
    ? baseHtml.replace('</body>', `${appendHtml}\n</body>`)
    : baseHtml + appendHtml;

  const filename = `PB_${docType === 'proposal' ? 'Proposal' : 'Contract'}_${jobId.slice(0, 8)}_signed_${Date.now()}.pdf`;
  const outputPath = path.join(OUTPUT_DIR, filename);

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: CHROMIUM_PATH,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.pdf({
      path: outputPath,
      format: 'Letter',
      margin: { top: '0.8in', right: '1in', bottom: '0.8in', left: '1in' },
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: `<div style="font-size:7.5px;color:#aaa;width:100%;text-align:center;font-family:Arial,sans-serif;padding-top:6px;letter-spacing:0.3px;">
        Preferred Builders General Services Inc. &nbsp;|&nbsp; LIC# HIC-197400 &nbsp;|&nbsp; 978-377-1784
      </div>`,
      footerTemplate: `<div style="width:100%;font-family:Arial,sans-serif;font-size:8px;color:#555;display:flex;justify-content:space-between;align-items:center;padding:0 72px;box-sizing:border-box;">
        <span style="color:#888;">Preferred Builders General Services Inc.</span>
        <span style="font-weight:bold;color:#1B3A6B;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
        <span style="color:#888;">${docType === 'proposal' ? 'PROPOSAL' : 'CONTRACT'} — SIGNED</span>
      </div>`,
    });
  } finally {
    await browser.close();
  }

  return outputPath;
}

async function generateBlankContractDocx() {
  const HTMLtoDOCX = require('html-to-docx');

  const rawHtml = buildContractHTMLNew(blankContractSchema());

  const html = rawHtml
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/\s*style="[^"]*"/gi, '');

  const buffer = await HTMLtoDOCX(html, null, {
    table: { row: { cantSplit: true } },
    footer: true,
    pageNumber: true,
    margins: { top: 1080, right: 1080, bottom: 1080, left: 1080 },
  });

  return buffer;
}

async function generatePDFFromHTML(html, filenameBase) {
  const filename = `${filenameBase}_${Date.now()}.pdf`;
  const outputPath = path.join(OUTPUT_DIR, filename);

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: CHROMIUM_PATH,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.pdf({
      path: outputPath,
      format: 'Letter',
      margin: { top: '0.5in', right: '0.75in', bottom: '0.5in', left: '0.75in' },
      printBackground: true,
    });
  } finally {
    await browser.close();
  }

  return outputPath;
}

module.exports = {
  generatePDF,
  generateSignedPDF,
  generatePDFFromHTML,
  generateBlankContractDocx,
  buildNoticeOfContractHTML,
};
