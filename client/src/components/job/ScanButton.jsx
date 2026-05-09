import React, { useState } from 'react';
import { BLUE, GREEN } from './constants';
import { showToast } from '../../utils/toast';

export default function ScanButton({ jobId, attachType, docType, label, token, onSuccess }) {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState([]);
  const [configured, setConfigured] = useState(true);
  const [warning, setWarning] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [deleteAfter, setDeleteAfter] = useState(true);

  const openPanel = async () => {
    setOpen(true);
    await refreshInbox();
  };

  const refreshInbox = async () => {
    setLoading(true);
    setSelected(null);
    setPreview(null);
    try {
      const res = await fetch('/api/scan/inbox', { headers: { 'x-auth-token': token } });
      const data = await res.json();
      setFiles(data.files || []);
      setConfigured(data.configured !== false);
      setWarning(data.warning || null);
    } catch {
      setWarning('Could not reach scan service');
    }
    setLoading(false);
  };

  const selectFile = async (file) => {
    setSelected(file);
    setPreview(null);
    setPreviewing(true);
    try {
      const res = await fetch(`/api/scan/preview?filename=${encodeURIComponent(file.name)}`, {
        headers: { 'x-auth-token': token },
      });
      const data = await res.json();
      if (data.preview) setPreview(data.preview);
      else setWarning(data.error || 'Could not load preview');
    } catch {
      setWarning('Preview failed');
    }
    setPreviewing(false);
  };

  const attachScan = async () => {
    if (!selected) return;
    setAttaching(true);
    try {
      const res = await fetch(`/api/scan/attach/${jobId}`, {
        method: 'POST',
        headers: { 'x-auth-token': token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: selected.name, attachType, docType, deleteAfter }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast(`${docType || 'Document'} attached to job`, 'success');
        setOpen(false);
        setSelected(null);
        setPreview(null);
        if (onSuccess) onSuccess(data);
      } else {
        showToast(data.error || 'Failed to attach', 'error');
      }
    } catch {
      showToast('Could not attach scan', 'error');
    }
    setAttaching(false);
  };

  const cancel = () => {
    setOpen(false);
    setSelected(null);
    setPreview(null);
    setWarning(null);
  };

  const fmtSize = (bytes) =>
    bytes > 1024 * 1024
      ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
      : `${Math.round(bytes / 1024)} KB`;

  const fmtDate = (iso) =>
    new Date(iso).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });

  return (
    <div style={{ display: 'inline-block', position: 'relative' }}>
      <button
        onClick={openPanel}
        style={{
          padding: '7px 14px',
          background: open ? '#f0fff4' : '#f4f6fb',
          border: `1px solid ${open ? GREEN : '#ddd'}`,
          borderRadius: 6,
          cursor: 'pointer',
          fontSize: 12,
          color: open ? GREEN : '#555',
          fontWeight: open ? 'bold' : 'normal',
          display: 'flex',
          alignItems: 'center',
          gap: 5,
        }}
      >
        📄 {label || `Attach Scan`}
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: '110%',
            left: 0,
            zIndex: 200,
            background: 'white',
            border: '1px solid #ddd',
            borderRadius: 10,
            padding: 16,
            boxShadow: '0 6px 24px rgba(0,0,0,0.14)',
            width: 360,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 'bold', color: BLUE, marginBottom: 4 }}>
            📄 Attach {label || docType}
          </div>

          {!configured ? (
            <div
              style={{
                fontSize: 12,
                color: '#92400e',
                background: '#fffbeb',
                border: '1px solid #fde68a',
                borderRadius: 6,
                padding: '10px 12px',
                marginBottom: 10,
              }}
            >
              No scan inbox folder configured. Go to{' '}
              <strong>Settings → Integrations → Hardware</strong> and set the Scan Inbox Folder
              path.
            </div>
          ) : (
            <>
              <div style={{ fontSize: 11, color: '#666', marginBottom: 10 }}>
                Scan from the HP printer → choose the file below → attach to this job.
              </div>

              {warning && (
                <div
                  style={{
                    fontSize: 11,
                    color: '#B45309',
                    background: '#fffbeb',
                    border: '1px solid #fde68a',
                    borderRadius: 6,
                    padding: '8px 10px',
                    marginBottom: 8,
                  }}
                >
                  ⚠️ {warning}
                </div>
              )}

              {/* File list */}
              {loading ? (
                <div
                  style={{ fontSize: 12, color: '#888', padding: '12px 0', textAlign: 'center' }}
                >
                  Loading inbox...
                </div>
              ) : files.length === 0 ? (
                <div
                  style={{ fontSize: 12, color: '#888', padding: '12px 0', textAlign: 'center' }}
                >
                  No files in the scan inbox folder yet.
                  <br />
                  <span style={{ fontSize: 11 }}>
                    Scan a document from the HP, then click Refresh.
                  </span>
                </div>
              ) : (
                <div
                  style={{
                    maxHeight: 180,
                    overflowY: 'auto',
                    border: '1px solid #e5e7eb',
                    borderRadius: 6,
                    marginBottom: 10,
                  }}
                >
                  {files.map((f) => (
                    <div
                      key={f.name}
                      onClick={() => selectFile(f)}
                      style={{
                        padding: '8px 10px',
                        cursor: 'pointer',
                        background: selected?.name === f.name ? '#e0e7ff' : 'white',
                        borderBottom: '1px solid #f3f4f6',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <div>
                        <div
                          style={{
                            fontSize: 12,
                            fontWeight: selected?.name === f.name ? 'bold' : 'normal',
                            color: selected?.name === f.name ? BLUE : '#333',
                          }}
                        >
                          {f.name}
                        </div>
                        <div style={{ fontSize: 10, color: '#888' }}>
                          {fmtDate(f.modifiedAt)} · {fmtSize(f.size)}
                        </div>
                      </div>
                      {selected?.name === f.name && (
                        <span style={{ color: BLUE, fontSize: 14 }}>✓</span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Preview */}
              {previewing && (
                <div style={{ fontSize: 11, color: '#888', textAlign: 'center', padding: '8px 0' }}>
                  Loading preview...
                </div>
              )}
              {preview && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 11, color: '#555', marginBottom: 4, fontWeight: 'bold' }}>
                    Preview:
                  </div>
                  {preview.startsWith('data:image') ? (
                    <img
                      src={preview}
                      alt="Scan preview"
                      style={{
                        width: '100%',
                        borderRadius: 6,
                        border: '1px solid #ddd',
                        maxHeight: 200,
                        objectFit: 'contain',
                        background: '#f8f8f8',
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        fontSize: 11,
                        color: '#555',
                        background: '#f8f8f8',
                        border: '1px solid #ddd',
                        borderRadius: 6,
                        padding: 10,
                      }}
                    >
                      PDF selected — preview not available. File will be attached as-is.
                    </div>
                  )}
                </div>
              )}

              {/* Delete after attach toggle */}
              {selected && (
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 11,
                    color: '#555',
                    marginBottom: 10,
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={deleteAfter}
                    onChange={(e) => setDeleteAfter(e.target.checked)}
                  />
                  Remove from inbox after attaching
                </label>
              )}
            </>
          )}

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 8 }}>
            {configured && (
              <button
                onClick={refreshInbox}
                disabled={loading}
                style={{
                  padding: '8px 12px',
                  background: '#f4f6fb',
                  border: '1px solid #ddd',
                  borderRadius: 6,
                  cursor: loading ? 'not-allowed' : 'pointer',
                  fontSize: 12,
                  color: '#555',
                }}
              >
                🔄 Refresh
              </button>
            )}
            {selected && (
              <button
                onClick={attachScan}
                disabled={attaching}
                style={{
                  flex: 1,
                  padding: '8px 0',
                  background: BLUE,
                  color: 'white',
                  border: 'none',
                  borderRadius: 6,
                  cursor: attaching ? 'not-allowed' : 'pointer',
                  fontSize: 13,
                  fontWeight: 'bold',
                  opacity: attaching ? 0.6 : 1,
                }}
              >
                {attaching ? 'Attaching...' : '✅ Attach to Job'}
              </button>
            )}
            <button
              onClick={cancel}
              style={{
                padding: '8px 12px',
                background: '#f4f6fb',
                border: '1px solid #ddd',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 12,
                color: '#666',
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
