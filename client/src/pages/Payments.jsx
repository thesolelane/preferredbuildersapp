import { useState, useEffect, useCallback } from 'react';
import { showToast } from '../utils/toast';
import { showConfirm } from '../utils/confirm';

const BLUE = '#1B3A6B';
const ORANGE = '#E07B2A';
const GREEN = '#2E7D32';
const RED = '#C62828';

const PAYMENT_TYPES = ['deposit', 'progress', 'final', 'other'];
const CATEGORIES = ['subcontractor', 'material', 'permit', 'other'];

const fmt = (n) =>
  `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d) =>
  d
    ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : '—';

function today() {
  return new Date().toISOString().slice(0, 10);
}

function nowTime() {
  return new Date()
    .toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
    .slice(0, 5);
}

const EMPTY_IN = {
  job_id: '',
  customer_name: '',
  check_number: '',
  amount: '',
  date_received: today(),
  time_received: nowTime(),
  payment_type: 'deposit',
  credit_debit: 'credit',
  notes: '',
};
const EMPTY_OUT = {
  job_id: '',
  payee_name: '',
  check_number: '',
  amount: '',
  date_paid: today(),
  time_paid: nowTime(),
  category: 'subcontractor',
  credit_debit: 'debit',
  notes: '',
};

const EMPTY_ALLOC_G = { job_id: '', payment_class: 'contract', amount: '', notes: '' };

export default function Payments({ token }) {
  const [tab, setTab] = useState('received');
  const [received, setReceived] = useState([]);
  const [made, setMade] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [filterJob, setFilterJob] = useState('');
  const [filterCustomer, setFilterCustomer] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [showFormIn, setShowFormIn] = useState(false);
  const [showFormOut, setShowFormOut] = useState(false);
  const [formIn, setFormIn] = useState(EMPTY_IN);
  const [formOut, setFormOut] = useState(EMPTY_OUT);
  const [saving, setSaving] = useState(false);
  const [splitIn, setSplitIn] = useState(false);
  const [splitAllocations, setSplitAllocations] = useState([
    { ...EMPTY_ALLOC_G },
    { ...EMPTY_ALLOC_G },
  ]);

  const headers = { 'x-auth-token': token, 'Content-Type': 'application/json' };

  const loadJobs = useCallback(() => {
    fetch('/api/jobs', { headers: { 'x-auth-token': token } })
      .then((r) => r.json())
      .then((data) => setJobs((data.jobs || []).filter((j) => !j.archived)));
  }, [token]);

  const loadPayments = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterJob) params.set('job_id', filterJob);
    if (filterCustomer) params.set('customer', filterCustomer);
    if (filterFrom) params.set('date_from', filterFrom);
    if (filterTo) params.set('date_to', filterTo);
    Promise.all([
      fetch(`/api/payments/received?${params}`, { headers: { 'x-auth-token': token } }).then((r) =>
        r.json(),
      ),
      fetch(`/api/payments/made?${params}`, { headers: { 'x-auth-token': token } }).then((r) =>
        r.json(),
      ),
    ]).then(([recData, madeData]) => {
      setReceived(recData.payments || []);
      setMade(madeData.payments || []);
      setLoading(false);
    });
  }, [token, filterJob, filterCustomer, filterFrom, filterTo]);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);
  useEffect(() => {
    loadPayments();
  }, [loadPayments]);

  const totalReceived = received.reduce((s, p) => {
    const amt = Number(p.amount) || 0;
    return s + (p.credit_debit === 'debit' ? -amt : amt);
  }, 0);
  const totalMade = made.reduce((s, p) => {
    const amt = Number(p.amount) || 0;
    return s + (p.credit_debit === 'credit' ? -amt : amt);
  }, 0);
  const balance = totalReceived - totalMade;

  const updateGAlloc = (i, field, val) =>
    setSplitAllocations((prev) => prev.map((a, idx) => (idx === i ? { ...a, [field]: val } : a)));
  const addGAlloc = () => setSplitAllocations((prev) => [...prev, { ...EMPTY_ALLOC_G }]);
  const removeGAlloc = (i) =>
    setSplitAllocations((prev) => (prev.length > 2 ? prev.filter((_, idx) => idx !== i) : prev));

  const submitIn = async () => {
    if (!formIn.job_id) return showToast('Select a job', 'error');
    if (!formIn.amount) return showToast('Enter an amount', 'error');
    if (!formIn.date_received) return showToast('Enter a date', 'error');
    setSaving(true);
    const res = await fetch('/api/payments/received', {
      method: 'POST',
      headers,
      body: JSON.stringify(formIn),
    });
    const data = await res.json();
    if (res.ok) {
      setFormIn({ ...EMPTY_IN, date_received: today(), time_received: nowTime() });
      setShowFormIn(false);
      loadPayments();
      showToast('Payment recorded');
    } else {
      showToast(data.error || 'Failed to save', 'error');
    }
    setSaving(false);
  };

  const submitSplitIn = async () => {
    if (!formIn.amount) return showToast('Enter total amount', 'error');
    if (!formIn.date_received) return showToast('Enter a date', 'error');
    for (const a of splitAllocations) {
      if (!a.job_id) return showToast('Select a job for each allocation', 'error');
      if (!a.amount || Number(a.amount) <= 0)
        return showToast('Enter a positive amount for each allocation', 'error');
    }
    const total = parseFloat(formIn.amount) || 0;
    const allocSum = splitAllocations.reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);
    if (Math.abs(allocSum - total) > 0.02) {
      return showToast(
        `Allocation total ($${allocSum.toFixed(2)}) must equal payment total ($${total.toFixed(2)})`,
        'error',
      );
    }
    setSaving(true);
    const body = {
      total_amount: total,
      date_received: formIn.date_received,
      time_received: formIn.time_received,
      check_number: formIn.check_number,
      customer_name: formIn.customer_name,
      payment_type: formIn.payment_type,
      credit_debit: formIn.credit_debit,
      allocations: splitAllocations.map((a) => ({
        job_id: a.job_id,
        payment_class: a.payment_class,
        amount: parseFloat(a.amount),
        notes: a.notes,
      })),
    };
    const res = await fetch('/api/payments/received/split', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (res.ok) {
      setFormIn({ ...EMPTY_IN, date_received: today(), time_received: nowTime() });
      setSplitAllocations([{ ...EMPTY_ALLOC_G }, { ...EMPTY_ALLOC_G }]);
      setSplitIn(false);
      setShowFormIn(false);
      loadPayments();
      showToast(`Split payment recorded across ${data.payments.length} jobs`);
    } else {
      showToast(data.error || 'Failed to save split payment', 'error');
    }
    setSaving(false);
  };

  const submitOut = async () => {
    if (!formOut.job_id) return showToast('Select a job', 'error');
    if (!formOut.payee_name) return showToast('Enter a payee name', 'error');
    if (!formOut.amount) return showToast('Enter an amount', 'error');
    if (!formOut.date_paid) return showToast('Enter a date', 'error');
    setSaving(true);
    const res = await fetch('/api/payments/made', {
      method: 'POST',
      headers,
      body: JSON.stringify(formOut),
    });
    const data = await res.json();
    if (res.ok) {
      setFormOut({ ...EMPTY_OUT, date_paid: today(), time_paid: nowTime() });
      setShowFormOut(false);
      loadPayments();
      showToast('Payment recorded');
    } else {
      showToast(data.error || 'Failed to save', 'error');
    }
    setSaving(false);
  };

  const deleteReceived = async (p) => {
    if (
      !(await showConfirm(
        `Delete this payment record (${fmt(p.amount)} from ${p.customer_name || 'customer'})?`,
      ))
    )
      return;
    const res = await fetch(`/api/payments/received/${p.id}`, { method: 'DELETE', headers });
    if (res.ok) {
      loadPayments();
      showToast('Payment deleted');
    } else {
      const data = await res.json().catch(() => ({}));
      showToast(data.error || 'Failed to delete', 'error');
    }
  };

  const deleteMade = async (p) => {
    if (!(await showConfirm(`Delete this payment record (${fmt(p.amount)} to ${p.payee_name})?`)))
      return;
    const res = await fetch(`/api/payments/made/${p.id}`, { method: 'DELETE', headers });
    if (res.ok) {
      loadPayments();
      showToast('Payment deleted');
    } else {
      const data = await res.json().catch(() => ({}));
      showToast(data.error || 'Failed to delete', 'error');
    }
  };

  const jobLabel = (p) => p.project_address || p.job_customer || p.job_id?.slice(0, 8) || '—';

  return (
    <div style={{ padding: 32, maxWidth: 1100 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 24,
        }}
      >
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 'bold', color: BLUE, margin: 0 }}>
            Payment Ledger
          </h1>
          <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
            Track checks received and paid out per job
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => {
              setShowFormIn(true);
              setShowFormOut(false);
            }}
            style={{
              padding: '9px 16px',
              background: GREEN,
              color: 'white',
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer',
              fontWeight: 'bold',
              fontSize: 13,
            }}
          >
            + Check In
          </button>
          <button
            onClick={() => {
              setShowFormOut(true);
              setShowFormIn(false);
            }}
            style={{
              padding: '9px 16px',
              background: RED,
              color: 'white',
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer',
              fontWeight: 'bold',
              fontSize: 13,
            }}
          >
            + Check Out
          </button>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 16,
          marginBottom: 24,
        }}
      >
        <SummaryCard label="Total Received" value={fmt(totalReceived)} color={GREEN} />
        <SummaryCard label="Total Paid Out" value={fmt(totalMade)} color={RED} />
        <SummaryCard label="Net Balance" value={fmt(balance)} color={balance >= 0 ? BLUE : RED} />
      </div>

      {showFormIn && (
        <PaymentForm
          title="Record Check Received (Credit)"
          color={GREEN}
          onCancel={() => {
            setShowFormIn(false);
            setSplitIn(false);
            setSplitAllocations([{ ...EMPTY_ALLOC_G }, { ...EMPTY_ALLOC_G }]);
          }}
          onSubmit={splitIn ? submitSplitIn : submitIn}
          saving={saving}
          submitLabel={splitIn ? 'Save Split Payment' : undefined}
        >
          <FormGrid>
            <FormField label="Job *">
              <JobSelect
                value={formIn.job_id}
                onChange={(v) => setFormIn((p) => ({ ...p, job_id: v }))}
                jobs={jobs}
              />
            </FormField>
            <FormField label="Customer Name">
              <input
                value={formIn.customer_name}
                onChange={(e) => setFormIn((p) => ({ ...p, customer_name: e.target.value }))}
                placeholder="Name on check"
                style={inputStyle}
              />
            </FormField>
            <FormField label="Check Number">
              <input
                value={formIn.check_number}
                onChange={(e) => setFormIn((p) => ({ ...p, check_number: e.target.value }))}
                placeholder="e.g. 1042"
                style={inputStyle}
              />
            </FormField>
            <FormField label="Amount *">
              <input
                type="number"
                step="0.01"
                min="0"
                value={formIn.amount}
                onChange={(e) => setFormIn((p) => ({ ...p, amount: e.target.value }))}
                placeholder="0.00"
                style={inputStyle}
              />
            </FormField>
            <FormField label="Date *">
              <input
                type="date"
                value={formIn.date_received}
                onChange={(e) => setFormIn((p) => ({ ...p, date_received: e.target.value }))}
                style={inputStyle}
              />
            </FormField>
            <FormField label="Time">
              <input
                type="time"
                value={formIn.time_received}
                onChange={(e) => setFormIn((p) => ({ ...p, time_received: e.target.value }))}
                style={inputStyle}
              />
            </FormField>
            <FormField label="Payment Type">
              <select
                value={formIn.payment_type}
                onChange={(e) => setFormIn((p) => ({ ...p, payment_type: e.target.value }))}
                style={inputStyle}
              >
                {PAYMENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Credit / Debit">
              <select
                value={formIn.credit_debit}
                onChange={(e) => setFormIn((p) => ({ ...p, credit_debit: e.target.value }))}
                style={inputStyle}
              >
                <option value="credit">Credit (money in)</option>
                <option value="debit">Debit (refund out)</option>
              </select>
            </FormField>
          </FormGrid>
          <FormField label="Notes">
            <textarea
              value={formIn.notes}
              onChange={(e) => setFormIn((p) => ({ ...p, notes: e.target.value }))}
              rows={2}
              placeholder="Optional notes"
              style={{ ...inputStyle, resize: 'vertical', width: '100%' }}
            />
          </FormField>

          {formIn.payment_type !== 'deposit' && (
            <div style={{ marginTop: 12, marginBottom: 4 }}>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={splitIn}
                  onChange={(e) => setSplitIn(e.target.checked)}
                />
                <span>
                  <strong>Split across multiple jobs</strong> — one check covers multiple contracts
                  or pass-throughs
                </span>
              </label>
              {!splitIn && (
                <div style={{ fontSize: 11, color: '#888', marginTop: 4, marginLeft: 22 }}>
                  Tip: if you received two separate checks from this customer, enter them
                  individually (each gets its own check number). Use Split only when one check
                  covers multiple jobs.
                </div>
              )}
            </div>
          )}

          {splitIn && (
            <div
              style={{
                background: '#f0f9ff',
                border: '1.5px solid #3B82F6',
                borderRadius: 8,
                padding: 14,
                marginTop: 12,
              }}
            >
              <div style={{ fontWeight: 'bold', color: '#1D4ED8', fontSize: 13, marginBottom: 10 }}>
                Allocate Split Payment
              </div>
              {(() => {
                const allocTotal = splitAllocations.reduce(
                  (s, a) => s + (parseFloat(a.amount) || 0),
                  0,
                );
                const enteredTotal = parseFloat(formIn.amount) || 0;
                const remaining = Math.round((enteredTotal - allocTotal) * 100) / 100;
                const balanced = Math.abs(remaining) < 0.02;
                return (
                  <>
                    <div style={{ overflowX: 'auto', marginBottom: 8 }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
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
                          {splitAllocations.map((a, i) => (
                            <tr key={i} style={{ borderBottom: '1px solid #e2e8f0' }}>
                              <td style={{ padding: '4px 6px', minWidth: 160 }}>
                                <select
                                  value={a.job_id}
                                  onChange={(e) => updateGAlloc(i, 'job_id', e.target.value)}
                                  style={{ ...inputStyle, fontSize: 11, padding: '5px 6px' }}
                                >
                                  <option value="">— Select job —</option>
                                  {jobs.map((j) => (
                                    <option key={j.id} value={j.id}>
                                      {j.project_address || j.customer_name || j.id.slice(0, 8)}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td style={{ padding: '4px 6px', minWidth: 140 }}>
                                <select
                                  value={a.payment_class}
                                  onChange={(e) => updateGAlloc(i, 'payment_class', e.target.value)}
                                  style={{ ...inputStyle, fontSize: 11, padding: '5px 6px' }}
                                >
                                  <option value="contract">Contract</option>
                                  <option value="pass_through_reimbursement">
                                    Pass-Through Reimbursement
                                  </option>
                                </select>
                              </td>
                              <td style={{ padding: '4px 6px', minWidth: 90 }}>
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={a.amount}
                                  onChange={(e) => updateGAlloc(i, 'amount', e.target.value)}
                                  placeholder="0.00"
                                  style={{
                                    ...inputStyle,
                                    fontSize: 11,
                                    padding: '5px 6px',
                                    textAlign: 'right',
                                  }}
                                />
                              </td>
                              <td style={{ padding: '4px 6px', minWidth: 120 }}>
                                <input
                                  value={a.notes}
                                  onChange={(e) => updateGAlloc(i, 'notes', e.target.value)}
                                  placeholder="Optional"
                                  style={{ ...inputStyle, fontSize: 11, padding: '5px 6px' }}
                                />
                              </td>
                              <td style={{ padding: '4px 4px' }}>
                                <button
                                  onClick={() => removeGAlloc(i)}
                                  disabled={splitAllocations.length <= 2}
                                  style={{
                                    background: 'none',
                                    border: 'none',
                                    cursor:
                                      splitAllocations.length <= 2 ? 'not-allowed' : 'pointer',
                                    color: splitAllocations.length <= 2 ? '#ccc' : '#C62828',
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
                    <button
                      onClick={addGAlloc}
                      style={{
                        background: 'none',
                        border: '1px dashed #3B82F6',
                        color: '#1D4ED8',
                        borderRadius: 6,
                        padding: '4px 12px',
                        cursor: 'pointer',
                        fontSize: 11,
                        fontWeight: 600,
                        marginBottom: 10,
                      }}
                    >
                      + Add Allocation
                    </button>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '8px 10px',
                        borderRadius: 6,
                        background: balanced ? '#f0fdf4' : '#fff5f5',
                        border: `1px solid ${balanced ? '#86efac' : '#fca5a5'}`,
                        fontSize: 12,
                      }}
                    >
                      <span style={{ color: '#555' }}>
                        Allocated: <strong>{fmt(allocTotal)}</strong> of{' '}
                        <strong>{fmt(enteredTotal)}</strong>
                      </span>
                      <span style={{ fontWeight: 'bold', color: balanced ? '#166534' : '#991b1b' }}>
                        {balanced
                          ? '✓ Balanced'
                          : remaining > 0
                            ? `$${remaining.toFixed(2)} unallocated`
                            : `$${Math.abs(remaining).toFixed(2)} over`}
                      </span>
                    </div>
                  </>
                );
              })()}
            </div>
          )}
        </PaymentForm>
      )}

      {showFormOut && (
        <PaymentForm
          title="Record Check Paid Out (Debit)"
          color={RED}
          onCancel={() => setShowFormOut(false)}
          onSubmit={submitOut}
          saving={saving}
        >
          <FormGrid>
            <FormField label="Job *">
              <JobSelect
                value={formOut.job_id}
                onChange={(v) => setFormOut((p) => ({ ...p, job_id: v }))}
                jobs={jobs}
              />
            </FormField>
            <FormField label="Payee Name *">
              <input
                value={formOut.payee_name}
                onChange={(e) => setFormOut((p) => ({ ...p, payee_name: e.target.value }))}
                placeholder="Subcontractor / vendor name"
                style={inputStyle}
              />
            </FormField>
            <FormField label="Check Number">
              <input
                value={formOut.check_number}
                onChange={(e) => setFormOut((p) => ({ ...p, check_number: e.target.value }))}
                placeholder="e.g. 2210"
                style={inputStyle}
              />
            </FormField>
            <FormField label="Amount *">
              <input
                type="number"
                step="0.01"
                min="0"
                value={formOut.amount}
                onChange={(e) => setFormOut((p) => ({ ...p, amount: e.target.value }))}
                placeholder="0.00"
                style={inputStyle}
              />
            </FormField>
            <FormField label="Date *">
              <input
                type="date"
                value={formOut.date_paid}
                onChange={(e) => setFormOut((p) => ({ ...p, date_paid: e.target.value }))}
                style={inputStyle}
              />
            </FormField>
            <FormField label="Time">
              <input
                type="time"
                value={formOut.time_paid}
                onChange={(e) => setFormOut((p) => ({ ...p, time_paid: e.target.value }))}
                style={inputStyle}
              />
            </FormField>
            <FormField label="Category">
              <select
                value={formOut.category}
                onChange={(e) => setFormOut((p) => ({ ...p, category: e.target.value }))}
                style={inputStyle}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c.charAt(0).toUpperCase() + c.slice(1)}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Credit / Debit">
              <select
                value={formOut.credit_debit}
                onChange={(e) => setFormOut((p) => ({ ...p, credit_debit: e.target.value }))}
                style={inputStyle}
              >
                <option value="debit">Debit (money out)</option>
                <option value="credit">Credit (refund in)</option>
              </select>
            </FormField>
          </FormGrid>
          <FormField label="Notes">
            <textarea
              value={formOut.notes}
              onChange={(e) => setFormOut((p) => ({ ...p, notes: e.target.value }))}
              rows={2}
              placeholder="Optional notes"
              style={{ ...inputStyle, resize: 'vertical', width: '100%' }}
            />
          </FormField>
        </PaymentForm>
      )}

      <div
        style={{
          display: 'flex',
          gap: 12,
          marginBottom: 16,
          flexWrap: 'wrap',
          alignItems: 'flex-end',
        }}
      >
        <div>
          <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4 }}>
            Filter by Job
          </label>
          <select
            value={filterJob}
            onChange={(e) => setFilterJob(e.target.value)}
            style={{ ...inputStyle, minWidth: 200 }}
          >
            <option value="">All Jobs</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.project_address || j.customer_name || j.id.slice(0, 8)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4 }}>
            Filter by Customer
          </label>
          <input
            value={filterCustomer}
            onChange={(e) => setFilterCustomer(e.target.value)}
            placeholder="Customer name..."
            style={{ ...inputStyle, minWidth: 160 }}
          />
        </div>
        <div>
          <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4 }}>
            From
          </label>
          <input
            type="date"
            value={filterFrom}
            onChange={(e) => setFilterFrom(e.target.value)}
            style={inputStyle}
          />
        </div>
        <div>
          <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4 }}>
            To
          </label>
          <input
            type="date"
            value={filterTo}
            onChange={(e) => setFilterTo(e.target.value)}
            style={inputStyle}
          />
        </div>
        {(filterJob || filterCustomer || filterFrom || filterTo) && (
          <button
            onClick={() => {
              setFilterJob('');
              setFilterCustomer('');
              setFilterFrom('');
              setFilterTo('');
            }}
            style={{
              padding: '8px 14px',
              background: 'none',
              border: '1px solid #ddd',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 12,
              color: '#888',
              alignSelf: 'flex-end',
            }}
          >
            Clear
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 4, borderBottom: '2px solid #eee', marginBottom: 16 }}>
        {[
          ['received', 'Checks Received'],
          ['made', 'Checks Paid Out'],
        ].map(([v, l]) => (
          <button
            key={v}
            onClick={() => setTab(v)}
            style={{
              padding: '8px 16px',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: tab === v ? 'bold' : 'normal',
              color: tab === v ? BLUE : '#888',
              borderBottom: tab === v ? `2px solid ${BLUE}` : '2px solid transparent',
              marginBottom: -2,
            }}
          >
            {l}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ color: '#888', textAlign: 'center', padding: 40 }}>Loading...</div>
      ) : tab === 'received' ? (
        <PaymentTable
          payments={received}
          columns={[
            {
              key: 'date',
              label: 'Date & Time',
              render: (p) => (
                <span>
                  {fmtDate(p.date_received)}
                  {p.time_received ? (
                    <span style={{ color: '#888', marginLeft: 6, fontSize: 11 }}>
                      {p.time_received}
                    </span>
                  ) : (
                    ''
                  )}
                </span>
              ),
            },
            {
              key: 'job',
              label: 'Job',
              render: (p) => <span style={{ fontSize: 12 }}>{jobLabel(p)}</span>,
            },
            { key: 'customer_name', label: 'From', render: (p) => p.customer_name || '—' },
            { key: 'check_number', label: 'Check #', render: (p) => p.check_number || '—' },
            {
              key: 'payment_type',
              label: 'Type',
              render: (p) => <TypeBadge type={p.payment_type} />,
            },
            {
              key: 'credit_debit',
              label: 'Cr / Dr',
              render: (p) => <CrDrBadge value={p.credit_debit} />,
            },
            {
              key: 'amount',
              label: 'Amount',
              render: (p) => (
                <span
                  style={{ fontWeight: 'bold', color: p.credit_debit === 'debit' ? RED : GREEN }}
                >
                  {fmt(p.amount)}
                </span>
              ),
            },
            {
              key: 'recorded_by',
              label: 'Recorded By',
              render: (p) => (
                <span style={{ fontSize: 11, color: '#888' }}>{p.recorded_by || '—'}</span>
              ),
            },
            {
              key: 'notes',
              label: 'Notes',
              render: (p) => <span style={{ fontSize: 11, color: '#888' }}>{p.notes || ''}</span>,
            },
          ]}
          onDelete={deleteReceived}
          emptyMsg="No checks received yet."
        />
      ) : (
        <PaymentTable
          payments={made}
          columns={[
            {
              key: 'date',
              label: 'Date & Time',
              render: (p) => (
                <span>
                  {fmtDate(p.date_paid)}
                  {p.time_paid ? (
                    <span style={{ color: '#888', marginLeft: 6, fontSize: 11 }}>
                      {p.time_paid}
                    </span>
                  ) : (
                    ''
                  )}
                </span>
              ),
            },
            {
              key: 'job',
              label: 'Job',
              render: (p) => <span style={{ fontSize: 12 }}>{jobLabel(p)}</span>,
            },
            { key: 'payee_name', label: 'To', render: (p) => p.payee_name },
            { key: 'check_number', label: 'Check #', render: (p) => p.check_number || '—' },
            {
              key: 'category',
              label: 'Category',
              render: (p) => <CategoryBadge cat={p.category} />,
            },
            {
              key: 'credit_debit',
              label: 'Cr / Dr',
              render: (p) => <CrDrBadge value={p.credit_debit} />,
            },
            {
              key: 'amount',
              label: 'Amount',
              render: (p) => (
                <span
                  style={{ fontWeight: 'bold', color: p.credit_debit === 'credit' ? GREEN : RED }}
                >
                  {fmt(p.amount)}
                </span>
              ),
            },
            {
              key: 'recorded_by',
              label: 'Recorded By',
              render: (p) => (
                <span style={{ fontSize: 11, color: '#888' }}>{p.recorded_by || '—'}</span>
              ),
            },
            {
              key: 'notes',
              label: 'Notes',
              render: (p) => <span style={{ fontSize: 11, color: '#888' }}>{p.notes || ''}</span>,
            },
          ]}
          onDelete={deleteMade}
          emptyMsg="No checks paid out yet."
        />
      )}
    </div>
  );
}

function SummaryCard({ label, value, color }) {
  return (
    <div
      style={{
        background: 'white',
        borderRadius: 10,
        padding: '16px 20px',
        boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
        borderTop: `3px solid ${color}`,
      }}
    >
      <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 'bold', color }}>{value}</div>
    </div>
  );
}

function PaymentForm({ title, color, onCancel, onSubmit, saving, children, submitLabel }) {
  return (
    <div
      style={{
        background: 'white',
        borderRadius: 10,
        padding: 20,
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        marginBottom: 20,
        borderTop: `3px solid ${color}`,
      }}
    >
      <h3 style={{ color, margin: '0 0 16px', fontSize: 14 }}>{title}</h3>
      {children}
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button
          onClick={onSubmit}
          disabled={saving}
          style={{
            padding: '9px 20px',
            background: color,
            color: 'white',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
            fontWeight: 'bold',
            fontSize: 13,
          }}
        >
          {saving ? 'Saving...' : submitLabel || 'Save Payment'}
        </button>
        <button
          onClick={onCancel}
          style={{
            padding: '9px 16px',
            background: 'none',
            border: '1px solid #ddd',
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 13,
            color: '#888',
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function FormGrid({ children }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
        gap: 12,
        marginBottom: 12,
      }}
    >
      {children}
    </div>
  );
}

function FormField({ label, children }) {
  return (
    <div>
      <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function JobSelect({ value, onChange, jobs }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={inputStyle}>
      <option value="">Select a job...</option>
      {jobs.map((j) => (
        <option key={j.id} value={j.id}>
          {j.project_address || j.customer_name || j.id.slice(0, 8)}
        </option>
      ))}
    </select>
  );
}

function PaymentTable({ payments, columns, onDelete, emptyMsg }) {
  if (payments.length === 0) {
    return (
      <div
        style={{
          background: 'white',
          borderRadius: 10,
          padding: 48,
          textAlign: 'center',
          boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
        }}
      >
        <div style={{ fontSize: 36, marginBottom: 12 }}>💳</div>
        <div style={{ color: '#888', fontSize: 14 }}>{emptyMsg}</div>
      </div>
    );
  }
  return (
    <div
      style={{
        background: 'white',
        borderRadius: 10,
        boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
        overflow: 'auto',
      }}
    >
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: '#f4f6fb' }}>
            {columns.map((c) => (
              <th
                key={c.key}
                style={{
                  padding: '10px 12px',
                  textAlign: 'left',
                  fontSize: 11,
                  color: '#888',
                  fontWeight: 'bold',
                  textTransform: 'uppercase',
                  letterSpacing: '.4px',
                  whiteSpace: 'nowrap',
                }}
              >
                {c.label}
              </th>
            ))}
            <th style={{ width: 60 }} />
          </tr>
        </thead>
        <tbody>
          {payments.map((p) => (
            <tr key={p.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
              {columns.map((c) => (
                <td key={c.key} style={{ padding: '10px 12px', color: '#333' }}>
                  {c.render(p)}
                </td>
              ))}
              <td style={{ padding: '10px 12px' }}>
                <button
                  onClick={() => onDelete(p)}
                  style={{
                    padding: '4px 10px',
                    background: '#ff000011',
                    color: RED,
                    border: '1px solid #ff000022',
                    borderRadius: 5,
                    cursor: 'pointer',
                    fontSize: 11,
                  }}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const TYPE_COLORS = { deposit: '#3B82F6', progress: ORANGE, final: '#2E7D32', other: '#888' };
function TypeBadge({ type }) {
  const color = TYPE_COLORS[type] || '#888';
  return (
    <span
      style={{
        fontSize: 10,
        padding: '2px 8px',
        borderRadius: 10,
        background: color + '22',
        color,
        fontWeight: 'bold',
      }}
    >
      {type?.charAt(0).toUpperCase() + type?.slice(1)}
    </span>
  );
}

const CAT_COLORS = { subcontractor: '#7C3AED', material: ORANGE, permit: '#0D9488', other: '#888' };
function CategoryBadge({ cat }) {
  const color = CAT_COLORS[cat] || '#888';
  return (
    <span
      style={{
        fontSize: 10,
        padding: '2px 8px',
        borderRadius: 10,
        background: color + '22',
        color,
        fontWeight: 'bold',
      }}
    >
      {cat?.charAt(0).toUpperCase() + cat?.slice(1)}
    </span>
  );
}

function CrDrBadge({ value }) {
  const isCredit = value === 'credit';
  return (
    <span
      style={{
        fontSize: 10,
        padding: '2px 8px',
        borderRadius: 10,
        background: isCredit ? '#2E7D3222' : '#C6282822',
        color: isCredit ? '#2E7D32' : '#C62828',
        fontWeight: 'bold',
      }}
    >
      {isCredit ? 'CR' : 'DR'}
    </span>
  );
}

const inputStyle = {
  width: '100%',
  padding: '8px 10px',
  border: '1.5px solid #C8D4E4',
  borderRadius: 6,
  fontSize: 13,
  boxSizing: 'border-box',
};
