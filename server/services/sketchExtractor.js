// server/services/sketchExtractor.js
// Uses Puppeteer to navigate to a property assessor field card and screenshot
// the building sketch, then passes the image to Claude vision to extract the
// annotated wall dimension numbers (e.g. "42 ft", "28 ft", "16 ft").
//
// Supported systems:
//   - Patriot Properties: *.patriotproperties.com (landing.asp?ANUM=XXX)
//   - Vision Government Solutions: gis.vgsi.com/<town>ma/parcel.aspx?pid=XXX
//   - MRPC-hosted PDFs: mrmapper.mrpc.org/WebApps/*/YYYY/NNNNN.pdf (future)

const puppeteer = require('puppeteer');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');
const { logTokenUsage } = require('../utils/tokenLogger');

// Reuse the chromium path resolver from pdfService
function resolveChromiumPath() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  const candidates = [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/nix/store',
  ];
  const fs = require('fs');
  const { execSync } = require('child_process');
  for (const c of candidates) {
    if (c === '/nix/store') {
      try {
        const found = execSync(
          'which chromium 2>/dev/null || which chromium-browser 2>/dev/null || which google-chrome 2>/dev/null',
          { encoding: 'utf8' },
        ).trim();
        if (found) return found;
      } catch {
        /* skip */
      }
    } else if (fs.existsSync(c)) {
      return c;
    }
  }
  return null;
}
const CHROMIUM_PATH = resolveChromiumPath();

const ANTHROPIC = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Detect which assessor system a RECORD_CARD URL belongs to.
 */
function detectSystem(url) {
  if (!url) return null;
  if (/patriotproperties\.com/i.test(url)) return 'patriot';
  if (/vgsi\.com/i.test(url)) return 'vision';
  if (/mrmapper\.mrpc\.org.*\.pdf/i.test(url)) return 'mrpc_pdf';
  if (/tylerhost\.net|tyler/i.test(url)) return 'tyler';
  return 'unknown';
}

/**
 * Build the URL that best loads the building sketch for a given assessor system.
 * - Patriot: navigate landing.asp (sets session), then RecordCard.asp
 * - Vision: parcel page has an embedded sketch frame
 */
function buildSketchUrl(recordCardUrl, system) {
  if (system === 'patriot') {
    // Extract ANUM from landing.asp?ANUM=XXX or Summary.asp?AccountNumber=XXX
    const anum =
      (recordCardUrl.match(/[?&]ANUM=(\d+)/i) || [])[1] ||
      (recordCardUrl.match(/[?&]AccountNumber=(\d+)/i) || [])[1];
    if (!anum) return { landingUrl: recordCardUrl, sketchUrl: null };
    const base = recordCardUrl.match(/https?:\/\/[^/]+/i)[0];
    return {
      landingUrl: `${base}/landing.asp?ANUM=${anum}`,
      sketchUrl: `${base}/RecordCard.asp?AccountNumber=${anum}`,
      anum,
      base,
    };
  }
  if (system === 'vision') {
    return { landingUrl: recordCardUrl, sketchUrl: recordCardUrl };
  }
  return { landingUrl: recordCardUrl, sketchUrl: recordCardUrl };
}

/**
 * Use Puppeteer to screenshot the building sketch from an assessor page.
 * Returns a base64 PNG string or null.
 */
async function screenshotSketch(recordCardUrl) {
  const system = detectSystem(recordCardUrl);
  if (!system || system === 'mrpc_pdf') return null; // PDFs handled separately

  const { landingUrl, sketchUrl, base, anum } = buildSketchUrl(recordCardUrl, system);
  if (!sketchUrl) return null;

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: CHROMIUM_PATH,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 900 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
    );

    // For Patriot Properties: hit the landing page first to initialize the session
    if (system === 'patriot' && landingUrl !== sketchUrl) {
      console.log(`[SketchExtractor] Establishing Patriot session: ${landingUrl}`);
      await page.goto(landingUrl, { waitUntil: 'networkidle0', timeout: 20000 });
    }

    // Navigate to the record card / sketch page
    console.log(`[SketchExtractor] Loading sketch page: ${sketchUrl}`);
    await page.goto(sketchUrl, { waitUntil: 'networkidle0', timeout: 20000 });

    // For Patriot: the RecordCard page uses frames — look for sketch in any frame
    let sketchBase64 = null;

    if (system === 'patriot') {
      // Patriot RecordCard is a frameset; sketch is typically in the "Top" frame
      const frames = page.frames();
      for (const frame of frames) {
        const frameUrl = frame.url();
        if (!frameUrl || frameUrl === 'about:blank') continue;
        // Find the frame that has the sketch image (usually contains <img> with sketch)
        const sketchImg = await frame
          .$('img[src*="sketch"], img[src*="Sketch"], img[src*="drawing"]')
          .catch(() => null);
        if (sketchImg) {
          const box = await sketchImg.boundingBox();
          if (box && box.width > 50 && box.height > 50) {
            sketchBase64 = await sketchImg.screenshot({ encoding: 'base64' });
            console.log(`[SketchExtractor] Captured sketch from frame: ${frameUrl}`);
            break;
          }
        }
      }

      // Fallback: screenshot the entire visible record card area
      if (!sketchBase64) {
        // Look for any sizable image on the main page or frames
        for (const frame of frames) {
          const imgs = await frame.$$('img').catch(() => []);
          for (const img of imgs) {
            const box = await img.boundingBox().catch(() => null);
            if (box && box.width > 100 && box.height > 80) {
              sketchBase64 = await img.screenshot({ encoding: 'base64' }).catch(() => null);
              if (sketchBase64) {
                console.log('[SketchExtractor] Captured fallback sketch image');
                break;
              }
            }
          }
          if (sketchBase64) break;
        }
      }
    } else {
      // Vision GIS: take a screenshot of the full page and let Claude find the sketch
      sketchBase64 = await page.screenshot({ encoding: 'base64', fullPage: false });
    }

    return sketchBase64;
  } finally {
    await browser.close();
  }
}

/**
 * Pass a base64 PNG screenshot to Claude vision and extract building dimensions.
 * Returns an object with { dimensions, perimeter, notes } or null.
 */
async function extractDimensionsFromImage(base64Image, address) {
  if (!base64Image) return null;
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const prompt = `This is an assessor's field card building sketch for a Massachusetts property${address ? ` at ${address}` : ''}.

The sketch shows an aerial/overhead outline of the building with dimension numbers annotated on each wall segment (in feet).

Please extract:
1. All dimension numbers visible on the sketch, labeled by which wall they describe (e.g. "Front: 42 ft, Right: 28 ft, Rear: 42 ft, Left: 28 ft")
2. The calculated building perimeter (sum of all exterior wall dimensions, in feet)
3. Any labeled areas or sections (e.g. "BAS" base area, "GAR" garage, "FPL" fireplace, "WDK" wood deck, porch, etc.) with their dimensions
4. An approximate shape description (e.g. "rectangular", "L-shaped", "T-shaped")

If the sketch is not visible or doesn't contain dimension numbers, say so clearly.

Return your answer in plain text, concise and ready to share with a contractor.`;

  try {
    const response = await ANTHROPIC.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 800,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/png', data: base64Image },
            },
            { type: 'text', text: prompt },
          ],
        },
      ],
    });

    logTokenUsage({
      service: 'claude',
      model: 'claude-opus-4-5',
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
      context: 'sketch_extraction',
    });

    const text = response.content[0]?.text || '';
    return { raw: text, extractedAt: new Date().toISOString() };
  } catch (err) {
    console.warn('[SketchExtractor] Claude vision error:', err.message);
    return null;
  }
}

/**
 * Main entry point: given a RECORD_CARD URL, screenshot the sketch and
 * extract building dimensions using Claude vision.
 *
 * @param {string} recordCardUrl - Direct URL to assessor field card
 * @param {string} [address] - Property address (for context in prompt)
 * @returns {Promise<{raw: string, extractedAt: string}|null>}
 */
async function extractBuildingDimensions(recordCardUrl, address) {
  if (!recordCardUrl) return null;
  if (!CHROMIUM_PATH) {
    console.warn('[SketchExtractor] No Chromium found — cannot screenshot sketch');
    return null;
  }

  console.log(`[SketchExtractor] Starting sketch extraction for: ${recordCardUrl}`);
  try {
    const base64 = await screenshotSketch(recordCardUrl);
    if (!base64) {
      console.warn('[SketchExtractor] Could not capture sketch image');
      return null;
    }
    const result = await extractDimensionsFromImage(base64, address);
    console.log(`[SketchExtractor] Extraction complete for ${address || recordCardUrl}`);
    return result;
  } catch (err) {
    console.warn('[SketchExtractor] Extraction failed:', err.message);
    return null;
  }
}

module.exports = { extractBuildingDimensions, detectSystem };
