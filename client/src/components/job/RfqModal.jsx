import React from 'react';
import { BLUE } from './constants';

export default function RfqModal({
  rfqModal,
  setRfqModal,
  rfqForm,
  setRfqForm,
  rfqList,
  vendors,
  job,
  generateRfqScope,
  saveRfq,
  sendRfq,
  deleteRfq,
}) {
  if (!rfqModal) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        zIndex: 9000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) setRfqModal(null);
      }}
    >
      <div
        style={{
          background: 'white',
          borderRadius: 12,
          width: '100%',
          maxWidth: 560,
          maxHeight: '90vh',
          overflow: 'auto',
          boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
        }}
      >
        {/* Header */}
        <div
          style={{
            background: BLUE,
            padding: '16px 22px',
            borderRadius: '12px 12px 0 0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <div style={{ color: '#F5A623', fontWeight: 700, fontSize: 15 }}>Request for Quote</div>
            <div style={{ color: '#ccc', fontSize: 12, marginTop: 2 }}>
              {rfqModal.trade} — {job?.project_address || 'Project'}
            </div>
          </div>
          <button
            onClick={() => setRfqModal(null)}
            style={{
              background: 'none',
              border: 'none',
              color: 'white',
              fontSize: 20,
              cursor: 'pointer',
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ padding: '20px 22px' }}>
          {/* Scope text */}
          <label
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: '#555',
              display: 'block',
              marginBottom: 6,
            }}
          >
            Scope of Work
          </label>
          <textarea
            value={rfqForm.scopeText}
            onChange={(e) => setRfqForm((f) => ({ ...f, scopeText: e.target.value }))}
            rows={5}
            placeholder="Describe the work the sub should quote…"
            style={{
              width: '100%',
              border: '1px solid #dde3ed',
              borderRadius: 8,
              padding: '10px 12px',
              fontSize: 13,
              resize: 'vertical',
              fontFamily: 'inherit',
              lineHeight: 1.5,
              boxSizing: 'border-box',
            }}
          />
          <button
            onClick={generateRfqScope}
            disabled={rfqForm.generating}
            style={{
              marginTop: 6,
              background: rfqForm.generating ? '#ccc' : '#EEF3FB',
              color: BLUE,
              border: `1px solid ${BLUE}`,
              borderRadius: 6,
              padding: '6px 14px',
              fontSize: 12,
              fontWeight: 600,
              cursor: rfqForm.generating ? 'not-allowed' : 'pointer',
            }}
          >
            {rfqForm.generating ? '⏳ Generating…' : '✨ AI-Generate Scope'}
          </button>

          {/* Vendor picker */}
          <label
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: '#555',
              display: 'block',
              marginTop: 16,
              marginBottom: 6,
            }}
          >
            Sub / Vendor
          </label>
          <select
            value={rfqForm.vendorId}
            onChange={(e) => {
              const v = vendors.find((x) => String(x.id) === e.target.value);
              setRfqForm((f) => ({
                ...f,
                vendorId: e.target.value,
                vendorName: v?.company_name || '',
                vendorEmail: v?.email || '',
              }));
            }}
            style={{
              width: '100%',
              border: '1px solid #dde3ed',
              borderRadius: 8,
              padding: '8px 12px',
              fontSize: 13,
              background: 'white',
              boxSizing: 'border-box',
            }}
          >
            <option value="">— Select vendor (optional) —</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.company_name}
                {v.trade ? ` — ${v.trade}` : ''}
              </option>
            ))}
          </select>

          {/* Vendor email */}
          <label
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: '#555',
              display: 'block',
              marginTop: 12,
              marginBottom: 6,
            }}
          >
            Vendor Email
          </label>
          <input
            type="email"
            value={rfqForm.vendorEmail}
            onChange={(e) => setRfqForm((f) => ({ ...f, vendorEmail: e.target.value }))}
            placeholder="vendor@example.com"
            style={{
              width: '100%',
              border: '1px solid #dde3ed',
              borderRadius: 8,
              padding: '8px 12px',
              fontSize: 13,
              boxSizing: 'border-box',
            }}
          />

          {/* Due date */}
          <label
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: '#555',
              display: 'block',
              marginTop: 12,
              marginBottom: 6,
            }}
          >
            Quote Due By
          </label>
          <input
            type="date"
            value={rfqForm.dueDate}
            onChange={(e) => setRfqForm((f) => ({ ...f, dueDate: e.target.value }))}
            style={{
              border: '1px solid #dde3ed',
              borderRadius: 8,
              padding: '8px 12px',
              fontSize: 13,
            }}
          />

          {/* Internal cost note */}
          {rfqModal.baseCost > 0 && (
            <div
              style={{
                marginTop: 12,
                padding: '8px 12px',
                background: '#fffbe6',
                border: '1px solid #f5c842',
                borderRadius: 6,
                fontSize: 12,
                color: '#7a6000',
              }}
            >
              Internal target: <strong>${Number(rfqModal.baseCost).toLocaleString()}</strong> sub
              cost — not shown to vendor
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
            <button
              onClick={saveRfq}
              disabled={rfqForm.saving || !rfqForm.scopeText.trim()}
              style={{
                background: '#f0fdf4',
                color: '#166534',
                border: '1px solid #bbf7d0',
                borderRadius: 7,
                padding: '8px 18px',
                fontSize: 13,
                fontWeight: 600,
                cursor: rfqForm.saving ? 'not-allowed' : 'pointer',
              }}
            >
              {rfqForm.saving ? 'Saving…' : '💾 Save Draft'}
            </button>
          </div>

          {/* Existing RFQs for this trade */}
          {rfqList.filter((r) => r.trade === rfqModal.trade).length > 0 && (
            <div style={{ marginTop: 22, borderTop: '1px solid #eef1f6', paddingTop: 16 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: '#888',
                  marginBottom: 10,
                  textTransform: 'uppercase',
                  letterSpacing: '.3px',
                }}
              >
                Saved RFQs — {rfqModal.trade}
              </div>
              {rfqList
                .filter((r) => r.trade === rfqModal.trade)
                .map((r) => (
                  <div
                    key={r.id}
                    style={{
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      borderRadius: 8,
                      padding: '10px 14px',
                      marginBottom: 8,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        gap: 8,
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, color: '#888' }}>
                          {r.created_date}
                          {r.vendor_name && (
                            <span style={{ marginLeft: 8, color: '#555' }}>→ {r.vendor_name}</span>
                          )}
                          {r.status === 'sent' && (
                            <span style={{ marginLeft: 8, color: '#166534', fontWeight: 600 }}>
                              ✓ Sent {r.sent_date}
                            </span>
                          )}
                          {r.status === 'draft' && (
                            <span style={{ marginLeft: 8, color: '#92400e' }}>Draft</span>
                          )}
                        </div>
                        <div
                          style={{
                            fontSize: 12,
                            color: '#555',
                            marginTop: 4,
                            fontStyle: 'italic',
                            lineHeight: 1.4,
                          }}
                        >
                          {(r.scope_text || '').slice(0, 120)}
                          {r.scope_text?.length > 120 ? '…' : ''}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        {r.status === 'draft' && r.vendor_email && (
                          <button
                            onClick={() => sendRfq(r.id)}
                            disabled={rfqForm.sending}
                            style={{
                              background: BLUE,
                              color: 'white',
                              border: 'none',
                              borderRadius: 5,
                              padding: '4px 10px',
                              fontSize: 11,
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            {rfqForm.sending ? '…' : '📧 Send'}
                          </button>
                        )}
                        <button
                          onClick={() => deleteRfq(r.id)}
                          style={{
                            background: 'none',
                            color: '#aaa',
                            border: '1px solid #ddd',
                            borderRadius: 5,
                            padding: '4px 8px',
                            fontSize: 11,
                            cursor: 'pointer',
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
