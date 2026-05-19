import React from 'react';
import { BLUE, ORANGE, RED, GREEN } from './constants';

function ReadReceiptBadge({ session, label }) {
  if (!session) return null;
  return (
    <div
      style={{
        background: '#f8f9ff',
        border: '1px solid #e0e7ff',
        borderRadius: 8,
        padding: 14,
        marginTop: 12,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 'bold',
          color: '#555',
          marginBottom: 8,
          textTransform: 'uppercase',
          letterSpacing: '.5px',
        }}
      >
        📬 {label} — Read Receipts
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 12, display: 'flex', gap: 8 }}>
          <span style={{ color: '#888', width: 80 }}>Sent:</span>
          <span style={{ color: '#333' }}>
            {session.email_sent_at ? new Date(session.email_sent_at).toLocaleString() : '—'}
          </span>
        </div>
        <div style={{ fontSize: 12, display: 'flex', gap: 8 }}>
          <span style={{ color: '#888', width: 80 }}>Opened:</span>
          {session.opened_at ? (
            <span style={{ color: GREEN, fontWeight: 'bold' }}>
              ✅ {new Date(session.opened_at).toLocaleString()} (IP: {session.opened_ip})
            </span>
          ) : (
            <span style={{ color: '#aaa' }}>Not yet opened</span>
          )}
        </div>
        <div style={{ fontSize: 12, display: 'flex', gap: 8 }}>
          <span style={{ color: '#888', width: 80 }}>Signed:</span>
          {session.signed_at ? (
            <span style={{ color: BLUE, fontWeight: 'bold' }}>
              ✍️ {new Date(session.signed_at).toLocaleString()} — {session.signer_name}
            </span>
          ) : (
            <span style={{ color: '#aaa' }}>Not yet signed</span>
          )}
        </div>
      </div>
    </div>
  );
}

export default function JobActionPanel({
  job,
  statusColor,
  statusLabel,
  token,
  presenceEditor,
  presenceAt,
  actionLoading,
  proposalSession,
  contractSession,
  sigSessions,
  ptResp,
  setPtResp,
  savingPt,
  savePtResp,
  editingLineItems,
  setEditingLineItems,
  expandedRows,
  clarifications,
  clarAnswer,
  setClarAnswer,
  clarFiles,
  setClarFiles,
  clarFileRef,
  clarExtracting,
  showJobFilesPicker,
  setShowJobFilesPicker,
  jobFiles,
  jobFilesLoading,
  selectedJobFiles,
  setSelectedJobFiles,
  loadJobFiles,
  extractAndSubmitClarFromJobFiles,
  multiplier,
  reviseFiles,
  setReviseFiles,
  reviseFileRef,
  reviseExtracting,
  savingLineItems,
  sendForApproval,
  approveProposal,
  rejectProposal,
  generateContract,
  sendContractForSigning,
  reprocessJob,
  markComplete,
  reviseEstimate,
  generateProposal,
  startEditingLineItems,
  updateLineItem,
  updateIncludedItem,
  removeLineItem,
  removeIncludedItem,
  addLineItem,
  addIncludedItem,
  toggleRowExpanded,
  saveLineItems,
  submitClarAnswer,
}) {
  const RadioRow = ({ label, fee, field }) => (
    <div
      style={{
        padding: '10px 12px',
        borderBottom: '1px solid #fde68a',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
      }}
    >
      <div style={{ minWidth: 180, fontSize: 12, fontWeight: 600, color: '#78350f' }}>
        {label}
        {fee && <span style={{ fontWeight: 400, color: '#92400e', marginLeft: 6 }}>({fee})</span>}
      </div>
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          fontSize: 12,
          cursor: 'pointer',
          color: ptResp[field] === 'pb' ? '#B45309' : '#555',
        }}
      >
        <input
          type="radio"
          name={field}
          value="pb"
          checked={ptResp[field] !== 'customer_direct'}
          onChange={() => setPtResp((p) => ({ ...p, [field]: 'pb' }))}
        />
        PB fronts — Owner reimburses
      </label>
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          fontSize: 12,
          cursor: 'pointer',
          color: ptResp[field] === 'customer_direct' ? '#166534' : '#555',
        }}
      >
        <input
          type="radio"
          name={field}
          value="customer_direct"
          checked={ptResp[field] === 'customer_direct'}
          onChange={() => setPtResp((p) => ({ ...p, [field]: 'customer_direct' }))}
        />
        Owner pays vendor directly
      </label>
    </div>
  );

  return (
    <>
      {/* Presence warning banner */}
      {presenceEditor && (
        <div
          style={{
            background: '#fffbeb',
            border: '1px solid #f59e0b',
            borderRadius: 8,
            padding: '10px 16px',
            marginBottom: 16,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            fontSize: 13,
            color: '#92400e',
            fontWeight: 600,
          }}
        >
          <span style={{ fontSize: 16 }}>⚠</span>
          <span>
            <strong>{presenceEditor}</strong> is also viewing this job
            {presenceAt
              ? ` — last active ${Math.max(1, Math.round((Date.now() - new Date(presenceAt + 'Z').getTime()) / 60000))} min ago`
              : ''}{' '}
            — coordinate before making changes.
          </span>
        </div>
      )}

      {/* Header card */}
      <div
        style={{
          background: 'white',
          borderRadius: 12,
          padding: 24,
          boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
          marginBottom: 20,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 'bold', color: BLUE, margin: 0 }}>
              {job.customer_name || 'Unknown Customer'}
            </h1>
            <div style={{ color: '#666', fontSize: 13, marginTop: 4 }}>{job.project_address}</div>
            <div style={{ color: '#888', fontSize: 11, marginTop: 2 }}>
              Job ID: {job.id?.slice(0, 8)}... &nbsp;|&nbsp;{' '}
              {new Date(job.created_at).toLocaleDateString()}
              {job.quote_number && (
                <span style={{ marginLeft: 8, color: BLUE, fontWeight: 'bold' }}>
                  &nbsp;|&nbsp; Proposal #{job.quote_number}
                  {job.version ? `/${job.version}` : ''}
                </span>
              )}
            </div>
          </div>
          <span
            style={{
              background: statusColor + '22',
              color: statusColor,
              padding: '6px 16px',
              borderRadius: 20,
              fontSize: 12,
              fontWeight: 'bold',
            }}
          >
            {statusLabel}
          </span>
        </div>

        {/* Key numbers */}
        <div
          style={{
            display: 'flex',
            gap: 24,
            marginTop: 20,
            paddingTop: 16,
            borderTop: '1px solid #eee',
            flexWrap: 'wrap',
          }}
        >
          <div>
            <div style={{ fontSize: 11, color: '#888' }}>Contract Value</div>
            <div style={{ fontSize: 20, fontWeight: 'bold', color: BLUE }}>
              {job.total_value ? `$${job.total_value.toLocaleString()}` : '—'}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#888' }}>Deposit (33%)</div>
            <div style={{ fontSize: 20, fontWeight: 'bold', color: ORANGE }}>
              {job.deposit_amount ? `$${job.deposit_amount.toLocaleString()}` : '—'}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#888' }}>Email</div>
            <div style={{ fontSize: 13, color: '#333', marginTop: 4 }}>
              {job.customer_email || '—'}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#888' }}>Phone</div>
            <div style={{ fontSize: 13, color: '#333', marginTop: 4 }}>
              {job.customer_phone || '—'}
            </div>
          </div>
        </div>

        {/* PDF links */}
        <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
          {job.proposal_pdf_path && (
            <a
              href={`/outputs/${job.proposal_pdf_path.split(/[\\/]/).pop()}?token=${encodeURIComponent(token)}`}
              target="_blank"
              rel="noreferrer"
              style={{
                padding: '7px 14px',
                background: '#3B82F620',
                color: '#3B82F6',
                borderRadius: 6,
                textDecoration: 'none',
                fontSize: 12,
                fontWeight: 'bold',
                border: '1px solid #3B82F640',
              }}
            >
              📄 View Proposal PDF
            </a>
          )}
          {job.contract_pdf_path && (
            <a
              href={`/outputs/${job.contract_pdf_path.split(/[\\/]/).pop()}?token=${encodeURIComponent(token)}`}
              target="_blank"
              rel="noreferrer"
              style={{
                padding: '7px 14px',
                background: '#05966920',
                color: '#059669',
                borderRadius: 6,
                textDecoration: 'none',
                fontSize: 12,
                fontWeight: 'bold',
                border: '1px solid #05966940',
              }}
            >
              📄 View Contract PDF
            </a>
          )}
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
          {/* Send proposal for approval */}
          {job.status === 'proposal_ready' && job.customer_email && (
            <button
              onClick={sendForApproval}
              disabled={actionLoading}
              style={{
                padding: '9px 18px',
                background: '#8B5CF6',
                color: 'white',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 'bold',
              }}
            >
              {actionLoading ? '...' : '📨 Send Proposal for Signature'}
            </button>
          )}

          {/* Resend proposal link */}
          {job.status === 'proposal_sent' && job.customer_email && (
            <button
              onClick={sendForApproval}
              disabled={actionLoading}
              style={{
                padding: '9px 18px',
                background: '#8B5CF620',
                color: '#8B5CF6',
                border: '1px solid #8B5CF640',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 'bold',
              }}
            >
              {actionLoading ? '...' : '📨 Resend Proposal Link'}
            </button>
          )}

          {/* Customer declined — resend revised proposal */}
          {job.status === 'proposal_declined' && job.customer_email && job.proposal_pdf_path && (
            <button
              onClick={sendForApproval}
              disabled={actionLoading}
              style={{
                padding: '9px 18px',
                background: '#8B5CF6',
                color: 'white',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 'bold',
              }}
            >
              {actionLoading ? '...' : '📨 Send Revised Proposal'}
            </button>
          )}

          {/* Manual approve */}
          {['proposal_ready', 'proposal_sent'].includes(job.status) && (
            <button
              onClick={approveProposal}
              disabled={actionLoading}
              style={{
                padding: '9px 18px',
                background: '#059669',
                color: 'white',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 'bold',
              }}
            >
              {actionLoading ? '...' : '✅ Mark Proposal Approved'}
            </button>
          )}

          {/* Customer rejected */}
          {['proposal_ready', 'proposal_sent'].includes(job.status) && (
            <button
              onClick={rejectProposal}
              disabled={actionLoading}
              style={{
                padding: '9px 18px',
                background: 'white',
                color: '#991b1b',
                border: '1.5px solid #fca5a5',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 'bold',
              }}
            >
              {actionLoading ? '...' : '❌ Customer Rejected'}
            </button>
          )}

          {/* Pass-through panel */}
          {job.status === 'proposal_approved' &&
            !job.contract_pdf_path &&
            (() => {
              const pj = job.proposal_data?.job || {};
              const hasAny = pj.has_permit || pj.has_engineer || pj.has_architect;
              if (!hasAny) return null;
              return (
                <div
                  style={{
                    background: '#fffbeb',
                    border: '1px solid #fbbf24',
                    borderRadius: 8,
                    padding: 0,
                    width: '100%',
                    marginBottom: 8,
                  }}
                >
                  <div
                    style={{
                      background: '#fef3c7',
                      borderBottom: '1px solid #fbbf24',
                      padding: '8px 12px',
                      borderRadius: '8px 8px 0 0',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <div>
                      <span style={{ fontWeight: 'bold', fontSize: 12, color: '#92400e' }}>
                        Pass-Through Cost Responsibility
                      </span>
                      <span style={{ fontSize: 11, color: '#78350f', marginLeft: 8 }}>
                        — must be agreed before generating the contract
                      </span>
                    </div>
                    <button
                      onClick={savePtResp}
                      disabled={savingPt}
                      style={{
                        padding: '4px 12px',
                        background: '#D97706',
                        color: 'white',
                        border: 'none',
                        borderRadius: 5,
                        cursor: 'pointer',
                        fontSize: 11,
                        fontWeight: 'bold',
                      }}
                    >
                      {savingPt ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                  {pj.has_permit && (
                    <RadioRow
                      label="Building Permit Fees"
                      fee={pj.permit_fee}
                      field="permit_paid_by"
                    />
                  )}
                  {pj.has_engineer && (
                    <RadioRow
                      label="Engineering Fees"
                      fee={pj.engineer_fee}
                      field="engineer_paid_by"
                    />
                  )}
                  {pj.has_architect && (
                    <RadioRow
                      label="Architectural / Design Fees"
                      fee={pj.architect_fee}
                      field="architect_paid_by"
                    />
                  )}
                </div>
              );
            })()}

          {/* Generate contract */}
          {['proposal_approved'].includes(job.status) && !job.contract_pdf_path && (
            <button
              onClick={generateContract}
              disabled={actionLoading}
              style={{
                padding: '9px 18px',
                background: '#059669',
                color: 'white',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 'bold',
              }}
            >
              {actionLoading ? 'Generating...' : '📋 Generate Contract'}
            </button>
          )}

          {/* Auto-gen note */}
          {job.status === 'proposal_approved' && job.contract_pdf_path && (
            <span style={{ fontSize: 12, color: '#059669', padding: '9px 0', fontWeight: 'bold' }}>
              ✅ Contract auto-generated
            </span>
          )}

          {/* Send contract for signing */}
          {job.status === 'contract_ready' && job.customer_email && (
            <button
              onClick={sendContractForSigning}
              disabled={actionLoading}
              style={{
                padding: '9px 18px',
                background: '#047857',
                color: 'white',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 'bold',
              }}
            >
              {actionLoading ? '...' : '📧 Send Contract for Signature'}
            </button>
          )}

          {/* Resend contract link */}
          {job.status === 'contract_sent' && job.customer_email && (
            <button
              onClick={sendContractForSigning}
              disabled={actionLoading}
              style={{
                padding: '9px 18px',
                background: '#04785720',
                color: '#047857',
                border: '1px solid #04785740',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 'bold',
              }}
            >
              {actionLoading ? '...' : '📧 Resend Contract Link'}
            </button>
          )}

          {/* Retry failed job */}
          {job.status === 'error' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button
                onClick={reprocessJob}
                disabled={actionLoading}
                style={{
                  padding: '9px 18px',
                  background: ORANGE,
                  color: 'white',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 'bold',
                }}
              >
                {actionLoading ? 'Retrying...' : '🔄 Retry AI Processing'}
              </button>
              {job.error_message && (
                <div
                  style={{
                    background: '#FEE2E2',
                    border: '1px solid #FCA5A5',
                    borderRadius: 6,
                    padding: '8px 12px',
                    fontSize: 12,
                    color: '#991B1B',
                    maxWidth: 420,
                  }}
                >
                  <strong>Error:</strong> {job.error_message}
                </div>
              )}
            </div>
          )}

          {/* Mark complete */}
          {job.status === 'contract_signed' && (
            <button
              onClick={markComplete}
              disabled={actionLoading}
              style={{
                padding: '9px 18px',
                background: BLUE,
                color: 'white',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 'bold',
              }}
            >
              {actionLoading ? '...' : '🎉 Mark Job Complete'}
            </button>
          )}

          {/* Revise estimate */}
          {(job.proposal_pdf_path || job.proposal_data) &&
            !['received', 'processing', 'error', 'clarification'].includes(job.status) && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <input
                  ref={reviseFileRef}
                  type="file"
                  multiple
                  accept=".jpg,.jpeg,.png,.gif,.webp,.pdf"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const added = Array.from(e.target.files || []);
                    setReviseFiles((prev) => {
                      const names = new Set(prev.map((f) => f.name + f.size));
                      return [...prev, ...added.filter((f) => !names.has(f.name + f.size))];
                    });
                    e.target.value = '';
                  }}
                />
                {reviseFiles.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {reviseFiles.map((f, i) => (
                      <div
                        key={i}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 3,
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
                          onClick={() => setReviseFiles((prev) => prev.filter((_, j) => j !== i))}
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
                )}
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button
                    onClick={reviseEstimate}
                    disabled={actionLoading || reviseExtracting}
                    style={{
                      padding: '9px 18px',
                      background: 'white',
                      color: ORANGE,
                      border: `2px solid ${ORANGE}`,
                      borderRadius: 6,
                      cursor: actionLoading || reviseExtracting ? 'not-allowed' : 'pointer',
                      fontSize: 12,
                      fontWeight: 'bold',
                    }}
                  >
                    {reviseExtracting
                      ? '📖 Reading files...'
                      : actionLoading
                        ? '...'
                        : reviseFiles.length > 0
                          ? `🔄 Re-run AI with New Files (v${(job.version || 1) + 1})`
                          : `✏️ Revise Estimate (v${job.version || 1})`}
                  </button>
                  <button
                    onClick={() => reviseFileRef.current?.click()}
                    title="Attach updated plans or photos to re-run AI on the revised scope"
                    style={{
                      padding: '8px 12px',
                      background: reviseFiles.length ? '#e8f0fe' : '#f4f6fb',
                      border: `1px solid ${reviseFiles.length ? '#1B3A6B' : '#ddd'}`,
                      borderRadius: 6,
                      cursor: 'pointer',
                      fontSize: 13,
                      color: reviseFiles.length ? '#1B3A6B' : '#888',
                    }}
                  >
                    📎
                  </button>
                </div>
                {reviseFiles.length > 0 && (
                  <div style={{ fontSize: 10, color: '#888' }}>
                    Files attached — AI will read them and regenerate the estimate
                  </div>
                )}
              </div>
            )}
        </div>

        {/* Read receipt inline previews */}
        {proposalSession && ['proposal_sent', 'proposal_approved'].includes(job.status) && (
          <ReadReceiptBadge session={proposalSession} label="Proposal" />
        )}
        {contractSession && ['contract_sent', 'contract_signed'].includes(job.status) && (
          <ReadReceiptBadge session={contractSession} label="Contract" />
        )}
      </div>

      {/* Proposal Declined Banner */}
      {job.status === 'proposal_declined' &&
        (() => {
          const declinedSession = sigSessions.find(
            (s) => s.doc_type === 'proposal' && s.status === 'declined',
          );
          return (
            <div
              style={{
                background: '#FEF2F2',
                border: `2px solid ${RED}`,
                borderRadius: 10,
                padding: '18px 20px',
                marginBottom: 16,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <span style={{ fontSize: 20 }}>❌</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, color: RED, fontSize: 14, marginBottom: 4 }}>
                    Customer Requested Changes
                  </div>
                  {declinedSession?.decline_reason ? (
                    <div
                      style={{
                        background: 'white',
                        border: '1px solid #fca5a5',
                        borderRadius: 6,
                        padding: '10px 14px',
                        fontSize: 13,
                        color: '#333',
                        lineHeight: 1.6,
                        whiteSpace: 'pre-wrap',
                      }}
                    >
                      {declinedSession.decline_reason}
                    </div>
                  ) : (
                    <div style={{ fontSize: 13, color: '#666' }}>
                      No written comments were provided.
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: '#888', marginTop: 8 }}>
                    Revise the estimate and resend the proposal to continue.
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

      {/* Processing indicator */}
      {['processing', 'received'].includes(job.status) && (
        <div
          style={{
            background: '#FFF8F0',
            border: `2px solid ${ORANGE}`,
            borderRadius: 10,
            padding: '18px 20px',
            marginBottom: 16,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <span style={{ fontSize: 20 }}>⚙️</span>
            <div>
              <div style={{ fontWeight: 700, color: ORANGE, fontSize: 14 }}>
                AI Processing in Progress
              </div>
              <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
                Analyzing scope, extracting line items, and calculating costs — this takes 30–90
                seconds. This page will update automatically when done.
              </div>
            </div>
          </div>
          <div style={{ height: 8, background: '#fde8c8', borderRadius: 4, overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                borderRadius: 4,
                background: `linear-gradient(90deg, ${ORANGE}, #f59e0b)`,
                animation: 'pb-progress 2s ease-in-out infinite',
                width: '40%',
              }}
            />
          </div>
          <style>{`
            @keyframes pb-progress {
              0%   { transform: translateX(-100%); width: 40%; }
              50%  { width: 70%; }
              100% { transform: translateX(280%); width: 40%; }
            }
          `}</style>
        </div>
      )}

      {/* Flagged items */}
      {job.flagged_items?.length > 0 && (
        <div
          style={{
            background: '#FFF8F0',
            border: `1px solid ${ORANGE}`,
            borderRadius: 8,
            padding: 14,
            marginBottom: 16,
            fontSize: 13,
          }}
        >
          <strong style={{ color: ORANGE }}>
            ⚠️ {job.flagged_items.length} item(s) flagged for review:
          </strong>
          <ul style={{ margin: '6px 0 0 16px', color: '#5D3A00' }}>
            {job.flagged_items.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Review Pending — Line Item Editor */}
      {job.status === 'review_pending' && (
        <div
          style={{
            background: '#FFF8F0',
            border: `2px solid ${ORANGE}`,
            borderRadius: 10,
            padding: 20,
            marginBottom: 16,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 14,
            }}
          >
            <div>
              <strong style={{ color: ORANGE, fontSize: 15 }}>
                ✏️ Review Extracted Line Items
              </strong>
              <div style={{ fontSize: 12, color: '#777', marginTop: 2 }}>
                Edit costs or descriptions before generating the proposal PDF.
              </div>
              <div style={{ display: 'flex', gap: 16, marginTop: 6, flexWrap: 'wrap' }}>
                {['Sub O&P 15%', 'GC O&P 25%', 'Contingency 10%'].map((t) => (
                  <span
                    key={t}
                    style={{
                      fontSize: 11,
                      background: '#fff3e0',
                      color: '#b45309',
                      borderRadius: 4,
                      padding: '2px 8px',
                      fontWeight: 600,
                    }}
                  >
                    {t}
                  </span>
                ))}
                <span
                  style={{
                    fontSize: 11,
                    background: '#e0e7ff',
                    color: '#3730a3',
                    borderRadius: 4,
                    padding: '2px 8px',
                    fontWeight: 700,
                  }}
                >
                  = {multiplier.toFixed(4)}× multiplier
                </span>
              </div>
            </div>
            {!editingLineItems && (
              <button
                onClick={startEditingLineItems}
                style={{
                  padding: '8px 16px',
                  background: ORANGE,
                  color: 'white',
                  border: 'none',
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                ✏️ Edit Line Items
              </button>
            )}
          </div>

          {/* Read-only summary */}
          {!editingLineItems && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                  <th
                    style={{
                      textAlign: 'left',
                      padding: '6px 8px',
                      color: '#555',
                      fontWeight: 600,
                    }}
                  >
                    Trade
                  </th>
                  <th
                    style={{
                      textAlign: 'right',
                      padding: '6px 8px',
                      color: '#555',
                      fontWeight: 600,
                    }}
                  >
                    Sub Cost
                  </th>
                  <th
                    style={{
                      textAlign: 'right',
                      padding: '6px 8px',
                      color: '#555',
                      fontWeight: 600,
                    }}
                  >
                    Client Price
                  </th>
                </tr>
              </thead>
              <tbody>
                {(job.proposal_data?.lineItems || []).map((li, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ padding: '7px 8px', color: '#333' }}>
                      {li.trade}
                      {li.note && (
                        <div
                          style={{
                            fontSize: 11,
                            color: '#92400e',
                            fontStyle: 'italic',
                            marginTop: 2,
                          }}
                        >
                          📝 {li.note}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '7px 8px', textAlign: 'right', color: '#777' }}>
                      ${(li.baseCost || 0).toLocaleString()}
                    </td>
                    <td
                      style={{
                        padding: '7px 8px',
                        textAlign: 'right',
                        fontWeight: 600,
                        color: BLUE,
                      }}
                    >
                      ${(li.finalPrice || 0).toLocaleString()}
                    </td>
                  </tr>
                ))}
                <tr style={{ borderTop: '2px solid #e5e7eb', background: '#fff7ed' }}>
                  <td colSpan={2} style={{ padding: '8px', fontWeight: 700, color: '#333' }}>
                    Estimated Total
                  </td>
                  <td
                    style={{
                      padding: '8px',
                      textAlign: 'right',
                      fontWeight: 700,
                      color: ORANGE,
                      fontSize: 15,
                    }}
                  >
                    ${(job.proposal_data?.totalValue || job.total_value || 0).toLocaleString()}
                  </td>
                </tr>
                {job.proposal_data?.pricing?.pricePerSqft && (
                  <tr
                    style={{
                      background: job.proposal_data.pricing.sqftWarning
                        ? job.proposal_data.pricing.sqftWarning === 'below'
                          ? '#fff3cd'
                          : '#fde8e8'
                        : '#f0f9f0',
                    }}
                  >
                    <td colSpan={2} style={{ padding: '6px 8px', fontSize: 12, color: '#555' }}>
                      Price per sq ft
                      {job.proposal_data.pricing.sqftWarning && (
                        <span
                          style={{
                            marginLeft: 8,
                            fontWeight: 600,
                            color:
                              job.proposal_data.pricing.sqftWarning === 'below'
                                ? '#92400e'
                                : '#991b1b',
                          }}
                        >
                          ⚠️{' '}
                          {job.proposal_data.pricing.sqftWarning === 'below'
                            ? `Below target ($${job.proposal_data.pricing.sqftTargetLow}–$${job.proposal_data.pricing.sqftTargetHigh}/sqft)`
                            : `Above target ($${job.proposal_data.pricing.sqftTargetLow}–$${job.proposal_data.pricing.sqftTargetHigh}/sqft)`}
                        </span>
                      )}
                    </td>
                    <td
                      style={{
                        padding: '6px 8px',
                        textAlign: 'right',
                        fontWeight: 600,
                        fontSize: 13,
                        color: job.proposal_data.pricing.sqftWarning
                          ? job.proposal_data.pricing.sqftWarning === 'below'
                            ? '#92400e'
                            : '#991b1b'
                          : '#166534',
                      }}
                    >
                      ${job.proposal_data.pricing.pricePerSqft}/sqft
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}

          {/* Editable line items */}
          {editingLineItems && (
            <div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                    <th
                      style={{
                        textAlign: 'left',
                        padding: '6px 4px',
                        color: '#555',
                        fontWeight: 600,
                        width: '30%',
                      }}
                    >
                      Trade
                    </th>
                    <th
                      style={{
                        textAlign: 'right',
                        padding: '6px 4px',
                        color: '#555',
                        fontWeight: 600,
                        width: '18%',
                      }}
                    >
                      Sub Cost ($)
                    </th>
                    <th
                      style={{
                        textAlign: 'right',
                        padding: '6px 4px',
                        color: '#555',
                        fontWeight: 600,
                        width: '18%',
                      }}
                    >
                      Client Price
                    </th>
                    <th
                      style={{
                        textAlign: 'left',
                        padding: '6px 4px',
                        color: '#555',
                        fontWeight: 600,
                      }}
                    >
                      Description
                    </th>
                    <th style={{ width: 32 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {editingLineItems.map((li, i) => {
                    const tradeErr = !li.trade?.trim();
                    const costErr =
                      li.baseCost === '' || li.baseCost === null || Number(li.baseCost) < 0;
                    const isExpanded = expandedRows.has(i);
                    const includedItems = li.scopeIncluded || [];
                    return (
                      <React.Fragment key={i}>
                        <tr
                          style={{
                            borderBottom: isExpanded ? 'none' : '1px solid #f0f0f0',
                            verticalAlign: 'top',
                          }}
                        >
                          <td style={{ padding: '5px 4px' }}>
                            <input
                              value={li.trade}
                              onChange={(e) => updateLineItem(i, 'trade', e.target.value)}
                              title={tradeErr ? 'Trade name is required' : ''}
                              style={{
                                width: '100%',
                                padding: '5px 7px',
                                border: `1px solid ${tradeErr ? RED : '#ddd'}`,
                                borderRadius: 4,
                                fontSize: 12,
                                boxSizing: 'border-box',
                                background: tradeErr ? '#fff5f5' : 'white',
                              }}
                            />
                          </td>
                          <td style={{ padding: '5px 4px' }}>
                            <input
                              type="number"
                              value={li.baseCost}
                              onChange={(e) => updateLineItem(i, 'baseCost', e.target.value)}
                              title={costErr ? 'Cost must be 0 or greater' : ''}
                              style={{
                                width: '100%',
                                padding: '5px 7px',
                                border: `1px solid ${costErr ? RED : '#ddd'}`,
                                borderRadius: 4,
                                fontSize: 12,
                                textAlign: 'right',
                                boxSizing: 'border-box',
                                background: costErr ? '#fff5f5' : 'white',
                              }}
                            />
                          </td>
                          <td
                            style={{
                              padding: '5px 4px',
                              textAlign: 'right',
                              fontWeight: 600,
                              color: BLUE,
                              fontSize: 12,
                            }}
                          >
                            ${Math.round((Number(li.baseCost) || 0) * multiplier).toLocaleString()}
                          </td>
                          <td style={{ padding: '5px 4px' }}>
                            <input
                              value={li.description || ''}
                              onChange={(e) => updateLineItem(i, 'description', e.target.value)}
                              style={{
                                width: '100%',
                                padding: '5px 7px',
                                border: '1px solid #ddd',
                                borderRadius: 4,
                                fontSize: 12,
                                boxSizing: 'border-box',
                              }}
                            />
                          </td>
                          <td style={{ padding: '5px 4px', whiteSpace: 'nowrap' }}>
                            <button
                              onClick={() => toggleRowExpanded(i)}
                              title={isExpanded ? 'Hide bullet points' : 'Edit bullet points'}
                              style={{
                                background: isExpanded ? BLUE : '#f0f4ff',
                                color: isExpanded ? 'white' : BLUE,
                                border: `1px solid ${BLUE}`,
                                borderRadius: 4,
                                cursor: 'pointer',
                                padding: '4px 7px',
                                fontSize: 11,
                                marginRight: 4,
                              }}
                            >
                              {isExpanded ? '▲' : '▼'} {includedItems.length}
                            </button>
                            <button
                              onClick={() => removeLineItem(i)}
                              title="Remove"
                              style={{
                                background: '#fee2e2',
                                color: RED,
                                border: 'none',
                                borderRadius: 4,
                                cursor: 'pointer',
                                padding: '4px 8px',
                                fontSize: 12,
                              }}
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                        <tr style={{ borderBottom: '1px solid #f0f0f0' }}>
                          <td colSpan={5} style={{ padding: '2px 4px 6px 4px' }}>
                            <textarea
                              value={li.note || ''}
                              onChange={(e) => updateLineItem(i, 'note', e.target.value)}
                              placeholder="📝 Add a note for this trade (appears in the proposal PDF)…"
                              rows={2}
                              style={{
                                width: '100%',
                                padding: '5px 8px',
                                border: '1px solid #fcd34d',
                                borderRadius: 4,
                                fontSize: 11,
                                fontStyle: li.note ? 'italic' : 'normal',
                                color: '#92400e',
                                background: li.note ? '#fffbeb' : '#fffdf5',
                                boxSizing: 'border-box',
                                resize: 'vertical',
                                lineHeight: 1.5,
                              }}
                            />
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr style={{ borderBottom: '1px solid #f0f0f0' }}>
                            <td
                              colSpan={5}
                              style={{ padding: '4px 8px 12px 8px', background: '#f8fbff' }}
                            >
                              <div
                                style={{
                                  fontSize: 11,
                                  fontWeight: 700,
                                  color: BLUE,
                                  marginBottom: 6,
                                  textTransform: 'uppercase',
                                  letterSpacing: 0.4,
                                }}
                              >
                                ✓ What this trade includes (bullet points on proposal)
                              </div>
                              {includedItems.map((item, j) => (
                                <div
                                  key={j}
                                  style={{
                                    display: 'flex',
                                    gap: 6,
                                    marginBottom: 4,
                                    alignItems: 'center',
                                  }}
                                >
                                  <span
                                    style={{ color: '#2E7D32', fontWeight: 'bold', fontSize: 13 }}
                                  >
                                    ✓
                                  </span>
                                  <input
                                    value={item}
                                    onChange={(e) => updateIncludedItem(i, j, e.target.value)}
                                    style={{
                                      flex: 1,
                                      padding: '4px 7px',
                                      border: '1px solid #dde8f0',
                                      borderRadius: 4,
                                      fontSize: 12,
                                    }}
                                  />
                                  <button
                                    onClick={() => removeIncludedItem(i, j)}
                                    style={{
                                      background: '#fee2e2',
                                      color: RED,
                                      border: 'none',
                                      borderRadius: 4,
                                      cursor: 'pointer',
                                      padding: '3px 7px',
                                      fontSize: 11,
                                    }}
                                  >
                                    ✕
                                  </button>
                                </div>
                              ))}
                              <button
                                onClick={() => addIncludedItem(i)}
                                style={{
                                  marginTop: 4,
                                  padding: '4px 12px',
                                  background: 'white',
                                  border: `1px dashed #2E7D32`,
                                  color: '#2E7D32',
                                  borderRadius: 4,
                                  cursor: 'pointer',
                                  fontSize: 11,
                                  fontWeight: 600,
                                }}
                              >
                                + Add bullet point
                              </button>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>

              <button
                onClick={addLineItem}
                style={{
                  marginTop: 10,
                  padding: '6px 14px',
                  background: 'white',
                  border: `1px dashed ${ORANGE}`,
                  color: ORANGE,
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                + Add Line Item
              </button>

              <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
                <button
                  onClick={() => setEditingLineItems(null)}
                  style={{
                    padding: '9px 18px',
                    border: '1px solid #ddd',
                    borderRadius: 6,
                    background: 'white',
                    cursor: 'pointer',
                    fontSize: 13,
                    color: '#555',
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={saveLineItems}
                  disabled={savingLineItems}
                  style={{
                    padding: '9px 18px',
                    background: '#6B7280',
                    color: 'white',
                    border: 'none',
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontSize: 13,
                    fontWeight: 700,
                  }}
                >
                  {savingLineItems ? 'Saving...' : '💾 Save Changes'}
                </button>
              </div>
            </div>
          )}

          {/* Generate Proposal button */}
          <div
            style={{
              marginTop: 18,
              paddingTop: 14,
              borderTop: '1px solid #fcd9a0',
              display: 'flex',
              justifyContent: 'flex-end',
            }}
          >
            <button
              onClick={generateProposal}
              disabled={actionLoading}
              style={{
                padding: '11px 28px',
                background: BLUE,
                color: 'white',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 14,
                fontWeight: 700,
              }}
            >
              {actionLoading ? '⏳ Generating...' : '🤖 Generate Proposal PDF'}
            </button>
          </div>
        </div>
      )}

      {/* Clarification questions */}
      {job.status === 'clarification' &&
        clarifications.length > 0 &&
        (() => {
          const pending = clarifications.find((c) => !c.answer);
          const answered = clarifications.filter((c) => c.answer);
          return (
            <div
              style={{
                background: '#FFFDE7',
                border: '1px solid #F59E0B',
                borderRadius: 8,
                padding: 20,
                marginBottom: 16,
              }}
            >
              <strong style={{ color: '#92400E', fontSize: 14 }}>
                ❓ Clarification Needed ({answered.length} of {clarifications.length} answered)
              </strong>
              {answered.map((c, i) => (
                <div
                  key={c.id}
                  style={{
                    marginTop: 12,
                    padding: 10,
                    background: '#f0fdf4',
                    borderRadius: 6,
                    borderLeft: `3px solid ${GREEN}`,
                  }}
                >
                  <div style={{ fontSize: 12, color: '#888' }}>Question {i + 1}:</div>
                  <div style={{ fontSize: 13, color: '#333', marginBottom: 4 }}>{c.question}</div>
                  <div style={{ fontSize: 12, color: GREEN, fontWeight: 'bold' }}>
                    ✅ {c.answer}
                  </div>
                </div>
              ))}
              {pending && (
                <div
                  style={{
                    marginTop: 12,
                    padding: 10,
                    background: 'white',
                    borderRadius: 6,
                    borderLeft: '3px solid #F59E0B',
                  }}
                >
                  <div style={{ fontSize: 12, color: '#92400E', fontWeight: 'bold' }}>
                    Question {answered.length + 1} of {clarifications.length}:
                  </div>
                  <div style={{ fontSize: 13, color: '#333', marginTop: 4, marginBottom: 8 }}>
                    {pending.question}
                  </div>

                  {/* ── Attach options row ── */}
                  <input
                    ref={clarFileRef}
                    type="file"
                    multiple
                    accept="image/*,.pdf"
                    style={{ display: 'none' }}
                    onChange={(e) => setClarFiles(Array.from(e.target.files || []))}
                  />
                  <div
                    style={{
                      display: 'flex',
                      gap: 8,
                      marginBottom: 8,
                      flexWrap: 'wrap',
                      alignItems: 'center',
                    }}
                  >
                    {/* Local file button */}
                    <button
                      onClick={() => clarFileRef.current?.click()}
                      style={{
                        padding: '6px 12px',
                        background: clarFiles.length ? '#e8f0fe' : '#f4f6fb',
                        border: `1px solid ${clarFiles.length ? BLUE : '#ddd'}`,
                        borderRadius: 6,
                        cursor: 'pointer',
                        fontSize: 12,
                        color: clarFiles.length ? BLUE : '#888',
                      }}
                      title="Upload blueprints, photos, or PDFs from your computer"
                    >
                      📎{' '}
                      {clarFiles.length
                        ? `${clarFiles.length} local file${clarFiles.length > 1 ? 's' : ''}`
                        : 'Upload from computer'}
                    </button>
                    {clarFiles.length > 0 && (
                      <button
                        onClick={() => {
                          setClarFiles([]);
                          if (clarFileRef.current) clarFileRef.current.value = '';
                        }}
                        style={{
                          padding: '4px 8px',
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          fontSize: 11,
                          color: '#C62828',
                        }}
                      >
                        ✕ Clear
                      </button>
                    )}
                    {clarFiles.length > 0 &&
                      clarFiles.map((f, i) => (
                        <span
                          key={i}
                          style={{
                            fontSize: 11,
                            color: '#555',
                            background: '#f0f4ff',
                            padding: '2px 6px',
                            borderRadius: 4,
                          }}
                        >
                          {f.name}
                        </span>
                      ))}

                    {/* Server files button */}
                    <button
                      onClick={() => {
                        if (!showJobFilesPicker) loadJobFiles();
                        setShowJobFilesPicker((v) => !v);
                      }}
                      style={{
                        padding: '6px 12px',
                        background:
                          showJobFilesPicker || selectedJobFiles.size ? '#e8f0fe' : '#f4f6fb',
                        border: `1px solid ${showJobFilesPicker || selectedJobFiles.size ? BLUE : '#ddd'}`,
                        borderRadius: 6,
                        cursor: 'pointer',
                        fontSize: 12,
                        color: showJobFilesPicker || selectedJobFiles.size ? BLUE : '#888',
                      }}
                      title="Use photos/blueprints already uploaded to this job on the server"
                    >
                      🖼{' '}
                      {selectedJobFiles.size
                        ? `${selectedJobFiles.size} server file${selectedJobFiles.size > 1 ? 's' : ''} selected`
                        : 'Use uploaded files'}
                    </button>
                    {selectedJobFiles.size > 0 && (
                      <button
                        onClick={() => {
                          setSelectedJobFiles(new Set());
                        }}
                        style={{
                          padding: '4px 8px',
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          fontSize: 11,
                          color: '#C62828',
                        }}
                      >
                        ✕ Clear
                      </button>
                    )}
                  </div>

                  {/* ── Server files picker panel ── */}
                  {showJobFilesPicker && (
                    <div
                      style={{
                        background: '#f0f4ff',
                        border: '1px solid #c7d2fe',
                        borderRadius: 8,
                        padding: 12,
                        marginBottom: 10,
                      }}
                    >
                      <div
                        style={{ fontSize: 12, fontWeight: 'bold', color: BLUE, marginBottom: 8 }}
                      >
                        Select uploaded files to read with AI:
                      </div>
                      {jobFilesLoading ? (
                        <div style={{ fontSize: 12, color: '#888' }}>Loading files...</div>
                      ) : jobFiles.length === 0 ? (
                        <div style={{ fontSize: 12, color: '#888' }}>
                          No photos or files uploaded to this job yet.
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                          {jobFiles.map((f) => {
                            const selected = selectedJobFiles.has(f.id);
                            return (
                              <div
                                key={f.id}
                                onClick={() => {
                                  setSelectedJobFiles((prev) => {
                                    const n = new Set(prev);
                                    n.has(f.id) ? n.delete(f.id) : n.add(f.id);
                                    return n;
                                  });
                                }}
                                style={{
                                  width: 90,
                                  cursor: 'pointer',
                                  borderRadius: 6,
                                  border: `2px solid ${selected ? BLUE : '#ddd'}`,
                                  background: selected ? '#e8f0fe' : 'white',
                                  padding: 4,
                                  textAlign: 'center',
                                  position: 'relative',
                                }}
                              >
                                <img
                                  src={f.url}
                                  alt={f.label}
                                  style={{
                                    width: '100%',
                                    height: 64,
                                    objectFit: 'cover',
                                    borderRadius: 4,
                                    display: 'block',
                                  }}
                                  onError={(e) => {
                                    e.target.style.display = 'none';
                                  }}
                                />
                                <div
                                  style={{
                                    fontSize: 10,
                                    color: selected ? BLUE : '#555',
                                    marginTop: 3,
                                    wordBreak: 'break-all',
                                    lineHeight: 1.2,
                                  }}
                                >
                                  {f.label.length > 18 ? f.label.slice(0, 16) + '…' : f.label}
                                </div>
                                {selected && (
                                  <div
                                    style={{
                                      position: 'absolute',
                                      top: 2,
                                      right: 4,
                                      fontSize: 14,
                                      color: BLUE,
                                    }}
                                  >
                                    ✓
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {selectedJobFiles.size > 0 && (
                        <button
                          onClick={() => extractAndSubmitClarFromJobFiles(pending.id)}
                          disabled={clarExtracting || actionLoading}
                          style={{
                            marginTop: 10,
                            padding: '8px 16px',
                            background: BLUE,
                            color: 'white',
                            border: 'none',
                            borderRadius: 6,
                            cursor: clarExtracting || actionLoading ? 'not-allowed' : 'pointer',
                            fontSize: 12,
                            fontWeight: 'bold',
                            opacity: clarExtracting || actionLoading ? 0.6 : 1,
                          }}
                        >
                          {clarExtracting
                            ? '🔍 AI is reading...'
                            : `Extract & Submit (${selectedJobFiles.size} file${selectedJobFiles.size > 1 ? 's' : ''})`}
                        </button>
                      )}
                    </div>
                  )}

                  {/* ── Text answer + local file submit ── */}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      value={clarAnswer}
                      onChange={(e) => setClarAnswer(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (clarAnswer.trim() || clarFiles.length))
                          submitClarAnswer(pending.id);
                      }}
                      placeholder={
                        clarFiles.length
                          ? 'Optional: add notes to accompany the images...'
                          : 'Type your answer...'
                      }
                      style={{
                        flex: 1,
                        padding: 8,
                        border: '1px solid #ddd',
                        borderRadius: 6,
                        fontSize: 13,
                      }}
                    />
                    <button
                      onClick={() => submitClarAnswer(pending.id)}
                      disabled={
                        (!clarAnswer.trim() && !clarFiles.length) || actionLoading || clarExtracting
                      }
                      style={{
                        padding: '8px 16px',
                        background: BLUE,
                        color: 'white',
                        border: 'none',
                        borderRadius: 6,
                        cursor:
                          (!clarAnswer.trim() && !clarFiles.length) ||
                          actionLoading ||
                          clarExtracting
                            ? 'not-allowed'
                            : 'pointer',
                        fontSize: 12,
                        fontWeight: 'bold',
                        opacity:
                          (!clarAnswer.trim() && !clarFiles.length) ||
                          actionLoading ||
                          clarExtracting
                            ? 0.6
                            : 1,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {clarExtracting ? '🔍 Reading...' : actionLoading ? '...' : 'Submit'}
                    </button>
                  </div>
                  {clarExtracting && (
                    <div style={{ fontSize: 11, color: '#92400E', marginTop: 6 }}>
                      AI is reading your images — this takes a moment...
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })()}
    </>
  );
}
