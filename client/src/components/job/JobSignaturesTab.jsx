import React from 'react';
import { BLUE, GREEN } from './constants';
import ScanButton from './ScanButton';

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

export default function JobSignaturesTab({
  sigSessions,
  job,
  token,
  onSuccess,
  portalUrl,
  portalCopied,
  generatePortalLink,
  manualUploading,
  manualUploadDone,
  uploadManualSignature,
}) {
  return (
    <div>
      <h3 style={{ color: BLUE, marginBottom: 16 }}>Signatures & Read Receipts</h3>

      {/* Customer Portal Link */}
      <div
        style={{
          background: '#f0f4ff',
          border: '1px solid #c7d7f5',
          borderRadius: 10,
          padding: '16px 18px',
          marginBottom: 20,
        }}
      >
        <div style={{ fontWeight: 700, color: BLUE, fontSize: 13, marginBottom: 6 }}>
          🏠 Customer Portal
        </div>
        <div style={{ fontSize: 12, color: '#555', marginBottom: 12 }}>
          Share a portal link with your customer — they can view their project status, sign
          documents, upload photos, and submit change requests.
        </div>
        <button
          onClick={generatePortalLink}
          style={{
            background: BLUE,
            color: 'white',
            border: 'none',
            borderRadius: 7,
            padding: '9px 16px',
            fontSize: 13,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          {portalCopied ? '✅ Link Copied!' : '🔗 Generate & Copy Portal Link'}
        </button>
        {portalUrl && (
          <div
            style={{
              marginTop: 10,
              fontSize: 11,
              color: '#666',
              wordBreak: 'break-all',
              background: 'white',
              border: '1px solid #dde4f5',
              borderRadius: 6,
              padding: '8px 10px',
            }}
          >
            {portalUrl}
          </div>
        )}
      </div>

      {/* Manual Signature Upload */}
      <div
        style={{
          background: '#fffbf0',
          border: '1px solid #f0d9a0',
          borderRadius: 10,
          padding: '16px 18px',
          marginBottom: 20,
        }}
      >
        <div style={{ fontWeight: 700, color: '#92400e', fontSize: 13, marginBottom: 6 }}>
          📄 Import Manually Signed Document
        </div>
        <div style={{ fontSize: 12, color: '#555', marginBottom: 12 }}>
          Upload a scanned or photographed copy of a paper-signed proposal or contract. The job
          status will update automatically.
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <label style={{ cursor: manualUploading ? 'not-allowed' : 'pointer' }}>
            <input
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.heic,.webp"
              style={{ display: 'none' }}
              disabled={manualUploading}
              onChange={(e) => uploadManualSignature('proposal', e.target.files[0])}
            />
            <span
              style={{
                display: 'inline-block',
                padding: '8px 14px',
                background: '#fff',
                border: '1.5px solid #d97706',
                borderRadius: 7,
                fontSize: 12,
                fontWeight: 600,
                color: '#92400e',
                opacity: manualUploading ? 0.5 : 1,
              }}
            >
              {manualUploading ? 'Uploading...' : '📋 Upload Signed Proposal'}
            </span>
          </label>
          <ScanButton
            jobId={job?.id}
            attachType="signature"
            docType="proposal"
            label="Scan Signed Proposal"
            token={token}
            onSuccess={onSuccess}
          />
          <label style={{ cursor: manualUploading ? 'not-allowed' : 'pointer' }}>
            <input
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.heic,.webp"
              style={{ display: 'none' }}
              disabled={manualUploading}
              onChange={(e) => uploadManualSignature('contract', e.target.files[0])}
            />
            <span
              style={{
                display: 'inline-block',
                padding: '8px 14px',
                background: '#fff',
                border: '1.5px solid #d97706',
                borderRadius: 7,
                fontSize: 12,
                fontWeight: 600,
                color: '#92400e',
                opacity: manualUploading ? 0.5 : 1,
              }}
            >
              {manualUploading ? 'Uploading...' : '📑 Upload Signed Contract'}
            </span>
          </label>
          <ScanButton
            jobId={job?.id}
            attachType="signature"
            docType="contract"
            label="Scan Signed Contract"
            token={token}
            onSuccess={onSuccess}
          />
        </div>
        {manualUploadDone && (
          <div
            style={{
              marginTop: 10,
              fontSize: 11,
              color: '#15803d',
              background: '#f0fdf4',
              border: '1px solid #bbf7d0',
              borderRadius: 6,
              padding: '7px 10px',
            }}
          >
            ✅ {manualUploadDone.docType === 'contract' ? 'Contract' : 'Proposal'} saved:{' '}
            {manualUploadDone.filename}{' '}
            <a
              href={manualUploadDone.path}
              target="_blank"
              rel="noreferrer"
              style={{ color: '#1B3A6B', fontWeight: 600 }}
            >
              View
            </a>
          </div>
        )}
      </div>

      {/* Receipt / Check Scanner */}
      <div
        style={{
          background: '#f0fdf4',
          border: '1px solid #86efac',
          borderRadius: 10,
          padding: '16px 18px',
          marginBottom: 20,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <div style={{ fontWeight: 700, color: '#14532d', fontSize: 13, marginBottom: 3 }}>
            🧾 Scan Receipt or Check
          </div>
          <div style={{ fontSize: 12, color: '#555' }}>
            Scan a customer check or receipt directly into the job's photo record.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <ScanButton
            jobId={job?.id}
            attachType="photo"
            docType="receipt"
            label="Scan Receipt"
            token={token}
            onSuccess={onSuccess}
          />
          <ScanButton
            jobId={job?.id}
            attachType="photo"
            docType="check"
            label="Scan Check"
            token={token}
            onSuccess={onSuccess}
          />
        </div>
      </div>

      {sigSessions.length === 0 ? (
        <div style={{ color: '#888', textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>✉️</div>
          <div>No signing links have been sent yet.</div>
          <div style={{ fontSize: 12, marginTop: 6, color: '#aaa' }}>
            Once the proposal is ready, use "Send Proposal for Signature" to start the flow.
          </div>
        </div>
      ) : (
        sigSessions.map((s) => {
          const statusColor =
            s.status === 'signed'
              ? GREEN
              : s.status === 'declined'
                ? '#C62828'
                : s.status === 'opened'
                  ? '#F59E0B'
                  : '#888';
          return (
            <div
              key={s.id}
              style={{
                background: '#f8f9ff',
                border: '1px solid #e0e7ff',
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
                <div style={{ fontWeight: 'bold', color: BLUE, fontSize: 14 }}>
                  {s.doc_type === 'proposal' ? '📋 Proposal' : '📄 Contract'}
                </div>
                <span
                  style={{
                    fontSize: 11,
                    padding: '3px 10px',
                    borderRadius: 12,
                    background: statusColor + '22',
                    color: statusColor,
                    fontWeight: 'bold',
                    textTransform: 'uppercase',
                  }}
                >
                  {s.status}
                </span>
              </div>
              <ReadReceiptBadge
                session={s}
                label={s.doc_type === 'proposal' ? 'Proposal' : 'Contract'}
              />
              {s.status === 'declined' && s.decline_reason && (
                <div
                  style={{
                    marginTop: 12,
                    background: '#FEF2F2',
                    border: '1px solid #fca5a5',
                    borderRadius: 6,
                    padding: '10px 14px',
                    fontSize: 13,
                    color: '#991b1b',
                  }}
                >
                  <strong>Reason:</strong> {s.decline_reason}
                </div>
              )}
              <div style={{ marginTop: 12, fontSize: 11, color: '#aaa' }}>
                Link:{' '}
                <a href={s.signing_url} target="_blank" rel="noreferrer" style={{ color: BLUE }}>
                  {s.signing_url}
                </a>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
