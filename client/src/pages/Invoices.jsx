import { useState, useEffect, useCallback } from 'react';
import DirectInvoiceModal from '../components/DirectInvoiceModal';
import { showToast } from '../utils/toast';
import { showConfirm } from '../utils/confirm';

const BLUE = '#1B3A6B';
const GREEN = '#2E7D32';
const RED = '#C62828';
const ORANGE = '#E07B2A';

const fmt = (n) =>
  `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (d) =>
  d
    ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '—';

const STATUS_COLOR = {
  draft: '#888',
  sent: '#3B82F6',
  pending_send: ORANGE,
  paid: GREEN,
  void: '#aaa',
};

const TYPE_LABELS = {
  contract_invoice: 'Deposit',
  pass_through_invoice: 'Pass-Through',
  change_order: 'Change Order',
  combined_invoice: 'Combined',
  direct: 'Direct',
};

const EMPTY_INV_ALLOC = { job_id: '', payment_class: 'contract', amount: '', notes: '' };

export default function Invoices({ token }) {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [filterStatus, setFilterStatus] = useState('');
  const [search, setSearch] = useState('');
  const [sending, setSending] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [splitPayInv, setSplitPayInv] = useState(null);
  const [splitAllocs, setSplitAllocs] = useState([{ ...EMPTY_INV_ALLOC }, { ...EMPTY_INV_ALLOC }]);
  const [savingSplit, setSavingSplit] = useState(false);
  const [editInv, setEditInv] = useState(null);
  const [editForm, setEditForm] = useState({ amount: '', notes: '' });
  const [savingEdit, setSavingEdit] = useState(false);
  const [markPaidInv, setMarkPaidInv] = useState(null);
  const [markPaidCheck, setMarkPaidCheck] = useState('');

  const headers = { 'x-auth-token': token, 'Content-Type': 'application/json' };

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/invoices/all', { headers: { 'x-auth-token': token } })
      .then((r) => r.json())
      .then((data) => {
        setInvoices(data.invoices || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const loadJobs = () => {
    if (jobs.length > 0) return;
    fetch('/api/jobs', { headers: { 'x-auth-token': token } })
      .then((r) => r.json())
      .then((d) => setJobs((d.jobs || []).filter((j) => !j.archived)));
  };

  const sendJobInvoice = async (inv) => {
    setSending(inv.id);
    const res = await fetch(`/api/invoices/${inv.id}/email`, { method: 'POST', headers });
    const data = await res.json();
    if (res.ok) {
      load();
      showToast('Invoice emailed to customer');
    } else {
      showToast(data.error || 'Send failed', 'error');
    }
    setSending(null);
  };

  const sendDirectInvoice = async (inv) => {
    if (!inv.customer_email) return showToast('No email on this invoice', 'error');
    setSending(inv.id);
    const res = await fetch(`/api/direct-invoices/${inv.id}/send`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ to_email: inv.customer_email }),
    });
    const data = await res.json();
    if (res.ok) {
      load();
      showToast(`Invoice sent to ${inv.customer_email}`);
    } else {
      showToast(data.error || 'Send failed', 'error');
    }
    setSending(null);
  };

  const markPaid = async (inv, checkNumber) => {
    const url = inv.source === 'job' ? `/api/invoices/${inv.id}` : `/api/direct-invoices/${inv.id}`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status: 'paid', check_number: checkNumber || null }),
    });
    if (res.ok) {
      setMarkPaidInv(null);
      setMarkPaidCheck('');
      load();
      showToast('Invoice marked paid');
    } else {
      const d = await res.json().catch(() => ({}));
      showToast(d.error || 'Failed', 'error');
    }
  };

  const openSplitPay = (inv) => {
    loadJobs();
    setSplitPayInv(inv);
    setSplitAllocs([{ ...EMPTY_INV_ALLOC }, { ...EMPTY_INV_ALLOC }]);
  };

  const updateInvAlloc = (i, field, val) =>
    setSplitAllocs((prev) => prev.map((a, idx) => (idx === i ? { ...a, [field]: val } : a)));

  const submitSplitPay = async () => {
    if (!splitPayInv) return;
    for (const a of splitAllocs) {
      if (!a.job_id) return showToast('Select a job for each allocation', 'error');
      if (!a.amount || Number(a.amount) <= 0)
        return showToast('Enter a positive amount for each allocation', 'error');
    }
    const total = Number(splitPayInv.amount) || 0;
    const allocSum = splitAllocs.reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);
    if (Math.abs(allocSum - total) > 0.02) {
      return showToast(
        `Allocation total ($${allocSum.toFixed(2)}) must equal invoice total ($${total.toFixed(2)})`,
        'error',
      );
    }
    setSavingSplit(true);
    const res = await fetch(`/api/direct-invoices/${splitPayInv.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        status: 'paid',
        allocations: splitAllocs.map((a) => ({
          job_id: a.job_id,
          payment_class: a.payment_class,
          amount: parseFloat(a.amount),
          notes: a.notes,
        })),
      }),
    });
    if (res.ok) {
      setSplitPayInv(null);
      load();
      showToast(`Split payment recorded across ${splitAllocs.length} jobs`);
    } else {
      const d = await res.json();
      showToast(d.error || 'Failed to record split payment', 'error');
    }
    setSavingSplit(false);
  };

  const deleteInv = async (inv) => {
    if (!(await showConfirm(`Delete invoice ${inv.invoice_number}?`))) return;
    const url = inv.source === 'job' ? `/api/invoices/${inv.id}` : `/api/direct-invoices/${inv.id}`;
    const res = await fetch(url, { method: 'DELETE', headers });
    if (res.ok) {
      load();
      showToast('Invoice deleted');
    }
  };

  const openEdit = (inv) => {
    setSplitPayInv(null);
    setEditInv(inv);
    setEditForm({ amount: String(inv.amount || ''), notes: inv.notes || '' });
  };

  const cancelEdit = () => {
    setEditInv(null);
    setEditForm({ amount: '', notes: '' });
  };

  const saveEdit = async () => {
    if (!editInv) return;
    const isJob = editInv.source === 'job';
    const url = isJob ? `/api/invoices/${editInv.id}` : `/api/direct-invoices/${editInv.id}`;
    const body = isJob
      ? { amount: parseFloat(editForm.amount) || editInv.amount, notes: editForm.notes }
      : { notes: editForm.notes };
    setSavingEdit(true);
    const res = await fetch(url, { method: 'PATCH', headers, body: JSON.stringify(body) });
    if (res.ok) {
      cancelEdit();
      load();
      showToast('Invoice updated');
    } else {
      const d = await res.json().catch(() => ({}));
      showToast(d.error || 'Failed to save', 'error');
    }
    setSavingEdit(false);
  };

  const filtered = invoices.filter((inv) => {
    if (filterStatus && inv.status !== filterStatus) return false;
    if (search) {
      const q = search.toLowerCase();
      if (
        !(inv.invoice_number || '').toLowerCase().includes(q) &&
        !(inv.customer_name || '').toLowerCase().includes(q) &&
        !(inv.customer_email || '').toLowerCase().includes(q) &&
        !(inv.project_address || '').toLowerCase().includes(q)
      )
        return false;
    }
    return true;
  });

  const totalPaid = invoices
    .filter((i) => i.status === 'paid')
    .reduce((s, i) => s + Number(i.amount || 0), 0);
  const totalPending = invoices
    .filter((i) => i.status === 'sent' || i.status === 'pending_send')
    .reduce((s, i) => s + Number(i.amount || 0), 0);

  return (
    <div style={{ padding: '28px 24px', maxWidth: 960, margin: '0 auto' }}>
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
        <h2 style={{ color: BLUE, margin: 0, fontSize: 22 }}>Accounts Receivable — All Invoices</h2>
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
          + New Direct Invoice
        </button>
      </div>

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
          { label: 'AR Outstanding', value: fmt(totalPending), color: '#3B82F6' },
          { label: 'AR Collected', value: fmt(totalPaid), color: GREEN },
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

      <div style={{ display: 'flex', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
        <input
          placeholder="Search name, email, address, invoice #"
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
          <option value="pending_send">Pending Send</option>
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
            No invoices found
          </div>
          <div style={{ fontSize: 13 }}>
            Job invoices appear automatically when contracts are signed. Use "New Direct Invoice"
            for standalone billing.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map((inv) => {
            const sc = STATUS_COLOR[inv.status] || '#888';
            const typeLabel = TYPE_LABELS[inv.invoice_type] || inv.invoice_type || '—';
            const isJob = inv.source === 'job';
            const isDirect = inv.source === 'direct';
            const isPendingSend = inv.status === 'pending_send';
            const isUnpaid = inv.status !== 'paid' && inv.status !== 'void';
            const hasEmail = isJob ? !!inv.customer_email : !!inv.customer_email;
            const pdfUrl = isJob
              ? `/api/invoices/${inv.id}/pdf?token=${encodeURIComponent(token || '')}`
              : `/api/direct-invoices/${inv.id}/pdf?token=${encodeURIComponent(token || '')}`;

            return (
              <div key={`${inv.source}-${inv.id}`}>
                <div
                  style={{
                    background: isPendingSend ? '#fffbeb' : 'white',
                    border: `1px solid ${isPendingSend ? '#fcd34d' : '#e5e7eb'}`,
                    borderRadius: 9,
                    padding: '12px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 10,
                    borderBottomLeftRadius: splitPayInv?.id === inv.id ? 0 : 9,
                    borderBottomRightRadius: splitPayInv?.id === inv.id ? 0 : 9,
                  }}
                >
                  <div style={{ minWidth: 160 }}>
                    <div
                      style={{
                        fontFamily: 'monospace',
                        fontSize: 12,
                        fontWeight: 700,
                        color: '#4F46E5',
                      }}
                    >
                      {inv.invoice_number}
                    </div>
                    <span
                      style={{
                        fontSize: 9,
                        padding: '1px 6px',
                        borderRadius: 8,
                        background: isJob ? '#e0e8ff' : '#f3f4f6',
                        color: isJob ? '#1B3A6B' : '#555',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                      }}
                    >
                      {typeLabel}
                    </span>
                  </div>

                  <div style={{ flex: 1, minWidth: 120 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#333' }}>
                      {inv.customer_name || inv.customer_email || '—'}
                    </div>
                    {inv.project_address && inv.job_id && (
                      <a
                        href={`/jobs/${inv.job_id}`}
                        style={{ fontSize: 11, color: '#4F46E5', textDecoration: 'none' }}
                      >
                        {inv.project_address}
                        {inv.pb_number ? ` — #${inv.pb_number}` : ''}
                      </a>
                    )}
                    {!inv.project_address && inv.customer_email && inv.customer_name && (
                      <div style={{ fontSize: 11, color: '#888' }}>{inv.customer_email}</div>
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
                    {fmt(inv.amount)}
                  </div>

                  <span
                    style={{
                      fontSize: 10,
                      padding: '2px 9px',
                      borderRadius: 10,
                      background: sc + '22',
                      color: sc,
                      fontWeight: 700,
                      minWidth: 72,
                      textAlign: 'center',
                    }}
                  >
                    {(inv.status || 'draft').replace('_', ' ').toUpperCase()}
                  </span>

                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    <a
                      href={pdfUrl}
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

                    {isUnpaid && (
                      <>
                        {isJob && (isPendingSend || inv.status === 'draft') && (
                          <button
                            onClick={() => sendJobInvoice(inv)}
                            disabled={sending === inv.id}
                            style={{
                              fontSize: 11,
                              padding: '4px 10px',
                              background: isPendingSend ? '#ORANGE11' || '#fff3cd' : '#3B82F611',
                              color: isPendingSend ? '#92400e' : '#3B82F6',
                              border: `1px solid ${isPendingSend ? '#fcd34d' : '#3B82F622'}`,
                              borderRadius: 5,
                              cursor: 'pointer',
                            }}
                          >
                            {sending === inv.id
                              ? 'Sending…'
                              : isPendingSend
                                ? 'Retry Send'
                                : 'Send'}
                          </button>
                        )}

                        {isJob && inv.status === 'sent' && (
                          <button
                            onClick={() => sendJobInvoice(inv)}
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
                            {sending === inv.id ? 'Sending…' : 'Resend'}
                          </button>
                        )}

                        {isDirect && hasEmail && (
                          <button
                            onClick={() => sendDirectInvoice(inv)}
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
                            {sending === inv.id
                              ? 'Sending…'
                              : inv.status === 'sent'
                                ? 'Resend'
                                : 'Send'}
                          </button>
                        )}

                        {markPaidInv?.id === inv.id ? (
                          <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                            <input
                              autoFocus
                              placeholder="Check #"
                              value={markPaidCheck}
                              onChange={(e) => setMarkPaidCheck(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') markPaid(inv, markPaidCheck);
                                if (e.key === 'Escape') {
                                  setMarkPaidInv(null);
                                  setMarkPaidCheck('');
                                }
                              }}
                              style={{
                                width: 80,
                                fontSize: 11,
                                padding: '3px 6px',
                                border: '1px solid #86efac',
                                borderRadius: 4,
                              }}
                            />
                            <button
                              onClick={() => markPaid(inv, markPaidCheck)}
                              style={{
                                fontSize: 11,
                                padding: '4px 10px',
                                background: GREEN,
                                color: 'white',
                                border: 'none',
                                borderRadius: 5,
                                cursor: 'pointer',
                              }}
                            >
                              ✓
                            </button>
                            <button
                              onClick={() => {
                                setMarkPaidInv(null);
                                setMarkPaidCheck('');
                              }}
                              style={{
                                fontSize: 11,
                                padding: '4px 8px',
                                background: '#eee',
                                color: '#555',
                                border: 'none',
                                borderRadius: 5,
                                cursor: 'pointer',
                              }}
                            >
                              ✕
                            </button>
                          </span>
                        ) : (
                          <button
                            onClick={() => {
                              setMarkPaidInv(inv);
                              setMarkPaidCheck('');
                            }}
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

                        {isDirect && (
                          <button
                            onClick={() =>
                              splitPayInv?.id === inv.id ? setSplitPayInv(null) : openSplitPay(inv)
                            }
                            style={{
                              fontSize: 11,
                              padding: '4px 10px',
                              background: splitPayInv?.id === inv.id ? '#3B82F6' : '#3B82F611',
                              color: splitPayInv?.id === inv.id ? 'white' : '#3B82F6',
                              border: '1px solid #3B82F622',
                              borderRadius: 5,
                              cursor: 'pointer',
                            }}
                          >
                            Split Paid
                          </button>
                        )}
                      </>
                    )}

                    <button
                      onClick={() =>
                        editInv?.id === inv.id && editInv?.source === inv.source
                          ? cancelEdit()
                          : openEdit(inv)
                      }
                      style={{
                        fontSize: 11,
                        padding: '4px 10px',
                        background:
                          editInv?.id === inv.id && editInv?.source === inv.source
                            ? '#E07B2A'
                            : '#E07B2A11',
                        color:
                          editInv?.id === inv.id && editInv?.source === inv.source
                            ? 'white'
                            : ORANGE,
                        border: `1px solid ${editInv?.id === inv.id && editInv?.source === inv.source ? ORANGE : '#E07B2A22'}`,
                        borderRadius: 5,
                        cursor: 'pointer',
                      }}
                    >
                      {editInv?.id === inv.id && editInv?.source === inv.source ? 'Close' : 'Edit'}
                    </button>

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

                {splitPayInv?.id === inv.id && isDirect && (
                  <div
                    style={{
                      background: '#f0f9ff',
                      border: '1.5px solid #3B82F6',
                      borderTop: 'none',
                      borderRadius: '0 0 8px 8px',
                      padding: 14,
                    }}
                  >
                    <div
                      style={{
                        fontWeight: 'bold',
                        color: '#1D4ED8',
                        fontSize: 13,
                        marginBottom: 10,
                      }}
                    >
                      Split Payment — Allocate {fmt(inv.amount)}
                    </div>
                    {(() => {
                      const allocTotal = splitAllocs.reduce(
                        (s, a) => s + (parseFloat(a.amount) || 0),
                        0,
                      );
                      const total = Number(inv.amount) || 0;
                      const remaining = Math.round((total - allocTotal) * 100) / 100;
                      const balanced = Math.abs(remaining) < 0.02;
                      return (
                        <>
                          <div style={{ overflowX: 'auto', marginBottom: 8 }}>
                            <table
                              style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}
                            >
                              <thead>
                                <tr style={{ background: '#1B3A6B', color: 'white' }}>
                                  {['Job', 'Class', 'Amount', 'Notes', ''].map((h) => (
                                    <th
                                      key={h}
                                      style={{
                                        padding: '6px 8px',
                                        textAlign: 'left',
                                        fontWeight: 600,
                                        fontSize: 11,
                                      }}
                                    >
                                      {h}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {splitAllocs.map((a, i) => (
                                  <tr key={i} style={{ borderBottom: '1px solid #e2e8f0' }}>
                                    <td style={{ padding: '4px 6px', minWidth: 160 }}>
                                      <select
                                        value={a.job_id}
                                        onChange={(e) =>
                                          updateInvAlloc(i, 'job_id', e.target.value)
                                        }
                                        style={{
                                          width: '100%',
                                          padding: '5px 6px',
                                          border: '1px solid #ddd',
                                          borderRadius: 4,
                                          fontSize: 11,
                                        }}
                                      >
                                        <option value="">— Select job —</option>
                                        {jobs.map((j) => (
                                          <option key={j.id} value={j.id}>
                                            {j.project_address ||
                                              j.customer_name ||
                                              j.id.slice(0, 8)}
                                          </option>
                                        ))}
                                      </select>
                                    </td>
                                    <td style={{ padding: '4px 6px', minWidth: 140 }}>
                                      <select
                                        value={a.payment_class}
                                        onChange={(e) =>
                                          updateInvAlloc(i, 'payment_class', e.target.value)
                                        }
                                        style={{
                                          width: '100%',
                                          padding: '5px 6px',
                                          border: '1px solid #ddd',
                                          borderRadius: 4,
                                          fontSize: 11,
                                        }}
                                      >
                                        <option value="contract">Contract</option>
                                        <option value="pass_through_reimbursement">
                                          Pass-Through
                                        </option>
                                      </select>
                                    </td>
                                    <td style={{ padding: '4px 6px', minWidth: 90 }}>
                                      <input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        value={a.amount}
                                        onChange={(e) =>
                                          updateInvAlloc(i, 'amount', e.target.value)
                                        }
                                        placeholder="0.00"
                                        style={{
                                          width: '100%',
                                          padding: '5px 6px',
                                          border: '1px solid #ddd',
                                          borderRadius: 4,
                                          fontSize: 11,
                                          textAlign: 'right',
                                        }}
                                      />
                                    </td>
                                    <td style={{ padding: '4px 6px', minWidth: 120 }}>
                                      <input
                                        value={a.notes}
                                        onChange={(e) => updateInvAlloc(i, 'notes', e.target.value)}
                                        placeholder="Optional"
                                        style={{
                                          width: '100%',
                                          padding: '5px 6px',
                                          border: '1px solid #ddd',
                                          borderRadius: 4,
                                          fontSize: 11,
                                        }}
                                      />
                                    </td>
                                    <td style={{ padding: '4px 4px' }}>
                                      <button
                                        onClick={() =>
                                          setSplitAllocs((prev) =>
                                            prev.length > 2
                                              ? prev.filter((_, idx) => idx !== i)
                                              : prev,
                                          )
                                        }
                                        disabled={splitAllocs.length <= 2}
                                        style={{
                                          background: 'none',
                                          border: 'none',
                                          cursor:
                                            splitAllocs.length <= 2 ? 'not-allowed' : 'pointer',
                                          color: splitAllocs.length <= 2 ? '#ccc' : '#C62828',
                                          fontSize: 15,
                                          padding: '2px 4px',
                                        }}
                                      >
                                        ✕
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 10,
                              flexWrap: 'wrap',
                            }}
                          >
                            <button
                              onClick={() =>
                                setSplitAllocs((prev) => [...prev, { ...EMPTY_INV_ALLOC }])
                              }
                              style={{
                                background: 'none',
                                border: '1px dashed #3B82F6',
                                color: '#1D4ED8',
                                borderRadius: 6,
                                padding: '4px 12px',
                                cursor: 'pointer',
                                fontSize: 11,
                                fontWeight: 600,
                              }}
                            >
                              + Add Row
                            </button>
                            <div
                              style={{
                                flex: 1,
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                padding: '6px 10px',
                                borderRadius: 6,
                                background: balanced ? '#f0fdf4' : '#fff5f5',
                                border: `1px solid ${balanced ? '#86efac' : '#fca5a5'}`,
                                fontSize: 12,
                                minWidth: 160,
                              }}
                            >
                              <span style={{ color: '#555' }}>
                                Allocated: <strong>{fmt(allocTotal)}</strong> of{' '}
                                <strong>{fmt(total)}</strong>
                              </span>
                              <span
                                style={{
                                  fontWeight: 'bold',
                                  color: balanced ? '#166534' : '#991b1b',
                                }}
                              >
                                {balanced
                                  ? '✓ Balanced'
                                  : remaining > 0
                                    ? `$${remaining.toFixed(2)} left`
                                    : `$${Math.abs(remaining).toFixed(2)} over`}
                              </span>
                            </div>
                            <button
                              onClick={submitSplitPay}
                              disabled={savingSplit || !balanced}
                              style={{
                                padding: '7px 16px',
                                background: balanced ? GREEN : '#ccc',
                                color: 'white',
                                border: 'none',
                                borderRadius: 6,
                                cursor: balanced ? 'pointer' : 'not-allowed',
                                fontWeight: 'bold',
                                fontSize: 12,
                              }}
                            >
                              {savingSplit ? 'Saving…' : 'Save Split & Mark Paid'}
                            </button>
                            <button
                              onClick={() => setSplitPayInv(null)}
                              style={{
                                padding: '7px 12px',
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
                        </>
                      );
                    })()}
                  </div>
                )}

                {editInv?.id === inv.id && editInv?.source === inv.source && (
                  <div
                    style={{
                      background: '#fff8f0',
                      border: `1.5px solid ${ORANGE}`,
                      borderTop: 'none',
                      borderRadius: '0 0 8px 8px',
                      padding: '14px 16px',
                    }}
                  >
                    <div
                      style={{
                        fontWeight: 'bold',
                        color: ORANGE,
                        fontSize: 13,
                        marginBottom: 10,
                      }}
                    >
                      Edit Invoice — {inv.invoice_number}
                    </div>

                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
                      {inv.source === 'job' && (
                        <div style={{ flex: '0 0 150px' }}>
                          <label
                            style={{
                              display: 'block',
                              fontSize: 11,
                              fontWeight: 600,
                              color: '#555',
                              marginBottom: 4,
                            }}
                          >
                            Amount ($)
                          </label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={editForm.amount}
                            onChange={(e) => setEditForm((f) => ({ ...f, amount: e.target.value }))}
                            style={{
                              width: '100%',
                              padding: '6px 8px',
                              border: '1px solid #ddd',
                              borderRadius: 5,
                              fontSize: 13,
                            }}
                          />
                        </div>
                      )}

                      <div style={{ flex: 1, minWidth: 200 }}>
                        <label
                          style={{
                            display: 'block',
                            fontSize: 11,
                            fontWeight: 600,
                            color: '#555',
                            marginBottom: 4,
                          }}
                        >
                          Notes
                        </label>
                        <input
                          type="text"
                          value={editForm.notes}
                          onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
                          placeholder="Add a note…"
                          style={{
                            width: '100%',
                            padding: '6px 8px',
                            border: '1px solid #ddd',
                            borderRadius: 5,
                            fontSize: 13,
                          }}
                        />
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        onClick={saveEdit}
                        disabled={savingEdit}
                        style={{
                          padding: '7px 18px',
                          background: ORANGE,
                          color: 'white',
                          border: 'none',
                          borderRadius: 6,
                          cursor: savingEdit ? 'not-allowed' : 'pointer',
                          fontWeight: 'bold',
                          fontSize: 12,
                        }}
                      >
                        {savingEdit ? 'Saving…' : 'Save Changes'}
                      </button>
                      <button
                        onClick={cancelEdit}
                        style={{
                          padding: '7px 12px',
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
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
