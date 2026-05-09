// server/services/claudeChat.js
// Chat AI: clarification conversations, admin (WhatsApp) chat, and wizard question generation.

const Anthropic = require('@anthropic-ai/sdk');
const { logTokenUsage } = require('../utils/tokenLogger');
const { loadSettings, loadKnowledgeBase, buildSystemPrompt } = require('./claudeEstimate');
const perplexity = require('./perplexityService');
const { lookupPropertyByAddress } = require('./massGisService');
const { checkLeadRecord } = require('./leadCheckService');
const { claudeWithRetry } = require('../utils/claudeRetry');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── HANDLE CLARIFICATION CONVERSATION ────────────────────────────────
async function handleClarification(jobId, userMessage, conversationHistory, language = 'en') {
  const settings = loadSettings();
  const knowledgeBase = loadKnowledgeBase();
  const systemPrompt = buildSystemPrompt(settings, knowledgeBase, language);

  const messages = [...conversationHistory, { role: 'user', content: userMessage }];

  const response = await claudeWithRetry(
    client,
    {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      temperature: 0.1,
      system:
        systemPrompt +
        `\n\nYou are in a clarification conversation about job ${jobId}. 
    If the user's answers complete all missing information, respond with JSON: {"type":"ready","message":"..."} 
    If more questions remain, respond with JSON: {"type":"question","message":"...","questionsRemaining":N}
    If responding to Jackson in Portuguese, use {"type":"question","message":"...em português...","questionsRemaining":N}`,
      messages,
    },
    'clarification',
  );

  logTokenUsage({
    service: 'claude',
    model: 'claude-sonnet-4-20250514',
    inputTokens: response.usage?.input_tokens,
    outputTokens: response.usage?.output_tokens,
    jobId,
    context: 'clarification',
  });
  const text = response.content[0].text;
  try {
    const clean = text.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    return { type: 'message', message: text };
  }
}

// ── WEB SEARCH TOOL (Perplexity) ─────────────────────────────────────
const WEB_SEARCH_TOOL = {
  name: 'web_search',
  description: `Search the web for current real-time data you cannot reliably know from training data.
Use ONLY for time-sensitive information: current material prices, permit fee schedules, labor market rates, specific building code sections, or local supplier info.
Do NOT use for general construction knowledge, math, or anything already in your training data.
Keep queries specific and under 15 words.`,
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'Targeted search query. Example: "Fitchburg MA building permit fee schedule 2025"',
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
          'material_price: lumber/concrete/roofing costs. permit_fee: municipal fees. labor_rate: sub market rates. building_code: code requirements. supplier: local vendors. general: other.',
      },
    },
    required: ['query', 'search_type'],
  },
};

// ── PROPERTY TOOLS ───────────────────────────────────────────────────
const LOOKUP_PROPERTY_TOOL = {
  name: 'lookup_property',
  description: `Look up Massachusetts property assessor data from the MassGIS L3 parcel database.
Returns: year built, building area (sq ft), building footprint (sq ft), estimated building perimeter (ft), lot width (ft), lot depth (ft), lot perimeter (ft), assessed value, use code, owner info, bedrooms, bathrooms, style, heat type, stories, AND a direct link to the town assessor's field card (which contains the exterior property photo and a hand-drawn sketch with actual room and exterior dimensions).
Use this when the user asks about a property's dimensions, size, exterior measurements, year built, assessed value, field card, property photo, building sketch, or when evaluating renovation scope, siding, roofing, painting, or stretch code applicability for a known MA address.`,
  input_schema: {
    type: 'object',
    properties: {
      address: {
        type: 'string',
        description: 'Full property address (e.g. "123 Main St, Fitchburg, MA")',
      },
    },
    required: ['address'],
  },
};

const GET_BUILDING_MEASUREMENTS_TOOL = {
  name: 'get_building_measurements',
  description: `Get free satellite-derived building dimensions for a property address or lat/lng.
Returns building footprint width × depth, ground floor area, building perimeter, and roof area.
Data comes from Microsoft Building Footprints (free) and Google Solar API (free backup).
Use this whenever a job needs exterior measurements for siding, roofing, painting, or any scope that requires square footage or perimeter.
You must have a lat/lng coordinate — get it from lookup_property or lookup_jobs property_data first.
These are estimates from aerial imagery. For contractor-grade precision, use order_measurement_report (Hover or EagleView, paid per job).`,
  input_schema: {
    type: 'object',
    properties: {
      lat: { type: 'number', description: 'Latitude of the property' },
      lng: { type: 'number', description: 'Longitude of the property' },
      address: { type: 'string', description: 'Human-readable address for context' },
    },
    required: ['lat', 'lng'],
  },
};

const ORDER_MEASUREMENT_REPORT_TOOL = {
  name: 'order_measurement_report',
  description: `Place a paid professional measurement order for a property via Hover or EagleView.
- Hover: Creates a 3D model from photos. Best for complex shapes, walls, siding, windows. Turnaround: 24-48 hrs.
- EagleView: Aerial satellite roof measurement. Best for roofing, gutters, steep-pitch situations. Turnaround: 24-48 hrs.
The cost is charged per report and should be passed on to the customer.
Only use this when the user explicitly asks to order a Hover or EagleView report for a specific job.`,
  input_schema: {
    type: 'object',
    properties: {
      provider: {
        type: 'string',
        enum: ['hover', 'eagleview'],
        description: 'Which service to use',
      },
      address: { type: 'string', description: 'Full property address' },
      city: { type: 'string' },
      state: { type: 'string', description: 'State abbreviation, e.g. "MA"' },
      zip: { type: 'string' },
      job_id: { type: 'string', description: 'Internal job ID to associate the order with' },
      customer_name: { type: 'string' },
      customer_email: { type: 'string' },
      customer_phone: { type: 'string' },
      report_type: {
        type: 'string',
        description: 'EagleView only: Premium (default), PremiumCommercial, Essentials',
      },
    },
    required: ['provider', 'address'],
  },
};

const CHECK_MEASUREMENT_ORDER_TOOL = {
  name: 'check_measurement_order',
  description: `Check the status of a previously placed Hover or EagleView measurement order.
Returns current status, estimated delivery, and whether measurements are ready to retrieve.`,
  input_schema: {
    type: 'object',
    properties: {
      provider: { type: 'string', enum: ['hover', 'eagleview'] },
      order_id: { type: 'string', description: 'The Hover job ID or EagleView order ID' },
    },
    required: ['provider', 'order_id'],
  },
};

const EXTRACT_SKETCH_DIMENSIONS_TOOL = {
  name: 'extract_sketch_dimensions',
  description: `Screenshot the assessor's field card building sketch and use vision AI to read the dimension numbers annotated on each wall segment.
Returns actual exterior wall lengths in feet, total perimeter, building shape, and any labeled sections (garage, porch, deck, etc.).
Use this when the user asks for exact building dimensions, exterior measurements, wall lengths, or building perimeter for a specific job or address.
You must first call lookup_property or lookup_jobs to get the assessorFieldCardUrl or recordCardUrl before calling this tool.`,
  input_schema: {
    type: 'object',
    properties: {
      record_card_url: {
        type: 'string',
        description:
          'The assessor field card URL (from recordCardUrl or assessorFieldCardUrl in the property record)',
      },
      address: {
        type: 'string',
        description: 'Property address for context (e.g. "123 Main St, Townsend, MA")',
      },
    },
    required: ['record_card_url'],
  },
};

const CHECK_LEAD_RECORD_TOOL = {
  name: 'check_lead_record',
  description: `Check whether a Massachusetts property has a lead paint inspection record in the CLPPP historical database.
Returns: hasRecord (boolean), note, and links to Lead Safe Homes portals.
Use this when evaluating renovation work on pre-1978 buildings or when lead abatement risk is relevant.`,
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

// ── ADMIN TOOLS (for tool calling) ───────────────────────────────────
const ADMIN_TOOLS = [
  {
    name: 'lookup_contacts',
    description:
      "Search for customer/contact information in the database by name, email, or phone number. Use this whenever someone asks about a customer's contact info.",
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Name, email, or phone to search for' },
      },
      required: ['query'],
    },
  },
  {
    name: 'lookup_jobs',
    description:
      'Search for jobs/projects by customer name or project address. Returns recent status and value info.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Customer name or project address to search for' },
      },
      required: ['query'],
    },
  },
  {
    name: 'create_task',
    description:
      'Create a task, reminder, or to-do item. Use this when someone says "remind me to", "schedule", "make a note", "add a task", or similar.',
    input_schema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Short task title (e.g. "Call for inspection at 123 Main St")',
        },
        description: { type: 'string', description: 'Additional details or notes about the task' },
        due_at: {
          type: 'string',
          description:
            'Due date/time in ISO 8601 format (e.g. "2026-03-15T17:00:00"). Use the current date as reference if the user says "tomorrow" or "next week".',
        },
        priority: {
          type: 'string',
          enum: ['high', 'normal', 'low'],
          description: 'Priority level',
        },
        job_address: {
          type: 'string',
          description: 'Project address if the task relates to a specific job',
        },
      },
      required: ['title'],
    },
  },
];

async function runAdminTool(toolName, toolInput, db) {
  const { makeCalendarURL } = require('../routes/tasks');

  if (toolName === 'lookup_contacts') {
    const q = `%${toolInput.query}%`;
    const results = db
      .prepare(
        `SELECT name, email, phone, address, city, state, customer_number FROM contacts
       WHERE name LIKE ? OR email LIKE ? OR phone LIKE ? LIMIT 5`,
      )
      .all(q, q, q);
    if (!results.length) return 'No contacts found matching that search.';
    return results
      .map(
        (c) =>
          `**${c.name}** (${c.customer_number || 'no ID'})\nEmail: ${c.email || '—'}\nPhone: ${c.phone || '—'}\nAddress: ${[c.address, c.city, c.state].filter(Boolean).join(', ') || '—'}`,
      )
      .join('\n\n');
  }

  if (toolName === 'lookup_jobs') {
    const q = `%${toolInput.query}%`;
    const results = db
      .prepare(
        `SELECT id, customer_name, customer_email, customer_phone, project_address, project_city, status, total_value, created_at, property_data
       FROM jobs WHERE archived = 0 AND (customer_name LIKE ? OR project_address LIKE ?) ORDER BY created_at DESC LIMIT 5`,
      )
      .all(q, q);
    if (!results.length) return 'No jobs found matching that search.';
    return results
      .map((j) => {
        let propLines = '';
        if (j.property_data) {
          try {
            const pd = JSON.parse(j.property_data);
            const gis = pd.massGis;
            const mrpc = pd.mrpc;

            // MRPC record card (direct link to field card with exterior photo +
            // hand-drawn sketch with actual room/exterior dimensions).
            // Preferred over the Vision GIS fallback URL.
            const fieldCardUrl = mrpc?.recordCardUrl || gis?.assessorFieldCardUrl || null;

            const parts = [
              // Building basics
              gis?.yearBuilt || mrpc?.yearBuilt
                ? `Year Built: ${gis?.yearBuilt || mrpc?.yearBuilt}`
                : null,
              gis?.stories || mrpc?.stories ? `Stories: ${gis?.stories || mrpc?.stories}` : null,
              gis?.style || mrpc?.style ? `Style: ${gis?.style || mrpc?.style}` : null,
              // Building dimensions
              gis?.buildingArea || mrpc?.buildingArea
                ? `Total Building Area: ${gis?.buildingArea || mrpc?.buildingArea} sq ft`
                : null,
              gis?.footprintSqFt ? `Building Footprint: ~${gis.footprintSqFt} sq ft` : null,
              gis?.estBuildingPerimFt
                ? `Est. Building Perimeter: ~${gis.estBuildingPerimFt} ft`
                : null,
              // Lot dimensions
              gis?.lotWidthFt && gis?.lotDepthFt
                ? `Lot Dimensions: ~${gis.lotWidthFt} ft wide × ${gis.lotDepthFt} ft deep`
                : null,
              gis?.lotPerimeterFt ? `Lot Perimeter: ~${gis.lotPerimeterFt} ft` : null,
              gis?.lotSize ? `Lot Size: ${gis.lotSize} sq ft` : null,
              // Assessor values
              gis?.totalAssessedValue || mrpc?.totalAssessedValue
                ? `Assessed Value: $${Number(gis?.totalAssessedValue || mrpc?.totalAssessedValue).toLocaleString()}`
                : null,
              mrpc?.lastSaleDate
                ? `Last Sale: ${mrpc.lastSaleDate} for $${Number(mrpc.lastSalePrice).toLocaleString()}`
                : null,
              mrpc?.zoning ? `Zoning: ${mrpc.zoning}` : null,
              gis?.useCodeLabel ? `Use: ${gis.useCodeLabel}` : null,
              // Building details
              gis?.numBedrooms ? `Bedrooms: ${gis.numBedrooms}` : null,
              gis?.numBathrooms ? `Bathrooms: ${gis.numBathrooms}` : null,
              gis?.heatType ? `Heat: ${gis.heatType}` : null,
              // Ownership
              gis?.owner1
                ? `Record Owner: ${gis.owner1}${gis.owner2 ? ' / ' + gis.owner2 : ''}`
                : null,
              gis?.ownerAddress ? `Owner Mailing: ${gis.ownerAddress}` : null,
              // Field card — exterior photo + hand-drawn sketch with actual dimensions
              fieldCardUrl
                ? `Assessor Field Card (exterior photo + sketch w/ dimensions): ${fieldCardUrl}`
                : null,
            ].filter(Boolean);
            if (parts.length) propLines = '\nProperty Record:\n' + parts.join('\n');
          } catch {
            /* ignore parse errors */
          }
        }
        return `**${j.customer_name}** — ${j.project_address}${j.project_city ? ', ' + j.project_city : ''}\nStatus: ${j.status?.replace(/_/g, ' ')}\nValue: ${j.total_value ? '$' + Number(j.total_value).toLocaleString() : '—'}\nEmail: ${j.customer_email || '—'} | Phone: ${j.customer_phone || '—'}${propLines}`;
      })
      .join('\n\n');
  }

  if (toolName === 'create_task') {
    const { title, description, due_at, priority, job_address } = toolInput;
    let job_id = null;
    if (job_address) {
      const job = db
        .prepare(`SELECT id FROM jobs WHERE project_address LIKE ? LIMIT 1`)
        .get(`%${job_address}%`);
      job_id = job?.id || null;
    }
    const info = db
      .prepare(
        `INSERT INTO tasks (title, description, due_at, job_id, priority) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(title, description || null, due_at || null, job_id, priority || 'normal');
    const saved = db.prepare('SELECT * FROM tasks WHERE id = ?').get(info.lastInsertRowid);
    const calURL = makeCalendarURL(saved);
    if (calURL) {
      db.prepare('UPDATE tasks SET calendar_url = ? WHERE id = ?').run(calURL, saved.id);
      saved.calendar_url = calURL;
    }
    return JSON.stringify({
      created: true,
      task_id: saved.id,
      title: saved.title,
      due_at: saved.due_at,
      calendar_url: saved.calendar_url,
    });
  }

  if (toolName === 'web_search') {
    console.log(`[Chat→Perplexity] type=${toolInput.search_type} query="${toolInput.query}"`);
    return await perplexity.search(toolInput.query, toolInput.search_type);
  }

  if (toolName === 'get_building_measurements') {
    const { lat, lng, address } = toolInput;
    console.log(`[Chat→Measurements] lat=${lat} lng=${lng} address="${address}"`);
    const { getFreeMeasurements } = require('./measurementService');
    const result = await getFreeMeasurements(lat, lng, address);
    if (!result)
      return 'No building footprint data found for this location from free sources. Consider ordering a Hover or EagleView report for professional measurements.';
    return result.summary || JSON.stringify(result, null, 2);
  }

  if (toolName === 'order_measurement_report') {
    const {
      provider,
      address,
      city,
      state,
      zip,
      job_id,
      customer_name,
      customer_email,
      customer_phone,
      report_type,
    } = toolInput;
    console.log(`[Chat→MeasurementOrder] provider=${provider} address="${address}"`);
    const { orderHoverReport, orderEagleViewReport } = require('./measurementService');
    try {
      let order;
      if (provider === 'hover') {
        order = await orderHoverReport({
          address,
          name: customer_name,
          email: customer_email,
          phone: customer_phone,
          jobId: job_id,
        });
        return `Hover report ordered successfully!\n- Hover Job ID: ${order.hoverId}\n- Status: ${order.status}\n${order.captureUrl ? `- Capture link (send to customer for photos): ${order.captureUrl}` : ''}\nResults arrive in 24-48 hours. Use check_measurement_order to follow up.`;
      } else {
        order = await orderEagleViewReport({
          address,
          city,
          state: state || 'MA',
          zip,
          reportType: report_type,
          jobId: job_id,
        });
        return `EagleView report ordered successfully!\n- EagleView Order ID: ${order.eagleViewOrderId}\n- Status: ${order.status}\n- Estimated delivery: ${order.estimatedDelivery}\nUse check_measurement_order to follow up.`;
      }
    } catch (err) {
      return `Could not place ${provider} order: ${err.message}`;
    }
  }

  if (toolName === 'check_measurement_order') {
    const { provider, order_id } = toolInput;
    console.log(`[Chat→OrderStatus] provider=${provider} orderId=${order_id}`);
    const { getOrderStatus } = require('./measurementService');
    try {
      const status = await getOrderStatus(provider, order_id);
      return `**${status.provider} Order ${order_id}**\nStatus: ${status.label}\nMeasurements ready: ${status.measurementsReady ? 'Yes' : 'Not yet'}`;
    } catch (err) {
      return `Could not check order status: ${err.message}`;
    }
  }

  if (toolName === 'extract_sketch_dimensions') {
    console.log(`[Chat→SketchExtractor] url="${toolInput.record_card_url}"`);
    const { extractBuildingDimensions } = require('./sketchExtractor');
    const result = await extractBuildingDimensions(toolInput.record_card_url, toolInput.address);
    if (!result)
      return 'Could not access the assessor sketch for this property. The field card link may require a browser session. Share the link with the user so they can open it directly.';
    return result.raw || 'Sketch captured but no dimensions could be read from the image.';
  }

  if (toolName === 'lookup_property') {
    console.log(`[Chat→MassGIS] address="${toolInput.address}"`);
    const propData = await lookupPropertyByAddress(toolInput.address);
    if (propData) {
      return JSON.stringify(propData, null, 2);
    }
    if (perplexity.isConfigured()) {
      return await perplexity.search(
        `property assessor data year built ${toolInput.address} Massachusetts`,
        'general',
      );
    }
    return 'No MassGIS record found for this address.';
  }

  if (toolName === 'check_lead_record') {
    console.log(`[Chat→LeadCheck] town="${toolInput.town}" street="${toolInput.street}"`);
    const result = await checkLeadRecord({
      town: toolInput.town,
      street: toolInput.street,
      number: toolInput.number || '',
    });
    return JSON.stringify(result, null, 2);
  }

  return 'Unknown tool.';
}

async function adminChat(messages, language = 'en', db = null, sender = null) {
  const settings = loadSettings();
  const knowledgeBase = loadKnowledgeBase();

  const today = new Date().toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/New_York',
  });

  const senderName = sender ? sender.name : null;
  const senderRole = sender ? sender.role : 'team member';
  const senderLine = senderName
    ? `IMPORTANT: You are speaking with ${senderName} (${senderRole}). Their identity is confirmed — they are registered in the system. NEVER ask who they are. Always address them by name.`
    : `You are speaking with an authorized team member. Do not ask who they are.`;

  const systemPrompt =
    buildSystemPrompt(settings, knowledgeBase, language) +
    `

You are the Preferred Builders AI assistant in WhatsApp chat mode.
Today is: ${today}

${senderLine}

You have live access to the database and can:
- Look up any customer contact info (name, email, phone) using lookup_contacts
- Look up job/project status and info using lookup_jobs
- Create tasks, reminders, and to-do items using create_task
- Look up MA property assessor data (year built, building area, assessed value, field card link) using lookup_property
- Get free satellite-derived building dimensions (width, depth, area, perimeter, roof area) using get_building_measurements — needs lat/lng from lookup_property first
- Order a professional paid measurement report from Hover (best for siding/walls) or EagleView (best for roofing) using order_measurement_report — check status later with check_measurement_order
- Extract actual wall dimensions from the assessor building sketch using extract_sketch_dimensions (call lookup_property first to get the field card URL, then call this)
- Check lead paint inspection records at a property using check_lead_record
${perplexity.isConfigured() ? '- Search the web for current real-time data using web_search (use for live prices, permit fees, code sections, supplier info — NOT for general knowledge)' : ''}

Answer questions about:
- Customer and contact information (always use the lookup tool)
- Job status and project details (always use the lookup tool)
- Pricing and estimates (use web_search for current market prices if needed)
- Massachusetts building codes (use web_search for specific code sections if needed)
- Contract requirements
- Task and reminder creation (use the create_task tool)
- Construction best practices

Be helpful, precise, and direct. You can speak Portuguese if needed.
When you create a task, confirm it was saved and mention if a calendar link is available.

IMPORTANT STYLE RULES:
- Never introduce yourself or list your capabilities unprompted.
- Never say things like "I now have live access to..." or "Try asking..."
- If someone just says hi or starts a conversation with no specific request, reply only with: "👷 Hey ${senderName || 'there'}, what do you need?"
- Keep all responses short and direct.`;

  const msgsToSend = [...messages];
  let createdTask = null;

  for (let turn = 0; turn < 5; turn++) {
    const response = await claudeWithRetry(
      client,
      {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        temperature: 0,
        system: systemPrompt,
        tools: db
          ? [
              ...ADMIN_TOOLS,
              LOOKUP_PROPERTY_TOOL,
              GET_BUILDING_MEASUREMENTS_TOOL,
              ORDER_MEASUREMENT_REPORT_TOOL,
              CHECK_MEASUREMENT_ORDER_TOOL,
              EXTRACT_SKETCH_DIMENSIONS_TOOL,
              CHECK_LEAD_RECORD_TOOL,
              ...(perplexity.isConfigured() ? [WEB_SEARCH_TOOL] : []),
            ]
          : [],
        messages: msgsToSend,
      },
      'adminChat',
    );

    logTokenUsage({
      service: 'claude',
      model: 'claude-sonnet-4-20250514',
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
      context: 'admin_chat',
    });

    if (
      response.stop_reason === 'end_turn' ||
      !response.content.some((b) => b.type === 'tool_use')
    ) {
      const text = response.content.find((b) => b.type === 'text')?.text || '';
      return { reply: text, createdTask };
    }

    msgsToSend.push({ role: 'assistant', content: response.content });

    const toolResults = [];
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;
      let result;
      try {
        result = await runAdminTool(block.name, block.input, db);
        if (block.name === 'create_task') {
          try {
            const parsed = JSON.parse(result);
            if (parsed.created) createdTask = parsed;
          } catch {
            /* ignore */
          }
        }
      } catch (e) {
        result = `Error: ${e.message}`;
      }
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
    }

    msgsToSend.push({ role: 'user', content: toolResults });
  }

  return { reply: 'I ran into an issue processing your request. Please try again.', createdTask };
}

// ── WIZARD QUESTION GENERATION ────────────────────────────────────────
async function generateWizardQuestions(
  scopeText,
  projectAddress = '',
  budgetTarget = null,
  selectedTrades = [],
) {
  const budgetContext = budgetTarget
    ? `\nBudget Target: $${Number(budgetTarget).toLocaleString()} (client-facing total)`
    : '';

  const tradesContext =
    selectedTrades.length > 0
      ? `\n\nEXPLICITLY SELECTED TRADES (user-confirmed):\n${selectedTrades.map((t) => `- ${t.name} (${t.deptName}): ${t.meaning}`).join('\n')}\nThese trades are confirmed in scope — focus demo_check and trade_clarification questions on these trades specifically. Do NOT ask about trades not in this list unless the scope text itself mentions them.`
      : '';
  const response = await claudeWithRetry(
    client,
    {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      temperature: 0,
      system: `You are a construction estimating assistant helping a Massachusetts GC build accurate quotes. Your job is to read a scope of work and ask ONLY the most important clarifying questions — focusing especially on install-implies-demo trade pairings and ambiguous trade scopes.

INSTALL-IMPLIES-DEMO RULE: When the scope mentions installing, replacing, or upgrading something (cabinets, flooring, fixtures, doors, windows, drywall, roofing, tiles, vanities, toilets, bathtubs, etc.), always check whether removal/demolition of the existing item is already in the scope. If the scope is ambiguous or silent on demo for that item, ask about it as a "demo_check" question.

TRADE SCOPE AMBIGUITY RULES — these questions are critical for accurate pricing:
- ELECTRICAL: When electrical work is mentioned without specifying extent, ALWAYS ask as a "trade_clarification" question: Is this a full electrical service upgrade and/or whole-home rewire (new panel, new circuits throughout), OR is it limited to safety inspection, panel check, and fixture/outlet/switch replacement? These differ by $10,000–$30,000.
- HVAC: When HVAC is mentioned without specifying extent, ask: Does this include full HVAC equipment replacement (new furnace/AC/heat pump), OR is it limited to system inspection, tune-up, filter/component replacement, and duct cleaning?
- PLUMBING: When plumbing work goes beyond clearly specified fixture swaps, ask: Does this include repiping supply or drain lines, OR is it limited to fixture replacement and hookup only?

Return ONLY valid JSON — no commentary, no markdown.`,
      messages: [
        {
          role: 'user',
          content: `Read this scope of work and return a JSON array of clarifying questions. Return an empty array [] if the scope is completely clear and no questions are needed.

Project Address: ${projectAddress || 'not specified'}${budgetContext}${tradesContext}

SCOPE OF WORK:
${scopeText}

Return this EXACT JSON structure (array, 0 to 8 questions max):
[
  {
    "id": "q1",
    "question": "The scope mentions installing new kitchen cabinets. Does the demo/removal of existing cabinets need to be added to the estimate, or is that already included?",
    "questionType": "demo_check",
    "trade": "cabinets",
    "answerType": "yesno",
    "hint": "Say Yes if demo is already in scope, No if it needs to be added"
  },
  {
    "id": "q2",
    "question": "Are there any specific material brands or grades required for the flooring?",
    "questionType": "scope_detail",
    "trade": "flooring",
    "answerType": "text",
    "hint": ""
  }
]

RULES:
1. questionType must be "demo_check" for install-implies-demo questions, "scope_detail" for other scope gaps, or "trade_clarification" for trade-specific ambiguity questions (electrical extent, HVAC extent, plumbing extent).
2. answerType must be "yesno" for Yes/No questions or "text" for open-ended questions. Use "yesno" for demo_check. Use "text" for trade_clarification so the user can describe the extent.
3. Only ask questions whose answers would materially change the line items or cost. Do NOT ask for customer info, addresses, or obvious details already in the scope.
4. For demo_check: if the user says YES (demo is included), the install proceeds as-is. If the user says NO, we add a demo line item and ask for the cost.
5. Keep questions conversational and specific — mention the exact item from the scope.
6. Trade clarification questions for electrical/HVAC/plumbing MUST be asked when those trades appear with vague extent — even if the scope seems complete otherwise.
7. If the scope is clear and complete with no ambiguous trades, return an empty array [].
8. Return ONLY the JSON array. Nothing else.`,
        },
      ],
    },
    'wizard',
  );

  logTokenUsage({
    service: 'claude',
    model: 'claude-sonnet-4-20250514',
    inputTokens: response.usage?.input_tokens,
    outputTokens: response.usage?.output_tokens,
    context: 'wizard',
  });
  const text = response.content[0].text.trim();
  try {
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error('[generateWizardQuestions] Parse error:', e.message, text.slice(0, 200));
    return [];
  }
}

module.exports = {
  handleClarification,
  ADMIN_TOOLS,
  runAdminTool,
  adminChat,
  generateWizardQuestions,
};
