// client/src/pages/Tasks.jsx
import { useState, useEffect } from 'react';
import { showToast } from '../utils/toast';
import { showConfirm } from '../utils/confirm';

const BLUE = '#1B3A6B';
const ORANGE = '#E07B2A';
const GREEN = '#2E7D32';
const RED = '#C62828';

const PRIORITY_COLORS = { high: RED, normal: ORANGE, low: '#888' };
const PRIORITY_LABELS = { high: '🔴 High', normal: '🟡 Normal', low: '🟢 Low' };

const SNOOZE_OPTIONS = [
  { label: '2 hours', hours: 2 },
  { label: '3 hours', hours: 3 },
  { label: '1 day', hours: 24 },
  { label: '2 days', hours: 48 },
  { label: '3 days', hours: 72 },
  { label: '7 days', hours: 168 },
  { label: '14 days', hours: 336 },
];

// ── Lead pipeline constants ────────────────────────────────────────────────────
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
const STAGE_LABELS = {
  incoming: 'Incoming',
  callback_done: 'Callback Done',
  appointment_booked: 'Appt Booked',
  site_visit_complete: 'Site Visited',
  quote_draft: 'Proposal Draft',
  quote_sent: 'Proposal Sent',
  follow_up_1: 'Follow-up 1',
  follow_up_2: 'Follow-up 2',
  signed: 'Signed ✓',
  rejected: 'Rejected',
};
const STAGE_COLORS = {
  incoming: '#7B8EA0',
  callback_done: '#5C6BC0',
  appointment_booked: '#0288D1',
  site_visit_complete: '#00838F',
  quote_draft: '#F57C00',
  quote_sent: '#558B2F',
  follow_up_1: '#7B1FA2',
  follow_up_2: '#AD1457',
  signed: '#2E7D32',
  rejected: '#C62828',
};
const ADVANCE_LABELS = {
  callback_done: '📞 Log Callback Done',
  appointment_booked: '📅 Book Appointment',
  site_visit_complete: '🏠 Mark Site Visit Done',
  quote_draft: '📋 Draft S.O.W. Proposal',
  quote_sent: '✉ Send Proposal',
  follow_up_1: '📞 Log Follow-up 1',
  follow_up_2: '📞 Log Follow-up 2',
  signed: '✅ Proceed to Contract',
};
// Stages where we show an inline form before advancing
const FORM_STAGES = new Set(['appointment_booked', 'quote_draft', 'signed']);

function parseLastContact(notes) {
  if (!notes) return null;
  const lines = notes.split('\n').reverse();
  for (const line of lines) {
    const m = line.match(/^(📧|📞)\s+(Email|Phone)\s+—\s+(.+)$/);
    if (m) return { method: m[2], icon: m[1], date: m[3] };
  }
  return null;
}

function LeadPanel({ task, token, onAdvanced }) {
  const lead = task.lead;
  if (!lead || lead.archived) return null;

  const stage = lead.stage;
  const nextStage = NEXT_STAGE[stage];
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [apptAt, setApptAt] = useState('');
  const [jobAddress, setJobAddress] = useState(lead.job_address || '');
  const [jobCity, setJobCity] = useState(lead.job_city || '');
  const [jobType, setJobType] = useState('');
  const [jobScope, setJobScope] = useState('');
  const [leadNotes, setLeadNotes] = useState(lead.notes || '');

  const isFollowUp = stage === 'follow_up_1' || stage === 'follow_up_2';
  const lastContact = parseLastContact(leadNotes);

  async function logContact(method) {
    const icon = method === 'Email' ? '📧' : '📞';
    const now = new Date().toLocaleString('en-US', {
      timeZone: 'America/New_York',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    const line = `${icon} ${method} — ${now}`;
    const updatedNotes = leadNotes ? `${leadNotes}\n${line}` : line;
    try {
      const r = await fetch(`/api/leads/${lead.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-auth-token': token },
        body: JSON.stringify({ notes: updatedNotes }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || r.statusText);
      setLeadNotes(updatedNotes);
      showToast(`Contact logged: ${icon} ${method}`, 'success');
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  async function advance(extraBody = {}) {
    setBusy(true);
    try {
      const r = await fetch(`/api/leads/${lead.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-auth-token': token },
        body: JSON.stringify({ stage: nextStage, ...extraBody }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || r.statusText);
      const newLead = data.lead;
      showToast(`Lead advanced to: ${STAGE_LABELS[newLead.stage] || newLead.stage}`, 'success');
      if (newLead.pb_customer_number && !lead.pb_customer_number) {
        showToast(`PB# assigned: ${newLead.pb_customer_number}`, 'info');
      }
      setOpen(false);
      onAdvanced();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  function handleAdvanceClick() {
    if (FORM_STAGES.has(nextStage)) {
      setOpen(true);
    } else {
      advance();
    }
  }

  const pill = (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        background: (STAGE_COLORS[stage] || '#888') + '18',
        color: STAGE_COLORS[stage] || '#888',
        border: `1px solid ${STAGE_COLORS[stage] || '#888'}44`,
        borderRadius: 20,
        padding: '2px 10px',
        fontSize: 11,
        fontWeight: 'bold',
      }}
    >
      🔖 {lead.caller_name} · {STAGE_LABELS[stage] || stage}
    </span>
  );

  return (
    <div style={{ marginTop: 10, borderTop: '1px dashed #e0e7ef', paddingTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {pill}
        {nextStage && !open && (
          <button
            onClick={handleAdvanceClick}
            disabled={busy}
            style={{
              padding: '4px 12px',
              fontSize: 11,
              fontWeight: 'bold',
              background: nextStage === 'signed' ? '#2E7D3222' : '#E07B2A22',
              color: nextStage === 'signed' ? '#2E7D32' : ORANGE,
              border: `1px solid ${nextStage === 'signed' ? '#2E7D3244' : '#E07B2A44'}`,
              borderRadius: 6,
              cursor: busy ? 'wait' : 'pointer',
            }}
          >
            {busy ? '…' : ADVANCE_LABELS[nextStage] || `→ ${STAGE_LABELS[nextStage]}`}
          </button>
        )}
      </div>

      {/* ── Follow-up contact method buttons ─────────────────────────────── */}
      {isFollowUp && (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, color: '#555', fontWeight: 'bold' }}>Log contact:</span>
            <button
              onClick={() => logContact('Email')}
              title="Log email contact"
              style={{
                padding: '3px 10px',
                fontSize: 12,
                cursor: 'pointer',
                background: '#E3F2FD',
                color: '#1565C0',
                border: '1px solid #90CAF9',
                borderRadius: 6,
              }}
            >
              📧 Email
            </button>
            <button
              onClick={() => logContact('Phone')}
              title="Log phone contact"
              style={{
                padding: '3px 10px',
                fontSize: 12,
                cursor: 'pointer',
                background: '#E8F5E9',
                color: '#2E7D32',
                border: '1px solid #A5D6A7',
                borderRadius: 6,
              }}
            >
              📞 Phone
            </button>
          </div>
          {lastContact && (
            <div style={{ marginTop: 5, fontSize: 11, color: '#666' }}>
              Last contacted: {lastContact.icon} {lastContact.method} — {lastContact.date}
            </div>
          )}
        </div>
      )}

      {/* ── Appointment form ─────────────────────────────────────────────── */}
      {open && nextStage === 'appointment_booked' && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 11, color: '#555' }}>
            Appointment date/time
            <input
              type="datetime-local"
              value={apptAt}
              onChange={(e) => setApptAt(e.target.value)}
              style={{
                display: 'block',
                width: '100%',
                marginTop: 2,
                padding: '4px 8px',
                border: '1px solid #C8D4E4',
                borderRadius: 5,
                fontSize: 12,
              }}
            />
          </label>
          <label style={{ fontSize: 11, color: '#555' }}>
            Job city
            <input
              type="text"
              value={jobCity}
              onChange={(e) => setJobCity(e.target.value)}
              placeholder="e.g. Miami"
              style={{
                display: 'block',
                width: '100%',
                marginTop: 2,
                padding: '4px 8px',
                border: '1px solid #C8D4E4',
                borderRadius: 5,
                fontSize: 12,
              }}
            />
          </label>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => {
                if (!apptAt) {
                  showToast('Pick an appointment date', 'error');
                  return;
                }
                advance({ appointment_at: apptAt, job_city: jobCity });
              }}
              disabled={busy}
              style={{
                padding: '5px 14px',
                fontSize: 11,
                fontWeight: 'bold',
                cursor: 'pointer',
                background: BLUE,
                color: 'white',
                border: 'none',
                borderRadius: 6,
              }}
            >
              {busy ? '…' : 'Confirm Appointment'}
            </button>
            <button
              onClick={() => setOpen(false)}
              style={{
                padding: '5px 10px',
                fontSize: 11,
                cursor: 'pointer',
                background: '#f5f5f5',
                color: '#555',
                border: '1px solid #ddd',
                borderRadius: 6,
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Quote draft form ─────────────────────────────────────────────── */}
      {open && nextStage === 'quote_draft' && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 11, color: '#555' }}>
            Job address
            <input
              type="text"
              value={jobAddress}
              onChange={(e) => setJobAddress(e.target.value)}
              placeholder="Street address"
              style={{
                display: 'block',
                width: '100%',
                marginTop: 2,
                padding: '4px 8px',
                border: '1px solid #C8D4E4',
                borderRadius: 5,
                fontSize: 12,
              }}
            />
          </label>
          <label style={{ fontSize: 11, color: '#555' }}>
            City
            <input
              type="text"
              value={jobCity}
              onChange={(e) => setJobCity(e.target.value)}
              placeholder="City"
              style={{
                display: 'block',
                width: '100%',
                marginTop: 2,
                padding: '4px 8px',
                border: '1px solid #C8D4E4',
                borderRadius: 5,
                fontSize: 12,
              }}
            />
          </label>
          <label style={{ fontSize: 11, color: '#555' }}>
            Job type
            <select
              value={jobType}
              onChange={(e) => setJobType(e.target.value)}
              style={{
                display: 'block',
                width: '100%',
                marginTop: 2,
                padding: '4px 8px',
                border: '1px solid #C8D4E4',
                borderRadius: 5,
                fontSize: 12,
                background: 'white',
              }}
            >
              <option value="">— select —</option>
              <option value="new_construction">New Construction</option>
              <option value="renovation">Renovation / Remodel</option>
              <option value="addition">Addition</option>
              <option value="roofing">Roofing</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label style={{ fontSize: 11, color: '#555' }}>
            Scope / notes
            <textarea
              value={jobScope}
              onChange={(e) => setJobScope(e.target.value)}
              rows={3}
              placeholder="Describe the work…"
              style={{
                display: 'block',
                width: '100%',
                marginTop: 2,
                padding: '4px 8px',
                border: '1px solid #C8D4E4',
                borderRadius: 5,
                fontSize: 12,
                resize: 'vertical',
              }}
            />
          </label>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() =>
                advance({
                  job_address: jobAddress,
                  job_city: jobCity,
                  job_type: jobType,
                  job_scope: jobScope,
                })
              }
              disabled={busy}
              style={{
                padding: '5px 14px',
                fontSize: 11,
                fontWeight: 'bold',
                cursor: 'pointer',
                background: ORANGE,
                color: 'white',
                border: 'none',
                borderRadius: 6,
              }}
            >
              {busy ? '…' : 'Draft S.O.W. Proposal'}
            </button>
            <button
              onClick={() => setOpen(false)}
              style={{
                padding: '5px 10px',
                fontSize: 11,
                cursor: 'pointer',
                background: '#f5f5f5',
                color: '#555',
                border: '1px solid #ddd',
                borderRadius: 6,
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Proceed to Contract form ─────────────────────────────────────── */}
      {open && nextStage === 'signed' && (
        <div
          style={{
            marginTop: 8,
            background: '#f0faf0',
            border: '1px solid #a8d5a2',
            borderRadius: 8,
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 'bold', color: GREEN }}>
            ✅ Proceed to Contract — {lead.caller_name}
          </div>
          <div style={{ fontSize: 11, color: '#444', lineHeight: 1.6 }}>
            This will:
            <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
              <li>
                Mark this lead as <strong>Signed</strong>
              </li>
              {!lead.pb_customer_number && (
                <li>
                  Assign a <strong>PB customer number</strong> and create/update the contact
                </li>
              )}
              {lead.pb_customer_number && (
                <li>
                  Contact already linked (PB# <strong>{lead.pb_customer_number}</strong>)
                </li>
              )}
              <li>
                Create a high-priority <strong>Generate Contract</strong> task (due in 24 h)
              </li>
            </ul>
          </div>
          {!lead.job_address && (
            <label style={{ fontSize: 11, color: '#555' }}>
              Job address (optional)
              <input
                type="text"
                value={jobAddress}
                onChange={(e) => setJobAddress(e.target.value)}
                placeholder="Street address"
                style={{
                  display: 'block',
                  width: '100%',
                  marginTop: 2,
                  padding: '4px 8px',
                  border: '1px solid #C8D4E4',
                  borderRadius: 5,
                  fontSize: 12,
                }}
              />
            </label>
          )}
          {!lead.job_city && (
            <label style={{ fontSize: 11, color: '#555' }}>
              City (optional)
              <input
                type="text"
                value={jobCity}
                onChange={(e) => setJobCity(e.target.value)}
                placeholder="City"
                style={{
                  display: 'block',
                  width: '100%',
                  marginTop: 2,
                  padding: '4px 8px',
                  border: '1px solid #C8D4E4',
                  borderRadius: 5,
                  fontSize: 12,
                }}
              />
            </label>
          )}
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() =>
                advance({
                  job_address: jobAddress || lead.job_address || undefined,
                  job_city: jobCity || lead.job_city || undefined,
                })
              }
              disabled={busy}
              style={{
                padding: '6px 18px',
                fontSize: 12,
                fontWeight: 'bold',
                cursor: 'pointer',
                background: GREEN,
                color: 'white',
                border: 'none',
                borderRadius: 6,
              }}
            >
              {busy ? '…' : '✅ Confirm — Proceed to Contract'}
            </button>
            <button
              onClick={() => setOpen(false)}
              style={{
                padding: '5px 10px',
                fontSize: 11,
                cursor: 'pointer',
                background: '#f5f5f5',
                color: '#555',
                border: '1px solid #ddd',
                borderRadius: 6,
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function calDiff(due) {
  if (!due) return null;
  const now = new Date();
  const d = new Date(due);
  const diff = Math.round((d - now) / 1000 / 60);
  if (diff < 0) return { label: 'Overdue', color: RED };
  if (diff < 60) return { label: `in ${diff}m`, color: RED };
  if (diff < 1440) return { label: `in ${Math.round(diff / 60)}h`, color: ORANGE };
  const days = Math.round(diff / 1440);
  if (days === 0) return { label: 'Today', color: ORANGE };
  if (days === 1) return { label: 'Tomorrow', color: '#F59E0B' };
  return { label: `in ${days}d`, color: '#888' };
}

function formatRemindAt(remindAt) {
  if (!remindAt) return null;
  const d = new Date(remindAt);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function Tasks({ token }) {
  const [tasks, setTasks] = useState([]);
  const [todayCount, setTodayCount] = useState(0);
  const [overdue, setOverdue] = useState(0);
  const [filter, setFilter] = useState('pending');
  const [range, setRange] = useState('all');
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [personFilter, setPersonFilter] = useState('all');
  const [form, setForm] = useState({
    title: '',
    description: '',
    due_at: '',
    priority: 'normal',
    assigned_to: '',
    remind_at: '',
    remind_interval_hours: '',
    recurrence: 'none',
  });
  const [saving, setSaving] = useState(false);
  const [snoozing, setSnoozing] = useState({});
  const [staffUsers, setStaffUsers] = useState([]);

  const headers = { 'x-auth-token': token, 'Content-Type': 'application/json' };

  const load = () => {
    const params = new URLSearchParams();
    if (filter !== 'all') params.set('status', filter);
    if (range !== 'all') params.set('range', range);
    fetch(`/api/tasks?${params}`, { headers: { 'x-auth-token': token } })
      .then((r) => r.json())
      .then((data) => {
        setTasks(data.tasks || []);
        setTodayCount(data.todayCount || 0);
        setOverdue(data.overdue || 0);
        setLoading(false);
      });
  };

  useEffect(() => {
    load();
  }, [filter, range]);

  useEffect(() => {
    fetch('/api/staff-chat/users', { headers: { 'x-auth-token': token } })
      .then((r) => (r.ok ? r.json() : []))
      .then((names) => setStaffUsers(names || []))
      .catch(() => {});
  }, [token]);

  const BLANK_FORM = {
    title: '',
    description: '',
    due_at: '',
    priority: 'normal',
    assigned_to: '',
    remind_at: '',
    remind_interval_hours: '',
    recurrence: 'none',
  };

  const createTask = async () => {
    if (!form.title.trim()) return showToast('Title is required', 'error');
    setSaving(true);
    // Build payload — only send remind fields if user chose them
    const payload = {
      title: form.title,
      description: form.description,
      due_at: form.due_at || null,
      priority: form.priority,
      assigned_to: form.assigned_to || null,
      recurrence: form.recurrence || 'none',
    };
    if (form.remind_at) {
      payload.remind_at = form.remind_at;
      payload.remind_interval_hours = form.remind_interval_hours
        ? parseInt(form.remind_interval_hours, 10)
        : 24;
    }
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (res.ok) {
      setForm(BLANK_FORM);
      setShowForm(false);
      load();
      showToast('Task created!');
    } else {
      showToast(data.error || 'Failed to create task', 'error');
    }
    setSaving(false);
  };

  const toggleDone = async (task) => {
    const newStatus = task.status === 'done' ? 'pending' : 'done';
    await fetch(`/api/tasks/${task.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status: newStatus }),
    });
    load();
  };

  const deleteTask = async (task) => {
    if (!(await showConfirm(`Delete task "${task.title}"?`))) return;
    await fetch(`/api/tasks/${task.id}`, { method: 'DELETE', headers });
    load();
    showToast('Task deleted');
  };

  const snoozeTask = async (task, hours) => {
    setSnoozing((s) => ({ ...s, [task.id]: true }));
    const remindAt = new Date(Date.now() + hours * 60 * 60 * 1000)
      .toISOString()
      .replace('T', ' ')
      .slice(0, 19);
    const res = await fetch(`/api/tasks/${task.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ remind_at: remindAt, remind_interval_hours: hours }),
    });
    if (res.ok) {
      showToast(`Reminder set for ${SNOOZE_OPTIONS.find((o) => o.hours === hours)?.label}`);
      load();
    } else {
      showToast('Failed to update reminder', 'error');
    }
    setSnoozing((s) => ({ ...s, [task.id]: false }));
  };

  // Apply person filter before grouping
  const visibleTasks =
    personFilter === 'all' ? tasks : tasks.filter((t) => t.assigned_to === personFilter);

  // Group tasks by date
  const grouped = visibleTasks.reduce((acc, task) => {
    let key = 'No due date';
    if (task.due_at) {
      const d = new Date(task.due_at);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tom = new Date(today);
      tom.setDate(tom.getDate() + 1);
      if (d < today) key = '🔴 Overdue';
      else if (d < tom) key = '📅 Today';
      else {
        const nextDay = new Date(today);
        nextDay.setDate(nextDay.getDate() + 2);
        if (d < nextDay) key = '📅 Tomorrow';
        else
          key = d.toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'short',
            day: 'numeric',
          });
      }
    }
    if (!acc[key]) acc[key] = [];
    acc[key].push(task);
    return acc;
  }, {});

  const groupOrder = ['🔴 Overdue', '📅 Today', '📅 Tomorrow'];
  const sortedGroups = [
    ...groupOrder.filter((g) => grouped[g]),
    ...Object.keys(grouped)
      .filter((g) => !groupOrder.includes(g))
      .sort(),
  ];

  return (
    <div style={{ padding: 32, maxWidth: 800 }}>
      {/* Header */}
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
            ✅ Tasks & Reminders
          </h1>
          <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
            {todayCount > 0 && (
              <span
                style={{
                  fontSize: 12,
                  background: ORANGE + '22',
                  color: ORANGE,
                  padding: '3px 10px',
                  borderRadius: 20,
                  fontWeight: 'bold',
                }}
              >
                📅 {todayCount} due today
              </span>
            )}
            {overdue > 0 && (
              <span
                style={{
                  fontSize: 12,
                  background: RED + '22',
                  color: RED,
                  padding: '3px 10px',
                  borderRadius: 20,
                  fontWeight: 'bold',
                }}
              >
                🔴 {overdue} overdue
              </span>
            )}
          </div>
        </div>
        <button
          onClick={() => setShowForm(true)}
          style={{
            padding: '10px 20px',
            background: BLUE,
            color: 'white',
            border: 'none',
            borderRadius: 8,
            cursor: 'pointer',
            fontWeight: 'bold',
            fontSize: 13,
          }}
        >
          + Add Task
        </button>
      </div>

      {/* New task form */}
      {showForm && (
        <div
          style={{
            background: 'white',
            borderRadius: 10,
            padding: 20,
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            marginBottom: 20,
          }}
        >
          <h3 style={{ color: BLUE, margin: '0 0 16px' }}>New Task</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input
              value={form.title}
              onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
              placeholder="Task title (e.g. Call for inspection at 123 Main St)"
              style={{
                padding: '10px 12px',
                border: '1.5px solid #C8D4E4',
                borderRadius: 6,
                fontSize: 14,
              }}
            />
            <textarea
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              placeholder="Additional notes (optional)"
              rows={2}
              style={{
                padding: '10px 12px',
                border: '1.5px solid #C8D4E4',
                borderRadius: 6,
                fontSize: 13,
                resize: 'vertical',
              }}
            />
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4 }}>
                  Due Date &amp; Time
                </label>
                <input
                  type="datetime-local"
                  value={form.due_at}
                  onChange={(e) => setForm((p) => ({ ...p, due_at: e.target.value }))}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: '1.5px solid #C8D4E4',
                    borderRadius: 6,
                    fontSize: 13,
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4 }}>
                  Priority
                </label>
                <select
                  value={form.priority}
                  onChange={(e) => setForm((p) => ({ ...p, priority: e.target.value }))}
                  style={{
                    padding: '8px 12px',
                    border: '1.5px solid #C8D4E4',
                    borderRadius: 6,
                    fontSize: 13,
                    height: 37,
                  }}
                >
                  <option value="high">🔴 High</option>
                  <option value="normal">🟡 Normal</option>
                  <option value="low">🟢 Low</option>
                </select>
              </div>
            </div>
            {/* Assign To + Reminder row */}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 160 }}>
                <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4 }}>
                  Assign To
                </label>
                <select
                  value={form.assigned_to}
                  onChange={(e) => setForm((p) => ({ ...p, assigned_to: e.target.value }))}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: '1.5px solid #C8D4E4',
                    borderRadius: 6,
                    fontSize: 13,
                  }}
                >
                  <option value="">— Anyone —</option>
                  {staffUsers.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ minWidth: 140 }}>
                <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4 }}>
                  Recurrence
                </label>
                <select
                  value={form.recurrence}
                  onChange={(e) => setForm((p) => ({ ...p, recurrence: e.target.value }))}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: '1.5px solid #C8D4E4',
                    borderRadius: 6,
                    fontSize: 13,
                    height: 37,
                  }}
                >
                  <option value="none">No repeat</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="biweekly">Every 2 weeks</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>
              <div style={{ flex: 1, minWidth: 160 }}>
                <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4 }}>
                  Send Reminder At (optional)
                </label>
                <input
                  type="datetime-local"
                  value={form.remind_at}
                  onChange={(e) => setForm((p) => ({ ...p, remind_at: e.target.value }))}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: '1.5px solid #C8D4E4',
                    borderRadius: 6,
                    fontSize: 13,
                  }}
                />
              </div>
              {form.remind_at && (
                <div style={{ minWidth: 130 }}>
                  <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4 }}>
                    Repeat Every
                  </label>
                  <select
                    value={form.remind_interval_hours}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, remind_interval_hours: e.target.value }))
                    }
                    style={{
                      padding: '8px 12px',
                      border: '1.5px solid #C8D4E4',
                      borderRadius: 6,
                      fontSize: 13,
                      height: 37,
                    }}
                  >
                    <option value="">No repeat</option>
                    <option value="2">2 hours</option>
                    <option value="24">1 day</option>
                    <option value="48">2 days</option>
                    <option value="72">3 days</option>
                    <option value="168">1 week</option>
                  </select>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={createTask}
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
                {saving ? 'Saving...' : 'Create Task'}
              </button>
              <button
                onClick={() => setShowForm(false)}
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
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {[
          ['pending', '⬜ Pending'],
          ['done', '✅ Done'],
          ['all', 'All'],
        ].map(([v, l]) => (
          <button
            key={v}
            onClick={() => setFilter(v)}
            style={{
              padding: '6px 14px',
              borderRadius: 20,
              border: '1px solid #ddd',
              background: filter === v ? BLUE : 'white',
              color: filter === v ? 'white' : '#555',
              fontSize: 12,
              cursor: 'pointer',
              fontWeight: filter === v ? 'bold' : 'normal',
            }}
          >
            {l}
          </button>
        ))}
        <div style={{ borderLeft: '1px solid #eee', margin: '0 4px' }} />
        {[
          ['all', 'All Dates'],
          ['today', 'Today'],
          ['week', 'This Week'],
        ].map(([v, l]) => (
          <button
            key={v}
            onClick={() => setRange(v)}
            style={{
              padding: '6px 14px',
              borderRadius: 20,
              border: '1px solid #ddd',
              background: range === v ? '#E07B2A' : 'white',
              color: range === v ? 'white' : '#555',
              fontSize: 12,
              cursor: 'pointer',
              fontWeight: range === v ? 'bold' : 'normal',
            }}
          >
            {l}
          </button>
        ))}
        {staffUsers.length > 0 && (
          <>
            <div style={{ borderLeft: '1px solid #eee', margin: '0 4px' }} />
            {[['all', '👥 Everyone'], ...staffUsers.map((n) => [n, n])].map(([v, l]) => (
              <button
                key={v}
                onClick={() => setPersonFilter(v)}
                style={{
                  padding: '6px 14px',
                  borderRadius: 20,
                  border: '1px solid #ddd',
                  background: personFilter === v ? '#2E7D32' : 'white',
                  color: personFilter === v ? 'white' : '#555',
                  fontSize: 12,
                  cursor: 'pointer',
                  fontWeight: personFilter === v ? 'bold' : 'normal',
                }}
              >
                {l}
              </button>
            ))}
          </>
        )}
      </div>

      {/* Task list */}
      {loading ? (
        <div style={{ color: '#888', textAlign: 'center', padding: 40 }}>Loading...</div>
      ) : tasks.length === 0 ? (
        <div
          style={{
            background: 'white',
            borderRadius: 10,
            padding: 48,
            textAlign: 'center',
            boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
          }}
        >
          <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
          <div style={{ color: '#888', fontSize: 14 }}>
            No tasks found. Add one above or ask the bot to create a reminder.
          </div>
        </div>
      ) : (
        sortedGroups.map((group) => (
          <div key={group} style={{ marginBottom: 24 }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 'bold',
                color: group.includes('Overdue') ? RED : group.includes('Today') ? ORANGE : '#555',
                marginBottom: 8,
                textTransform: 'uppercase',
                letterSpacing: '.5px',
              }}
            >
              {group}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(grouped[group] || []).map((task) => {
                const diff = calDiff(task.due_at);
                const isDone = task.status === 'done';
                const remindLabel = formatRemindAt(task.remind_at);
                return (
                  <div
                    key={task.id}
                    style={{
                      background: 'white',
                      borderRadius: 8,
                      padding: '14px 16px',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.07)',
                      borderLeft: `4px solid ${isDone ? '#ddd' : PRIORITY_COLORS[task.priority]}`,
                      opacity: isDone ? 0.65 : 1,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                      {/* Checkbox */}
                      <input
                        type="checkbox"
                        checked={isDone}
                        onChange={() => toggleDone(task)}
                        style={{
                          marginTop: 3,
                          width: 16,
                          height: 16,
                          cursor: 'pointer',
                          flexShrink: 0,
                        }}
                      />

                      {/* Content */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontWeight: 'bold',
                            fontSize: 14,
                            color: isDone ? '#aaa' : BLUE,
                            textDecoration: isDone ? 'line-through' : 'none',
                          }}
                        >
                          {task.title}
                        </div>
                        {task.description && (
                          <div style={{ fontSize: 12, color: '#666', marginTop: 3 }}>
                            {task.description}
                          </div>
                        )}
                        <div
                          style={{
                            display: 'flex',
                            gap: 12,
                            marginTop: 6,
                            flexWrap: 'wrap',
                            alignItems: 'center',
                          }}
                        >
                          {task.due_at && (
                            <span style={{ fontSize: 11, color: '#888' }}>
                              🕐{' '}
                              {new Date(task.due_at).toLocaleString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          )}
                          {diff && !isDone && (
                            <span style={{ fontSize: 11, fontWeight: 'bold', color: diff.color }}>
                              ({diff.label})
                            </span>
                          )}
                          {task.job && (
                            <span style={{ fontSize: 11, color: '#3B82F6' }}>
                              🏠 {task.job.project_address}
                            </span>
                          )}
                          {task.contact && (
                            <span style={{ fontSize: 11, color: '#888' }}>
                              👤 {task.contact.name}
                            </span>
                          )}
                          <span style={{ fontSize: 10, color: PRIORITY_COLORS[task.priority] }}>
                            {PRIORITY_LABELS[task.priority]}
                          </span>
                          {task.assigned_to && (
                            <span style={{ fontSize: 11, color: '#666' }}>
                              👤 {task.assigned_to}
                            </span>
                          )}
                          {task.recurrence && task.recurrence !== 'none' && (
                            <span
                              style={{
                                fontSize: 10,
                                color: '#0288D1',
                                background: '#E1F5FE',
                                borderRadius: 10,
                                padding: '1px 7px',
                              }}
                            >
                              🔁{' '}
                              {{
                                daily: 'Daily',
                                weekly: 'Weekly',
                                biweekly: 'Every 2 wks',
                                monthly: 'Monthly',
                              }[task.recurrence] || task.recurrence}
                            </span>
                          )}
                        </div>

                        {/* Reminder row — visible on all non-done tasks */}
                        {!isDone && (
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 8,
                              marginTop: 8,
                              flexWrap: 'wrap',
                            }}
                          >
                            <span style={{ fontSize: 11, color: '#888' }}>🔔 Next reminder:</span>
                            <select
                              disabled={snoozing[task.id]}
                              onChange={(e) => {
                                const hours = parseInt(e.target.value, 10);
                                if (hours) snoozeTask(task, hours);
                                e.target.value = '';
                              }}
                              defaultValue=""
                              style={{
                                padding: '3px 8px',
                                border: '1px solid #C8D4E4',
                                borderRadius: 5,
                                fontSize: 11,
                                color: '#555',
                                cursor: 'pointer',
                                background: 'white',
                              }}
                            >
                              <option value="" disabled>
                                Set reminder…
                              </option>
                              {SNOOZE_OPTIONS.map((o) => (
                                <option key={o.hours} value={o.hours}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                            {remindLabel && (
                              <span style={{ fontSize: 11, color: '#888', fontStyle: 'italic' }}>
                                Reminds: {remindLabel}
                              </span>
                            )}
                          </div>
                        )}

                        {/* Lead pipeline panel */}
                        {task.lead && !isDone && (
                          <LeadPanel task={task} token={token} onAdvanced={load} />
                        )}
                      </div>

                      {/* Actions */}
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        {task.calendar_url && !isDone && (
                          <a
                            href={task.calendar_url}
                            target="_blank"
                            rel="noreferrer"
                            title="Add to Google Calendar"
                            style={{
                              padding: '5px 10px',
                              background: '#4285F422',
                              color: '#4285F4',
                              borderRadius: 6,
                              textDecoration: 'none',
                              fontSize: 11,
                              fontWeight: 'bold',
                              border: '1px solid #4285F440',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            📅 Calendar
                          </a>
                        )}
                        <button
                          onClick={() => deleteTask(task)}
                          style={{
                            padding: '5px 10px',
                            background: '#ff000011',
                            color: RED,
                            border: '1px solid #ff000022',
                            borderRadius: 6,
                            cursor: 'pointer',
                            fontSize: 11,
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
