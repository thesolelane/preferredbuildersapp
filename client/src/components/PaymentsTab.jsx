import { useState, useEffect, useCallback, Fragment } from 'react';
import { showToast } from '../utils/toast';
import { showConfirm } from '../utils/confirm';
import ClassBreakdownCell from './ClassBreakdownCell';

const BLUE = '#1B3A6B';
const ORANGE = '#E07B2A';
const GREEN = '#2E7D32';
const RED = '#C62828';
const TEAL = '#0D9488';
const PURPLE = '#7C3AED';

const PAYMENT_TYPES = ['deposit', 'progress', 'final', 'other'];
const CATEGORIES = ['subcontractor', 'material', 'permit', 'other'];

const PASS_THROUGH_CATS = ['permit', 'engineer', 'architect', 'designer'];

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
  customer_name: '',
  check_number: '',
  amount: '',
  date_received: today(),
  time_received: nowTime(),
  payment_type: 'deposit',
  credit_debit: 'credit',
  notes: '',
  is_pass_through_reimbursement: false,
};
const EMPTY_OUT = {
  payee_name: '',
  check_number: '',
  amount: '',
  date_paid: today(),
  time_paid: nowTime(),
  category: 'subcontractor',
  credit_debit: 'debit',
  notes: '',
  payment_class: 'cost_of_revenue',
  paid_by: 'pb',
};
const EMPTY_LINE = { description: '', amount: '', type: 'contract' };
const EMPTY_INV = { notes: '', line_items: [{ ...EMPTY_LINE }] };

const inputStyle = {
  width: '100%',
  padding: '8px 10px',
  border: '1.5px solid #C8D4E4',
  borderRadius: 6,
  fontSize: 13,
  boxSizing: 'border-box',
};

const EMPTY_ALLOC = { job_id: '', payment_class: 'contract', amount: '', notes: '' };

export default function PaymentsTab({ jobId, token, job, onInvoiceChange }) {
  const [received, setReceived] = useState([]);
  const [made, setMade] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [summary, setSummary] = useState({ total_received: 0, total_paid_out: 0, balance: 0 });
  const [loading, setLoading] = useState(true);
  const [showIn, setShowIn] = useState(false);
  const [showOut, setShowOut] = useState(false);
  const [showInvoiceForm, setShowInvoiceForm] = useState(false);
  const [formIn, setFormIn] = useState({ ...EMPTY_IN, customer_name: job?.customer_name || '' });
  const [formOut, setFormOut] = useState(EMPTY_OUT);
  const [formInv, setFormInv] = useState(EMPTY_INV);
  const [saving, setSaving] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [splitIn, setSplitIn] = useState(false);
  const [splitAllocations, setSplitAllocations] = useState([
    { ...EMPTY_ALLOC, job_id: jobId },
    { ...EMPTY_ALLOC },
  ]);
  const [allJobs, setAllJobs] = useState([]);
  const [sendingInvoice, setSendingInvoice] = useState(null);
  const [expandedSplits, setExpandedSplits] = useState(new Set());
  const [splitSiblings, setSplitSiblings] = useState({});
  const [nextMilestone, setNextMilestone] = useState(null);
  const [generatingMilestone, setGeneratingMilestone] = useState(false);

  const headers = { 'x-auth-token': token, 'Content-Type': 'application/json' };

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch(`/api/payments/job/${jobId}`, { headers: { 'x-auth-token': token } }).then((r) =>
        r.json(),
      ),
      fetch(`/api/invoices/job/${jobId}`, { headers: { 'x-auth-token': token } }).then((r) =>
        r.json(),
      ),
      fetch(`/api/invoices/job/${jobId}/next-milestone`, { headers: { 'x-auth-token': token } })
        .then((r) => r.json())
        .catch(() => null),
    ]).then(([payData, invData, nmData]) => {
      setReceived(payData.received || []);
      setMade(payData.made || []);
      setSummary(payData.summary || { total_received: 0, total_paid_out: 0, balance: 0 });
      setInvoices(invData.invoices || []);
      setNextMilestone(nmData?.hasNext ? nmData : null);
      setLoading(false);
    });
  }, [jobId, token]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleSplitPanel = (splitGroupId) => {
    setExpandedSplits((prev) => {
      const next = new Set(prev);
      if (next.has(splitGroupId)) {
        next.delete(splitGroupId);
      } else {
        next.add(splitGroupId);
        if (!splitSiblings[splitGroupId]) {
          fetch(`/api/payments/split-siblings/${splitGroupId}`, {
            headers: { 'x-auth-token': token },
          })
            .then((r) => r.json())
            .then((d) =>
              setSplitSiblings((prev) => ({ ...prev, [splitGroupId]: d.siblings || [] })),
            )
            .catch(() => setSplitSiblings((prev) => ({ ...prev, [splitGroupId]: [] })));
        }
      }
      return next;
    });
  };

  const toggleSplitIn = (on) => {
    setSplitIn(on);
    if (on && allJobs.length === 0) {
      fetch('/api/jobs', { headers: { 'x-auth-token': token } })
        .then((r) => r.json())
        .then((d) => setAllJobs((d.jobs || []).filter((j) => !j.archived)));
    }
  };

  const updateAlloc = (i, field, val) =>
    setSplitAllocations((prev) => prev.map((a, idx) => (idx === i ? { ...a, [field]: val } : a)));

  const addAlloc = () => setSplitAllocations((prev) => [...prev, { ...EMPTY_ALLOC }]);

  const removeAlloc = (i) =>
    setSplitAllocations((prev) => (prev.length > 2 ? prev.filter((_, idx) => idx !== i) : prev));

  const submitIn = async () => {
    if (!formIn.amount) return showToast('Enter an amount', 'error');
    if (!formIn.date_received) return showToast('Enter a date', 'error');
    setSaving(true);
    const body = { ...formIn, job_id: jobId };
    const res = await fetch('/api/payments/received', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (res.ok) {
      setFormIn({
        ...EMPTY_IN,
        customer_name: job?.customer_name || '',
        date_received: today(),
        time_received: nowTime(),
      });
      setShowIn(false);
      setSummary(data.summary);
      load();
      showToast('Check recorded');
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
      setFormIn({
        ...EMPTY_IN,
        customer_name: job?.customer_name || '',
        date_received: today(),
        time_received: nowTime(),
      });
      setSplitAllocations([{ ...EMPTY_ALLOC, job_id: jobId }, { ...EMPTY_ALLOC }]);
      setSplitIn(false);
      setShowIn(false);
      load();
      showToast(`Split payment recorded across ${data.payments.length} jobs`);
    } else {
      showToast(data.error || 'Failed to save split payment', 'error');
    }
    setSaving(false);
  };

  const sendDepositInvoice = async (inv) => {
    if (!job?.customer_email) return showToast('No customer email on file', 'error');
    setSendingInvoice(inv.id);
    const res = await fetch(`/api/invoices/${inv.id}/email`, {
      method: 'POST',
      headers,
    });
    const d = await res.json();
    if (res.ok) {
      showToast(`Invoice 1 sent to ${job.customer_email}`);
      load();
      onInvoiceChange?.();
    } else {
      showToast(d.error || 'Failed to send invoice', 'error');
    }
    setSendingInvoice(null);
  };

  const submitOut = async () => {
    if (!formOut.payee_name) return showToast('Enter a payee name', 'error');
    if (!formOut.amount) return showToast('Enter an amount', 'error');
    if (!formOut.date_paid) return showToast('Enter a date', 'error');
    setSaving(true);
    const body = { ...formOut, job_id: jobId };
    const res = await fetch('/api/payments/made', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (res.ok) {
      setFormOut({ ...EMPTY_OUT, date_paid: today(), time_paid: nowTime() });
      setShowOut(false);
      setSummary(data.summary);
      load();
      showToast('Payment recorded');
    } else {
      showToast(data.error || 'Failed to save', 'error');
    }
    setSaving(false);
  };

  const submitInvoice = async () => {
    const validLines = (formInv.line_items || []).filter(
      (li) => li.description.trim() || Number(li.amount),
    );
    if (!validLines.length) return showToast('Add at least one line item', 'error');
    const emptyDesc = validLines.find((li) => !li.description.trim());
    if (emptyDesc) return showToast('All line items need a description', 'error');
    const badAmt = validLines.find((li) => !Number(li.amount) || Number(li.amount) <= 0);
    if (badAmt) return showToast('All line items need an amount greater than 0', 'error');
    setSaving(true);
    const payload = {
      notes: formInv.notes,
      line_items: validLines.map((li) => ({ ...li, amount: parseFloat(li.amount) })),
    };
    const res = await fetch(`/api/invoices/job/${jobId}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (res.ok) {
      setFormInv({ ...EMPTY_INV, line_items: [{ ...EMPTY_LINE }] });
      setShowInvoiceForm(false);
      load();
      showToast('Invoice created: ' + data.invoice.invoice_number);
      onInvoiceChange?.();
    } else {
      showToast(data.error || 'Failed to create invoice', 'error');
    }
    setSaving(false);
  };

  const markInvoice = async (inv, status) => {
    const res = await fetch(`/api/invoices/${inv.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      load();
      showToast(`Invoice marked ${status}`);
      onInvoiceChange?.();
    } else {
      const d = await res.json();
      showToast(d.error || 'Failed', 'error');
    }
  };

  const deleteInvoice = async (inv) => {
    if (!(await showConfirm(`Delete invoice ${inv.invoice_number}?`))) return;
    const res = await fetch(`/api/invoices/${inv.id}`, { method: 'DELETE', headers });
    if (res.ok) {
      load();
      showToast('Invoice deleted');
      onInvoiceChange?.();
    }
  };

  const generateNextMilestone = async () => {
    if (!nextMilestone) return;
    setGeneratingMilestone(true);
    const res = await fetch(`/api/invoices/job/${jobId}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        invoice_type: 'contract_invoice',
        amount: nextMilestone.amount,
        notes: nextMilestone.title,
        line_items: [
          { description: nextMilestone.title, amount: nextMilestone.amount, type: 'contract' },
        ],
      }),
    });
    const data = await res.json();
    if (res.ok) {
      load();
      showToast(`Created: ${data.invoice.invoice_number} — ${nextMilestone.title}`);
      onInvoiceChange?.();
    } else {
      showToast(data.error || 'Failed to create invoice', 'error');
    }
    setGeneratingMilestone(false);
  };

  const deleteReceived = async (p) => {
    if (
      !(await showConfirm(
        `Delete check record: ${fmt(p.amount)} received on ${fmtDate(p.date_received)}?`,
      ))
    )
      return;
    const res = await fetch(`/api/payments/received/${p.id}`, { method: 'DELETE', headers });
    const data = await res.json();
    if (res.ok) {
      setSummary(data.summary);
      load();
      showToast('Record deleted');
    } else showToast(data.error || 'Failed to delete', 'error');
  };

  const deleteMade = async (p) => {
    if (!(await showConfirm(`Delete payment record: ${fmt(p.amount)} to ${p.payee_name}?`))) return;
    const res = await fetch(`/api/payments/made/${p.id}`, { method: 'DELETE', headers });
    const data = await res.json();
    if (res.ok) {
      setSummary(data.summary);
      load();
      showToast('Record deleted');
    } else showToast(data.error || 'Failed to delete', 'error');
  };

  const categoryChanged = (cat) => {
    const isPassThrough = PASS_THROUGH_CATS.includes(cat) || cat === 'permit';
    setFormOut((p) => ({
      ...p,
      category: cat,
      payment_class: isPassThrough ? 'pass_through' : 'cost_of_revenue',
      paid_by: 'pb',
    }));
  };

  if (loading) return <div style={{ color: '#888', padding: 20 }}>Loading payments...</div>;

  const contractInvoices = invoices.filter(
    (i) => i.invoice_type === 'contract_invoice' || i.invoice_type === 'combined_invoice',
  );
  const passThroughInvoices = invoices.filter((i) => i.invoice_type === 'pass_through_invoice');
  const changeOrders = invoices.filter((i) => i.invoice_type === 'change_order');
  const contractReceived = received.filter((r) => !r.is_pass_through_reimbursement);
  const ptReceived = received.filter((r) => r.is_pass_through_reimbursement);
  const contractPaid = made.filter((m) => m.payment_class === 'cost_of_revenue');
  const ptPaid = made.filter(
    (m) =>
      (m.payment_class === 'pass_through' || m.is_pass_through) && m.paid_by !== 'customer_direct',
  );
  const ptPaidDirectByCustomer = made.filter(
    (m) =>
      (m.payment_class === 'pass_through' || m.is_pass_through) && m.paid_by === 'customer_direct',
  );

  const totalContractReceived = contractReceived.reduce(
    (s, r) => s + (r.credit_debit === 'debit' ? -1 : 1) * Number(r.amount || 0),
    0,
  );
  const totalPtReceived = ptReceived.reduce(
    (s, r) => s + (r.credit_debit === 'debit' ? -1 : 1) * Number(r.amount || 0),
    0,
  );
  const totalContractPaid = contractPaid.reduce(
    (s, m) => s + (m.credit_debit === 'credit' ? -1 : 1) * Number(m.amount || 0),
    0,
  );
  const totalPtPaid = ptPaid.reduce(
    (s, m) => s + (m.credit_debit === 'credit' ? -1 : 1) * Number(m.amount || 0),
    0,
  );
  const totalPtDirectByCustomer = ptPaidDirectByCustomer.reduce(
    (s, m) => s + Number(m.amount || 0),
    0,
  );
  const grossMargin = totalContractReceived - totalContractPaid;
  const ptBalance = totalPtPaid - totalPtReceived; // only PB-fronted costs vs reimbursements
  const totalCOValue = changeOrders.reduce((s, co) => s + Number(co.amount || 0), 0);
  const totalCOPaid = changeOrders
    .filter((co) => co.status === 'paid')
    .reduce((s, co) => s + Number(co.amount_paid || co.amount || 0), 0);

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 20,
        }}
      >
        <h3 style={{ color: BLUE, margin: 0 }}>Payment Tracking</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <a
            href="/invoices"
            style={{
              padding: '8px 14px',
              background: '#4F46E5',
              color: 'white',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              fontWeight: 'bold',
              fontSize: 12,
              textDecoration: 'none',
            }}
          >
            🧾 Invoices
          </a>
          {nextMilestone && (
            <button
              onClick={generateNextMilestone}
              disabled={generatingMilestone}
              title={`Invoice ${nextMilestone.slot} of ${nextMilestone.totalSlots}`}
              style={{
                padding: '8px 14px',
                background: nextMilestone.isFinal ? '#7C3AED' : '#0F766E',
                color: 'white',
                border: 'none',
                borderRadius: 6,
                cursor: generatingMilestone ? 'not-allowed' : 'pointer',
                fontWeight: 'bold',
                fontSize: 12,
                opacity: generatingMilestone ? 0.7 : 1,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              {generatingMilestone ? (
                'Creating...'
              ) : (
                <>
                  ➕ INV-{nextMilestone.slot}/{nextMilestone.totalSlots}
                  <span style={{ fontWeight: 'normal', opacity: 0.9 }}>
                    {nextMilestone.title} — ${Number(nextMilestone.amount).toLocaleString()}
                  </span>
                </>
              )}
            </button>
          )}
          <button
            onClick={() => {
              setShowInvoiceForm(true);
              setShowIn(false);
              setShowOut(false);
            }}
            style={{
              padding: '8px 14px',
              background: TEAL,
              color: 'white',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              fontWeight: 'bold',
              fontSize: 12,
            }}
          >
            + Internal Invoice
          </button>
          <button
            onClick={() => {
              setShowIn(true);
              setShowOut(false);
              setShowInvoiceForm(false);
            }}
            style={{
              padding: '8px 14px',
              background: GREEN,
              color: 'white',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              fontWeight: 'bold',
              fontSize: 12,
            }}
          >
            + AR Entry
          </button>
          <button
            onClick={() => {
              setShowOut(true);
              setShowIn(false);
              setShowInvoiceForm(false);
            }}
            style={{
              padding: '8px 14px',
              background: RED,
              color: 'white',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              fontWeight: 'bold',
              fontSize: 12,
            }}
          >
            + AP Entry
          </button>
        </div>
      </div>

      {/* Financial summary — class breakdown */}
      <div
        style={{
          background: '#f8faff',
          border: '1px solid #dce6f5',
          borderRadius: 10,
          padding: '14px 18px',
          marginBottom: 20,
          fontSize: 13,
        }}
      >
        {/* AR row */}
        <div
          style={{
            display: 'flex',
            gap: 0,
            alignItems: 'stretch',
            marginBottom: 8,
            borderRadius: 7,
            overflow: 'hidden',
            border: `1px solid ${GREEN}30`,
          }}
        >
          <ClassBreakdownCell
            label="AR — Contract"
            value={fmt(totalContractReceived)}
            color={GREEN}
            flex={2}
            borderRight
          />
          <ClassBreakdownCell
            label="AR — Pass-Through Reimbursed"
            value={fmt(totalPtReceived)}
            color={TEAL}
            flex={2}
            borderRight
          />
          <ClassBreakdownCell
            label="Total AR"
            value={fmt(summary.total_received)}
            color={GREEN}
            flex={1.5}
            bold
          />
        </div>

        {/* AP row */}
        <div
          style={{
            display: 'flex',
            gap: 0,
            alignItems: 'stretch',
            marginBottom: 8,
            borderRadius: 7,
            overflow: 'hidden',
            border: `1px solid ${RED}30`,
          }}
        >
          <ClassBreakdownCell
            label="AP — Sub / Materials"
            value={fmt(totalContractPaid)}
            color={RED}
            flex={2}
            borderRight
          />
          <ClassBreakdownCell
            label="AP — Pass-Through Advances"
            value={fmt(totalPtPaid)}
            color={ORANGE}
            flex={2}
            borderRight
          />
          <ClassBreakdownCell
            label="Total AP"
            value={fmt(summary.total_paid_out)}
            color={RED}
            flex={1.5}
            bold
          />
        </div>

        {/* Net cash position row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: grossMargin >= 0 ? '#f0fdf4' : '#fff1f1',
            border: `1px solid ${grossMargin >= 0 ? GREEN : RED}40`,
            borderRadius: 7,
            padding: '9px 16px',
          }}
        >
          <span style={{ color: '#555', fontWeight: 600, fontSize: 12 }}>
            Net Cash Position
            <span style={{ fontWeight: 400, color: '#888', marginLeft: 6, fontSize: 11 }}>
              (AR Contract − AP Sub/Materials — pass-throughs excluded)
            </span>
          </span>
          <span
            style={{
              fontWeight: 700,
              fontSize: 15,
              color: grossMargin >= 0 ? GREEN : RED,
              letterSpacing: '-0.3px',
            }}
          >
            {fmt(grossMargin)}
          </span>
        </div>
      </div>

      {/* Invoice Form */}
      {showInvoiceForm &&
        (() => {
          const lines = formInv.line_items || [];
          const contractTotal = lines.reduce(
            (s, li) => (li.type === 'contract' ? s + (parseFloat(li.amount) || 0) : s),
            0,
          );
          const passThroughTotal = lines.reduce(
            (s, li) => (li.type === 'pass_through' ? s + (parseFloat(li.amount) || 0) : s),
            0,
          );
          const grandTotal = contractTotal + passThroughTotal;
          const hasPT = lines.some((li) => li.type === 'pass_through');
          const updateLine = (i, field, value) =>
            setFormInv((p) => {
              const next = p.line_items.map((l, idx) => (idx === i ? { ...l, [field]: value } : l));
              return { ...p, line_items: next };
            });
          const addLine = () =>
            setFormInv((p) => ({ ...p, line_items: [...p.line_items, { ...EMPTY_LINE }] }));
          const removeLine = (i) =>
            setFormInv((p) => ({ ...p, line_items: p.line_items.filter((_, idx) => idx !== i) }));

          return (
            <div
              style={{
                background: '#f0f9ff',
                border: `1px solid ${TEAL}40`,
                borderRadius: 8,
                padding: 16,
                marginBottom: 16,
              }}
            >
              <div style={{ fontWeight: 'bold', color: TEAL, marginBottom: 14, fontSize: 14 }}>
                Create Invoice — Line Items
              </div>

              {hasPT && (
                <div
                  style={{
                    background: '#fffbeb',
                    border: '1px solid #fbbf24',
                    borderRadius: 6,
                    padding: '8px 12px',
                    marginBottom: 12,
                    fontSize: 12,
                    color: '#92400e',
                  }}
                >
                  Pass-through items are billed for reimbursement only — they are{' '}
                  <strong>not income to Preferred Builders</strong>. The invoice type is auto-set
                  based on your line item mix.
                </div>
              )}

              {/* Line items table */}
              <div style={{ overflowX: 'auto', marginBottom: 8 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#1B3A6B', color: 'white' }}>
                      <th
                        style={{
                          padding: '7px 8px',
                          textAlign: 'left',
                          fontWeight: 600,
                          fontSize: 11,
                        }}
                      >
                        #
                      </th>
                      <th
                        style={{
                          padding: '7px 8px',
                          textAlign: 'left',
                          fontWeight: 600,
                          fontSize: 11,
                        }}
                      >
                        Description
                      </th>
                      <th
                        style={{
                          padding: '7px 8px',
                          textAlign: 'center',
                          fontWeight: 600,
                          fontSize: 11,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        Type
                      </th>
                      <th
                        style={{
                          padding: '7px 8px',
                          textAlign: 'right',
                          fontWeight: 600,
                          fontSize: 11,
                        }}
                      >
                        Amount
                      </th>
                      <th
                        style={{
                          padding: '7px 4px',
                          textAlign: 'center',
                          fontWeight: 600,
                          fontSize: 11,
                        }}
                      ></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((li, i) => (
                      <tr
                        key={i}
                        style={{
                          background: li.type === 'pass_through' ? '#fffef5' : '#ffffff',
                          borderBottom: '1px solid #e2e8f0',
                        }}
                      >
                        <td style={{ padding: '6px 8px', color: '#888', fontSize: 11 }}>{i + 1}</td>
                        <td style={{ padding: '4px 6px' }}>
                          <input
                            value={li.description}
                            onChange={(e) => updateLine(i, 'description', e.target.value)}
                            placeholder="e.g. Customer Deposit, Building Permit..."
                            style={{ ...inputStyle, fontSize: 12, padding: '6px 8px' }}
                          />
                        </td>
                        <td style={{ padding: '4px 6px', minWidth: 130 }}>
                          <select
                            value={li.type}
                            onChange={(e) => updateLine(i, 'type', e.target.value)}
                            style={{
                              ...inputStyle,
                              fontSize: 12,
                              padding: '6px 8px',
                              background: li.type === 'pass_through' ? '#fffbeb' : '#f0f4ff',
                              color: li.type === 'pass_through' ? '#92400e' : '#1B3A6B',
                              fontWeight: 600,
                            }}
                          >
                            <option value="contract">Contract</option>
                            <option value="pass_through">Pass-Through</option>
                          </select>
                        </td>
                        <td style={{ padding: '4px 6px', minWidth: 100 }}>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={li.amount}
                            onChange={(e) => updateLine(i, 'amount', e.target.value)}
                            placeholder="0.00"
                            style={{
                              ...inputStyle,
                              fontSize: 12,
                              padding: '6px 8px',
                              textAlign: 'right',
                            }}
                          />
                        </td>
                        <td style={{ padding: '4px 4px', textAlign: 'center' }}>
                          {lines.length > 1 && (
                            <button
                              onClick={() => removeLine(i)}
                              style={{
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                color: '#C62828',
                                fontSize: 16,
                                lineHeight: 1,
                                padding: '2px 4px',
                              }}
                            >
                              ✕
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <button
                onClick={addLine}
                style={{
                  background: 'none',
                  border: `1px dashed ${TEAL}`,
                  color: TEAL,
                  borderRadius: 6,
                  padding: '5px 14px',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 600,
                  marginBottom: 14,
                }}
              >
                + Add Line Item
              </button>

              {/* Totals summary */}
              {grandTotal > 0 && (
                <div
                  style={{
                    background: '#f8faff',
                    border: '1px solid #dbeafe',
                    borderRadius: 8,
                    padding: '10px 14px',
                    marginBottom: 14,
                    fontSize: 13,
                  }}
                >
                  {contractTotal > 0 && (
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        marginBottom: 4,
                        color: '#1B3A6B',
                      }}
                    >
                      <span style={{ fontWeight: 500 }}>Contract (PB Revenue):</span>
                      <span style={{ fontWeight: 700 }}>{fmt(contractTotal)}</span>
                    </div>
                  )}
                  {passThroughTotal > 0 && (
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        marginBottom: 4,
                        color: '#92400e',
                      }}
                    >
                      <span style={{ fontWeight: 500 }}>Pass-Through (Reimbursement):</span>
                      <span style={{ fontWeight: 700 }}>{fmt(passThroughTotal)}</span>
                    </div>
                  )}
                  {contractTotal > 0 && passThroughTotal > 0 && (
                    <hr
                      style={{ border: 'none', borderTop: '1px solid #dbeafe', margin: '6px 0' }}
                    />
                  )}
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontWeight: 700,
                      fontSize: 15,
                      color: hasPT && contractTotal > 0 ? '#E07B2A' : hasPT ? '#92400e' : '#1B3A6B',
                    }}
                  >
                    <span>Total Due:</span>
                    <span>{fmt(grandTotal)}</span>
                  </div>
                </div>
              )}

              {/* Notes */}
              <Field label="Notes (optional)">
                <input
                  value={formInv.notes}
                  onChange={(e) => setFormInv((p) => ({ ...p, notes: e.target.value }))}
                  placeholder="Payment terms, instructions, etc."
                  style={{ ...inputStyle, marginBottom: 12 }}
                />
              </Field>

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={submitInvoice}
                  disabled={saving}
                  style={{
                    padding: '8px 18px',
                    background: TEAL,
                    color: 'white',
                    border: 'none',
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    fontSize: 12,
                  }}
                >
                  {saving ? 'Creating...' : 'Create Invoice'}
                </button>
                <button
                  onClick={() => {
                    setShowInvoiceForm(false);
                    setFormInv({ ...EMPTY_INV, line_items: [{ ...EMPTY_LINE }] });
                  }}
                  style={{
                    padding: '8px 12px',
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
          );
        })()}

      {/* AR Entry Form */}
      {showIn && (
        <div
          style={{
            background: '#f0fdf4',
            border: `1px solid ${GREEN}40`,
            borderRadius: 8,
            padding: 16,
            marginBottom: 16,
          }}
        >
          <div style={{ fontWeight: 'bold', color: GREEN, marginBottom: 12, fontSize: 13 }}>
            Record AR Payment — Check Received (Credit)
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
              gap: 10,
              marginBottom: 10,
            }}
          >
            <Field label="Customer Name">
              <input
                value={formIn.customer_name}
                onChange={(e) => setFormIn((p) => ({ ...p, customer_name: e.target.value }))}
                placeholder="Name on check"
                style={inputStyle}
              />
            </Field>
            <Field label="Check #">
              <input
                value={formIn.check_number}
                onChange={(e) => setFormIn((p) => ({ ...p, check_number: e.target.value }))}
                placeholder="e.g. 1042"
                style={inputStyle}
              />
            </Field>
            <Field label="Amount *">
              <input
                type="number"
                step="0.01"
                min="0"
                value={formIn.amount}
                onChange={(e) => setFormIn((p) => ({ ...p, amount: e.target.value }))}
                placeholder="0.00"
                style={inputStyle}
              />
            </Field>
            <Field label="Date *">
              <input
                type="date"
                value={formIn.date_received}
                onChange={(e) => setFormIn((p) => ({ ...p, date_received: e.target.value }))}
                style={inputStyle}
              />
            </Field>
            <Field label="Time">
              <input
                type="time"
                value={formIn.time_received}
                onChange={(e) => setFormIn((p) => ({ ...p, time_received: e.target.value }))}
                style={inputStyle}
              />
            </Field>
            <Field label="Payment Type">
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
            </Field>
            <Field label="Credit / Debit">
              <select
                value={formIn.credit_debit}
                onChange={(e) => setFormIn((p) => ({ ...p, credit_debit: e.target.value }))}
                style={inputStyle}
              >
                <option value="credit">Credit (money in)</option>
                <option value="debit">Debit (refund out)</option>
              </select>
            </Field>
            <Field label="Notes">
              <input
                value={formIn.notes}
                onChange={(e) => setFormIn((p) => ({ ...p, notes: e.target.value }))}
                placeholder="Optional"
                style={inputStyle}
              />
            </Field>
          </div>
          <Field label="">
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 12,
                cursor: 'pointer',
                marginBottom: 10,
              }}
            >
              <input
                type="checkbox"
                checked={formIn.is_pass_through_reimbursement}
                onChange={(e) =>
                  setFormIn((p) => ({ ...p, is_pass_through_reimbursement: e.target.checked }))
                }
              />
              <span>
                This is a <strong>pass-through reimbursement</strong> (permit, engineer, etc.) —
                will NOT be counted as income
              </span>
            </label>
          </Field>

          {formIn.payment_type !== 'deposit' && (
            <div style={{ marginBottom: 12 }}>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={splitIn}
                  onChange={(e) => toggleSplitIn(e.target.checked)}
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
                marginBottom: 14,
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
                                  onChange={(e) => updateAlloc(i, 'job_id', e.target.value)}
                                  style={{ ...inputStyle, fontSize: 11, padding: '5px 6px' }}
                                >
                                  <option value="">— Select job —</option>
                                  {allJobs.map((j) => (
                                    <option key={j.id} value={j.id}>
                                      {j.project_address || j.customer_name || j.id.slice(0, 8)}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td style={{ padding: '4px 6px', minWidth: 140 }}>
                                <select
                                  value={a.payment_class}
                                  onChange={(e) => updateAlloc(i, 'payment_class', e.target.value)}
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
                                  onChange={(e) => updateAlloc(i, 'amount', e.target.value)}
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
                                  onChange={(e) => updateAlloc(i, 'notes', e.target.value)}
                                  placeholder="Optional"
                                  style={{ ...inputStyle, fontSize: 11, padding: '5px 6px' }}
                                />
                              </td>
                              <td style={{ padding: '4px 4px' }}>
                                <button
                                  onClick={() => removeAlloc(i)}
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
                      onClick={addAlloc}
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
                      <span
                        style={{
                          fontWeight: 'bold',
                          color: balanced ? '#166534' : '#991b1b',
                        }}
                      >
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

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={splitIn ? submitSplitIn : submitIn}
              disabled={saving}
              style={{
                padding: '8px 16px',
                background: GREEN,
                color: 'white',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                fontWeight: 'bold',
                fontSize: 12,
              }}
            >
              {saving ? 'Saving...' : splitIn ? 'Save Split Payment' : 'Save'}
            </button>
            <button
              onClick={() => {
                setShowIn(false);
                setSplitIn(false);
                setSplitAllocations([{ ...EMPTY_ALLOC, job_id: jobId }, { ...EMPTY_ALLOC }]);
              }}
              style={{
                padding: '8px 12px',
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

      {/* Check Paid Out Form */}
      {showOut && (
        <div
          style={{
            background: '#fff5f5',
            border: `1px solid ${RED}40`,
            borderRadius: 8,
            padding: 16,
            marginBottom: 16,
          }}
        >
          <div style={{ fontWeight: 'bold', color: RED, marginBottom: 12, fontSize: 13 }}>
            Record AP Payment — Check Paid Out (Debit)
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
              gap: 10,
              marginBottom: 10,
            }}
          >
            <Field label="Payee Name *">
              <input
                value={formOut.payee_name}
                onChange={(e) => setFormOut((p) => ({ ...p, payee_name: e.target.value }))}
                placeholder="Subcontractor / vendor"
                style={inputStyle}
              />
            </Field>
            <Field label="Check #">
              <input
                value={formOut.check_number}
                onChange={(e) => setFormOut((p) => ({ ...p, check_number: e.target.value }))}
                placeholder="e.g. 2210"
                style={inputStyle}
              />
            </Field>
            <Field label="Amount *">
              <input
                type="number"
                step="0.01"
                min="0"
                value={formOut.amount}
                onChange={(e) => setFormOut((p) => ({ ...p, amount: e.target.value }))}
                placeholder="0.00"
                style={inputStyle}
              />
            </Field>
            <Field label="Date *">
              <input
                type="date"
                value={formOut.date_paid}
                onChange={(e) => setFormOut((p) => ({ ...p, date_paid: e.target.value }))}
                style={inputStyle}
              />
            </Field>
            <Field label="Time">
              <input
                type="time"
                value={formOut.time_paid}
                onChange={(e) => setFormOut((p) => ({ ...p, time_paid: e.target.value }))}
                style={inputStyle}
              />
            </Field>
            <Field label="Department / Trade">
              <select
                value={formOut.category}
                onChange={(e) => categoryChanged(e.target.value)}
                style={inputStyle}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c.charAt(0).toUpperCase() + c.slice(1)}
                  </option>
                ))}
                {(job?.proposal_data?.lineItems || [])
                  .map((li) => (li.trade || '').toLowerCase().trim())
                  .filter(
                    (t) =>
                      t &&
                      !CATEGORIES.includes(t) &&
                      !['permit', 'engineer', 'architect', 'designer'].includes(t),
                  )
                  .filter((t, i, arr) => arr.indexOf(t) === i)
                  .map((t) => (
                    <option key={t} value={t}>
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </option>
                  ))}
                <option value="engineer">Engineer</option>
                <option value="architect">Architect</option>
                <option value="designer">Design Professional</option>
              </select>
            </Field>
            <Field label="Payment Class">
              <select
                value={formOut.payment_class}
                onChange={(e) => setFormOut((p) => ({ ...p, payment_class: e.target.value }))}
                style={inputStyle}
              >
                <option value="cost_of_revenue">Cost of Revenue</option>
                <option value="pass_through">Pass-Through</option>
              </select>
            </Field>
            <Field label="Credit / Debit">
              <select
                value={formOut.credit_debit}
                onChange={(e) => setFormOut((p) => ({ ...p, credit_debit: e.target.value }))}
                style={inputStyle}
              >
                <option value="debit">Debit (money out)</option>
                <option value="credit">Credit (refund in)</option>
              </select>
            </Field>
            <Field label="Notes">
              <input
                value={formOut.notes}
                onChange={(e) => setFormOut((p) => ({ ...p, notes: e.target.value }))}
                placeholder="Optional"
                style={inputStyle}
              />
            </Field>
          </div>
          {formOut.payment_class === 'pass_through' && (
            <div
              style={{
                background: '#fffbeb',
                border: '1px solid #fbbf24',
                borderRadius: 6,
                padding: '10px 12px',
                marginBottom: 10,
                fontSize: 12,
                color: '#92400e',
              }}
            >
              <div style={{ fontWeight: 'bold', marginBottom: 8 }}>Who is paying this cost?</div>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 6,
                  cursor: 'pointer',
                }}
              >
                <input
                  type="radio"
                  name="paid_by"
                  value="pb"
                  checked={formOut.paid_by !== 'customer_direct'}
                  onChange={() => setFormOut((p) => ({ ...p, paid_by: 'pb' }))}
                />
                <span>
                  <strong>PB paid on behalf of customer</strong> — PB fronts the cost, customer
                  reimburses PB
                </span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="paid_by"
                  value="customer_direct"
                  checked={formOut.paid_by === 'customer_direct'}
                  onChange={() => setFormOut((p) => ({ ...p, paid_by: 'customer_direct' }))}
                />
                <span>
                  <strong>Customer paid directly</strong> — Customer wrote check directly to
                  municipality / vendor. No reimbursement to PB needed.
                </span>
              </label>
              <div style={{ marginTop: 8, fontSize: 11, color: '#b45309' }}>
                {formOut.paid_by === 'customer_direct'
                  ? 'This will be recorded for tracking only — it will NOT appear as a PB expense or affect your cash flow.'
                  : 'This will NOT be counted as income or included in margin calculations. A pass-through invoice will track reimbursement.'}
              </div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={submitOut}
              disabled={saving}
              style={{
                padding: '8px 16px',
                background: RED,
                color: 'white',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                fontWeight: 'bold',
                fontSize: 12,
              }}
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={() => setShowOut(false)}
              style={{
                padding: '8px 12px',
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

      {/* Invoice 1 draft prompt card */}
      {(() => {
        const draftDeposit = invoices.find(
          (i) => i.invoice_type === 'contract_invoice' && i.status === 'draft',
        );
        const hasDepositPayment = received.some(
          (r) => r.payment_type === 'deposit' && r.credit_debit === 'credit',
        );
        if (!draftDeposit || hasDepositPayment) return null;
        const invTotal = Number(draftDeposit.amount || 0);
        return (
          <div
            style={{
              background: '#fffbeb',
              border: '2px solid #f59e0b',
              borderRadius: 10,
              padding: '14px 18px',
              marginBottom: 20,
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ fontSize: 22 }}>🧾</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 'bold', color: '#92400e', fontSize: 14, marginBottom: 2 }}>
                Invoice 1 ready — {fmt(invTotal)}
              </div>
              <div style={{ fontSize: 12, color: '#78350f' }}>
                Contract deposit invoice auto-created on signing.{' '}
                <span style={{ fontFamily: 'monospace' }}>{draftDeposit.invoice_number}</span> — not
                yet sent.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => sendDepositInvoice(draftDeposit)}
                disabled={sendingInvoice === draftDeposit.id || !job?.customer_email}
                style={{
                  padding: '7px 16px',
                  background: '#f59e0b',
                  color: 'white',
                  border: 'none',
                  borderRadius: 6,
                  cursor: job?.customer_email ? 'pointer' : 'not-allowed',
                  fontWeight: 'bold',
                  fontSize: 12,
                  opacity: sendingInvoice === draftDeposit.id ? 0.7 : 1,
                }}
                title={!job?.customer_email ? 'No customer email on file' : ''}
              >
                {sendingInvoice === draftDeposit.id ? 'Sending...' : '📧 Send to Customer'}
              </button>
              <a
                href={`/api/invoices/${draftDeposit.id}/pdf?token=${token}`}
                target="_blank"
                rel="noreferrer"
                style={{
                  padding: '7px 14px',
                  background: 'white',
                  color: '#92400e',
                  border: '1px solid #f59e0b',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  fontSize: 12,
                  textDecoration: 'none',
                }}
              >
                👁 View PDF
              </a>
            </div>
          </div>
        );
      })()}

      {/* Invoices Section */}
      {invoices.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontWeight: 'bold', color: TEAL, fontSize: 13, marginBottom: 10 }}>
            Invoices
          </div>

          {contractInvoices.length > 0 && (
            <InvoiceGroup
              label="Contract Invoices"
              invoices={contractInvoices}
              color={BLUE}
              onMark={markInvoice}
              onDelete={deleteInvoice}
              token={token}
              job={job}
            />
          )}
          {passThroughInvoices.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <div style={{ fontSize: 12, fontWeight: 'bold', color: ORANGE }}>
                  Pass-Through Invoices
                </div>
                <span
                  style={{
                    fontSize: 10,
                    background: '#fffbeb',
                    color: '#92400e',
                    border: '1px solid #fbbf24',
                    padding: '1px 6px',
                    borderRadius: 10,
                    fontWeight: 'bold',
                  }}
                >
                  NOT INCOME
                </span>
              </div>
              <InvoiceGroup
                label=""
                invoices={passThroughInvoices}
                color={ORANGE}
                onMark={markInvoice}
                onDelete={deleteInvoice}
                token={token}
                job={job}
              />
            </div>
          )}
          {changeOrders.length > 0 && (
            <InvoiceGroup
              label="Change Orders"
              invoices={changeOrders}
              color={PURPLE}
              onMark={markInvoice}
              onDelete={deleteInvoice}
              token={token}
              job={job}
            />
          )}
        </div>
      )}

      {/* AR — Accounts Receivable */}
      <div style={{ marginBottom: 24 }}>
        <div
          style={{
            fontWeight: 'bold',
            color: GREEN,
            fontSize: 13,
            marginBottom: 10,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          Accounts Receivable (AR)
          <span style={{ fontSize: 12, fontWeight: 'normal', color: '#888' }}>
            ({received.length})
          </span>
        </div>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 10 }}>
          {['Deposit', 'Progress', 'Final', 'Other'].map((lbl) => (
            <span
              key={lbl}
              style={{
                fontSize: 10,
                padding: '2px 9px',
                borderRadius: 10,
                background: '#e8f5e9',
                color: GREEN,
                fontWeight: 600,
                border: `1px solid ${GREEN}33`,
              }}
            >
              {lbl}
            </span>
          ))}
        </div>
        {received.length === 0 ? (
          <div style={{ color: '#aaa', fontSize: 13, padding: '12px 0' }}>
            No AR entries recorded yet.
          </div>
        ) : (
          <div style={{ overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f0fdf4' }}>
                  {[
                    'Date & Time',
                    'From',
                    'Check #',
                    'Type',
                    'Class',
                    'Cr/Dr',
                    'Amount',
                    'Recorded By',
                    'Notes',
                    '',
                  ].map((h) => (
                    <th
                      key={h}
                      style={{
                        padding: '8px 10px',
                        textAlign: 'left',
                        fontSize: 11,
                        color: '#888',
                        fontWeight: 'bold',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {received.map((p) => (
                  <Fragment key={p.id}>
                    <tr
                      style={{
                        borderBottom: expandedSplits.has(p.split_group_id)
                          ? 'none'
                          : '1px solid #f0f0f0',
                        background: p.is_pass_through_reimbursement
                          ? '#fffef0'
                          : p.split_group_id
                            ? '#f8fbff'
                            : 'white',
                        borderLeft: p.split_group_id ? '3px solid #3B82F6' : undefined,
                      }}
                    >
                      <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                        {fmtDate(p.date_received)}
                        {p.time_received && (
                          <span style={{ color: '#888', marginLeft: 6, fontSize: 11 }}>
                            {p.time_received}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '8px 10px' }}>{p.customer_name || '—'}</td>
                      <td style={{ padding: '8px 10px', color: '#888' }}>
                        {p.check_number || '—'}
                      </td>
                      <td style={{ padding: '8px 10px' }}>
                        <TypeBadge type={p.payment_type} />
                      </td>
                      <td style={{ padding: '8px 10px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                          {p.is_pass_through_reimbursement ? (
                            <span
                              style={{
                                fontSize: 10,
                                padding: '2px 6px',
                                borderRadius: 8,
                                background: '#fffbeb',
                                color: '#92400e',
                                fontWeight: 'bold',
                                border: '1px solid #fbbf24',
                              }}
                            >
                              Pass-Thru
                            </span>
                          ) : (
                            <span
                              style={{
                                fontSize: 10,
                                padding: '2px 6px',
                                borderRadius: 8,
                                background: '#e8f5e9',
                                color: GREEN,
                                fontWeight: 'bold',
                              }}
                            >
                              Contract
                            </span>
                          )}
                          {p.split_group_id && (
                            <button
                              onClick={() => toggleSplitPanel(p.split_group_id)}
                              title="Click to see all allocations from this split check"
                              style={{
                                fontSize: 10,
                                padding: '2px 6px',
                                borderRadius: 8,
                                background: expandedSplits.has(p.split_group_id)
                                  ? '#3B82F6'
                                  : '#eff6ff',
                                color: expandedSplits.has(p.split_group_id) ? 'white' : '#3B82F6',
                                fontWeight: 'bold',
                                border: '1px solid #bfdbfe',
                                cursor: 'pointer',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {expandedSplits.has(p.split_group_id)
                                ? '▲ Split check'
                                : '▼ Split check'}
                            </button>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '8px 10px' }}>
                        <CrDrBadge value={p.credit_debit} />
                      </td>
                      <td
                        style={{
                          padding: '8px 10px',
                          fontWeight: 'bold',
                          color: p.credit_debit === 'debit' ? RED : GREEN,
                        }}
                      >
                        {fmt(p.amount)}
                      </td>
                      <td style={{ padding: '8px 10px', color: '#888', fontSize: 11 }}>
                        {p.recorded_by || '—'}
                      </td>
                      <td style={{ padding: '8px 10px', color: '#888', fontSize: 12 }}>
                        {p.notes || ''}
                      </td>
                      <td style={{ padding: '8px 10px' }}>
                        <button
                          onClick={() => deleteReceived(p)}
                          style={{
                            padding: '3px 8px',
                            background: '#ff000011',
                            color: RED,
                            border: '1px solid #ff000022',
                            borderRadius: 4,
                            cursor: 'pointer',
                            fontSize: 11,
                          }}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                    {p.split_group_id && expandedSplits.has(p.split_group_id) && (
                      <tr
                        style={{
                          background: '#e8f0fe',
                          borderBottom: '1px solid #f0f0f0',
                          borderLeft: '3px solid #3B82F6',
                        }}
                      >
                        <td colSpan={10} style={{ padding: '10px 14px' }}>
                          <div
                            style={{
                              fontSize: 12,
                              color: '#1e3a8a',
                              fontWeight: 600,
                              marginBottom: 6,
                            }}
                          >
                            All allocations from this check:
                          </div>
                          {!splitSiblings[p.split_group_id] ? (
                            <div style={{ fontSize: 12, color: '#888' }}>Loading…</div>
                          ) : splitSiblings[p.split_group_id].length === 0 ? (
                            <div style={{ fontSize: 12, color: '#888' }}>
                              No sibling allocations found.
                            </div>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              {splitSiblings[p.split_group_id].map((s) => {
                                const isThisRow = s.id === p.id;
                                return (
                                  <div
                                    key={s.id}
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: 10,
                                      padding: '5px 10px',
                                      borderRadius: 6,
                                      background: isThisRow ? '#dbeafe' : 'white',
                                      border: isThisRow ? '1px solid #93c5fd' : '1px solid #e5e7eb',
                                      fontSize: 12,
                                    }}
                                  >
                                    <span
                                      style={{ fontWeight: 700, color: '#1e3a8a', minWidth: 72 }}
                                    >
                                      {fmt(s.amount)}
                                    </span>
                                    <span style={{ color: '#555', flex: 1 }}>
                                      {s.job_customer || '—'}
                                      {s.project_address ? (
                                        <span style={{ color: '#888', marginLeft: 6 }}>
                                          · {s.project_address}
                                        </span>
                                      ) : null}
                                    </span>
                                    {isThisRow && (
                                      <span
                                        style={{
                                          fontSize: 10,
                                          padding: '1px 6px',
                                          borderRadius: 6,
                                          background: '#3B82F6',
                                          color: 'white',
                                          fontWeight: 'bold',
                                        }}
                                      >
                                        this job
                                      </span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* AP — Accounts Payable */}
      <div style={{ marginBottom: 24 }}>
        <div
          style={{
            fontWeight: 'bold',
            color: RED,
            fontSize: 13,
            marginBottom: 10,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          Accounts Payable (AP)
          <span style={{ fontSize: 12, fontWeight: 'normal', color: '#888' }}>({made.length})</span>
        </div>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 10 }}>
          {['Subcontractor', 'Materials', 'Permits', 'Other'].map((lbl) => (
            <span
              key={lbl}
              style={{
                fontSize: 10,
                padding: '2px 9px',
                borderRadius: 10,
                background: '#fff0f0',
                color: RED,
                fontWeight: 600,
                border: `1px solid ${RED}33`,
              }}
            >
              {lbl}
            </span>
          ))}
        </div>
        {made.length === 0 ? (
          <div style={{ color: '#aaa', fontSize: 13, padding: '12px 0' }}>
            No AP entries recorded yet.
          </div>
        ) : (
          <div style={{ overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#fff5f5' }}>
                  {[
                    'Date & Time',
                    'To',
                    'Dept Code',
                    'Check #',
                    'Category',
                    'Class',
                    'Cr/Dr',
                    'Amount',
                    'Recorded By',
                    'Notes',
                    '',
                  ].map((h) => (
                    <th
                      key={h}
                      style={{
                        padding: '8px 10px',
                        textAlign: 'left',
                        fontSize: 11,
                        color: '#888',
                        fontWeight: 'bold',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {made.map((p) => (
                  <tr
                    key={p.id}
                    style={{
                      borderBottom: '1px solid #f0f0f0',
                      background:
                        p.is_pass_through || p.payment_class === 'pass_through'
                          ? '#fffef0'
                          : 'white',
                    }}
                  >
                    <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                      {fmtDate(p.date_paid)}
                      {p.time_paid && (
                        <span style={{ color: '#888', marginLeft: 6, fontSize: 11 }}>
                          {p.time_paid}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '8px 10px' }}>{p.payee_name}</td>
                    <td
                      style={{
                        padding: '8px 10px',
                        fontSize: 10,
                        color: '#666',
                        fontFamily: 'monospace',
                      }}
                    >
                      {p.dept_code || '—'}
                    </td>
                    <td style={{ padding: '8px 10px', color: '#888' }}>{p.check_number || '—'}</td>
                    <td style={{ padding: '8px 10px' }}>
                      <CategoryBadge cat={p.category} />
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      {p.is_pass_through || p.payment_class === 'pass_through' ? (
                        p.paid_by === 'customer_direct' ? (
                          <span
                            style={{
                              fontSize: 10,
                              padding: '2px 6px',
                              borderRadius: 8,
                              background: '#f0fdf4',
                              color: '#166534',
                              fontWeight: 'bold',
                              border: '1px solid #86efac',
                            }}
                          >
                            Cust. Paid Direct
                          </span>
                        ) : (
                          <span
                            style={{
                              fontSize: 10,
                              padding: '2px 6px',
                              borderRadius: 8,
                              background: '#fffbeb',
                              color: '#92400e',
                              fontWeight: 'bold',
                              border: '1px solid #fbbf24',
                            }}
                          >
                            Pass-Thru
                          </span>
                        )
                      ) : (
                        <span
                          style={{
                            fontSize: 10,
                            padding: '2px 6px',
                            borderRadius: 8,
                            background: '#f0f4ff',
                            color: BLUE,
                            fontWeight: 'bold',
                          }}
                        >
                          Revenue
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      <CrDrBadge value={p.credit_debit} />
                    </td>
                    <td
                      style={{
                        padding: '8px 10px',
                        fontWeight: 'bold',
                        color: p.credit_debit === 'credit' ? GREEN : RED,
                      }}
                    >
                      {fmt(p.amount)}
                    </td>
                    <td style={{ padding: '8px 10px', color: '#888', fontSize: 11 }}>
                      {p.recorded_by || '—'}
                    </td>
                    <td style={{ padding: '8px 10px', color: '#888', fontSize: 12 }}>
                      {p.notes || ''}
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      <button
                        onClick={() => deleteMade(p)}
                        style={{
                          padding: '3px 8px',
                          background: '#ff000011',
                          color: RED,
                          border: '1px solid #ff000022',
                          borderRadius: 4,
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
        )}
      </div>

      {/* Job Cost Breakdown */}
      <div style={{ borderTop: '2px solid #eee', paddingTop: 16 }}>
        <button
          onClick={() => setShowBreakdown(!showBreakdown)}
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
            marginBottom: showBreakdown ? 16 : 0,
          }}
        >
          <span style={{ fontSize: 12 }}>{showBreakdown ? '▼' : '▶'}</span>
          Job Cost Breakdown
        </button>

        {showBreakdown && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {/* Contract Revenue Section */}
            <div
              style={{
                background: '#f8faff',
                border: '1px solid #c8d4e4',
                borderRadius: 8,
                padding: 16,
              }}
            >
              <div
                style={{
                  fontWeight: 'bold',
                  color: BLUE,
                  fontSize: 13,
                  marginBottom: 12,
                  borderBottom: '1px solid #dde8f5',
                  paddingBottom: 8,
                }}
              >
                Contract Revenue
              </div>
              <BreakdownRow label="Contract Value" value={fmt(job?.total_value || 0)} />
              <BreakdownRow
                label="Received from Customer"
                value={fmt(totalContractReceived)}
                color={GREEN}
              />
              <BreakdownRow
                label="Subcontractor / Material Costs"
                value={fmt(totalContractPaid)}
                color={RED}
              />
              <div style={{ borderTop: '1px solid #dde8f5', marginTop: 8, paddingTop: 8 }}>
                <BreakdownRow
                  label="Gross Margin"
                  value={fmt(grossMargin)}
                  color={grossMargin >= 0 ? GREEN : RED}
                  bold
                />
                {job?.total_value > 0 && (
                  <BreakdownRow
                    label="Margin %"
                    value={`${Math.round((grossMargin / (job.total_value || 1)) * 100)}%`}
                    color={grossMargin >= 0 ? GREEN : RED}
                  />
                )}
              </div>
            </div>

            {/* Pass-Through Section */}
            <div
              style={{
                background: '#fffef5',
                border: '1px solid #fbbf24',
                borderRadius: 8,
                padding: 16,
              }}
            >
              <div
                style={{
                  fontWeight: 'bold',
                  color: ORANGE,
                  fontSize: 13,
                  marginBottom: 4,
                  borderBottom: '1px solid #fde68a',
                  paddingBottom: 8,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                Pass-Through Costs
                <span
                  style={{
                    fontSize: 10,
                    background: '#fffbeb',
                    color: '#92400e',
                    border: '1px solid #fbbf24',
                    padding: '1px 6px',
                    borderRadius: 10,
                  }}
                >
                  NOT IN MARGIN
                </span>
              </div>
              <div style={{ fontSize: 11, color: '#92400e', marginBottom: 10 }}>
                Permits, engineers, architects, design professionals — not counted in revenue or
                margin
              </div>
              <BreakdownRow
                label="PB fronted on customer's behalf"
                value={fmt(totalPtPaid)}
                color={RED}
              />
              <BreakdownRow
                label="Reimbursed by Customer"
                value={fmt(totalPtReceived)}
                color={GREEN}
              />
              {totalPtDirectByCustomer > 0 && (
                <BreakdownRow
                  label="Customer paid vendor directly"
                  value={fmt(totalPtDirectByCustomer)}
                  color={'#166534'}
                />
              )}
              <div style={{ borderTop: '1px solid #fde68a', marginTop: 8, paddingTop: 8 }}>
                <BreakdownRow
                  label="Net Balance (PB still owed)"
                  value={fmt(ptBalance)}
                  color={ptBalance > 0 ? RED : GREEN}
                  bold
                />
              </div>
            </div>

            {/* Change Orders Section */}
            {changeOrders.length > 0 && (
              <div
                style={{
                  background: '#faf5ff',
                  border: '1px solid #e9d5ff',
                  borderRadius: 8,
                  padding: 16,
                }}
              >
                <div
                  style={{
                    fontWeight: 'bold',
                    color: PURPLE,
                    fontSize: 13,
                    marginBottom: 8,
                    borderBottom: '1px solid #e9d5ff',
                    paddingBottom: 8,
                  }}
                >
                  Change Orders ({changeOrders.length})
                </div>
                <BreakdownRow label="Total CO Value" value={fmt(totalCOValue)} color={PURPLE} />
                <BreakdownRow label="Paid CO Value" value={fmt(totalCOPaid)} color={PURPLE} />
                <BreakdownRow
                  label="Outstanding"
                  value={fmt(totalCOValue - totalCOPaid)}
                  color={totalCOValue - totalCOPaid > 0 ? RED : GREEN}
                  bold
                />
              </div>
            )}

            {/* Summary Row */}
            <div
              style={{
                gridColumn: 'span 2',
                background: '#f5f5f5',
                borderRadius: 8,
                padding: 12,
                display: 'flex',
                gap: 20,
                flexWrap: 'wrap',
              }}
            >
              <SummaryItem label="Total AR" value={fmt(summary.total_received)} color={GREEN} />
              <SummaryItem label="Total AP" value={fmt(summary.total_paid_out)} color={RED} />
              <SummaryItem
                label="Net Cash Position"
                value={fmt(summary.balance)}
                color={summary.balance >= 0 ? BLUE : RED}
              />
              <SummaryItem
                label="Gross Margin"
                value={fmt(grossMargin)}
                color={grossMargin >= 0 ? GREEN : RED}
              />
              {totalCOValue > 0 && (
                <SummaryItem label="Change Order Total" value={fmt(totalCOValue)} color={PURPLE} />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function InvoiceGroup({ label, invoices, color, onMark, onDelete, token, job }) {
  const statusColor = {
    draft: '#888',
    sent: '#3B82F6',
    pending_send: '#D97706',
    paid: '#2E7D32',
    void: '#C62828',
  };
  const [emailing, setEmailing] = useState(null);

  const emailInvoice = async (inv) => {
    if (!job?.customer_email) return showToast('No customer email on file', 'error');
    setEmailing(inv.id);
    const res = await fetch(`/api/invoices/${inv.id}/email`, {
      method: 'POST',
      headers: { 'x-auth-token': token, 'Content-Type': 'application/json' },
    });
    const d = await res.json();
    if (res.ok) {
      showToast(`Invoice emailed to ${job.customer_email}`);
      onMark(inv, 'sent');
    } else showToast(d.error || 'Failed to email invoice', 'error');
    setEmailing(null);
  };

  return (
    <div>
      {label && (
        <div style={{ fontSize: 12, fontWeight: 'bold', color, marginBottom: 6 }}>{label}</div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {invoices.map((inv) => (
          <div
            key={inv.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              background: 'white',
              border: `1px solid ${color}22`,
              borderRadius: 7,
              padding: '10px 14px',
              flexWrap: 'wrap',
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontFamily: 'monospace',
                fontWeight: 'bold',
                color,
                minWidth: 160,
              }}
            >
              {inv.invoice_number}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 80 }}>
              <span style={{ fontSize: 13, fontWeight: 'bold' }}>
                ${Number(inv.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </span>
              {inv.invoice_type === 'combined_invoice' &&
                inv.contract_amount > 0 &&
                inv.pass_through_amount > 0 && (
                  <span style={{ fontSize: 10, color: '#888', whiteSpace: 'nowrap' }}>
                    PB: $
                    {Number(inv.contract_amount).toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                    })}{' '}
                    · PT: $
                    {Number(inv.pass_through_amount).toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                    })}
                  </span>
                )}
            </div>
            {inv.invoice_type === 'combined_invoice' && (
              <span
                style={{
                  fontSize: 9,
                  padding: '2px 7px',
                  borderRadius: 10,
                  background: '#fff3e0',
                  color: '#E07B2A',
                  border: '1px solid #E07B2A44',
                  fontWeight: 'bold',
                }}
              >
                COMBINED
              </span>
            )}
            <div>
              <span
                style={{
                  fontSize: 10,
                  padding: '2px 8px',
                  borderRadius: 10,
                  background: (statusColor[inv.status] || '#888') + '22',
                  color: statusColor[inv.status] || '#888',
                  fontWeight: 'bold',
                  border:
                    inv.status === 'pending_send'
                      ? `1px solid ${statusColor.pending_send}55`
                      : 'none',
                }}
              >
                {inv.status === 'pending_send' ? 'PENDING SEND' : inv.status?.toUpperCase()}
              </span>
            </div>
            {inv.notes && (
              <div
                style={{
                  fontSize: 11,
                  color: '#888',
                  maxWidth: 200,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {inv.notes}
              </div>
            )}
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              <a
                href={`/api/invoices/${inv.id}/pdf?token=${encodeURIComponent(token || '')}`}
                target="_blank"
                rel="noreferrer"
                style={{
                  fontSize: 10,
                  padding: '3px 8px',
                  background: '#1B3A6B11',
                  color: '#1B3A6B',
                  border: '1px solid #1B3A6B22',
                  borderRadius: 4,
                  textDecoration: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                }}
              >
                View PDF
              </a>
              {job?.customer_email && inv.status !== 'void' && (
                <button
                  onClick={() => emailInvoice(inv)}
                  disabled={emailing === inv.id}
                  style={{
                    fontSize: 10,
                    padding: '3px 8px',
                    background: inv.status === 'pending_send' ? '#FEF3C7' : '#f0fdf411',
                    color: inv.status === 'pending_send' ? '#D97706' : '#0D9488',
                    border:
                      inv.status === 'pending_send' ? '1px solid #D9770644' : '1px solid #0D948822',
                    borderRadius: 4,
                    cursor: emailing === inv.id ? 'not-allowed' : 'pointer',
                    fontWeight: inv.status === 'pending_send' ? 600 : 400,
                    opacity: emailing === inv.id ? 0.7 : 1,
                  }}
                >
                  {emailing === inv.id
                    ? 'Sending...'
                    : inv.status === 'pending_send'
                      ? 'Retry Send'
                      : inv.status === 'sent'
                        ? 'Resend'
                        : 'Send'}
                </button>
              )}
              {inv.status === 'draft' && (
                <button
                  onClick={() => onMark(inv, 'sent')}
                  style={{
                    fontSize: 10,
                    padding: '3px 8px',
                    background: '#3B82F611',
                    color: '#3B82F6',
                    border: '1px solid #3B82F622',
                    borderRadius: 4,
                    cursor: 'pointer',
                  }}
                >
                  Mark Sent
                </button>
              )}
              {inv.status !== 'paid' && inv.status !== 'void' && (
                <button
                  onClick={() => onMark(inv, 'paid')}
                  style={{
                    fontSize: 10,
                    padding: '3px 8px',
                    background: '#2E7D3211',
                    color: '#2E7D32',
                    border: '1px solid #2E7D3222',
                    borderRadius: 4,
                    cursor: 'pointer',
                  }}
                >
                  Mark Paid
                </button>
              )}
              <button
                onClick={() => onDelete(inv)}
                style={{
                  fontSize: 10,
                  padding: '3px 8px',
                  background: '#ff000011',
                  color: '#C62828',
                  border: '1px solid #ff000022',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 3 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function SummaryCard({ label, value, color }) {
  return (
    <div
      style={{
        borderRadius: 8,
        padding: '12px 16px',
        background: color + '11',
        border: `1px solid ${color}33`,
      }}
    >
      <div style={{ fontSize: 10, color: '#888', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 'bold', color }}>{value}</div>
    </div>
  );
}

function SummaryItem({ label, value, color }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: '#888' }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 'bold', color }}>{value}</div>
    </div>
  );
}

function BreakdownRow({ label, value, color, bold }) {
  return (
    <div
      style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13 }}
    >
      <span style={{ color: '#555', fontWeight: bold ? 'bold' : 'normal' }}>{label}</span>
      <span style={{ fontWeight: bold ? 'bold' : '500', color: color || '#333' }}>{value}</span>
    </div>
  );
}

const TYPE_COLORS = { deposit: '#3B82F6', progress: ORANGE, final: GREEN, other: '#888' };
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

const CAT_COLORS = {
  subcontractor: PURPLE,
  material: ORANGE,
  permit: TEAL,
  other: '#888',
  engineer: '#0891b2',
  architect: '#6366f1',
  designer: '#ec4899',
};
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
