import React from 'react';
import { BLUE, ORANGE } from './constants';

export default function JobHistoryTab({
  job,
  versionHistory,
  historySort,
  setHistorySort,
  auditLog,
  auditSort,
  setAuditSort,
  token,
}) {
  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
        }}
      >
        <h3 style={{ color: BLUE, margin: 0 }}>Estimate Version History</h3>
        <button
          onClick={() => setHistorySort((s) => (s === 'desc' ? 'asc' : 'desc'))}
          style={{
            fontSize: 12,
            padding: '4px 10px',
            border: '1px solid #ddd',
            borderRadius: 6,
            background: 'white',
            cursor: 'pointer',
            color: '#555',
          }}
        >
          {historySort === 'desc' ? '⬇ Newest First' : '⬆ Oldest First'}
        </button>
      </div>
      {!job.quote_number ? (
        <div style={{ color: '#888', textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>📋</div>
          <div>No proposal number assigned yet.</div>
          <div style={{ fontSize: 12, color: '#aaa', marginTop: 6 }}>
            Version history appears once Claude extracts a proposal number from the estimate.
          </div>
        </div>
      ) : (
        <div>
          <div style={{ marginBottom: 14, fontSize: 13, color: '#555' }}>
            All versions of proposal <strong>{job.quote_number}</strong>:
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: BLUE, color: 'white' }}>
                <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600 }}>Version</th>
                <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600 }}>Date</th>
                <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600 }}>
                  Total Value
                </th>
                <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600 }}>Status</th>
                <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600 }}>Source</th>
                <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600 }}></th>
              </tr>
            </thead>
            <tbody>
              {versionHistory.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: 20, textAlign: 'center', color: '#aaa' }}>
                    No versions found.
                  </td>
                </tr>
              ) : (
                [...versionHistory]
                  .sort((a, b) =>
                    historySort === 'desc'
                      ? new Date(b.created_at) - new Date(a.created_at)
                      : new Date(a.created_at) - new Date(b.created_at),
                  )
                  .map((v, i) => {
                    const isCurrent = v.id === job.id;
                    const rawQuoteNum = job.quote_number;
                    return (
                      <tr
                        key={v.id}
                        style={{
                          background: isCurrent ? '#EEF3FB' : i % 2 === 0 ? 'white' : '#f8f8f8',
                          borderBottom: '1px solid #eee',
                        }}
                      >
                        <td
                          style={{
                            padding: '10px 12px',
                            fontWeight: isCurrent ? 'bold' : 'normal',
                            color: isCurrent ? BLUE : '#333',
                          }}
                        >
                          {rawQuoteNum}/{v.version}
                          {isCurrent && (
                            <span
                              style={{
                                marginLeft: 6,
                                fontSize: 10,
                                background: BLUE,
                                color: 'white',
                                borderRadius: 3,
                                padding: '2px 6px',
                              }}
                            >
                              current
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '10px 12px', color: '#555' }}>
                          {new Date(v.created_at).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </td>
                        <td
                          style={{
                            padding: '10px 12px',
                            textAlign: 'right',
                            fontWeight: 600,
                            color: v.total_value ? BLUE : '#aaa',
                          }}
                        >
                          {v.total_value ? `$${Number(v.total_value).toLocaleString()}` : '—'}
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          <span
                            style={{
                              fontSize: 11,
                              background: '#e0e7ff',
                              color: '#3730a3',
                              borderRadius: 3,
                              padding: '2px 7px',
                            }}
                          >
                            {(v.status || '').replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td style={{ padding: '10px 12px', color: '#777', fontSize: 12 }}>
                          {v.estimate_source === 'ai'
                            ? '🤖 AI'
                            : v.estimate_source === 'manual'
                              ? '✏️ Manual'
                              : v.estimate_source || '—'}
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          {v.id !== job.id && (
                            <a
                              href={`/jobs/${v.id}`}
                              style={{
                                fontSize: 12,
                                color: BLUE,
                                textDecoration: 'none',
                                fontWeight: 600,
                              }}
                            >
                              View →
                            </a>
                          )}
                          {v.proposal_pdf_path && (
                            <a
                              href={`/outputs/${v.proposal_pdf_path.split(/[\\/]/).pop()}?token=${encodeURIComponent(token)}`}
                              target="_blank"
                              rel="noreferrer"
                              style={{
                                marginLeft: 8,
                                fontSize: 12,
                                color: '#3B82F6',
                                textDecoration: 'none',
                              }}
                            >
                              📄 PDF
                            </a>
                          )}
                        </td>
                      </tr>
                    );
                  })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Activity log */}
      <div style={{ marginTop: 28 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 10,
          }}
        >
          <h4 style={{ color: BLUE, margin: 0, fontSize: 14 }}>📋 Activity Log</h4>
          {auditLog.length > 0 && (
            <button
              onClick={() => setAuditSort((s) => (s === 'desc' ? 'asc' : 'desc'))}
              style={{
                fontSize: 12,
                padding: '4px 10px',
                border: '1px solid #ddd',
                borderRadius: 6,
                background: 'white',
                cursor: 'pointer',
                color: '#555',
              }}
            >
              {auditSort === 'desc' ? '⬇ Newest First' : '⬆ Oldest First'}
            </button>
          )}
        </div>
        {auditLog.length === 0 ? (
          <div style={{ color: '#aaa', fontSize: 13 }}>No activity recorded yet.</div>
        ) : (
          [...auditLog]
            .sort((a, b) =>
              auditSort === 'desc'
                ? new Date(b.created_at) - new Date(a.created_at)
                : new Date(a.created_at) - new Date(b.created_at),
            )
            .map((a) => (
              <div
                key={a.id}
                style={{
                  display: 'flex',
                  gap: 10,
                  padding: '7px 0',
                  borderBottom: '1px solid #f0f0f0',
                  fontSize: 12,
                  flexWrap: 'wrap',
                }}
              >
                <span style={{ color: '#aaa', width: 130, flexShrink: 0 }}>
                  {new Date(a.created_at).toLocaleString()}
                </span>
                <span style={{ fontWeight: 600, color: ORANGE, flexShrink: 0, minWidth: 160 }}>
                  {a.action.replace(/_/g, ' ')}
                </span>
                <span style={{ color: '#555', flex: 1 }}>{a.details}</span>
                <span style={{ color: '#bbb', flexShrink: 0 }}>by {a.performed_by}</span>
              </div>
            ))
        )}
      </div>
    </div>
  );
}
