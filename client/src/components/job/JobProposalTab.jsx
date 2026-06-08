import { useState } from 'react';
import { BLUE, ORANGE } from './constants';
import PrintButton from './PrintButton';
import { showToast } from '../../utils/toast';

const RED = '#C62828';
const GREEN = '#2E7D32';

export default function JobProposalTab({ proposalData, job, token, userRole, onJobUpdated }) {
  const isAdmin = userRole === 'system_admin';

  const [importOpen, setImportOpen] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const [importing, setImporting] = useState(false);
  const [parseError, setParseError] = useState('');
  const [preview, setPreview] = useState(null);

  const validateJson = () => {
    setParseError('');
    setPreview(null);
    if (!jsonText.trim()) {
      setParseError('Paste the proposal JSON first.');
      return;
    }
    try {
      const parsed = JSON.parse(jsonText);
      if (!Array.isArray(parsed.lineItems) || parsed.lineItems.length === 0) {
        setParseError('JSON must contain a non-empty lineItems array.');
        return;
      }
      setPreview({
        lineCount: parsed.lineItems.length,
        trades: parsed.lineItems.map((li) => li.trade).filter(Boolean).join(', '),
        customer: parsed.customer?.name || '—',
        address: parsed.project?.address || '—',
      });
    } catch (e) {
      setParseError('Invalid JSON: ' + e.message);
    }
  };

  const doImport = async () => {
    if (!preview) return;
    setImporting(true);
    try {
      const res = await fetch(`/api/jobs/${job.id}/import-proposal`, {
        method: 'POST',
        headers: { 'x-auth-token': token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposalJson: jsonText }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Import failed', 'error');
      } else {
        showToast(
          `Proposal imported — total $${Number(data.totalValue || 0).toLocaleString()} / deposit $${Number(data.depositAmount || 0).toLocaleString()}`,
        );
        setImportOpen(false);
        setJsonText('');
        setPreview(null);
        onJobUpdated && onJobUpdated();
      }
    } catch (err) {
      showToast('Unexpected error: ' + err.message, 'error');
    }
    setImporting(false);
  };

  return (
    <div>
      {!proposalData ? (
        <div style={{ color: '#888', textAlign: 'center', padding: 40 }}>
          No proposal generated yet.
        </div>
      ) : (
        <div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 16,
            }}
          >
            <h3 style={{ color: BLUE, margin: 0 }}>Proposal Summary</h3>
            <PrintButton
              jobId={job?.id}
              docType="proposal"
              hasPdf={!!job?.proposal_pdf_path}
              token={token}
            />
          </div>
          <div style={{ background: '#f8f9fa', borderRadius: 8, padding: 16, marginBottom: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
              <div>
                <div style={{ fontSize: 11, color: '#888' }}>Total</div>
                <div style={{ fontSize: 18, fontWeight: 'bold', color: BLUE }}>
                  ${proposalData.totalValue?.toLocaleString()}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#888' }}>Deposit</div>
                <div style={{ fontSize: 18, fontWeight: 'bold', color: ORANGE }}>
                  ${proposalData.depositAmount?.toLocaleString()}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#888' }}>Proposal #</div>
                <div style={{ fontSize: 18, fontWeight: 'bold', color: '#333' }}>
                  {proposalData.quoteNumber || '—'}
                </div>
                {proposalData.quoteVersion > 1 && (
                  <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                    Version {proposalData.quoteVersion}
                  </div>
                )}
              </div>
            </div>
          </div>
          {proposalData.flaggedItems?.length > 0 && (
            <div
              style={{
                background: '#FFF8F0',
                border: `1px solid ${ORANGE}`,
                borderRadius: 6,
                padding: 12,
                marginBottom: 12,
                fontSize: 12,
              }}
            >
              ⚠️ Flagged: {proposalData.flaggedItems.join(' • ')}
            </div>
          )}
          <pre
            style={{
              background: '#f4f6fb',
              borderRadius: 8,
              padding: 16,
              fontSize: 11,
              overflow: 'auto',
              maxHeight: 400,
            }}
          >
            {JSON.stringify(proposalData, null, 2)}
          </pre>
        </div>
      )}

      {/* ── Import JSON — system_admin only ── */}
      {isAdmin && (
        <div style={{ marginTop: 24 }}>
          <button
            onClick={() => {
              setImportOpen((o) => !o);
              setParseError('');
              setPreview(null);
            }}
            style={{
              background: importOpen ? '#f0f4ff' : 'none',
              border: `1px solid ${BLUE}`,
              color: BLUE,
              borderRadius: 6,
              padding: '6px 14px',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            🔧 {importOpen ? 'Close' : 'Import New Proposal JSON'}
          </button>

          {importOpen && (
            <div
              style={{
                marginTop: 12,
                border: '1.5px solid #C8D4E4',
                borderRadius: 8,
                padding: 16,
                background: '#fafbff',
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: '#888',
                  marginBottom: 8,
                  background: '#FFF8F0',
                  border: '1px solid #E07B2A',
                  borderRadius: 6,
                  padding: '8px 12px',
                }}
              >
                ⚠️ <strong>System Admin only.</strong> Paste the edited proposal JSON below. The
                system will re-apply pricing markup, regenerate the proposal PDF, and set the job
                status to <em>proposal_ready</em>. This overwrites the existing proposal.
              </div>

              <textarea
                value={jsonText}
                onChange={(e) => {
                  setJsonText(e.target.value);
                  setParseError('');
                  setPreview(null);
                }}
                placeholder='Paste proposal JSON here — must contain a "lineItems" array...'
                rows={10}
                style={{
                  width: '100%',
                  fontFamily: 'monospace',
                  fontSize: 11,
                  padding: 10,
                  border: `1.5px solid ${parseError ? RED : '#C8D4E4'}`,
                  borderRadius: 6,
                  boxSizing: 'border-box',
                  resize: 'vertical',
                  background: 'white',
                }}
              />

              {parseError && (
                <div style={{ color: RED, fontSize: 12, marginTop: 4 }}>⚠️ {parseError}</div>
              )}

              {preview && (
                <div
                  style={{
                    marginTop: 10,
                    background: '#f0fff4',
                    border: `1px solid ${GREEN}`,
                    borderRadius: 6,
                    padding: '10px 14px',
                    fontSize: 12,
                  }}
                >
                  <div style={{ fontWeight: 700, color: GREEN, marginBottom: 4 }}>
                    ✓ Valid JSON — ready to import
                  </div>
                  <div>
                    <strong>{preview.lineCount}</strong> line item(s): {preview.trades}
                  </div>
                  {preview.customer !== '—' && (
                    <div>
                      Customer: <strong>{preview.customer}</strong>
                    </div>
                  )}
                  {preview.address !== '—' && (
                    <div>
                      Address: <strong>{preview.address}</strong>
                    </div>
                  )}
                  <div style={{ color: '#888', marginTop: 4, fontSize: 11 }}>
                    Pricing markup will be recalculated from current settings.
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button
                  onClick={validateJson}
                  style={{
                    background: 'white',
                    border: `1.5px solid ${BLUE}`,
                    color: BLUE,
                    borderRadius: 6,
                    padding: '7px 16px',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  Validate JSON
                </button>
                <button
                  onClick={doImport}
                  disabled={!preview || importing}
                  style={{
                    background: preview && !importing ? BLUE : '#aaa',
                    color: 'white',
                    border: 'none',
                    borderRadius: 6,
                    padding: '7px 18px',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: preview && !importing ? 'pointer' : 'default',
                  }}
                >
                  {importing ? 'Importing…' : '↑ Import & Regenerate Proposal'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
