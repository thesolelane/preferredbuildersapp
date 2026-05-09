// client/src/pages/AdminChat.jsx
import { useState, useRef, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';

const BLUE = '#1B3A6B';
const GREEN = '#2E7D32';
const GREY = '#6b7280';

const STAGE_LABELS = {
  incoming: 'Incoming',
  callback_done: 'Callback Done',
  appointment_booked: 'Appt Booked',
  site_visit_complete: 'Site Visit',
  quote_draft: 'Quote Draft',
  quote_sent: 'Quote Sent',
  follow_up_1: 'Follow-up 1',
  follow_up_2: 'Follow-up 2',
  signed: 'Signed',
};

function fmtSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(mimeType) {
  const m = (mimeType || '').toLowerCase();
  if (m.startsWith('image/')) return '🖼️';
  if (m === 'application/pdf') return '📄';
  return '📎';
}

// ── Doc Picker Modal ──────────────────────────────────────────────────────────
function DocPickerModal({ token, onClose, onInject }) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [entity, setEntity] = useState(null);
  const [docs, setDocs] = useState([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [selected, setSelected] = useState(new Set());

  const searchRef = useRef(null);
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  // Debounced entity search
  useEffect(() => {
    setSearchLoading(true);
    const t = setTimeout(() => {
      fetch(`/api/ai/entity-search?q=${encodeURIComponent(search)}`, {
        headers: { 'x-auth-token': token },
      })
        .then((r) => (r.ok ? r.json() : { results: [] }))
        .then((d) => setResults(d.results || []))
        .catch(() => setResults([]))
        .finally(() => setSearchLoading(false));
    }, 280);
    return () => clearTimeout(t);
  }, [search, token]);

  // Load docs when entity selected
  useEffect(() => {
    if (!entity) {
      setDocs([]);
      setSelected(new Set());
      return;
    }
    setDocsLoading(true);
    fetch(`/api/ai/entity-docs?type=${entity.entity_type}&id=${entity.id}`, {
      headers: { 'x-auth-token': token },
    })
      .then((r) => (r.ok ? r.json() : { docs: [] }))
      .then((d) => setDocs(d.docs || []))
      .catch(() => setDocs([]))
      .finally(() => setDocsLoading(false));
  }, [entity, token]);

  const toggleDoc = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(docs.map((d) => d.id)));
  const clearAll = () => setSelected(new Set());

  const handleInject = () => {
    const toInject = docs.filter((d) => selected.has(d.id));
    if (!toInject.length) return;
    onInject(toInject);
    onClose();
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        style={{
          background: 'white',
          borderRadius: 14,
          width: '100%',
          maxWidth: 560,
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: '1px solid #eef1f6',
          }}
        >
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: BLUE }}>📁 Import Documents</div>
            <div style={{ fontSize: 11, color: GREY, marginTop: 2 }}>
              Inject uploaded plans, photos, or docs into this conversation
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 20,
              color: '#aaa',
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        {/* Search panel */}
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #eef1f6' }}>
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setEntity(null);
            }}
            placeholder="Search lead or contact by name, address, phone…"
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '9px 12px',
              border: '1.5px solid #C8D4E4',
              borderRadius: 8,
              fontSize: 13,
              outline: 'none',
            }}
          />

          {/* Results list */}
          <div style={{ marginTop: 8, maxHeight: 180, overflowY: 'auto' }}>
            {searchLoading && !entity && (
              <div style={{ fontSize: 12, color: GREY, padding: '6px 0' }}>Searching…</div>
            )}
            {!searchLoading && results.length === 0 && !entity && (
              <div style={{ fontSize: 12, color: '#bbb', padding: '6px 0' }}>
                No leads or contacts found
              </div>
            )}
            {results.map((r) => {
              const isSelected = entity?.entity_type === r.entity_type && entity?.id === r.id;
              const label = r.entity_type === 'lead' ? 'Lead' : 'Contact';
              const badge =
                r.entity_type === 'lead' && r.stage ? STAGE_LABELS[r.stage] || r.stage : null;
              const detail = [r.detail, r.city].filter(Boolean).join(', ');
              return (
                <div
                  key={`${r.entity_type}_${r.id}`}
                  onClick={() => {
                    setEntity(r);
                    setSearch('');
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 10px',
                    borderRadius: 7,
                    cursor: 'pointer',
                    background: isSelected ? '#e8f0fe' : 'transparent',
                    border: isSelected ? '1px solid #b8d0ff' : '1px solid transparent',
                    marginBottom: 4,
                  }}
                >
                  <span style={{ fontSize: 16 }}>{r.entity_type === 'lead' ? '📋' : '👤'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a2e' }}>
                      {r.name || '(No name)'}
                    </div>
                    {detail && (
                      <div
                        style={{
                          fontSize: 11,
                          color: GREY,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {detail}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        background: r.entity_type === 'lead' ? '#e0e8ff' : '#e8f5e9',
                        color: r.entity_type === 'lead' ? BLUE : GREEN,
                        borderRadius: 10,
                        padding: '1px 7px',
                      }}
                    >
                      {label}
                    </span>
                    {badge && (
                      <span
                        style={{
                          fontSize: 10,
                          background: '#f0f4f8',
                          color: GREY,
                          borderRadius: 10,
                          padding: '1px 7px',
                        }}
                      >
                        {badge}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Selected entity + docs list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 20px' }}>
          {!entity && (
            <div
              style={{
                textAlign: 'center',
                padding: '30px 0',
                color: '#bbb',
                fontSize: 13,
              }}
            >
              Search and select a lead or contact above to see their files
            </div>
          )}

          {entity && (
            <>
              {/* Entity header */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 12,
                }}
              >
                <span style={{ fontSize: 16 }}>{entity.entity_type === 'lead' ? '📋' : '👤'}</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: BLUE }}>{entity.name}</div>
                  {entity.detail && (
                    <div style={{ fontSize: 11, color: GREY }}>
                      {[entity.detail, entity.city].filter(Boolean).join(', ')}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setEntity(null)}
                  style={{
                    marginLeft: 'auto',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: 11,
                    color: GREY,
                  }}
                >
                  ← Change
                </button>
              </div>

              {docsLoading && <div style={{ fontSize: 12, color: GREY }}>Loading files…</div>}

              {!docsLoading && docs.length === 0 && (
                <div
                  style={{
                    textAlign: 'center',
                    padding: '24px 0',
                    border: '1px dashed #dde3ed',
                    borderRadius: 8,
                    color: '#bbb',
                    fontSize: 13,
                  }}
                >
                  📭 No documents available for import
                  <div style={{ fontSize: 11, marginTop: 4, color: '#ccc' }}>
                    Upload files to this {entity.entity_type} first, then return here to inject them
                  </div>
                </div>
              )}

              {!docsLoading && docs.length > 0 && (
                <>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: 8,
                    }}
                  >
                    <span style={{ fontSize: 11, color: GREY, fontWeight: 600 }}>
                      {docs.length} file{docs.length !== 1 ? 's' : ''} available
                    </span>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        onClick={selectAll}
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          fontSize: 11,
                          color: BLUE,
                          fontWeight: 600,
                        }}
                      >
                        Select all
                      </button>
                      {selected.size > 0 && (
                        <button
                          onClick={clearAll}
                          style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            fontSize: 11,
                            color: GREY,
                          }}
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>

                  {docs.map((doc) => {
                    const isChecked = selected.has(doc.id);
                    return (
                      <div
                        key={doc.id}
                        onClick={() => toggleDoc(doc.id)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          padding: '9px 12px',
                          borderRadius: 8,
                          cursor: 'pointer',
                          background: isChecked ? '#e8f0fe' : '#fafafa',
                          border: `1px solid ${isChecked ? '#b8d0ff' : '#e2e8f0'}`,
                          marginBottom: 6,
                          transition: 'background 0.1s',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleDoc(doc.id)}
                          onClick={(e) => e.stopPropagation()}
                          style={{ width: 15, height: 15, cursor: 'pointer', flexShrink: 0 }}
                        />
                        <span style={{ fontSize: 18, lineHeight: 1, flexShrink: 0 }}>
                          {fileIcon(doc.mime_type)}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              fontSize: 13,
                              fontWeight: 500,
                              color: '#1a1a2e',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {doc.name}
                          </div>
                          <div style={{ fontSize: 10, color: GREY }}>
                            {doc.source_table === 'field_photos'
                              ? '📷 Field Photo'
                              : doc.source_table === 'lead_documents'
                                ? '📁 Lead Doc'
                                : '📁 Contact Doc'}
                            {doc.file_size ? ` · ${fmtSize(doc.file_size)}` : ''}
                          </div>
                        </div>
                        {isChecked && (
                          <span
                            style={{ fontSize: 12, color: BLUE, fontWeight: 700, flexShrink: 0 }}
                          >
                            ✓
                          </span>
                        )}
                      </div>
                    );
                  })}
                </>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '14px 20px',
            borderTop: '1px solid #eef1f6',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <button
            onClick={onClose}
            style={{
              padding: '9px 16px',
              background: '#f4f6fb',
              border: '1px solid #dde3ed',
              borderRadius: 7,
              fontSize: 13,
              color: GREY,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleInject}
            disabled={selected.size === 0}
            style={{
              padding: '9px 20px',
              background: selected.size > 0 ? BLUE : '#c8d4e4',
              color: 'white',
              border: 'none',
              borderRadius: 7,
              fontSize: 13,
              fontWeight: 700,
              cursor: selected.size > 0 ? 'pointer' : 'default',
            }}
          >
            {selected.size === 0
              ? 'Select files to inject'
              : `📥 Inject ${selected.size} file${selected.size !== 1 ? 's' : ''} →`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Chat Page ─────────────────────────────────────────────────────────────
export default function AdminChat({ token }) {
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content:
        '👋 Hi Jackson! I now have live access to your contacts and jobs, and I can create tasks and reminders for you.\n\nYou can also attach blueprints, building plans, or photos — I\'ll read them and help you build a quote. Use 📎 to upload a new file, or 📁 to inject plans and photos already on file for any lead or contact.\n\nTry asking:\n• "What\'s the phone number for [customer name]?"\n• "What\'s the status of the job at 123 Main St?"\n• "Remind me to call for inspection tomorrow at 5pm for Oak St"\n\nOlá! Pode me perguntar em português também.',
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [language, setLanguage] = useState('en');
  const [attachedFiles, setAttachedFiles] = useState([]);
  const [injectedDocs, setInjectedDocs] = useState([]);
  const [extracting, setExtracting] = useState(false);
  const [docPickerOpen, setDocPickerOpen] = useState(false);
  const bottomRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const removeFile = (i) => setAttachedFiles((prev) => prev.filter((_, j) => j !== i));
  const removeInjected = useCallback(
    (id) => setInjectedDocs((prev) => prev.filter((d) => d.id !== id)),
    [],
  );

  const handleInjectDocs = useCallback((docs) => {
    setInjectedDocs((prev) => {
      const existingIds = new Set(prev.map((d) => d.id));
      return [...prev, ...docs.filter((d) => !existingIds.has(d.id))];
    });
  }, []);

  const send = async () => {
    const hasContent = input.trim() || attachedFiles.length || injectedDocs.length;
    if (!hasContent || loading || extracting) return;

    let userMsg = input.trim();
    const filesSnapshot = [...attachedFiles];
    const injectedSnapshot = [...injectedDocs];
    setInput('');
    setAttachedFiles([]);
    setInjectedDocs([]);

    // Build attachment name list for display
    const allAttachmentNames = [
      ...filesSnapshot.map((f) => f.name),
      ...injectedSnapshot.map((d) => d.name),
    ];

    setMessages((prev) => [
      ...prev,
      {
        role: 'user',
        content: userMsg || `[Attached: ${allAttachmentNames.join(', ')}]`,
        attachments: allAttachmentNames.length ? allAttachmentNames : undefined,
      },
    ]);

    setExtracting(true);

    // Extract server-side injected docs
    if (injectedSnapshot.length > 0) {
      try {
        const res = await fetch('/api/ai/inject-docs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-auth-token': token },
          body: JSON.stringify({ docs: injectedSnapshot }),
        });
        if (res.ok) {
          const { extractedText } = await res.json();
          const names = injectedSnapshot.map((d) => d.name).join(', ');
          userMsg = [
            userMsg || "I've shared these documents. Please analyze them and help me.",
            `\n\n[SHARED DOCUMENTS: ${names}]\n${extractedText}`,
          ].join('');
        }
      } catch {
        /* continue without injected content */
      }
    }

    // Extract uploaded files
    if (filesSnapshot.length > 0) {
      try {
        const fd = new FormData();
        filesSnapshot.forEach((f, i) => fd.append(`file_${i}`, f));
        const extractRes = await fetch('/api/jobs/extract-from-files', {
          method: 'POST',
          headers: { 'x-auth-token': token },
          body: fd,
        });
        if (extractRes.ok) {
          const { extractedText, extractedAddress } = await extractRes.json();
          const addrNote = extractedAddress?.street
            ? `\nProject address found: ${[extractedAddress.street, extractedAddress.city, extractedAddress.state].filter(Boolean).join(', ')}`
            : '';
          const names = filesSnapshot.map((f) => f.name).join(', ');
          userMsg = [
            userMsg ||
              "I've attached construction documents. Please analyze them and help me build a quote.",
            `\n\n[ATTACHED DOCUMENTS: ${names}]${addrNote}\n${extractedText}`,
          ].join('');
        } else {
          userMsg =
            userMsg ||
            `I tried to attach ${filesSnapshot.map((f) => f.name).join(', ')} but couldn't read them.`;
        }
      } catch {
        userMsg = userMsg || `Attached files — couldn't extract content.`;
      }
    }

    setExtracting(false);
    setLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-auth-token': token },
        body: JSON.stringify({ message: userMsg, language }),
      });
      if (res.status === 401) {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: '❌ Session expired. Please refresh and log in again.' },
        ]);
        setLoading(false);
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: '❌ Error: ' + (data.error || 'Something went wrong.') },
        ]);
        setLoading(false);
        return;
      }
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: data.reply, createdTask: data.createdTask || null },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: '❌ Connection error. Please try again.' },
      ]);
    }
    setLoading(false);
  };

  const quickPrompts = [
    "What's the phone number for [customer name]?",
    "What's the status of the job at [address]?",
    'Remind me to call for inspection tomorrow at 5pm',
    'What is the Stretch Code requirement for Ashby?',
    'How do I calculate GC markup on a $50K framing job?',
    'Quanto custa revestimento spray foam?',
  ];

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        padding: 32,
        boxSizing: 'border-box',
      }}
    >
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} } @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }`}</style>

      {/* Doc picker modal */}
      {docPickerOpen && (
        <DocPickerModal
          token={token}
          onClose={() => setDocPickerOpen(false)}
          onInject={handleInjectDocs}
        />
      )}

      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 'bold', color: BLUE, margin: 0 }}>
            🤖 Ask the Bot
          </h1>
          <p style={{ color: '#888', fontSize: 12, marginTop: 4 }}>
            Contacts · Jobs · Prices · MA Codes · Reminders · Plans — EN & PT-BR
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <Link
            to="/tasks"
            style={{
              padding: '7px 14px',
              background: '#f0f4ff',
              color: BLUE,
              borderRadius: 6,
              textDecoration: 'none',
              fontSize: 12,
              fontWeight: 'bold',
              border: '1px solid #C8D4E4',
            }}
          >
            ✅ View Tasks
          </Link>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            style={{ padding: '6px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 13 }}
          >
            <option value="en">🇺🇸 English</option>
            <option value="pt-BR">🇧🇷 Português</option>
          </select>
        </div>
      </div>

      {/* Quick prompts */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        {quickPrompts.map((p) => (
          <button
            key={p}
            onClick={() => setInput(p)}
            style={{
              fontSize: 11,
              padding: '4px 10px',
              background: '#E3ECFF',
              border: '1px solid #1B3A6B33',
              borderRadius: 20,
              cursor: 'pointer',
              color: BLUE,
            }}
          >
            {p}
          </button>
        ))}
      </div>

      {/* Messages */}
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          background: 'white',
          borderRadius: 10,
          padding: 20,
          boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
          marginBottom: 14,
        }}
      >
        {messages.map((msg, i) => (
          <div key={i}>
            <div
              style={{
                display: 'flex',
                justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                marginBottom: msg.attachments?.length ? 4 : 12,
              }}
            >
              <div
                style={{
                  maxWidth: '78%',
                  background: msg.role === 'user' ? BLUE : '#f4f6fb',
                  color: msg.role === 'user' ? 'white' : '#222',
                  padding: '12px 16px',
                  borderRadius: 12,
                  fontSize: 13,
                  lineHeight: 1.6,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {msg.content}
              </div>
            </div>

            {/* Attachment chips on user messages */}
            {msg.attachments?.length > 0 && (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: 6,
                  flexWrap: 'wrap',
                  marginBottom: 12,
                }}
              >
                {msg.attachments.map((name, j) => (
                  <div
                    key={j}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      background: '#dbe7ff',
                      borderRadius: 20,
                      padding: '3px 10px',
                      fontSize: 11,
                      color: BLUE,
                      fontWeight: 600,
                    }}
                  >
                    <span>{name.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? '🖼️' : '📄'}</span>
                    <span
                      style={{
                        maxWidth: 120,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {name}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Task created card */}
            {msg.createdTask && (
              <div
                style={{
                  margin: '0 0 14px 0',
                  background: '#f0fdf4',
                  border: '1px solid #bbf7d0',
                  borderRadius: 10,
                  padding: '14px 16px',
                  maxWidth: 380,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 'bold', color: GREEN, marginBottom: 8 }}>
                  ✅ Task Saved
                </div>
                <div style={{ fontSize: 13, fontWeight: 'bold', color: BLUE, marginBottom: 4 }}>
                  {msg.createdTask.title}
                </div>
                {msg.createdTask.due_at && (
                  <div style={{ fontSize: 12, color: '#555', marginBottom: 8 }}>
                    🕐{' '}
                    {new Date(msg.createdTask.due_at).toLocaleString('en-US', {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8 }}>
                  <Link
                    to="/tasks"
                    style={{
                      padding: '6px 12px',
                      background: BLUE,
                      color: 'white',
                      borderRadius: 6,
                      textDecoration: 'none',
                      fontSize: 11,
                      fontWeight: 'bold',
                    }}
                  >
                    View in Tasks
                  </Link>
                  {msg.createdTask.calendar_url && (
                    <a
                      href={msg.createdTask.calendar_url}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        padding: '6px 12px',
                        background: '#4285F422',
                        color: '#4285F4',
                        border: '1px solid #4285F440',
                        borderRadius: 6,
                        textDecoration: 'none',
                        fontSize: 11,
                        fontWeight: 'bold',
                      }}
                    >
                      📅 Add to Google Calendar
                    </a>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}

        {(extracting || loading) && (
          <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 12 }}>
            <div
              style={{
                background: '#f4f6fb',
                padding: '12px 16px',
                borderRadius: 12,
                fontSize: 13,
                color: '#888',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              {extracting ? (
                <>
                  <span
                    style={{
                      display: 'inline-block',
                      width: 12,
                      height: 12,
                      border: '2px solid #1B3A6B',
                      borderTopColor: 'transparent',
                      borderRadius: '50%',
                      animation: 'spin 0.7s linear infinite',
                    }}
                  />
                  Reading your files...
                </>
              ) : (
                <span style={{ animation: 'pulse 1.2s infinite' }}>Thinking...</span>
              )}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Pending chips (uploaded files + injected docs) */}
      {(attachedFiles.length > 0 || injectedDocs.length > 0) && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          {/* Uploaded file chips */}
          {attachedFiles.map((f, i) => (
            <div
              key={`file_${i}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                background: '#e8f0fe',
                borderRadius: 20,
                padding: '4px 10px',
                fontSize: 11,
                color: BLUE,
                fontWeight: 600,
              }}
            >
              <span>{f.type.startsWith('image/') ? '🖼️' : '📄'}</span>
              <span
                style={{
                  maxWidth: 140,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {f.name}
              </span>
              <button
                onClick={() => removeFile(i)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#666',
                  fontSize: 14,
                  lineHeight: 1,
                  padding: 0,
                  marginLeft: 2,
                }}
              >
                ×
              </button>
            </div>
          ))}

          {/* Injected doc chips */}
          {injectedDocs.map((doc) => (
            <div
              key={`inj_${doc.id}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                background: '#fdf4e7',
                borderRadius: 20,
                padding: '4px 10px',
                fontSize: 11,
                color: '#92400e',
                fontWeight: 600,
                border: '1px solid #fed7aa',
              }}
            >
              <span>📁</span>
              <span
                style={{
                  maxWidth: 140,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {doc.name}
              </span>
              <button
                onClick={() => removeInjected(doc.id)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#92400e',
                  fontSize: 14,
                  lineHeight: 1,
                  padding: 0,
                  marginLeft: 2,
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input row */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".jpg,.jpeg,.png,.gif,.webp,.pdf"
        style={{ display: 'none' }}
        onChange={(e) => {
          const newFiles = Array.from(e.target.files || []);
          setAttachedFiles((prev) => {
            const names = new Set(prev.map((f) => f.name));
            return [...prev, ...newFiles.filter((f) => !names.has(f.name))];
          });
          e.target.value = '';
        }}
      />

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {/* Upload from device button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          title="Attach plans, blueprints, or photos from your device"
          style={{
            padding: '10px 14px',
            background: attachedFiles.length ? '#e8f0fe' : '#f4f6fb',
            border: `1.5px solid ${attachedFiles.length ? BLUE : '#C8D4E4'}`,
            borderRadius: 8,
            cursor: 'pointer',
            fontSize: 18,
            lineHeight: 1,
            color: attachedFiles.length ? BLUE : '#888',
            flexShrink: 0,
          }}
        >
          📎
        </button>

        {/* Import from lead/contact button */}
        <button
          onClick={() => setDocPickerOpen(true)}
          title="Import documents already on file for a lead or contact"
          style={{
            padding: '10px 14px',
            background: injectedDocs.length ? '#fdf4e7' : '#f4f6fb',
            border: `1.5px solid ${injectedDocs.length ? '#f59e0b' : '#C8D4E4'}`,
            borderRadius: 8,
            cursor: 'pointer',
            fontSize: 18,
            lineHeight: 1,
            color: injectedDocs.length ? '#92400e' : '#888',
            flexShrink: 0,
          }}
        >
          📁
        </button>

        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && send()}
          placeholder={
            attachedFiles.length || injectedDocs.length
              ? 'Add a message or just hit Send to analyze the files...'
              : language === 'pt-BR'
                ? 'Faça sua pergunta...'
                : 'Ask anything · 📎 upload files · 📁 import from lead/contact'
          }
          style={{
            flex: 1,
            padding: '12px 16px',
            border: '1.5px solid #C8D4E4',
            borderRadius: 8,
            fontSize: 14,
            outline: 'none',
          }}
        />

        <button
          onClick={send}
          disabled={
            loading ||
            extracting ||
            (!input.trim() && !attachedFiles.length && !injectedDocs.length)
          }
          style={{
            padding: '12px 24px',
            background: BLUE,
            color: 'white',
            border: 'none',
            borderRadius: 8,
            cursor: 'pointer',
            fontWeight: 'bold',
            fontSize: 14,
            opacity:
              loading ||
              extracting ||
              (!input.trim() && !attachedFiles.length && !injectedDocs.length)
                ? 0.5
                : 1,
            flexShrink: 0,
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}
