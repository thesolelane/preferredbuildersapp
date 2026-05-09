import React from 'react';
import { BLUE, ORANGE } from './constants';
import PrintButton from './PrintButton';

export default function JobProposalTab({ proposalData, job, token }) {
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
    </div>
  );
}
