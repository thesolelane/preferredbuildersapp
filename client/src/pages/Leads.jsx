// client/src/pages/Leads.jsx
import { useState, useEffect, useCallback, useRef } from 'react';
import { showToast } from '../utils/toast';
import { showConfirm } from '../utils/confirm';
import CreateQuoteWizard from '../components/CreateQuoteWizard';
import { getStatusStyle } from '../utils/statusUtils';

const BLUE = '#1B3A6B';
const ORANGE = '#E07B2A';
const GREEN = '#2e7d32';
const RED = '#c62828';
const GREY = '#64748b';

const STAGES = [
  { key: 'incoming', label: 'Incoming', color: '#7B8EA0', bg: '#eef1f5' },
  { key: 'callback_done', label: 'Callback Done', color: '#5C6BC0', bg: '#e8eaf6' },
  { key: 'appointment_booked', label: 'Appointment Booked', color: '#0288D1', bg: '#e1f5fe' },
  { key: 'site_visit_complete', label: 'Site Visit Complete', color: '#00838F', bg: '#e0f7fa' },
  { key: 'quote_draft', label: 'Proposal Draft', color: '#F57C00', bg: '#fff3e0' },
  { key: 'quote_sent', label: 'Proposal Sent', color: '#558B2F', bg: '#f1f8e9' },
  { key: 'follow_up_1', label: 'Follow-up 1', color: '#7B1FA2', bg: '#f3e5f5' },
  { key: 'follow_up_2', label: 'Follow-up 2', color: '#AD1457', bg: '#fce4ec' },
  { key: 'signed', label: 'Signed ✓', color: GREEN, bg: '#e8f5e9' },
  { key: 'rejected', label: 'Rejected', color: RED, bg: '#ffebee' },
];
const STAGE_MAP = Object.fromEntries(STAGES.map((s) => [s.key, s]));

const NEXT_STAGE = {
  incoming: 'callback_done',
  callback_done: 'appointment_booked',
  appointment_booked: 'site_visit_complete',
  site_visit_complete: 'quote_draft',
  quote_draft: 'quote_sent',
  quote_sent: 'follow_up_1',
  follow_up_1: 'follow_up_2',
  follow_up_2: 'signed',
};

const SOURCE_LABELS = {
  marblism: '📱 Marblism',
  referral: '🤝 Referral',
  web: '🌐 Web',
  'walk-in': '🚶 Walk-in',
  other: 'Other',
};

const JOB_TYPE_LABELS = {
  residential: 'Residential',
  commercial: 'Commercial',
  new_construction: 'New Construction',
  renovation: 'Renovation',
};

const ARCHIVE_REASONS = [
  { value: 'price', label: 'Price — too expensive' },
  { value: 'timing', label: 'Timing — not ready yet' },
  { value: 'no_response', label: 'No response (×3)' },
  { value: 'other', label: 'Other' },
];

// ── local date/time string for datetime-local input ──────────────────────────
function toLocalDTInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtDateTime(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// ── Styles ────────────────────────────────────────────────────────────────────
const inputStyle = {
  border: '1px solid #dde3ed',
  borderRadius: 6,
  padding: '8px 11px',
  fontSize: 13,
  color: '#333',
  outline: 'none',
  width: '100%',
  fontFamily: 'inherit',
  background: 'white',
  boxSizing: 'border-box',
};
const btnPrimary = (bg = BLUE) => ({
  background: bg,
  color: 'white',
  border: 'none',
  borderRadius: 6,
  padding: '8px 16px',
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: 13,
});
const btnSecondary = {
  background: '#f1f5f9',
  color: '#334155',
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  padding: '7px 14px',
  cursor: 'pointer',
  fontSize: 12,
};
const overlayStyle = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.45)',
  zIndex: 2000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};
const modalStyle = {
  background: 'white',
  borderRadius: 12,
  padding: 24,
  width: '100%',
  maxWidth: 480,
  boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
  maxHeight: '90vh',
  overflowY: 'auto',
};

// ── Appointment modal ─────────────────────────────────────────────────────────
function AppointmentModal({ lead, onConfirm, onClose }) {
  const [apptAt, setApptAt] = useState(toLocalDTInput(lead.appointment_at) || '');
  const [address, setAddress] = useState(lead.job_address || '');
  const [city, setCity] = useState(lead.job_city || '');
  const [email, setEmail] = useState(lead.job_email || '');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!apptAt) return showToast('Please pick a date and time', 'error');
    setSaving(true);
    await onConfirm({
      appointment_at: new Date(apptAt).toISOString(),
      job_address: address,
      job_city: city,
      job_email: email,
    });
    setSaving(false);
  };

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontWeight: 700, color: BLUE, fontSize: 16, marginBottom: 16 }}>
          📅 Book Appointment
        </div>
        <div style={{ color: '#555', fontSize: 13, marginBottom: 16 }}>
          Scheduling appointment with <strong>{lead.caller_name}</strong> ({lead.caller_phone})
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={labelStyle}>Date & Time *</label>
            <input
              type="datetime-local"
              value={apptAt}
              onChange={(e) => setApptAt(e.target.value)}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Job Site Address</label>
            <input
              placeholder="123 Main St"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              style={inputStyle}
            />
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 2 }}>
              <label style={labelStyle}>City</label>
              <input
                placeholder="Worcester"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>State</label>
              <input
                value="MA"
                disabled
                style={{ ...inputStyle, background: '#f8f8f8', color: '#999' }}
              />
            </div>
          </div>
          <div>
            <label style={labelStyle}>Customer Email</label>
            <input
              type="email"
              placeholder="customer@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={inputStyle}
            />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
          <button onClick={onClose} style={btnSecondary}>
            Cancel
          </button>
          <button onClick={submit} disabled={saving} style={btnPrimary('#0288D1')}>
            {saving ? 'Saving…' : '📅 Confirm Appointment'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Edit lead modal ───────────────────────────────────────────────────────────
function EditLeadModal({ lead, onConfirm, onClose }) {
  const [form, setForm] = useState({
    caller_name: lead.caller_name || '',
    caller_phone: lead.caller_phone || '',
    job_address: lead.job_address || '',
    job_city: lead.job_city || '',
    job_email: lead.job_email || '',
  });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    if (!form.caller_name.trim()) return showToast('Name is required', 'error');
    setSaving(true);
    await onConfirm(form);
    setSaving(false);
  };

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontWeight: 700, color: BLUE, fontSize: 16, marginBottom: 16 }}>
          ✏️ Edit Lead
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[
            { label: 'Name *', key: 'caller_name', placeholder: 'John Smith' },
            { label: 'Phone', key: 'caller_phone', placeholder: '+1 555 000 0000' },
            { label: 'Email', key: 'job_email', placeholder: 'customer@email.com', type: 'email' },
            { label: 'Job Address', key: 'job_address', placeholder: '123 Main St' },
            { label: 'City', key: 'job_city', placeholder: 'Worcester' },
          ].map((f) => (
            <div key={f.key}>
              <label style={labelStyle}>{f.label}</label>
              <input
                type={f.type || 'text'}
                value={form[f.key]}
                onChange={set(f.key)}
                placeholder={f.placeholder}
                style={inputStyle}
              />
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
          <button onClick={onClose} style={btnSecondary}>
            Cancel
          </button>
          <button onClick={submit} disabled={saving} style={btnPrimary()}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Archive modal ─────────────────────────────────────────────────────────────
function ArchiveModal({ lead, onConfirm, onClose }) {
  const [reason, setReason] = useState('price');
  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={{ ...modalStyle, maxWidth: 380 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontWeight: 700, color: RED, fontSize: 15, marginBottom: 12 }}>
          Archive Lead
        </div>
        <div style={{ color: '#444', fontSize: 13, marginBottom: 14 }}>
          Archiving <strong>{lead.caller_name}</strong>. Select a reason:
        </div>
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          style={{ ...inputStyle, marginBottom: 18 }}
        >
          {ARCHIVE_REASONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={btnSecondary}>
            Cancel
          </button>
          <button onClick={() => onConfirm(reason)} style={btnPrimary(RED)}>
            Archive
          </button>
        </div>
      </div>
    </div>
  );
}

const labelStyle = {
  fontSize: 11,
  color: '#888',
  display: 'block',
  marginBottom: 4,
  fontWeight: 600,
};

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Leads({ token }) {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newForm, setNewForm] = useState({
    caller_name: '',
    caller_phone: '',
    source: 'other',
    notes: '',
  });
  const [savingNew, setSavingNew] = useState(false);

  // Active modal state
  const [apptModal, setApptModal] = useState(null); // lead
  const [archiveModal, setArchiveModal] = useState(null); // lead
  const [editModal, setEditModal] = useState(null); // lead
  const [wizardLead, setWizardLead] = useState(null); // lead to open wizard for

  const headers = { 'x-auth-token': token, 'Content-Type': 'application/json' };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/leads?archived=${showArchived ? 1 : 0}`, {
        headers: { 'x-auth-token': token },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || `Failed to load leads (${res.status})`, 'error');
        setLoading(false);
        return;
      }
      const data = await res.json();
      setLeads(data.leads || []);
    } catch (_e) {
      showToast('Failed to load leads — check connection', 'error');
    }
    setLoading(false);
  }, [showArchived, token]);

  useEffect(() => {
    load();
  }, [load]);

  const patchLead = async (id, body) => {
    const res = await fetch(`/api/leads/${id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to update lead');
    }
    return res.json();
  };

  const updateLead = (updated) =>
    setLeads((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));

  // ── Appointment booking ───────────────────────────────────────────────────
  const confirmAppointment = async (fields) => {
    try {
      const data = await patchLead(apptModal.id, { stage: 'appointment_booked', ...fields });
      updateLead(data.lead);
      showToast(`Appointment booked — task & calendar link created`, 'success');
      setApptModal(null);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // ── Generic advance (all other stages) ───────────────────────────────────
  const advanceStage = async (lead) => {
    const next = NEXT_STAGE[lead.stage];
    if (!next) return;
    if (next === 'appointment_booked') {
      setApptModal(lead);
      return;
    }
    if (next === 'quote_draft') {
      try {
        const data = await patchLead(lead.id, { stage: 'quote_draft' });
        updateLead(data.lead);
        showToast('Proposal draft started — task created', 'success');
        setWizardLead(data.lead);
      } catch (err) {
        showToast(err.message, 'error');
      }
      return;
    }
    try {
      const data = await patchLead(lead.id, { stage: next });
      updateLead(data.lead);
      const stg = STAGE_MAP[next];
      showToast(`${lead.caller_name} moved to ${stg?.label || next}`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const confirmEdit = async (fields) => {
    try {
      const data = await patchLead(editModal.id, fields);
      updateLead(data.lead);
      showToast('Lead updated');
      setEditModal(null);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const confirmArchive = async (reason) => {
    try {
      const data = await patchLead(archiveModal.id, { stage: 'rejected', archive_reason: reason });
      setLeads((prev) =>
        showArchived
          ? prev.map((l) => (l.id === archiveModal.id ? data.lead : l))
          : prev.filter((l) => l.id !== archiveModal.id),
      );
      showToast('Lead archived', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
    setArchiveModal(null);
  };

  const deleteLead = async (lead) => {
    const ok = await showConfirm(`Delete lead for ${lead.caller_name}? This cannot be undone.`);
    if (!ok) return;
    try {
      const res = await fetch(`/api/leads/${lead.id}`, { method: 'DELETE', headers });
      if (!res.ok) throw new Error('Delete failed');
      setLeads((prev) => prev.filter((l) => l.id !== lead.id));
      showToast('Lead deleted', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const createLead = async (e) => {
    e.preventDefault();
    if (!newForm.caller_name.trim() || !newForm.caller_phone.trim()) {
      showToast('Name and phone are required', 'error');
      return;
    }
    setSavingNew(true);
    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers,
        body: JSON.stringify(newForm),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed');
      }
      const data = await res.json();
      setLeads((prev) => [data.lead, ...prev]);
      setNewForm({ caller_name: '', caller_phone: '', source: 'other', notes: '' });
      setShowNewForm(false);
      showToast('Lead created', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
    setSavingNew(false);
  };

  // Group by stage
  const byStage = {};
  for (const s of STAGES) byStage[s.key] = [];
  for (const l of leads) {
    if (byStage[l.stage]) byStage[l.stage].push(l);
    else byStage['incoming'].push(l);
  }
  const totalActive = STAGES.filter((s) => s.key !== 'rejected').reduce(
    (n, s) => n + byStage[s.key].length,
    0,
  );

  return (
    <div style={{ padding: '24px 20px', maxWidth: 1100, margin: '0 auto' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
          marginBottom: 24,
        }}
      >
        <div>
          <h1 style={{ margin: 0, color: BLUE, fontSize: 22, fontWeight: 700 }}>
            📞 Lead Pipeline
          </h1>
          <div style={{ color: '#666', fontSize: 13, marginTop: 3 }}>
            {totalActive} active lead{totalActive !== 1 ? 's' : ''} · Stages auto-create tasks &amp;
            calendar events
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 13,
              color: '#555',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            Show archived
          </label>
          <button
            onClick={load}
            style={{
              background: 'white',
              color: BLUE,
              border: `1px solid ${BLUE}`,
              borderRadius: 6,
              padding: '7px 12px',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            ↻ Refresh
          </button>
          <button onClick={() => setShowNewForm((v) => !v)} style={btnPrimary(ORANGE)}>
            + New Lead
          </button>
        </div>
      </div>

      {/* New lead form */}
      {showNewForm && (
        <div
          style={{
            background: 'white',
            border: '1px solid #dde3ed',
            borderRadius: 10,
            padding: 20,
            marginBottom: 20,
            boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
          }}
        >
          <div style={{ fontWeight: 700, color: BLUE, marginBottom: 14, fontSize: 15 }}>
            New Lead
          </div>
          <form onSubmit={createLead} style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <input
              placeholder="Name *"
              value={newForm.caller_name}
              onChange={(e) => setNewForm((f) => ({ ...f, caller_name: e.target.value }))}
              required
              style={{ ...inputStyle, flex: '1 1 160px' }}
            />
            <input
              placeholder="Phone *"
              value={newForm.caller_phone}
              onChange={(e) => setNewForm((f) => ({ ...f, caller_phone: e.target.value }))}
              required
              style={{ ...inputStyle, flex: '1 1 140px' }}
            />
            <select
              value={newForm.source}
              onChange={(e) => setNewForm((f) => ({ ...f, source: e.target.value }))}
              style={{ ...inputStyle, flex: '1 1 130px' }}
            >
              {Object.entries(SOURCE_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <input
              placeholder="Notes (optional)"
              value={newForm.notes}
              onChange={(e) => setNewForm((f) => ({ ...f, notes: e.target.value }))}
              style={{ ...inputStyle, flex: '2 1 200px' }}
            />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
              <button type="submit" disabled={savingNew} style={btnPrimary()}>
                {savingNew ? 'Saving…' : 'Save'}
              </button>
              <button type="button" onClick={() => setShowNewForm(false)} style={btnSecondary}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Pipeline */}
      {loading ? (
        <div style={{ textAlign: 'center', color: '#888', padding: 48 }}>Loading…</div>
      ) : leads.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#aaa', padding: 48 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
          <div style={{ fontSize: 15, color: '#888', marginBottom: 8 }}>No leads found.</div>
          <div style={{ fontSize: 13, marginBottom: 16 }}>
            Marblism missed calls appear here automatically, or use + New Lead to add one manually.
          </div>
          <button
            onClick={load}
            style={{
              background: BLUE,
              color: 'white',
              border: 'none',
              borderRadius: 6,
              padding: '8px 18px',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            ↻ Reload
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
          {STAGES.filter((s) => (showArchived ? s.key === 'rejected' : s.key !== 'rejected')).map(
            (stg) => {
              const stageLeads = byStage[stg.key] || [];
              if (!showArchived && stageLeads.length === 0) return null;
              return (
                <section key={stg.key}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                    <span
                      style={{
                        background: stg.bg,
                        color: stg.color,
                        borderRadius: 20,
                        padding: '4px 14px',
                        fontSize: 12,
                        fontWeight: 700,
                        border: `1px solid ${stg.color}40`,
                        letterSpacing: '.2px',
                      }}
                    >
                      {stg.label}
                    </span>
                    <span style={{ color: '#bbb', fontSize: 12 }}>
                      {stageLeads.length} lead{stageLeads.length !== 1 ? 's' : ''}
                    </span>
                    <div style={{ flex: 1, height: 1, background: '#edf0f5' }} />
                  </div>
                  {stageLeads.length === 0 ? (
                    <div style={{ color: '#ddd', fontSize: 13, paddingLeft: 8 }}>—</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                      {stageLeads.map((lead) => (
                        <LeadCard
                          key={lead.id}
                          lead={lead}
                          token={token}
                          onAdvance={() => advanceStage(lead)}
                          onArchive={() => setArchiveModal(lead)}
                          onDelete={() => deleteLead(lead)}
                          onOpenWizard={() => setWizardLead(lead)}
                          onEdit={() => setEditModal(lead)}
                        />
                      ))}
                    </div>
                  )}
                </section>
              );
            },
          )}
        </div>
      )}

      {/* Wizard modal */}
      {wizardLead && (
        <CreateQuoteWizard
          token={token}
          prefillLead={wizardLead}
          onClose={() => setWizardLead(null)}
          onSubmitted={async (jobId) => {
            if (jobId) {
              try {
                const r = await fetch(`/api/leads/${wizardLead.id}`, {
                  method: 'PATCH',
                  headers: { 'x-auth-token': token, 'Content-Type': 'application/json' },
                  body: JSON.stringify({ stage: 'quote_sent', job_id: String(jobId) }),
                });
                if (!r.ok) {
                  const e = await r.json().catch(() => ({}));
                  showToast(e.error || 'Could not link job to lead', 'error');
                }
              } catch {
                showToast('Network error linking job to lead', 'error');
              }
              load();
            }
            setWizardLead(null);
          }}
        />
      )}

      {/* Modals */}
      {apptModal && (
        <AppointmentModal
          lead={apptModal}
          onConfirm={confirmAppointment}
          onClose={() => setApptModal(null)}
        />
      )}
      {archiveModal && (
        <ArchiveModal
          lead={archiveModal}
          onConfirm={confirmArchive}
          onClose={() => setArchiveModal(null)}
        />
      )}
      {editModal && (
        <EditLeadModal
          lead={editModal}
          onConfirm={confirmEdit}
          onClose={() => setEditModal(null)}
        />
      )}
    </div>
  );
}

// ── Lead photo thumbnail (auth-gated, with GPS map link + delete X) ───────────
function LeadPhotoThumb({ photo, token, onDelete }) {
  const [blobUrl, setBlobUrl] = useState(null);
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    let revoked = false;
    let objUrl = null;
    fetch(`/api/field-photos/file/${photo.filename}`, { headers: { 'x-auth-token': token } })
      .then((r) => r.blob())
      .then((blob) => {
        if (revoked) return;
        objUrl = URL.createObjectURL(blob);
        setBlobUrl(objUrl);
      })
      .catch(() => {});
    return () => {
      revoked = true;
      if (objUrl) URL.revokeObjectURL(objUrl);
    };
  }, [photo.filename, token]);

  const mapUrl =
    photo.lat && photo.lon ? `https://maps.google.com/?q=${photo.lat},${photo.lon}` : null;

  const handleDelete = async (e) => {
    e.stopPropagation();
    if (!window.confirm('Delete this photo?')) return;
    setDeleting(true);
    try {
      await fetch(`/api/field-photos/${photo.id}`, {
        method: 'DELETE',
        headers: { 'x-auth-token': token },
      });
      if (onDelete) onDelete(photo.id);
    } catch {
      setDeleting(false);
    }
  };

  return (
    <div style={{ position: 'relative', width: 72, flexShrink: 0 }}>
      {blobUrl ? (
        <img
          src={blobUrl}
          alt={photo.original_name}
          style={{
            width: 72,
            height: 72,
            objectFit: 'cover',
            borderRadius: 6,
            border: '1px solid #dde3ed',
            display: 'block',
            cursor: 'pointer',
            opacity: deleting ? 0.4 : 1,
          }}
          onClick={() => {
            const w = window.open();
            w.document.write(`<img src="${blobUrl}" style="max-width:100%;max-height:100vh">`);
          }}
        />
      ) : (
        <div
          style={{
            width: 72,
            height: 72,
            background: '#f0f4f8',
            borderRadius: 6,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 11,
            color: '#aaa',
          }}
        >
          …
        </div>
      )}
      {/* Delete X button */}
      <button
        onClick={handleDelete}
        disabled={deleting}
        title="Delete photo"
        style={{
          position: 'absolute',
          top: 2,
          right: 2,
          width: 18,
          height: 18,
          borderRadius: '50%',
          background: 'rgba(0,0,0,0.6)',
          color: 'white',
          border: 'none',
          cursor: 'pointer',
          fontSize: 11,
          lineHeight: '18px',
          textAlign: 'center',
          padding: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        ✕
      </button>
      {mapUrl && (
        <a
          href={mapUrl}
          target="_blank"
          rel="noreferrer"
          style={{
            position: 'absolute',
            bottom: 3,
            left: 3,
            background: 'rgba(27,58,107,0.85)',
            color: 'white',
            fontSize: 9,
            borderRadius: 4,
            padding: '1px 4px',
            textDecoration: 'none',
            lineHeight: '14px',
          }}
        >
          📍 Map
        </a>
      )}
    </div>
  );
}

// ── Lead Card ─────────────────────────────────────────────────────────────────
function LeadCard({ lead, token, onAdvance, onArchive, onDelete, onOpenWizard, onEdit }) {
  const [noteInput, setNoteInput] = useState('');
  const [notesList, setNotesList] = useState([]);
  const [notesExpanded, setNotesExpanded] = useState(false);
  const [noteSaving, setNoteSaving] = useState(false);
  const [leadPhotos, setLeadPhotos] = useState([]);
  const [photoExpand, setPhotoExpand] = useState(false);
  const [propExpand, setPropExpand] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [leadDocs, setLeadDocs] = useState([]);
  const [docExpand, setDocExpand] = useState(false);
  const [docUploading, setDocUploading] = useState(false);
  const docInputRef = useRef(null);

  const runEnrichment = async () => {
    setEnriching(true);
    try {
      await fetch(`/api/leads/${lead.id}/enrich`, {
        method: 'POST',
        headers: { 'x-auth-token': token },
      });
      showToast('Property lookup started — refresh the page in a few seconds');
    } catch {
      showToast('Lookup failed', 'error');
    } finally {
      setEnriching(false);
    }
  };

  // Load notes ledger for this lead
  useEffect(() => {
    if (!token) return;
    fetch(`/api/leads/${lead.id}/notes`, { headers: { 'x-auth-token': token } })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setNotesList(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [lead.id, token]);

  const saveNote = async () => {
    const body = noteInput.trim();
    if (!body) return;
    setNoteSaving(true);
    try {
      const res = await fetch(`/api/leads/${lead.id}/notes`, {
        method: 'POST',
        headers: { 'x-auth-token': token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      const note = await res.json();
      if (!res.ok) {
        showToast(note.error || 'Could not save note', 'error');
        return;
      }
      setNoteInput('');
      setNotesList((prev) => [note, ...prev]);
    } catch {
      showToast('Could not save note', 'error');
    } finally {
      setNoteSaving(false);
    }
  };

  // Load photos for this lead
  useEffect(() => {
    if (!token) return;
    fetch(`/api/field-photos?lead_id=${lead.id}`, { headers: { 'x-auth-token': token } })
      .then((r) => (r.ok ? r.json() : { photos: [] }))
      .then((d) => setLeadPhotos(d.photos || []))
      .catch(() => {});
  }, [lead.id, token]);

  // Load documents for this lead
  useEffect(() => {
    if (!token) return;
    fetch(`/api/leads/${lead.id}/documents`, { headers: { 'x-auth-token': token } })
      .then((r) => (r.ok ? r.json() : { documents: [] }))
      .then((d) => setLeadDocs(d.documents || []))
      .catch(() => {});
  }, [lead.id, token]);

  const uploadDoc = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setDocUploading(true);
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await fetch(`/api/leads/${lead.id}/documents`, {
        method: 'POST',
        headers: { 'x-auth-token': token },
        body: form,
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Upload failed', 'error');
        return;
      }
      setLeadDocs((prev) => [data.document, ...prev]);
      setDocExpand(true);
      showToast('File uploaded');
    } catch {
      showToast('Upload failed', 'error');
    } finally {
      setDocUploading(false);
      if (docInputRef.current) docInputRef.current.value = '';
    }
  };

  const deleteDoc = async (docId) => {
    if (!window.confirm('Delete this file?')) return;
    try {
      const res = await fetch(`/api/leads/${lead.id}/documents/${docId}`, {
        method: 'DELETE',
        headers: { 'x-auth-token': token },
      });
      if (res.ok) setLeadDocs((prev) => prev.filter((d) => d.id !== docId));
      else showToast('Delete failed', 'error');
    } catch {
      showToast('Delete failed', 'error');
    }
  };

  const openDoc = (doc) => {
    const url = `/lead-docs/${lead.id}/${doc.filename}?token=${encodeURIComponent(token)}`;
    window.open(url, '_blank');
  };

  const stg = STAGE_MAP[lead.stage] || STAGE_MAP['incoming'];
  const nextStage = NEXT_STAGE[lead.stage];
  const canAdvance = !!nextStage;
  const isArchived = lead.archived === 1;
  const isSigned = lead.stage === 'signed';
  const isQuoteDraft = lead.stage === 'quote_draft';

  const nextLabel = {
    incoming: '📞 Log Callback Done',
    callback_done: '📅 Book Appointment',
    appointment_booked: '🏠 Mark Site Visit Done',
    site_visit_complete: '📋 Draft S.O.W. Proposal',
    quote_draft: '✉ Send Proposal',
    quote_sent: '📞 Log Follow-up 1',
    follow_up_1: '📞 Log Follow-up 2',
    follow_up_2: '✅ Mark as Signed',
  }[lead.stage];

  const jobAddr = [lead.job_address, lead.job_city].filter(Boolean).join(', ');
  const apptFmt = fmtDateTime(lead.appointment_at);
  const calURL = lead.appointment_at ? buildCalURL(lead) : null;

  return (
    <div
      style={{
        background: 'white',
        border: '1px solid #e2e8f0',
        borderRadius: 12,
        padding: '20px 22px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
        borderLeft: `4px solid ${stg.color}`,
      }}
    >
      {/* 2-column card grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr minmax(210px, 34%)',
          gap: '0 20px',
          alignItems: 'start',
        }}
      >
        {/* LEFT COLUMN — info, docs, photos */}
        <div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              flexWrap: 'wrap',
              marginBottom: 8,
            }}
          >
            <span style={{ fontWeight: 700, color: '#1a1a2e', fontSize: 16 }}>
              {lead.caller_name}
            </span>
            <a
              href={`tel:${lead.caller_phone}`}
              style={{ color: BLUE, fontSize: 14, textDecoration: 'none', fontWeight: 500 }}
            >
              {lead.caller_phone}
            </a>
          </div>

          {/* Badges */}
          <div
            style={{
              display: 'flex',
              gap: 6,
              flexWrap: 'wrap',
              alignItems: 'center',
            }}
          >
            <span
              style={{
                background: stg.bg,
                color: stg.color,
                borderRadius: 20,
                padding: '2px 10px',
                fontSize: 11,
                fontWeight: 700,
                border: `1px solid ${stg.color}30`,
              }}
            >
              {stg.label}
            </span>
            <span
              style={{
                background: '#f0f4f8',
                color: GREY,
                borderRadius: 20,
                padding: '2px 9px',
                fontSize: 11,
              }}
            >
              {SOURCE_LABELS[lead.source] || lead.source}
            </span>
            {lead.pb_customer_number && (
              <span
                style={{
                  background: '#e0e8ff',
                  color: BLUE,
                  borderRadius: 20,
                  padding: '2px 9px',
                  fontSize: 11,
                  fontWeight: 700,
                  fontFamily: 'monospace',
                }}
              >
                {lead.pb_customer_number}
              </span>
            )}
            {lead.contact_id && !lead.pb_customer_number && (
              <span
                style={{
                  background: '#e8f5e9',
                  color: GREEN,
                  borderRadius: 20,
                  padding: '2px 9px',
                  fontSize: 11,
                }}
              >
                ✓ Contact linked
              </span>
            )}
            {lead.job_type && (
              <span
                style={{
                  background: '#fdf4e7',
                  color: '#92400e',
                  borderRadius: 20,
                  padding: '2px 9px',
                  fontSize: 11,
                }}
              >
                {JOB_TYPE_LABELS[lead.job_type] || lead.job_type}
              </span>
            )}
            {isArchived && lead.archive_reason && (
              <span
                style={{
                  background: '#ffebee',
                  color: RED,
                  borderRadius: 20,
                  padding: '2px 9px',
                  fontSize: 11,
                }}
              >
                {lead.archive_reason.replace(/_/g, ' ')}
              </span>
            )}
          </div>

          {/* Appointment date */}
          {apptFmt && (
            <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, color: '#0288D1', fontWeight: 600 }}>📅 {apptFmt}</span>
              {calURL && (
                <a
                  href={calURL}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: 12, color: BLUE, textDecoration: 'underline' }}
                >
                  Add to Calendar
                </a>
              )}
            </div>
          )}

          {/* Job address / scope summary */}
          {jobAddr && (
            <div style={{ marginTop: 10, fontSize: 13, color: '#555' }}>📍 {jobAddr}</div>
          )}
          {lead.job_email && (
            <div style={{ marginTop: 6, fontSize: 13, color: '#555' }}>✉ {lead.job_email}</div>
          )}
          {lead.job_scope && (
            <div
              style={{
                marginTop: 8,
                fontSize: 12,
                color: '#777',
                fontStyle: 'italic',
                lineHeight: 1.5,
              }}
            >
              {lead.job_scope.length > 140 ? lead.job_scope.slice(0, 137) + '…' : lead.job_scope}
            </div>
          )}

          {/* Property lookup — run if address exists but no data yet */}
          {jobAddr && !lead.property_data && (
            <div style={{ marginTop: 10 }}>
              <button
                onClick={runEnrichment}
                disabled={enriching}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  cursor: enriching ? 'default' : 'pointer',
                  fontSize: 12,
                  color: BLUE,
                  fontWeight: 600,
                }}
              >
                🏠 {enriching ? 'Looking up…' : 'Run Property Lookup ▸'}
              </button>
            </div>
          )}

          {/* Property data panel */}
          {(() => {
            let pd = null;
            try {
              pd = lead.property_data ? JSON.parse(lead.property_data) : null;
            } catch (_e) {
              /* invalid JSON */
            }
            const mg = pd?.massGis;
            const lc = pd?.leadCheck;
            if (!mg && !lc) return null;

            const fmt = (v) => (v != null ? String(v) : null);
            const fmtMoney = (v) => (v != null ? `$${Number(v).toLocaleString()}` : null);
            const fmtSqft = (v) => (v != null ? `${Number(v).toLocaleString()} sqft` : null);

            const leadBadge = lc ? (
              lc.hasRecord ? (
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: '#b91c1c',
                    background: '#fef2f2',
                    border: '1px solid #fca5a5',
                    borderRadius: 5,
                    padding: '1px 7px',
                  }}
                >
                  ⚠ Lead Record
                </span>
              ) : (
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: '#15803d',
                    background: '#f0fdf4',
                    border: '1px solid #86efac',
                    borderRadius: 5,
                    padding: '1px 7px',
                  }}
                >
                  ✓ Lead Clear
                </span>
              )
            ) : null;

            const summary = [
              mg?.yearBuilt ? `Built ${mg.yearBuilt}` : null,
              fmtSqft(mg?.buildingArea),
              mg?.numBedrooms ? `${mg.numBedrooms}BR` : null,
              mg?.numBathrooms ? `${mg.numBathrooms}BA` : null,
            ]
              .filter(Boolean)
              .join(' · ');

            return (
              <div style={{ marginTop: 12 }}>
                <button
                  onClick={() => setPropExpand((v) => !v)}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    flexWrap: 'wrap',
                  }}
                >
                  <span style={{ fontSize: 12, color: BLUE, fontWeight: 600 }}>
                    🏠 Property {propExpand ? '▾' : '▸'}
                  </span>
                  {!propExpand && summary && (
                    <span style={{ fontSize: 11, color: '#555' }}>{summary}</span>
                  )}
                  {!propExpand && leadBadge}
                </button>
                {propExpand && (
                  <div
                    style={{
                      marginTop: 6,
                      background: '#f8faff',
                      border: '1px solid #dde5f0',
                      borderRadius: 7,
                      padding: '10px 12px',
                      fontSize: 12,
                    }}
                  >
                    {leadBadge && <div style={{ marginBottom: 8 }}>{leadBadge}</div>}
                    {/* Customer vs Owner cross-reference */}
                    <div
                      style={{
                        marginBottom: 8,
                        paddingBottom: 8,
                        borderBottom: '1px solid #e8edf5',
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: '4px 14px',
                      }}
                    >
                      <div>
                        <span style={{ color: '#888', fontWeight: 600 }}>Customer: </span>
                        <span style={{ color: '#1e293b' }}>{lead.caller_name}</span>
                        {lead.caller_phone && (
                          <span style={{ color: '#555' }}> · {lead.caller_phone}</span>
                        )}
                      </div>
                      {mg?.owner1 && (
                        <div>
                          <span style={{ color: '#888', fontWeight: 600 }}>Deed Owner: </span>
                          <span
                            style={{
                              color:
                                lead.caller_name &&
                                mg.owner1
                                  .toUpperCase()
                                  .includes(lead.caller_name.split(' ')[0].toUpperCase())
                                  ? '#15803d'
                                  : '#b45309',
                            }}
                          >
                            {mg.owner1}
                            {mg.owner2 ? ` / ${mg.owner2}` : ''}
                          </span>
                        </div>
                      )}
                    </div>
                    {mg && (
                      <div
                        style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 14px' }}
                      >
                        {[
                          ['Confirmed Address', mg.siteAddress],
                          ['Year Built', fmt(mg.yearBuilt)],
                          ['Building Area', fmtSqft(mg.buildingArea)],
                          [
                            'Lot Size',
                            mg.lotSize ? `${Number(mg.lotSize).toLocaleString()} sqft` : null,
                          ],
                          ['Bedrooms', fmt(mg.numBedrooms)],
                          ['Bathrooms', fmt(mg.numBathrooms)],
                          ['Style', mg.style],
                          ['Stories', fmt(mg.stories)],
                          ['Heat Type', mg.heatType],
                          ['Property Type', mg.useCodeLabel],
                          ['Assessed Value', fmtMoney(mg.totalAssessedValue)],
                          ['Owner Address', mg.ownerAddress],
                        ]
                          .filter(([, v]) => v)
                          .map(([label, value]) => (
                            <div key={label}>
                              <span style={{ color: '#888', fontWeight: 600 }}>{label}: </span>
                              <span style={{ color: '#1e293b' }}>{value}</span>
                            </div>
                          ))}
                      </div>
                    )}
                    {mg?.webSearchFallback && (
                      <div
                        style={{ marginTop: 6, color: '#888', fontStyle: 'italic', fontSize: 11 }}
                      >
                        Source: web search fallback (no MassGIS parcel match)
                      </div>
                    )}
                    {!mg && (
                      <div style={{ color: '#aaa', fontStyle: 'italic' }}>No parcel data found</div>
                    )}
                    {lc?.hasRecord && (
                      <a
                        href={lc.leadsafe2Url}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          display: 'block',
                          marginTop: 8,
                          fontSize: 11,
                          color: BLUE,
                          textDecoration: 'underline',
                        }}
                      >
                        View Lead Safe Homes records →
                      </a>
                    )}
                    <div
                      style={{
                        marginTop: 8,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <span style={{ fontSize: 10, color: '#bbb' }}>
                        MassGIS L3 Parcel ·{' '}
                        {new Date(mg?.queriedAt || pd.enrichedAt).toLocaleDateString('en-US', {
                          timeZone: 'America/New_York',
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </span>
                      <button
                        onClick={runEnrichment}
                        disabled={enriching}
                        style={{
                          background: 'none',
                          border: '1px solid #dde5f0',
                          borderRadius: 4,
                          padding: '2px 8px',
                          cursor: 'pointer',
                          fontSize: 11,
                          color: BLUE,
                          fontWeight: 600,
                        }}
                      >
                        {enriching ? '…' : '🔄 Refresh'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Documents section */}
          <div style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {leadDocs.length > 0 && (
                <button
                  onClick={() => setDocExpand((v) => !v)}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer',
                    fontSize: 12,
                    color: BLUE,
                    fontWeight: 600,
                  }}
                >
                  📎 {leadDocs.length} file{leadDocs.length !== 1 ? 's' : ''}{' '}
                  {docExpand ? '▾' : '▸'}
                </button>
              )}
              <input
                ref={docInputRef}
                type="file"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.jpg,.jpeg,.png,.gif,.webp"
                style={{ display: 'none' }}
                onChange={uploadDoc}
              />
              <button
                onClick={() => docInputRef.current?.click()}
                disabled={docUploading}
                style={{
                  background: 'none',
                  border: '1px solid #c9d3e0',
                  borderRadius: 5,
                  padding: '2px 8px',
                  fontSize: 11,
                  color: '#555',
                  cursor: docUploading ? 'default' : 'pointer',
                  opacity: docUploading ? 0.6 : 1,
                }}
              >
                {docUploading ? 'Uploading…' : '+ Attach file'}
              </button>
            </div>
            {docExpand && leadDocs.length > 0 && (
              <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {leadDocs.map((doc) => (
                  <div
                    key={doc.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      background: '#f4f6fb',
                      borderRadius: 5,
                      padding: '4px 8px',
                      fontSize: 12,
                    }}
                  >
                    <span
                      style={{
                        flex: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {doc.mime_type === 'application/pdf'
                        ? '📄'
                        : doc.mime_type?.startsWith('image/')
                          ? '🖼'
                          : '📎'}{' '}
                      {doc.original_name || doc.filename}
                    </span>
                    <span style={{ color: '#aaa', flexShrink: 0, fontSize: 11 }}>
                      {doc.file_size ? `${Math.round(doc.file_size / 1024)} KB` : ''}
                    </span>
                    <button
                      onClick={() => openDoc(doc)}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: 13,
                        padding: '0 2px',
                        color: BLUE,
                        flexShrink: 0,
                      }}
                      title="Open"
                    >
                      ↗
                    </button>
                    <button
                      onClick={() => deleteDoc(doc.id)}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: 13,
                        padding: '0 2px',
                        color: '#e44',
                        flexShrink: 0,
                      }}
                      title="Delete"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Photo strip */}
          {leadPhotos.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <button
                onClick={() => setPhotoExpand((v) => !v)}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  fontSize: 12,
                  color: BLUE,
                  fontWeight: 600,
                }}
              >
                📷 {leadPhotos.length} photo{leadPhotos.length !== 1 ? 's' : ''}{' '}
                {photoExpand ? '▾' : '▸'}
              </button>
              {photoExpand && (
                <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {leadPhotos.map((ph) => (
                    <LeadPhotoThumb
                      key={ph.id}
                      photo={ph}
                      token={token}
                      onDelete={(id) => setLeadPhotos((prev) => prev.filter((p) => p.id !== id))}
                    />
                  ))}
                  {leadPhotos.length >= 15 && (
                    <div
                      style={{
                        fontSize: 11,
                        color: '#b45309',
                        alignSelf: 'center',
                        paddingLeft: 4,
                      }}
                    >
                      ⚠️ 15-photo limit reached
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* RIGHT COLUMN — date, linked job, notes ledger, actions */}
        <div style={{ borderLeft: '1px solid #eef1f6', paddingLeft: 16 }}>
          <div style={{ color: '#aaa', fontSize: 11, marginBottom: 12 }}>
            {new Date(lead.created_at).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          </div>

          {/* Linked job badge */}
          {lead.job_id && (
            <div
              style={{
                marginBottom: 12,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                flexWrap: 'wrap',
              }}
            >
              <a
                href={`/jobs/${lead.job_id}`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 11,
                  fontWeight: 600,
                  color: GREEN,
                  background: '#e8f5e9',
                  border: '1px solid #a5d6a7',
                  borderRadius: 12,
                  padding: '3px 10px',
                  textDecoration: 'none',
                }}
              >
                🔗 Linked Job: {lead.job_pb_number || `#${lead.job_id}`}
              </a>
              {lead.job_status && (
                <span
                  style={{
                    background: getStatusStyle(lead.job_status).bg,
                    color: getStatusStyle(lead.job_status).color,
                    fontSize: 10,
                    fontWeight: 700,
                    borderRadius: 12,
                    padding: '3px 10px',
                  }}
                >
                  {getStatusStyle(lead.job_status).label}
                </span>
              )}
            </div>
          )}

          {/* Notes ledger */}
          <div style={{ marginTop: 14 }}>
            <label
              style={{
                fontSize: 11,
                color: '#aaa',
                fontWeight: 600,
                display: 'block',
                marginBottom: 6,
                letterSpacing: '.3px',
                textTransform: 'uppercase',
              }}
            >
              Notes
            </label>
            {notesList.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                {(notesExpanded ? notesList : notesList.slice(0, 1)).map((n) => {
                  const initials = (n.created_by || 'S')
                    .split(' ')
                    .map((w) => w[0])
                    .slice(0, 2)
                    .join('')
                    .toUpperCase();
                  return (
                    <div
                      key={n.id}
                      style={{ display: 'flex', gap: 7, marginBottom: 7, alignItems: 'flex-start' }}
                    >
                      <span
                        style={{
                          flexShrink: 0,
                          background: '#e0e8ff',
                          color: BLUE,
                          fontWeight: 700,
                          fontSize: 10,
                          borderRadius: 4,
                          padding: '2px 5px',
                          lineHeight: '16px',
                          minWidth: 24,
                          textAlign: 'center',
                        }}
                      >
                        {initials}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 12,
                            color: '#333',
                            lineHeight: 1.45,
                            wordBreak: 'break-word',
                          }}
                        >
                          {n.body}
                        </div>
                        <div style={{ fontSize: 10, color: '#aaa', marginTop: 2 }}>
                          {n.note_date} {n.note_time}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {notesList.length > 1 && (
                  <button
                    onClick={() => setNotesExpanded((v) => !v)}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      cursor: 'pointer',
                      fontSize: 11,
                      color: BLUE,
                      fontWeight: 600,
                    }}
                  >
                    {notesExpanded
                      ? '▲ Collapse'
                      : `▾ ${notesList.length - 1} more note${notesList.length - 1 !== 1 ? 's' : ''}`}
                  </button>
                )}
              </div>
            )}
            {notesList.length === 0 && (
              <div style={{ fontSize: 12, color: '#bbb', fontStyle: 'italic', marginBottom: 8 }}>
                No notes yet
              </div>
            )}
            <textarea
              value={noteInput}
              onChange={(e) => setNoteInput(e.target.value)}
              onBlur={saveNote}
              placeholder="Add a note…"
              rows={2}
              style={{
                width: '100%',
                border: '1px solid #dde3ed',
                borderRadius: 6,
                padding: '7px 10px',
                fontSize: 12,
                color: '#333',
                resize: 'vertical',
                boxSizing: 'border-box',
                fontFamily: 'inherit',
                background: noteSaving ? '#fffbe6' : '#fafafa',
                lineHeight: 1.5,
              }}
            />
          </div>

          {/* Action buttons */}
          {!isArchived && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
              {canAdvance && !isSigned && (
                <button onClick={onAdvance} style={btnPrimary(isQuoteDraft ? GREEN : BLUE)}>
                  {nextLabel}
                </button>
              )}
              {isQuoteDraft && (
                <button onClick={onOpenWizard} style={btnPrimary('#F57C00')}>
                  📝 Open Proposal Wizard
                </button>
              )}
              <button
                onClick={onEdit}
                style={{
                  background: '#fff',
                  color: BLUE,
                  border: `1px solid ${BLUE}`,
                  borderRadius: 6,
                  padding: '7px 12px',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                ✏️ Edit
              </button>
              {!isSigned && (
                <button
                  onClick={onArchive}
                  style={{
                    background: '#fff',
                    color: RED,
                    border: '1px solid #ef9a9a',
                    borderRadius: 6,
                    padding: '7px 12px',
                    cursor: 'pointer',
                    fontSize: 12,
                  }}
                >
                  Archive
                </button>
              )}
              <button
                onClick={onDelete}
                style={{
                  background: '#fff',
                  color: '#aaa',
                  border: '1px solid #ddd',
                  borderRadius: 6,
                  padding: '7px 10px',
                  cursor: 'pointer',
                  fontSize: 11,
                }}
              >
                Delete
              </button>
            </div>
          )}
          {isArchived && (
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button
                onClick={onDelete}
                style={{
                  background: '#fff',
                  color: '#aaa',
                  border: '1px solid #ddd',
                  borderRadius: 6,
                  padding: '6px 10px',
                  cursor: 'pointer',
                  fontSize: 11,
                }}
              >
                Delete permanently
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function buildCalURL(lead) {
  if (!lead.appointment_at) return null;
  try {
    const calDate = (iso) =>
      iso
        .replace(/[-:]/g, '')
        .replace(/\.\d{3}Z?$/, '')
        .slice(0, 15);
    const start = calDate(new Date(lead.appointment_at).toISOString());
    const endDt = new Date(new Date(lead.appointment_at).getTime() + 2 * 3600000);
    const end = calDate(endDt.toISOString());
    const addr = [lead.job_address, lead.job_city].filter(Boolean).join(', ');
    const parts = [
      'action=TEMPLATE',
      `text=${encodeURIComponent(`Appointment: ${lead.caller_name}`)}`,
      `dates=${start}/${end}`,
      `details=${encodeURIComponent(`Site visit with ${lead.caller_name} (${lead.caller_phone})`)}`,
    ];
    if (addr) parts.push(`location=${encodeURIComponent(addr)}`);
    return `https://calendar.google.com/calendar/render?${parts.join('&')}`;
  } catch {
    return null;
  }
}
