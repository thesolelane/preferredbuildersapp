import { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation } from 'react-router-dom';

const BLUE = '#1B3A6B';
const ORANGE = '#E07B2A';
const DARK_BUBBLE = '#1B3A6B';
const LIGHT_BUBBLE = '#e8ecf4';
const DESKTOP_MIN_WIDTH = 768;

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(() => window.innerWidth >= DESKTOP_MIN_WIDTH);
  useEffect(() => {
    const handler = () => setIsDesktop(window.innerWidth >= DESKTOP_MIN_WIDTH);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return isDesktop;
}

function MsgBubble({ msg, senderName }) {
  const isOwn = msg.sender_name === senderName;
  const fmt = (ts) => {
    if (!ts) return '';
    return new Date(ts + (ts.includes('Z') ? '' : 'Z')).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  };
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: isOwn ? 'flex-end' : 'flex-start',
      }}
    >
      {!isOwn && (
        <div style={{ fontSize: 10, color: '#888', marginBottom: 2, paddingLeft: 4 }}>
          {msg.sender_name}
        </div>
      )}
      <div
        style={{
          maxWidth: '78%',
          background: isOwn ? DARK_BUBBLE : LIGHT_BUBBLE,
          color: isOwn ? 'white' : '#1a1a2e',
          padding: '8px 12px',
          borderRadius: isOwn ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
          fontSize: 13,
          lineHeight: 1.45,
          wordBreak: 'break-word',
        }}
      >
        {msg.message}
      </div>
      <div
        style={{
          fontSize: 10,
          color: '#bbb',
          marginTop: 2,
          paddingLeft: isOwn ? 0 : 4,
          paddingRight: isOwn ? 4 : 0,
        }}
      >
        {fmt(msg.created_at)}
      </div>
    </div>
  );
}

function StaffChatWidget({ token }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('group');

  // Group chat state
  const [groupMessages, setGroupMessages] = useState([]);
  const [groupInput, setGroupInput] = useState('');
  const [groupUnread, setGroupUnread] = useState(0);

  // DM state
  const [users, setUsers] = useState([]);
  const [dmThread, setDmThread] = useState(null);
  const [dmMessages, setDmMessages] = useState({});
  const [dmInput, setDmInput] = useState('');
  const [dmUnread, setDmUnread] = useState({});

  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);
  const openRef = useRef(open);
  const tabRef = useRef(tab);
  const dmThreadRef = useRef(dmThread);
  const initialLoadRef = useRef(true);
  const originalTitleRef = useRef(document.title);

  const senderName = localStorage.getItem('pb_user_name') || 'Staff';
  const headers = { 'x-auth-token': token, 'Content-Type': 'application/json' };

  useEffect(() => {
    openRef.current = open;
  }, [open]);
  useEffect(() => {
    tabRef.current = tab;
  }, [tab]);
  useEffect(() => {
    dmThreadRef.current = dmThread;
  }, [dmThread]);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  }, []);

  // ── Fetch group history ────────────────────────────────────────────────────
  const fetchGroup = useCallback(async () => {
    const res = await fetch('/api/staff-chat/messages', {
      headers: { 'x-auth-token': token },
    }).catch(() => null);
    if (res?.ok) setGroupMessages(await res.json());
  }, [token]);

  // ── Fetch DM thread history ────────────────────────────────────────────────
  const fetchDm = useCallback(
    async (name) => {
      const res = await fetch(`/api/staff-chat/dm/${encodeURIComponent(name)}`, {
        headers: { 'x-auth-token': token },
      }).catch(() => null);
      if (res?.ok) {
        const data = await res.json();
        setDmMessages((prev) => ({ ...prev, [name]: data }));
      }
    },
    [token],
  );

  // ── Fetch user list ────────────────────────────────────────────────────────
  const fetchUsers = useCallback(async () => {
    const res = await fetch('/api/staff-chat/users', { headers: { 'x-auth-token': token } }).catch(
      () => null,
    );
    if (res?.ok) {
      const data = await res.json();
      setUsers(data.filter((u) => u !== senderName));
    }
  }, [token, senderName]);

  // ── Notification helpers ───────────────────────────────────────────────────
  const playPing = useCallback(() => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 440;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.4);
    } catch (_) {}
  }, []);

  const showBrowserNotification = useCallback((title, body, onClickOpen) => {
    if (typeof Notification === 'undefined') return;
    const send = () => {
      const n = new Notification(title, { body: body.slice(0, 80) });
      n.onclick = () => {
        window.focus();
        onClickOpen();
        n.close();
      };
    };
    if (Notification.permission === 'granted') {
      send();
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then((perm) => {
        if (perm === 'granted') send();
      });
    }
  }, []);

  // ── SSE listener ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!token) return;
    const es = new EventSource(`/api/staff-chat/events?token=${encodeURIComponent(token)}`);

    es.addEventListener('staff-chat', (e) => {
      const msg = JSON.parse(e.data);
      setGroupMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
      if (!openRef.current || tabRef.current !== 'group') {
        if (!initialLoadRef.current) {
          playPing();
          if (document.hidden) {
            showBrowserNotification(`${msg.sender_name} — Preferred Builders`, msg.message, () =>
              setOpen(true),
            );
          }
        }
        setGroupUnread((n) => n + 1);
      }
    });

    es.addEventListener('staff-dm', (e) => {
      const msg = JSON.parse(e.data);
      const other = msg.sender_name === senderName ? msg.recipient : msg.sender_name;
      setDmMessages((prev) => {
        const thread = prev[other] || [];
        if (thread.some((m) => m.id === msg.id)) return prev;
        return { ...prev, [other]: [...thread, msg] };
      });
      const isActive = openRef.current && tabRef.current === 'dm' && dmThreadRef.current === other;
      if (!isActive) {
        if (!initialLoadRef.current) {
          playPing();
          if (document.hidden) {
            showBrowserNotification(`${msg.sender_name} — Preferred Builders`, msg.message, () =>
              setOpen(true),
            );
          }
        }
        setDmUnread((prev) => ({ ...prev, [other]: (prev[other] || 0) + 1 }));
      }
    });

    es.onerror = () => {};
    // Mark initial load complete after SSE is connected
    const initTimer = setTimeout(() => {
      initialLoadRef.current = false;
    }, 1000);
    return () => {
      clearTimeout(initTimer);
      es.close();
    };
  }, [token, senderName, playPing, showBrowserNotification]);

  // ── On open ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (open) {
      fetchGroup();
      fetchUsers();
    }
  }, [open]);

  useEffect(() => {
    if (open && tab === 'group') {
      setGroupUnread(0);
      scrollToBottom();
    }
  }, [open, tab, groupMessages]);

  useEffect(() => {
    if (open && tab === 'dm' && dmThread) {
      setDmUnread((prev) => ({ ...prev, [dmThread]: 0 }));
      scrollToBottom();
    }
  }, [open, tab, dmThread, dmMessages]);

  // ── Update/restore title based on unread counts and chat visibility ────────
  useEffect(() => {
    if (open) {
      document.title = originalTitleRef.current;
      return;
    }
    const totalDm = Object.values(dmUnread).reduce((a, b) => a + b, 0);
    const total = groupUnread + totalDm;
    if (total > 0) {
      document.title = `(${total}) ${originalTitleRef.current}`;
    } else {
      document.title = originalTitleRef.current;
    }
  }, [open, groupUnread, dmUnread]);

  useEffect(() => {
    if (tab === 'dm' && !dmThread) fetchUsers();
  }, [tab]);

  // ── Send group message ─────────────────────────────────────────────────────
  const sendGroup = async () => {
    const text = groupInput.trim();
    if (!text || sending) return;
    setSending(true);
    setGroupInput('');
    const res = await fetch('/api/staff-chat/message', {
      method: 'POST',
      headers,
      body: JSON.stringify({ message: text }),
    }).catch(() => null);
    if (!res?.ok) setGroupInput(text);
    setSending(false);
  };

  // ── Send DM ────────────────────────────────────────────────────────────────
  const sendDm = async () => {
    const text = dmInput.trim();
    if (!text || sending || !dmThread) return;
    setSending(true);
    setDmInput('');
    const res = await fetch('/api/staff-chat/dm', {
      method: 'POST',
      headers,
      body: JSON.stringify({ recipient: dmThread, message: text }),
    }).catch(() => null);
    if (!res?.ok) setDmInput(text);
    setSending(false);
  };

  const onKeyDown = (e, fn) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      fn();
    }
  };

  const totalUnread = groupUnread + Object.values(dmUnread).reduce((s, n) => s + n, 0);

  // ── Input bar ─────────────────────────────────────────────────────────────
  const InputBar = ({ value, onChange, onSend, placeholder }) => (
    <div
      style={{
        padding: '10px 12px',
        borderTop: '1px solid #eee',
        display: 'flex',
        gap: 8,
        flexShrink: 0,
        background: '#fafbfd',
      }}
    >
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => onKeyDown(e, onSend)}
        placeholder={placeholder}
        style={{
          flex: 1,
          border: '1px solid #d0d5e0',
          borderRadius: 8,
          padding: '8px 12px',
          fontSize: 13,
          outline: 'none',
          background: 'white',
        }}
        autoFocus
      />
      <button
        onClick={onSend}
        disabled={!value.trim() || sending}
        style={{
          background: ORANGE,
          color: 'white',
          border: 'none',
          borderRadius: 8,
          padding: '8px 14px',
          fontSize: 13,
          fontWeight: 'bold',
          cursor: value.trim() && !sending ? 'pointer' : 'not-allowed',
          opacity: value.trim() && !sending ? 1 : 0.55,
          flexShrink: 0,
        }}
      >
        Send
      </button>
    </div>
  );

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        zIndex: 2000,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        fontFamily: 'Arial, sans-serif',
      }}
    >
      {open && (
        <div
          style={{
            width: 340,
            height: 480,
            background: 'white',
            borderRadius: 12,
            boxShadow: '0 8px 32px rgba(0,0,0,0.22)',
            display: 'flex',
            flexDirection: 'column',
            marginBottom: 12,
            overflow: 'hidden',
            border: '1px solid #dce1ea',
          }}
        >
          {/* Header */}
          <div
            style={{
              background: BLUE,
              color: 'white',
              padding: '12px 16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexShrink: 0,
            }}
          >
            <div style={{ fontWeight: 'bold', fontSize: 14 }}>
              {tab === 'dm' && dmThread ? (
                <span>
                  <button
                    onClick={() => setDmThread(null)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'white',
                      cursor: 'pointer',
                      fontSize: 13,
                      padding: 0,
                      marginRight: 6,
                    }}
                  >
                    ←
                  </button>
                  🔒 {dmThread}
                </span>
              ) : tab === 'dm' ? (
                '🔒 Direct Messages'
              ) : (
                '💬 Team Chat'
              )}
            </div>
            <button
              onClick={() => setOpen(false)}
              style={{
                background: 'none',
                border: 'none',
                color: 'white',
                fontSize: 18,
                cursor: 'pointer',
                padding: '2px 6px',
                lineHeight: 1,
              }}
            >
              ✕
            </button>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', borderBottom: '1px solid #eee', flexShrink: 0 }}>
            {[
              ['group', '💬 Group'],
              ['dm', '🔒 Direct'],
            ].map(([key, label]) => (
              <button
                key={key}
                onClick={() => {
                  setTab(key);
                  if (key === 'group') setGroupUnread(0);
                  if (key === 'dm') setDmThread(null);
                }}
                style={{
                  flex: 1,
                  padding: '8px 0',
                  border: 'none',
                  borderBottom: tab === key ? `2px solid ${BLUE}` : '2px solid transparent',
                  background: 'white',
                  color: tab === key ? BLUE : '#888',
                  fontWeight: tab === key ? 700 : 400,
                  fontSize: 12,
                  cursor: 'pointer',
                  position: 'relative',
                }}
              >
                {label}
                {key === 'group' && groupUnread > 0 && (
                  <span
                    style={{
                      marginLeft: 4,
                      background: ORANGE,
                      color: 'white',
                      borderRadius: 10,
                      fontSize: 10,
                      padding: '1px 5px',
                      fontWeight: 'bold',
                    }}
                  >
                    {groupUnread}
                  </span>
                )}
                {key === 'dm' && Object.values(dmUnread).some((n) => n > 0) && (
                  <span
                    style={{
                      marginLeft: 4,
                      background: ORANGE,
                      color: 'white',
                      borderRadius: 10,
                      fontSize: 10,
                      padding: '1px 5px',
                      fontWeight: 'bold',
                    }}
                  >
                    {Object.values(dmUnread).reduce((s, n) => s + n, 0)}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* ── Group tab ── */}
          {tab === 'group' && (
            <>
              <div
                style={{
                  flex: 1,
                  overflowY: 'auto',
                  padding: '12px 14px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                {groupMessages.length === 0 && (
                  <div style={{ textAlign: 'center', color: '#999', fontSize: 13, marginTop: 40 }}>
                    No messages yet. Say hello!
                  </div>
                )}
                {groupMessages.map((msg) => (
                  <MsgBubble key={msg.id} msg={msg} senderName={senderName} />
                ))}
                <div ref={bottomRef} />
              </div>
              <InputBar
                value={groupInput}
                onChange={setGroupInput}
                onSend={sendGroup}
                placeholder="Message the team…"
              />
            </>
          )}

          {/* ── DM tab — user list ── */}
          {tab === 'dm' && !dmThread && (
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px' }}>
              {users.length === 0 && (
                <div style={{ textAlign: 'center', color: '#999', fontSize: 13, marginTop: 40 }}>
                  No other staff members found.
                </div>
              )}
              {users.map((name) => (
                <button
                  key={name}
                  onClick={() => {
                    setDmThread(name);
                    fetchDm(name);
                    setDmUnread((prev) => ({ ...prev, [name]: 0 }));
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    width: '100%',
                    padding: '11px 14px',
                    marginBottom: 6,
                    border: '1px solid #e4e8f0',
                    borderRadius: 8,
                    background: '#fafbfd',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: '50%',
                        background: BLUE,
                        color: 'white',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 'bold',
                        fontSize: 14,
                        flexShrink: 0,
                      }}
                    >
                      {name.charAt(0).toUpperCase()}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#222' }}>{name}</span>
                  </span>
                  {dmUnread[name] > 0 && (
                    <span
                      style={{
                        background: ORANGE,
                        color: 'white',
                        borderRadius: 10,
                        fontSize: 11,
                        padding: '2px 7px',
                        fontWeight: 'bold',
                      }}
                    >
                      {dmUnread[name]}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* ── DM tab — thread ── */}
          {tab === 'dm' && dmThread && (
            <>
              <div
                style={{
                  flex: 1,
                  overflowY: 'auto',
                  padding: '12px 14px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                {(dmMessages[dmThread] || []).length === 0 && (
                  <div style={{ textAlign: 'center', color: '#999', fontSize: 13, marginTop: 40 }}>
                    No messages yet. Start the conversation.
                  </div>
                )}
                {(dmMessages[dmThread] || []).map((msg) => (
                  <MsgBubble key={msg.id} msg={msg} senderName={senderName} />
                ))}
                <div ref={bottomRef} />
              </div>
              <InputBar
                value={dmInput}
                onChange={setDmInput}
                onSend={sendDm}
                placeholder={`Message ${dmThread}…`}
              />
            </>
          )}
        </div>
      )}

      {/* Toggle button */}
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          background: BLUE,
          color: 'white',
          border: 'none',
          borderRadius: 28,
          padding: '12px 20px',
          fontSize: 14,
          fontWeight: 'bold',
          cursor: 'pointer',
          boxShadow: '0 4px 16px rgba(27,58,107,0.45)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          position: 'relative',
        }}
        title={open ? 'Close Team Chat' : 'Open Team Chat'}
      >
        <span>Team Chat 💬</span>
        {!open && totalUnread > 0 && (
          <span
            style={{
              background: ORANGE,
              color: 'white',
              borderRadius: '50%',
              fontSize: 11,
              fontWeight: 'bold',
              minWidth: 20,
              height: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 4px',
            }}
          >
            {totalUnread > 99 ? '99+' : totalUnread}
          </span>
        )}
      </button>
    </div>
  );
}

export default function StaffChat({ token }) {
  const isDesktop = useIsDesktop();
  const { pathname } = useLocation();
  if (!isDesktop) return null;
  if (pathname === '/chat') return null;
  return <StaffChatWidget token={token} />;
}
