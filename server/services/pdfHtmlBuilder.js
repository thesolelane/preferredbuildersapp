// server/services/pdfHtmlBuilder.js
// All HTML template builder functions for proposals and the Notice of Contract.
// pdfService.js uses these to assemble the HTML before handing it to Puppeteer.

const BRAND_BLUE = '#1B3A6B';
const BRAND_ORANGE = '#E07B2A';
const LIGHT_BLUE = '#EEF3FB';
const LIGHT_GRAY = '#F8F8F8';

function baseCSS() {
  return `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; font-size: 10.5pt; color: #1a1a1a; line-height: 1.55; }

    .cover { background: ${BRAND_BLUE}; color: white; padding: 48px 56px; min-height: 200px; }
    .cover-title { font-size: 26pt; font-weight: bold; letter-spacing: 1px; }
    .cover-sub { font-size: 13pt; margin-top: 8px; opacity: 0.85; }
    .cover-meta { margin-top: 24px; font-size: 10pt; opacity: 0.8; line-height: 2; }
    .cover-badge { display: inline-block; background: ${BRAND_ORANGE}; color: white; padding: 4px 14px; border-radius: 3px; font-size: 9pt; font-weight: bold; margin-top: 16px; }

    .content { padding: 20px 56px; }

    .section-header {
      background: ${BRAND_BLUE}; color: white;
      padding: 8px 14px; margin: 24px 0 12px;
      font-size: 11.5pt; font-weight: bold;
      page-break-after: avoid;
    }
    .section-header.orange { background: ${BRAND_ORANGE}; }
    .sub-header {
      color: ${BRAND_BLUE}; font-weight: bold; font-size: 11pt;
      margin: 16px 0 6px; border-bottom: 1px solid #ddd; padding-bottom: 4px;
      page-break-after: avoid;
    }

    table { width: 100%; border-collapse: collapse; margin: 8px 0 16px; font-size: 10pt; }
    th { background: ${BRAND_BLUE}; color: white; padding: 7px 10px; text-align: left; font-weight: bold; }
    td { padding: 6px 10px; border-bottom: 1px solid #eee; vertical-align: top; }
    tr:nth-child(even) td { background: ${LIGHT_GRAY}; }
    tr.total td { background: ${LIGHT_BLUE}; font-weight: bold; border-top: 2px solid ${BRAND_BLUE}; }
    tr.deposit td { background: #fff3e0; font-weight: bold; }

    .check-list { list-style: none; padding: 0; margin: 0 0 8px; }
    .check-list li { padding: 3px 0 3px 24px; font-size: 10pt; position: relative; }
    .check-list li.yes::before { content: "✓"; color: #2E7D32; font-weight: bold; position: absolute; left: 6px; }
    .check-list li.no::before  { content: "✗"; color: #C62828; font-weight: bold; position: absolute; left: 6px; }
    .check-list li.bullet::before { content: "•"; color: ${BRAND_BLUE}; position: absolute; left: 8px; }
    .check-list li .label { font-weight: bold; }
    .check-list li .detail { color: #555; font-size: 9.5pt; }

    .note-box {
      background: #FFF8F0; border-left: 4px solid ${BRAND_ORANGE};
      padding: 10px 14px; margin: 10px 0 16px;
      font-size: 9.5pt; color: #5D3A00; font-style: italic;
    }
    .rebate-box {
      background: #E8F5E9; border-left: 4px solid #2E7D32;
      padding: 10px 14px; margin: 10px 0 16px;
      font-size: 9.5pt; color: #1B5E20;
    }
    .flag-box {
      background: #FFF3E0; border-left: 4px solid #F57C00;
      padding: 10px 14px; margin: 10px 0 16px;
      font-size: 9.5pt; color: #E65100;
    }

    .sig-block { margin-top: 24px; }
    .sig-row { display: flex; gap: 40px; margin-bottom: 32px; }
    .sig-field { flex: 1; }
    .sig-line { border-bottom: 1px solid #333; height: 32px; margin-bottom: 4px; }
    .sig-label { font-size: 9pt; color: #555; }

    .legal-text { font-size: 9pt; line-height: 1.65; color: #333; }
    .legal-text h3 { color: ${BRAND_BLUE}; font-size: 10pt; margin: 14px 0 4px; font-weight: bold; }
    .legal-text p { margin-bottom: 8px; }
    .legal-text ul { margin: 4px 0 8px 20px; }
    .legal-text ul li { margin-bottom: 3px; }

    .exhibit-header { text-align: center; margin: 12px 0 20px; page-break-before: always; }
    .exhibit-label { color: ${BRAND_ORANGE}; font-size: 13pt; font-weight: bold; display: block; }
    .exhibit-name { color: ${BRAND_BLUE}; font-size: 18pt; font-weight: bold; display: block; margin-top: 4px; }
    .exhibit-sub { color: #666; font-size: 10pt; margin-top: 6px; }

    .overview-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0; margin: 12px 0; border: 1px solid #ddd; }
    .overview-grid .item { padding: 8px 12px; border-bottom: 1px solid #eee; }
    .overview-grid .item:nth-child(odd) { background: ${LIGHT_GRAY}; border-right: 1px solid #ddd; }
    .overview-grid .label-cell { font-weight: bold; font-size: 9.5pt; color: ${BRAND_BLUE}; }
    .overview-grid .value-cell { font-size: 10pt; }

    .page-break { page-break-before: always; }
  `;
}

// ══════════════════════════════════════════════════════════════════════
// PROPOSAL HTML — built entirely from flat JSON data
// ══════════════════════════════════════════════════════════════════════
function buildProposalHTML(data) {
  const customer = data.customer || {};
  const project = data.project || {};
  const lineItems = data.lineItems || [];
  const pricing = data.pricing || {};
  const exclusions = [...(data.exclusions || [])];
  if (pricing.dumpsterExcluded) {
    exclusions.unshift({
      name: 'Dumpster & Debris Removal',
      reason:
        'Not included in this contract. Customer is responsible for all debris removal and disposal.',
      budget: 'Approx. $600–$1,500 depending on volume',
    });
  }
  const fmt = (n) => (n ? `$${Number(n).toLocaleString()}` : '$0');
  const quoteNum = data.quoteNumber || '—';
  const validUntil = data.validUntil || '—';
  const isStretchCode = project.stretchCodeTown || data.isStretchCodeTown || false;

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>${baseCSS()}</style></head>
<body>

<!-- COVER -->
<div class="cover">
  <div class="cover-title">PROJECT PROPOSAL &amp; SCOPE OF WORK</div>
  <div class="cover-sub">${project.address || ''}, ${project.city || ''}, ${project.state || 'MA'}</div>
  <div class="cover-meta">
    Prepared for: <strong>${customer.name || ''}</strong><br>
    Quote #: <strong>${quoteNum}</strong><br>
    Date: <strong>${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/New_York' })}</strong><br>
    Valid Until: <strong>${validUntil}</strong>
  </div>
  <div class="cover-badge">PROPOSAL — NOT A CONTRACT</div>
</div>

<div class="content">

  <!-- PROJECT OVERVIEW -->
  <div class="section-header">PROJECT OVERVIEW</div>

  <!-- Customer info card -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:12px 0 16px;">
    <div style="background:${LIGHT_BLUE};border-left:4px solid ${BRAND_BLUE};padding:12px 16px;border-radius:2px;">
      <div style="font-size:9pt;font-weight:bold;color:${BRAND_BLUE};margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px;">Customer</div>
      ${customer.pb_customer_number ? `<div style="font-family:monospace;font-size:8.5pt;background:#1B3A6B22;color:${BRAND_BLUE};padding:2px 7px;border-radius:3px;display:inline-block;margin-bottom:5px;font-weight:bold;letter-spacing:0.5px;">${customer.pb_customer_number}</div>` : ''}
      <div style="font-size:13pt;font-weight:bold;color:#1a1a1a;margin-bottom:4px;">${customer.name || '—'}</div>
      ${customer.phone ? `<div style="font-size:10pt;color:#333;">📞 ${customer.phone}</div>` : ''}
      ${customer.email ? `<div style="font-size:10pt;color:#333;">✉️ ${customer.email}</div>` : ''}
    </div>
    <div style="background:${LIGHT_GRAY};border-left:4px solid ${BRAND_ORANGE};padding:12px 16px;border-radius:2px;">
      <div style="font-size:9pt;font-weight:bold;color:${BRAND_ORANGE};margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px;">Project Location</div>
      <div style="font-size:12pt;font-weight:bold;color:#1a1a1a;margin-bottom:4px;">${project.address || '—'}</div>
      <div style="font-size:10pt;color:#333;">${[project.city, project.state].filter(Boolean).join(', ') || ''}</div>
      ${project.sqft ? `<div style="font-size:10pt;color:#555;margin-top:4px;">${Number(project.sqft).toLocaleString()} sq ft</div>` : ''}
    </div>
  </div>

  <!-- Project details grid -->
  <div class="overview-grid">
    <div class="item label-cell">Project Description</div>
    <div class="item value-cell">${project.description || '—'}</div>
    <div class="item label-cell">Quote Number</div>
    <div class="item value-cell">${quoteNum || '—'}</div>
    <div class="item label-cell">Date Prepared</div>
    <div class="item value-cell">${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/New_York' })}</div>
    <div class="item label-cell">Valid Until</div>
    <div class="item value-cell">${validUntil || '—'}</div>
    <div class="item label-cell">Stretch Code Town</div>
    <div class="item value-cell">${isStretchCode ? '⚠️ Yes — additional requirements apply' : 'No'}</div>
  </div>

  <!-- SCOPE OF WORK -->
  <div class="section-header">SCOPE OF WORK</div>
  ${buildScopeHTML(lineItems)}

  <!-- EXCLUSIONS -->
  ${
    exclusions.length
      ? `
  <div class="section-header">WHAT IS NOT INCLUDED</div>
  <p style="margin-bottom:10px;font-size:10pt;">The following are excluded from this proposal:</p>
  ${buildExclusionsHTML(exclusions)}`
      : ''
  }

  <!-- PERMIT CHECKLIST -->
  ${buildPermitChecklistHTML(data)}

  <!-- COST SUMMARY -->
  <div class="section-header">COMPLETE COST SUMMARY</div>
  ${buildCostSummaryHTML(lineItems, pricing, data, fmt)}

  <!-- CUSTOMER RESPONSIBILITIES -->
  <div class="section-header">CUSTOMER RESPONSIBILITIES</div>
  ${buildResponsibilitiesHTML()}

  <!-- MASSSAVE NOTE -->
  <div class="rebate-box">
    ⭐ <strong>MassSave Rebate Opportunity:</strong> All-electric mini split heat pump systems 
    qualify for MassSave rebates of $1,500–$10,000. EV charger rebates also available. 
    Preferred Builders will assist with all rebate applications prior to installation.
  </div>

</div>

<!-- EXHIBIT A -->
${buildExhibitAHTML(data, fmt)}

<!-- SIGNATURE -->
<div class="content">
  <div class="section-header">ACCEPTANCE</div>
  <p style="margin-bottom:20px;font-size:10pt;">
    By signing below, the customer acknowledges receipt of this Proposal (Quote #${quoteNum}) and 
    authorizes Preferred Builders General Services Inc. to proceed upon receipt of the deposit.
    <strong>This Proposal is not a contract.</strong> A formal Construction Contract will be issued upon acceptance,
    and this Proposal &amp; Scope of Work will be incorporated into that Contract by reference.
  </p>
  ${buildSignatureHTML()}
  <p style="font-size:8.5pt;color:#888;margin-top:16px;">
    Preferred Builders General Services Inc. | LIC# HIC-197400 | 
    37 Duck Mill Road, Fitchburg, MA 01420 | 978-377-1784 | 
    jackson.deaquino@preferredbuildersusa.com
  </p>
</div>

</body>
</html>`;
}

// ══════════════════════════════════════════════════════════════════════
// SECTION BUILDERS — all template logic lives here
// ══════════════════════════════════════════════════════════════════════

function buildScopeHTML(lineItems) {
  return lineItems
    .map((item) => {
      const included = item.scopeIncluded || [];
      return `
    <div class="sub-header">${item.trade}</div>
    ${item.description ? `<p style="font-size:10.5pt;color:#333;margin-bottom:10px;line-height:1.6;">${item.description}</p>` : ''}
    ${
      included.length
        ? `
    <p style="font-size:9.5pt;font-weight:bold;color:${BRAND_BLUE};margin:6px 0 4px;">This trade includes:</p>
    <ul class="check-list">
      ${included.map((i) => `<li class="yes"><span class="label">${i}</span></li>`).join('')}
    </ul>`
        : ''
    }
    ${item.note ? `<div style="margin:8px 0 4px;padding:8px 12px;background:#FFF8F0;border-left:3px solid #E07B2A;border-radius:0 4px 4px 0;font-size:9.5pt;color:#5D3A00;line-height:1.6;font-style:italic;">📝 Note: ${item.note}</div>` : ''}`;
    })
    .join('');
}

function buildExclusionsHTML(exclusions) {
  return `
  <table>
    <tr><th>Excluded Item</th><th>Why Excluded</th><th>Customer Budget Estimate</th></tr>
    ${exclusions
      .map(
        (item) => `
    <tr>
      <td><strong>${item.name || ''}</strong></td>
      <td>${item.reason || '—'}</td>
      <td>${item.budget || '—'}</td>
    </tr>`,
      )
      .join('')}
  </table>`;
}

function buildPermitChecklistHTML(data) {
  const job = data.job || {};
  const project = data.project || {};
  const trades = job.trades || {};

  const isStretchCode = project.stretchCodeTown || data.isStretchCodeTown || false;
  const isNewConstruct = project.type === 'new_construction';
  const isADU = project.type === 'adu';
  const hasBedrooms = !!(project.hasBedrooms || isADU);
  const needsCO = (isNewConstruct || isADU) && hasBedrooms;
  const needsHERS = isStretchCode && (isNewConstruct || isADU) && hasBedrooms;
  const hasElectrical = !!trades.electrical;
  const hasPlumbing = !!trades.plumbing;
  const hasHVAC = !!trades.hvac;
  const hasSprinkler = !!trades.sprinkler;
  const hasAnyTrade = hasElectrical || hasPlumbing || hasHVAC || hasSprinkler;
  const needsPermit = !!job.has_permit;
  const hasFraming = !!job.has_framing || isNewConstruct;
  const hasInsulation = !!job.has_insulation;

  if (!needsPermit && !hasAnyTrade && !isNewConstruct) {
    return `
  <div class="section-header">PERMIT &amp; INSPECTION STATUS</div>
  <div class="note-box">
    No permit or municipal inspections are required for this scope of work.
  </div>`;
  }

  const rows = [];
  if (isNewConstruct) rows.push('Foundation inspection');
  if (hasFraming) rows.push('Framing inspection');
  if (hasElectrical) rows.push('Rough electrical inspection');
  if (hasPlumbing) rows.push('Rough plumbing inspection');
  if (hasHVAC) rows.push('Rough mechanical (HVAC) inspection');
  if (hasSprinkler) rows.push('Rough sprinkler inspection');
  if (hasInsulation) rows.push('Insulation inspection');
  if (hasElectrical) rows.push('Final electrical inspection');
  if (hasPlumbing) rows.push('Final plumbing inspection');
  if (hasHVAC) rows.push('Final mechanical (HVAC) inspection');
  if (hasSprinkler) rows.push('Final sprinkler inspection');
  if (needsPermit || hasFraming || isNewConstruct) rows.push('Final building inspection');
  if (needsHERS)
    rows.push('HERS rating and blower door test (Stretch Code — ADU residential unit)');
  if (needsCO) {
    rows.push('Certificate of Occupancy (residential dwelling unit)');
  } else if (needsPermit || hasAnyTrade || isNewConstruct) {
    rows.push('Certificate of Completion');
  }

  return `
  <div class="section-header">PERMIT &amp; INSPECTION CHECKLIST</div>
  <p style="margin-bottom:10px;font-size:10pt;">The following inspections are required for this scope of work and are included in this proposal:</p>
  <table>
    <tr><th>Inspection / Milestone</th><th>Status</th></tr>
    ${rows
      .map(
        (item) => `
    <tr>
      <td>${item}</td>
      <td style="color:#2E7D32;font-weight:bold;">✓ Included</td>
    </tr>`,
      )
      .join('')}
  </table>`;
}

const SEPARATE_FEE_RE = /permit|remit|engineer/i;

function buildCostSummaryHTML(lineItems, pricing, data, fmt) {
  // Always re-derive isSeparatelyBilled from the actual line items so the
  // deduction is correct even when stored pricing values are stale.
  const taggedItems = lineItems.map((item) => ({
    ...item,
    isSeparatelyBilled:
      item.isSeparatelyBilled ||
      SEPARATE_FEE_RE.test(item.trade || '') ||
      SEPARATE_FEE_RE.test(item.description || ''),
  }));

  let rows = taggedItems
    .map(
      (item) => `
    <tr>
      <td>${item.trade}${item.isSeparatelyBilled ? ' <em style="font-size:10px;color:#888;">(billed directly)</em>' : ''}</td>
      <td style="text-align:right;">${fmt(item.finalPrice)}</td>
    </tr>`,
    )
    .join('');

  const totalContractValue = pricing.totalContractPrice || data.totalValue || 0;
  const depositPct = pricing.depositPercent || 33;

  // Recalculate from tagged items; fall back to stored pricing if no items matched.
  const separatelyBilledTotal =
    taggedItems.reduce((s, i) => s + (i.isSeparatelyBilled ? i.finalPrice || 0 : 0), 0) ||
    pricing.separatelyBilledTotal ||
    0;
  const depositBase = Math.max(0, totalContractValue - separatelyBilledTotal);
  const depositAmount = Math.round(depositBase * (depositPct / 100));

  rows += `
    <tr class="total">
      <td>TOTAL CONTRACT VALUE</td>
      <td style="text-align:right;">${fmt(totalContractValue)}</td>
    </tr>`;

  if (separatelyBilledTotal > 0) {
    rows += `
    <tr style="color:#555;font-style:italic;font-size:12px;">
      <td>Less: Engineering &amp; Permit Fees (paid directly by owner)</td>
      <td style="text-align:right;">−${fmt(separatelyBilledTotal)}</td>
    </tr>
    <tr style="border-top:1px solid #ccc;">
      <td style="font-weight:600;">BALANCE SUBJECT TO DEPOSIT</td>
      <td style="text-align:right;font-weight:600;">${fmt(depositBase)}</td>
    </tr>`;
  }

  rows += `
    <tr class="deposit">
      <td>DEPOSIT REQUIRED (${depositPct}% of balance)</td>
      <td style="text-align:right;">${fmt(depositAmount)}</td>
    </tr>`;

  const disclosure =
    separatelyBilledTotal > 0
      ? `<p style="margin-top:10px;font-size:10px;color:#666;font-style:italic;line-height:1.5;">
          * Engineering and permit fees listed above are passed through at actual cost with no markup and are
          <strong>not included in the deposit calculation</strong>. These fees are payable directly to the
          applicable municipality or licensed engineer by the owner via a <strong>separate check</strong> at
          the time the permit application is submitted. Preferred Builders General Services Inc. (HIC-197400)
          will coordinate the submission on the owner's behalf.
        </p>`
      : '';

  return `
  <table>
    <tr><th>Trade / Phase</th><th style="text-align:right;">Price</th></tr>
    ${rows}
  </table>
  ${disclosure}`;
}

function buildResponsibilitiesHTML() {
  const items = [
    'Provide clear site access for construction vehicles and material deliveries',
    "Maintain homeowner's insurance during construction period",
    'Make timely progress payments per contract schedule',
    'Submit all material selections no later than framing completion',
    'Provide written approval for any change orders before work begins',
    'Obtain any required easements or property line clearances',
    'Be available for walkthroughs and milestone inspections when scheduled',
  ];
  return `
  <ul class="check-list">
    ${items.map((item) => `<li class="bullet">${item}</li>`).join('')}
  </ul>`;
}

function buildSignatureHTML() {
  return `
  <div class="sig-block">
    <div class="sig-row">
      <div class="sig-field">
        <div class="sig-line"></div>
        <div class="sig-label">Customer Signature</div>
      </div>
      <div class="sig-field">
        <div class="sig-line"></div>
        <div class="sig-label">Date</div>
      </div>
    </div>
    <div class="sig-row">
      <div class="sig-field">
        <div class="sig-line"></div>
        <div class="sig-label">Printed Name</div>
      </div>
      <div class="sig-field">
        <div class="sig-line"></div>
        <div class="sig-label">Phone / Email</div>
      </div>
    </div>
    <div class="sig-row">
      <div class="sig-field">
        <div class="sig-line" style="border-bottom-color:${BRAND_BLUE}"></div>
        <div class="sig-label">Jackson Deaquino — Project Manager, Preferred Builders</div>
      </div>
      <div class="sig-field">
        <div class="sig-line"></div>
        <div class="sig-label">Date</div>
      </div>
    </div>
  </div>`;
}

function buildExhibitAHTML(data, _fmt) {
  const { getDb } = require('../db/database');
  let settings = {};
  try {
    const db = getDb();
    const rows = db.prepare('SELECT key, value FROM settings WHERE category = ?').all('allowance');
    for (const row of rows) {
      try {
        settings[row.key] = JSON.parse(row.value);
      } catch {
        settings[row.key] = row.value;
      }
    }
  } catch {
    /* ignore */
  }

  const customer = data.customer || {};
  const project = data.project || {};
  const quoteNum = data.quoteNumber || '';

  const get = (key, fallback) => {
    const v = settings[key];
    return v && typeof v === 'object' ? v : { amount: fallback, spec: '' };
  };

  const flooring = get('allowance.lvp', 6.5);
  const bathTile = get('allowance.tileBath', 4.5);
  const carpet = get('allowance.carpet', 3.5);
  const cabinets = get('allowance.cabinets', 12000);
  const quartz = get('allowance.quartz', 4250);
  const kitFaucet = get('allowance.kitFaucet', 250);
  const kitSink = get('allowance.kitSink', 350);
  const disposal = get('allowance.disposal', 150);
  const vanityFull = get('allowance.vanity', 650);
  const vanityHalf = get('allowance.vanitySmall', 350);
  const vanityTop = get('allowance.vanityTop', 350);
  const bathFaucet = get('allowance.bathFaucet', 180);
  const toilet = get('allowance.toilet', 280);
  const tub = get('allowance.tub', 850);
  const showerValve = get('allowance.showerValve', 350);
  const showerDoor = get('allowance.showerDoor', 250);
  const bathAccessories = get('allowance.bathAcc', 150);
  const exhaustFan = get('allowance.exhaustFan', 85);
  const intDoor = get('allowance.intDoor', 180);
  const passage = get('allowance.passage', 45);
  const privacy = get('allowance.privacy', 55);
  const bifold = get('allowance.bifold', 175);
  const baseMold = get('allowance.baseMold', 1.85);
  const casing = get('allowance.casing', 1.65);
  const windowStool = get('allowance.windowStool', 85);

  const fmtAmt = (v) => {
    if (typeof v === 'object' && v.amount !== undefined) return v.amount;
    return v;
  };

  return `
<div class="exhibit-header">
  <span class="exhibit-label">EXHIBIT A</span>
  <span class="exhibit-name">CONTRACTOR-GRADE ALLOWANCE SCHEDULE</span>
  <div class="exhibit-sub">${customer.name || ''} | ${project.address || ''} | Quote #${quoteNum}</div>
</div>

<div class="content">
  <p style="font-size:10pt;margin-bottom:12px;">
    The following allowances are included in the Contract Price and represent contractor-grade material pricing
    through Preferred Builders' trade accounts. If Owner selections fall <strong>below</strong> an allowance, the
    difference is applied as a credit on the final invoice. If Owner selections <strong>exceed</strong> an
    allowance, the overage is due and payable by Owner to Contractor <em>prior to purchase of the item</em>
    (see Contract Article II, Clauses 2.3 – 2.4). In the event Contractor elects to advance an overage,
    the reimbursement will appear on the next payment invoice as
    "<strong>Reimbursement to Contractor Budget — Allowance Overage</strong>."
  </p>
  <div class="note-box">
    📌 All selections must be submitted to Preferred Builders in writing no later than framing completion. 
    Late selections may cause project delays and additional costs for which Contractor shall not be liable.
  </div>

  <div class="sub-header">FLOORING</div>
  <table>
    <tr><th>Item</th><th>Location</th><th>Allowance</th><th>Spec</th></tr>
    <tr><td>LVP / Engineered Hardwood</td><td>All living areas</td><td>$${fmtAmt(flooring)}/sq ft</td><td>Supply only — Shaw, Armstrong or equiv</td></tr>
    <tr><td>Bath Floor Tile</td><td>All bathrooms</td><td>$${fmtAmt(bathTile)}/sq ft</td><td>12×12 ceramic or porcelain, supply only</td></tr>
    <tr><td>Carpet</td><td>Bedrooms (if selected)</td><td>$${fmtAmt(carpet)}/sq ft</td><td>Contractor grade, supply only</td></tr>
  </table>

  <div class="sub-header">KITCHEN</div>
  <table>
    <tr><th>Item</th><th>Allowance</th><th>Contractor-Grade Spec</th></tr>
    <tr><td>Cabinets — Base &amp; Upper</td><td>$${Number(fmtAmt(cabinets)).toLocaleString()}</td><td>Stock/semi-stock — Kraftmaid, Yorktowne or equiv</td></tr>
    <tr><td>Countertop — Quartz</td><td>$${Number(fmtAmt(quartz)).toLocaleString()}</td><td>3cm slab — Cambria, MSI or equiv, up to 30 LF</td></tr>
    <tr><td>Kitchen Faucet</td><td>$${fmtAmt(kitFaucet)} each</td><td>Moen, Delta or Kohler — pull-down single handle</td></tr>
    <tr><td>Kitchen Sink</td><td>$${fmtAmt(kitSink)} each</td><td>Stainless undermount 60/40 double bowl</td></tr>
    <tr><td>Garbage Disposal</td><td>$${fmtAmt(disposal)} each</td><td>InSinkErator 1/2 HP contractor grade</td></tr>
  </table>

  <div class="sub-header">BATHROOMS</div>
  <table>
    <tr><th>Item</th><th>Allowance</th><th>Contractor-Grade Spec</th></tr>
    <tr><td>Vanity (full bath)</td><td>$${fmtAmt(vanityFull)} each</td><td>48"–60" stock — Kraftmaid, RSI or equiv</td></tr>
    <tr><td>Vanity (half bath)</td><td>$${fmtAmt(vanityHalf)} each</td><td>24"–36" stock — Kraftmaid, RSI or equiv</td></tr>
    <tr><td>Vanity Top / Cultured Marble</td><td>$${fmtAmt(vanityTop)} each</td><td>Cultured marble or equivalent</td></tr>
    <tr><td>Bath Faucet</td><td>$${fmtAmt(bathFaucet)} each</td><td>Moen, Delta or Kohler — single-handle</td></tr>
    <tr><td>Toilet</td><td>$${fmtAmt(toilet)} each</td><td>American Standard or Kohler — elongated, ADA-height</td></tr>
    <tr><td>Bathtub</td><td>$${fmtAmt(tub)} each</td><td>Alcove steel or acrylic — Kohler, American Standard</td></tr>
    <tr><td>Shower Valve / Trim</td><td>$${fmtAmt(showerValve)} each</td><td>Moen Posi-Temp or Delta Monitor — pressure-balance</td></tr>
    <tr><td>Shower Door</td><td>$${fmtAmt(showerDoor)} each</td><td>Frameless or semi-frameless glass — 36"–48"</td></tr>
    <tr><td>Bath Accessories Set</td><td>$${fmtAmt(bathAccessories)} per bath</td><td>TP holder, towel bar, towel ring — brushed nickel</td></tr>
    <tr><td>Exhaust Fan</td><td>$${fmtAmt(exhaustFan)} each</td><td>Broan or Panasonic — 80 CFM min</td></tr>
  </table>

  <div class="sub-header">DOORS &amp; HARDWARE</div>
  <table>
    <tr><th>Item</th><th>Allowance</th><th>Contractor-Grade Spec</th></tr>
    <tr><td>Interior Door Slab</td><td>$${fmtAmt(intDoor)} each</td><td>6-panel hollow-core or solid-core — primed</td></tr>
    <tr><td>Passage Set</td><td>$${fmtAmt(passage)} each</td><td>Schlage or Kwikset — brushed nickel</td></tr>
    <tr><td>Privacy Set (bath/bedroom)</td><td>$${fmtAmt(privacy)} each</td><td>Schlage or Kwikset — brushed nickel</td></tr>
    <tr><td>Bi-fold Door</td><td>$${fmtAmt(bifold)} each</td><td>6-panel hollow-core — primed</td></tr>
  </table>

  <div class="sub-header">MILLWORK &amp; TRIM</div>
  <table>
    <tr><th>Item</th><th>Allowance</th><th>Spec</th></tr>
    <tr><td>Base Molding</td><td>$${fmtAmt(baseMold)}/LF</td><td>3½" Colonial or Craftsman — finger-jointed pine, primed</td></tr>
    <tr><td>Door/Window Casing</td><td>$${fmtAmt(casing)}/LF</td><td>2¼" Colonial — finger-jointed pine, primed</td></tr>
    <tr><td>Window Stool &amp; Apron</td><td>$${fmtAmt(windowStool)} per window</td><td>Pine — primed and painted</td></tr>
  </table>

  <div class="note-box" style="margin-top:16px;">
    ⚠️ <strong>Allowances represent contractor-grade specifications.</strong> Owner selections exceeding these allowances 
    will require a written Change Order and advance payment of the overage before materials are ordered.
    All allowances are supply-only unless noted otherwise. Installation labor is included in the Contract Price.
  </div>
</div>`;
}

function buildNoticeOfContractHTML({
  customer,
  project,
  quoteNum,
  today,
  total,
  lineItems,
  fmt,
  county = 'Worcester',
}) {
  const workDescription =
    lineItems.map((i) => i.trade).join('; ') || 'General construction and home improvement work';

  const noticeCSS = `
    .notice-page { page-break-before: always; font-family: Arial, sans-serif; }
    .recording-box {
      border: 2px solid #1B3A6B; padding: 14px 18px; margin-bottom: 20px;
      font-size: 9pt; color: #333; line-height: 1.8;
    }
    .recording-box-title {
      font-size: 8pt; font-weight: bold; text-transform: uppercase;
      color: #1B3A6B; letter-spacing: 0.5px; margin-bottom: 6px;
    }
    .notice-title { text-align: center; margin: 16px 0 4px; }
    .notice-title-main { font-size: 18pt; font-weight: bold; color: #1B3A6B; letter-spacing: 1px; }
    .notice-title-sub { font-size: 10pt; color: #555; margin-top: 4px; }
    .notice-divider { border: none; border-top: 2px solid #E07B2A; margin: 12px 0; }
    .notice-field { display: flex; margin: 10px 0; font-size: 10pt; align-items: flex-start; }
    .notice-label { font-weight: bold; color: #1B3A6B; min-width: 200px; flex-shrink: 0; font-size: 9.5pt; padding-top: 2px; }
    .notice-value { flex: 1; border-bottom: 1px solid #999; padding-bottom: 3px; min-height: 22px; line-height: 1.5; }
    .notice-section-title {
      font-size: 10pt; font-weight: bold; background: #1B3A6B; color: white;
      padding: 6px 14px; margin: 18px 0 8px;
    }
    .notary-box { border: 1px solid #ccc; padding: 16px 18px; margin-top: 12px; font-size: 9pt; color: #333; line-height: 2; }
    .notary-box-title { font-weight: bold; font-size: 10pt; color: #1B3A6B; border-bottom: 1px solid #eee; padding-bottom: 6px; margin-bottom: 10px; }
    .notary-field-row { display: flex; gap: 24px; margin-top: 14px; }
    .notary-field { flex: 1; }
    .notary-line { border-bottom: 1px solid #555; height: 28px; margin-bottom: 3px; }
    .notary-label { font-size: 8pt; color: #666; }
    .stamp-area { border: 1px dashed #ccc; height: 80px; margin-top: 14px; display: flex; align-items: center; justify-content: center; color: #aaa; font-size: 9pt; font-style: italic; }
    .notice-sig-row { display: flex; gap: 32px; margin: 12px 0; }
    .notice-sig-field { flex: 1; }
    .notice-sig-line { border-bottom: 1.5px solid #555; height: 36px; margin-bottom: 4px; }
    .notice-sig-label { font-size: 8.5pt; color: #555; }
    .statutory-note { font-size: 8.5pt; color: #555; font-style: italic; border-left: 3px solid #E07B2A; padding: 8px 12px; margin: 12px 0; background: #FFFAF5; line-height: 1.65; }
  `;

  return `
<div class="notice-page" style="padding: 0 56px;">
<style>${noticeCSS}</style>

<div class="recording-box">
  <div class="recording-box-title">For Recording at the ${county} County Registry of Deeds</div>
  <div style="display:flex;gap:40px;font-size:9pt;">
    <div style="flex:1;">
      <div>Book: &nbsp;<span style="display:inline-block;border-bottom:1px solid #999;min-width:80px;">&nbsp;</span></div>
      <div style="margin-top:6px;">Page: &nbsp;<span style="display:inline-block;border-bottom:1px solid #999;min-width:80px;">&nbsp;</span></div>
    </div>
    <div style="flex:1;">
      <div>Document No.: &nbsp;<span style="display:inline-block;border-bottom:1px solid #999;min-width:100px;">&nbsp;</span></div>
      <div style="margin-top:6px;">Date Recorded: &nbsp;<span style="display:inline-block;border-bottom:1px solid #999;min-width:100px;">&nbsp;</span></div>
    </div>
    <div style="flex:1;text-align:right;font-style:italic;color:#888;">Registry use only.<br>Do not write below this line.</div>
  </div>
</div>

<div class="notice-title">
  <div style="font-size:8pt;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Addendum 1 to Construction Contract No. ${quoteNum}</div>
  <div class="notice-title-main">NOTICE OF CONTRACT</div>
  <div class="notice-title-sub">Pursuant to Massachusetts General Laws Chapter 254, Section 4</div>
</div>

<hr class="notice-divider">

<div class="statutory-note">
  This Notice of Contract is filed pursuant to M.G.L. c. 254, §4 to give notice to all persons that the
  Contractor named below has entered into a contract for the improvement of the real property described herein,
  and to preserve the Contractor's right to file a Notice of Contract and assert a mechanic's lien against
  said property in accordance with M.G.L. c. 254. This document should be recorded at the
  ${county} County Registry of Deeds prior to commencement of work.
</div>

<div class="notice-section-title">I. OWNER OF THE PROPERTY</div>
<div class="notice-field"><span class="notice-label">Full Legal Name:</span><span class="notice-value">${customer.name || ''}</span></div>
<div class="notice-field"><span class="notice-label">Address:</span><span class="notice-value">${project.address || ''}, ${project.city || ''}, ${project.state || 'MA'}</span></div>
<div class="notice-field"><span class="notice-label">Phone:</span><span class="notice-value">${customer.phone || ''}</span></div>
<div class="notice-field"><span class="notice-label">Email:</span><span class="notice-value">${customer.email || ''}</span></div>

<div class="notice-section-title">II. CONTRACTOR</div>
<div class="notice-field"><span class="notice-label">Full Legal Name:</span><span class="notice-value">Preferred Builders General Services Inc.</span></div>
<div class="notice-field"><span class="notice-label">Address:</span><span class="notice-value">37 Duck Mill Road, Fitchburg, MA 01420</span></div>
<div class="notice-field"><span class="notice-label">HIC License No.:</span><span class="notice-value">HIC-197400</span></div>
<div class="notice-field"><span class="notice-label">Phone:</span><span class="notice-value">978-377-1784</span></div>
<div class="notice-field"><span class="notice-label">Authorized Representative:</span><span class="notice-value">Jackson Deaquino, Project Manager</span></div>

<div class="notice-section-title">III. PROPERTY SUBJECT TO LIEN</div>
<div class="notice-field"><span class="notice-label">Property Address:</span><span class="notice-value">${project.address || ''}, ${project.city || ''}, ${project.state || 'MA'}</span></div>
<div class="notice-field"><span class="notice-label">County:</span><span class="notice-value">${county} County, Commonwealth of Massachusetts</span></div>
<div class="notice-field"><span class="notice-label">Assessor's Parcel No.:</span><span class="notice-value">${project.parcel_number || '&nbsp;'}</span></div>
<div class="notice-field"><span class="notice-label">Title Reference:</span><span class="notice-value">Book &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;, Page &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;, ${county} County Registry of Deeds</span></div>

<div class="notice-section-title">IV. CONTRACT DETAILS</div>
<div class="notice-field"><span class="notice-label">Contract / Quote No.:</span><span class="notice-value">${quoteNum}</span></div>
<div class="notice-field"><span class="notice-label">Date of Contract:</span><span class="notice-value">${today}</span></div>
<div class="notice-field"><span class="notice-label">Original Contract Price:</span><span class="notice-value"><strong>${fmt(total)}</strong></span></div>
<div class="notice-field"><span class="notice-label">General Description of Work:</span><span class="notice-value">${workDescription}. Work to be performed at the property described in Section III above, as more particularly described in the Project Proposal &amp; Scope of Work, Quote No. ${quoteNum}, incorporated herein by reference.</span></div>

<div class="notice-section-title">V. SIGNATURES</div>
<p style="font-size:9.5pt;color:#333;margin-bottom:14px;line-height:1.6;">
  The undersigned parties hereby certify that the above information is true and accurate and that a Construction
  Contract for the work described herein has been duly executed.
</p>

<div class="notice-sig-row">
  <div class="notice-sig-field"><div class="notice-sig-line"></div><div class="notice-sig-label">Owner Signature</div></div>
  <div class="notice-sig-field"><div class="notice-sig-line"></div><div class="notice-sig-label">Date</div></div>
</div>
<div class="notice-sig-row" style="margin-bottom:20px;">
  <div class="notice-sig-field"><div class="notice-sig-line"></div><div class="notice-sig-label">Owner Printed Name: &nbsp;${customer.name || ''}</div></div>
  <div class="notice-sig-field"><div class="notice-sig-line"></div><div class="notice-sig-label">Phone / Email</div></div>
</div>
<div class="notice-sig-row">
  <div class="notice-sig-field"><div class="notice-sig-line" style="border-color:#1B3A6B;"></div><div class="notice-sig-label">Contractor Authorized Signature</div></div>
  <div class="notice-sig-field"><div class="notice-sig-line"></div><div class="notice-sig-label">Date</div></div>
</div>
<div class="notice-sig-row" style="margin-bottom:24px;">
  <div class="notice-sig-field"><div class="notice-sig-line"></div><div class="notice-sig-label">Printed Name &amp; Title: &nbsp;Jackson Deaquino, Project Manager — Preferred Builders General Services Inc.</div></div>
  <div class="notice-sig-field"><div class="notice-sig-line"></div><div class="notice-sig-label">MA HIC License No. HIC-197400</div></div>
</div>

<div class="notary-box">
  <div class="notary-box-title">Acknowledgment of Owner — Commonwealth of Massachusetts</div>
  <div style="font-size:9pt;line-height:1.9;">
    Commonwealth of Massachusetts<br>
    County of &nbsp;<span style="display:inline-block;border-bottom:1px solid #999;min-width:120px;">&nbsp;</span>&nbsp;&nbsp;ss.<br><br>
    On this &nbsp;<span style="display:inline-block;border-bottom:1px solid #999;min-width:40px;">&nbsp;</span>&nbsp; day of
    &nbsp;<span style="display:inline-block;border-bottom:1px solid #999;min-width:100px;">&nbsp;</span>,
    &nbsp;<span style="display:inline-block;border-bottom:1px solid #999;min-width:60px;">&nbsp;</span>,
    before me, the undersigned notary public, personally appeared
    &nbsp;<span style="display:inline-block;border-bottom:1px solid #999;min-width:180px;">&nbsp;</span>,
    proved to me through satisfactory evidence of identification, which was
    &nbsp;<span style="display:inline-block;border-bottom:1px solid #999;min-width:180px;">&nbsp;</span>,
    to be the person whose name is signed on this document, and acknowledged to me that
    he/she signed it voluntarily for its stated purpose.
  </div>
  <div class="notary-field-row">
    <div class="notary-field"><div class="notary-line"></div><div class="notary-label">Notary Public Signature</div></div>
    <div class="notary-field"><div class="notary-line"></div><div class="notary-label">My Commission Expires</div></div>
    <div class="notary-field"><div class="stamp-area">[ Notary Seal ]</div></div>
  </div>
</div>

<div class="notary-box" style="margin-top:16px;">
  <div class="notary-box-title">Acknowledgment of Contractor — Commonwealth of Massachusetts</div>
  <div style="font-size:9pt;line-height:1.9;">
    Commonwealth of Massachusetts<br>
    County of &nbsp;<span style="display:inline-block;border-bottom:1px solid #999;min-width:120px;">&nbsp;</span>&nbsp;&nbsp;ss.<br><br>
    On this &nbsp;<span style="display:inline-block;border-bottom:1px solid #999;min-width:40px;">&nbsp;</span>&nbsp; day of
    &nbsp;<span style="display:inline-block;border-bottom:1px solid #999;min-width:100px;">&nbsp;</span>,
    &nbsp;<span style="display:inline-block;border-bottom:1px solid #999;min-width:60px;">&nbsp;</span>,
    before me, the undersigned notary public, personally appeared Jackson Deaquino,
    Project Manager of Preferred Builders General Services Inc., proved to me through satisfactory
    evidence of identification, which was
    &nbsp;<span style="display:inline-block;border-bottom:1px solid #999;min-width:180px;">&nbsp;</span>,
    to be the person whose name is signed on this document, and acknowledged to me that
    he signed it voluntarily for its stated purpose as authorized representative of Preferred Builders
    General Services Inc.
  </div>
  <div class="notary-field-row">
    <div class="notary-field"><div class="notary-line"></div><div class="notary-label">Notary Public Signature</div></div>
    <div class="notary-field"><div class="notary-line"></div><div class="notary-label">My Commission Expires</div></div>
    <div class="notary-field"><div class="stamp-area">[ Notary Seal ]</div></div>
  </div>
</div>

<p style="font-size:7.5pt;color:#aaa;text-align:center;margin-top:20px;border-top:1px solid #eee;padding-top:8px;">
  This Notice of Contract is prepared in connection with Construction Contract No. ${quoteNum} between 
  Preferred Builders General Services Inc. (HIC-197400) and ${customer.name || ''}.
  After execution and notarization, file the original at the ${county} County Registry of Deeds.
  Retain a copy in your project records.
</p>

</div>`;
}

module.exports = {
  baseCSS,
  buildProposalHTML,
  buildScopeHTML,
  buildExclusionsHTML,
  buildPermitChecklistHTML,
  buildCostSummaryHTML,
  buildResponsibilitiesHTML,
  buildSignatureHTML,
  buildExhibitAHTML,
  buildNoticeOfContractHTML,
};
