// server/services/assessmentService.js
// Shared assessment logic — called by route (manual) and tickQuoteCounter (auto every 10 quotes)

const Anthropic = require('@anthropic-ai/sdk');
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const QUOTE_THRESHOLD = 10;
const COUNTER_KEY = 'quotes_since_last_assessment';

// ── Run the full assessment and save to DB ────────────────────────────────────
async function runAssessment(db) {
  const contracts = db
    .prepare(
      "SELECT id, title, content FROM knowledge_base WHERE category = 'past_contracts' AND active = 1 ORDER BY created_at DESC LIMIT 50",
    )
    .all();

  if (contracts.length === 0) {
    throw new Error('No past contracts in knowledge base yet. Import some invoices first.');
  }

  // Compact reference log (retained in report after purge)
  const referenceLog = contracts.map((c, i) => {
    const content = c.content || '';
    const dateMatch = content.match(/INVOICE DATE:\s*(.+)/i);
    const valueMatch = content.match(/TOTAL CONTRACT VALUE:\s*\$?([\d,]+)/i);
    const typeMatch = content.match(/PROJECT TYPE:\s*(.+)/i);
    return {
      ref: `#${String(i + 1).padStart(3, '0')}`,
      title: c.title?.substring(0, 60) || '—',
      date: dateMatch?.[1]?.trim() || '—',
      value: valueMatch?.[1] ? `$${valueMatch[1]}` : '—',
      type: typeMatch?.[1]?.trim() || '—',
    };
  });

  const contractSummaries = contracts
    .map((c, i) => `--- CONTRACT ${i + 1} ---\nTitle: ${c.title}\n${c.content.substring(0, 2000)}`)
    .join('\n\n');

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 4000,
    temperature: 0,
    system: `You are a business strategy consultant specializing in the Massachusetts residential and commercial construction market.
You analyze a contractor's historical invoices to provide honest, actionable competitive intelligence.
Be specific, data-driven, and direct. The contractor wants to win more jobs.`,
    messages: [
      {
        role: 'user',
        content: `Analyze these ${contracts.length} past contracts/invoices from Preferred Builders General Services Inc. and generate a comprehensive assessment report.

${contractSummaries}

Generate a detailed assessment report with these EXACT sections:

# PRICING POSITION ASSESSMENT

## Overall Market Position
State clearly: high-end / mid-high / mid-market / mid-low / budget — with confidence level and explanation.

## Price Distribution by Trade
For each trade found across the contracts, note the typical price range and how it compares to Central MA market rates.

## Deposit & Payment Terms Analysis
How do current terms compare to industry norms?

---

# SCOPE LANGUAGE ANALYSIS

## Strengths in Current Scope Writing
What do you write well? What language builds customer confidence?

## Gaps & Weaknesses
What's missing or unclear in how scopes are written that could lose bids?

## Recommended Scope Improvements
3-5 specific, actionable changes to scope language that would increase win rate.

---

# COMPETITIVE WIN RATE ANALYSIS

## Why You're Winning Jobs
Based on the evidence, what factors are likely helping you win?

## Why You Might Be Losing Jobs
Honest assessment of what might be costing you bids.

## Price Sensitivity Recommendations
Should you adjust pricing up or down, and on which trades?

---

# TOP 5 ACTIONABLE RECOMMENDATIONS
Numbered list of the 5 most impactful changes you should make immediately to win more jobs. Be specific and concrete.

---

# QUICK STATS
- Contracts analyzed: ${contracts.length}
- Estimated total portfolio value: $X
- Average contract size: $X
- Most common project type: X
- Price positioning: X`,
      },
    ],
  });

  const reportBody = response.content[0].text;

  const fullReport = `${reportBody}

---

# SOURCE INVOICE LOG
> ${contracts.length} invoice(s) were analyzed. Full details removed from knowledge base — only this summary is retained.

| Ref  | Date         | Value        | Project Type         | Description |
|------|-------------|-------------|---------------------|-------------|
${referenceLog
  .map(
    (r) =>
      `| ${r.ref} | ${r.date.substring(0, 12).padEnd(12)} | ${r.value.padEnd(12)} | ${r.type.substring(0, 20).padEnd(20)} | ${r.title} |`,
  )
  .join('\n')}

*Assessment generated: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/New_York' })}*`;

  // Save ACTIVE → PREVIOUS, then write new report as ACTIVE
  const activeRow = db
    .prepare(
      "SELECT id, content FROM knowledge_base WHERE title = 'Competitive Assessment Report' AND category = 'pricing'",
    )
    .get();

  if (activeRow) {
    // Demote current ACTIVE to PREVIOUS (upsert)
    const prevRow = db
      .prepare(
        "SELECT id FROM knowledge_base WHERE title = 'Previous Competitive Assessment Report' AND category = 'pricing'",
      )
      .get();
    if (prevRow) {
      db.prepare(
        'UPDATE knowledge_base SET content = ?, active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      ).run(activeRow.content, prevRow.id);
    } else {
      db.prepare(
        "INSERT INTO knowledge_base (title, category, content, language) VALUES ('Previous Competitive Assessment Report', 'pricing', ?, 'en')",
      ).run(activeRow.content);
    }
    // Write new report as ACTIVE
    db.prepare('UPDATE knowledge_base SET content = ?, active = 1 WHERE id = ?').run(
      fullReport,
      activeRow.id,
    );
  } else {
    // First ever assessment — insert as ACTIVE only
    db.prepare(
      'INSERT INTO knowledge_base (title, category, content, language) VALUES (?, ?, ?, ?)',
    ).run('Competitive Assessment Report', 'pricing', fullReport, 'en');
  }

  console.log('[Assessment] Active assessment updated. Previous snapshot preserved.');

  // Purge full past_contracts entries — bot has learned, reference log lives in the report
  const ids = contracts.map((c) => c.id);
  const del = db.prepare('DELETE FROM knowledge_base WHERE id = ?');
  db.transaction((rows) => {
    for (const id of rows) del.run(id);
  })(ids);
  console.log(`[Assessment] Purged ${ids.length} past_contract entries after analysis`);

  return { report: fullReport, contractsAnalyzed: contracts.length, purged: ids.length };
}

// ── Increment quote counter; auto-run assessment when threshold hit ───────────
function tickQuoteCounter(db) {
  // Ensure the counter row exists
  db.prepare(
    "INSERT OR IGNORE INTO settings (key, value, category, label) VALUES (?, '0', 'system', 'Quotes since last assessment')",
  ).run(COUNTER_KEY);

  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(COUNTER_KEY);
  const count = parseInt(row?.value || '0', 10) + 1;

  if (count >= QUOTE_THRESHOLD) {
    // Reset counter immediately so concurrent completions don't double-fire
    db.prepare('UPDATE settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?').run(
      '0',
      COUNTER_KEY,
    );
    console.log(`[Assessment] ${count} quotes reached — triggering auto-assessment`);

    // Run async, do not await — quote flow must not block
    const { getDb } = require('../db/database');
    runAssessment(getDb())
      .then((r) =>
        console.log(
          `[Assessment] Auto-assessment complete. ${r.contractsAnalyzed} contracts analyzed, ${r.purged} purged.`,
        ),
      )
      .catch((err) => console.error('[Assessment] Auto-assessment failed:', err.message));
  } else {
    db.prepare('UPDATE settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?').run(
      String(count),
      COUNTER_KEY,
    );
    console.log(`[Assessment] Quote counter: ${count}/${QUOTE_THRESHOLD}`);
  }
}

module.exports = { runAssessment, tickQuoteCounter };
