import React from 'react';
import { BLUE } from './constants';
import PrintButton from './PrintButton';

export default function JobContractTab({ contractData, job, token }) {
  return (
    <div>
      {!contractData ? (
        <div style={{ color: '#888', textAlign: 'center', padding: 40 }}>
          {['proposal_ready', 'proposal_sent'].includes(job.status)
            ? 'Send the proposal for customer signature first. The contract will auto-generate upon approval.'
            : job.status === 'proposal_approved'
              ? 'Contract is being generated… refresh in a moment.'
              : 'No contract generated yet.'}
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
            <h3 style={{ color: BLUE, margin: 0 }}>Contract Summary</h3>
            <PrintButton
              jobId={job?.id}
              docType="contract"
              hasPdf={!!job?.contract_pdf_path}
              token={token}
            />
          </div>
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
            {JSON.stringify(contractData, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
