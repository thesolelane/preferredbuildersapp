import { useState, useEffect } from 'react';
import { showToast } from '../utils/toast';

const BLUE = '#1B3A6B';
const ORANGE = '#E07B2A';
const GREEN = '#2E7D32';
const TEAL = '#0D9488';
const RED = '#C62828';
const INDIGO = '#4F46E5';

const MA_TAX_RATE = 0.0625;
const ONLINE_FEE_PCT = 0.02;
const ONLINE_FEE_FLAT = 5.0;

const DEPARTMENTS = [
  'Demo',
  'Framing',
  'Roofing',
  'Siding',
  'Insulation',
  'Drywall',
  'Electrical',
  'Plumbing',
  'HVAC',
  'Flooring',
  'Tile',
  'Cabinets / Countertops',
  'Painting',
  'Permits',
  'General',
  'Other',
];

const EMPTY_ITEM = { type: 'material', description: '', amount: '' };

const fmt = (n) =>
  Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const inp = {
  width: '100%',
  padding: '7px 10px',
  border: '1.5px solid #C8D4E4',
  borderRadius: 6,
  fontSize: 13,
  boxSizing: 'border-box',
};

function computeTotals(depts) {
  let mat = 0;
  let lab = 0;
  for (const d of depts) {
    for (const it of d.items || []) {
      const a = parseFloat(it.amount) || 0;
      if (it.type === 'material') mat += a;
      else if (it.type === 'labor') lab += a;
    }
  }
  const tax = Math.round(mat * MA_TAX_RATE * 100) / 100;
  const total = Math.round((mat + tax + lab) * 100) / 100;
  return { mat, tax, lab, total };
}

export default function DirectInvoiceModal({ jobId, job, token, onClose, onSaved }) {
  const prefillName = job?.customer_name || '';
  const prefillEmail = job?.customer_email || '';
  const prefillPhone = job?.customer_phone || '';
  const prefillAddress =
    [job?.project_address, job?.project_city ? job.project_city + ', MA' : '']
      .filter(Boolean)
      .join(', ') || '';

  const [contacts, setContacts] = useState([]);
  const [contactSearch, setContactSearch] = useState('');
  const [showContactDropdown, setShowContactDropdown] = useState(false);
  const [linkedContactId, setLinkedContactId] = useState(null);

  const [toName, setToName] = useState(prefillName);
  const [toEmail, setToEmail] = useState(prefillEmail);
  const [toPhone, setToPhone] = useState(prefillPhone);
  const [toAddress, setToAddress] = useState(prefillAddress);
  const [notes, setNotes] = useState('');
  const [depts, setDepts] = useState([{ dept: '', items: [{ ...EMPTY_ITEM }] }]);
  const [saving, setSaving] = useState(false);
  const [sendMode, setSendMode] = useState(false);

  const headers = { 'x-auth-token': token, 'Content-Type': 'application/json' };

  useEffect(() => {
    fetch('/api/contacts', { headers: { 'x-auth-token': token } })
      .then((r) => r.json())
      .then((data) => setContacts(data.contacts || []));
  }, [token]);

  const filteredContacts = contacts.filter((c) => {
    if (!contactSearch.trim()) return true;
    const q = contactSearch.toLowerCase();
    return (
      (c.name || '').toLowerCase().includes(q) ||
      (c.email || '').toLowerCase().includes(q) ||
      (c.phone || '').toLowerCase().includes(q) ||
      (c.serial_number || '').toLowerCase().includes(q)
    );
  });

  const selectContact = (c) => {
    setLinkedContactId(c.id);
    setToName(c.name || '');
    setToEmail(c.email || '');
    setToPhone(c.phone || '');
    setToAddress(
      [c.address, c.city ? c.city + (c.state ? ', ' + c.state : '') : '']
        .filter(Boolean)
        .join(', '),
    );
    setContactSearch(c.name || c.serial_number || '');
    setShowContactDropdown(false);
  };

  const clearContact = () => {
    setLinkedContactId(null);
    setContactSearch('');
    setToName(prefillName);
    setToEmail(prefillEmail);
    setToPhone(prefillPhone);
    setToAddress(prefillAddress);
  };

  const { mat, tax, lab, total } = computeTotals(depts);
  const onlineFee = Math.round((total * ONLINE_FEE_PCT + ONLINE_FEE_FLAT) * 100) / 100;
  const onlineTotal = Math.round((total + onlineFee) * 100) / 100;

  const addDept = () => setDepts((p) => [...p, { dept: '', items: [{ ...EMPTY_ITEM }] }]);
  const removeDept = (di) => setDepts((p) => p.filter((_, i) => i !== di));
  const updateDeptName = (di, val) =>
    setDepts((p) => p.map((d, i) => (i === di ? { ...d, dept: val } : d)));
  const addItem = (di) =>
    setDepts((p) =>
      p.map((d, i) => (i === di ? { ...d, items: [...d.items, { ...EMPTY_ITEM }] } : d)),
    );
  const removeItem = (di, ii) =>
    setDepts((p) =>
      p.map((d, i) => (i === di ? { ...d, items: d.items.filter((_, j) => j !== ii) } : d)),
    );
  const updateItem = (di, ii, field, val) =>
    setDepts((p) =>
      p.map((d, i) =>
        i === di
          ? { ...d, items: d.items.map((it, j) => (j === ii ? { ...it, [field]: val } : it)) }
          : d,
      ),
    );

  const validate = () => {
    if (!toName && !toEmail) {
      showToast('Enter a recipient name or email', 'error');
      return false;
    }
    for (const d of depts) {
      if (!d.dept) {
        showToast('Every section needs a department name', 'error');
        return false;
      }
      for (const it of d.items) {
        if (!it.description.trim()) {
          showToast('All line items need a description', 'error');
          return false;
        }
        if (!parseFloat(it.amount) || parseFloat(it.amount) <= 0) {
          showToast('All line items need an amount greater than 0', 'error');
          return false;
        }
      }
    }
    if (depts.every((d) => !d.items.length)) {
      showToast('Add at least one line item', 'error');
      return false;
    }
    return true;
  };

  const submit = async (send) => {
    if (!validate()) return;
    setSaving(true);
    setSendMode(send);

    const payload = {
      job_id: jobId || null,
      contact_id: linkedContactId || null,
      to_name: toName || null,
      to_email: toEmail || null,
      to_phone: toPhone || null,
      to_address: toAddress || null,
      line_items: depts.map((d) => ({
        dept: d.dept,
        items: d.items.map((it) => ({
          type: it.type,
          description: it.description.trim(),
          amount: parseFloat(it.amount),
        })),
      })),
      notes: notes || null,
    };

    try {
      const createRes = await fetch('/api/direct-invoices', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      const createData = await createRes.json();
      if (!createRes.ok) {
        showToast(createData.error || 'Failed to create invoice', 'error');
        setSaving(false);
        return;
      }

      if (send) {
        if (!toEmail) {
          showToast('No email address — invoice saved as draft', 'warning');
        } else {
          const sendRes = await fetch(`/api/direct-invoices/${createData.invoice.id}/send`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ to_email: toEmail }),
          });
          const sendData = await sendRes.json();
          if (!sendRes.ok) {
            showToast(sendData.error || 'Invoice saved but email failed', 'error');
            onSaved && onSaved();
            onClose();
            setSaving(false);
            return;
          }
          showToast(`Invoice ${createData.invoice.invoice_number} sent to ${toEmail}`);
        }
      } else {
        showToast(`Invoice ${createData.invoice.invoice_number} saved as draft`);
      }

      onSaved && onSaved();
      onClose();
    } catch (err) {
      showToast('Unexpected error: ' + err.message, 'error');
    }
    setSaving(false);
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        overflowY: 'auto',
        padding: '24px 16px',
      }}
    >
      <div
        style={{
          background: 'white',
          borderRadius: 10,
          width: '100%',
          maxWidth: 760,
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        }}
      >
        {/* Header */}
        <div
          style={{
            background: BLUE,
            color: 'white',
            padding: '18px 24px',
            borderRadius: '10px 10px 0 0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>Create Customer Invoice</div>
            <div style={{ fontSize: 11, opacity: 0.75, marginTop: 2 }}>
              Preferred Builders General Services Inc.
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.15)',
              border: 'none',
              color: 'white',
              borderRadius: 6,
              padding: '5px 11px',
              cursor: 'pointer',
              fontSize: 16,
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ padding: 24 }}>
          {/* Contact Picker */}
          <div style={{ marginBottom: 20 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: '#888',
                textTransform: 'uppercase',
                letterSpacing: 1,
                marginBottom: 8,
              }}
            >
              Bill To
            </div>

            {/* Search existing contacts */}
            <div style={{ position: 'relative', marginBottom: 12 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div style={{ position: 'relative', flex: 1 }}>
                  <input
                    value={contactSearch}
                    onChange={(e) => {
                      setContactSearch(e.target.value);
                      setShowContactDropdown(true);
                      if (!e.target.value) clearContact();
                    }}
                    onFocus={() => setShowContactDropdown(true)}
                    onBlur={() => setTimeout(() => setShowContactDropdown(false), 180)}
                    placeholder="Search existing contacts by name, email, or PB-XXXX…"
                    style={{
                      ...inp,
                      background: linkedContactId ? '#f0f9ff' : 'white',
                      borderColor: linkedContactId ? '#3B82F6' : '#C8D4E4',
                    }}
                  />
                  {showContactDropdown && filteredContacts.length > 0 && (
                    <div
                      style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        right: 0,
                        background: 'white',
                        border: '1px solid #ddd',
                        borderRadius: 6,
                        boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                        zIndex: 200,
                        maxHeight: 220,
                        overflowY: 'auto',
                      }}
                    >
                      {filteredContacts.slice(0, 12).map((c) => (
                        <div
                          key={c.id}
                          onMouseDown={() => selectContact(c)}
                          style={{
                            padding: '9px 14px',
                            cursor: 'pointer',
                            borderBottom: '1px solid #f5f5f5',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = '#f0f4ff')}
                          onMouseLeave={(e) => (e.currentTarget.style.background = 'white')}
                        >
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: '#333' }}>
                              {c.name || '—'}
                            </div>
                            <div style={{ fontSize: 11, color: '#888' }}>
                              {[c.email, c.phone].filter(Boolean).join(' · ')}
                            </div>
                          </div>
                          <div style={{ fontSize: 10, color: '#aaa', fontFamily: 'monospace' }}>
                            {c.serial_number}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {linkedContactId && (
                  <button
                    onClick={clearContact}
                    title="Clear contact"
                    style={{
                      background: 'none',
                      border: '1px solid #ddd',
                      borderRadius: 6,
                      padding: '6px 10px',
                      cursor: 'pointer',
                      color: '#888',
                      fontSize: 13,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    ✕ Clear
                  </button>
                )}
              </div>
              {linkedContactId && (
                <div style={{ fontSize: 11, color: '#3B82F6', marginTop: 4, fontWeight: 600 }}>
                  Linked to existing contact — fields auto-filled below
                </div>
              )}
              {!linkedContactId && (
                <div style={{ fontSize: 11, color: '#aaa', marginTop: 4 }}>
                  Select an existing contact above, or fill in the fields below for a new contact.
                </div>
              )}
            </div>

            {/* Manual fields */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 3 }}>
                  Name *
                </label>
                <input
                  value={toName}
                  onChange={(e) => setToName(e.target.value)}
                  placeholder="Customer name"
                  style={inp}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 3 }}>
                  Email
                </label>
                <input
                  value={toEmail}
                  onChange={(e) => setToEmail(e.target.value)}
                  placeholder="customer@email.com"
                  style={inp}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 3 }}>
                  Phone
                </label>
                <input
                  value={toPhone}
                  onChange={(e) => setToPhone(e.target.value)}
                  placeholder="(978) 000-0000"
                  style={inp}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 3 }}>
                  Address
                </label>
                <input
                  value={toAddress}
                  onChange={(e) => setToAddress(e.target.value)}
                  placeholder="Street, City, State"
                  style={inp}
                />
              </div>
            </div>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid #eee', margin: '0 0 20px' }} />

          {/* Line Items */}
          <div style={{ marginBottom: 20 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 12,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: '#888',
                  textTransform: 'uppercase',
                  letterSpacing: 1,
                }}
              >
                Line Items
              </div>
              <button
                onClick={addDept}
                style={{
                  background: 'none',
                  border: `1px dashed ${BLUE}`,
                  color: BLUE,
                  borderRadius: 6,
                  padding: '4px 12px',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                + Add Department
              </button>
            </div>

            {depts.map((dept, di) => (
              <div
                key={di}
                style={{
                  border: '1px solid #e2e8f0',
                  borderRadius: 8,
                  marginBottom: 12,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    background: '#f0f4ff',
                    padding: '8px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    borderBottom: '1px solid #e2e8f0',
                  }}
                >
                  <select
                    value={dept.dept}
                    onChange={(e) => updateDeptName(di, e.target.value)}
                    style={{
                      ...inp,
                      width: 'auto',
                      flex: 1,
                      fontWeight: 600,
                      color: BLUE,
                      background: 'white',
                    }}
                  >
                    <option value="">— Select Department —</option>
                    {DEPARTMENTS.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                  {depts.length > 1 && (
                    <button
                      onClick={() => removeDept(di)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: RED,
                        cursor: 'pointer',
                        fontSize: 16,
                        padding: '2px 4px',
                      }}
                    >
                      ✕
                    </button>
                  )}
                </div>

                <div style={{ padding: '10px 12px' }}>
                  {dept.items.map((item, ii) => (
                    <div
                      key={ii}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '110px 1fr 110px 32px',
                        gap: 8,
                        marginBottom: 8,
                        alignItems: 'center',
                      }}
                    >
                      <select
                        value={item.type}
                        onChange={(e) => updateItem(di, ii, 'type', e.target.value)}
                        style={{
                          ...inp,
                          fontWeight: 600,
                          fontSize: 12,
                          background: item.type === 'material' ? '#fff3e0' : '#e8f5e9',
                          color: item.type === 'material' ? ORANGE : GREEN,
                          borderColor: item.type === 'material' ? '#fcd34d' : '#86efac',
                        }}
                      >
                        <option value="material">Material</option>
                        <option value="labor">Labor</option>
                      </select>
                      <input
                        value={item.description}
                        onChange={(e) => updateItem(di, ii, 'description', e.target.value)}
                        placeholder={
                          item.type === 'material'
                            ? 'e.g. Architectural shingles'
                            : 'e.g. Installation labor'
                        }
                        style={{ ...inp, fontSize: 12 }}
                      />
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.amount}
                        onChange={(e) => updateItem(di, ii, 'amount', e.target.value)}
                        placeholder="0.00"
                        style={{ ...inp, fontSize: 12, textAlign: 'right' }}
                      />
                      {dept.items.length > 1 ? (
                        <button
                          onClick={() => removeItem(di, ii)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#ccc',
                            cursor: 'pointer',
                            fontSize: 15,
                            padding: '2px 4px',
                          }}
                        >
                          ✕
                        </button>
                      ) : (
                        <div />
                      )}
                    </div>
                  ))}
                  <button
                    onClick={() => addItem(di)}
                    style={{
                      background: 'none',
                      border: `1px dashed ${TEAL}`,
                      color: TEAL,
                      borderRadius: 6,
                      padding: '4px 12px',
                      cursor: 'pointer',
                      fontSize: 11,
                      fontWeight: 600,
                      marginTop: 2,
                    }}
                  >
                    + Add Line
                  </button>
                </div>
              </div>
            ))}
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid #eee', margin: '0 0 20px' }} />

          {/* Totals */}
          <div
            style={{
              background: '#f8faff',
              border: '1px solid #dbeafe',
              borderRadius: 8,
              padding: '14px 18px',
              marginBottom: 20,
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: '#888',
                textTransform: 'uppercase',
                letterSpacing: 1,
                marginBottom: 10,
              }}
            >
              Invoice Totals
            </div>
            <TotalRow label="Materials Subtotal" value={`$${fmt(mat)}`} color={ORANGE} />
            <TotalRow label="MA Sales Tax (6.25%)" value={`$${fmt(tax)}`} color={ORANGE} dim />
            <TotalRow label="Labor Subtotal" value={`$${fmt(lab)}`} color={GREEN} />
            <div style={{ borderTop: '2px solid #1B3A6B', marginTop: 8, paddingTop: 8 }}>
              <TotalRow label="Invoice Total" value={`$${fmt(total)}`} color={BLUE} bold />
            </div>

            {total > 0 && (
              <div
                style={{
                  marginTop: 12,
                  padding: '10px 12px',
                  background: '#f0f4ff',
                  border: '1px solid #c7d2fe',
                  borderRadius: 6,
                  fontSize: 11,
                  color: '#555',
                }}
              >
                <div style={{ fontWeight: 700, color: BLUE, marginBottom: 6 }}>
                  Online Payments — Coming Soon
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span>Processing fee (2% + $5.00)</span>
                  <span style={{ fontWeight: 600 }}>${fmt(onlineFee)}</span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontWeight: 700,
                    color: BLUE,
                  }}
                >
                  <span>Total if paying online</span>
                  <span>${fmt(onlineTotal)}</span>
                </div>
                <div
                  style={{
                    marginTop: 8,
                    fontSize: 10,
                    color: '#666',
                    lineHeight: 1.5,
                    borderTop: '1px solid #dbeafe',
                    paddingTop: 8,
                  }}
                >
                  Customer must check a consent box before online payment can be processed. Zero
                  retention of card information after payment.
                </div>
              </div>
            )}
          </div>

          {/* Notes */}
          <div style={{ marginBottom: 24 }}>
            <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4 }}>
              Notes (optional — printed on invoice)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Payment instructions, project notes, etc."
              rows={3}
              style={{ ...inp, resize: 'vertical', fontFamily: 'inherit' }}
            />
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button
              onClick={onClose}
              style={{
                padding: '9px 18px',
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
            <button
              onClick={() => submit(false)}
              disabled={saving}
              style={{
                padding: '9px 18px',
                background: '#f0f4ff',
                color: BLUE,
                border: `1px solid ${BLUE}44`,
                borderRadius: 6,
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: 13,
              }}
            >
              {saving && !sendMode ? 'Saving...' : 'Save Draft'}
            </button>
            <button
              onClick={() => submit(true)}
              disabled={saving}
              style={{
                padding: '9px 20px',
                background: toEmail ? INDIGO : '#aaa',
                color: 'white',
                border: 'none',
                borderRadius: 6,
                cursor: toEmail ? 'pointer' : 'not-allowed',
                fontWeight: 700,
                fontSize: 13,
              }}
              title={!toEmail ? 'Enter an email address to send' : ''}
            >
              {saving && sendMode
                ? 'Sending...'
                : toEmail
                  ? `Send to ${toEmail}`
                  : 'Send (no email entered)'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TotalRow({ label, value, color, bold, dim }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        marginBottom: 5,
        fontSize: bold ? 15 : 13,
        opacity: dim ? 0.75 : 1,
      }}
    >
      <span style={{ color: '#555', fontWeight: bold ? 700 : 400 }}>{label}</span>
      <span style={{ fontWeight: bold ? 700 : 600, color: color || '#333' }}>{value}</span>
    </div>
  );
}
