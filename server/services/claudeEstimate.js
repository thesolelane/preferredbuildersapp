// server/services/claudeEstimate.js
// Estimate AI: system prompt, pricing math, tool loop, and processEstimate.

const Anthropic = require('@anthropic-ai/sdk');
const { claudeWithRetry } = require('../utils/claudeRetry');
const { getDb } = require('../db/database');
const jobMemory = require('./jobMemory');
const perplexity = require('./perplexityService');
const { logTokenUsage } = require('../utils/tokenLogger');
const { lookupPropertyByAddress } = require('./massGisService');
const { checkLeadRecord } = require('./leadCheckService');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── LOAD SETTINGS FROM DB ────────────────────────────────────────────
function loadSettings() {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const row of rows) {
    try {
      settings[row.key] = JSON.parse(row.value);
    } catch {
      settings[row.key] = row.value;
    }
  }
  return settings;
}

// ── LOAD KNOWLEDGE BASE ──────────────────────────────────────────────
function loadKnowledgeBase() {
  const db = getDb();
  const docs = db
    .prepare('SELECT title, category, content FROM knowledge_base WHERE active = 1')
    .all();
  return docs.map((d) => `## ${d.title} [${d.category}]\n${d.content}`).join('\n\n---\n\n');
}

// ── GET MARKUP RATES ─────────────────────────────────────────────────
function getMarkupRates(settings) {
  return {
    subOandP: Number(settings['markup.subOandP']) || Number(settings['markup.subOP']) || 0.15,
    gcOandP: Number(settings['markup.gcOandP']) || Number(settings['markup.gcOP']) || 0.25,
    contingency: Number(settings['markup.contingency']) || 0.1,
    deposit: Number(settings['markup.deposit']) || 0.33,
  };
}

// ── FORMAT LABOR/ALLOWANCE RATES FOR PROMPT ──────────────────────────
function buildRatesSection(settings) {
  const laborLines = [];
  const allowanceLines = [];

  const laborMap = {
    'labor.framing': 'Framing labor',
    'labor.roofing': 'Roofing labor',
    'labor.siding': 'Siding labor',
    'labor.electrical': 'Electrical labor',
    'labor.plumbing': 'Plumbing labor',
    'labor.hvac': 'HVAC labor',
    'labor.drywall': 'Drywall labor',
    'labor.insulation': 'Insulation labor',
    'labor.tile': 'Tile labor',
    'labor.flooring': 'Flooring (LVP/hardwood) install labor',
  };
  const allowanceMap = {
    'allowance.lvp': 'LVP flooring material allowance',
    'allowance.hardwood': 'Hardwood flooring material allowance',
    'allowance.carpet': 'Carpet material allowance',
    'allowance.tileBath': 'Bath tile material allowance',
    'allowance.tileShower': 'Shower tile material allowance',
    'allowance.cabinets': 'Kitchen cabinets allowance (builder grade)',
    'allowance.quartz': 'Quartz countertop allowance',
    'allowance.vanity': 'Full bathroom vanity allowance (each)',
    'allowance.toilet': 'Toilet allowance (each)',
    'allowance.tub': 'Bathtub allowance (each)',
    'allowance.intDoor': 'Interior door (slab) allowance (each)',
  };

  for (const [key, label] of Object.entries(laborMap)) {
    const val = settings[key];
    if (val) {
      const v = typeof val === 'string' ? JSON.parse(val) : val;
      const mid = Math.round((v.low + v.high) / 2);
      laborLines.push(
        `  ${label}: $${mid} per ${v.unit} (use this exact rate — range is $${v.low}–$${v.high})`,
      );
    }
  }
  for (const [key, label] of Object.entries(allowanceMap)) {
    const val = settings[key];
    if (val) {
      const v = typeof val === 'string' ? JSON.parse(val) : val;
      if (v.unit === 'fixed') {
        allowanceLines.push(`  ${label}: $${v.amount.toLocaleString()}`);
      } else {
        allowanceLines.push(`  ${label}: $${v.amount} per ${v.unit}`);
      }
    }
  }

  const markup = {
    sub: Math.round((Number(settings['markup.subOandP']) || 0.15) * 100),
    gc: Math.round((Number(settings['markup.gcOandP']) || 0.25) * 100),
    cont: Math.round((Number(settings['markup.contingency']) || 0.1) * 100),
    dep: Math.round((Number(settings['markup.deposit']) || 0.33) * 100),
  };

  const sqftLow = Number(settings['pricing.sqftLow']) || 320;
  const sqftHigh = Number(settings['pricing.sqftHigh']) || 350;
  const sqftRenoLow = Number(settings['pricing.sqftRenoLow']) || 100;
  const sqftRenoHigh = Number(settings['pricing.sqftRenoHigh']) || 150;

  return `## OUR PRICING STRUCTURE
The system applies markups automatically AFTER extraction — do NOT add markup to baseCost values.
baseCost = what Preferred Builders pays subs/materials (net cost to us).
Markup chain applied by system: baseCost × (1 + ${markup.sub}% sub O&P) × (1 + ${markup.gc}% GC O&P) × (1 + ${markup.cont}% contingency) = client price.
Combined multiplier ≈ ${((1 + markup.sub / 100) * (1 + markup.gc / 100) * (1 + markup.cont / 100)).toFixed(4)}×.
Deposit: ${markup.dep}% of total contract price.

## TARGET PRICE RANGE (finished space)
Set project.type based on the scope:
- "new_construction": full ground-up builds, full additions from foundation up — target $${sqftLow}–$${sqftHigh} per finished sq ft
- "renovation": interior work from stud surface to stud surface (gut remodels, full interior fit-outs, stud-to-stud renovations) — target $${sqftRenoLow}–$${sqftRenoHigh} per finished sq ft

After markup is applied, the total contract price should fall within the applicable range per sqft of finished/livable space. Unfinished garage bays, unfinished basements, and utility spaces are excluded. If your baseCost extractions would result in a price outside the applicable range, adjust to bring the total in range and note the adjustment in the "notes" field.

## OUR LABOR RATES (Central MA — use these for baseCost estimates)
${laborLines.join('\n')}

## OUR MATERIAL ALLOWANCES (use these as baseCost for allowance items)
${allowanceLines.join('\n')}`;
}

// ── BUILD SYSTEM PROMPT ──────────────────────────────────────────────
function buildSystemPrompt(settings, knowledgeBase, language = 'en') {
  const isPortuguese = language === 'pt-BR';

  return `You are a construction estimating data extractor for Preferred Builders General Services Inc. (HIC-197400), a licensed Massachusetts general contractor based in Fitchburg, MA.

${isPortuguese ? `IMPORTANT: When communicating with Jackson directly (admin chat / clarification), respond in Portuguese (Brazilian). Data extraction output is always in English.` : ''}

YOUR ONLY JOB: Read estimates and return structured JSON data. You do NOT format documents, write HTML, or make template decisions. The system handles all of that.

## ABSOLUTE RESTRICTIONS
- You must NEVER initiate, request, suggest, or trigger sending of any email, SMS, WhatsApp message, or any external communication to any customer, contractor, or third party.
- All customer communications are controlled exclusively by authorized human staff through the app interface. You have no role in initiating them.

## COMPANY INFO
Name: Preferred Builders General Services Inc.
License: HIC-197400
Address: 37 Duck Mill Road, Fitchburg, MA 01420
Phone: 978-377-1784
Project Manager: Jackson Deaquino

${buildRatesSection(settings)}

## MARKET RATE GRADING
Compare each trade line item against our labor rates above. Flag items >15% above or below our typical range in "flaggedItems".

## MA STRETCH CODE
Stretch Code towns require: HERS rater, ERV system, EV-ready outlet, solar conduit.
ONLY flag these as missing in stretchCodeItems if they are NOT already covered in the estimate (e.g. if a Permits line says "stretch code compliance", those items are already included).

## BUDGET TARGET CALIBRATION
If the estimate includes a BUDGET TARGET line, calibrate all line item baseCosts so that after the system applies its standard markup (~1.58×: sub O&P 15% + GC O&P 25% + contingency 10%), the total contract price lands within ±8% of the stated target. Prefer builder-grade or mid-range material specifications where a range of options exists. If you must constrain scope to hit the budget, document the tradeoffs in the "notes" field.

## CONSTRUCTION KNOWLEDGE
- Metal roof at 3:12 or lower pitch requires 2x12 rafters at 16" O.C. and structural ridge beam
- 2x6 framing required in MA Stretch Code towns for R-20
- Never include well, septic, underground electric, appliances, or driveway unless explicitly in the estimate

## PROPERTY INTELLIGENCE TOOLS
You have two property tools available. Use them proactively when a project address is known:
- **lookup_property**: Fetches MassGIS assessor data (year built, building area, lot size, assessed value, use code). Use when evaluating scope size, compliance requirements, or pricing for a known MA address.
- **check_lead_record**: Checks CLPPP historical database for lead paint inspection records. Use when a project involves interior renovation of a pre-1978 building — lead abatement requirements can significantly affect scope and pricing.
When MassGIS returns no result, the tool falls back to web search automatically.

## KNOWLEDGE BASE
${knowledgeBase}`;
}

// ── MEMORY: Look up prior estimates for same address ─────────────────
function buildMemoryContext(db, projectAddress) {
  if (!db || !projectAddress) return '';
  try {
    const prior = db
      .prepare(
        `
      SELECT pb_number, external_ref, created_at, total_value, deposit_amount, proposal_data
      FROM jobs
      WHERE project_address LIKE ?
        AND proposal_data IS NOT NULL
        AND archived = 0
      ORDER BY created_at DESC
      LIMIT 3
    `,
      )
      .all(`%${projectAddress.trim()}%`);

    if (!prior.length) return '';

    const lines = prior
      .map((j) => {
        let lineItems = '';
        try {
          const pd = JSON.parse(j.proposal_data);
          lineItems = (pd.lineItems || [])
            .map((li) => `    - ${li.trade}: baseCost $${li.baseCost?.toLocaleString()}`)
            .join('\n');
        } catch {
          /* ignore */
        }
        const ref = j.pb_number || j.external_ref || j.id;
        return `  Quote ${ref} (${new Date(j.created_at).toLocaleDateString()}) — Total: $${Number(j.total_value || 0).toLocaleString()}\n${lineItems}`;
      })
      .join('\n\n');

    return `\n\n## PRIOR ESTIMATES FOR THIS ADDRESS
This address has been estimated before. Use these as your consistency anchor:
${lines}

RULES:
- Keep baseCosts consistent with prior quotes unless the new scope explicitly changes them
- If a trade appears in a prior quote, use the same cost unless Jackson submitted a different number
- If costs differ significantly from prior quote, add a note in the "notes" field explaining why`;
  } catch (e) {
    console.warn('[buildMemoryContext] Error:', e.message);
    return '';
  }
}

// ── LOOKUP PRIOR VERSION CONTEXT ─────────────────────────────────────
function getPriorVersionContext(db, quoteNumber) {
  if (!quoteNumber) return null;
  const prior = db
    .prepare(
      `
    SELECT j.id, j.version, j.total_value, j.created_at, j.proposal_data
    FROM jobs j
    WHERE j.quote_number = ? AND j.proposal_data IS NOT NULL
    ORDER BY j.version DESC
    LIMIT 1
  `,
    )
    .get(quoteNumber);
  if (!prior) return null;
  try {
    const data =
      typeof prior.proposal_data === 'string'
        ? JSON.parse(prior.proposal_data)
        : prior.proposal_data;
    const items = (data.lineItems || [])
      .map(
        (li) =>
          `  - ${li.trade}: baseCost $${(li.baseCost || 0).toLocaleString()} → client price $${(li.finalPrice || 0).toLocaleString()} | ${li.description || ''}`,
      )
      .join('\n');
    return `## IMPORTANT: YOU ALREADY PRICED THIS QUOTE (Quote #${quoteNumber}, Version ${prior.version} — ${new Date(prior.created_at).toLocaleDateString('en-US')})
You have already processed an estimate for this quote number. This is a revision of the same project. You MUST use your previous pricing as the baseline — do NOT re-estimate from scratch.

Your previous total contract price: $${(prior.total_value || 0).toLocaleString()}
Your previous line items:
${items}

RULES FOR THIS REVISION:
1. Keep the same quoteNumber: "${quoteNumber}"
2. For line items that appear in BOTH the old and new scope, keep your baseCost values the same as above unless the new scope explicitly changes the quantity or specification.
3. Only add new baseCosts for genuinely NEW work items that were not in the prior version.
4. Only remove line items that are explicitly removed from the new scope.
5. If the new scope is identical or nearly identical, your output should match the prior version almost exactly.`;
  } catch {
    return null;
  }
}

// ── PROPERTY TOOLS ───────────────────────────────────────────────────
const LOOKUP_PROPERTY_TOOL = {
  name: 'lookup_property',
  description: `Look up Massachusetts property assessor data from the MassGIS L3 parcel database.
Returns: year built, building area, lot size, assessed value, use code, owner info.
Use this when you need property details to assess scope, compliance requirements, or pricing.
Falls back to web search if MassGIS returns no result (new construction, rural parcel, etc.).`,
  input_schema: {
    type: 'object',
    properties: {
      address: {
        type: 'string',
        description: 'Full property address (e.g. "123 Main St, Fitchburg, MA")',
      },
      town: {
        type: 'string',
        description: 'Massachusetts city or town name (e.g. "FITCHBURG")',
      },
    },
    required: ['address'],
  },
};

const CHECK_LEAD_RECORD_TOOL = {
  name: 'check_lead_record',
  description: `Check whether a Massachusetts property has a lead paint inspection record in the CLPPP historical database (Lead Safe Homes).
Returns: hasRecord (boolean), note, and links to Lead Safe Homes 1.0 and 2.0.
Use this when evaluating renovation scope at properties built before 1978, or when lead abatement risk affects pricing.`,
  input_schema: {
    type: 'object',
    properties: {
      town: {
        type: 'string',
        description: 'Massachusetts city or town name (e.g. "FITCHBURG")',
      },
      street: {
        type: 'string',
        description: 'Street name without number (e.g. "MAIN ST")',
      },
      number: {
        type: 'string',
        description: 'Street number (e.g. "123")',
      },
    },
    required: ['town', 'street'],
  },
};

// ── WEB SEARCH TOOL DEFINITION ───────────────────────────────────────
const WEB_SEARCH_TOOL = {
  name: 'web_search',
  description: `Search the web for current real-time data you cannot reliably know from training data.
Use ONLY when the information is time-sensitive: material prices, permit fee schedules, current labor market rates, or specific building code requirements.
Do NOT use for general construction knowledge or math — only for live data.
Keep queries specific and under 15 words. You may call this up to 3 times per estimate.`,
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'Targeted search query. Be specific. Example: "2x4 lumber price per board foot Massachusetts 2025"',
      },
      search_type: {
        type: 'string',
        enum: [
          'material_price',
          'permit_fee',
          'labor_rate',
          'building_code',
          'supplier',
          'general',
        ],
        description:
          'material_price: lumber/concrete/roofing costs. permit_fee: municipal permit fees. labor_rate: subcontractor market rates. building_code: code requirements. supplier: local vendors. general: other.',
      },
    },
    required: ['query', 'search_type'],
  },
};

// ── TOOL USE LOOP — runs Claude with Perplexity + property tools available ──
async function runWithTools(systemPrompt, userMessage, maxToolCalls = 5, jobId = null) {
  const messages = [{ role: 'user', content: userMessage }];
  const tools = [
    LOOKUP_PROPERTY_TOOL,
    CHECK_LEAD_RECORD_TOOL,
    ...(perplexity.isConfigured() ? [WEB_SEARCH_TOOL] : []),
  ];
  let toolCallCount = 0;
  let totalInput = 0;
  let totalOutput = 0;

  while (true) {
    const response = await claudeWithRetry(
      client,
      {
        model: 'claude-sonnet-4-5',
        max_tokens: 8000,
        temperature: 0.1,
        system: systemPrompt,
        messages,
        tools,
      },
      'estimate',
    );

    totalInput += response.usage?.input_tokens || 0;
    totalOutput += response.usage?.output_tokens || 0;

    if (response.stop_reason === 'tool_use' && toolCallCount < maxToolCalls) {
      const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use');
      messages.push({ role: 'assistant', content: response.content });

      const toolResults = [];
      for (const block of toolUseBlocks) {
        toolCallCount++;
        let result = 'Tool not available.';
        try {
          if (block.name === 'web_search') {
            console.log(
              `[Claude→Perplexity] #${toolCallCount} type=${block.input.search_type} query="${block.input.query}"`,
            );
            result = await perplexity.search(block.input.query, block.input.search_type);
          } else if (block.name === 'lookup_property') {
            console.log(`[Claude→MassGIS] address="${block.input.address}"`);
            const propData = await lookupPropertyByAddress(block.input.address);
            if (propData) {
              result = JSON.stringify(propData);
            } else if (perplexity.isConfigured()) {
              result = await perplexity.search(
                `property assessor data year built ${block.input.address} Massachusetts`,
                'general',
              );
            } else {
              result = 'No MassGIS record found for this address.';
            }
          } else if (block.name === 'check_lead_record') {
            console.log(
              `[Claude→LeadCheck] town="${block.input.town}" street="${block.input.street}"`,
            );
            result = JSON.stringify(
              await checkLeadRecord({
                town: block.input.town,
                street: block.input.street,
                number: block.input.number || '',
              }),
            );
          }
        } catch (err) {
          result = `Tool error: ${err.message}`;
        }
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
      }
      messages.push({ role: 'user', content: toolResults });
    } else {
      logTokenUsage({
        service: 'claude',
        model: 'claude-sonnet-4-5',
        inputTokens: totalInput,
        outputTokens: totalOutput,
        jobId,
        context: 'estimate',
      });
      return response.content.find((b) => b.type === 'text')?.text?.trim() || '';
    }
  }
}

// ── PROCESS ESTIMATE → EXTRACT DATA ─────────────────────────────────
async function processEstimate(
  rawEstimateText,
  jobId,
  language = 'en',
  db = null,
  projectAddress = null,
  priorVersionContext = null,
) {
  const settings = loadSettings();
  const knowledgeBase = loadKnowledgeBase();
  const memoryContext = buildMemoryContext(db, projectAddress);
  const rates = getMarkupRates(settings);

  const jobMemoryContext = jobMemory.getContextForClaude(jobId);

  const systemPrompt =
    buildSystemPrompt(settings, knowledgeBase, language) +
    memoryContext +
    (jobMemoryContext ? `\n\n${jobMemoryContext}` : '') +
    (priorVersionContext ? `\n\n${priorVersionContext}` : '');

  const text = await runWithTools(
    systemPrompt,
    `Extract structured data from this estimate. Return ONLY valid JSON — no commentary, no markdown, no explanation.

Job ID: ${jobId}

ESTIMATE DATA:
${rawEstimateText}

Return this EXACT JSON structure:
{
  "readyToGenerate": true,
  "clarificationsNeeded": [],
  "quoteNumber": "",
  "validUntil": "",
  "customer": {
    "name": "",
    "email": "",
    "phone": "",
    "address_line1": "",
    "city_state_zip": ""
  },
  "project": {
    "address": "",
    "city": "",
    "state": "MA",
    "jurisdiction": "",
    "parcel_number": "",
    "type": "new_construction or renovation",
    "description": "",
    "sqft": 0,
    "stretchCodeTown": false,
    "hasBedrooms": false
  },
  "job": {
    "has_demo": false,
    "has_framing": false,
    "has_insulation": false,
    "has_permit": false,
    "trades": { "electrical": false, "plumbing": false, "hvac": false, "sprinkler": false }
  },
  "lineItems": [
    {
      "trade": "",
      "description": "",
      "baseCost": 0,
      "finalPrice": 0,
      "isStretchCode": false,
      "scopeIncluded": [],
      "scopeExcluded": []
    }
  ],
  "exclusions": [],
  "flaggedItems": [],
  "stretchCodeItems": [],
  "notes": ""
}`,
    3,
    jobId,
  );

  let extractedData;
  try {
    const clean = text.replace(/```json|```/g, '').trim();
    extractedData = JSON.parse(clean);
  } catch (e) {
    console.error('[processEstimate] JSON parse error:', e.message);
    console.error('[processEstimate] Raw response (first 500 chars):', text?.slice(0, 500));
    throw new Error(`Claude returned invalid JSON: ${e.message}`);
  }

  // Apply stretch-code line items that Claude flagged as missing
  const scItems = extractedData.stretchCodeItems || [];
  const STRETCH_CODE_COSTS = {
    'HERS Rater': {
      cost: 1800,
      desc: 'HERS energy rating and blower door test (Stretch Code compliance)',
    },
    'ERV System': {
      cost: 3200,
      desc: 'Energy Recovery Ventilator (ERV) — Stretch Code requirement',
    },
    'EV-Ready Outlet': {
      cost: 850,
      desc: 'EV-ready 240V outlet in garage (Stretch Code requirement)',
    },
    'Solar Conduit': {
      cost: 1200,
      desc: 'Solar-ready conduit and panel capacity (Stretch Code requirement)',
    },
    'LED Lighting Package': {
      cost: 2400,
      desc: 'LED lighting package (Stretch Code energy compliance)',
    },
  };

  for (const item of scItems) {
    const cfg = STRETCH_CODE_COSTS[item];
    if (!cfg) continue;
    const already = (extractedData.lineItems || []).some((li) =>
      li.trade?.toLowerCase().includes(item.toLowerCase()),
    );
    if (!already) {
      extractedData.lineItems = extractedData.lineItems || [];
      extractedData.lineItems.push({
        trade: item,
        description: cfg.desc,
        baseCost: cfg.cost,
        isStretchCode: true,
        scopeIncluded: [item],
        scopeExcluded: [],
      });
    }
  }

  if (extractedData.readyToGenerate) {
    applyPricing(extractedData, rates);
  }

  return extractedData;
}

// ── SYSTEM-CONTROLLED PRICING MATH ──────────────────────────────────
function applyPricing(data, rates, settings) {
  if (!settings) settings = loadSettings();
  const validDate = new Date();
  validDate.setDate(validDate.getDate() + 15);
  data.validUntil = validDate.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'America/New_York',
  });

  const items = data.lineItems || [];
  const markupMultiplier = (1 + rates.subOandP) * (1 + rates.gcOandP) * (1 + rates.contingency);
  let totalContractPrice = 0;

  for (const item of items) {
    const cost = item.baseCost || 0;
    item.baseCost = cost;
    if (item.isStretchCode) {
      item.finalPrice = cost;
    } else {
      item.finalPrice = Math.round(cost * markupMultiplier);
    }
    totalContractPrice += item.finalPrice;
  }

  const dumpsterItem = items.find((i) =>
    /dumpster|waste\s*removal|debris\s*removal/i.test(i.trade || ''),
  );
  const dumpsterExplicitlyExcluded = dumpsterItem && (Number(dumpsterItem.baseCost) || 0) === 0;
  const hasDumpster = !!dumpsterItem && !dumpsterExplicitlyExcluded;

  // If user zeroed out the dumpster line, remove it so it never appears in scope
  if (dumpsterExplicitlyExcluded) {
    const idx = items.indexOf(dumpsterItem);
    if (idx !== -1) items.splice(idx, 1);
  }

  let implicitDumpsterBaseCost = 0;
  if (!hasDumpster && !dumpsterExplicitlyExcluded) {
    let totalBase = 0;
    for (const item of items) totalBase += item.baseCost || 0;
    let dumpsterCost;
    if (totalBase < 10000) {
      dumpsterCost = 600;
    } else if (totalBase <= 25000) {
      dumpsterCost = 1200;
    } else {
      const extraDumpsters = Math.ceil((totalBase - 25000) / 15000);
      dumpsterCost = 1200 + extraDumpsters * 1200;
    }
    implicitDumpsterBaseCost = dumpsterCost;
    totalContractPrice += Math.round(dumpsterCost * markupMultiplier);
  }

  // ── Proportionality sanity check ──────────────────────────────────────────
  // Flag any single line item whose baseCost is >40% of the total base cost.
  // Catches typos like $150,000 entered instead of $15,000.
  {
    let totalBase = 0;
    for (const item of items) totalBase += item.baseCost || 0;
    if (totalBase > 0) {
      for (const item of items) {
        const pct = ((item.baseCost || 0) / totalBase) * 100;
        if (pct > 40) {
          const flag = `${item.trade}: baseCost $${(item.baseCost || 0).toLocaleString()} is ${Math.round(pct)}% of total — verify this is not a typo`;
          data.flaggedItems = data.flaggedItems || [];
          if (!data.flaggedItems.includes(flag)) data.flaggedItems.push(flag);
          console.warn(`[Sanity] Disproportionate line item — ${flag}`);
        }
      }
    }
  }

  // Tag items whose fees are paid directly by the customer (not part of deposit base)
  const SEPARATE_FEE_RE = /permit|remit|engineer/i;
  for (const item of items) {
    item.isSeparatelyBilled =
      SEPARATE_FEE_RE.test(item.trade || '') || SEPARATE_FEE_RE.test(item.description || '');
  }
  const separatelyBilledTotal = items.reduce(
    (s, i) => s + (i.isSeparatelyBilled ? i.finalPrice || 0 : 0),
    0,
  );
  const depositBase = Math.max(0, totalContractPrice - separatelyBilledTotal);
  const depositAmount = Math.round(depositBase * rates.deposit);
  const sqft = Number(data.project?.sqft) || 0;
  const isReno = String(data.project?.type || '')
    .toLowerCase()
    .includes('reno');
  const sqftLow = isReno
    ? Number(settings['pricing.sqftRenoLow']) || 100
    : Number(settings['pricing.sqftLow']) || 320;
  const sqftHigh = isReno
    ? Number(settings['pricing.sqftRenoHigh']) || 150
    : Number(settings['pricing.sqftHigh']) || 350;
  const pricePerSqft = sqft > 0 ? Math.round(totalContractPrice / sqft) : null;
  let sqftWarning = null;
  if (pricePerSqft !== null) {
    if (pricePerSqft < sqftLow) sqftWarning = 'below';
    else if (pricePerSqft > sqftHigh) sqftWarning = 'above';
  }

  data.pricing = {
    markupMultiplier: Math.round(markupMultiplier * 10000) / 10000,
    totalContractPrice,
    depositPercent: Math.round(rates.deposit * 100),
    depositAmount,
    separatelyBilledTotal,
    depositBase,
    pricePerSqft,
    sqftTargetLow: sqftLow,
    sqftTargetHigh: sqftHigh,
    sqftWarning,
    projectType: isReno ? 'renovation' : 'new_construction',
    appliedRates: {
      subOandP: rates.subOandP,
      gcOandP: rates.gcOandP,
      contingency: rates.contingency,
    },
    implicitDumpsterBaseCost,
    dumpsterExcluded: dumpsterExplicitlyExcluded || false,
  };

  data.totalValue = totalContractPrice;
  data.depositAmount = depositAmount;

  if (pricePerSqft !== null) {
    console.log(
      `[Pricing] Markup: ${markupMultiplier.toFixed(4)}x → Total: $${totalContractPrice.toLocaleString()} → $${pricePerSqft}/sqft (${isReno ? 'reno' : 'new-const'} target $${sqftLow}–$${sqftHigh}) → Deposit: $${depositAmount.toLocaleString()}`,
    );
  } else {
    console.log(
      `[Pricing] Markup: ${markupMultiplier.toFixed(4)}x → Total: $${totalContractPrice.toLocaleString()} → Deposit: $${depositAmount.toLocaleString()}`,
    );
  }
}

module.exports = {
  loadSettings,
  loadKnowledgeBase,
  getMarkupRates,
  buildRatesSection,
  buildSystemPrompt,
  buildMemoryContext,
  getPriorVersionContext,
  WEB_SEARCH_TOOL,
  runWithTools,
  processEstimate,
  applyPricing,
};
