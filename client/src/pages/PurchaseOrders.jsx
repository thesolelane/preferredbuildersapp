import React, { useState, useEffect, useCallback } from 'react';
import { showToast } from '../utils/toast';

const BLUE = '#1B3A6B';
const ORANGE = '#E07B2A';
const GREEN = '#2E7D32';
const TEAL = '#0D9488';
const PURPLE = '#7C3AED';

const fmt = (n) =>
  `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const fmtDate = (d) => {
  if (!d) return '—';
  const date = new Date(d);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const PO_STATUSES = ['draft', 'issued', 'received', 'closed'];
const PO_CATEGORIES = ['materials', 'subcontractor', 'equipment', 'labor', 'other'];

const STATUS_COLORS = {
  draft: '#888',
  issued: ORANGE,
  received: TEAL,
  closed: GREEN,
};

const STATUS_LABELS = {
  draft: 'Draft',
  issued: 'Issued',
  received: 'Received',
  closed: 'Closed',
};

const NEXT_STATUS = {
  draft: 'issued',
  issued: 'received',
  received: 'closed',
  closed: null,
};

const NEXT_STATUS_LABEL = {
  draft: 'Mark Issued',
  issued: 'Mark Received',
  received: 'Mark Closed',
  closed: null,
};

const inputStyle = {
  width: '100%',
  padding: '8px 10px',
  border: '1.5px solid #C8D4E4',
  borderRadius: 6,
  fontSize: 13,
  boxSizing: 'border-box',
};

function StatusBadge({ status }) {
  const color = STATUS_COLORS[status] || '#888';
  return (
    <span
      style={{
        fontSize: 11,
        padding: '3px 9px',
        borderRadius: 12,
        background: color + '22',
        color,
        fontWeight: 'bold',
        whiteSpace: 'nowrap',
      }}
    >
      {STATUS_LABELS[status] || status}
    </span>
  );
}

function SummaryCard({ label, value, color, sub }) {
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
      {sub && <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function POForm({ jobs, onSave, onCancel, saving }) {
  const [form, setForm] = useState({
    job_id: '',
    vendor_name: '',
    description: '',
    category: 'materials',
    amount: '',
    status: 'draft',
    notes: '',
  });

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const submit = () => {
    if (!form.job_id) return showToast('Select a job', 'error');
    if (!form.vendor_name.trim()) return showToast('Enter a vendor name', 'error');
    if (!form.description.trim()) return showToast('Enter a description', 'error');
    onSave(form);
  };

  return (
    <div
      style={{
        background: 'white',
        borderRadius: 10,
        padding: 20,
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        marginBottom: 20,
        borderTop: `3px solid ${BLUE}`,
      }}
    >
      <h3 style={{ color: BLUE, margin: '0 0 16px', fontSize: 14 }}>New Purchase Order</h3>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: 12,
          marginBottom: 12,
        }}
      >
        <div>
          <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4 }}>
            Job *
          </label>
          <select
            value={form.job_id}
            onChange={(e) => set('job_id', e.target.value)}
            style={inputStyle}
          >
            <option value="">Select a job...</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.project_address || j.customer_name || j.id.slice(0, 8)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4 }}>
            Vendor / Supplier *
          </label>
          <input
            value={form.vendor_name}
            onChange={(e) => set('vendor_name', e.target.value)}
            placeholder="Vendor name"
            style={inputStyle}
          />
        </div>
        <div>
          <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4 }}>
            Category
          </label>
          <select
            value={form.category}
            onChange={(e) => set('category', e.target.value)}
            style={inputStyle}
          >
            {PO_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c.charAt(0).toUpperCase() + c.slice(1)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4 }}>
            Amount ($)
          </label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={form.amount}
            onChange={(e) => set('amount', e.target.value)}
            placeholder="0.00"
            style={inputStyle}
          />
        </div>
        <div>
          <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4 }}>
            Initial Status
          </label>
          <select
            value={form.status}
            onChange={(e) => set('status', e.target.value)}
            style={inputStyle}
          >
            {PO_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4 }}>
          Description *
        </label>
        <input
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
          placeholder="What is being ordered?"
          style={inputStyle}
        />
      </div>
      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4 }}>
          Notes
        </label>
        <textarea
          value={form.notes}
          onChange={(e) => set('notes', e.target.value)}
          rows={2}
          placeholder="Optional notes..."
          style={{ ...inputStyle, resize: 'vertical' }}
        />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={submit}
          disabled={saving}
          style={{
            padding: '9px 20px',
            background: BLUE,
            color: 'white',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
            fontWeight: 'bold',
            fontSize: 13,
          }}
        >
          {saving ? 'Saving...' : 'Create PO'}
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

function PODetailRow({ po, token, onAttachUploaded }) {
  const [uploading, setUploading] = useState(false);

  const handleAttach = async (file) => {
    if (!file) return;
    setUploading(true);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await fetch(`/api/purchase-orders/${po.id}/attachment`, {
        method: 'POST',
        headers: { 'x-auth-token': token },
        body: fd,
      });
      const data = await res.json();
      if (res.ok) {
        showToast('Attachment saved');
        onAttachUploaded(data.purchase_order);
      } else {
        showToast(data.error || 'Upload failed', 'error');
      }
    } catch {
      showToast('Upload failed', 'error');
    }
    setUploading(false);
  };

  return (
    <tr>
      <td
        colSpan={8}
        style={{
          padding: '12px 20px 16px 40px',
          background: '#f8faff',
          borderBottom: '1px solid #e8edf5',
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: 12,
            fontSize: 12,
          }}
        >
          <div>
            <div style={{ color: '#888', marginBottom: 3 }}>Vendor</div>
            <div style={{ fontWeight: 600 }}>{po.vendor_company || po.vendor_name || '—'}</div>
          </div>
          <div>
            <div style={{ color: '#888', marginBottom: 3 }}>Category</div>
            <div style={{ textTransform: 'capitalize' }}>{po.category || '—'}</div>
          </div>
          <div>
            <div style={{ color: '#888', marginBottom: 3 }}>Description</div>
            <div>{po.description || '—'}</div>
          </div>
          {po.notes && (
            <div>
              <div style={{ color: '#888', marginBottom: 3 }}>Notes</div>
              <div style={{ color: '#555' }}>{po.notes}</div>
            </div>
          )}
          <div>
            <div style={{ color: '#888', marginBottom: 3 }}>Created</div>
            <div>{fmtDate(po.created_at)}</div>
          </div>
          {po.issued_at && (
            <div>
              <div style={{ color: '#888', marginBottom: 3 }}>Issued</div>
              <div>{fmtDate(po.issued_at)}</div>
            </div>
          )}
          {po.received_at && (
            <div>
              <div style={{ color: '#888', marginBottom: 3 }}>Received</div>
              <div>{fmtDate(po.received_at)}</div>
            </div>
          )}
          {po.closed_at && (
            <div>
              <div style={{ color: '#888', marginBottom: 3 }}>Closed</div>
              <div>{fmtDate(po.closed_at)}</div>
            </div>
          )}
          <div
            style={{
              gridColumn: '1 / -1',
              borderTop: '1px solid #e0e8f5',
              paddingTop: 10,
              marginTop: 4,
            }}
          >
            <div style={{ color: '#888', marginBottom: 6 }}>Attachment</div>
            {po.attachment_path ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <a
                  href={po.attachment_path}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: BLUE, fontWeight: 600, fontSize: 12, textDecoration: 'none' }}
                >
                  📎 {po.attachment_name || 'View attachment'}
                </a>
                <label style={{ cursor: uploading ? 'not-allowed' : 'pointer' }}>
                  <input
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg,.heic,.webp,.doc,.docx,.xlsx,.csv"
                    style={{ display: 'none' }}
                    disabled={uploading}
                    onChange={(e) => handleAttach(e.target.files[0])}
                  />
                  <span
                    style={{
                      fontSize: 11,
                      color: '#888',
                      textDecoration: 'underline',
                      cursor: 'pointer',
                    }}
                  >
                    {uploading ? 'Uploading...' : 'Replace'}
                  </span>
                </label>
              </div>
            ) : (
              <label style={{ cursor: uploading ? 'not-allowed' : 'pointer' }}>
                <input
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.heic,.webp,.doc,.docx,.xlsx,.csv"
                  style={{ display: 'none' }}
                  disabled={uploading}
                  onChange={(e) => handleAttach(e.target.files[0])}
                />
                <span
                  style={{
                    display: 'inline-block',
                    padding: '6px 12px',
                    background: 'white',
                    border: '1.5px dashed #C8D4E4',
                    borderRadius: 6,
                    fontSize: 11,
                    color: '#888',
                    cursor: 'pointer',
                  }}
                >
                  {uploading ? 'Uploading...' : '📎 Attach invoice or document'}
                </span>
              </label>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}

export default function PurchaseOrders({ token }) {
  const [pos, setPOs] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [updatingId, setUpdatingId] = useState(null);

  const [filterStatus, setFilterStatus] = useState('');
  const [filterJob, setFilterJob] = useState('');
  const [sortKey, setSortKey] = useState('created_at');
  const [sortDir, setSortDir] = useState('desc');

  const headers = { 'x-auth-token': token, 'Content-Type': 'application/json' };

  const loadJobs = useCallback(() => {
    fetch('/api/jobs', { headers: { 'x-auth-token': token } })
      .then((r) => r.json())
      .then((d) => setJobs((d.jobs || []).filter((j) => !j.archived)))
      .catch(() => {});
  }, [token]);

  const loadPOs = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterStatus) params.set('status', filterStatus);
    if (filterJob) params.set('job_id', filterJob);
    fetch(`/api/purchase-orders?${params}`, { headers: { 'x-auth-token': token } })
      .then((r) => r.json())
      .then((d) => {
        setPOs(d.purchase_orders || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [token, filterStatus, filterJob]);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  useEffect(() => {
    loadPOs();
  }, [loadPOs]);

  const createPO = async (form) => {
    setSaving(true);
    const res = await fetch('/api/purchase-orders', {
      method: 'POST',
      headers,
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (res.ok) {
      setShowForm(false);
      loadPOs();
      showToast(`PO ${data.purchase_order.po_number} created`);
    } else {
      showToast(data.error || 'Failed to create PO', 'error');
    }
    setSaving(false);
  };

  const advanceStatus = async (po) => {
    const next = NEXT_STATUS[po.status];
    if (!next) return;
    setUpdatingId(po.id);
    const res = await fetch(`/api/purchase-orders/${po.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status: next }),
    });
    const data = await res.json();
    if (res.ok) {
      showToast(`${po.po_number} marked as ${STATUS_LABELS[next]}`);
      if (filterStatus && filterStatus !== 'open') {
        loadPOs();
      } else {
        setPOs((prev) => prev.map((p) => (p.id === po.id ? data.purchase_order : p)));
      }
    } else {
      showToast(data.error || 'Failed to update status', 'error');
    }
    setUpdatingId(null);
  };

  const toggleExpand = (id) => setExpandedId((prev) => (prev === id ? null : id));

  const sorted = [...pos].sort((a, b) => {
    let av = a[sortKey];
    let bv = b[sortKey];
    if (sortKey === 'amount') {
      av = Number(av) || 0;
      bv = Number(bv) || 0;
    } else {
      av = av || '';
      bv = bv || '';
    }
    if (av < bv) return sortDir === 'asc' ? -1 : 1;
    if (av > bv) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  const handleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const SortIcon = ({ k }) => {
    if (sortKey !== k) return <span style={{ color: '#ccc', marginLeft: 3 }}>↕</span>;
    return <span style={{ color: BLUE, marginLeft: 3 }}>{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  const openCount = pos.filter((p) => p.status !== 'closed').length;
  const committedSpend = pos
    .filter((p) => p.status !== 'closed')
    .reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const closedSpend = pos
    .filter((p) => p.status === 'closed')
    .reduce((s, p) => s + (Number(p.amount) || 0), 0);

  const jobLabel = (po) => {
    if (po.project_address) return po.project_address;
    if (po.customer_name) return po.customer_name;
    if (po.pb_number) return `#${po.pb_number}`;
    return po.job_id?.slice(0, 8) || '—';
  };

  return (
    <div style={{ padding: 32, maxWidth: 1200 }}>
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
            Purchase Orders
          </h1>
          <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
            All POs across all jobs — create, track, and update status in one place
          </div>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          style={{
            padding: '9px 18px',
            background: BLUE,
            color: 'white',
            border: 'none',
            borderRadius: 8,
            cursor: 'pointer',
            fontWeight: 'bold',
            fontSize: 13,
          }}
        >
          {showForm ? 'Cancel' : '+ New PO'}
        </button>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 16,
          marginBottom: 24,
        }}
      >
        <SummaryCard label="Open POs" value={openCount} color={ORANGE} sub="Not yet closed" />
        <SummaryCard
          label="Committed Spend"
          value={fmt(committedSpend)}
          color={PURPLE}
          sub="All open (non-closed)"
        />
        <SummaryCard label="Closed Spend" value={fmt(closedSpend)} color={GREEN} sub="Closed POs" />
      </div>

      {showForm && (
        <POForm jobs={jobs} onSave={createPO} onCancel={() => setShowForm(false)} saving={saving} />
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
            Filter by Status
          </label>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            style={{ ...inputStyle, minWidth: 160, width: 'auto' }}
          >
            <option value="">All Statuses</option>
            <option value="open">Open (non-closed)</option>
            {PO_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4 }}>
            Filter by Job
          </label>
          <select
            value={filterJob}
            onChange={(e) => setFilterJob(e.target.value)}
            style={{ ...inputStyle, minWidth: 200, width: 'auto' }}
          >
            <option value="">All Jobs</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.project_address || j.customer_name || j.id.slice(0, 8)}
              </option>
            ))}
          </select>
        </div>
        {(filterStatus || filterJob) && (
          <button
            onClick={() => {
              setFilterStatus('');
              setFilterJob('');
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

      {loading ? (
        <div style={{ color: '#888', textAlign: 'center', padding: 60 }}>Loading...</div>
      ) : sorted.length === 0 ? (
        <div
          style={{
            background: 'white',
            borderRadius: 10,
            padding: 60,
            textAlign: 'center',
            boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
          }}
        >
          <div style={{ fontSize: 40, marginBottom: 12 }}>📦</div>
          <div style={{ color: '#888', fontSize: 14 }}>
            {filterStatus || filterJob
              ? 'No POs match the current filters.'
              : 'No purchase orders yet. Click "+ New PO" to create one.'}
          </div>
        </div>
      ) : (
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
                <th style={thStyle}>PO Number</th>
                <th style={thStyle}>Vendor</th>
                <th style={thStyle}>Job</th>
                <th style={{ ...thStyle, cursor: 'pointer' }} onClick={() => handleSort('amount')}>
                  Amount <SortIcon k="amount" />
                </th>
                <th style={thStyle}>Status</th>
                <th
                  style={{ ...thStyle, cursor: 'pointer' }}
                  onClick={() => handleSort('created_at')}
                >
                  Date <SortIcon k="created_at" />
                </th>
                <th style={thStyle}>Action</th>
                <th style={{ width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {sorted.map((po) => (
                <React.Fragment key={po.id}>
                  <tr
                    style={{
                      borderBottom: expandedId === po.id ? 'none' : '1px solid #f0f0f0',
                      background: expandedId === po.id ? '#f8faff' : 'transparent',
                      cursor: 'pointer',
                    }}
                    onClick={() => toggleExpand(po.id)}
                  >
                    <td style={tdStyle}>
                      <span style={{ fontWeight: 600, color: BLUE, fontFamily: 'monospace' }}>
                        {po.po_number}
                      </span>
                    </td>
                    <td style={tdStyle}>{po.vendor_company || po.vendor_name || '—'}</td>
                    <td style={{ ...tdStyle, fontSize: 12, color: '#555' }}>{jobLabel(po)}</td>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{fmt(po.amount)}</td>
                    <td style={tdStyle}>
                      <StatusBadge status={po.status} />
                    </td>
                    <td style={{ ...tdStyle, color: '#888', fontSize: 12 }}>
                      {fmtDate(po.created_at)}
                    </td>
                    <td style={tdStyle} onClick={(e) => e.stopPropagation()}>
                      {NEXT_STATUS[po.status] && (
                        <button
                          onClick={() => advanceStatus(po)}
                          disabled={updatingId === po.id}
                          style={{
                            padding: '4px 10px',
                            background: STATUS_COLORS[NEXT_STATUS[po.status]] + '18',
                            color: STATUS_COLORS[NEXT_STATUS[po.status]],
                            border: `1px solid ${STATUS_COLORS[NEXT_STATUS[po.status]]}44`,
                            borderRadius: 5,
                            cursor: 'pointer',
                            fontSize: 11,
                            fontWeight: 600,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {updatingId === po.id ? '...' : NEXT_STATUS_LABEL[po.status]}
                        </button>
                      )}
                    </td>
                    <td style={{ ...tdStyle, color: '#aaa', textAlign: 'center' }}>
                      {expandedId === po.id ? '▲' : '▼'}
                    </td>
                  </tr>
                  {expandedId === po.id && (
                    <PODetailRow
                      po={po}
                      token={token}
                      onAttachUploaded={(updated) =>
                        setPOs((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
                      }
                    />
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ fontSize: 11, color: '#bbb', marginTop: 12, textAlign: 'right' }}>
        {sorted.length} purchase order{sorted.length !== 1 ? 's' : ''} shown
      </div>
    </div>
  );
}

const thStyle = {
  padding: '10px 12px',
  textAlign: 'left',
  fontSize: 11,
  color: '#888',
  fontWeight: 'bold',
  textTransform: 'uppercase',
  letterSpacing: '.4px',
  whiteSpace: 'nowrap',
};

const tdStyle = {
  padding: '11px 12px',
  color: '#333',
  verticalAlign: 'middle',
};
