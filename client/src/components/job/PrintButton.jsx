import React, { useState } from 'react';
import { BLUE, GREEN } from './constants';
import { showToast } from '../../utils/toast';

export default function PrintButton({ jobId, docType, hasPdf, token }) {
  const [open, setOpen] = useState(false);
  const [printers, setPrinters] = useState([]);
  const [loadingPrinters, setLoadingPrinters] = useState(false);
  const [selectedPrinter, setSelectedPrinter] = useState('');
  const [printing, setPrinting] = useState(false);
  const [lastPrinted, setLastPrinted] = useState(null);

  const openPanel = async () => {
    setOpen((v) => !v);
    if (printers.length === 0) {
      setLoadingPrinters(true);
      try {
        const res = await fetch('/api/print/printers', { headers: { 'x-auth-token': token } });
        const data = await res.json();
        setPrinters(data.printers || []);
        if (data.printers?.length) setSelectedPrinter(data.printers[0]);
      } catch {
        showToast('Could not reach print service', 'error');
      }
      setLoadingPrinters(false);
    }
  };

  const doPrint = async () => {
    setPrinting(true);
    try {
      const res = await fetch(`/api/print/job/${jobId}`, {
        method: 'POST',
        headers: { 'x-auth-token': token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ docType, printerName: selectedPrinter }),
      });
      const data = await res.json();
      if (res.ok) {
        setLastPrinted(new Date().toLocaleTimeString());
        setOpen(false);
        showToast(`Sent to printer: ${data.printer}`, 'success');
      } else {
        showToast(data.error || 'Print failed', 'error');
      }
    } catch {
      showToast('Could not reach print service', 'error');
    }
    setPrinting(false);
  };

  if (!hasPdf) return null;

  return (
    <div style={{ display: 'inline-block', position: 'relative' }}>
      <button
        onClick={openPanel}
        style={{
          padding: '7px 14px',
          background: open ? '#f0f4ff' : '#f4f6fb',
          border: `1px solid ${open ? BLUE : '#ddd'}`,
          borderRadius: 6,
          cursor: 'pointer',
          fontSize: 12,
          color: open ? BLUE : '#555',
          fontWeight: open ? 'bold' : 'normal',
          display: 'flex',
          alignItems: 'center',
          gap: 5,
        }}
        title={`Print ${docType}`}
      >
        🖨️ Print {docType === 'proposal' ? 'Proposal' : 'Contract'}
        {lastPrinted && (
          <span style={{ fontSize: 10, color: GREEN, marginLeft: 4 }}>✓ {lastPrinted}</span>
        )}
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: '110%',
            left: 0,
            zIndex: 100,
            background: 'white',
            border: '1px solid #ddd',
            borderRadius: 8,
            padding: 14,
            boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
            minWidth: 280,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 'bold', color: BLUE, marginBottom: 10 }}>
            🖨️ Print {docType === 'proposal' ? 'Proposal' : 'Contract'} PDF
          </div>

          {loadingPrinters ? (
            <div style={{ fontSize: 12, color: '#888' }}>Loading printers...</div>
          ) : printers.length === 0 ? (
            <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>
              No printers detected — will use system default.
            </div>
          ) : (
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 11, color: '#666', display: 'block', marginBottom: 4 }}>
                Select printer:
              </label>
              <select
                value={selectedPrinter}
                onChange={(e) => setSelectedPrinter(e.target.value)}
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  border: '1px solid #ddd',
                  borderRadius: 6,
                  fontSize: 12,
                }}
              >
                <option value="">Use system default</option>
                {printers.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={doPrint}
              disabled={printing}
              style={{
                flex: 1,
                padding: '8px 0',
                background: BLUE,
                color: 'white',
                border: 'none',
                borderRadius: 6,
                cursor: printing ? 'not-allowed' : 'pointer',
                fontSize: 12,
                fontWeight: 'bold',
                opacity: printing ? 0.6 : 1,
              }}
            >
              {printing ? 'Sending to printer...' : '🖨️ Print'}
            </button>
            <button
              onClick={() => setOpen(false)}
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
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
