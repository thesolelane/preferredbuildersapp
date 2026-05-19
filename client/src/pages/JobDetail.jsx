// client/src/pages/JobDetail.jsx
import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { showToast } from '../utils/toast';
import { showConfirm } from '../utils/confirm';

import PhotosTab from '../components/PhotosTab';
import PaymentsTab from '../components/PaymentsTab';
import ActivityLog from '../components/ActivityLog';

import { STATUS_COLORS, STATUS_LABELS, BLUE } from '../components/job/constants';
import JobActionPanel from '../components/job/JobActionPanel';
import JobHistoryTab from '../components/job/JobHistoryTab';
import JobConversationTab from '../components/job/JobConversationTab';
import JobProposalTab from '../components/job/JobProposalTab';
import JobContractTab from '../components/job/JobContractTab';
import JobSignaturesTab from '../components/job/JobSignaturesTab';
import JobOverviewTab from '../components/job/JobOverviewTab';
import JobPurchaseOrdersTab from '../components/job/JobPurchaseOrdersTab';
import JobAssessmentTab from '../components/job/JobAssessmentTab';
import RfqModal from '../components/job/RfqModal';

export default function JobDetail({ token, userName }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [job, setJob] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [clarifications, setClarifications] = useState([]);
  const [auditLog, setAuditLog] = useState([]);
  const [sigSessions, setSigSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [note, setNote] = useState('');
  const [clarAnswer, setClarAnswer] = useState('');
  const [clarFiles, setClarFiles] = useState([]);
  const [clarExtracting, setClarExtracting] = useState(false);
  const clarFileRef = useRef(null);
  const [showJobFilesPicker, setShowJobFilesPicker] = useState(false);
  const [jobFiles, setJobFiles] = useState([]);
  const [jobFilesLoading, setJobFilesLoading] = useState(false);
  const [selectedJobFiles, setSelectedJobFiles] = useState(new Set());
  const [activeTab, setActiveTab] = useState('overview');
  const [editingLineItems, setEditingLineItems] = useState(null);
  const [savingLineItems, setSavingLineItems] = useState(false);
  const [expandedRows, setExpandedRows] = useState(new Set());

  const headers = { 'x-auth-token': token, 'Content-Type': 'application/json' };
  const currentUser = userName || localStorage.getItem('pb_user_name') || '';
  const [presenceEditor, setPresenceEditor] = useState(null);
  const [presenceAt, setPresenceAt] = useState(null);

  const [versionHistory, setVersionHistory] = useState([]);
  const [historySort, setHistorySort] = useState('desc');
  const [auditSort, setAuditSort] = useState('desc');
  const [marginData, setMarginData] = useState(null);
  const [marginLoading, setMarginLoading] = useState(false);
  const [pipelineCtx, setPipelineCtx] = useState(null);
  const [followUpTask, setFollowUpTask] = useState(null);
  const [ptResp, setPtResp] = useState({
    permit_paid_by: 'pb',
    engineer_paid_by: 'pb',
    architect_paid_by: 'pb',
  });
  const [savingPt, setSavingPt] = useState(false);

  const [editingCustomer, setEditingCustomer] = useState(false);
  const [customerForm, setCustomerForm] = useState({
    name: '',
    email: '',
    phone: '',
    address: '',
    city: '',
  });
  const [savingCustomer, setSavingCustomer] = useState(false);

  const userRole = localStorage.getItem('pb_user_role') || '';
  const canEditCustomer = ['admin', 'pm', 'system_admin'].includes(userRole);

  const [pos, setPOs] = useState([]);
  const [poLoading, setPOLoading] = useState(false);
  const [portalUrl, setPortalUrl] = useState(null);
  const [portalCopied, setPortalCopied] = useState(false);
  const [manualUploading, setManualUploading] = useState(false);
  const [manualUploadDone, setManualUploadDone] = useState(null);
  const [reviseFiles, setReviseFiles] = useState([]);
  const [reviseExtracting, setReviseExtracting] = useState(false);
  const reviseFileRef = useRef(null);
  const [newPO, setNewPO] = useState({
    vendor_name: '',
    description: '',
    category: 'materials',
    amount: '',
    status: 'draft',
    notes: '',
  });
  const [savingPO, setSavingPO] = useState(false);
  const [editingPO, setEditingPO] = useState(null);

  // ── RFQ state ────────────────────────────────────────────────────────────────
  const [rfqModal, setRfqModal] = useState(null);
  const [rfqList, setRfqList] = useState([]);
  const [rfqForm, setRfqForm] = useState({
    scopeText: '',
    vendorId: '',
    vendorName: '',
    vendorEmail: '',
    dueDate: '',
    generating: false,
    saving: false,
    sending: false,
  });
  const [vendors, setVendors] = useState([]);

  const openRfqModal = (li) => {
    setRfqForm({
      scopeText: li.description || '',
      vendorId: '',
      vendorName: '',
      vendorEmail: '',
      dueDate: '',
      generating: false,
      saving: false,
      sending: false,
    });
    setRfqModal({ trade: li.trade, baseCost: li.baseCost, description: li.description });
    if (!vendors.length) {
      fetch('/api/vendors', { headers: { 'x-auth-token': token } })
        .then((r) => r.json())
        .then((d) => setVendors(d.vendors || []))
        .catch(() => {});
    }
    fetch(`/api/rfq/${id}`, { headers: { 'x-auth-token': token } })
      .then((r) => r.json())
      .then((d) => setRfqList(Array.isArray(d) ? d : []))
      .catch(() => {});
  };

  const generateRfqScope = async () => {
    if (!rfqModal) return;
    setRfqForm((f) => ({ ...f, generating: true }));
    try {
      const res = await fetch('/api/rfq/generate', {
        method: 'POST',
        headers: { 'x-auth-token': token, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trade: rfqModal.trade,
          description: rfqModal.description,
          projectAddress: job?.project_address,
          customerName: job?.customer_name,
          baseCost: rfqModal.baseCost,
        }),
      });
      const data = await res.json();
      if (res.ok) setRfqForm((f) => ({ ...f, scopeText: data.scopeText, generating: false }));
      else {
        setRfqForm((f) => ({ ...f, generating: false }));
        showToast(data.error || 'Generation failed', 'error');
      }
    } catch {
      setRfqForm((f) => ({ ...f, generating: false }));
      showToast('Network error', 'error');
    }
  };

  const saveRfq = async () => {
    if (!rfqModal) return;
    setRfqForm((f) => ({ ...f, saving: true }));
    try {
      const res = await fetch('/api/rfq', {
        method: 'POST',
        headers: { 'x-auth-token': token, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_id: id,
          trade: rfqModal.trade,
          scope_text: rfqForm.scopeText,
          target_base_cost: rfqModal.baseCost,
          due_date: rfqForm.dueDate || null,
          vendor_id: rfqForm.vendorId || null,
          vendor_name: rfqForm.vendorName || null,
          vendor_email: rfqForm.vendorEmail || null,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setRfqList((prev) => [data, ...prev]);
        setRfqForm((f) => ({ ...f, saving: false }));
        showToast('RFQ saved as draft');
      } else {
        setRfqForm((f) => ({ ...f, saving: false }));
        showToast(data.error || 'Save failed', 'error');
      }
    } catch {
      setRfqForm((f) => ({ ...f, saving: false }));
      showToast('Network error', 'error');
    }
  };

  const sendRfq = async (rfqId) => {
    setRfqForm((f) => ({ ...f, sending: true }));
    try {
      const res = await fetch(`/api/rfq/${rfqId}/send`, {
        method: 'POST',
        headers: { 'x-auth-token': token },
      });
      const data = await res.json();
      if (res.ok) {
        setRfqList((prev) => prev.map((r) => (r.id === rfqId ? data : r)));
        setRfqForm((f) => ({ ...f, sending: false }));
        showToast(`RFQ emailed to ${data.vendor_email}`);
      } else {
        setRfqForm((f) => ({ ...f, sending: false }));
        showToast(data.error || 'Send failed', 'error');
      }
    } catch {
      setRfqForm((f) => ({ ...f, sending: false }));
      showToast('Network error', 'error');
    }
  };

  const deleteRfq = async (rfqId) => {
    await fetch(`/api/rfq/${rfqId}`, { method: 'DELETE', headers: { 'x-auth-token': token } });
    setRfqList((prev) => prev.filter((r) => r.id !== rfqId));
  };

  const loadPOs = () => {
    setPOLoading(true);
    fetch(`/api/purchase-orders?job_id=${id}`, { headers: { 'x-auth-token': token } })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        setPOs(d.purchase_orders || []);
        setPOLoading(false);
      })
      .catch(() => setPOLoading(false));
  };

  const load = () => {
    fetch(`/api/jobs/${id}`, { headers: { 'x-auth-token': token } })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data) => {
        setJob(data.job || null);
        setConversations(data.conversations || []);
        setClarifications(data.clarifications || []);
        setAuditLog(data.auditLog || []);
        setVersionHistory(data.versionHistory || []);
        setNote(data.job?.notes || '');
        setLoading(false);
        const jobData = data.job?.proposal_data?.job || {};
        setPtResp({
          permit_paid_by: jobData.permit_paid_by || 'pb',
          engineer_paid_by: jobData.engineer_paid_by || 'pb',
          architect_paid_by: jobData.architect_paid_by || 'pb',
        });
      })
      .catch(() => setLoading(false));
    fetch(`/api/signing/status/${id}`, { headers: { 'x-auth-token': token } })
      .then((r) => r.json())
      .then((data) => setSigSessions(data.sessions || []))
      .catch(() => {});
  };

  useEffect(() => {
    load();
  }, [id]);

  const openCustomerEdit = () => {
    if (!job) return;
    setCustomerForm({
      name: job.customer_name || '',
      email: job.customer_email || '',
      phone: job.customer_phone || '',
      address: job.project_address || '',
      city: job.project_city || '',
    });
    setEditingCustomer(true);
  };

  const saveCustomerInfo = async (updateContact) => {
    setSavingCustomer(true);
    try {
      const res = await fetch(`/api/jobs/${id}/customer`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ ...customerForm, updateContact }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        showToast(d.error || 'Failed to save customer info', 'error');
        return;
      }
      setEditingCustomer(false);
      load();
      showToast(
        updateContact
          ? 'Customer info saved and contact profile updated.'
          : 'Customer info saved for this job.',
        'success',
      );
    } catch {
      showToast('Network error — please try again.', 'error');
    } finally {
      setSavingCustomer(false);
    }
  };

  const handleCustomerSave = async () => {
    if (!customerForm.name.trim()) {
      showToast('Customer name is required.', 'error');
      return;
    }
    if (customerForm.email) {
      const emailOk = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/.test(
        customerForm.email.trim(),
      );
      if (!emailOk) {
        showToast(
          'Email address does not look right — check the format (e.g. name@gmail.com).',
          'error',
        );
        return;
      }
    }
    if (job.contact_id) {
      const contact = job.contact;
      const differs =
        (customerForm.name && customerForm.name !== (contact?.name || job.customer_name)) ||
        (customerForm.email && customerForm.email !== (contact?.email || job.customer_email)) ||
        (customerForm.phone && customerForm.phone !== (contact?.phone || job.customer_phone)) ||
        (customerForm.address &&
          customerForm.address !== (contact?.address || job.project_address)) ||
        (customerForm.city && customerForm.city !== (contact?.city || job.project_city));
      if (differs) {
        const confirmed = await showConfirm(
          "Would you also like to update this customer's contact profile with these new details?",
        );
        await saveCustomerInfo(confirmed);
        return;
      }
    }
    await saveCustomerInfo(false);
  };

  useEffect(() => {
    if (!id) return;
    setMarginLoading(true);
    fetch(`/api/jobs/${id}/margin`, { headers: { 'x-auth-token': token } })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        setMarginData(data);
        setMarginLoading(false);
      })
      .catch(() => {
        setMarginData(null);
        setMarginLoading(false);
      });
    fetch(`/api/analytics/job/${id}/context`, { headers: { 'x-auth-token': token } })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => setPipelineCtx(data))
      .catch(() => setPipelineCtx(null));
    fetch(`/api/tasks?job_id=${id}`, { headers: { 'x-auth-token': token } })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        const existing = (data.tasks || []).find(
          (t) => t.status !== 'done' && /reach.?out|follow.?up/i.test(t.title),
        );
        if (existing) setFollowUpTask(existing);
      })
      .catch(() => {});
  }, [id, token]);

  useEffect(() => {
    if (activeTab === 'purchase_orders') loadPOs();
  }, [activeTab, id]);

  useEffect(() => {
    const ping = () =>
      fetch(`/api/jobs/${id}/presence`, {
        method: 'POST',
        headers: { 'x-auth-token': token },
      }).catch(() => {});
    const poll = () =>
      fetch(`/api/jobs/${id}/presence`, { headers: { 'x-auth-token': token } })
        .then((r) => r.json())
        .then((d) => {
          if (d.editor && d.editor !== currentUser) {
            setPresenceEditor(d.editor);
            setPresenceAt(d.editedAt);
          } else {
            setPresenceEditor(null);
          }
        })
        .catch(() => {});
    ping();
    poll();
    const pingInterval = setInterval(ping, 30000);
    const pollInterval = setInterval(poll, 30000);
    return () => {
      clearInterval(pingInterval);
      clearInterval(pollInterval);
    };
  }, [id]);

  useEffect(() => {
    if (!job || !['processing', 'received'].includes(job.status)) return;
    const es = new EventSource(`/api/jobs/events?token=${encodeURIComponent(token)}`);
    es.addEventListener('job_updated', (e) => {
      try {
        const payload = JSON.parse(e.data);
        if (payload.jobId === id) load();
      } catch {
        load();
      }
    });
    const poll = setInterval(load, 8000);
    return () => {
      es.close();
      clearInterval(poll);
    };
  }, [job?.status, id]);

  // ── Actions ────────────────────────────────────────────────────────────────

  const sendForApproval = async () => {
    if (!(await showConfirm(`Send a proposal signing link to ${job.customer_email}?`))) return;
    setActionLoading(true);
    const res = await fetch(`/api/signing/send-proposal/${id}`, { method: 'POST', headers });
    const data = await res.json();
    if (res.ok) {
      load();
      showToast('Proposal signing link sent!');
    } else {
      showToast(data.error || 'Failed to send', 'error');
    }
    setActionLoading(false);
  };

  const approveProposal = async () => {
    if (
      !(await showConfirm(
        'Mark this proposal as approved? This will allow you to generate the contract.',
      ))
    )
      return;
    setActionLoading(true);
    const res = await fetch(`/api/jobs/${id}/mark-approved`, { method: 'POST', headers });
    const data = await res.json();
    if (res.ok) {
      load();
      showToast('Proposal marked as approved');
    } else {
      showToast(data.error || 'Failed to approve proposal', 'error');
    }
    setActionLoading(false);
  };

  const rejectProposal = async () => {
    if (
      !(await showConfirm(
        'Mark this proposal as rejected by the customer? The job will return to review so you can revise and resend.',
      ))
    )
      return;
    setActionLoading(true);
    const res = await fetch(`/api/jobs/${id}/reject-proposal`, { method: 'POST', headers });
    const data = await res.json();
    if (res.ok) {
      load();
      showToast('Proposal marked as rejected — job is back in review');
    } else {
      showToast(data.error || 'Failed to mark rejected', 'error');
    }
    setActionLoading(false);
  };

  const generateContract = async () => {
    if (!(await showConfirm('Generate contract from this approved proposal?'))) return;
    setActionLoading(true);
    const res = await fetch(`/api/jobs/${id}/approve`, { method: 'POST', headers });
    const data = await res.json();
    if (res.ok) {
      load();
      showToast('Contract generated');
    } else {
      showToast(data.error || 'Failed to generate contract', 'error');
    }
    setActionLoading(false);
  };

  const savePtResp = async () => {
    setSavingPt(true);
    const res = await fetch(`/api/jobs/${id}/pass-through-responsibility`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(ptResp),
    });
    const data = await res.json();
    if (res.ok) {
      showToast('Payment responsibility saved');
      load();
    } else {
      showToast(data.error || 'Failed to save', 'error');
    }
    setSavingPt(false);
  };

  const sendContractForSigning = async () => {
    if (!(await showConfirm(`Send contract signing link to ${job.customer_email}?`))) return;
    setActionLoading(true);
    const res = await fetch(`/api/signing/send-contract/${id}`, { method: 'POST', headers });
    const data = await res.json();
    if (res.ok) {
      load();
      showToast('Contract signing link sent!');
    } else {
      showToast(data.error || 'Failed to send', 'error');
    }
    setActionLoading(false);
  };

  const generatePortalLink = async () => {
    const res = await fetch(`/api/portal/generate/${id}`, { method: 'POST', headers });
    const data = await res.json();
    if (res.ok) {
      setPortalUrl(data.url);
      navigator.clipboard
        .writeText(data.url)
        .then(() => {
          setPortalCopied(true);
          setTimeout(() => setPortalCopied(false), 3000);
        })
        .catch(() => {});
      showToast('Customer portal link copied to clipboard!');
    } else {
      showToast(data.error || 'Failed to generate link', 'error');
    }
  };

  const uploadManualSignature = async (docType, file) => {
    if (!file) return;
    setManualUploading(true);
    setManualUploadDone(null);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('doc_type', docType);
    try {
      const res = await fetch(`/api/manual-signature/${id}`, {
        method: 'POST',
        headers: { 'x-auth-token': token },
        body: fd,
      });
      const data = await res.json();
      if (res.ok) {
        setManualUploadDone({ docType, filename: data.filename, path: data.path });
        showToast(
          `${docType === 'contract' ? 'Contract' : 'Proposal'} uploaded — job status updated`,
        );
        load();
      } else {
        showToast(data.error || 'Upload failed', 'error');
      }
    } catch {
      showToast('Upload failed', 'error');
    }
    setManualUploading(false);
  };

  const reprocessJob = async () => {
    if (
      !(await showConfirm(
        'Retry AI processing on this job? The original scope will be re-submitted to Claude.',
      ))
    )
      return;
    setActionLoading(true);
    const res = await fetch(`/api/jobs/${id}/reprocess`, { method: 'POST', headers });
    const data = await res.json();
    setActionLoading(false);
    if (res.ok) {
      load();
      showToast('Reprocessing started — refresh in a moment', 'info');
    } else {
      showToast(data.error || 'Failed to reprocess', 'error');
    }
  };

  const reviseEstimate = async () => {
    const currentVer = job.version || 1;
    const nextVer = currentVer + 1;

    if (reviseFiles.length > 0) {
      if (
        !(await showConfirm(
          `Re-run AI with new files for Revision ${nextVer}?\n\nThe AI will read your attached files and regenerate the estimate using the updated scope. Version ${currentVer} stays in the activity log.`,
        ))
      )
        return;
      setReviseExtracting(true);
      let extraContext = '';
      try {
        const fd = new FormData();
        reviseFiles.forEach((f, i) => fd.append(`file_${i}`, f));
        const extractRes = await fetch('/api/jobs/extract-from-files', {
          method: 'POST',
          headers,
          body: fd,
        });
        if (extractRes.ok) {
          const { extractedText } = await extractRes.json();
          extraContext = extractedText;
        } else {
          showToast('Could not read attached files — try again', 'error');
          setReviseExtracting(false);
          return;
        }
      } catch {
        showToast('File extraction failed — try again', 'error');
        setReviseExtracting(false);
        return;
      }
      setReviseExtracting(false);
      setActionLoading(true);
      const res = await fetch(`/api/jobs/${id}/reprocess`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ extraContext }),
      });
      const data = await res.json();
      setActionLoading(false);
      setReviseFiles([]);
      if (res.ok) {
        load();
        showToast('Re-running AI with new files — refresh in a moment', 'info');
      } else {
        showToast(data.error || 'Failed to reprocess with new files', 'error');
      }
      return;
    }

    if (
      !(await showConfirm(
        `Open Revision ${nextVer} for editing?\n\nThis will reopen the line-item editor so you can adjust trades, costs, and descriptions before generating a new proposal PDF. Version ${currentVer} stays in the activity log. The existing contract PDF will be cleared.`,
      ))
    )
      return;
    setActionLoading(true);
    const res = await fetch(`/api/jobs/${id}/revise`, { method: 'POST', headers });
    const data = await res.json();
    setActionLoading(false);
    if (res.ok) {
      load();
      showToast(`Version ${data.version} opened for editing — adjust line items below`, 'info');
    } else {
      showToast(data.error || 'Failed to revise estimate', 'error');
    }
  };

  const markComplete = async () => {
    if (!(await showConfirm('Mark this job as complete?'))) return;
    setActionLoading(true);
    await fetch(`/api/jobs/${id}/notes`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ notes: note, status: 'complete' }),
    });
    load();
    setActionLoading(false);
    showToast('Job marked complete');
  };

  const saveNote = async () => {
    await fetch(`/api/jobs/${id}/notes`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ notes: note }),
    });
    showToast('Note saved');
  };

  const startEditingLineItems = () => {
    const items = (job.proposal_data?.lineItems || []).map((li) => ({ ...li }));
    setEditingLineItems(items);
  };

  const updateLineItem = (idx, field, value) => {
    setEditingLineItems((prev) =>
      prev.map((li, i) => (i === idx ? { ...li, [field]: value } : li)),
    );
  };

  const addLineItem = () => {
    setEditingLineItems((prev) => [
      ...prev,
      { trade: '', baseCost: 0, description: '', note: '', scopeIncluded: [], scopeExcluded: [] },
    ]);
  };

  const removeLineItem = (idx) => {
    setEditingLineItems((prev) => prev.filter((_, i) => i !== idx));
    setExpandedRows((prev) => {
      const n = new Set(prev);
      n.delete(idx);
      return n;
    });
  };

  const toggleRowExpanded = (idx) => {
    setExpandedRows((prev) => {
      const n = new Set(prev);
      n.has(idx) ? n.delete(idx) : n.add(idx);
      return n;
    });
  };

  const addIncludedItem = (rowIdx) => {
    setEditingLineItems((prev) =>
      prev.map((li, i) =>
        i === rowIdx ? { ...li, scopeIncluded: [...(li.scopeIncluded || []), ''] } : li,
      ),
    );
  };

  const updateIncludedItem = (rowIdx, itemIdx, value) => {
    setEditingLineItems((prev) =>
      prev.map((li, i) =>
        i === rowIdx
          ? { ...li, scopeIncluded: li.scopeIncluded.map((v, j) => (j === itemIdx ? value : v)) }
          : li,
      ),
    );
  };

  const removeIncludedItem = (rowIdx, itemIdx) => {
    setEditingLineItems((prev) =>
      prev.map((li, i) =>
        i === rowIdx
          ? { ...li, scopeIncluded: li.scopeIncluded.filter((_, j) => j !== itemIdx) }
          : li,
      ),
    );
  };

  const saveLineItems = async () => {
    for (let i = 0; i < editingLineItems.length; i++) {
      const li = editingLineItems[i];
      if (!li.trade?.trim()) {
        showToast(`Row ${i + 1}: Trade name cannot be empty`, 'error');
        return;
      }
      if (li.baseCost === '' || li.baseCost === null || Number(li.baseCost) < 0) {
        showToast(`Row ${i + 1} (${li.trade}): Cost must be 0 or greater`, 'error');
        return;
      }
    }
    setSavingLineItems(true);
    const res = await fetch(`/api/jobs/${id}/line-items`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ lineItems: editingLineItems }),
    });
    const data = await res.json();
    setSavingLineItems(false);
    if (res.ok) {
      load();
      showToast('Line items saved');
    } else {
      showToast(data.error || 'Failed to save', 'error');
    }
  };

  const generateProposal = async () => {
    if (
      !(await showConfirm(
        'Generate the proposal PDF from these line items? This cannot be undone.',
      ))
    )
      return;
    setActionLoading(true);
    const res = await fetch(`/api/jobs/${id}/generate-proposal`, { method: 'POST', headers });
    const data = await res.json();
    setActionLoading(false);
    if (res.ok) {
      setEditingLineItems(null);
      load();
      showToast('Proposal generated!');
    } else {
      showToast(data.error || 'Failed to generate proposal', 'error');
    }
  };

  const multiplier = (() => {
    const pricing = job?.proposal_data?.pricing;
    return pricing?.markupMultiplier || 1.5813;
  })();

  const loadJobFiles = async () => {
    setJobFilesLoading(true);
    try {
      const res = await fetch(`/api/jobs/${id}/job-files`, { headers: { 'x-auth-token': token } });
      const data = await res.json();
      setJobFiles(data.files || []);
    } catch {
      showToast('Could not load uploaded files', 'error');
    }
    setJobFilesLoading(false);
  };

  const extractAndSubmitClarFromJobFiles = async (clarId) => {
    if (!selectedJobFiles.size) return;
    setClarExtracting(true);
    try {
      const selected = jobFiles.filter((f) => selectedJobFiles.has(f.id));
      const res = await fetch(`/api/jobs/${id}/extract-from-job-files`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          selectedFiles: selected.map((f) => ({ type: f.type, filename: f.filename })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Extraction failed', 'error');
        setClarExtracting(false);
        return;
      }
      const answer = clarAnswer.trim()
        ? `${clarAnswer.trim()}\n\n[From uploaded files:]\n${data.extractedText}`
        : `[Extracted from uploaded files:]\n${data.extractedText}`;
      setClarExtracting(false);
      setActionLoading(true);
      const submitRes = await fetch(`/api/jobs/${id}/clarify/${clarId}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ answer }),
      });
      const submitData = await submitRes.json();
      setClarAnswer('');
      setSelectedJobFiles(new Set());
      setShowJobFilesPicker(false);
      setActionLoading(false);
      load();
      if (submitData.allAnswered)
        showToast('All questions answered — generating proposal now', 'info');
    } catch {
      showToast('Extraction failed — check your connection', 'error');
      setClarExtracting(false);
    }
  };

  const submitClarAnswer = async (clarId) => {
    let answer = clarAnswer.trim();

    if (clarFiles.length > 0) {
      setClarExtracting(true);
      try {
        const fd = new FormData();
        clarFiles.forEach((f, i) => fd.append(`file_${i}`, f));
        const extractRes = await fetch('/api/jobs/extract-from-files', {
          method: 'POST',
          headers: { 'x-auth-token': token },
          body: fd,
        });
        if (extractRes.ok) {
          const { extractedText } = await extractRes.json();
          answer = answer
            ? `${answer}\n\n[From attached blueprints/images:]\n${extractedText}`
            : `[Extracted from attached blueprints/images:]\n${extractedText}`;
        } else {
          showToast('Could not read the attached images — try again', 'error');
          setClarExtracting(false);
          return;
        }
      } catch {
        showToast('Image extraction failed — check your connection', 'error');
        setClarExtracting(false);
        return;
      }
      setClarExtracting(false);
    }

    if (!answer) return;
    setActionLoading(true);
    const res = await fetch(`/api/jobs/${id}/clarify/${clarId}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ answer }),
    });
    const data = await res.json();
    setClarAnswer('');
    setClarFiles([]);
    setActionLoading(false);
    load();
    if (data.allAnswered) showToast('All questions answered — generating proposal now', 'info');
  };

  // ── Guards ─────────────────────────────────────────────────────────────────

  if (loading) return <div style={{ padding: 40, color: '#888' }}>Loading job...</div>;
  if (!job) return <div style={{ padding: 40, color: '#C62828' }}>Job not found.</div>;

  const statusColor = STATUS_COLORS[job.status] || '#888';
  const statusLabel = STATUS_LABELS[job.status] || job.status?.replace(/_/g, ' ').toUpperCase();
  const proposalData = job.proposal_data;
  const contractData = job.contract_data;

  const proposalSession = sigSessions.find((s) => s.doc_type === 'proposal');
  const contractSession = sigSessions.find((s) => s.doc_type === 'contract');

  const TABS = [
    'overview',
    'history',
    'payments',
    'purchase_orders',
    'photos',
    'signatures',
    'proposal',
    'contract',
    'conversation',
    'assessment',
  ];

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <div className="pb-page">
        <button
          onClick={() => navigate('/')}
          style={{
            background: 'none',
            border: 'none',
            color: BLUE,
            cursor: 'pointer',
            fontSize: 13,
            marginBottom: 16,
          }}
        >
          ← Back to Dashboard
        </button>

        <JobActionPanel
          job={job}
          statusColor={statusColor}
          statusLabel={statusLabel}
          token={token}
          presenceEditor={presenceEditor}
          presenceAt={presenceAt}
          actionLoading={actionLoading}
          proposalSession={proposalSession}
          contractSession={contractSession}
          sigSessions={sigSessions}
          ptResp={ptResp}
          setPtResp={setPtResp}
          savingPt={savingPt}
          savePtResp={savePtResp}
          editingLineItems={editingLineItems}
          setEditingLineItems={setEditingLineItems}
          expandedRows={expandedRows}
          clarifications={clarifications}
          clarAnswer={clarAnswer}
          setClarAnswer={setClarAnswer}
          clarFiles={clarFiles}
          setClarFiles={setClarFiles}
          clarFileRef={clarFileRef}
          clarExtracting={clarExtracting}
          showJobFilesPicker={showJobFilesPicker}
          setShowJobFilesPicker={setShowJobFilesPicker}
          jobFiles={jobFiles}
          jobFilesLoading={jobFilesLoading}
          selectedJobFiles={selectedJobFiles}
          setSelectedJobFiles={setSelectedJobFiles}
          loadJobFiles={loadJobFiles}
          extractAndSubmitClarFromJobFiles={extractAndSubmitClarFromJobFiles}
          multiplier={multiplier}
          reviseFiles={reviseFiles}
          setReviseFiles={setReviseFiles}
          reviseFileRef={reviseFileRef}
          reviseExtracting={reviseExtracting}
          savingLineItems={savingLineItems}
          sendForApproval={sendForApproval}
          approveProposal={approveProposal}
          rejectProposal={rejectProposal}
          generateContract={generateContract}
          sendContractForSigning={sendContractForSigning}
          reprocessJob={reprocessJob}
          markComplete={markComplete}
          reviseEstimate={reviseEstimate}
          generateProposal={generateProposal}
          startEditingLineItems={startEditingLineItems}
          updateLineItem={updateLineItem}
          updateIncludedItem={updateIncludedItem}
          removeLineItem={removeLineItem}
          removeIncludedItem={removeIncludedItem}
          addLineItem={addLineItem}
          addIncludedItem={addIncludedItem}
          toggleRowExpanded={toggleRowExpanded}
          saveLineItems={saveLineItems}
          submitClarAnswer={submitClarAnswer}
        />

        {/* Tab navigation */}
        <div className="pb-tabs" style={{ marginBottom: 16, borderBottom: '2px solid #eee' }}>
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: '8px 14px',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: activeTab === tab ? 'bold' : 'normal',
                color: activeTab === tab ? BLUE : '#888',
                borderBottom: activeTab === tab ? `2px solid ${BLUE}` : '2px solid transparent',
                marginBottom: -2,
                textTransform: 'capitalize',
              }}
            >
              {tab.replace(/_/g, ' ')}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div
          style={{
            background: 'white',
            borderRadius: 12,
            padding: 24,
            boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
          }}
        >
          {activeTab === 'history' && (
            <JobHistoryTab
              job={job}
              versionHistory={versionHistory}
              historySort={historySort}
              setHistorySort={setHistorySort}
              auditLog={auditLog}
              auditSort={auditSort}
              setAuditSort={setAuditSort}
              token={token}
            />
          )}

          {activeTab === 'payments' && (
            <div>
              <PaymentsTab jobId={id} token={token} />
              <ActivityLog jobId={id} token={token} />
            </div>
          )}

          {activeTab === 'purchase_orders' && (
            <JobPurchaseOrdersTab
              pos={pos}
              loadPOs={loadPOs}
              poLoading={poLoading}
              newPO={newPO}
              setNewPO={setNewPO}
              savingPO={savingPO}
              setSavingPO={setSavingPO}
              editingPO={editingPO}
              setEditingPO={setEditingPO}
              id={id}
              headers={headers}
            />
          )}

          {activeTab === 'photos' && <PhotosTab jobId={id} token={token} />}

          {activeTab === 'overview' && (
            <JobOverviewTab
              job={job}
              canEditCustomer={canEditCustomer}
              editingCustomer={editingCustomer}
              setEditingCustomer={setEditingCustomer}
              customerForm={customerForm}
              setCustomerForm={setCustomerForm}
              savingCustomer={savingCustomer}
              openCustomerEdit={openCustomerEdit}
              handleCustomerSave={handleCustomerSave}
              note={note}
              setNote={setNote}
              saveNote={saveNote}
            />
          )}

          {activeTab === 'signatures' && (
            <JobSignaturesTab
              sigSessions={sigSessions}
              job={job}
              token={token}
              onSuccess={load}
              portalUrl={portalUrl}
              portalCopied={portalCopied}
              generatePortalLink={generatePortalLink}
              manualUploading={manualUploading}
              manualUploadDone={manualUploadDone}
              uploadManualSignature={uploadManualSignature}
            />
          )}

          {activeTab === 'proposal' && (
            <JobProposalTab proposalData={proposalData} job={job} token={token} />
          )}

          {activeTab === 'contract' && (
            <JobContractTab contractData={contractData} job={job} token={token} />
          )}

          {activeTab === 'conversation' && <JobConversationTab conversations={conversations} />}

          {activeTab === 'assessment' && (
            <JobAssessmentTab
              job={job}
              marginData={marginData}
              marginLoading={marginLoading}
              pipelineCtx={pipelineCtx}
              followUpTask={followUpTask}
              setFollowUpTask={setFollowUpTask}
              openRfqModal={openRfqModal}
              headers={headers}
            />
          )}
        </div>
      </div>

      <RfqModal
        rfqModal={rfqModal}
        setRfqModal={setRfqModal}
        rfqForm={rfqForm}
        setRfqForm={setRfqForm}
        rfqList={rfqList}
        vendors={vendors}
        job={job}
        generateRfqScope={generateRfqScope}
        saveRfq={saveRfq}
        sendRfq={sendRfq}
        deleteRfq={deleteRfq}
      />
    </>
  );
}
