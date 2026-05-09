import React from 'react';
import { showToast } from '../../utils/toast';
import { showConfirm } from '../../utils/confirm';
import { BLUE, GREEN, ORANGE } from './constants';

const PO_CATEGORIES = ['materials', 'subcontractor', 'equipment', 'permits', 'other'];
const PO_STATUSES = ['draft', 'issued', 'received', 'closed'];
const STATUS_COLORS_PO = {
  draft: '#888',
  issued: '#F59E0B',
  received: '#3B82F6',
  closed: '#2E7D32',
};
const STATUS_BG = {
  draft: '#f8fafc',
  issued: '#fffbeb',
  received: '#eff6ff',
  closed: '#f0fdf4',
};
const STATUS_LABEL = {
  draft: 'Draft',
  issued: 'Issued',
  received: 'Received',
  closed: 'Closed',
};

export default function JobPurchaseOrdersTab({
  pos,
  loadPOs,
  poLoading,
  newPO,
  setNewPO,
  savingPO,
  setSavingPO,
  editingPO,
  setEditingPO,
  id,
  headers,
}) {
  const totalSpend = pos
    .filter((p) => p.status !== 'closed')
    .reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const receivedAmt = pos
    .filter((p) => p.status === 'received')
    .reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const openAmt = pos
    .filter((p) => p.status === 'draft' || p.status === 'issued')
    .reduce((s, p) => s + (Number(p.amount) || 0), 0);

  const submitNewPO = async () => {
    if (!newPO.description.trim()) {
      showToast('Description is required', 'error');
      return;
    }
    if (!newPO.amount || Number(newPO.amount) <= 0) {
      showToast('Amount must be greater than 0', 'error');
      return;
    }
    setSavingPO(true);
    const res = await fetch('/api/purchase-orders', {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...newPO, job_id: id, amount: Number(newPO.amount) }),
    });
    const d = await res.json();
    setSavingPO(false);
    if (res.ok) {
      setNewPO({
        vendor_name: '',
        description: '',
        category: 'materials',
        amount: '',
        status: 'draft',
        notes: '',
      });
      loadPOs();
      showToast(`PO ${d.purchase_order.po_number} created`);
    } else {
      showToast(d.error || 'Failed to create PO', 'error');
    }
  };

  const updatePOStatus = async (poId, status) => {
    const res = await fetch(`/api/purchase-orders/${poId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      loadPOs();
      showToast('PO status updated');
    } else showToast('Failed to update', 'error');
  };

  const deletePO = async (poId, poNum) => {
    if (!(await showConfirm(`Delete ${poNum}? This cannot be undone.`))) return;
    const res = await fetch(`/api/purchase-orders/${poId}`, {
      method: 'DELETE',
      headers,
    });
    if (res.ok) {
      loadPOs();
      showToast('PO deleted');
    } else showToast('Failed to delete', 'error');
  };

  const saveEditPO = async () => {
    if (!editingPO) return;
    setSavingPO(true);
    const res = await fetch(`/api/purchase-orders/${editingPO.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ ...editingPO, amount: Number(editingPO.amount) }),
    });
    const d = await res.json();
    setSavingPO(false);
    if (res.ok) {
      setEditingPO(null);
      loadPOs();
      showToast('PO updated');
    } else showToast(d.error || 'Failed to update', 'error');
  };

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
        <h3 style={{ color: BLUE, margin: 0 }}>Purchase Orders</h3>
        <div style={{ display: 'flex', gap: 20, fontSize: 13 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: '#888' }}>Open</div>
            <div style={{ fontWeight: 700, color: ORANGE }}>${openAmt.toLocaleString()}</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: '#888' }}>Received</div>
            <div style={{ fontWeight: 700, color: GREEN }}>${receivedAmt.toLocaleString()}</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: '#888' }}>Total Spend</div>
            <div style={{ fontWeight: 700, color: BLUE }}>${totalSpend.toLocaleString()}</div>
          </div>
        </div>
      </div>

      {/* Create New PO form */}
      <div
        style={{
          background: '#f8faff',
          border: '1px solid #c7d7f4',
          borderRadius: 10,
          padding: 18,
          marginBottom: 24,
        }}
      >
        <div style={{ fontWeight: 700, color: BLUE, marginBottom: 14, fontSize: 14 }}>
          + New Purchase Order
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Vendor / Sub</div>
            <input
              value={newPO.vendor_name}
              onChange={(e) => setNewPO((p) => ({ ...p, vendor_name: e.target.value }))}
              placeholder="Vendor name (optional)"
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
          <div>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Category</div>
            <select
              value={newPO.category}
              onChange={(e) => setNewPO((p) => ({ ...p, category: e.target.value }))}
              style={{
                width: '100%',
                padding: '7px 10px',
                border: '1px solid #ddd',
                borderRadius: 6,
                fontSize: 13,
                background: 'white',
                boxSizing: 'border-box',
              }}
            >
              {PO_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c.charAt(0).toUpperCase() + c.slice(1)}
                </option>
              ))}
            </select>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Description *</div>
            <input
              value={newPO.description}
              onChange={(e) => setNewPO((p) => ({ ...p, description: e.target.value }))}
              placeholder="What is being purchased?"
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
          <div>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Amount ($) *</div>
            <input
              type="number"
              value={newPO.amount}
              onChange={(e) => setNewPO((p) => ({ ...p, amount: e.target.value }))}
              placeholder="0.00"
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
          <div>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Status</div>
            <select
              value={newPO.status}
              onChange={(e) => setNewPO((p) => ({ ...p, status: e.target.value }))}
              style={{
                width: '100%',
                padding: '7px 10px',
                border: '1px solid #ddd',
                borderRadius: 6,
                fontSize: 13,
                background: 'white',
                boxSizing: 'border-box',
              }}
            >
              {PO_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Notes</div>
            <input
              value={newPO.notes}
              onChange={(e) => setNewPO((p) => ({ ...p, notes: e.target.value }))}
              placeholder="Optional notes"
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
        </div>
        <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={submitNewPO}
            disabled={savingPO}
            style={{
              padding: '8px 20px',
              background: BLUE,
              color: 'white',
              border: 'none',
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 700,
              cursor: savingPO ? 'not-allowed' : 'pointer',
              opacity: savingPO ? 0.7 : 1,
            }}
          >
            {savingPO ? 'Saving...' : '+ Create PO'}
          </button>
        </div>
      </div>

      {/* PO List */}
      {poLoading ? (
        <div style={{ color: '#888', fontSize: 13, padding: '20px 0' }}>
          Loading purchase orders...
        </div>
      ) : pos.length === 0 ? (
        <div style={{ color: '#888', textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>📦</div>
          <div>No purchase orders yet.</div>
          <div style={{ fontSize: 12, color: '#aaa', marginTop: 6 }}>
            Create a PO above to track materials and subcontractor costs.
          </div>
        </div>
      ) : (
        pos.map((po) => (
          <div
            key={po.id}
            style={{
              background: STATUS_BG[po.status] || '#f8fafc',
              border: `1px solid ${STATUS_COLORS_PO[po.status] || '#ddd'}40`,
              borderRadius: 10,
              padding: 18,
              marginBottom: 14,
            }}
          >
            {editingPO?.id === po.id ? (
              /* Edit form */
              <div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 10,
                    marginBottom: 10,
                  }}
                >
                  <div>
                    <div style={{ fontSize: 11, color: '#888', marginBottom: 3 }}>Vendor</div>
                    <input
                      value={editingPO.vendor_name || ''}
                      onChange={(e) => setEditingPO((p) => ({ ...p, vendor_name: e.target.value }))}
                      style={{
                        width: '100%',
                        padding: '6px 9px',
                        border: '1px solid #ddd',
                        borderRadius: 5,
                        fontSize: 13,
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: '#888', marginBottom: 3 }}>Amount ($)</div>
                    <input
                      type="number"
                      value={editingPO.amount || ''}
                      onChange={(e) => setEditingPO((p) => ({ ...p, amount: e.target.value }))}
                      style={{
                        width: '100%',
                        padding: '6px 9px',
                        border: '1px solid #ddd',
                        borderRadius: 5,
                        fontSize: 13,
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <div style={{ fontSize: 11, color: '#888', marginBottom: 3 }}>Description</div>
                    <input
                      value={editingPO.description || ''}
                      onChange={(e) => setEditingPO((p) => ({ ...p, description: e.target.value }))}
                      style={{
                        width: '100%',
                        padding: '6px 9px',
                        border: '1px solid #ddd',
                        borderRadius: 5,
                        fontSize: 13,
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: '#888', marginBottom: 3 }}>Category</div>
                    <select
                      value={editingPO.category || 'materials'}
                      onChange={(e) => setEditingPO((p) => ({ ...p, category: e.target.value }))}
                      style={{
                        width: '100%',
                        padding: '6px 9px',
                        border: '1px solid #ddd',
                        borderRadius: 5,
                        fontSize: 13,
                        background: 'white',
                        boxSizing: 'border-box',
                      }}
                    >
                      {PO_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c.charAt(0).toUpperCase() + c.slice(1)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: '#888', marginBottom: 3 }}>Status</div>
                    <select
                      value={editingPO.status || 'draft'}
                      onChange={(e) => setEditingPO((p) => ({ ...p, status: e.target.value }))}
                      style={{
                        width: '100%',
                        padding: '6px 9px',
                        border: '1px solid #ddd',
                        borderRadius: 5,
                        fontSize: 13,
                        background: 'white',
                        boxSizing: 'border-box',
                      }}
                    >
                      {PO_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <div style={{ fontSize: 11, color: '#888', marginBottom: 3 }}>Notes</div>
                    <input
                      value={editingPO.notes || ''}
                      onChange={(e) => setEditingPO((p) => ({ ...p, notes: e.target.value }))}
                      style={{
                        width: '100%',
                        padding: '6px 9px',
                        border: '1px solid #ddd',
                        borderRadius: 5,
                        fontSize: 13,
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={saveEditPO}
                    disabled={savingPO}
                    style={{
                      padding: '6px 16px',
                      background: BLUE,
                      color: 'white',
                      border: 'none',
                      borderRadius: 5,
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {savingPO ? 'Saving...' : '💾 Save'}
                  </button>
                  <button
                    onClick={() => setEditingPO(null)}
                    style={{
                      padding: '6px 14px',
                      background: 'white',
                      border: '1px solid #ddd',
                      borderRadius: 5,
                      fontSize: 12,
                      color: '#666',
                      cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              /* View mode */
              <div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    gap: 12,
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontWeight: 700, color: BLUE, fontSize: 14 }}>
                        {po.po_number}
                      </span>
                      <span
                        style={{
                          fontSize: 11,
                          padding: '2px 8px',
                          borderRadius: 10,
                          background: STATUS_COLORS_PO[po.status] + '20',
                          color: STATUS_COLORS_PO[po.status],
                          fontWeight: 600,
                        }}
                      >
                        {STATUS_LABEL[po.status]}
                      </span>
                      <span style={{ fontSize: 11, color: '#888' }}>{po.category}</span>
                    </div>
                    <div style={{ fontSize: 13, color: '#333', marginBottom: 2 }}>
                      {po.description}
                    </div>
                    {po.vendor_name && (
                      <div style={{ fontSize: 12, color: '#666' }}>Vendor: {po.vendor_name}</div>
                    )}
                    {po.notes && (
                      <div
                        style={{ fontSize: 12, color: '#888', marginTop: 4, fontStyle: 'italic' }}
                      >
                        {po.notes}
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: '#aaa', marginTop: 6 }}>
                      Created {new Date(po.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color: BLUE }}>
                      ${Number(po.amount).toLocaleString()}
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        gap: 6,
                        marginTop: 8,
                        flexWrap: 'wrap',
                        justifyContent: 'flex-end',
                      }}
                    >
                      <select
                        value={po.status}
                        onChange={(e) => updatePOStatus(po.id, e.target.value)}
                        style={{
                          padding: '4px 8px',
                          border: '1px solid #ddd',
                          borderRadius: 5,
                          fontSize: 11,
                          background: 'white',
                          cursor: 'pointer',
                        }}
                      >
                        {PO_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {STATUS_LABEL[s]}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => setEditingPO({ ...po })}
                        style={{
                          padding: '4px 10px',
                          background: '#EEF3FB',
                          color: BLUE,
                          border: '1px solid #c7d7f4',
                          borderRadius: 5,
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        ✏️ Edit
                      </button>
                      <button
                        onClick={() => deletePO(po.id, po.po_number)}
                        style={{
                          padding: '4px 10px',
                          background: '#FEF2F2',
                          color: '#991b1b',
                          border: '1px solid #fca5a5',
                          borderRadius: 5,
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
