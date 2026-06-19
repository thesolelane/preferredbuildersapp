// client/src/pages/Dashboard.jsx
import { useState, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { showToast } from '../utils/toast';

import CreateQuoteWizard from '../components/CreateQuoteWizard';
import { getStatusStyle } from '../utils/statusUtils';
import useRealtime from '../hooks/useRealtime';

const OUTCOME_BADGES = {
  lost_price: { label: 'Lost – Price', bg: '#FFEBEE', color: '#C62828' },
  lost_timing: { label: 'Lost – Timing', bg: '#FFF3E0', color: '#E65100' },
  lost_competitor: { label: 'Lost – Competitor', bg: '#F3E5F5', color: '#6A1B9A' },
  ghosted: { label: 'Ghosted', bg: '#ECEFF1', color: '#546E7A' },
  mistake: { label: 'Mistake / Duplicate', bg: '#EFEBE9', color: '#795548' },
  completed: { label: 'Completed', bg: '#E8F5E9', color: '#2E7D32' },
};

function outcomeBadge(reason) {
  return OUTCOME_BADGES[reason] || null;
}

export default function Dashboard({ token }) {
  const location = useLocation();
  const [jobs, setJobs] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 1024);
  const [showWizard, setShowWizard] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [submitTab, setSubmitTab] = useState('text');
  const [submitBusy, setSubmitBusy] = useState(false);
  const [manual, setManual] = useState({
    customerName: '',
    customerEmail: '',
    customerPhone: '',
    projectAddress: '',
    estimateText: '',
  });
  const [uploadFiles, setUploadFiles] = useState([]);
  const [manualFiles, setManualFiles] = useState([]);
  const [manualExtracting, setManualExtracting] = useState(false);
  const manualFileRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const [contactSuggestions, setContactSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [editingLead, setEditingLead] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [savingLead, setSavingLead] = useState(false);
  const suggestTimer = useRef(null);
  const esRef = useRef(null);

  const headers = { 'x-auth-token': token };

  function searchContacts(q) {
    clearTimeout(suggestTimer.current);
    if (!q || q.length < 2) {
      setContactSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    suggestTimer.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/contacts?search=${encodeURIComponent(q)}&limit=6`, { headers });
        const data = await r.json();
        setContactSuggestions(data.contacts || []);
        setShowSuggestions((data.contacts || []).length > 0);
      } catch {
        setContactSuggestions([]);
      }
    }, 200);
  }

  function pickContact(c) {
    setManual((m) => ({
      ...m,
      customerName: c.name || m.customerName,
      customerPhone: c.phone || m.customerPhone,
      customerEmail: c.email || m.customerEmail,
      projectAddress: c.address ? [c.address, c.city].filter(Boolean).join(', ') : m.projectAddress,
    }));
    setShowSuggestions(false);
    setContactSuggestions([]);
  }

  const openLeadEdit = (job) => {
    setEditingLead(job);
    setEditForm({
      name: job.customer_name || '',
      email: job.customer_email || '',
      phone: job.customer_phone || '',
      address: job.project_address || '',
      city: job.project_city || '',
    });
  };

  const saveLeadEdit = async () => {
    if (!editingLead) return;
    setSavingLead(true);
    const res = await fetch(`/api/jobs/${editingLead.id}/customer`, {
      method: 'PATCH',
      headers: { 'x-auth-token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...editForm, updateContact: false }),
    });
    setSavingLead(false);
    if (res.ok) {
      showToast('Lead updated');
      setEditingLead(null);
      loadDashboard();
    } else {
      const d = await res.json();
      showToast(d.error || 'Failed to save', 'error');
    }
  };

  const loadDashboard = () =>
    Promise.all([
      fetch('/api/jobs', { headers }).then((r) => r.json()),
      fetch('/api/jobs/stats/summary', { headers }).then((r) => r.json()),
    ])
      .then(([jobsData, statsData]) => {
        setJobs(jobsData.jobs || []);
        setStats(statsData);
        setLoading(false);
      })
      .catch(() => setLoading(false));

  const connectSSE = () => {
    if (esRef.current) esRef.current.close();
    const es = new EventSource(`/api/jobs/events?token=${encodeURIComponent(token)}`);
    es.addEventListener('job_updated', () => loadDashboard());
    es.onerror = () => {
      es.close();
      setTimeout(connectSSE, 5000);
    };
    esRef.current = es;
  };

  // Re-fetch whenever navigating to the dashboard
  useEffect(() => {
    const fn = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener('resize', fn);
    return () => window.removeEventListener('resize', fn);
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [location.key]);

  // SSE connection — set up once, auto-reconnect on error
  useEffect(() => {
    connectSSE();
    return () => {
      if (esRef.current) esRef.current.close();
    };
  }, []);

  // Re-fetch when tab becomes visible again
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') loadDashboard();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  // Live real-time dashboard updates via Socket.io
  useRealtime('dashboard', (update) => {
    if (
      [
        'signature',
        'customer_photo_upload',
        'customer_change_order',
        'manual_signature',
        'pipeline_update',
      ].includes(update.eventType)
    ) {
      loadDashboard();
    }
  });

  const [showArchived, setShowArchived] = useState(false);
  const [archivedJobs, setArchivedJobs] = useState([]);
  const [archiveModal, setArchiveModal] = useState(null);
  const [archiveReason, setArchiveReason] = useState('');
  const [archiveNote, setArchiveNote] = useState('');
  const [archiveBusy, setArchiveBusy] = useState(false);

  const openArchiveModal = (jobId, customerName, status) => {
    if (['complete', 'contract_signed'].includes(status)) {
      archiveCompleted(jobId);
      return;
    }
    setArchiveReason('');
    setArchiveNote('');
    setArchiveModal({ jobId, customerName });
  };

  const archiveCompleted = async (jobId) => {
    const res = await fetch(`/api/jobs/${jobId}`, {
      method: 'DELETE',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ closed_reason: 'completed' }),
    });
    if (res.ok) {
      setJobs(jobs.filter((j) => j.id !== jobId));
      setStats((prev) => (prev ? { ...prev, total: (prev.total || 1) - 1 } : prev));
      showToast('Completed job archived');
    } else {
      const data = await res.json();
      showToast(data.error || 'Failed to archive', 'error');
    }
  };

  const confirmArchive = async () => {
    if (!archiveModal) return;
    setArchiveBusy(true);
    const res = await fetch(`/api/jobs/${archiveModal.jobId}`, {
      method: 'DELETE',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        closed_reason: archiveReason || null,
        closed_note: archiveNote || null,
      }),
    });
    setArchiveBusy(false);
    if (res.ok) {
      setJobs(jobs.filter((j) => j.id !== archiveModal.jobId));
      setStats((prev) => (prev ? { ...prev, total: (prev.total || 1) - 1 } : prev));
      setArchiveModal(null);
      showToast('Job archived');
    } else {
      const data = await res.json();
      showToast(data.error || 'Failed to archive', 'error');
    }
  };

  const loadArchived = async () => {
    const res = await fetch('/api/jobs/archived/list', { headers });
    const data = await res.json();
    setArchivedJobs(data.jobs || []);
    setShowArchived(true);
  };

  const restoreJob = async (jobId) => {
    const res = await fetch(`/api/jobs/${jobId}/restore`, { method: 'POST', headers });
    if (res.ok) {
      setArchivedJobs(archivedJobs.filter((j) => j.id !== jobId));
      window.location.reload();
    }
  };

  const openNewJob = () => {
    setSubmitTab('text');
    setUploadFiles([]);
    setManualFiles([]);
    setManual({
      customerName: '',
      customerEmail: '',
      customerPhone: '',
      projectAddress: '',
      estimateText: '',
    });
    setShowManual(true);
  };

  const submitManual = async () => {
    setSubmitBusy(true);
    let finalText = manual.estimateText;

    // If files are attached, extract their content and append to scope text
    if (manualFiles.length > 0) {
      setManualExtracting(true);
      try {
        const fd = new FormData();
        manualFiles.forEach((f, i) => fd.append(`file_${i}`, f));
        const extractRes = await fetch('/api/jobs/extract-from-files', {
          method: 'POST',
          headers,
          body: fd,
        });
        if (extractRes.ok) {
          const { extractedText } = await extractRes.json();
          finalText = finalText.trim()
            ? `${finalText.trim()}\n\n--- EXTRACTED FROM ATTACHED FILES ---\n${extractedText}`
            : extractedText;
        } else {
          showToast('Could not read attached files — submitting text scope only', 'warning');
        }
      } catch {
        showToast('File extraction failed — submitting text scope only', 'warning');
      }
      setManualExtracting(false);
    }

    const res = await fetch('/api/jobs/manual', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...manual, estimateText: finalText }),
    });
    const data = await res.json();
    setSubmitBusy(false);
    if (res.ok) {
      setShowManual(false);
      setManualFiles([]);
      if (data.duplicateWarning?.length) {
        const names = data.duplicateWarning.map((d) => d.pb_number || d.id).join(', ');
        showToast(`⚠️ Possible duplicate — similar job already exists: ${names}`, 'warning');
      } else {
        showToast('Estimate submitted — processing now');
      }
      window.location.reload();
    } else {
      showToast(data.error || 'Error submitting estimate', 'error');
    }
  };

  const addFiles = (fileList) => {
    const newFiles = Array.from(fileList);
    setUploadFiles((prev) => {
      const existing = new Set(prev.map((f) => f.name + f.size));
      const toAdd = newFiles.filter((f) => !existing.has(f.name + f.size));
      return [...prev, ...toAdd];
    });
  };

  const removeFile = (index) => {
    setUploadFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const submitUpload = async () => {
    if (!uploadFiles.length) return showToast('Please select at least one file.', 'warning');
    setSubmitBusy(true);
    const form = new FormData();
    for (const file of uploadFiles) {
      form.append('estimate', file);
    }
    form.append('customerName', manual.customerName);
    form.append('customerEmail', manual.customerEmail);
    form.append('customerPhone', manual.customerPhone);
    form.append('projectAddress', manual.projectAddress);
    try {
      const res = await fetch('/api/jobs/upload-estimate', { method: 'POST', headers, body: form });
      const data = await res.json();
      setSubmitBusy(false);
      if (res.ok) {
        setShowManual(false);
        if (data.duplicateWarning?.length) {
          const names = data.duplicateWarning.map((d) => d.pb_number || d.id).join(', ');
          showToast(`⚠️ Possible duplicate — similar job already exists: ${names}`, 'warning');
        } else {
          showToast(
            uploadFiles.length > 1
              ? `${uploadFiles.length} files uploaded — processing now`
              : 'File uploaded — processing now',
          );
        }
        window.location.reload();
      } else {
        showToast(data.error || 'Error processing file(s)', 'error');
      }
    } catch (_e) {
      setSubmitBusy(false);
      showToast('Network error — please try again', 'error');
    }
  };

  if (loading) return <div style={{ padding: 40, color: '#888' }}>Loading...</div>;

  return (
    <div className="pb-page" style={{ padding: isMobile ? '16px 12px 90px' : '24px 28px 40px' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 28,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 'bold', color: '#1B3A6B', margin: 0 }}>
            Dashboard
          </h1>
          <p style={{ color: '#888', fontSize: 13, marginTop: 4 }}>
            Preferred Builders AI Contract System
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <button
              onClick={() => setShowWizard(true)}
              style={{
                background: '#1B3A6B',
                color: 'white',
                border: 'none',
                padding: '10px 20px',
                borderRadius: 8,
                cursor: 'pointer',
                fontWeight: 'bold',
              }}
            >
              + New S.O.W. Proposal
            </button>
            <div style={{ fontSize: 10, color: '#888', marginTop: 3, textAlign: 'center' }}>
              AI Estimation Wizard
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <button
              onClick={openNewJob}
              style={{
                background: 'white',
                color: '#1B3A6B',
                border: '1.5px solid #1B3A6B',
                padding: '9px 18px',
                borderRadius: 8,
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: 13,
              }}
            >
              New Job
            </button>
            <div style={{ fontSize: 10, color: '#888', marginTop: 3, textAlign: 'center' }}>
              Manual Entry
            </div>
          </div>
        </div>
      </div>

      {/* Stats cards */}
      {stats && (
        <div className="pb-stats-grid" style={{ marginBottom: 28 }}>
          {[
            { label: 'Total Jobs (YTD)', value: stats.total, icon: '📋' },
            { label: 'Proposals Done (YTD)', value: stats.thisMonth?.count || 0, icon: '📅' },
            {
              label: 'Pipeline Value',
              value: `$${(stats.totalValue || 0).toLocaleString()}`,
              icon: '💰',
            },
            {
              label: 'Won Revenue (YTD)',
              value: `$${(stats.thisMonth?.value || 0).toLocaleString()}`,
              icon: '📈',
            },
          ].map((card) => (
            <div
              key={card.label}
              style={{
                background: 'white',
                borderRadius: 10,
                padding: 20,
                boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
              }}
            >
              <div style={{ fontSize: 24, marginBottom: 8 }}>{card.icon}</div>
              <div style={{ fontSize: 22, fontWeight: 'bold', color: '#1B3A6B' }}>{card.value}</div>
              <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>{card.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Jobs list — cards on mobile, table on desktop */}
      {isMobile ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {jobs.length === 0 && (
            <div
              style={{
                background: 'white',
                borderRadius: 10,
                padding: 32,
                textAlign: 'center',
                color: '#888',
                boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
              }}
            >
              No jobs yet. Waiting for estimates from Hearth...
            </div>
          )}
          {jobs.map((job) => (
            <div
              key={job.id}
              style={{
                background: 'white',
                borderRadius: 10,
                boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
                padding: '14px 16px',
              }}
            >
              {/* Top row: PB# + status badge */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  marginBottom: 6,
                }}
              >
                <div>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: '#1B3A6B',
                      fontFamily: 'monospace',
                    }}
                  >
                    {job.pb_number || '—'}
                  </span>
                  {job.external_ref && (
                    <span style={{ fontSize: 10, color: '#aaa', marginLeft: 6 }}>
                      ref #{job.external_ref}
                    </span>
                  )}
                </div>
                <span
                  style={{
                    background: getStatusStyle(job.status).bg,
                    color: getStatusStyle(job.status).color,
                    padding: '3px 10px',
                    borderRadius: 20,
                    fontSize: 10,
                    fontWeight: 'bold',
                    whiteSpace: 'nowrap',
                    marginLeft: 8,
                  }}
                >
                  {getStatusStyle(job.status).label}
                </span>
              </div>
              {/* Customer name */}
              <div style={{ fontSize: 15, fontWeight: 600, color: '#111', marginBottom: 3 }}>
                {job.customer_name || '—'}
              </div>
              {/* Address */}
              {job.project_address && (
                <div style={{ fontSize: 12, color: '#666', marginBottom: 2 }}>
                  {job.project_address}
                </div>
              )}
              {/* Email */}
              {job.customer_email && (
                <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>
                  {job.customer_email}
                </div>
              )}
              {!job.project_address && !job.customer_email && <div style={{ marginBottom: 8 }} />}
              {/* Bottom row: value + date + actions */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  borderTop: '1px solid #f0f0f0',
                  paddingTop: 10,
                  marginTop: 4,
                }}
              >
                <div>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#1B3A6B' }}>
                    {job.total_value ? `$${job.total_value.toLocaleString()}` : '—'}
                  </span>
                  <span style={{ fontSize: 10, color: '#aaa', marginLeft: 8 }}>
                    {new Date(job.created_at).toLocaleDateString()}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <button
                    onClick={() => openArchiveModal(job.id, job.customer_name, job.status)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#bbb',
                      cursor: 'pointer',
                      fontSize: 11,
                      padding: '4px 6px',
                    }}
                  >
                    Archive
                  </button>
                  <button
                    onClick={() => openLeadEdit(job)}
                    title="Edit contact info"
                    style={{
                      background: 'none',
                      border: '1px solid #C8D4E4',
                      color: '#555',
                      cursor: 'pointer',
                      fontSize: 11,
                      padding: '4px 8px',
                      borderRadius: 5,
                    }}
                  >
                    ✏️ Contact
                  </button>
                  <Link
                    to={`/jobs/${job.id}`}
                    style={{
                      background: '#1B3A6B',
                      color: 'white',
                      fontSize: 12,
                      fontWeight: 'bold',
                      textDecoration: 'none',
                      padding: '6px 14px',
                      borderRadius: 6,
                    }}
                  >
                    View →
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div
          style={{
            background: 'white',
            borderRadius: 10,
            boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
            overflowX: 'auto',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
            <thead>
              <tr style={{ background: '#1B3A6B' }}>
                {['PB Number', 'Customer', 'Address', 'Value', 'Status', 'Date', ''].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: '12px 16px',
                      color: 'white',
                      textAlign: 'left',
                      fontSize: 12,
                      fontWeight: 'bold',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {jobs.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ padding: 32, textAlign: 'center', color: '#888' }}>
                    No jobs yet. Waiting for estimates from Hearth...
                  </td>
                </tr>
              )}
              {jobs.map((job, i) => (
                <tr
                  key={job.id}
                  style={{
                    borderBottom: '1px solid #f0f0f0',
                    background: i % 2 === 0 ? 'white' : '#fafafa',
                  }}
                >
                  <td style={{ padding: '12px 16px' }}>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color: '#1B3A6B',
                        fontFamily: 'monospace',
                      }}
                    >
                      {job.pb_number || '—'}
                    </div>
                    {job.external_ref && (
                      <div style={{ fontSize: 10, color: '#aaa', marginTop: 2 }}>
                        ref #{job.external_ref}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: '500' }}>
                    {job.customer_name || '—'}
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 12, color: '#555' }}>
                    {job.project_address || '—'}
                  </td>
                  <td
                    style={{
                      padding: '12px 16px',
                      fontSize: 13,
                      fontWeight: '500',
                      color: '#1B3A6B',
                    }}
                  >
                    {job.total_value ? `$${job.total_value.toLocaleString()}` : '—'}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <span
                      style={{
                        background: getStatusStyle(job.status).bg,
                        color: getStatusStyle(job.status).color,
                        padding: '3px 10px',
                        borderRadius: 20,
                        fontSize: 11,
                        fontWeight: 'bold',
                      }}
                    >
                      {getStatusStyle(job.status).label}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 11, color: '#888' }}>
                    {new Date(job.created_at).toLocaleDateString()}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <Link
                        to={`/jobs/${job.id}`}
                        style={{
                          color: '#1B3A6B',
                          fontSize: 12,
                          fontWeight: 'bold',
                          textDecoration: 'none',
                        }}
                      >
                        View →
                      </Link>
                      <button
                        onClick={() => openLeadEdit(job)}
                        title="Edit contact info"
                        style={{
                          background: 'none',
                          border: '1px solid #C8D4E4',
                          color: '#555',
                          cursor: 'pointer',
                          fontSize: 11,
                          padding: '2px 7px',
                          borderRadius: 4,
                        }}
                      >
                        ✏️ Contact
                      </button>
                      <button
                        onClick={() => openArchiveModal(job.id, job.customer_name, job.status)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#888',
                          cursor: 'pointer',
                          fontSize: 11,
                          padding: '2px 6px',
                          borderRadius: 4,
                        }}
                        title="Archive job"
                      >
                        Archive
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginTop: 12, textAlign: 'right' }}>
        <button
          onClick={loadArchived}
          style={{
            background: 'none',
            border: 'none',
            color: '#888',
            cursor: 'pointer',
            fontSize: 12,
            textDecoration: 'underline',
          }}
        >
          View Archived Jobs
        </button>
      </div>

      {/* Edit lead modal */}
      {editingLead && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1100,
          }}
          onClick={() => setEditingLead(null)}
        >
          <div
            style={{
              background: 'white',
              borderRadius: 12,
              padding: 24,
              width: '100%',
              maxWidth: 420,
              boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 18,
              }}
            >
              <h3 style={{ margin: 0, fontSize: 16, color: '#1B3A6B' }}>Edit Contact Info</h3>
              <button
                onClick={() => setEditingLead(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: 20,
                  cursor: 'pointer',
                  color: '#888',
                }}
              >
                ×
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[
                { label: 'Customer Name', key: 'name', placeholder: 'John Smith' },
                { label: 'Email', key: 'email', placeholder: 'john@email.com', type: 'email' },
                { label: 'Phone', key: 'phone', placeholder: '+1 555 000 0000' },
                { label: 'Project Address', key: 'address', placeholder: '123 Main St' },
                { label: 'City', key: 'city', placeholder: 'Boston' },
              ].map((f) => (
                <div key={f.key}>
                  <label
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: '#555',
                      display: 'block',
                      marginBottom: 4,
                    }}
                  >
                    {f.label}
                  </label>
                  <input
                    type={f.type || 'text'}
                    value={editForm[f.key] || ''}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
                    placeholder={f.placeholder}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      border: '1px solid #d0d7e2',
                      borderRadius: 6,
                      fontSize: 13,
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setEditingLead(null)}
                style={{
                  background: 'none',
                  border: '1px solid #ddd',
                  borderRadius: 6,
                  padding: '8px 18px',
                  fontSize: 13,
                  cursor: 'pointer',
                  color: '#555',
                }}
              >
                Cancel
              </button>
              <button
                onClick={saveLeadEdit}
                disabled={savingLead}
                style={{
                  background: savingLead ? '#aaa' : '#1B3A6B',
                  color: 'white',
                  border: 'none',
                  borderRadius: 6,
                  padding: '8px 22px',
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: savingLead ? 'default' : 'pointer',
                }}
              >
                {savingLead ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Archived jobs modal */}
      {showArchived && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: 'white',
              borderRadius: 12,
              padding: 24,
              width: 600,
              maxWidth: '95vw',
              maxHeight: '85vh',
              overflow: 'auto',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 20,
              }}
            >
              <h2 style={{ color: '#1B3A6B', margin: 0 }}>Archived Jobs</h2>
              <button
                onClick={() => setShowArchived(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: 20,
                  cursor: 'pointer',
                  color: '#888',
                }}
              >
                ×
              </button>
            </div>
            <p style={{ fontSize: 12, color: '#888', marginBottom: 16 }}>
              Archived jobs are permanently deleted after 90 days.
            </p>
            {archivedJobs.length === 0 ? (
              <p style={{ color: '#888', textAlign: 'center', padding: 20 }}>No archived jobs.</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f5f5f5' }}>
                    <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11 }}>
                      Customer
                    </th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11 }}>
                      Outcome
                    </th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11 }}>
                      Archived
                    </th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11 }}>
                      Days Left
                    </th>
                    <th style={{ padding: '8px 12px', fontSize: 11 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {archivedJobs.map((job) => {
                    const daysLeft = Math.max(
                      0,
                      90 -
                        Math.floor((Date.now() - new Date(job.archived_at).getTime()) / 86400000),
                    );
                    const badge = outcomeBadge(job.closed_reason);
                    return (
                      <tr key={job.id} style={{ borderBottom: '1px solid #eee' }}>
                        <td style={{ padding: '8px 12px', fontSize: 13 }}>
                          {job.customer_name || '—'}
                        </td>
                        <td style={{ padding: '8px 12px' }}>
                          {badge ? (
                            <span
                              style={{
                                padding: '2px 8px',
                                borderRadius: 10,
                                fontSize: 10,
                                fontWeight: 'bold',
                                background: badge.bg,
                                color: badge.color,
                              }}
                            >
                              {badge.label}
                            </span>
                          ) : (
                            <span style={{ fontSize: 10, color: '#bbb' }}>—</span>
                          )}
                        </td>
                        <td style={{ padding: '8px 12px', fontSize: 11, color: '#888' }}>
                          {new Date(job.archived_at).toLocaleDateString()}
                        </td>
                        <td
                          style={{
                            padding: '8px 12px',
                            fontSize: 11,
                            color: daysLeft < 14 ? '#C62828' : '#888',
                          }}
                        >
                          {daysLeft} days
                        </td>
                        <td style={{ padding: '8px 12px' }}>
                          <button
                            onClick={() => restoreJob(job.id)}
                            style={{
                              background: '#1B3A6B',
                              color: 'white',
                              border: 'none',
                              padding: '4px 12px',
                              borderRadius: 4,
                              cursor: 'pointer',
                              fontSize: 11,
                            }}
                          >
                            Restore
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Archive Outcome Modal */}
      {archiveModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1100,
          }}
        >
          <div
            style={{
              background: 'white',
              borderRadius: 12,
              padding: 24,
              width: 440,
              maxWidth: '95vw',
              maxHeight: '85vh',
              overflow: 'auto',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 16,
              }}
            >
              <h3 style={{ color: '#1B3A6B', margin: 0, fontSize: 18 }}>Archive Job</h3>
              <button
                onClick={() => setArchiveModal(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: 20,
                  cursor: 'pointer',
                  color: '#888',
                }}
              >
                ×
              </button>
            </div>
            <p style={{ fontSize: 13, color: '#555', marginBottom: 16 }}>
              Archiving <strong>{archiveModal.customerName || 'this job'}</strong>. Why is this job
              being closed?
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
              {[
                {
                  value: 'lost_price',
                  label: 'Lost – Price',
                  icon: '💰',
                  color: '#C62828',
                  bg: '#FFEBEE',
                },
                {
                  value: 'lost_timing',
                  label: 'Lost – Timing',
                  icon: '⏰',
                  color: '#E65100',
                  bg: '#FFF3E0',
                },
                {
                  value: 'lost_competitor',
                  label: 'Lost – Competitor',
                  icon: '🏢',
                  color: '#6A1B9A',
                  bg: '#F3E5F5',
                },
                { value: 'ghosted', label: 'Ghosted', icon: '👻', color: '#546E7A', bg: '#ECEFF1' },
                {
                  value: 'mistake',
                  label: 'Mistake / Duplicate',
                  icon: '🗑️',
                  color: '#795548',
                  bg: '#EFEBE9',
                },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setArchiveReason(archiveReason === opt.value ? '' : opt.value)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 14px',
                    borderRadius: 8,
                    cursor: 'pointer',
                    fontSize: 13,
                    fontWeight: 600,
                    background: archiveReason === opt.value ? opt.bg : '#fafafa',
                    color: archiveReason === opt.value ? opt.color : '#555',
                    border:
                      archiveReason === opt.value ? `2px solid ${opt.color}` : '2px solid #eee',
                    transition: 'all 0.15s',
                  }}
                >
                  <span style={{ fontSize: 18 }}>{opt.icon}</span>
                  {opt.label}
                </button>
              ))}
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4 }}>
                Note (optional)
              </label>
              <textarea
                value={archiveNote}
                onChange={(e) => setArchiveNote(e.target.value)}
                placeholder="Any details about this outcome..."
                rows={2}
                maxLength={500}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  border: '1px solid #ddd',
                  borderRadius: 6,
                  fontSize: 12,
                  boxSizing: 'border-box',
                  resize: 'vertical',
                  fontFamily: 'inherit',
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={confirmArchive}
                disabled={archiveBusy}
                style={{
                  flex: 1,
                  padding: '10px 16px',
                  borderRadius: 6,
                  cursor: archiveBusy ? 'not-allowed' : 'pointer',
                  fontWeight: 'bold',
                  fontSize: 13,
                  border: 'none',
                  background: archiveBusy ? '#888' : '#1B3A6B',
                  color: 'white',
                }}
              >
                {archiveBusy ? 'Archiving...' : 'Archive Job'}
              </button>
              <button
                onClick={() => setArchiveModal(null)}
                style={{
                  padding: '10px 16px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: 13,
                  background: '#f0f0f0',
                  color: '#555',
                  border: 'none',
                }}
              >
                Cancel
              </button>
            </div>
            <p style={{ fontSize: 10, color: '#aaa', marginTop: 10, textAlign: 'center' }}>
              Selecting a reason is optional but helps track why jobs are lost.
            </p>
          </div>
        </div>
      )}

      {/* Create Quote Wizard (guided AI flow) */}
      {showWizard && (
        <CreateQuoteWizard
          token={token}
          onClose={() => setShowWizard(false)}
          onSubmitted={() => {
            loadDashboard();
          }}
        />
      )}

      {/* New Job modal (quick paste/upload fallback) */}
      {showManual && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: 'white',
              borderRadius: 12,
              padding: 24,
              width: 580,
              maxWidth: '95vw',
              maxHeight: '90vh',
              overflow: 'auto',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 6,
              }}
            >
              <h2 style={{ color: '#1B3A6B', margin: 0, fontSize: 20 }}>New Job</h2>
              <button
                onClick={() => setShowManual(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: 22,
                  cursor: 'pointer',
                  color: '#888',
                }}
              >
                ×
              </button>
            </div>
            <p style={{ color: '#888', fontSize: 12, marginBottom: 20 }}>
              Submit an estimate any way you have it — Claude will extract the details
              automatically.
            </p>

            <div
              style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}
            >
              {/* Customer Name — with contact autocomplete */}
              <div style={{ position: 'relative' }}>
                <label style={{ fontSize: 11, color: '#555', display: 'block', marginBottom: 3 }}>
                  Customer Name
                </label>
                <input
                  value={manual.customerName}
                  onChange={(e) => {
                    setManual({ ...manual, customerName: e.target.value });
                    searchContacts(e.target.value);
                  }}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                  onFocus={() => {
                    if (contactSuggestions.length) setShowSuggestions(true);
                  }}
                  placeholder="John Smith"
                  autoComplete="off"
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    border: '1px solid #ddd',
                    borderRadius: 6,
                    fontSize: 12,
                    boxSizing: 'border-box',
                  }}
                />
                {showSuggestions && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '100%',
                      left: 0,
                      right: 0,
                      background: 'white',
                      border: '1px solid #C8D4E4',
                      borderRadius: 6,
                      boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
                      zIndex: 200,
                      maxHeight: 220,
                      overflowY: 'auto',
                    }}
                  >
                    {contactSuggestions.map((c) => (
                      <div
                        key={c.id}
                        onMouseDown={() => pickContact(c)}
                        style={{
                          padding: '8px 12px',
                          cursor: 'pointer',
                          borderBottom: '1px solid #f0f0f0',
                          fontSize: 12,
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = '#f0f6ff')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'white')}
                      >
                        <div style={{ fontWeight: 'bold', color: '#1B3A6B' }}>
                          {c.pb_customer_number ? `PB#${c.pb_customer_number} · ` : ''}
                          {c.name}
                        </div>
                        <div style={{ color: '#888', fontSize: 11, marginTop: 1 }}>
                          {[c.phone, c.email, c.address].filter(Boolean).join(' · ')}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Remaining fields */}
              {[
                { label: 'Customer Phone', key: 'customerPhone', placeholder: '+1 555 000 0000' },
                { label: 'Customer Email', key: 'customerEmail', placeholder: 'john@email.com' },
                {
                  label: 'Project Address',
                  key: 'projectAddress',
                  placeholder: '123 Main St, City, FL',
                },
              ].map((f) => (
                <div key={f.key}>
                  <label style={{ fontSize: 11, color: '#555', display: 'block', marginBottom: 3 }}>
                    {f.label}
                  </label>
                  <input
                    value={manual[f.key]}
                    onChange={(e) => setManual({ ...manual, [f.key]: e.target.value })}
                    placeholder={f.placeholder}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      border: '1px solid #ddd',
                      borderRadius: 6,
                      fontSize: 12,
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', borderBottom: '2px solid #f0f0f0', marginBottom: 16 }}>
              {[
                { id: 'text', label: '✏️ Paste Text' },
                { id: 'file', label: '📎 Upload File' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setSubmitTab(tab.id)}
                  style={{
                    padding: '8px 18px',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: 13,
                    fontWeight: submitTab === tab.id ? 'bold' : 'normal',
                    background: 'none',
                    color: submitTab === tab.id ? '#1B3A6B' : '#888',
                    borderBottom:
                      submitTab === tab.id ? '2px solid #1B3A6B' : '2px solid transparent',
                    marginBottom: -2,
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {submitTab === 'text' && (
              <div>
                <label style={{ fontSize: 11, color: '#555', display: 'block', marginBottom: 4 }}>
                  Estimate details — paste scope notes, a forwarded email, or type it out
                </label>
                <textarea
                  rows={9}
                  value={manual.estimateText}
                  onChange={(e) => setManual({ ...manual, estimateText: e.target.value })}
                  style={{
                    width: '100%',
                    padding: 10,
                    border: '1px solid #ddd',
                    borderRadius: 6,
                    fontSize: 12,
                    boxSizing: 'border-box',
                    resize: 'vertical',
                    fontFamily: 'inherit',
                  }}
                  placeholder={`e.g. New 2-story build — 3-bay garage 1st floor, living space 2nd floor\nMetal roof, board & batten siding, mini splits x3\nPermit included. Start date flexible.\nBudget: $350,000`}
                />

                {/* File attachment — optional alongside text */}
                <input
                  ref={manualFileRef}
                  type="file"
                  multiple
                  accept=".jpg,.jpeg,.png,.gif,.webp,.pdf"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const added = Array.from(e.target.files || []);
                    setManualFiles((prev) => {
                      const names = new Set(prev.map((f) => f.name + f.size));
                      return [...prev, ...added.filter((f) => !names.has(f.name + f.size))];
                    });
                    e.target.value = '';
                  }}
                />
                <div
                  style={{
                    marginTop: 8,
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 6,
                    alignItems: 'center',
                  }}
                >
                  <button
                    onClick={() => manualFileRef.current?.click()}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 5,
                      padding: '5px 10px',
                      background: manualFiles.length ? '#e8f0fe' : '#f4f6fb',
                      border: `1px solid ${manualFiles.length ? '#1B3A6B' : '#ddd'}`,
                      borderRadius: 6,
                      cursor: 'pointer',
                      fontSize: 11,
                      color: manualFiles.length ? '#1B3A6B' : '#666',
                    }}
                  >
                    📎{' '}
                    {manualFiles.length
                      ? `${manualFiles.length} file${manualFiles.length > 1 ? 's' : ''} attached`
                      : 'Attach Plans / Photos (optional)'}
                  </button>
                  {manualFiles.map((f, i) => (
                    <div
                      key={i}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        background: '#e8f0fe',
                        borderRadius: 20,
                        padding: '3px 8px',
                        fontSize: 10,
                        color: '#1B3A6B',
                      }}
                    >
                      <span
                        style={{
                          maxWidth: 100,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {f.name}
                      </span>
                      <button
                        onClick={() => setManualFiles((prev) => prev.filter((_, j) => j !== i))}
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          fontSize: 13,
                          lineHeight: 1,
                          padding: 0,
                          color: '#555',
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>

                <button
                  onClick={submitManual}
                  disabled={
                    submitBusy ||
                    manualExtracting ||
                    (!manual.estimateText.trim() && !manualFiles.length)
                  }
                  style={{
                    marginTop: 12,
                    width: '100%',
                    padding: 12,
                    background: submitBusy || manualExtracting ? '#888' : '#1B3A6B',
                    color: 'white',
                    border: 'none',
                    borderRadius: 6,
                    cursor: submitBusy || manualExtracting ? 'not-allowed' : 'pointer',
                    fontWeight: 'bold',
                    fontSize: 14,
                  }}
                >
                  {manualExtracting
                    ? '📖 Reading files...'
                    : submitBusy
                      ? '⏳ Processing with AI...'
                      : '🤖 Generate Proposal'}
                </button>
              </div>
            )}

            {submitTab === 'file' && (
              <div>
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
                  }}
                  style={{
                    border: `2px dashed ${dragOver ? '#1B3A6B' : '#ddd'}`,
                    borderRadius: 8,
                    padding: uploadFiles.length ? '16px 20px' : 32,
                    textAlign: 'center',
                    background: dragOver ? '#f0f4ff' : '#fafafa',
                    cursor: 'pointer',
                    marginBottom: 12,
                  }}
                  onClick={() => document.getElementById('estimate-file-input').click()}
                >
                  {uploadFiles.length > 0 ? (
                    <div>
                      <div
                        style={{ fontSize: 13, color: '#555', marginBottom: 10, fontWeight: 600 }}
                      >
                        {uploadFiles.length} file{uploadFiles.length > 1 ? 's' : ''} selected —
                        click or drop to add more
                      </div>
                      {uploadFiles.map((file, idx) => (
                        <div
                          key={idx}
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            background: 'white',
                            border: '1px solid #e5e7eb',
                            borderRadius: 6,
                            padding: '7px 10px',
                            marginBottom: 6,
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 8,
                              overflow: 'hidden',
                            }}
                          >
                            <span style={{ fontSize: 18 }}>
                              {file.type.includes('pdf') ? '📄' : '🖼️'}
                            </span>
                            <div style={{ overflow: 'hidden' }}>
                              <div
                                style={{
                                  fontSize: 12,
                                  fontWeight: 600,
                                  color: '#1B3A6B',
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  maxWidth: 260,
                                }}
                              >
                                {file.name}
                              </div>
                              <div style={{ fontSize: 11, color: '#aaa' }}>
                                {(file.size / 1024).toFixed(1)} KB
                              </div>
                            </div>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              removeFile(idx);
                            }}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: '#C62828',
                              cursor: 'pointer',
                              fontSize: 16,
                              padding: '0 4px',
                              flexShrink: 0,
                            }}
                            title="Remove file"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div>
                      <div style={{ fontSize: 36, marginBottom: 8 }}>📁</div>
                      <div style={{ fontWeight: 'bold', color: '#555', fontSize: 14 }}>
                        Drag & drop or click to browse
                      </div>
                      <div style={{ color: '#888', fontSize: 12, marginTop: 6 }}>
                        Select multiple files at once — PDF, JPG, PNG, HEIC, or .txt
                      </div>
                    </div>
                  )}
                  <input
                    id="estimate-file-input"
                    type="file"
                    accept=".pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,.txt"
                    multiple
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      if (e.target.files.length) {
                        addFiles(e.target.files);
                        e.target.value = '';
                      }
                    }}
                  />
                </div>
                <p style={{ fontSize: 11, color: '#888', marginBottom: 8, marginTop: 0 }}>
                  AI will read each file and extract all scope, line items, and dollar amounts
                  automatically. iPhone photos (HEIC) are supported.
                </p>
                <button
                  onClick={submitUpload}
                  disabled={submitBusy || !uploadFiles.length}
                  style={{
                    width: '100%',
                    padding: 12,
                    background: submitBusy || !uploadFiles.length ? '#888' : '#1B3A6B',
                    color: 'white',
                    border: 'none',
                    borderRadius: 6,
                    cursor: submitBusy || !uploadFiles.length ? 'not-allowed' : 'pointer',
                    fontWeight: 'bold',
                    fontSize: 14,
                  }}
                >
                  {submitBusy
                    ? `⏳ Uploading ${uploadFiles.length > 1 ? 'files' : 'file'}...`
                    : `🤖 Upload & Generate Proposal${uploadFiles.length > 1 ? ` (${uploadFiles.length} files)` : ''}`}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
