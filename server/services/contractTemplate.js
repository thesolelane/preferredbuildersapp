/**
 * server/services/contractTemplate.js
 * Preferred Builders General Services Inc.
 *
 * New contract HTML builder — replaces the old buildContractHTML.
 * Imported and called by pdfService.js.
 *
 * Exports:
 *   buildContractHTML(data)          — data in new schema (see adaptToContractSchema)
 *   adaptToContractSchema(legacyData) — maps old job data → new schema
 */
'use strict';

const { selectMilestones, selectPreConAdvances } = require('./milestoneSelector');

// ─── Tiny helpers ─────────────────────────────────────────────────────────────

const f = (val, fallback = '') =>
  val !== undefined && val !== null && val !== '' ? val : fallback;

const field = (v) => `<span class="fld">${f(v, '&nbsp;')}</span>`;

const clauseHTML = (num, html) =>
  `<div class="clause"><span class="cn">${num}</span><span class="cb">${html}</span></div>`;

const sigBlock = (title, lines) => `
  <div class="sig-col">
    <div class="sig-head">${title}</div>
    ${lines
      .map(
        (l) => `
      <div class="sig-line"></div>
      <div class="sig-label">${l.label}</div>
      ${l.printed ? `<div class="sig-printed">${l.printed}</div>` : ''}
    `,
      )
      .join('')}
  </div>`;

// ─── CSS ──────────────────────────────────────────────────────────────────────

const css = () => `
  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 9.5pt;
    color: #1a1a2e;
    background: #fff;
    line-height: 1.55;
  }

  /* ── Page layout ── */
  @page { size: letter; margin: 18mm 18mm 20mm 18mm; }

  /* ── Running header / footer ── */
  #page-header {
    width: 100%;
    border-bottom: 2.5px solid #1F3864;
    padding-bottom: 5px;
    margin-bottom: 8px;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
  }
  #page-header .co-name  { font-size: 8.5pt; font-weight: 700; color: #1F3864; }
  #page-header .co-sub   { font-size: 7pt;   color: #666;  margin-top: 1px; }
  #page-header .doc-type { font-size: 7.5pt; color: #888;  font-style: italic; text-align: right; }

  #page-footer {
    width: 100%;
    border-top: 1.5px solid #C8D4E4;
    padding-top: 4px;
    display: flex;
    justify-content: space-between;
    font-size: 7pt;
    color: #9AA4B8;
    margin-top: 30px;
  }

  /* ── Title block ── */
  .doc-title { text-align: center; margin: 8px 0 20px; }
  .doc-title h1 {
    font-size: 20pt; font-weight: 800; color: #1F3864;
    letter-spacing: 1px; text-transform: uppercase; line-height: 1.15;
  }
  .doc-title .subtitle { font-size: 8.5pt; color: #777; font-style: italic; margin-top: 4px; }

  /* ── Rules ── */
  .rule       { border: none; border-top: 3px solid #1F3864; margin: 14px 0; }
  .rule-light { border: none; border-top: 1px solid #C8D4E4; margin: 10px 0; }

  /* ── Cover info table ── */
  .cover-table { width: 100%; border-collapse: collapse; margin: 12px 0; }
  .cover-table td { padding: 6px 10px; font-size: 9pt; border-bottom: 1px solid #D0D8E8; vertical-align: middle; }
  .cover-table .label { background: #DCE9F5; color: #1F3864; font-weight: 700; width: 30%; font-size: 8.5pt; }

  /* ── Parties ── */
  .parties { display: flex; gap: 24px; margin: 16px 0 12px; }
  .party-col { flex: 1; }
  .party-col .party-head {
    font-weight: 700; font-size: 9pt; color: #1F3864; text-transform: uppercase;
    letter-spacing: 0.5px; margin-bottom: 6px; border-bottom: 1.5px solid #C8D4E4; padding-bottom: 3px;
  }
  .party-col p { font-size: 9pt; line-height: 1.6; color: #222; }

  /* ── Recital ── */
  .recital { font-size: 9pt; text-align: justify; margin: 10px 0 14px; line-height: 1.6; }

  /* ── Articles ── */
  .article-heading {
    font-size: 10.5pt; font-weight: 800; color: #1F3864; text-transform: uppercase;
    letter-spacing: 0.6px; margin: 20px 0 8px; padding-bottom: 4px; border-bottom: 2px solid #C8D4E4;
  }
  .sub-heading { font-size: 9.5pt; font-weight: 700; color: #1F3864; margin: 14px 0 6px; }

  /* ── Clauses ── */
  .clause { display: flex; gap: 10px; margin: 7px 0; text-align: justify; font-size: 9pt; line-height: 1.6; padding-left: 16px; }
  .clause .cn { font-weight: 700; color: #1F3864; min-width: 28px; flex-shrink: 0; font-size: 8.5pt; padding-top: 1px; }
  .clause .cb { flex: 1; }

  /* ── Data tables ── */
  table.data-table { width: 100%; border-collapse: collapse; font-size: 8.5pt; margin: 10px 0; }
  table.data-table th { background: #1F3864; color: #fff; padding: 7px 9px; font-weight: 600; font-size: 8pt; text-align: left; border: 1px solid #B8C4D4; }
  table.data-table td { padding: 7px 9px; border: 1px solid #B8C4D4; vertical-align: top; line-height: 1.5; }
  table.data-table tr:nth-child(even) td { background: #F3F5F8; }
  table.data-table tr:nth-child(odd)  td { background: #fff; }
  table.data-table .total-row td { background: #1F3864 !important; color: #fff; font-weight: 700; }
  table.data-table .milestone-title { font-weight: 600; margin-bottom: 3px; }
  table.data-table .milestone-note  { font-size: 7.5pt; color: #555; font-style: italic; }
  table.data-table .milestone-law   { font-size: 7.5pt; color: #1F3864; font-style: italic; margin-top: 2px; }

  /* ── Allowance sections ── */
  .allow-section { font-weight: 700; font-size: 8.5pt; color: #1F3864; text-transform: uppercase; letter-spacing: 0.5px; margin: 14px 0 4px; }

  /* ── Signatures ── */
  .sig-grid { display: flex; gap: 30px; margin: 16px 0; }
  .sig-col { flex: 1; }
  .sig-col .sig-head { font-weight: 700; font-size: 9pt; color: #1F3864; text-transform: uppercase; margin-bottom: 10px; border-bottom: 1.5px solid #C8D4E4; padding-bottom: 3px; }
  .sig-line { border-top: 1.5px solid #888; margin-top: 36px; margin-bottom: 3px; }
  .sig-label { font-size: 7.5pt; color: #888; font-style: italic; }
  .sig-printed { font-size: 8.5pt; color: #333; margin-top: 2px; }

  /* ── Initials bar ── */
  .initials-bar { display: flex; gap: 0; border: 1px solid #B8C4D4; margin: 10px 0; }
  .initials-bar .init-cell { flex: 1; padding: 9px 14px; font-size: 9pt; background: #F3F5F8; border-right: 1px solid #B8C4D4; }
  .initials-bar .init-cell:last-child { border-right: none; }

  /* ── Notice callout ── */
  .notice { background: #EBF3FB; border-left: 4px solid #1F3864; padding: 9px 12px; font-size: 8.5pt; margin: 10px 0; line-height: 1.6; }

  /* ── Registry grid ── */
  .registry-grid { display: flex; gap: 0; margin: 10px 0; }
  .registry-grid .reg-cell { flex: 1; background: #DCE9F5; border: 1px solid #B8C4D4; padding: 10px; font-size: 8.5pt; }
  .registry-grid .reg-cell .reg-label { font-weight: 700; color: #1F3864; }
  .registry-grid .reg-cell .reg-value { margin-top: 18px; border-top: 1px solid #B8C4D4; }

  /* ── Page break ── */
  .page-break { page-break-before: always; }

  /* ── Addendum title ── */
  .addendum-title { text-align: center; margin: 8px 0 16px; }
  .addendum-title h2 { font-size: 13pt; font-weight: 800; color: #1F3864; text-transform: uppercase; }
  .addendum-title .add-sub { font-size: 8.5pt; color: #777; font-style: italic; margin-top: 4px; }

  /* ── Field placeholder ── */
  .fld { color: #8090A8; font-style: italic; }

  /* ── Bullet lists ── */
  ul.clause-list { margin: 6px 0 6px 28px; font-size: 9pt; line-height: 1.6; }
  ul.clause-list li { margin-bottom: 4px; }

  /* ── Notary ── */
  .notary-block { margin: 14px 0; font-size: 9pt; line-height: 1.7; text-align: justify; }
  .notary-block .notary-title { font-weight: 700; margin-bottom: 6px; }
  .notary-sig-line { border-top: 1.5px solid #888; margin-top: 30px; margin-bottom: 3px; width: 60%; }
`;

// ─── Section builders ─────────────────────────────────────────────────────────

function buildPaymentTable(data) {
  const d = data.contract || {};
  const job = data.job || {};
  const milestones = selectMilestones(job);

  const depositRow = `
    <tr>
      <td style="font-weight:700;width:28px;text-align:center">1</td>
      <td>
        <div class="milestone-title">Contract Deposit</div>
        <div class="milestone-note">Due upon execution of Agreement, before Work commences.</div>
        <div class="milestone-law">Per M.G.L. c. 142A §2: deposit ≤ 1/3 of Contract Price. Invoice 1 separately itemizes Contract Deposit and Pre-Construction Advances (permits, engineering, sub deposits). See Article 3.3.</div>
      </td>
      <td style="white-space:nowrap">≤ 1/3</td>
      <td>${field(d.invoice_number)}</td>
      <td>${field(d.deposit_pct)}</td>
      <td style="white-space:nowrap">${field(d.deposit_amount)}</td>
    </tr>`;

  const middleRows = milestones
    .map(
      (m, i) => `
    <tr>
      <td style="font-weight:700;text-align:center">${i + 2}</td>
      <td>
        <div class="milestone-title">${m.title}</div>
        <div class="milestone-note">${m.description}</div>
      </td>
      <td>${f(m.share)}</td>
      <td>${f(m.invoiceRef)}</td>
      <td>${f(m.share)}</td>
      <td>${f(m.amount)}</td>
    </tr>`,
    )
    .join('');

  const finalRow = `
    <tr>
      <td style="font-weight:700;text-align:center">★</td>
      <td>
        <div class="milestone-title">Substantial Completion</div>
        <div class="milestone-note">Issuance of Certificate of Occupancy (where required) by applicable building department, or written Owner sign-off on all punch list items where CO is not required.</div>
      </td>
      <td>${field(job.final_milestone_share)}</td>
      <td>${field(job.final_invoice_number)}</td>
      <td>${field(job.final_milestone_share)}</td>
      <td>${field(job.final_milestone_amount)}</td>
    </tr>`;

  const totalRow = `
    <tr class="total-row">
      <td colspan="3">TOTAL CONTRACT PRICE</td>
      <td>100%</td>
      <td></td>
      <td>${field(d.total_contract_price)}</td>
    </tr>`;

  return `
    <table class="data-table">
      <thead>
        <tr>
          <th style="width:28px">#</th>
          <th>Milestone / Trigger Event</th>
          <th style="width:60px">Share</th>
          <th style="width:130px">Invoice Ref.</th>
          <th style="width:60px">% of Total</th>
          <th style="width:90px">Amount Due</th>
        </tr>
      </thead>
      <tbody>
        ${depositRow}
        ${middleRows}
        ${finalRow}
        ${totalRow}
      </tbody>
    </table>`;
}

function buildPreConTable(data) {
  const advances = selectPreConAdvances(data.job || {});
  if (!advances.length) return '';

  const rows = advances
    .map((a) => {
      const isPb = a.paid_by !== 'customer_direct';
      const respBadge = isPb
        ? `<span style="background:#fffbeb;color:#92400e;border:1px solid #fbbf24;padding:1px 6px;border-radius:10px;font-size:7.5pt;font-weight:bold;white-space:nowrap;">PB Fronts → Owner Reimburses</span>`
        : `<span style="background:#f0fdf4;color:#166534;border:1px solid #86efac;padding:1px 6px;border-radius:10px;font-size:7.5pt;font-weight:bold;white-space:nowrap;">Owner Pays Vendor Directly</span>`;
      return `
    <tr>
      <td>${a.item}</td>
      <td style="font-size:8pt;color:#555">${a.detail}</td>
      <td style="text-align:center">${respBadge}</td>
      <td style="text-align:right">${a.amount}</td>
    </tr>`;
    })
    .join('');

  return `
    <table class="data-table">
      <thead>
        <tr>
          <th style="width:32%">Pre-Construction Item</th>
          <th>Detail / Basis</th>
          <th style="width:170px;text-align:center">Who Pays</th>
          <th style="width:90px;text-align:right">Est. Amount</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function buildTradeTable(data) {
  const trades =
    data.trades && data.trades.length ? data.trades : [{ phase: '', description: '', value: '' }];

  const rows = trades
    .map(
      (t) => `
    <tr>
      <td>${f(t.phase)}</td>
      <td>${f(t.description)}</td>
      <td style="text-align:right">${f(t.value)}</td>
    </tr>`,
    )
    .join('');

  return `
    <table class="data-table">
      <thead>
        <tr>
          <th style="width:30%">Trade / Phase</th>
          <th>Description</th>
          <th style="width:120px;text-align:right">Contract Value</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
        <tr class="total-row">
          <td colspan="2">TOTAL CONTRACT PRICE</td>
          <td style="text-align:right">${field((data.contract || {}).total_contract_price)}</td>
        </tr>
      </tbody>
    </table>`;
}

function buildAllowanceTables(data) {
  const al = data.allowances || {};

  const section = (title, rows) => {
    const filtered = rows.filter((r) => al[r.key] !== false);
    if (!filtered.length) return '';
    return `
      <div class="allow-section">${title}</div>
      <table class="data-table">
        <thead><tr><th>Item</th><th>Location / Notes</th><th style="width:100px">Allowance</th><th>Spec</th></tr></thead>
        <tbody>${filtered.map((r) => `<tr><td>${r.item}</td><td>${r.loc || ''}</td><td>${r.allowance}</td><td style="font-size:8pt;color:#555">${r.spec}</td></tr>`).join('')}</tbody>
      </table>`;
  };

  return [
    section('FLOORING', [
      {
        key: 'flooring_lvp',
        item: 'LVP / Engineered Hardwood',
        loc: 'All living areas',
        allowance: '$6.50/sq ft',
        spec: 'Shaw, Armstrong or equiv — supply only',
      },
      {
        key: 'flooring_tile',
        item: 'Bath Floor Tile',
        loc: 'All bathrooms',
        allowance: '$4.50/sq ft',
        spec: '12×12 ceramic or porcelain, supply only',
      },
      {
        key: 'flooring_carpet',
        item: 'Carpet',
        loc: 'Bedrooms (if selected)',
        allowance: '$3.50/sq ft',
        spec: 'Contractor grade, supply only',
      },
    ]),
    section('KITCHEN', [
      {
        key: 'kitchen_cabinets',
        item: 'Cabinets — Base & Upper',
        allowance: '$12,000',
        spec: 'Stock/semi-stock — Kraftmaid, Yorktowne or equiv',
      },
      {
        key: 'kitchen_counter',
        item: 'Countertop — Quartz',
        allowance: '$4,250',
        spec: '3cm slab — Cambria, MSI or equiv, up to 30 LF',
      },
      {
        key: 'kitchen_faucet',
        item: 'Kitchen Faucet',
        allowance: '$250 each',
        spec: 'Moen, Delta or Kohler — pull-down single handle',
      },
      {
        key: 'kitchen_sink',
        item: 'Kitchen Sink',
        allowance: '$350 each',
        spec: 'Stainless undermount 60/40 double bowl',
      },
      {
        key: 'kitchen_disposal',
        item: 'Garbage Disposal',
        allowance: '$150 each',
        spec: 'InSinkErator 1/2 HP contractor grade',
      },
    ]),
    section('BATHROOMS', [
      {
        key: 'bath_vanity_full',
        item: 'Vanity (full bath)',
        allowance: '$650 each',
        spec: '48"–60" stock — Kraftmaid, RSI or equiv',
      },
      {
        key: 'bath_vanity_half',
        item: 'Vanity (half bath)',
        allowance: '$350 each',
        spec: '24"–30" stock',
      },
      {
        key: 'bath_vanity_top',
        item: 'Vanity Top / Sink',
        allowance: '$350 each',
        spec: 'Cultured marble integrated',
      },
      {
        key: 'bath_faucet',
        item: 'Bath Faucet',
        allowance: '$180 each',
        spec: 'Moen Adler or Delta Foundations',
      },
      {
        key: 'bath_toilet',
        item: 'Toilet',
        allowance: '$280 each',
        spec: 'Kohler Cimarron or Am Std — elongated 1.28 GPF',
      },
      {
        key: 'bath_tub',
        item: 'Bathtub',
        allowance: '$850 each',
        spec: 'Alcove 60" — American Standard or Kohler',
      },
      {
        key: 'bath_shower_valve',
        item: 'Shower Valve & Trim',
        allowance: '$350 each',
        spec: 'Moen Posi-Temp or Delta Monitor',
      },
      {
        key: 'bath_shower_door',
        item: 'Shower Door',
        allowance: '$250 each',
        spec: 'Frameless bypass or curtain rod',
      },
      {
        key: 'bath_accessories',
        item: 'Bath Accessories',
        allowance: '$150/set',
        spec: 'TP holder, towel bar, robe hook — matching set',
      },
      {
        key: 'bath_exhaust_fan',
        item: 'Exhaust Fan',
        allowance: '$85 each',
        spec: 'Broan or Panasonic — 80 CFM min (Stretch Code)',
      },
    ]),
    section('DOORS & HARDWARE', [
      {
        key: 'doors_interior',
        item: 'Interior Door',
        allowance: '$180 each',
        spec: 'Hollow/solid core — 6-panel primed — Masonite or equiv',
      },
      {
        key: 'doors_passage',
        item: 'Passage Set',
        allowance: '$45 each',
        spec: 'Kwikset or Schlage — satin nickel',
      },
      {
        key: 'doors_privacy',
        item: 'Privacy Set (bath/bed)',
        allowance: '$55 each',
        spec: 'Kwikset or Schlage lockset',
      },
      {
        key: 'doors_bifold',
        item: 'Bifold Door',
        allowance: '$175 each',
        spec: '6-panel primed white',
      },
      {
        key: 'doors_base_molding',
        item: 'Base Molding',
        allowance: '$1.85/LF',
        spec: '3-1/4" colonial or craftsman primed MDF',
      },
      {
        key: 'doors_casing',
        item: 'Door/Window Casing',
        allowance: '$1.65/LF',
        spec: '2-1/4" colonial primed MDF',
      },
      {
        key: 'doors_window_stool',
        item: 'Window Stool & Apron',
        allowance: '$85 each',
        spec: 'Primed MDF',
      },
    ]),
  ].join('');
}

// ─── Milestone distribution calculator ───────────────────────────────────────
// Distributes contract price across milestones returned by selectMilestones().
// Returns milestoneShares, milestoneAmounts, and invoiceNumbers keyed by milestone code.

function calculateMilestoneDistribution(job, totalContractPrice, depositAmount, quoteNumber) {
  const milestones = selectMilestones(job);
  if (!milestones.length) return {};

  const qn = quoteNumber || '';
  const fmt = (n) => `$${Number(Math.round(n)).toLocaleString()}`;
  const pct = (n) => `${Math.round(n)}%`;

  // Final SC milestone gets 1% (or $1,000 min)
  const finalAmt = Math.max(Math.round(totalContractPrice * 0.01), 1000);
  const finalPct = Math.round((finalAmt / totalContractPrice) * 100);

  // Remaining after deposit and final SC
  const middleTotal = totalContractPrice - depositAmount - finalAmt;
  const perMilestone = milestones.length > 0 ? Math.round(middleTotal / milestones.length) : 0;

  const milestoneShares = {};
  const milestoneAmounts = {};
  const invoiceNumbers = {};

  milestones.forEach((m, idx) => {
    const invoiceIdx = idx + 2; // Invoice 1 = deposit
    milestoneShares[m.code] = pct((perMilestone / totalContractPrice) * 100);
    milestoneAmounts[m.code] = fmt(perMilestone);
    invoiceNumbers[m.code] = qn
      ? `INV-${qn}-${String(invoiceIdx).padStart(3, '0')}`
      : `Invoice No. ${invoiceIdx}`;
  });

  const finalInvoiceIdx = milestones.length + 2;

  return {
    milestoneShares,
    milestoneAmounts,
    invoiceNumbers,
    final_milestone_share: pct(finalPct),
    final_milestone_amount: fmt(finalAmt),
    final_invoice_number: qn
      ? `INV-${qn}-${String(finalInvoiceIdx).padStart(3, '0')}`
      : `Invoice No. ${finalInvoiceIdx}`,
  };
}

// ─── Data adapter: maps extracted proposal data → new contract schema ─────────

function adaptToContractSchema(data) {
  const fmt = (n) => (n ? `$${Number(n).toLocaleString()}` : '');
  const customer = data.customer || {};
  const project = data.project || {};
  const pricing = data.pricing || {};
  const lineItems = data.lineItems || [];
  const jobRaw = data.job || {};
  const today = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'America/New_York',
  });

  // Project type — prefer explicit field, fall back to trade-name inference
  const allTrades = lineItems.map((i) => (i.trade || '').toLowerCase()).join(' ');
  let jobType = project.type || 'renovation';
  if (!project.type) {
    if (/new.?construct|foundation.*new|new.?build/i.test(allTrades)) jobType = 'new_construction';
    if (/\badu\b|accessory.?dwelling/i.test(allTrades)) jobType = 'adu';
  }

  const totalVal = pricing.totalContractPrice || data.totalValue || 0;
  const depositVal = pricing.depositAmount || data.depositAmount || 0;
  const depositPct = pricing.depositPercent || 33;
  const qn = data.quoteNumber || '';

  // Jurisdiction: prefer explicit field, fall back to "City/Town of <city>"
  const jurisdiction = project.jurisdiction || (project.city ? `City of ${project.city}` : '');

  // Owner address: use explicit if provided, otherwise blank (≠ property address)
  const ownerAddr1 = customer.address_line1 || '';
  const ownerCSZ =
    customer.city_state_zip ||
    (ownerAddr1 ? [project.city, project.state || 'MA'].filter(Boolean).join(', ') : '');

  // Job flags: prefer explicit fields from extraction, fall back to trade-name inference
  const job = {
    type: jobType,
    has_demo: jobRaw.has_demo !== undefined ? jobRaw.has_demo : /demo|demolition/i.test(allTrades),
    has_framing: jobRaw.has_framing !== undefined ? jobRaw.has_framing : /\bfram/i.test(allTrades),
    has_insulation:
      jobRaw.has_insulation !== undefined ? jobRaw.has_insulation : /insul/i.test(allTrades),
    has_permit: jobRaw.has_permit !== undefined ? jobRaw.has_permit : /permit/i.test(allTrades),
    permit_fee: jobRaw.permit_fee || '',
    permit_paid_by: jobRaw.permit_paid_by || 'pb',
    has_engineer: jobRaw.has_engineer || false,
    engineer_fee: jobRaw.engineer_fee || '',
    engineer_paid_by: jobRaw.engineer_paid_by || 'pb',
    has_architect: jobRaw.has_architect || false,
    architect_fee: jobRaw.architect_fee || '',
    architect_paid_by: jobRaw.architect_paid_by || 'pb',
    sub_deposits: jobRaw.sub_deposits || null,
    special_order_deposits: jobRaw.special_order_deposits || null,
    trades: {
      electrical:
        jobRaw.trades?.electrical !== undefined
          ? jobRaw.trades.electrical
          : /electric/i.test(allTrades),
      plumbing:
        jobRaw.trades?.plumbing !== undefined ? jobRaw.trades.plumbing : /plumb/i.test(allTrades),
      hvac:
        jobRaw.trades?.hvac !== undefined
          ? jobRaw.trades.hvac
          : /hvac|heat|cool|mechanic/i.test(allTrades),
      sprinkler: jobRaw.trades?.sprinkler || false,
    },
    adu: jobRaw.adu || {
      on_septic: false,
      separate_metering: false,
      site_plan_required: false,
      new_sewer_connection: false,
    },
  };

  // Calculate milestone distribution from actual pricing
  const dist = totalVal > 0 ? calculateMilestoneDistribution(job, totalVal, depositVal, qn) : {};

  Object.assign(job, dist);

  // Allowances: use extracted flags if present, otherwise all false
  const rawAllow = data.allowances || {};
  const allowances = {
    flooring_lvp: rawAllow.flooring_lvp || false,
    flooring_tile: rawAllow.flooring_tile || false,
    flooring_carpet: rawAllow.flooring_carpet || false,
    kitchen_cabinets: rawAllow.kitchen_cabinets || false,
    kitchen_counter: rawAllow.kitchen_counter || false,
    kitchen_faucet: rawAllow.kitchen_faucet || false,
    kitchen_sink: rawAllow.kitchen_sink || false,
    kitchen_disposal: rawAllow.kitchen_disposal || false,
    bath_vanity_full: rawAllow.bath_vanity_full || false,
    bath_vanity_half: rawAllow.bath_vanity_half || false,
    bath_vanity_top: rawAllow.bath_vanity_top || false,
    bath_faucet: rawAllow.bath_faucet || false,
    bath_toilet: rawAllow.bath_toilet || false,
    bath_tub: rawAllow.bath_tub || false,
    bath_shower_valve: rawAllow.bath_shower_valve || false,
    bath_shower_door: rawAllow.bath_shower_door || false,
    bath_accessories: rawAllow.bath_accessories || false,
    bath_exhaust_fan: rawAllow.bath_exhaust_fan || false,
    doors_interior: rawAllow.doors_interior || false,
    doors_passage: rawAllow.doors_passage || false,
    doors_privacy: rawAllow.doors_privacy || false,
    doors_bifold: rawAllow.doors_bifold || false,
    doors_base_molding: rawAllow.doors_base_molding || false,
    doors_casing: rawAllow.doors_casing || false,
    doors_window_stool: rawAllow.doors_window_stool || false,
  };

  return {
    contract: {
      contract_number: qn ? `PB-${qn}` : '',
      invoice_number: qn ? `INV-${qn}-001` : '',
      quote_number: qn,
      proposal_date: today,
      contract_date: today,
      total_contract_price: fmt(totalVal),
      deposit_amount: fmt(depositVal),
      deposit_pct: `${depositPct}%`,
      csl_number: data.csl_number || 'CS-121662',
    },
    owner: {
      full_name: customer.name || '',
      address_line1: ownerAddr1,
      city_state_zip: ownerCSZ,
      phone: customer.phone || '',
      email: customer.email || '',
    },
    property: {
      address: project.address || '',
      city: project.city || '',
      jurisdiction: jurisdiction,
      parcel_number: project.parcel_number || '',
    },
    job,
    trades: lineItems.map((item) => ({
      phase: item.trade || '',
      description: item.description || (item.scopeIncluded || []).slice(0, 3).join('; ') || '',
      value: item.finalPrice ? fmt(item.finalPrice) : item.totalCost ? fmt(item.totalCost) : '',
    })),
    allowances,
  };
}

// ─── Blank data for template download ────────────────────────────────────────

function blankContractSchema() {
  const _ = '___________________________________';
  return {
    contract: {
      contract_number: '____________',
      invoice_number: '____________',
      quote_number: '____________',
      proposal_date: _,
      contract_date: _,
      total_contract_price: '$__________',
      deposit_amount: '$__________',
      deposit_pct: '___%',
      csl_number: 'CS-121662',
    },
    owner: { full_name: _, address_line1: _, city_state_zip: _, phone: _, email: _ },
    property: { address: _, city: _, jurisdiction: _, parcel_number: _ },
    job: {
      type: 'renovation',
      has_demo: false,
      has_framing: true,
      has_insulation: true,
      has_permit: false,
      has_engineer: false,
      has_architect: false,
      sub_deposits: null,
      special_order_deposits: null,
      trades: { electrical: true, plumbing: true, hvac: false, sprinkler: false },
      adu: {},
    },
    trades: [{ phase: '', description: '', value: '' }],
    allowances: {
      flooring_lvp: true,
      flooring_tile: true,
      flooring_carpet: false,
      kitchen_cabinets: true,
      kitchen_counter: true,
      kitchen_faucet: true,
      kitchen_sink: true,
      kitchen_disposal: true,
      bath_vanity_full: true,
      bath_vanity_half: true,
      bath_vanity_top: true,
      bath_faucet: true,
      bath_toilet: true,
      bath_tub: true,
      bath_shower_valve: true,
      bath_shower_door: true,
      bath_accessories: true,
      bath_exhaust_fan: true,
      doors_interior: true,
      doors_passage: true,
      doors_privacy: true,
      doors_bifold: false,
      doors_base_molding: true,
      doors_casing: true,
      doors_window_stool: true,
    },
  };
}

// ─── Main HTML builder ────────────────────────────────────────────────────────

function buildContractHTML(data) {
  const c = data.contract || {};
  const o = data.owner || {};
  const p = data.property || {};
  const job = data.job || {};

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Home Improvement Construction Contract — ${f(c.contract_number)}</title>
  <style>${css()}</style>
</head>
<body>

<!-- Header -->
<div id="page-header">
  <div>
    <div class="co-name">Preferred Builders General Services Inc.</div>
    <div class="co-sub">LIC# HIC-197400  |  37 Duck Mill Road, Fitchburg, MA 01420  |  978-377-1784</div>
  </div>
  <div class="doc-type">Home Improvement Construction Contract<br>M.G.L. c. 142A  |  780 CMR Compliant</div>
</div>

<!-- Title -->
<div class="doc-title">
  <h1>Home Improvement<br>Construction Contract</h1>
  <div class="subtitle">Commonwealth of Massachusetts  |  M.G.L. c. 142A  |  780 CMR</div>
</div>

<hr class="rule">

<!-- Cover Table -->
<table class="cover-table">
  <tr><td class="label">Property Address</td>    <td class="value">${field(p.address)}</td></tr>
  <tr><td class="label">Owner Name</td>           <td class="value">${field(o.full_name)}</td></tr>
  <tr><td class="label">Contract No.</td>         <td class="value">${field(c.contract_number)}</td></tr>
  <tr><td class="label">Invoice No.</td>          <td class="value">${field(c.invoice_number)}</td></tr>
  <tr><td class="label">S.O.W. Proposal No.</td>   <td class="value">${field(c.quote_number)}</td></tr>
  <tr><td class="label">Date of Agreement</td>    <td class="value">${field(c.contract_date)}</td></tr>
  <tr><td class="label">Total Contract Price</td> <td class="value"><strong>${field(c.total_contract_price)}</strong></td></tr>
</table>

<hr class="rule">

<!-- Parties -->
<div class="parties">
  <div class="party-col">
    <div class="party-head">Contractor</div>
    <p><strong>Preferred Builders General Services Inc.</strong><br>
    Massachusetts HIC License No. HIC-197400<br>
    37 Duck Mill Road, Fitchburg, MA 01420<br>
    Tel: 978-377-1784<br>
    jackson.deaquino@preferredbuildersusa.com</p>
  </div>
  <div class="party-col">
    <div class="party-head">Owner</div>
    <p>${field(o.full_name)}<br>
    ${field(o.address_line1)}<br>
    ${field(o.city_state_zip)}<br>
    Tel: ${field(o.phone)}<br>
    ${field(o.email)}</p>
  </div>
</div>

<p class="recital">
  This Home Improvement Construction Agreement ("<strong>Agreement</strong>" or "<strong>Contract</strong>") is made and entered into
  as of ${field(c.contract_date)}, by and between <strong>Preferred Builders General Services Inc.</strong>,
  a Massachusetts corporation, HIC License No. HIC-197400 ("<strong>Contractor</strong>"), and
  ${field(o.full_name)}, owner of the property located at ${field(p.address)} ("<strong>Owner</strong>").
</p>

<!-- ARTICLE I -->
<hr class="rule">
<div class="article-heading">Article I — The Work</div>

${clauseHTML('1.1', `Contractor shall furnish all labor, materials, equipment, tools, supervision, and services necessary to complete the work (the "<strong>Work</strong>") at the Property in a good and workmanlike manner, in accordance with this Contract and all applicable laws, codes, and regulations, including <strong>780 CMR (Massachusetts State Building Code), as in effect on the date of permit application, including all Massachusetts amendments thereto</strong>, applicable municipal codes, NFPA 70 (National Electrical Code), and all other applicable federal, state, and local laws, ordinances, rules, and regulations.`)}

${clauseHTML('1.2', `The scope, inclusions, and exclusions of the Work are described in the <strong>Project Proposal &amp; Scope of Work, Proposal No. ${field(c.quote_number)}</strong>, dated <strong>${field(c.proposal_date)}</strong>, and <strong>Invoice No. ${field(c.invoice_number)}</strong> (collectively, the "<strong>Proposal</strong>"), which are incorporated herein by reference. In any conflict between this Contract and the Proposal, the terms of this Contract shall govern.`)}

${clauseHTML('1.3', `<strong>Building Code Compliance — Mandatory.</strong> Contractor shall perform all Work in strict compliance with 780 CMR, local amendments, NFPA 70, and all other applicable codes. Contractor shall not be required, directed, or instructed to perform any work that is not in compliance with applicable building codes. Any provision of the Proposal, any Change Order, or any Owner instruction requiring non-code-compliant work shall be void and unenforceable. Contractor shall promptly notify Owner in writing of any such direction and shall not proceed until a code-compliant solution is agreed upon in writing.`)}

${clauseHTML('1.4', `<strong>Code-Required Upgrades.</strong> If code compliance requires work beyond the scope originally contemplated, Contractor shall notify Owner in writing and the parties shall execute a Change Order per Article IV. Contractor's obligation to perform code-compliant work is not affected by cost or any Owner instruction to the contrary.`)}

${clauseHTML('1.5', `The following table summarizes phases and trade values included under this Contract. For trade-by-trade inclusions, exclusions, and specifications, Owner shall refer to the Proposal.`)}

${buildTradeTable(data)}

<!-- ARTICLE II -->
<hr class="rule">
<div class="article-heading">Article II — Contract Price</div>

${clauseHTML('2.1', `Owner agrees to pay Contractor the total sum of <strong>${field(c.total_contract_price)}</strong> (the "<strong>Contract Price</strong>") for full and satisfactory completion of the Work, subject to additions and deductions for Change Orders per Article IV.`)}
${clauseHTML('2.2', `The Contract Price includes contractor-grade material allowances as set forth in <strong>Exhibit A — Contractor-Grade Allowance Schedule</strong>, attached hereto and incorporated herein. Credits for Owner selections that fall below an allowance amount shall be applied to the final invoice.`)}
${clauseHTML('2.3', `<strong>Allowance Overages — Pre-Payment Required.</strong> Any Owner selection exceeding an applicable allowance shall result in an overage charge equal to the difference between actual cost and the allowance. Such overage is due and payable in full prior to Contractor's purchase of the item. Contractor has no obligation to order or install any item for which an approved overage payment has not been received.`)}
${clauseHTML('2.4', `<strong>Contractor-Advanced Overages.</strong> If Contractor elects at its sole discretion to advance funds in excess of an allowance, the full advanced overage shall be collected on the next scheduled invoice under the line item heading "<strong>Reimbursement to Contractor Budget — Allowance Overage</strong>" and shall be due and payable per Article III. Contractor's election to advance on one occasion does not obligate it to do so in the future.`)}
${clauseHTML('2.5', `All allowance selections shall be submitted by Owner in writing no later than framing completion. Late submissions may result in project delays and additional costs for which Contractor shall not be liable.`)}

<!-- ARTICLE III -->
<hr class="rule">
<div class="article-heading">Article III — Payment Schedule</div>

${clauseHTML('3.1', `<strong>Massachusetts HIC Deposit Limitation (M.G.L. c. 142A §2).</strong> The initial Contract Deposit shall not exceed the greater of: (a) one-third (1/3) of the total Contract Price; or (b) the actual cost of any materials or equipment of a special-order or custom-made nature that must be ordered in advance. Any deposit in excess of this limit is prohibited under Massachusetts law.`)}
${clauseHTML('3.2', `The Contract Price shall be paid in installments upon completion of the milestones set forth in the table below. All payments are due within <strong>five (5) business days</strong> of the applicable milestone. Each payment invoice shall reference the applicable Invoice Number, Contract Number, and Proposal Number.`)}

${buildPaymentTable(data)}

${clauseHTML('3.3', `<strong>Pass-Through Costs — Payment Responsibility.</strong> This project includes one or more pass-through costs (permits, engineering, architectural fees) that are third-party expenses required by law or code, not contractor compensation, and are not subject to markup. The table below, agreed upon by both parties at signing, establishes who is financially responsible for each item. Two arrangements are used: <strong>(a) PB Fronts → Owner Reimburses:</strong> Contractor advances the cost on Owner's behalf and itemizes it on Invoice 1 as a Pre-Construction Advance. Owner reimburses Contractor within five (5) business days. <strong>(b) Owner Pays Vendor Directly:</strong> Owner writes the check directly to the municipality or third-party vendor. Contractor will confirm receipt of payment or documentation before the related work commences. Items paid directly by Owner shall not appear on any PB invoice.`)}

${buildPreConTable(data)}

${clauseHTML('3.4', `Any payment not received within five (5) business days of its due date shall bear a late charge of <strong>one and one-half percent (1.5%) per month</strong> on the unpaid balance from the due date until paid in full.`)}
${clauseHTML('3.5', `Contractor shall not be required to commence or continue Work if any payment is more than ten (10) days past due. Contractor may suspend Work upon written notice to Owner, and such suspension shall not constitute a breach of this Agreement.`)}
${clauseHTML('3.6', `All payments shall reference the applicable Invoice Number, Contract Number, and/or Proposal Number. Contractor shall issue invoices for each milestone payment identifying: (a) Invoice No.; (b) Contract No.; (c) Proposal No.; (d) milestone description; and (e) amount due.`)}

<!-- ARTICLE IV -->
<hr class="rule">
<div class="article-heading">Article IV — Change Orders</div>

${clauseHTML('4.1', `No changes, additions, deletions, or modifications to the scope of Work shall be binding upon either party unless set forth in a written Change Order signed by both Owner and Contractor prior to commencement of any additional or modified work.`)}
${clauseHTML('4.2', `Each Change Order shall specify: (a) description of work to be added, deleted, or modified; (b) adjustment to the Contract Price; (c) adjustment to the project schedule; (d) applicable Invoice No. for payment; and (e) written confirmation that the changed work complies with all applicable building codes. Verbal authorizations are not binding.`)}
${clauseHTML('4.3', `<strong>No Change Order May Require Code Non-Compliance.</strong> No Change Order shall authorize or require Contractor to perform work that is not in compliance with 780 CMR or any other applicable law or code. Any such Change Order or portion thereof is void and unenforceable.`)}
${clauseHTML('4.4', `Owner-requested changes that result in project delays shall extend the completion date accordingly, and Contractor shall not be liable for damages arising from such extensions.`)}

<!-- ARTICLE V -->
<hr class="rule">
<div class="article-heading">Article V — Contractor's Warranty</div>

${clauseHTML('5.1', `Contractor warrants all workmanship performed under this Agreement for <strong>one (1) year</strong> from Substantial Completion. This warranty covers defects in workmanship and materials supplied by Contractor that arise under normal use and are reported in writing within the warranty period.`)}
${clauseHTML('5.2', `Manufacturer warranties on products and materials installed by Contractor are passed through directly to Owner. Contractor will reasonably cooperate in the assertion of manufacturer warranty claims upon Owner's written request.`)}
${clauseHTML('5.3', `This warranty is void if the structure or any component is modified, altered, or misused by any party other than Contractor or Contractor's authorized agents.`)}

<!-- ARTICLE VI -->
<hr class="rule">
<div class="article-heading">Article VI — Owner's Obligations</div>

${clauseHTML('6.1', `Owner shall provide Contractor with unobstructed access to the Property and all areas of work during normal working hours and as reasonably required to complete the Work.`)}
${clauseHTML('6.2', `Owner shall maintain homeowner's property insurance on the Property in an amount not less than the replacement cost thereof throughout the duration of this Agreement.`)}
${clauseHTML('6.3', `Owner shall make all progress payments in a timely manner per Article III. Owner shall not withhold payment for any reason other than a bona fide written dispute as to work completed.`)}
${clauseHTML('6.4', `Owner shall submit all material selections, finish choices, and decisions required by Exhibit A no later than completion of framing. Late or incomplete submissions may cause delays and additional costs.`)}

<!-- ARTICLE VII -->
<hr class="rule">
<div class="article-heading">Article VII — Permits &amp; Inspections</div>

${clauseHTML('7.1', `Contractor shall apply for and obtain all building permits required for the Work from the applicable municipal building department. Contractor shall schedule and pass all required inspections.`)}
${clauseHTML(
  '7.2',
  `Permit fees and inspection charges are ${
    !job.has_permit
      ? "not anticipated for this scope of work based on the parties' current understanding; however, if a permit is subsequently required by law or by official determination of the applicable building department, permit fees shall be billed as a pass-through cost at actual cost without markup per Article III, Clause 3.3."
      : job.permit_paid_by === 'customer_direct'
        ? 'the responsibility of Owner, who agrees to pay the applicable municipal building department directly. Owner shall provide Contractor with written confirmation of payment and a copy of the issued permit before Contractor commences permitted work. Permit fees shall not appear on any Contractor invoice.'
        : 'itemized on Invoice 1 as a Pre-Construction Advance per Article III, Clause 3.3. Contractor shall pay permit fees directly to the issuing authority and document actual costs. Any overage or underage from the estimated permit fee shall be reflected as a credit or additional charge on the next applicable invoice.'
  }`,
)}
${clauseHTML('7.3', `Owner shall not contact the building department to modify, expand, or otherwise change any permit application without prior written consent of Contractor.`)}

<!-- ARTICLE VIII -->
<hr class="rule">
<div class="article-heading">Article VIII — Insurance</div>

${clauseHTML('8.1', `Contractor shall maintain throughout the term of this Agreement: (a) Commercial General Liability insurance with limits of not less than <strong>$1,000,000 per occurrence</strong> and $2,000,000 in the aggregate; and (b) Workers' Compensation insurance as required by M.G.L. c. 152.`)}
${clauseHTML('8.2', `Certificates of insurance shall be provided to Owner upon written request. Owner shall be named as an additional insured on the Commercial General Liability policy.`)}

<!-- ARTICLE IX -->
<hr class="rule">
<div class="article-heading">Article IX — Substantial Completion</div>

${clauseHTML('9.1', `"<strong>Substantial Completion</strong>" means the stage when the Work is sufficiently complete, as evidenced by: (a) issuance of a Certificate of Occupancy by the applicable building department (where required); or (b) written sign-off by Owner confirming all punch list items are complete (where a CO is not required), such that Owner can occupy or utilize the Property for its intended use.`)}
${clauseHTML('9.2', `Punch list items remaining at Substantial Completion shall be completed within <strong>thirty (30) days</strong>, provided Owner cooperates in scheduling access. As a general rule, punch list items shall not constitute grounds to withhold the final payment installment. Notwithstanding the foregoing, Owner and Contractor may, upon mutual written agreement executed prior to or at the time of Substantial Completion, negotiate a reasonable holdback amount from the final payment balance due. Any agreed holdback: (a) shall be limited to a reasonable dollar amount proportionate to the actual cost of completing the identified punch list items; (b) shall not be excessive in relation to the remaining scope; (c) shall be documented in a written punch list signed by both parties identifying each item and its estimated cost; and (d) shall be released to Contractor in full within <strong>five (5) business days</strong> of completion of all punch list items.`)}

<!-- ARTICLE X -->
<hr class="rule">
<div class="article-heading">Article X — Mechanic's Lien Notice (M.G.L. c. 254)</div>

<div class="notice">
  <strong>NOTICE:</strong> Under M.G.L. c. 254, any contractor, subcontractor, laborer, or materialman who provides labor or materials for improvements to real property may file a lien against that property if not paid. In certain circumstances, a lien may be filed by a subcontractor or materialman even if Owner has paid the general contractor in full, subject to the requirements and limitations of M.G.L. c. 254.
</div>

${clauseHTML('10.1', `The notice above is provided pursuant to M.G.L. c. 254. Owner is advised that subcontractors and suppliers may have lien rights independent of payments made to Contractor.`)}
${clauseHTML('10.2', `Contractor shall provide lien waivers from all subcontractors and material suppliers upon Owner's written request at each payment milestone. Owner may also record a Notice of Contract at the applicable Registry of Deeds — see Addendum 1.`)}

<!-- ARTICLE XI -->
<hr class="rule">
<div class="article-heading">Article XI — Massachusetts HIC License Disclosure</div>

${clauseHTML('11.1', `Preferred Builders General Services Inc. holds Massachusetts Home Improvement Contractor License No. <strong>HIC-197400</strong>, as required by M.G.L. c. 142A. All home improvement contractors performing residential contracting in Massachusetts must be registered with the Commonwealth. In addition, the project supervisor of record is <strong>Jackson Deaquino</strong>, who holds a Massachusetts Construction Supervisor License (<strong>CSL</strong>) No. <strong>${f(c.csl_number, '_______________')}</strong>, as required by M.G.L. c. 143 and the applicable provisions of 780 CMR governing construction supervisor licensing. The CSL holder is responsible for supervising the construction, reconstruction, alteration, repair, removal, or demolition of any building or structure in the Commonwealth.`)}
${clauseHTML('11.2', `The Arbitration &amp; Guaranty Fund (M.G.L. c. 142A §17) provides homeowners with recourse if a registered contractor fails to perform or causes damage. For information: <strong>www.mass.gov/hic</strong> or <strong>(617) 973-8700</strong>.`)}
${clauseHTML('11.3', `Per M.G.L. c. 142A, this Contract is in writing and contains all required disclosures. Owner acknowledges receipt of a fully executed copy of this Contract at or before the time of signing.`)}

<!-- ARTICLE XII -->
<hr class="rule">
<div class="article-heading">Article XII — Three-Day Right of Rescission (M.G.L. c. 93 §48; see also 940 CMR 3.00 et seq.)</div>

${clauseHTML('12.1', `If this Agreement was signed at a location other than Contractor's principal place of business, Owner has the right to cancel this Agreement, without penalty or obligation, within <strong>three (3) business days</strong> of signing. No work shall commence and no funds shall be disbursed before expiration of the rescission period unless Owner waives this right in writing. Notice of cancellation must be in writing delivered or mailed to: <em>Preferred Builders General Services Inc., 37 Duck Mill Road, Fitchburg, MA 01420 — Attn: Jackson Deaquino, Project Manager.</em>`)}
${clauseHTML('12.2', `If Owner cancels within the rescission period, any deposit paid shall be returned within ten (10) business days of receipt of written notice of cancellation.`)}

<!-- ARTICLE XIII -->
<hr class="rule">
<div class="article-heading">Article XIII — Dispute Resolution</div>

${clauseHTML('13.1', `The parties shall make a good-faith effort to resolve any dispute through direct negotiation before resorting to formal proceedings.`)}
${clauseHTML('13.2', `If direct negotiation fails, the dispute shall be submitted to non-binding mediation before a mutually agreed-upon mediator. Mediation costs shall be shared equally.`)}
${clauseHTML('13.3', `If mediation is unsuccessful, the dispute shall be submitted to binding arbitration pursuant to the Construction Industry Arbitration Rules of the American Arbitration Association then in effect. The arbitrator's award shall be final and binding. The prevailing party shall be entitled to recover reasonable attorneys' fees and costs.`)}
${clauseHTML('13.4', `<strong>NOTICE TO OWNER:</strong> By agreeing to binding arbitration under §13.3, Owner waives the right to a jury trial or court proceeding for disputes covered by this clause. Owner is encouraged to consult with an attorney before signing if Owner has any questions about this provision.`)}
${clauseHTML('13.5', `This Agreement shall be governed by the laws of the <strong>Commonwealth of Massachusetts</strong>, without regard to conflict-of-law principles.`)}

<!-- ARTICLE XIV -->
<hr class="rule">
<div class="article-heading">Article XIV — Force Majeure</div>

${clauseHTML('14.1', `Neither party shall be in default for delays caused by circumstances beyond its reasonable control, including: acts of God, severe weather, fire, strikes, labor disputes, material shortages, government-ordered shutdowns, pandemic, or failure of public utilities ("<strong>Force Majeure Event</strong>").`)}
${clauseHTML('14.2', `The party experiencing a Force Majeure Event shall provide written notice within five (5) business days. The completion schedule shall be extended by the period of the event.`)}

<!-- ARTICLE XV -->
<hr class="rule">
<div class="article-heading">Article XV — Termination</div>

${clauseHTML('15.1', `<strong>Termination by Owner for Cause:</strong> Owner may terminate if Contractor materially breaches this Agreement and fails to cure within <strong>fourteen (14) calendar days</strong> of written notice specifying the breach.`)}
${clauseHTML('15.2', `<strong>Termination by Contractor for Cause:</strong> Contractor may terminate if: (a) Owner fails to make any payment when due and fails to cure within <strong>seven (7) calendar days</strong> of written notice; or (b) Owner directs Contractor to perform non-code-compliant work and fails to withdraw such direction within seven (7) calendar days of written notice from Contractor.`)}
${clauseHTML('15.3', `Upon termination, Owner shall pay Contractor for all Work completed and materials ordered, fabricated, or delivered as of the termination date, plus reasonable overhead and profit on completed Work.`)}

<!-- ARTICLE XVI -->
<hr class="rule">
<div class="article-heading">Article XVI — General Provisions</div>

${clauseHTML('16.1', `<strong>Entire Agreement:</strong> This Agreement, together with the Proposal (Proposal No. ${field(c.quote_number)}, Invoice No. ${field(c.invoice_number)}) and Exhibit A, constitutes the entire agreement between the parties and supersedes all prior negotiations, representations, and agreements, whether oral or written.`)}
${clauseHTML('16.2', `<strong>Modifications:</strong> This Agreement may not be amended except by a written instrument signed by both parties. No waiver is effective unless in writing.`)}
${clauseHTML('16.3', `<strong>Severability:</strong> If any provision is held invalid or unenforceable, the remaining provisions shall continue in full force.`)}
${clauseHTML('16.4', `<strong>Notices:</strong> All notices shall be in writing. Notices of default, cure, or termination must be delivered by hand or sent by certified mail, return receipt requested, to the addresses set forth on the cover page. Email (with read receipt confirmation) is permitted for all routine notices and as a courtesy copy for termination notices, but shall not substitute for certified mail or hand delivery when this Agreement requires notice of default, cure, or termination.`)}
${clauseHTML('16.5', `<strong>Counterparts:</strong> This Agreement may be executed in counterparts, each deemed an original. Electronic or digital signatures shall be deemed valid and binding.`)}

<!-- SIGNATURES -->
<hr class="rule">
<div class="article-heading">Signatures</div>

<p style="font-size:9pt;text-align:justify;margin:8px 0 16px">
  IN WITNESS WHEREOF, the parties have executed this Home Improvement Construction Agreement as of the date first written above.
  Each party represents that it has read this Agreement in its entirety, understands its terms, and is authorized to execute it.
</p>

<div class="sig-grid">
  ${sigBlock('Owner / Client', [
    { label: 'Owner Signature' },
    { label: 'Printed Name' },
    { label: 'Date' },
  ])}
  ${sigBlock('Contractor — Preferred Builders General Services Inc.', [
    { label: 'Authorized Signature', printed: 'Jackson Deaquino, Project Manager' },
    { label: 'MA HIC License No. HIC-197400' },
    { label: 'Date' },
  ])}
</div>

<hr class="rule-light">
<p style="font-weight:700;font-size:9pt;color:#1F3864;margin:10px 0 6px">INITIALS — BOTH PARTIES</p>
<p style="font-size:8.5pt;margin-bottom:10px;text-align:justify">
  Initialing confirms receipt and review of: (1) this Agreement; (2) Project Proposal &amp; Scope of Work —
  Proposal No. ${field(c.quote_number)}; (3) Invoice No. ${field(c.invoice_number)};
  (4) Exhibit A — Allowance Schedule; (5) Addendum 1 — Notice of Contract;
  (6) Change Order Form CO-1; and (7) Change Order Form CO-2.
</p>
<div class="initials-bar">
  <div class="init-cell">Owner Initials: _______&nbsp;&nbsp;&nbsp;Date: ___________</div>
  <div class="init-cell">Contractor Initials: _______&nbsp;&nbsp;&nbsp;Date: ___________</div>
</div>

<!-- EXHIBIT A -->
<div class="page-break"></div>

<div class="addendum-title">
  <h2>Exhibit A</h2>
  <div style="font-size:11pt;font-weight:700;color:#1F3864;margin-top:4px">Contractor-Grade Allowance Schedule</div>
  <div class="add-sub">Contract No. ${field(c.contract_number)}  |  Proposal No. ${field(c.quote_number)}  |  Invoice No. ${field(c.invoice_number)}</div>
</div>

<hr class="rule">

<p style="font-size:8.5pt;text-align:justify;margin-bottom:10px">
  The following allowances are included in the Contract Price and represent contractor-grade material pricing through
  Preferred Builders' trade accounts. If Owner selections fall <strong>below</strong> an allowance, the difference is applied
  as a credit on the final invoice. If selections <strong>exceed</strong> an allowance, the overage is due and payable prior
  to purchase of the item (see Articles 2.3–2.4). All selections must be submitted in writing no later than framing
  completion. All materials must comply with 780 CMR and applicable product standards.
</p>

${buildAllowanceTables(data)}

<hr class="rule-light" style="margin-top:16px">
<p style="font-weight:700;font-size:9pt;color:#1F3864;margin:10px 0 6px">EXHIBIT A — ACKNOWLEDGMENT</p>
<p style="font-size:8.5pt;margin-bottom:10px">
  By initialing below, Owner confirms that the Allowance Schedule contained herein was distributed to and reviewed by Owner as part of the <strong>Project Proposal &amp; Scope of Work Package</strong> delivered prior to execution of this Contract, and that Owner agrees to the allowance terms set forth in Articles 2.2–2.5.
</p>
<div class="initials-bar">
  <div class="init-cell">Owner Initials: _______&nbsp;&nbsp;&nbsp;Date: ___________</div>
  <div class="init-cell">Contractor Initials: _______&nbsp;&nbsp;&nbsp;Date: ___________</div>
</div>

<!-- ADDENDUM 1 — NOTICE OF CONTRACT -->
<div class="page-break"></div>

<div class="addendum-title">
  <div style="font-size:9pt;color:#888;font-style:italic;margin-bottom:4px">Addendum 1 to Construction Contract No. ${field(c.contract_number)}</div>
  <h2>Notice of Contract</h2>
  <div class="add-sub">Pursuant to Massachusetts General Laws Chapter 254, Section 4</div>
</div>

<hr class="rule">

<p style="font-size:8.5pt;text-align:justify;margin-bottom:14px">
  This Notice of Contract is filed pursuant to M.G.L. c. 254, §4 to give notice that the Contractor named below has entered into a contract
  for the improvement of the real property described herein, and to preserve the Contractor's right to assert a mechanic's lien in accordance
  with M.G.L. c. 254. This document should be recorded at the Worcester County Registry of Deeds prior to commencement of work.
</p>

<div class="registry-grid">
  <div class="reg-cell"><div class="reg-label">Book:</div><div class="reg-value">&nbsp;</div></div>
  <div class="reg-cell"><div class="reg-label">Page:</div><div class="reg-value">&nbsp;</div></div>
  <div class="reg-cell"><div class="reg-label">Document No.:</div><div class="reg-value">&nbsp;</div></div>
  <div class="reg-cell"><div class="reg-label">Date Recorded:</div><div class="reg-value">&nbsp;</div></div>
</div>
<p style="font-size:7.5pt;color:#999;font-style:italic;margin-bottom:14px">Registry use only. Do not write below this line.</p>

<div class="sub-heading">I. Owner of the Property</div>
<p style="font-size:9pt;line-height:1.9">
  Full Legal Name: ${field(o.full_name)}<br>
  Address: ${field(o.address_line1)}, ${field(o.city_state_zip)}<br>
  Phone: ${field(o.phone)}&nbsp;&nbsp;&nbsp;Email: ${field(o.email)}
</p>

<div class="sub-heading">II. Contractor</div>
<p style="font-size:9pt;line-height:1.9">
  Full Legal Name: Preferred Builders General Services Inc.<br>
  Address: 37 Duck Mill Road, Fitchburg, MA 01420<br>
  HIC License No.: HIC-197400&nbsp;&nbsp;&nbsp;Phone: 978-377-1784<br>
  Authorized Representative: Jackson Deaquino, Project Manager
</p>

<div class="sub-heading">III. Property Subject to Lien</div>
<p style="font-size:9pt;line-height:1.9">
  Property Address: ${field(p.address)}, ${field(p.city)}<br>
  County: Worcester County, Commonwealth of Massachusetts<br>
  Assessor's Parcel No.: ${field(p.parcel_number)}<br>
  Title Reference: Book ________, Page ________, Worcester County Registry of Deeds
</p>

<div class="sub-heading">IV. Contract Details</div>
<p style="font-size:9pt;line-height:1.9">
  Contract No.: ${field(c.contract_number)}&nbsp;&nbsp;&nbsp;Invoice No.: ${field(c.invoice_number)}&nbsp;&nbsp;&nbsp;Proposal No.: ${field(c.quote_number)}<br>
  Date of Contract: ${field(c.contract_date)}<br>
  Original Contract Price: ${field(c.total_contract_price)}<br>
  General Description of Work: General construction and home improvement work as more particularly described in the Project Proposal &amp;
  Scope of Work, Proposal No. ${field(c.quote_number)}, Invoice No. ${field(c.invoice_number)}, incorporated herein by reference.
</p>

<div class="sub-heading">V. Signatures</div>
<div class="sig-grid">
  ${sigBlock('Owner', [
    { label: 'Owner Signature' },
    { label: 'Printed Name' },
    { label: 'Phone / Email' },
    { label: 'Date' },
  ])}
  ${sigBlock('Contractor — Preferred Builders General Services Inc.', [
    { label: 'Authorized Signature', printed: 'Jackson Deaquino, Project Manager' },
    { label: 'MA HIC License No. HIC-197400' },
    { label: 'Date' },
  ])}
</div>

<div class="sub-heading" style="margin-top:20px">Notary Acknowledgments</div>

<div class="notary-block">
  <div class="notary-title">Acknowledgment of Owner — Commonwealth of Massachusetts</div>
  Commonwealth of Massachusetts, County of _________________ ss.<br>
  On this _____ day of _______________, 20___, before me, the undersigned notary public, personally appeared
  ${field(o.full_name)}, proved to me through satisfactory evidence of identification, which was _________________________,
  to be the person whose name is signed on this document, and acknowledged to me that he/she signed it voluntarily for its stated purpose.
  <div class="notary-sig-line"></div>
  <div style="font-size:8pt;color:#888;font-style:italic">Notary Public Signature&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;My Commission Expires: ___________</div>
  <div style="font-size:8pt;color:#bbb;margin-top:8px">[ Notary Seal ]</div>
</div>

<div class="notary-block">
  <div class="notary-title">Acknowledgment of Contractor — Commonwealth of Massachusetts</div>
  Commonwealth of Massachusetts, County of _________________ ss.<br>
  On this _____ day of _______________, 20___, before me, the undersigned notary public, personally appeared
  Jackson Deaquino, Project Manager of Preferred Builders General Services Inc., proved to me through satisfactory evidence
  of identification, which was _________________________, to be the person whose name is signed on this document,
  and acknowledged to me that he signed it voluntarily for its stated purpose as authorized representative of
  Preferred Builders General Services Inc.
  <div class="notary-sig-line"></div>
  <div style="font-size:8pt;color:#888;font-style:italic">Notary Public Signature&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;My Commission Expires: ___________</div>
  <div style="font-size:8pt;color:#bbb;margin-top:8px">[ Notary Seal ]</div>
</div>

<hr class="rule-light" style="margin-top:20px">
<p style="font-size:8pt;color:#999;font-style:italic;text-align:center">
  This Notice of Contract is prepared in connection with Construction Contract No. ${field(c.contract_number)} between
  Preferred Builders General Services Inc. (HIC-197400) and ${field(o.full_name)}.
  After execution and notarization, file the original at the Worcester County Registry of Deeds and retain a copy in project records.
</p>

<!-- CHANGE ORDER FORM — CO-1 -->
<div class="page-break"></div>

<div id="page-header">
  <div>
    <div class="co-name">Preferred Builders General Services Inc.</div>
    <div class="co-sub">LIC# HIC-197400  |  37 Duck Mill Road, Fitchburg, MA 01420  |  978-377-1784</div>
  </div>
  <div class="doc-type">Change Order Form — CO-1<br>Ref: Contract No. ${field(c.contract_number)}</div>
</div>

<div class="doc-title">
  <h1>Change Order</h1>
  <div class="subtitle">CO-1 of 2  |  Construction Contract No. ${field(c.contract_number)}</div>
</div>

<hr class="rule">

<table class="cover-table">
  <tr><td class="label">Contract No.</td>       <td class="value">${field(c.contract_number)}</td>
      <td class="label">Proposal / Invoice No.</td> <td class="value">${field(c.quote_number)} / ${field(c.invoice_number)}</td></tr>
  <tr><td class="label">Owner</td>              <td class="value">${field(o.full_name)}</td>
      <td class="label">Property Address</td>    <td class="value">${field(p.address)}, ${field(p.city)}</td></tr>
  <tr><td class="label">Change Order No.</td>   <td class="value">CO-1</td>
      <td class="label">Date Submitted</td>      <td class="value">_______________________</td></tr>
  <tr><td class="label">Requested By</td>       <td class="value">☐ Owner &nbsp;&nbsp; ☐ Contractor</td>
      <td class="label">Date of Original Contract</td><td class="value">${field(c.contract_date)}</td></tr>
</table>

<hr class="rule-light">
<div class="sub-heading" style="margin-bottom:6px">Description of Change</div>
<p style="font-size:8.5pt;margin-bottom:8px">Describe in detail the addition, deletion, or modification to the scope of Work:</p>
<div style="border:1.5px solid #C8D4E4;border-radius:4px;min-height:90px;padding:8px;margin-bottom:12px;font-size:9pt;color:#aaa;font-style:italic">
  &nbsp;(Use additional sheet if needed)
</div>

<hr class="rule-light">
<div class="sub-heading" style="margin-bottom:6px">Contract Price &amp; Schedule Adjustment</div>
<table class="cover-table" style="margin-bottom:10px">
  <tr><td class="label">Original Contract Price</td>   <td class="value">${field(c.total_contract_price)}</td>
      <td class="label">Net Change This CO</td>         <td class="value">☐ Add &nbsp;&nbsp; ☐ Deduct &nbsp;&nbsp; $_______________</td></tr>
  <tr><td class="label">Previous CO Amount (total)</td><td class="value">$_______________</td>
      <td class="label">Revised Contract Price</td>     <td class="value">$_______________</td></tr>
  <tr><td class="label">Original Completion Date</td>  <td class="value">_______________________</td>
      <td class="label">Revised Completion Date</td>    <td class="value">_______________________</td></tr>
</table>

<p style="font-size:8pt;color:#555;margin-bottom:14px;text-align:justify">
  <strong>Note:</strong> No work described in this Change Order shall begin until this form is signed by both Owner and Contractor. Per Article IV of the Contract, verbal authorizations are not binding. Payment for any additional work is due on the next scheduled invoice per Article III.
</p>

<hr class="rule-light">
<div class="sub-heading" style="margin-bottom:10px">Authorization</div>
<div style="display:flex;gap:40px">
  <div style="flex:1">
    <div class="sig-line"></div>
    <div class="sig-label">Owner Signature</div>
    <div class="sig-line" style="margin-top:18px"></div>
    <div class="sig-label">Printed Name &amp; Date</div>
  </div>
  <div style="flex:1">
    <div class="sig-line"></div>
    <div class="sig-label">Contractor Signature — Preferred Builders General Services Inc.</div>
    <div class="sig-line" style="margin-top:18px"></div>
    <div class="sig-label">Printed Name, Title &amp; Date</div>
  </div>
</div>

<!-- CHANGE ORDER FORM — CO-2 -->
<div class="page-break"></div>

<div id="page-header">
  <div>
    <div class="co-name">Preferred Builders General Services Inc.</div>
    <div class="co-sub">LIC# HIC-197400  |  37 Duck Mill Road, Fitchburg, MA 01420  |  978-377-1784</div>
  </div>
  <div class="doc-type">Change Order Form — CO-2<br>Ref: Contract No. ${field(c.contract_number)}</div>
</div>

<div class="doc-title">
  <h1>Change Order</h1>
  <div class="subtitle">CO-2 of 2  |  Construction Contract No. ${field(c.contract_number)}</div>
</div>

<hr class="rule">

<table class="cover-table">
  <tr><td class="label">Contract No.</td>       <td class="value">${field(c.contract_number)}</td>
      <td class="label">Proposal / Invoice No.</td> <td class="value">${field(c.quote_number)} / ${field(c.invoice_number)}</td></tr>
  <tr><td class="label">Owner</td>              <td class="value">${field(o.full_name)}</td>
      <td class="label">Property Address</td>    <td class="value">${field(p.address)}, ${field(p.city)}</td></tr>
  <tr><td class="label">Change Order No.</td>   <td class="value">CO-2</td>
      <td class="label">Date Submitted</td>      <td class="value">_______________________</td></tr>
  <tr><td class="label">Requested By</td>       <td class="value">☐ Owner &nbsp;&nbsp; ☐ Contractor</td>
      <td class="label">Date of Original Contract</td><td class="value">${field(c.contract_date)}</td></tr>
</table>

<hr class="rule-light">
<div class="sub-heading" style="margin-bottom:6px">Description of Change</div>
<p style="font-size:8.5pt;margin-bottom:8px">Describe in detail the addition, deletion, or modification to the scope of Work:</p>
<div style="border:1.5px solid #C8D4E4;border-radius:4px;min-height:90px;padding:8px;margin-bottom:12px;font-size:9pt;color:#aaa;font-style:italic">
  &nbsp;(Use additional sheet if needed)
</div>

<hr class="rule-light">
<div class="sub-heading" style="margin-bottom:6px">Contract Price &amp; Schedule Adjustment</div>
<table class="cover-table" style="margin-bottom:10px">
  <tr><td class="label">Original Contract Price</td>   <td class="value">${field(c.total_contract_price)}</td>
      <td class="label">Net Change This CO</td>         <td class="value">☐ Add &nbsp;&nbsp; ☐ Deduct &nbsp;&nbsp; $_______________</td></tr>
  <tr><td class="label">Previous CO Amount (total)</td><td class="value">$_______________</td>
      <td class="label">Revised Contract Price</td>     <td class="value">$_______________</td></tr>
  <tr><td class="label">Original Completion Date</td>  <td class="value">_______________________</td>
      <td class="label">Revised Completion Date</td>    <td class="value">_______________________</td></tr>
</table>

<p style="font-size:8pt;color:#555;margin-bottom:14px;text-align:justify">
  <strong>Note:</strong> No work described in this Change Order shall begin until this form is signed by both Owner and Contractor. Per Article IV of the Contract, verbal authorizations are not binding. Payment for any additional work is due on the next scheduled invoice per Article III.
</p>

<hr class="rule-light">
<div class="sub-heading" style="margin-bottom:10px">Authorization</div>
<div style="display:flex;gap:40px">
  <div style="flex:1">
    <div class="sig-line"></div>
    <div class="sig-label">Owner Signature</div>
    <div class="sig-line" style="margin-top:18px"></div>
    <div class="sig-label">Printed Name &amp; Date</div>
  </div>
  <div style="flex:1">
    <div class="sig-line"></div>
    <div class="sig-label">Contractor Signature — Preferred Builders General Services Inc.</div>
    <div class="sig-line" style="margin-top:18px"></div>
    <div class="sig-label">Printed Name, Title &amp; Date</div>
  </div>
</div>

<!-- Footer -->
<div id="page-footer">
  <span>jackson.deaquino@preferredbuildersusa.com  |  Contract No.: ${field(c.contract_number)}</span>
  <span>Preferred Builders General Services Inc. | HIC-197400 | Confidential</span>
</div>

</body>
</html>`;
}

module.exports = { buildContractHTML, adaptToContractSchema, blankContractSchema };
