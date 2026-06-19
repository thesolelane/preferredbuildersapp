import React from 'react';
import { BLUE } from './constants';

const fmt = (n) =>
  `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function BalanceBar({ job, paymentSummary }) {
  if (!job?.total_value) return null;
  const contractTotal = Number(job.total_value);
  const collected = Number(paymentSummary?.contract_received || 0);
  const depositDue = Number(job.deposit_amount || 0);
  const remaining = Math.max(0, contractTotal - collected);
  const pct = Math.min(100, contractTotal > 0 ? (collected / contractTotal) * 100 : 0);

  const seg = (label, value, color, tip) => (
    <div style={{ textAlign: 'center', flex: 1 }}>
      <div
        style={{
          fontSize: 10,
          color: '#888',
          marginBottom: 2,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 14, fontWeight: 800, color }} title={tip}>
        {fmt(value)}
      </div>
    </div>
  );

  return (
    <div
      style={{
        background: '#f8f9ff',
        border: '1px solid #d0d9f4',
        borderRadius: 8,
        padding: '12px 16px',
        marginBottom: 20,
      }}
    >
      <div
        style={{
          display: 'flex',
          gap: 8,
          justifyContent: 'space-around',
          marginBottom: 10,
          flexWrap: 'wrap',
        }}
      >
        {seg('Contract Total', contractTotal, '#1B3A6B', 'Full contract value')}
        {seg('Deposit Due', depositDue, '#E07B2A', '33% deposit')}
        {seg('Collected', collected, '#2E7D32', 'Payments received')}
        {seg('Remaining', remaining, remaining > 0 ? '#C62828' : '#2E7D32', 'Balance outstanding')}
      </div>
      <div style={{ height: 8, background: '#e5e7eb', borderRadius: 4, overflow: 'hidden' }}>
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            background: pct >= 100 ? '#2E7D32' : '#3B82F6',
            borderRadius: 4,
            transition: 'width 0.4s ease',
          }}
        />
      </div>
      <div style={{ fontSize: 10, color: '#888', textAlign: 'right', marginTop: 3 }}>
        {pct.toFixed(0)}% collected
      </div>
    </div>
  );
}

export default function JobOverviewTab({
  job,
  paymentSummary,
  canEditCustomer,
  editingCustomer,
  setEditingCustomer,
  customerForm,
  setCustomerForm,
  savingCustomer,
  openCustomerEdit,
  handleCustomerSave,
  note,
  setNote,
  saveNote,
}) {
  return (
    <div>
      <BalanceBar job={job} paymentSummary={paymentSummary} />
      <h3 style={{ color: BLUE, marginBottom: 16 }}>Project Details</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          {[
            ['Customer', job.customer_name],
            ['Customer #', job.contact?.pb_customer_number || job.pb_customer_number || null],
            ['Email', job.customer_email],
            ['Phone', job.customer_phone],
            ['Project Address', job.project_address],
            ['City', job.project_city],
            [
              'Stretch Code Town',
              job.stretch_code_town ? '✅ Yes — Stretch Code applies' : '❌ No',
            ],
            [
              'Submitted Via',
              (() => {
                const s = job.submitted_by || '';
                if (s.startsWith('web:')) return `🖥️ Web Portal (${s.slice(4)})`;
                if (s.startsWith('whatsapp:'))
                  return `📱 WhatsApp (${s.replace('whatsapp:+1', '').replace('whatsapp:', '')})`;
                if (s === 'wizard' || s === 'manual') return '🖥️ Web Portal';
                if (s === 'hearth_api') return '🔗 Hearth API';
                return s || '—';
              })(),
            ],
            [
              'Proposal #',
              job.quote_number ? `${job.quote_number}${job.version ? `/${job.version}` : ''}` : '—',
            ],
            ['Total Value', job.total_value ? `$${job.total_value.toLocaleString()}` : '—'],
            ['Deposit', job.deposit_amount ? `$${job.deposit_amount.toLocaleString()}` : '—'],
          ]
            .filter(([, v]) => v != null)
            .map(([label, value]) => (
              <tr key={label} style={{ borderBottom: '1px solid #f0f0f0' }}>
                <td style={{ padding: '10px 0', fontSize: 12, color: '#888', width: 160 }}>
                  {label}
                </td>
                <td style={{ padding: '10px 0', fontSize: 13, color: '#222' }}>{value || '—'}</td>
              </tr>
            ))}
        </tbody>
      </table>

      {/* Edit Customer Info */}
      {canEditCustomer && !editingCustomer && (
        <div style={{ marginTop: 12 }}>
          <button
            onClick={openCustomerEdit}
            style={{
              fontSize: 12,
              padding: '5px 14px',
              background: 'transparent',
              border: '1px solid #c7d7f4',
              borderRadius: 6,
              color: BLUE,
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            ✏️ Edit Customer Info
          </button>
        </div>
      )}

      {canEditCustomer && editingCustomer && (
        <div
          style={{
            marginTop: 16,
            background: '#f8faff',
            border: '1px solid #c7d7f4',
            borderRadius: 10,
            padding: 18,
          }}
        >
          <div style={{ fontWeight: 700, color: BLUE, marginBottom: 14, fontSize: 14 }}>
            Edit Customer Info
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {[
              { label: 'Name', key: 'name', type: 'text' },
              { label: 'Email', key: 'email', type: 'email' },
              { label: 'Phone', key: 'phone', type: 'tel' },
              { label: 'Address', key: 'address', type: 'text' },
              { label: 'City', key: 'city', type: 'text' },
            ].map(({ label, key, type }) => (
              <div key={key}>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>{label}</div>
                <input
                  type={type}
                  value={customerForm[key]}
                  onChange={(e) => setCustomerForm((f) => ({ ...f, [key]: e.target.value }))}
                  style={{
                    width: '100%',
                    padding: '7px 10px',
                    border: '1px solid #ddd',
                    borderRadius: 6,
                    fontSize: 13,
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button
              onClick={handleCustomerSave}
              disabled={savingCustomer}
              style={{
                padding: '7px 18px',
                background: BLUE,
                color: 'white',
                border: 'none',
                borderRadius: 6,
                fontSize: 13,
                cursor: savingCustomer ? 'not-allowed' : 'pointer',
                fontWeight: 600,
                opacity: savingCustomer ? 0.7 : 1,
              }}
            >
              {savingCustomer ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={() => setEditingCustomer(false)}
              disabled={savingCustomer}
              style={{
                padding: '7px 14px',
                background: 'transparent',
                border: '1px solid #ddd',
                borderRadius: 6,
                fontSize: 13,
                cursor: 'pointer',
                color: '#666',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Property Record */}
      {(() => {
        let pd = null;
        try {
          pd = job.property_data ? JSON.parse(job.property_data) : null;
        } catch (_e) {
          /* invalid JSON */
        }
        if (!pd) return null;
        const mg = pd.massGis;
        const lc = pd.leadCheck;
        const hasAnyData = mg || lc;
        if (!hasAnyData) return null;

        const LeadBadge = () => {
          if (!lc) return null;
          if (lc.hasRecord) {
            return (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  fontSize: 12,
                  fontWeight: 600,
                  padding: '3px 10px',
                  borderRadius: 6,
                  border: '1px solid #fca5a5',
                  background: '#fef2f2',
                  color: '#b91c1c',
                }}
              >
                ⚠ Lead record found
              </span>
            );
          }
          return (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                fontSize: 12,
                fontWeight: 600,
                padding: '3px 10px',
                borderRadius: 6,
                border: '1px solid #86efac',
                background: '#f0fdf4',
                color: '#15803d',
              }}
            >
              ✓ No lead record found
            </span>
          );
        };

        const linkStyle = {
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          fontSize: 11,
          fontWeight: 600,
          padding: '3px 10px',
          borderRadius: 6,
          border: '1px solid #d1d5db',
          background: 'transparent',
          color: '#374151',
          textDecoration: 'none',
          marginLeft: 6,
        };

        const rows = [];
        if (mg && !mg.webSearchFallback) {
          if (mg.yearBuilt) rows.push(['Year Built', mg.yearBuilt]);
          if (mg.buildingArea)
            rows.push(['Building Area', `${Number(mg.buildingArea).toLocaleString()} sq ft`]);
          if (mg.lotSize) rows.push(['Lot Size', `${Number(mg.lotSize).toLocaleString()} sq ft`]);
          if (mg.totalAssessedValue)
            rows.push(['Assessed Value', `$${Number(mg.totalAssessedValue).toLocaleString()}`]);
          if (mg.useCodeLabel) rows.push(['Use', mg.useCodeLabel]);
          if (mg.owner1) rows.push(['Owner', [mg.owner1, mg.owner2].filter(Boolean).join(' / ')]);
          if (mg.numBedrooms) rows.push(['Bedrooms', mg.numBedrooms]);
          if (mg.numBathrooms) rows.push(['Bathrooms', mg.numBathrooms]);
          if (mg.style) rows.push(['Style', mg.style]);
          if (mg.stories) rows.push(['Stories', mg.stories]);
        }

        return (
          <div
            style={{
              marginTop: 28,
              background: '#f8faff',
              border: '1px solid #e0e7ff',
              borderRadius: 10,
              padding: '16px 20px',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 8,
                marginBottom: 12,
              }}
            >
              <h3 style={{ color: BLUE, margin: 0, fontSize: 15 }}>Property Record</h3>
              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                <LeadBadge />
                {lc && (
                  <>
                    <a
                      href={lc.leadsafeUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={linkStyle}
                    >
                      Lead Safe Homes 1.0 ↗
                    </a>
                    <a
                      href={lc.leadsafe2Url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={linkStyle}
                    >
                      Lead Safe Homes 2.0 ↗
                    </a>
                  </>
                )}
              </div>
            </div>
            {rows.length > 0 && (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  {rows.map(([label, value]) => (
                    <tr key={label} style={{ borderBottom: '1px solid #e8edf5' }}>
                      <td style={{ padding: '7px 0', fontSize: 12, color: '#888', width: 160 }}>
                        {label}
                      </td>
                      <td style={{ padding: '7px 0', fontSize: 13, color: '#222' }}>{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {mg?.webSearchFallback && (
              <div style={{ fontSize: 12, color: '#666', marginTop: 8 }}>
                <em>MassGIS had no direct record — property info sourced from web search.</em>
              </div>
            )}
            {lc?.note && (
              <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 8 }}>
                {lc.note}
                {lc.queriedAt && (
                  <span style={{ marginLeft: 6 }}>
                    · checked {new Date(lc.queriedAt).toLocaleDateString()}
                  </span>
                )}
              </div>
            )}
            {pd.enrichedAt && (
              <div style={{ fontSize: 11, color: '#bbb', marginTop: 6 }}>
                Data fetched {new Date(pd.enrichedAt).toLocaleDateString()}
                {' · '}source: MassGIS L3 Parcel / Lead Safe Homes 1.0
              </div>
            )}
          </div>
        );
      })()}

      {/* Internal Notes */}
      <div style={{ marginTop: 24 }}>
        <h3 style={{ color: BLUE, marginBottom: 10 }}>Internal Notes</h3>
        <textarea
          rows={4}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          style={{
            width: '100%',
            padding: 10,
            border: '1px solid #ddd',
            borderRadius: 6,
            fontSize: 13,
            boxSizing: 'border-box',
            resize: 'vertical',
          }}
          placeholder="Add internal notes here..."
        />
        <button
          onClick={saveNote}
          style={{
            marginTop: 8,
            padding: '8px 16px',
            background: BLUE,
            color: 'white',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          Save Note
        </button>
      </div>
    </div>
  );
}
