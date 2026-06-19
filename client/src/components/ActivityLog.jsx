import { useState, useEffect, useCallback } from 'react';
import { showToast } from '../utils/toast';

const BLUE = '#1B3A6B';
const GREEN = '#2E7D32';
const RED = '#C62828';
const ORANGE = '#E07B2A';
const TEAL = '#0D9488';
const PURPLE = '#7C3AED';

const EVENT_CONFIG = {
  ESTIMATE_CREATED: { label: 'Estimate Created', color: '#3B82F6', bg: '#eff6ff' },
  ESTIMATE_APPROVED: { label: 'Estimate Approved', color: '#059669', bg: '#f0fdf4' },
  CONTRACT_GENERATED: { label: 'Contract Generated', color: BLUE, bg: '#eff6ff' },
  CONTRACT_SIGNED: { label: 'Contract Signed', color: GREEN, bg: '#f0fdf4' },
  INVOICE_ISSUED: { label: 'Invoice Issued', color: TEAL, bg: '#f0fdfa' },
  PAYMENT_RECEIVED: { label: 'Payment Received', color: GREEN, bg: '#f0fdf4' },
  PAYMENT_MADE: { label: 'Payment Made', color: RED, bg: '#fff5f5' },
  PASS_THROUGH_PAID: { label: 'Pass-Through Paid', color: ORANGE, bg: '#fffbeb' },
  PASS_THROUGH_REIMBURSED: { label: 'Pass-Through Reimbursed', color: TEAL, bg: '#f0fdfa' },
  CHANGE_ORDER_CREATED: { label: 'Change Order', color: PURPLE, bg: '#faf5ff' },
  INVOICE_UPDATED: { label: 'Invoice Edited', color: TEAL, bg: '#f0fdfa' },
  JOB_COMPLETED: { label: 'Job Completed', color: GREEN, bg: '#f0fdf4' },
  NOTE: { label: 'Note', color: '#888', bg: '#f9f9f9' },
};

function fmtTs(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return (
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' ' +
    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
  );
}

export default function ActivityLog({ jobId, customerNumber, token, collapsed = true }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(!collapsed);
  const [showNote, setShowNote] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [saving, setSaving] = useState(false);

  const headers = { 'x-auth-token': token, 'Content-Type': 'application/json' };

  const load = useCallback(() => {
    if (!jobId && !customerNumber) return;
    setLoading(true);
    const params = new URLSearchParams({ limit: 100 });
    if (jobId) params.set('job_id', jobId);
    if (customerNumber) params.set('customer_number', customerNumber);
    fetch(`/api/activity-log?${params}`, { headers: { 'x-auth-token': token } })
      .then((r) => r.json())
      .then((d) => {
        setEntries(d.entries || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [jobId, customerNumber, token]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const addNote = async () => {
    if (!noteText.trim()) return showToast('Enter a note', 'error');
    setSaving(true);
    const res = await fetch('/api/activity-log', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        job_id: jobId,
        customer_number: customerNumber,
        event_type: 'NOTE',
        description: noteText.trim(),
      }),
    });
    if (res.ok) {
      setNoteText('');
      setShowNote(false);
      load();
      showToast('Note added');
    } else {
      const d = await res.json();
      showToast(d.error || 'Failed', 'error');
    }
    setSaving(false);
  };

  return (
    <div style={{ borderTop: '2px solid #eee', paddingTop: 16, marginTop: 16 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: open ? 12 : 0,
        }}
      >
        <button
          onClick={() => setOpen(!open)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: BLUE,
            fontWeight: 'bold',
            fontSize: 14,
            padding: 0,
          }}
        >
          <span style={{ fontSize: 12 }}>{open ? '▼' : '▶'}</span>
          Activity Log
          <span style={{ fontSize: 12, fontWeight: 'normal', color: '#888' }}>
            ({entries.length})
          </span>
        </button>
        {open && (
          <button
            onClick={() => setShowNote(!showNote)}
            style={{
              fontSize: 11,
              padding: '4px 12px',
              background: '#f0f4ff',
              color: BLUE,
              border: '1px solid #c8d4e4',
              borderRadius: 6,
              cursor: 'pointer',
              fontWeight: 'bold',
            }}
          >
            + Add Note
          </button>
        )}
      </div>

      {open && (
        <div>
          {showNote && (
            <div
              style={{
                marginBottom: 12,
                background: '#f8f9ff',
                border: '1px solid #c8d4e4',
                borderRadius: 8,
                padding: 12,
              }}
            >
              <textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Add a note to the activity log..."
                rows={3}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  border: '1px solid #ddd',
                  borderRadius: 6,
                  fontSize: 12,
                  boxSizing: 'border-box',
                  resize: 'vertical',
                  fontFamily: 'inherit',
                  marginBottom: 8,
                }}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={addNote}
                  disabled={saving}
                  style={{
                    padding: '6px 14px',
                    background: BLUE,
                    color: 'white',
                    border: 'none',
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    fontSize: 12,
                  }}
                >
                  {saving ? 'Saving...' : 'Add Note'}
                </button>
                <button
                  onClick={() => setShowNote(false)}
                  style={{
                    padding: '6px 12px',
                    background: 'none',
                    border: '1px solid #ddd',
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontSize: 12,
                    color: '#888',
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {loading ? (
            <div style={{ color: '#888', fontSize: 13, padding: '8px 0' }}>Loading activity...</div>
          ) : entries.length === 0 ? (
            <div style={{ color: '#aaa', fontSize: 13, padding: '12px 0' }}>
              No activity recorded yet.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {entries.map((e) => {
                const cfg = EVENT_CONFIG[e.event_type] || EVENT_CONFIG.NOTE;
                return (
                  <div
                    key={e.id}
                    style={{
                      display: 'flex',
                      gap: 12,
                      padding: '8px 12px',
                      background: cfg.bg,
                      borderRadius: 7,
                      border: `1px solid ${cfg.color}22`,
                    }}
                  >
                    <div style={{ flexShrink: 0, paddingTop: 2 }}>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 'bold',
                          color: cfg.color,
                          background: cfg.bg,
                          border: `1px solid ${cfg.color}44`,
                          padding: '2px 6px',
                          borderRadius: 8,
                          display: 'inline-block',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {cfg.label}
                      </span>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, color: '#333' }}>{e.description}</div>
                      {e.document_ref && (
                        <div
                          style={{
                            fontSize: 11,
                            color: '#888',
                            marginTop: 2,
                            fontFamily: 'monospace',
                          }}
                        >
                          Ref: {e.document_ref}
                        </div>
                      )}
                    </div>
                    <div style={{ flexShrink: 0, textAlign: 'right' }}>
                      <div style={{ fontSize: 11, color: '#888' }}>{fmtTs(e.created_at)}</div>
                      {e.recorded_by && e.recorded_by !== 'system' && (
                        <div style={{ fontSize: 10, color: '#aaa', marginTop: 2 }}>
                          {e.recorded_by}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
