import React from 'react';
import { BLUE, GREEN } from './constants';

export default function JobConversationTab({ conversations }) {
  return (
    <div>
      <h3 style={{ color: BLUE, marginBottom: 16 }}>Communication Thread</h3>
      {conversations.length === 0 ? (
        <div style={{ color: '#888', textAlign: 'center', padding: 20 }}>No messages yet.</div>
      ) : (
        conversations.map((c) => (
          <div
            key={c.id}
            style={{
              marginBottom: 12,
              padding: 12,
              borderRadius: 8,
              background: c.direction === 'inbound' ? '#f0f4ff' : '#f9fff9',
              borderLeft: `3px solid ${c.direction === 'inbound' ? BLUE : GREEN}`,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 'bold',
                  color: c.direction === 'inbound' ? BLUE : GREEN,
                }}
              >
                {c.direction.toUpperCase()} · {c.channel.toUpperCase()} · {c.from_address}
              </span>
              <span style={{ fontSize: 10, color: '#888' }}>
                {new Date(c.created_at).toLocaleString()}
              </span>
            </div>
            <div style={{ fontSize: 12, color: '#333', whiteSpace: 'pre-wrap' }}>{c.message}</div>
          </div>
        ))
      )}
    </div>
  );
}
