import React from 'react';
import { BLUE, ORANGE, GREEN } from './constants';

export default function JobAssessmentTab({
  job,
  marginData,
  marginLoading,
  pipelineCtx,
  followUpTask,
  setFollowUpTask,
  openRfqModal,
  headers,
  paymentSummary,
}) {
  const pd = job.proposal_data;
  const lineItems = pd?.lineItems || [];
  const isLocked = [
    'proposal_approved',
    'customer_approved',
    'contract_ready',
    'contract_sent',
    'contract_signed',
    'complete',
  ].includes(job.status);
  const isSemiLocked = ['proposal_ready', 'proposal_sent'].includes(job.status);

  const subTotal = lineItems.reduce((s, li) => s + (Number(li.baseCost) || 0), 0);
  const clientTotal = lineItems.reduce((s, li) => s + (Number(li.finalPrice) || 0), 0);
  const projectSqft = Number(pd?.project?.sqft) || 0;
  const sqftPrice =
    pd?.pricing?.pricePerSqft ||
    (projectSqft > 0 && clientTotal > 0 ? Math.round(clientTotal / projectSqft) : null);
  const sqftWarning = pd?.pricing?.sqftWarning;
  const sqftTargetLow = pd?.pricing?.sqftTargetLow || 320;
  const sqftTargetHigh = pd?.pricing?.sqftTargetHigh || 350;
  const computedSqftWarning =
    sqftPrice && !sqftWarning
      ? sqftPrice < sqftTargetLow
        ? 'below'
        : sqftPrice > sqftTargetHigh
          ? 'above'
          : null
      : sqftWarning;
  const totalVal = Number(pd?.totalValue || job.total_value || 0);
  const depositAmt = Number(pd?.depositAmount || job.deposit_amount || 0);
  const depositPct = totalVal > 0 ? Math.round((depositAmt / totalVal) * 100) : 0;
  const depositOk = depositPct >= 28 && depositPct <= 38;

  const rawType = pd?.project?.type || '';
  const normalizeType = (t) => {
    const s = (t || '').toLowerCase().replace(/[\s-]/g, '_');
    if (s.includes('new_construct') || s.includes('custom_home')) return 'new_construction';
    if (s === 'adu' || s.includes('accessory') || s.includes('carriage') || s.includes('in_law'))
      return 'adu';
    if (s.includes('addition')) return 'addition';
    if (s.includes('garage')) return 'garage';
    return s || 'renovation';
  };
  const projType = normalizeType(rawType);
  const tradeNames = lineItems.map((li) => (li.trade || '').toLowerCase());
  const jobNameLc = (job.project_name || job.address || '').toLowerCase();
  const descLc = (pd?.project?.description || '').toLowerCase();
  const aduKeywords = [
    'adu',
    'garage apartment',
    'carriage house',
    'in-law',
    'inlaw',
    'garage with apartment',
    'accessory dwelling',
  ];
  const garageKw = ['garage', 'detached garage', 'attached garage'];
  const isADU =
    projType === 'adu' ||
    aduKeywords.some(
      (k) => jobNameLc.includes(k) || descLc.includes(k) || tradeNames.some((t) => t.includes(k)),
    );
  const isGarage =
    !isADU &&
    (garageKw.some((k) => jobNameLc.includes(k) || descLc.includes(k)) ||
      tradeNames.some((t) => t.includes('garage door') || t.includes('garage slab')));
  const aduOnSeptic = pd?.job?.adu?.on_septic === true;

  const TYPE_BANDS = {
    garage: { label: 'Detached Garage', low: 85, mid: 120, high: 160 },
    adu: { label: 'Garage w/ Apartment / ADU', low: 130, mid: 190, high: 250 },
    new_construction: { label: 'Custom Home / New Build', low: 180, mid: 250, high: 350 },
    renovation: { label: 'Addition / Renovation', low: 150, mid: 220, high: 300 },
    addition: { label: 'Addition / Renovation', low: 150, mid: 220, high: 300 },
  };
  const bandKey = isGarage ? 'garage' : isADU ? 'adu' : projType || null;
  const band = bandKey ? TYPE_BANDS[bandKey] || null : null;
  const bandStatus =
    band && sqftPrice
      ? sqftPrice < band.low
        ? 'low'
        : sqftPrice <= band.mid
          ? 'good_low'
          : sqftPrice <= band.high
            ? 'good_high'
            : 'high'
      : null;
  const BAND_COLOR = {
    low: '#fff3cd',
    good_low: '#f0fdf4',
    good_high: '#f0fdf4',
    high: '#fde8e8',
  };
  const BAND_LABEL = {
    low: '⬇ Below Low',
    good_low: '✅ Low–Mid Range',
    good_high: '✅ Mid–High Range',
    high: '🔴 Above High',
  };
  const BAND_TEXT = {
    low: '#92400e',
    good_low: '#166534',
    good_high: '#166534',
    high: '#991b1b',
  };

  const BASE_ADU_TRADES = [
    {
      label: 'Foundation / Slab',
      kw: ['foundation', 'slab', 'concrete', 'crawl', 'pier', 'footing'],
    },
    { label: 'Framing', kw: ['framing', 'frame', 'structural'] },
    { label: 'Roofing', kw: ['roof', 'shingle', 'standing seam', 'metal roof'] },
    { label: 'Siding', kw: ['siding', 'hardie', 'fiber cement', 'clapboard', 'board & batten'] },
    { label: 'Electrical', kw: ['electric', 'wiring', 'panel'] },
    { label: 'Permits', kw: ['permit', 'fee', 'stretch code'] },
  ];
  const EXPECTED_TRADES = {
    garage: [
      {
        label: 'Foundation / Slab',
        kw: ['foundation', 'slab', 'concrete', 'crawl', 'pier', 'footing'],
      },
      { label: 'Framing', kw: ['framing', 'frame', 'structural'] },
      { label: 'Roofing', kw: ['roof', 'shingle', 'standing seam', 'metal roof'] },
      {
        label: 'Siding / Exterior',
        kw: ['siding', 'hardie', 'fiber cement', 'clapboard', 'board & batten'],
      },
      { label: 'Electrical', kw: ['electric', 'wiring', 'panel'] },
      { label: 'Permits', kw: ['permit', 'fee', 'stretch code'] },
    ],
    adu: [
      ...BASE_ADU_TRADES,
      { label: 'Plumbing', kw: ['plumbing', 'pipe', 'drain', 'fixture'] },
      {
        label: 'HVAC / Mini-Split',
        kw: ['hvac', 'heat', 'mini-split', 'furnace', 'erv', 'mechanical'],
      },
      { label: 'Insulation', kw: ['insulation', 'spray foam', 'batt', 'blown'] },
      { label: 'Drywall / Plaster', kw: ['drywall', 'sheetrock', 'plaster', 'blueboard'] },
      ...(aduOnSeptic
        ? [
            {
              label: 'Title 5 / Septic Inspection',
              kw: ['title 5', 'title5', 'septic inspection', 'perc test'],
            },
            {
              label: 'Septic / Site Work',
              kw: ['septic', 'leach', 'site work', 'excavat', 'well'],
            },
          ]
        : []),
    ],
    new_construction: [
      {
        label: 'Foundation / Slab',
        kw: ['foundation', 'slab', 'concrete', 'crawl', 'pier', 'footing'],
      },
      { label: 'Framing', kw: ['framing', 'frame', 'structural'] },
      { label: 'Roofing', kw: ['roof', 'shingle', 'standing seam', 'metal roof', 'tpo'] },
      { label: 'Siding', kw: ['siding', 'hardie', 'fiber cement', 'clapboard', 'board & batten'] },
      { label: 'Windows & Doors', kw: ['window', 'door', 'entry door', 'garage door'] },
      { label: 'Electrical', kw: ['electric', 'wiring', 'panel'] },
      { label: 'Plumbing', kw: ['plumbing', 'pipe', 'drain', 'fixture'] },
      { label: 'HVAC', kw: ['hvac', 'heat', 'mini-split', 'furnace', 'erv', 'mechanical'] },
      { label: 'Insulation', kw: ['insulation', 'spray foam', 'batt', 'blown'] },
      { label: 'Drywall', kw: ['drywall', 'sheetrock', 'plaster', 'blueboard'] },
      { label: 'Permits', kw: ['permit', 'fee', 'stretch code'] },
    ],
    renovation: [
      { label: 'Electrical', kw: ['electric', 'wiring', 'panel'] },
      { label: 'Plumbing', kw: ['plumbing', 'pipe', 'drain', 'fixture'] },
      { label: 'Permits', kw: ['permit', 'fee', 'stretch code'] },
    ],
    addition: [
      { label: 'Electrical', kw: ['electric', 'wiring', 'panel'] },
      { label: 'Plumbing', kw: ['plumbing', 'pipe', 'drain', 'fixture'] },
      { label: 'Permits', kw: ['permit', 'fee', 'stretch code'] },
    ],
  };
  const expectedTradesKey = isGarage
    ? 'garage'
    : isADU
      ? 'adu'
      : (projType === 'addition' ? 'addition' : projType) || null;
  const expectedTrades = expectedTradesKey ? EXPECTED_TRADES[expectedTradesKey] || [] : [];
  const missingTrades = expectedTrades.filter(
    (et) => !tradeNames.some((t) => et.kw.some((k) => t.includes(k))),
  );

  const BENCHMARKS = [
    {
      kw: ['foundation', 'slab', 'concrete', 'basement', 'crawl', 'pier', 'footing'],
      note: '$18–55/sqft (sub cost)',
      low: 5000,
      high: 80000,
    },
    {
      kw: ['framing', 'frame', 'structural', 'lvl', 'tji'],
      note: '$45–70/sqft labor+materials',
      low: 8000,
      high: 200000,
    },
    {
      kw: ['roof', 'shingle', 'metal roofing', 'tpo', 'standing seam'],
      note: '$450–650/sq; $18–28/sqft metal',
      low: 3000,
      high: 60000,
    },
    {
      kw: ['siding', 'hardie', 'fiber cement', 'vinyl siding', 'clapboard', 'board & batten'],
      note: '$4–20/sqft installed',
      low: 2000,
      high: 50000,
    },
    {
      kw: ['window', 'door', 'entry door', 'garage door'],
      note: '$600–4,500 each by type',
      low: 600,
      high: 40000,
    },
    {
      kw: ['electric', 'wiring', 'panel', 'service upgrade', 'circuit'],
      note: '$12–20/sqft full house',
      low: 2000,
      high: 50000,
    },
    {
      kw: ['plumbing', 'pipe', 'drain', 'fixture', 'bath rough', 'kitchen rough'],
      note: '$1,500–8,000/trade scope',
      low: 1500,
      high: 30000,
    },
    {
      kw: ['hvac', 'heat', 'mini-split', 'minisplit', 'furnace', 'erv', 'mechanical'],
      note: '$3,500–20,000+ per system',
      low: 3500,
      high: 50000,
    },
    {
      kw: ['insulation', 'spray foam', 'batt', 'blown', 'rigid foam'],
      note: '$1.20–6/sqft by type',
      low: 800,
      high: 25000,
    },
    {
      kw: ['drywall', 'sheetrock', 'plaster', 'skim coat', 'blueboard'],
      note: '$3.50–6/sqft hang & finish',
      low: 1500,
      high: 40000,
    },
    {
      kw: ['permit', 'fee', 'inspection', 'compliance', 'stretch code'],
      note: '0.5–1.5% of project value',
      low: 500,
      high: 15000,
    },
    {
      kw: ['demo', 'demolition', 'removal', 'tear out'],
      note: 'Varies by scope',
      low: null,
      high: null,
    },
    {
      kw: ['floor', 'tile', 'hardwood', 'carpet', 'lvp', 'vinyl plank'],
      note: '$5–25/sqft installed',
      low: 1000,
      high: 40000,
    },
    {
      kw: ['cabinet', 'kitchen', 'counter', 'quartz', 'granite'],
      note: 'Mid-range kitchen $25K–50K',
      low: 5000,
      high: 80000,
    },
    {
      kw: ['painting', 'interior paint', 'exterior paint'],
      note: '$1.50–4/sqft interior',
      low: 500,
      high: 15000,
    },
    {
      kw: ['trim', 'baseboard', 'millwork', 'interior finish', 'crown molding'],
      note: 'Interior finishes pkg $35K–120K',
      low: 5000,
      high: 120000,
    },
    {
      kw: ['septic', 'title 5', 'title5', 'leach field'],
      note: 'Title 5 + septic $3K–30K+',
      low: 1500,
      high: 60000,
    },
    {
      kw: ['site work', 'excavat', 'grading', 'well', 'driveway'],
      note: 'Typically excluded — verify',
      low: null,
      high: null,
    },
    { kw: ['dumpster', 'disposal', 'waste'], note: '$500–1,500 typical', low: 400, high: 2500 },
  ];

  const matchBench = (trade) => {
    const lc = (trade || '').toLowerCase();
    return BENCHMARKS.find((b) => b.kw.some((k) => lc.includes(k)));
  };
  const benchStatus = (bench, baseCost) => {
    if (!bench || bench.low == null || baseCost === 0) return 'unknown';
    if (baseCost < bench.low) return 'low';
    if (baseCost > bench.high) return 'high';
    return 'ok';
  };

  return (
    <div>
      {/* Financial Health Check */}
      <div style={{ marginBottom: 28 }}>
        <h3 style={{ color: BLUE, marginBottom: 16, marginTop: 0 }}>💰 Financial Health Check</h3>
        {marginLoading ? (
          <div style={{ color: '#888', fontSize: 13, padding: '20px 0' }}>
            Loading financial data...
          </div>
        ) : !marginData || !marginData.hasData ? (
          <div
            style={{
              background: '#f8f9fa',
              border: '1px solid #e5e7eb',
              borderRadius: 8,
              padding: 28,
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 28, marginBottom: 8 }}>📊</div>
            <div style={{ fontWeight: 600, color: '#555' }}>No estimate data yet</div>
            <div style={{ fontSize: 12, color: '#aaa', marginTop: 4 }}>
              Margin breakdown appears once a proposal has been generated for this job.
            </div>
          </div>
        ) : (
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: BLUE, color: 'white' }}>
                  <th style={{ padding: '9px 14px', textAlign: 'left', fontWeight: 600 }}>Layer</th>
                  <th style={{ padding: '9px 14px', textAlign: 'right', fontWeight: 600 }}>
                    Target %
                  </th>
                  <th style={{ padding: '9px 14px', textAlign: 'right', fontWeight: 600 }}>
                    Actual %
                  </th>
                  <th style={{ padding: '9px 14px', textAlign: 'right', fontWeight: 600 }}>
                    $ Added
                  </th>
                  <th style={{ padding: '9px 14px', textAlign: 'center', fontWeight: 600 }}>
                    Pass / Fail
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ background: '#f8f9fa', borderBottom: '1px solid #e9ecef' }}>
                  <td style={{ padding: '10px 14px', fontWeight: 600, color: '#333' }}>
                    Base Cost
                  </td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', color: '#aaa' }}>—</td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', color: '#aaa' }}>—</td>
                  <td
                    style={{
                      padding: '10px 14px',
                      textAlign: 'right',
                      fontWeight: 700,
                      color: '#333',
                    }}
                  >
                    ${marginData.baseCost.toLocaleString()}
                  </td>
                  <td style={{ padding: '10px 14px', textAlign: 'center', color: '#aaa' }}>—</td>
                </tr>
                {marginData.layers.map((layer, i) => (
                  <tr
                    key={layer.label}
                    style={{
                      background: i % 2 === 0 ? 'white' : '#fafafa',
                      borderBottom: '1px solid #f0f0f0',
                    }}
                  >
                    <td style={{ padding: '10px 14px', color: '#444' }}>{layer.label}</td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', color: '#777' }}>
                      {(layer.targetPct * 100).toFixed(1)}%
                    </td>
                    <td
                      style={{
                        padding: '10px 14px',
                        textAlign: 'right',
                        fontWeight: 600,
                        color: layer.pass ? '#166534' : '#991b1b',
                      }}
                    >
                      {(layer.actualPct * 100).toFixed(1)}%
                      {!marginData.hasStoredRates && (
                        <span
                          title="Assumed from current settings"
                          style={{ fontSize: 10, color: '#aaa', marginLeft: 3 }}
                        >
                          *
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', color: '#555' }}>
                      +${layer.dollarAdded.toLocaleString()}
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                      {layer.pass ? (
                        <span
                          style={{
                            background: '#dcfce7',
                            color: '#166534',
                            borderRadius: 12,
                            padding: '2px 10px',
                            fontSize: 12,
                            fontWeight: 600,
                          }}
                        >
                          ✓ Pass
                        </span>
                      ) : (
                        <span
                          style={{
                            background: '#fee2e2',
                            color: '#991b1b',
                            borderRadius: 12,
                            padding: '2px 10px',
                            fontSize: 12,
                            fontWeight: 600,
                          }}
                        >
                          ✗ Fail
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                <tr
                  style={{ background: '#EEF3FB', borderTop: '2px solid #c7d7f4', fontWeight: 700 }}
                >
                  <td style={{ padding: '12px 14px', color: BLUE }}>Contract Price</td>
                  <td style={{ padding: '12px 14px', textAlign: 'right', color: '#aaa' }}>—</td>
                  <td style={{ padding: '12px 14px', textAlign: 'right', color: '#aaa' }}>—</td>
                  <td
                    style={{ padding: '12px 14px', textAlign: 'right', color: BLUE, fontSize: 15 }}
                  >
                    ${marginData.contractPrice.toLocaleString()}
                  </td>
                  <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                    {marginData.overallPass === null ? (
                      <span style={{ color: '#bbb', fontSize: 12 }}>—</span>
                    ) : marginData.overallPass ? (
                      <span
                        style={{
                          background: '#dcfce7',
                          color: '#166534',
                          borderRadius: 12,
                          padding: '2px 10px',
                          fontSize: 12,
                          fontWeight: 600,
                        }}
                      >
                        ✓ On Target
                      </span>
                    ) : (
                      <span
                        style={{
                          background: '#fff3cd',
                          color: '#92400e',
                          borderRadius: 12,
                          padding: '2px 10px',
                          fontSize: 12,
                          fontWeight: 600,
                        }}
                      >
                        ⚠ Off Target
                      </span>
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
            {/* Net margin bar */}
            <div
              style={{
                background:
                  marginData.actualNetMarginPct >= 30
                    ? '#f0fdf4'
                    : marginData.actualNetMarginPct >= 20
                      ? '#fff7ed'
                      : '#fef2f2',
                borderTop: '1px solid #e5e7eb',
                padding: '14px 20px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div style={{ fontSize: 13, color: '#555' }}>
                <span style={{ fontWeight: 600 }}>Actual Profit Margin</span>
                <span style={{ fontSize: 11, color: '#888', marginLeft: 8 }}>
                  (revenue − base cost) ÷ revenue
                </span>
                {!marginData.hasStoredRates && (
                  <div style={{ fontSize: 10, color: '#aaa', marginTop: 2 }}>
                    * Actual % assumed from current settings (proposal predates rate tracking)
                  </div>
                )}
              </div>
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 800,
                  color:
                    marginData.actualNetMarginPct >= 30
                      ? '#166534'
                      : marginData.actualNetMarginPct >= 20
                        ? '#92400e'
                        : '#991b1b',
                }}
              >
                {marginData.actualNetMarginPct}%
              </div>
            </div>
          </div>
        )}
      </div>

      <hr style={{ border: 'none', borderTop: '1px solid #eee', marginBottom: 24 }} />

      {/* Header + lock badge */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <h3 style={{ color: BLUE, margin: 0 }}>Proposal Assessment</h3>
        {isLocked && (
          <span
            style={{
              background: '#f1f5f9',
              border: '1px solid #94a3b8',
              borderRadius: 6,
              padding: '4px 12px',
              fontSize: 12,
              color: '#475569',
              fontWeight: 700,
            }}
          >
            🔒 Locked — Proposal Approved
          </span>
        )}
        {isSemiLocked && !isLocked && (
          <span
            style={{
              background: '#fff7ed',
              border: '1px solid #fed7aa',
              borderRadius: 6,
              padding: '4px 12px',
              fontSize: 12,
              color: '#c2410c',
              fontWeight: 700,
            }}
          >
            📋 Semi-locked — Proposal Ready
          </span>
        )}
      </div>

      {!pd ? (
        <div style={{ color: '#888', textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>📊</div>
          <div style={{ fontWeight: 600 }}>Generate an estimate first to see the assessment.</div>
          <div style={{ fontSize: 12, color: '#aaa', marginTop: 6 }}>
            Upload an estimate and generate a proposal PDF to unlock this panel.
          </div>
        </div>
      ) : (
        <>
          {/* Score cards */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
              gap: 12,
              marginBottom: 20,
            }}
          >
            <div
              style={{ background: '#EEF3FB', borderRadius: 8, padding: 14, textAlign: 'center' }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: '#666',
                  textTransform: 'uppercase',
                  letterSpacing: '.5px',
                  marginBottom: 4,
                }}
              >
                Estimate Total
              </div>
              <div style={{ fontSize: 20, fontWeight: 700, color: BLUE }}>
                ${totalVal.toLocaleString()}
              </div>
            </div>
            <div
              style={{
                background: bandStatus
                  ? BAND_COLOR[bandStatus]
                  : computedSqftWarning === 'below'
                    ? '#fff3cd'
                    : computedSqftWarning === 'above'
                      ? '#fde8e8'
                      : sqftPrice
                        ? '#f0fdf4'
                        : '#f8f8f8',
                borderRadius: 8,
                padding: 14,
                textAlign: 'center',
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: '#666',
                  textTransform: 'uppercase',
                  letterSpacing: '.5px',
                  marginBottom: 4,
                }}
              >
                Price / Sq Ft
              </div>
              <div
                style={{
                  fontSize: 20,
                  fontWeight: 700,
                  color: bandStatus
                    ? BAND_TEXT[bandStatus]
                    : computedSqftWarning
                      ? computedSqftWarning === 'below'
                        ? '#92400e'
                        : '#991b1b'
                      : sqftPrice
                        ? '#166534'
                        : '#aaa',
                }}
              >
                {sqftPrice ? `$${sqftPrice.toLocaleString()}/sqft` : '—'}
              </div>
              {projectSqft > 0 && (
                <div style={{ fontSize: 10, color: '#555', marginTop: 2 }}>
                  {projectSqft.toLocaleString()} sqft · {band ? band.label : 'project'}
                </div>
              )}
              {bandStatus && band && (
                <div
                  style={{
                    fontSize: 10,
                    color: BAND_TEXT[bandStatus],
                    marginTop: 3,
                    fontWeight: 600,
                  }}
                >
                  {BAND_LABEL[bandStatus]} (${band.low}–${band.high}/sqft)
                </div>
              )}
              {!bandStatus && computedSqftWarning && (
                <div
                  style={{
                    fontSize: 10,
                    color: computedSqftWarning === 'below' ? '#92400e' : '#991b1b',
                    marginTop: 2,
                  }}
                >
                  ⚠️ {computedSqftWarning === 'below' ? 'Below' : 'Above'} target ({sqftTargetLow}–
                  {sqftTargetHigh}/sqft)
                </div>
              )}
              {!bandStatus && !computedSqftWarning && sqftPrice && (
                <div style={{ fontSize: 10, color: '#166534', marginTop: 2 }}>
                  ✅ In target range ({sqftTargetLow}–{sqftTargetHigh}/sqft)
                </div>
              )}
              {!sqftPrice && (
                <div style={{ fontSize: 10, color: '#aaa', marginTop: 2 }}>
                  Sqft not found in estimate
                </div>
              )}
            </div>
            <div
              style={{
                background: depositAmt > 0 ? (depositOk ? '#f0fdf4' : '#fff3cd') : '#f8f8f8',
                borderRadius: 8,
                padding: 14,
                textAlign: 'center',
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: '#666',
                  textTransform: 'uppercase',
                  letterSpacing: '.5px',
                  marginBottom: 4,
                }}
              >
                Deposit
              </div>
              <div
                style={{
                  fontSize: 20,
                  fontWeight: 700,
                  color: depositAmt > 0 ? (depositOk ? '#166534' : '#92400e') : '#aaa',
                }}
              >
                {depositAmt > 0 ? `$${Number(depositAmt).toLocaleString()}` : '—'}
              </div>
              {depositAmt > 0 && (
                <div
                  style={{ fontSize: 10, color: depositOk ? '#166534' : '#92400e', marginTop: 2 }}
                >
                  {depositPct}% of total {depositOk ? '✅' : '⚠️ (expect ~33%)'}
                </div>
              )}
            </div>
            {/* Cash Margin to Date */}
            {(() => {
              const netMargin = paymentSummary?.net_margin ?? 0;
              const hasPayments =
                (paymentSummary?.contract_received || 0) !== 0 ||
                (paymentSummary?.sub_material_costs || 0) !== 0;
              const isPositive = netMargin > 0;
              const isNegative = netMargin < 0;
              const bgColor = !hasPayments ? '#f8f8f8' : isPositive ? '#f0fdf4' : '#fef2f2';
              const textColor = !hasPayments ? '#aaa' : isPositive ? '#166534' : '#991b1b';
              return (
                <div
                  style={{
                    background: bgColor,
                    borderRadius: 8,
                    padding: 14,
                    textAlign: 'center',
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      color: '#666',
                      textTransform: 'uppercase',
                      letterSpacing: '.5px',
                      marginBottom: 4,
                    }}
                  >
                    Cash Margin to Date
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: textColor }}>
                    {netMargin < 0 ? '-' : ''}${Math.abs(netMargin).toLocaleString()}
                  </div>
                  <div style={{ fontSize: 10, color: textColor, marginTop: 2 }}>
                    {!hasPayments
                      ? 'No payments recorded yet'
                      : isPositive
                        ? '✅ Cash positive'
                        : isNegative
                          ? '⚠️ Costs exceed collections'
                          : 'Break even'}
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Pipeline Context */}
          {pipelineCtx && (
            <div
              style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: 8,
                padding: 16,
                marginBottom: 16,
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 13, color: BLUE, marginBottom: 12 }}>
                Pipeline Context
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                  gap: 12,
                }}
              >
                <div style={{ textAlign: 'center' }}>
                  <div
                    style={{
                      fontSize: 20,
                      fontWeight: 700,
                      color:
                        pipelineCtx.daysAtCurrentStage > (pipelineCtx.avgDaysToClose || 30)
                          ? '#991b1b'
                          : pipelineCtx.daysAtCurrentStage > 7
                            ? '#92400e'
                            : '#166534',
                    }}
                  >
                    {pipelineCtx.daysAtCurrentStage}d
                  </div>
                  <div style={{ fontSize: 11, color: '#666' }}>At Current Stage</div>
                </div>
                {pipelineCtx.avgDaysToClose !== null && (
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color: BLUE }}>
                      {pipelineCtx.avgDaysToClose}d
                    </div>
                    <div style={{ fontSize: 11, color: '#666' }}>Avg Days to Close</div>
                    <div style={{ fontSize: 10, color: '#aaa' }}>
                      ({pipelineCtx.avgDaysToCloseSample} won jobs)
                    </div>
                  </div>
                )}
                {pipelineCtx.avgWonMargin !== null && (
                  <div style={{ textAlign: 'center' }}>
                    <div
                      style={{
                        fontSize: 20,
                        fontWeight: 700,
                        color:
                          marginData?.actualNetMarginPct &&
                          Math.abs(marginData.actualNetMarginPct - pipelineCtx.avgWonMargin) > 5
                            ? '#92400e'
                            : '#166534',
                      }}
                    >
                      {pipelineCtx.avgWonMargin}%
                    </div>
                    <div style={{ fontSize: 11, color: '#666' }}>Avg Won Margin</div>
                    <div style={{ fontSize: 10, color: '#aaa' }}>
                      ({pipelineCtx.avgWonMarginSample} jobs)
                    </div>
                  </div>
                )}
                {pipelineCtx.avgWonSqftPrice !== null && (
                  <div style={{ textAlign: 'center' }}>
                    <div
                      style={{
                        fontSize: 20,
                        fontWeight: 700,
                        color:
                          sqftPrice && Math.abs(sqftPrice - pipelineCtx.avgWonSqftPrice) > 50
                            ? '#92400e'
                            : '#166534',
                      }}
                    >
                      ${pipelineCtx.avgWonSqftPrice}/sqft
                    </div>
                    <div style={{ fontSize: 11, color: '#666' }}>Avg Won $/sqft</div>
                    <div style={{ fontSize: 10, color: '#aaa' }}>
                      ({pipelineCtx.avgWonSqftPriceSample} jobs)
                    </div>
                  </div>
                )}
              </div>
              {pipelineCtx.daysAtCurrentStage > 14 && (
                <div
                  style={{
                    marginTop: 10,
                    fontSize: 12,
                    color: '#991b1b',
                    background: '#fef2f2',
                    border: '1px solid #fecaca',
                    borderRadius: 6,
                    padding: '10px 12px',
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>
                    ⚠️ Stale — {pipelineCtx.daysAtCurrentStage} days at current stage
                  </div>
                  <div style={{ color: '#7f1d1d', marginBottom: 8 }}>
                    This job has been at <em>{job.status?.replace(/_/g, ' ')}</em> for over 2 weeks.
                    Consider reaching out to the customer to keep momentum.
                  </div>
                  {followUpTask === null && (
                    <button
                      onClick={async () => {
                        setFollowUpTask('creating');
                        const due = new Date();
                        due.setDate(due.getDate() + 2);
                        const dueStr = due.toISOString().slice(0, 16);
                        try {
                          const res = await fetch('/api/tasks', {
                            method: 'POST',
                            headers,
                            body: JSON.stringify({
                              title: `Reach Out: ${job.customer_name}`,
                              description: [
                                `📋 Job: ${job.project_address || 'No address'}`,
                                job.customer_phone ? `📞 Phone: ${job.customer_phone}` : null,
                                job.customer_email ? `✉️ Email: ${job.customer_email}` : null,
                                `📌 Status: ${job.status?.replace(/_/g, ' ')} — stale for ${pipelineCtx.daysAtCurrentStage} days`,
                                `💬 Reach out to check interest and keep the job moving forward.`,
                              ]
                                .filter(Boolean)
                                .join('\n'),
                              due_at: dueStr,
                              job_id: job.id,
                              contact_id: job.contact_id || null,
                              priority: 'high',
                            }),
                          });
                          const data = await res.json();
                          if (data.task) setFollowUpTask(data.task);
                          else setFollowUpTask('error');
                        } catch {
                          setFollowUpTask('error');
                        }
                      }}
                      style={{
                        padding: '5px 14px',
                        background: '#991b1b',
                        color: 'white',
                        border: 'none',
                        borderRadius: 4,
                        fontSize: 12,
                        cursor: 'pointer',
                        fontWeight: 600,
                      }}
                    >
                      + Create Reach Out Task
                    </button>
                  )}
                  {followUpTask === 'creating' && (
                    <div style={{ color: '#7f1d1d', fontStyle: 'italic' }}>Creating task...</div>
                  )}
                  {followUpTask === 'error' && (
                    <div style={{ color: '#7f1d1d' }}>
                      Failed to create task — try again from the Tasks page.
                    </div>
                  )}
                  {followUpTask && typeof followUpTask === 'object' && (
                    <div
                      style={{
                        background: '#fff1f1',
                        border: '1px solid #fca5a5',
                        borderRadius: 4,
                        padding: '7px 10px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        flexWrap: 'wrap',
                      }}
                    >
                      <span style={{ color: '#166534', fontWeight: 600 }}>✅ Task created:</span>
                      <span style={{ color: '#333' }}>{followUpTask.title}</span>
                      {followUpTask.due_at && (
                        <span style={{ color: '#777' }}>
                          — due{' '}
                          {new Date(followUpTask.due_at).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                          })}
                        </span>
                      )}
                      {followUpTask.calendar_url && (
                        <a
                          href={followUpTask.calendar_url}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: '#991b1b', fontWeight: 600, marginLeft: 4 }}
                        >
                          📅 View in Calendar
                        </a>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Flagged items */}
          {(() => {
            const flags =
              Array.isArray(job.flagged_items) && job.flagged_items.length > 0
                ? job.flagged_items
                : pd.flaggedItems?.length > 0
                  ? pd.flaggedItems
                  : [];
            if (flags.length === 0) return null;
            return (
              <div
                style={{
                  background: '#FFF8F0',
                  border: `1px solid ${ORANGE}`,
                  borderRadius: 8,
                  padding: 14,
                  marginBottom: 16,
                }}
              >
                <strong style={{ color: ORANGE, fontSize: 13 }}>
                  ⚠️ Items Flagged by AI ({flags.length})
                </strong>
                <ul style={{ margin: '8px 0 0 18px', fontSize: 13, color: '#5D3A00' }}>
                  {flags.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              </div>
            );
          })()}

          {/* Missing trades */}
          {missingTrades.length > 0 && (
            <div
              style={{
                background: '#fef9f0',
                border: '1px solid #fcd34d',
                borderRadius: 8,
                padding: 14,
                marginBottom: 16,
              }}
            >
              <strong style={{ color: '#92400e', fontSize: 13 }}>
                ⚠️ Expected Trades Not Found ({missingTrades.length})
                <span style={{ fontWeight: 400, fontSize: 12, marginLeft: 8, color: '#b45309' }}>
                  — typical for a {band ? band.label : 'this project type'}
                </span>
              </strong>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {missingTrades.map((t) => (
                  <span
                    key={t.label}
                    style={{
                      background: '#fef3c7',
                      color: '#92400e',
                      borderRadius: 12,
                      padding: '3px 10px',
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    {t.label}
                  </span>
                ))}
              </div>
              <div style={{ fontSize: 11, color: '#b45309', marginTop: 8 }}>
                These trades are typically scoped in a {band ? band.label : 'this type of project'}{' '}
                but appear missing from the estimate. Confirm with the sub or verify the scope
                intentionally excludes them.
                {isADU &&
                  aduOnSeptic &&
                  ' Note: ADU on private septic — Title 5 inspection + septic work may be required.'}
              </div>
            </div>
          )}
          {missingTrades.length === 0 && expectedTrades.length > 0 && (
            <div
              style={{
                background: '#f0fdf4',
                border: '1px solid #bbf7d0',
                borderRadius: 8,
                padding: 10,
                marginBottom: 16,
                fontSize: 12,
                color: '#166534',
              }}
            >
              ✅ All expected trades present for a {band ? band.label : projType || 'this'} project
            </div>
          )}

          {/* Per-trade benchmark table */}
          <div style={{ fontWeight: 600, fontSize: 13, color: '#333', marginBottom: 8 }}>
            Line Item Breakdown vs. PB Benchmarks
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: BLUE, color: 'white' }}>
                <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600 }}>Trade</th>
                <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600 }}>
                  Sub Cost
                </th>
                <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600 }}>
                  Client Price
                </th>
                <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600 }}>
                  PB Benchmark Range
                </th>
                <th style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 600 }}>
                  Status
                </th>
                <th style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 600 }}>RFQ</th>
              </tr>
            </thead>
            <tbody>
              {lineItems.map((li, i) => {
                const bench = matchBench(li.trade);
                const bc = Number(li.baseCost) || 0;
                const bs = benchStatus(bench, bc);
                const statusIcon =
                  bs === 'ok' ? '✅' : bs === 'low' ? '⚠️ Low' : bs === 'high' ? '🔴 High' : '—';
                const statusColor =
                  bs === 'ok'
                    ? '#166534'
                    : bs === 'low'
                      ? '#92400e'
                      : bs === 'high'
                        ? '#991b1b'
                        : '#aaa';
                const rowBg =
                  bs === 'high'
                    ? '#fff1f2'
                    : bs === 'low'
                      ? '#fffbeb'
                      : i % 2 === 0
                        ? 'white'
                        : '#f8f8f8';
                return (
                  <tr key={i} style={{ background: rowBg, borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: '8px 10px', color: '#333' }}>{li.trade}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', color: '#777' }}>
                      ${bc.toLocaleString()}
                    </td>
                    <td
                      style={{
                        padding: '8px 10px',
                        textAlign: 'right',
                        fontWeight: 600,
                        color: BLUE,
                      }}
                    >
                      ${(Number(li.finalPrice) || 0).toLocaleString()}
                    </td>
                    <td
                      style={{ padding: '8px 10px', color: bench ? '#555' : '#bbb', fontSize: 12 }}
                      title={
                        bench
                          ? `Range: $${bench.low?.toLocaleString()}–$${bench.high?.toLocaleString()} (sub cost)`
                          : ''
                      }
                    >
                      {bench ? bench.note : '—'}
                    </td>
                    <td
                      style={{
                        padding: '8px 10px',
                        textAlign: 'center',
                        fontSize: 12,
                        fontWeight: 600,
                        color: statusColor,
                      }}
                    >
                      {statusIcon}
                    </td>
                    <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                      <button
                        onClick={() => openRfqModal(li)}
                        title="Create Request for Quote"
                        style={{
                          background: '#EEF3FB',
                          color: BLUE,
                          border: '1px solid #c7d7f4',
                          borderRadius: 5,
                          padding: '3px 9px',
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        📋 RFQ
                      </button>
                    </td>
                  </tr>
                );
              })}
              <tr
                style={{ background: '#EEF3FB', fontWeight: 700, borderTop: '2px solid #c7d7f4' }}
              >
                <td style={{ padding: '10px', color: BLUE }}>TOTAL</td>
                <td style={{ padding: '10px', textAlign: 'right', color: '#555' }}>
                  ${subTotal.toLocaleString()}
                </td>
                <td style={{ padding: '10px', textAlign: 'right', color: BLUE }}>
                  ${clientTotal.toLocaleString()}
                </td>
                <td style={{ padding: '10px' }}></td>
                <td style={{ padding: '10px' }}></td>
                <td style={{ padding: '10px' }}></td>
              </tr>
            </tbody>
          </table>

          {isLocked && (
            <div
              style={{
                marginTop: 16,
                padding: 12,
                background: '#f1f5f9',
                borderRadius: 8,
                fontSize: 12,
                color: '#64748b',
                textAlign: 'center',
              }}
            >
              🔒 This assessment was locked when the proposal was approved and is preserved as a
              permanent historical record for this job.
            </div>
          )}
        </>
      )}
    </div>
  );
}
