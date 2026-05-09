const STATUS_MAP = {
  received: { bg: '#e2e8f0', color: '#475569', label: 'Received' },
  processing: { bg: '#fff7ed', color: '#c2410c', label: 'Processing' },
  clarification: { bg: '#fef9c3', color: '#a16207', label: 'Needs Info' },
  review_pending: { bg: '#fff7ed', color: '#c2410c', label: 'Review Pending' },
  proposal_ready: { bg: '#eff6ff', color: '#1d4ed8', label: 'Proposal Ready' },
  quote_draft: { bg: '#eff6ff', color: '#1d4ed8', label: 'Proposal Draft' },
  quote_sent: { bg: '#f5f3ff', color: '#6d28d9', label: 'Sent for Approval' },
  proposal_sent: { bg: '#f5f3ff', color: '#6d28d9', label: 'Sent for Approval' },
  follow_up_1: { bg: '#fff7ed', color: '#c2410c', label: 'Follow-Up 1' },
  follow_up_2: { bg: '#fff7ed', color: '#c2410c', label: 'Follow-Up 2' },
  proposal_approved: { bg: '#f0fdf4', color: '#15803d', label: 'Proposal Approved ✓' },
  customer_approved: { bg: '#f0fdf4', color: '#15803d', label: 'Approved ✓' },
  proposal_declined: { bg: '#fef2f2', color: '#b91c1c', label: 'Changes Requested' },
  contract_ready: { bg: '#f0fdfa', color: '#0f766e', label: 'Contract Ready' },
  contract_sent: { bg: '#f0fdf4', color: '#047857', label: 'Contract Sent' },
  contract_signed: { bg: '#1B3A6B', color: '#ffffff', label: 'Contract Signed ✓' },
  signed: { bg: '#1B3A6B', color: '#ffffff', label: 'Contract Signed ✓' },
  site_visit_complete: { bg: '#f0f9ff', color: '#0369a1', label: 'Site Visited' },
  appointment_booked: { bg: '#fdf4ff', color: '#7e22ce', label: 'Appt Booked' },
  callback_done: { bg: '#fdf4ff', color: '#7e22ce', label: 'Callback Done' },
  complete: { bg: '#111827', color: '#ffffff', label: 'Complete ✓' },
  completed: { bg: '#111827', color: '#ffffff', label: 'Complete ✓' },
  error: { bg: '#fef2f2', color: '#b91c1c', label: 'Error' },
  lost: { bg: '#fef2f2', color: '#b91c1c', label: 'Lost' },
  rejected: { bg: '#fef2f2', color: '#b91c1c', label: 'Rejected' },
  closed: { bg: '#f1f5f9', color: '#64748b', label: 'Closed' },
};

export const getStatusStyle = (status) => {
  const key = (status || '').toLowerCase();
  return STATUS_MAP[key] || { bg: '#f1f5f9', color: '#64748b', label: status || 'Unknown' };
};

export const getStatusColor = (status) => getStatusStyle(status).color;
export const getStatusBg = (status) => getStatusStyle(status).bg;
export const getStatusLabel = (status) => getStatusStyle(status).label;
