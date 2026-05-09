import { useState, useEffect, useCallback } from 'react';
import DirectInvoiceModal from '../components/DirectInvoiceModal';
import { showToast } from '../utils/toast';
import { showConfirm } from '../utils/confirm';

const BLUE = '#1B3A6B';
const GREEN = '#2E7D32';
const RED = '#C62828';

const fmt = (n) =>
  `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (d) =>
  d
    ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '—';

const STATUS_COLOR = { draft: '#888', sent: '#3B82F6', paid: GREEN };

export default function Invoices({ token }) {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [filterStatus, setFilterStatus] = useState('');
  const [search, setSearch] = useState('');
  const [sending, setSending] = useState(null);

  const headers = { 'x-auth-token': token, 'Content-Type': 'application/json' };

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/direct-invoices', { headers: { 'x-auth-token': token } })
      .then((r) => r.json())
      .then((data) => {
        setInvoices(data.invoices || []);
        setLoading(false);
      });
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const sendInvoice = async (inv) => {
    if (!inv.to_email) return showToast('No email on this invoice', 'error');
    setSending(inv.id);
    const res = await fetch(`/api/direct-invoices/${inv.id}/send`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ to_email: inv.to_email }),
    });
    const data = await res.json();
    if (res.ok) {
      load();
      showToast(`Invoice sent to ${inv.to_email}`);
    } else {
      showToast(data.error || 'Send failed', 'error');
    }
    setSending(null);
  };

  const markPaid = async (inv) => {
    const res = await fetch(`/api/direct-invoices/${inv.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status: 'paid' }),
    });
    if (res.ok) {
      load();
      showToast('Invoice marked paid');
    }
  };

  const deleteInv = async (inv) => {
    if (!(await showConfirm(`Delete invoice ${inv.invoice_number}?`))) return;
    const res = await fetch(`/api/direct-invoices/${inv.id}`, { method: 'DELETE', headers });
    if (res.ok) {
      load();
      showToast('Invoice deleted');
    }
  };

  const filtered = invoices.filter((inv) => {
    if (filterStatus && inv.status !== filterStatus) return false;
    if (search) {
      const q = search.toLowerCase();
      if (
        !(inv.invoice_number || '').toLowerCase().includes(q) &&
        !(inv.to_name || '').toLowerCase().includes(q) &&
        !(inv.to_email || '').toLowerCase().includes(q)
      )
        return false;
    }
    return true;
  });

  const totalPaid = invoices
    .filter((i) => i.status === 'paid')
    .reduce((s, i) => s + Number(i.total || 0), 0);
  const totalPending = invoices
    .filter((i) => i.status === 'sent')
    .reduce((s, i) => s + Number(i.total || 0), 0);

  return (
    <div style={{ padding: '28px 24px', maxWidth: 900, margin: '0 auto' }}>
      {showModal && (
        <DirectInvoiceModal
          jobId={null}
          job={null}
          token={token}
          onClose={() => setShowModal(false)}
          onSaved={load}
        />
      )}

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 20,
        }}
      >
        <h2 style={{ color: BLUE, margin: 0, fontSize: 22 }}>Customer Invoices</h2>
        <button
          onClick={() => setShowModal(true)}
          style={{
            padding: '9px 18px',
            background: '#4F46E5',
            color: 'white',
            border: 'none',
            borderRadius: 7,
            cursor: 'pointer',
            fontWeight: 'bold',
            fontSize: 13,
          }}
        >
          + New Invoice
        </button>
      </div>

      {/* Summary cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 14,
          marginBottom: 24,
        }}
      >
        {[
          { label: 'Total Invoices', value: invoices.length, color: BLUE },
          { label: 'Outstanding', value: fmt(totalPending), color: '#3B82F6' },
          { label: 'Collected', value: fmt(totalPaid), color: GREEN },
        ].map((c) => (
          <div
            key={c.label}
            style={{
              background: 'white',
              border: '1px solid #e5e7eb',
              borderRadius: 8,
              padding: '14px 16px',
              textAlign: 'center',
            }}
          >
            <div
              style={{
                fontSize: 11,
                color: '#888',
                marginBottom: 4,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              {c.label}
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: c.color }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
        <input
          placeholder="Search name, email, invoice #"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            flex: 1,
            minWidth: 180,
            padding: '7px 12px',
            border: '1px solid #ddd',
            borderRadius: 6,
            fontSize: 13,
          }}
        />
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          style={{ padding: '7px 10px', border: '1px solid #ddd', borderRadius: 6, fontSize: 13 }}
        >
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="sent">Sent</option>
          <option value="paid">Paid</option>
        </select>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', color: '#888', padding: 40 }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            color: '#aaa',
            padding: '48px 20px',
            background: 'white',
            borderRadius: 10,
            border: '1px solid #e5e7eb',
          }}
        >
          <div style={{ fontSize: 36, marginBottom: 12 }}>🧾</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#555', marginBottom: 6 }}>
            No invoices yet
          </div>
          <div style={{ fontSize: 13 }}>Click "New Invoice" to create one — no job required.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map((inv) => {
            const sc = STATUS_COLOR[inv.status] || '#888';
            return (
              <div
                key={inv.id}
                style={{
                  background: 'white',
                  border: '1px solid #e5e7eb',
                  borderRadius: 9,
                  padding: '12px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 10,
                }}
              >
                <div
                  style={{
                    fontFamily: 'monospace',
                    fontSize: 12,
                    fontWeight: 700,
                    color: '#4F46E5',
                    minWidth: 160,
                  }}
                >
                  {inv.invoice_number}
                </div>
                <div style={{ flex: 1, minWidth: 120 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#333' }}>
                    {inv.to_name || inv.to_email || '—'}
                  </div>
                  {inv.to_email && inv.to_name && (
                    <div style={{ fontSize: 11, color: '#888' }}>{inv.to_email}</div>
                  )}
                </div>
                <div style={{ fontSize: 13, color: '#555' }}>{fmtDate(inv.created_at)}</div>
                <div
                  style={{
                    fontWeight: 800,
                    fontSize: 15,
                    color: '#4F46E5',
                    minWidth: 90,
                    textAlign: 'right',
                  }}
                >
                  {fmt(inv.total)}
                </div>
                <span
                  style={{
                    fontSize: 10,
                    padding: '2px 9px',
                    borderRadius: 10,
                    background: sc + '22',
                    color: sc,
                    fontWeight: 700,
                    minWidth: 44,
                    textAlign: 'center',
                  }}
                >
                  {(inv.status || 'draft').toUpperCase()}
                </span>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  <a
                    href={`/api/direct-invoices/${inv.id}/pdf?token=${encodeURIComponent(token || '')}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      fontSize: 11,
                      padding: '4px 10px',
                      background: '#4F46E511',
                      color: '#4F46E5',
                      border: '1px solid #4F46E522',
                      borderRadius: 5,
                      textDecoration: 'none',
                    }}
                  >
                    PDF
                  </a>
                  {inv.to_email && inv.status !== 'paid' && (
                    <button
                      onClick={() => sendInvoice(inv)}
                      disabled={sending === inv.id}
                      style={{
                        fontSize: 11,
                        padding: '4px 10px',
                        background: '#3B82F611',
                        color: '#3B82F6',
                        border: '1px solid #3B82F622',
                        borderRadius: 5,
                        cursor: 'pointer',
                      }}
                    >
                      {sending === inv.id ? 'Sending…' : inv.status === 'sent' ? 'Resend' : 'Send'}
                    </button>
                  )}
                  {inv.status !== 'paid' && (
                    <button
                      onClick={() => markPaid(inv)}
                      style={{
                        fontSize: 11,
                        padding: '4px 10px',
                        background: '#2E7D3211',
                        color: GREEN,
                        border: '1px solid #2E7D3222',
                        borderRadius: 5,
                        cursor: 'pointer',
                      }}
                    >
                      Mark Paid
                    </button>
                  )}
                  <button
                    onClick={() => deleteInv(inv)}
                    style={{
                      fontSize: 11,
                      padding: '4px 10px',
                      background: '#ff000011',
                      color: RED,
                      border: '1px solid #ff000022',
                      borderRadius: 5,
                      cursor: 'pointer',
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
