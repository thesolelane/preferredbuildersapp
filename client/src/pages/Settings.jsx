// client/src/pages/Settings.jsx
import { useState, useEffect } from 'react';

const BLUE = '#1B3A6B';
const ORANGE = '#E07B2A';

const BASE_TABS = [
  'Markup',
  'Labor Rates',
  'Dept Definitions',
  'Allowances',
  'Integrations',
  'Bot Behavior',
  'Calendar',
  'Email Log',
];

export default function Settings({ token, userRole }) {
  const TABS = userRole === 'system_admin' ? [...BASE_TABS, 'Secrets', 'Status', 'Logs'] : BASE_TABS;

  const [settings, setSettings] = useState({});
  const [activeTab, setActiveTab] = useState('Markup');
  const [saved, setSaved] = useState(false);
  const [integration, setIntegration] = useState({});
  const [calendars, setCalendars] = useState([]);
  const [calLoading, setCalLoading] = useState(false);
  const [calSaved, setCalSaved] = useState(false);
  const [secrets, setSecrets] = useState([]);
  const [showValues, setShowValues] = useState({});
  const [secretsLoading, setSecretsLoading] = useState(false);
  const [secretsMsg, setSecretsMsg] = useState(null);
  const [editingKey, setEditingKey] = useState(null);
  const [editDraft, setEditDraft] = useState({ key: '', value: '' });
  const [addingNew, setAddingNew] = useState(false);
  const [newSecret, setNewSecret] = useState({ key: '', value: '' });
  const [statusData, setStatusData] = useState(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState(null);
  const [emailLog, setEmailLog] = useState(null);
  const [emailLogLoading, setEmailLogLoading] = useState(false);
  const [emailPreview, setEmailPreview] = useState(null);
  const [reportSchedule, setReportSchedule] = useState(null);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleSaved, setScheduleSaved] = useState(false);
  const [backupInfo, setBackupInfo] = useState(null);
  const [backupRunning, setBackupRunning] = useState(false);
  const [backupMsg, setBackupMsg] = useState(null);

  const [logsData, setLogsData] = useState(null);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState(null);
  const [logsPanel, setLogsPanel] = useState('error');
  const [logsLines, setLogsLines] = useState(200);

  const [printerName, setPrinterName] = useState('');
  const [printerSaving, setPrinterSaving] = useState(false);
  const [printerSaved, setPrinterSaved] = useState(false);
  const [printerList, setPrinterList] = useState([]);
  const [printerDetecting, setPrinterDetecting] = useState(false);
  const [scanInboxFolder, setScanInboxFolder] = useState('');
  const [scanFolderSaving, setScanFolderSaving] = useState(false);
  const [scanFolderSaved, setScanFolderSaved] = useState(false);

  const [allowedIps, setAllowedIps] = useState([]);
  const [newIp, setNewIp] = useState('');
  const [ipSaving, setIpSaving] = useState(false);
  const [ipMsg, setIpMsg] = useState(null);

  const [depts, setDepts] = useState([]);
  const [deptsLoading, setDeptsLoading] = useState(false);
  const [deptsDraft, setDeptsDraft] = useState({});
  const [deptsSaving, setDeptsSaving] = useState({});
  const [deptsExpanded, setDeptsExpanded] = useState({});

  const headers = { 'x-auth-token': token, 'Content-Type': 'application/json' };

  // Auto-load email log when the tab is opened for the first time
  useEffect(() => {
    if (activeTab === 'Dept Definitions' && depts.length === 0 && !deptsLoading) {
      setDeptsLoading(true);
      fetch('/api/departments', { headers: { 'x-auth-token': token } })
        .then((r) => r.json())
        .then((data) => {
          if (Array.isArray(data)) {
            setDepts(data);
            const draft = {};
            for (const dept of data) {
              draft[`d:${dept.id}`] = { name: dept.name, meaning: dept.meaning || '' };
              for (const sub of dept.subDepartments) {
                draft[`s:${sub.id}`] = { name: sub.name, meaning: sub.meaning || '' };
              }
            }
            setDeptsDraft(draft);
            const expanded = {};
            if (data.length > 0) expanded[data[0].id] = true;
            setDeptsExpanded(expanded);
          }
        })
        .catch(() => {})
        .finally(() => setDeptsLoading(false));
    }
    if (activeTab === 'Email Log' && !emailLog && !emailLogLoading) {
      loadEmailLog();
    }
    if (activeTab === 'Status' && !reportSchedule) {
      fetch('/api/status/schedule', { headers: { 'x-auth-token': token } })
        .then((r) => r.json())
        .then((data) => {
          if (!data.error) setReportSchedule(data);
        })
        .catch(() => {});
      fetch('/api/status/backup', { headers: { 'x-auth-token': token } })
        .then((r) => r.json())
        .then((data) => {
          if (!data.error) setBackupInfo(data);
        })
        .catch(() => {});
    }
    if (activeTab === 'Integrations') {
      fetch('/api/settings/security/allowed-ips', { headers: { 'x-auth-token': token } })
        .then((r) => r.json())
        .then((data) => {
          if (data && Array.isArray(data.ips)) setAllowedIps(data.ips);
        })
        .catch(() => {});
    }
    if (activeTab === 'Logs') {
      loadLogs(200);
    }
  }, [activeTab]);

  // Auto-refresh email log every 20s while the tab is open and log is loaded
  useEffect(() => {
    if (activeTab !== 'Email Log' || !emailLog) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/email-log?limit=200', { headers: { 'x-auth-token': token } });
        const data = await res.json();
        if (data && !data.error) setEmailLog(data);
      } catch (_e) {
        /* non-critical polling — ignore failures */
      }
    }, 20000);
    return () => clearInterval(interval);
  }, [activeTab, emailLog, token]);

  useEffect(() => {
    fetch('/api/settings', { headers: { 'x-auth-token': token } })
      .then((r) => r.json())
      .then((data) => {
        if (data && !data.error) setSettings(data);
      });
    fetch('/api/settings/integrations/status', { headers: { 'x-auth-token': token } })
      .then((r) => r.json())
      .then((data) => {
        if (data && !data.error) setIntegration(data);
      });
    fetch('/api/print/printers', { headers: { 'x-auth-token': token } })
      .then((r) => r.json())
      .then((data) => {
        if (data.currentPrinter) setPrinterName(data.currentPrinter);
      })
      .catch(() => {});
    fetch('/api/scan/inbox', { headers: { 'x-auth-token': token } })
      .then((r) => r.json())
      .then((data) => {
        if (data.folder) setScanInboxFolder(data.folder);
      })
      .catch(() => {});
  }, []);

  const savePrinterName = async () => {
    setPrinterSaving(true);
    try {
      await fetch('/api/settings', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ print_printer_name: printerName }),
      });
      setPrinterSaved(true);
      setTimeout(() => setPrinterSaved(false), 2500);
    } catch {}
    setPrinterSaving(false);
  };

  const detectPrinters = async () => {
    setPrinterDetecting(true);
    try {
      const res = await fetch('/api/print/printers', { headers: { 'x-auth-token': token } });
      const data = await res.json();
      setPrinterList(data.printers || []);
      if (data.currentPrinter && !printerName) setPrinterName(data.currentPrinter);
    } catch {}
    setPrinterDetecting(false);
  };

  const saveScanFolder = async () => {
    setScanFolderSaving(true);
    try {
      await fetch('/api/settings', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ scan_inbox_folder: scanInboxFolder }),
      });
      setScanFolderSaved(true);
      setTimeout(() => setScanFolderSaved(false), 2500);
    } catch {}
    setScanFolderSaving(false);
  };

  const addIp = async () => {
    const ip = newIp.trim();
    if (!ip) return;
    setIpSaving(true);
    setIpMsg(null);
    try {
      const res = await fetch('/api/settings/security/allowed-ips', {
        method: 'POST',
        headers,
        body: JSON.stringify({ ip }),
      });
      const data = await res.json();
      if (data.ips) {
        setAllowedIps(data.ips);
        setNewIp('');
        setIpMsg({ type: 'success', text: `${ip} added` });
      } else {
        setIpMsg({ type: 'error', text: data.error || 'Failed' });
      }
    } catch {
      setIpMsg({ type: 'error', text: 'Network error' });
    }
    setIpSaving(false);
    setTimeout(() => setIpMsg(null), 3000);
  };

  const removeIp = async (ip) => {
    try {
      const res = await fetch(`/api/settings/security/allowed-ips/${encodeURIComponent(ip)}`, {
        method: 'DELETE',
        headers,
      });
      const data = await res.json();
      if (data.ips) setAllowedIps(data.ips);
    } catch {}
  };

  const update = (key, value) => {
    setSettings((prev) => ({
      ...prev,
      [Object.keys(prev).find((cat) => prev[cat].find((s) => s.key === key))]: prev[
        Object.keys(prev).find((cat) => prev[cat].find((s) => s.key === key))
      ].map((s) => (s.key === key ? { ...s, value } : s)),
    }));
  };

  const save = async () => {
    const allSettings = {};
    Object.values(settings)
      .flat()
      .forEach((s) => {
        allSettings[s.key] = s.value;
      });
    await fetch('/api/settings', { method: 'PUT', headers, body: JSON.stringify(allSettings) });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const loadCalendars = async () => {
    setCalLoading(true);
    try {
      const res = await fetch('/api/tasks/calendars', { headers: { 'x-auth-token': token } });
      const data = await res.json();
      if (res.ok) setCalendars(data.calendars || []);
      else setCalendars([]);
    } catch {
      setCalendars([]);
    }
    setCalLoading(false);
  };

  const saveCal = async (calId, enabled) => {
    await fetch('/api/settings', {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        'gcal.calendarId': calId,
        'gcal.enabled': enabled ? 'true' : 'false',
      }),
    });
    setCalSaved(true);
    setTimeout(() => setCalSaved(false), 2000);
  };

  const switchPlatform = async (platform) => {
    await fetch('/api/settings/integrations/switch', {
      method: 'POST',
      headers,
      body: JSON.stringify({ platform }),
    });
    setIntegration((prev) => ({ ...prev, platform }));
  };

  const renderMarkup = () => {
    const items = settings.markup || [];
    const pricingItems = settings.pricing || [];
    const sqftLow = pricingItems.find((s) => s.key === 'pricing.sqftLow');
    const sqftHigh = pricingItems.find((s) => s.key === 'pricing.sqftHigh');
    const sqftRenoLow = pricingItems.find((s) => s.key === 'pricing.sqftRenoLow');
    const sqftRenoHigh = pricingItems.find((s) => s.key === 'pricing.sqftRenoHigh');
    return (
      <div>
        <p style={{ color: '#888', fontSize: 13, marginBottom: 20 }}>
          These percentages are applied to every estimate automatically.
        </p>
        {items.map((s) => (
          <div key={s.key} style={{ marginBottom: 20 }}>
            <label
              style={{
                fontSize: 13,
                fontWeight: 'bold',
                color: '#333',
                display: 'block',
                marginBottom: 6,
              }}
            >
              {s.label}
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <input
                type="range"
                min="0"
                max="0.5"
                step="0.01"
                value={parseFloat(s.value) || 0}
                onChange={(e) => update(s.key, parseFloat(e.target.value))}
                style={{ flex: 1 }}
              />
              <span style={{ width: 50, textAlign: 'right', fontWeight: 'bold', color: BLUE }}>
                {Math.round((parseFloat(s.value) || 0) * 100)}%
              </span>
            </div>
          </div>
        ))}

        <div style={{ borderTop: '2px solid #e5e7eb', marginTop: 24, paddingTop: 20 }}>
          <p style={{ fontSize: 13, fontWeight: 'bold', color: '#333', marginBottom: 6 }}>
            Target Price Range (per finished sq ft)
          </p>
          <p style={{ color: '#888', fontSize: 12, marginBottom: 16 }}>
            Claude will calibrate estimates to land within this range for finished/livable space.
            Unfinished garages and basements are excluded. A warning is shown on any job that falls
            outside this range.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div>
              <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>
                Low ($/sqft)
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ color: '#888' }}>$</span>
                <input
                  type="number"
                  min="100"
                  max="1000"
                  step="5"
                  value={sqftLow ? parseFloat(sqftLow.value) || 320 : 320}
                  onChange={(e) => sqftLow && update(sqftLow.key, parseFloat(e.target.value))}
                  style={{
                    width: 80,
                    padding: '6px 8px',
                    border: '1px solid #ddd',
                    borderRadius: 4,
                    fontSize: 14,
                    fontWeight: 'bold',
                  }}
                />
              </div>
            </div>
            <span style={{ fontSize: 18, color: '#888', marginTop: 16 }}>—</span>
            <div>
              <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>
                High ($/sqft)
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ color: '#888' }}>$</span>
                <input
                  type="number"
                  min="100"
                  max="1000"
                  step="5"
                  value={sqftHigh ? parseFloat(sqftHigh.value) || 350 : 350}
                  onChange={(e) => sqftHigh && update(sqftHigh.key, parseFloat(e.target.value))}
                  style={{
                    width: 80,
                    padding: '6px 8px',
                    border: '1px solid #ddd',
                    borderRadius: 4,
                    fontSize: 14,
                    fontWeight: 'bold',
                  }}
                />
              </div>
            </div>
            <div
              style={{
                marginTop: 16,
                padding: '6px 12px',
                background: '#f0f4ff',
                borderRadius: 6,
                fontSize: 12,
                color: BLUE,
                fontWeight: 500,
              }}
            >
              per finished sq ft
            </div>
          </div>
        </div>

        <div style={{ borderTop: '2px solid #e5e7eb', marginTop: 24, paddingTop: 20 }}>
          <p style={{ fontSize: 13, fontWeight: 'bold', color: '#333', marginBottom: 6 }}>
            Interior Renovation Target Price Range (per finished sq ft)
          </p>
          <p style={{ color: '#888', fontSize: 12, marginBottom: 16 }}>
            Applied when the AI classifies a job as an interior renovation — stud surface to stud
            surface (gut remodels, full interior fit-outs). New construction and ground-up additions
            use the range above.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div>
              <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>
                Low ($/sqft)
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ color: '#888' }}>$</span>
                <input
                  type="number"
                  min="50"
                  max="500"
                  step="5"
                  value={sqftRenoLow ? parseFloat(sqftRenoLow.value) || 100 : 100}
                  onChange={(e) =>
                    sqftRenoLow && update(sqftRenoLow.key, parseFloat(e.target.value))
                  }
                  style={{
                    width: 80,
                    padding: '6px 8px',
                    border: '1px solid #ddd',
                    borderRadius: 4,
                    fontSize: 14,
                    fontWeight: 'bold',
                  }}
                />
              </div>
            </div>
            <span style={{ fontSize: 18, color: '#888', marginTop: 16 }}>—</span>
            <div>
              <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>
                High ($/sqft)
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ color: '#888' }}>$</span>
                <input
                  type="number"
                  min="50"
                  max="500"
                  step="5"
                  value={sqftRenoHigh ? parseFloat(sqftRenoHigh.value) || 150 : 150}
                  onChange={(e) =>
                    sqftRenoHigh && update(sqftRenoHigh.key, parseFloat(e.target.value))
                  }
                  style={{
                    width: 80,
                    padding: '6px 8px',
                    border: '1px solid #ddd',
                    borderRadius: 4,
                    fontSize: 14,
                    fontWeight: 'bold',
                  }}
                />
              </div>
            </div>
            <div
              style={{
                marginTop: 16,
                padding: '6px 12px',
                background: '#fff4e6',
                borderRadius: 6,
                fontSize: 12,
                color: ORANGE,
                fontWeight: 500,
              }}
            >
              per finished sq ft · renovation
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderLaborRates = () => {
    const items = settings.labor || [];
    return (
      <div>
        <p style={{ color: '#888', fontSize: 13, marginBottom: 20 }}>
          Set low and high labor rates by trade. Bot uses the midpoint by default.
        </p>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: BLUE }}>
              {['Trade', 'Low Rate', 'High Rate', 'Unit'].map((h) => (
                <th
                  key={h}
                  style={{ padding: '10px 12px', color: 'white', textAlign: 'left', fontSize: 12 }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((s, i) => {
              const val = typeof s.value === 'object' ? s.value : {};
              return (
                <tr key={s.key} style={{ background: i % 2 === 0 ? 'white' : '#fafafa' }}>
                  <td style={{ padding: '10px 12px', fontSize: 13, fontWeight: '500' }}>
                    {s.label}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <input
                      type="number"
                      value={val.low || 0}
                      onChange={(e) => update(s.key, { ...val, low: parseFloat(e.target.value) })}
                      style={{
                        width: 70,
                        padding: 6,
                        border: '1px solid #ddd',
                        borderRadius: 4,
                        fontSize: 13,
                      }}
                    />
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <input
                      type="number"
                      value={val.high || 0}
                      onChange={(e) => update(s.key, { ...val, high: parseFloat(e.target.value) })}
                      style={{
                        width: 70,
                        padding: 6,
                        border: '1px solid #ddd',
                        borderRadius: 4,
                        fontSize: 13,
                      }}
                    />
                  </td>
                  <td style={{ padding: '10px 12px', fontSize: 12, color: '#888' }}>
                    ${val.unit || ''}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  const saveDeptField = async (type, id) => {
    const key = `${type}:${id}`;
    const draft = deptsDraft[key] || {};
    setDeptsSaving((p) => ({ ...p, [key]: true }));
    try {
      const url = type === 'd' ? `/api/departments/dept/${id}` : `/api/departments/sub/${id}`;
      await fetch(url, { method: 'PUT', headers, body: JSON.stringify(draft) });
      if (type === 'd') {
        setDepts((prev) =>
          prev.map((dept) =>
            dept.id === id ? { ...dept, name: draft.name, meaning: draft.meaning } : dept,
          ),
        );
      } else {
        setDepts((prev) =>
          prev.map((dept) => ({
            ...dept,
            subDepartments: dept.subDepartments.map((sub) =>
              sub.id === id ? { ...sub, name: draft.name, meaning: draft.meaning } : sub,
            ),
          })),
        );
      }
    } catch (_e) {
      /* save failed — user can retry */
    } finally {
      setDeptsSaving((p) => ({ ...p, [key]: false }));
    }
  };

  const renderDeptDefinitions = () => {
    if (deptsLoading) {
      return (
        <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>Loading definitions…</div>
      );
    }
    return (
      <div>
        <p style={{ color: '#888', fontSize: 13, marginBottom: 20 }}>
          Edit department and sub-department names and definitions. The AI reads every definition
          when building estimates — the more precise, the less guessing.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {depts.map((dept) => {
            const dKey = `d:${dept.id}`;
            const dDraft = deptsDraft[dKey] || { name: dept.name, meaning: dept.meaning || '' };
            const isOpen = !!deptsExpanded[dept.id];
            return (
              <div
                key={dept.id}
                style={{ border: '1px solid #dde5f0', borderRadius: 8, overflow: 'hidden' }}
              >
                {/* Department header */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    background: '#f0f4fa',
                    padding: '10px 14px',
                    cursor: 'pointer',
                    userSelect: 'none',
                    gap: 10,
                  }}
                  onClick={() => setDeptsExpanded((p) => ({ ...p, [dept.id]: !p[dept.id] }))}
                >
                  <span
                    style={{
                      fontSize: 12,
                      color: '#94a3b8',
                      transform: isOpen ? 'rotate(90deg)' : 'none',
                      transition: 'transform 0.15s',
                      display: 'inline-block',
                    }}
                  >
                    ▶
                  </span>
                  <span style={{ fontWeight: 700, fontSize: 14, color: '#0f172a', flex: 1 }}>
                    {dDraft.name || dept.name}
                  </span>
                  <span style={{ fontSize: 11, color: '#94a3b8' }}>
                    {dept.subDepartments.length} sub-depts
                  </span>
                </div>

                {/* Department-level name + definition */}
                {isOpen && (
                  <div
                    style={{
                      background: '#fafbff',
                      padding: '14px 16px',
                      borderBottom: '1px solid #e8edf5',
                    }}
                  >
                    <div
                      style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}
                    >
                      <div style={{ flex: '0 0 220px' }}>
                        <label
                          style={{
                            fontSize: 11,
                            color: '#555',
                            fontWeight: 600,
                            display: 'block',
                            marginBottom: 4,
                            textTransform: 'uppercase',
                            letterSpacing: '0.03em',
                          }}
                        >
                          Dept Name
                        </label>
                        <input
                          value={dDraft.name}
                          onChange={(e) =>
                            setDeptsDraft((p) => ({
                              ...p,
                              [dKey]: { ...dDraft, name: e.target.value },
                            }))
                          }
                          style={{
                            width: '100%',
                            padding: '7px 9px',
                            border: '1px solid #ddd',
                            borderRadius: 5,
                            fontSize: 13,
                            boxSizing: 'border-box',
                          }}
                        />
                      </div>
                      <div style={{ flex: 1, minWidth: 240 }}>
                        <label
                          style={{
                            fontSize: 11,
                            color: '#555',
                            fontWeight: 600,
                            display: 'block',
                            marginBottom: 4,
                            textTransform: 'uppercase',
                            letterSpacing: '0.03em',
                          }}
                        >
                          Dept Description (AI context)
                        </label>
                        <textarea
                          rows={2}
                          value={dDraft.meaning}
                          onChange={(e) =>
                            setDeptsDraft((p) => ({
                              ...p,
                              [dKey]: { ...dDraft, meaning: e.target.value },
                            }))
                          }
                          style={{
                            width: '100%',
                            padding: '7px 9px',
                            border: '1px solid #ddd',
                            borderRadius: 5,
                            fontSize: 13,
                            resize: 'vertical',
                            boxSizing: 'border-box',
                            fontFamily: 'inherit',
                          }}
                        />
                      </div>
                      <button
                        onClick={() => saveDeptField('d', dept.id)}
                        disabled={!!deptsSaving[dKey]}
                        style={{
                          padding: '8px 16px',
                          background: BLUE,
                          color: 'white',
                          border: 'none',
                          borderRadius: 5,
                          fontSize: 12,
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                          fontWeight: 600,
                        }}
                      >
                        {deptsSaving[dKey] ? 'Saving…' : 'Save Dept'}
                      </button>
                    </div>

                    {/* Sub-departments */}
                    <div
                      style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}
                    >
                      {dept.subDepartments.map((sub) => {
                        const sKey = `s:${sub.id}`;
                        const sDraft = deptsDraft[sKey] || {
                          name: sub.name,
                          meaning: sub.meaning || '',
                        };
                        return (
                          <div
                            key={sub.id}
                            style={{
                              background: 'white',
                              border: '1px solid #e8edf5',
                              borderRadius: 7,
                              padding: '12px 14px',
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                gap: 10,
                                flexWrap: 'wrap',
                                alignItems: 'flex-end',
                              }}
                            >
                              <div style={{ flex: '0 0 220px' }}>
                                <label
                                  style={{
                                    fontSize: 11,
                                    color: '#555',
                                    fontWeight: 600,
                                    display: 'block',
                                    marginBottom: 4,
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.03em',
                                  }}
                                >
                                  Sub-Dept Name
                                </label>
                                <input
                                  value={sDraft.name}
                                  onChange={(e) =>
                                    setDeptsDraft((p) => ({
                                      ...p,
                                      [sKey]: { ...sDraft, name: e.target.value },
                                    }))
                                  }
                                  style={{
                                    width: '100%',
                                    padding: '7px 9px',
                                    border: '1px solid #ddd',
                                    borderRadius: 5,
                                    fontSize: 13,
                                    boxSizing: 'border-box',
                                  }}
                                />
                              </div>
                              <div style={{ flex: 1, minWidth: 240 }}>
                                <label
                                  style={{
                                    fontSize: 11,
                                    color: '#555',
                                    fontWeight: 600,
                                    display: 'block',
                                    marginBottom: 4,
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.03em',
                                  }}
                                >
                                  Definition / AI Context
                                </label>
                                <textarea
                                  rows={3}
                                  value={sDraft.meaning}
                                  onChange={(e) =>
                                    setDeptsDraft((p) => ({
                                      ...p,
                                      [sKey]: { ...sDraft, meaning: e.target.value },
                                    }))
                                  }
                                  style={{
                                    width: '100%',
                                    padding: '7px 9px',
                                    border: '1px solid #ddd',
                                    borderRadius: 5,
                                    fontSize: 13,
                                    resize: 'vertical',
                                    boxSizing: 'border-box',
                                    fontFamily: 'inherit',
                                    lineHeight: 1.5,
                                  }}
                                  placeholder="Describe what this trade covers, typical cost drivers, and how it differs from similar trades…"
                                />
                              </div>
                              <button
                                onClick={() => saveDeptField('s', sub.id)}
                                disabled={!!deptsSaving[sKey]}
                                style={{
                                  padding: '8px 16px',
                                  background: '#2E7D32',
                                  color: 'white',
                                  border: 'none',
                                  borderRadius: 5,
                                  fontSize: 12,
                                  cursor: 'pointer',
                                  whiteSpace: 'nowrap',
                                  fontWeight: 600,
                                }}
                              >
                                {deptsSaving[sKey] ? 'Saving…' : 'Save'}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderAllowances = () => {
    const items = settings.allowance || [];
    return (
      <div>
        <p style={{ color: '#888', fontSize: 13, marginBottom: 20 }}>
          Contractor-grade allowances — included in every Exhibit A automatically.
        </p>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: BLUE }}>
              {['Item', 'Amount', 'Unit'].map((h) => (
                <th
                  key={h}
                  style={{ padding: '10px 12px', color: 'white', textAlign: 'left', fontSize: 12 }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((s, i) => {
              const val = typeof s.value === 'object' ? s.value : {};
              return (
                <tr key={s.key} style={{ background: i % 2 === 0 ? 'white' : '#fafafa' }}>
                  <td style={{ padding: '10px 12px', fontSize: 13 }}>{s.label}</td>
                  <td style={{ padding: '10px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ color: '#888' }}>$</span>
                      <input
                        type="number"
                        step="0.01"
                        value={val.amount || 0}
                        onChange={(e) =>
                          update(s.key, { ...val, amount: parseFloat(e.target.value) })
                        }
                        style={{
                          width: 90,
                          padding: 6,
                          border: '1px solid #ddd',
                          borderRadius: 4,
                          fontSize: 13,
                        }}
                      />
                    </div>
                  </td>
                  <td style={{ padding: '10px 12px', fontSize: 12, color: '#888' }}>
                    {val.unit || 'each'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  const renderIntegrations = () => (
    <div>
      <p style={{ color: '#888', fontSize: 13, marginBottom: 20 }}>
        Switch between estimation platforms seamlessly. Your data is never affected.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {[
          {
            id: 'hearth',
            name: 'HEARTH',
            desc: 'Current platform. Jackson uses Hearth for estimates and invoicing.',
            cost: '$1,800/yr',
            configured: integration.hearth?.configured,
          },
          {
            id: 'wave',
            name: 'WAVE',
            desc: 'Free alternative. Switch when ready — same workflow, lower cost.',
            cost: '$192/yr (API only)',
            configured: integration.wave?.configured,
          },
        ].map((p) => (
          <div
            key={p.id}
            style={{
              border: `2px solid ${integration.platform === p.id ? BLUE : '#ddd'}`,
              borderRadius: 10,
              padding: 20,
              background: integration.platform === p.id ? '#E3ECFF' : 'white',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 8,
              }}
            >
              <span style={{ fontWeight: 'bold', fontSize: 16, color: BLUE }}>{p.name}</span>
              {integration.platform === p.id ? (
                <span
                  style={{
                    background: '#2E7D32',
                    color: 'white',
                    padding: '2px 10px',
                    borderRadius: 20,
                    fontSize: 11,
                  }}
                >
                  ● ACTIVE
                </span>
              ) : (
                <span
                  style={{
                    background: '#eee',
                    color: '#888',
                    padding: '2px 10px',
                    borderRadius: 20,
                    fontSize: 11,
                  }}
                >
                  STANDBY
                </span>
              )}
            </div>
            <p style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>{p.desc}</p>
            <p style={{ fontSize: 11, color: ORANGE, fontWeight: 'bold', marginBottom: 12 }}>
              {p.cost}
            </p>
            {integration.platform !== p.id && (
              <button
                onClick={() => switchPlatform(p.id)}
                style={{
                  width: '100%',
                  padding: 8,
                  background: BLUE,
                  color: 'white',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontSize: 12,
                }}
              >
                Switch to {p.name}
              </button>
            )}
          </div>
        ))}
      </div>
      <div
        style={{
          marginTop: 20,
          background: '#fff8f0',
          border: `1px solid ${ORANGE}`,
          borderRadius: 8,
          padding: 16,
          fontSize: 12,
          color: '#5D3A00',
        }}
      >
        ⚠️ Switching platforms only affects new estimates going forward. All existing jobs remain in
        the system unchanged.
      </div>

      {/* ── Measurement & Property Data ──────────────────── */}
      <h3 style={{ marginTop: 32, marginBottom: 4, color: BLUE, fontSize: 15 }}>
        Measurement &amp; Property Data
      </h3>
      <p style={{ color: '#888', fontSize: 13, marginBottom: 16 }}>
        The AI bot uses these services to pull building dimensions, roof area, and property data automatically.
        Free tiers run without any setup. Paid services are ordered per job and charged to the customer.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        {[
          {
            id: 'microsoft_footprints',
            name: 'Microsoft Building Footprints',
            desc: 'Satellite-detected building polygons for every address in the US. Returns footprint width, depth, area, and perimeter. No API key required.',
            cost: 'Free — always on',
            status: integration.microsoft_footprints?.configured ? 'active' : 'inactive',
            badge: 'FREE',
            badgeColor: '#2E7D32',
            setupUrl: null,
            setupNote: null,
          },
          {
            id: 'google_solar',
            name: 'Google Solar API',
            desc: 'Roof area, per-segment pitch, and building bounding box from Google\'s aerial imagery. 10,000 calls/month free. Add GOOGLE_MAPS_API_KEY to activate.',
            cost: 'Free up to 10k calls/mo',
            status: integration.google_solar?.configured ? 'active' : 'not_configured',
            badge: 'FREE',
            badgeColor: '#2E7D32',
            setupUrl: 'https://console.cloud.google.com',
            setupNote: 'Add secret: GOOGLE_MAPS_API_KEY',
          },
          {
            id: 'hover',
            name: 'Hover',
            desc: '3D property models with precise wall areas, window counts, siding, and roof measurements. Best for siding, painting, and complex shapes. 24-48 hr turnaround.',
            cost: 'Paid per job — charge to customer',
            status: integration.hover?.configured
              ? integration.hover?.hasToken
                ? 'active'
                : 'needs_token'
              : 'not_configured',
            badge: 'PAID / JOB',
            badgeColor: ORANGE,
            setupUrl: 'https://developers.hover.to',
            setupNote: 'Add secrets: HOVER_CLIENT_ID · HOVER_CLIENT_SECRET · HOVER_ACCESS_TOKEN',
          },
          {
            id: 'eagleview',
            name: 'EagleView',
            desc: 'Aerial satellite roof measurement reports with pitch, ridges, valleys, hip lengths, and wall areas. Best for roofing and gutter jobs. 24-48 hr turnaround.',
            cost: 'Paid per report — charge to customer',
            status: integration.eagleview?.configured ? 'active' : 'not_configured',
            badge: 'PAID / JOB',
            badgeColor: ORANGE,
            setupUrl: 'https://developer.eagleview.com',
            setupNote: 'Add secrets: EAGLEVIEW_CLIENT_ID · EAGLEVIEW_CLIENT_SECRET',
          },
        ].map((svc) => {
          const statusConfig = {
            active: { label: '● ACTIVE', bg: '#2E7D32', color: 'white' },
            not_configured: { label: '○ SETUP NEEDED', bg: '#eee', color: '#888' },
            needs_token: { label: '◑ NEEDS TOKEN', bg: '#E07B2A', color: 'white' },
            inactive: { label: '○ INACTIVE', bg: '#eee', color: '#888' },
          }[svc.status] || { label: svc.status, bg: '#eee', color: '#888' };

          return (
            <div
              key={svc.id}
              style={{
                border: `2px solid ${svc.status === 'active' ? BLUE : '#ddd'}`,
                borderRadius: 10,
                padding: 18,
                background: svc.status === 'active' ? '#E3ECFF' : 'white',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                <span style={{ fontWeight: 'bold', fontSize: 14, color: BLUE, lineHeight: 1.2 }}>{svc.name}</span>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                  <span style={{ background: svc.badgeColor, color: 'white', padding: '1px 8px', borderRadius: 20, fontSize: 10, fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                    {svc.badge}
                  </span>
                  <span style={{ background: statusConfig.bg, color: statusConfig.color, padding: '1px 8px', borderRadius: 20, fontSize: 10, whiteSpace: 'nowrap' }}>
                    {statusConfig.label}
                  </span>
                </div>
              </div>
              <p style={{ fontSize: 11, color: '#666', marginBottom: 6, lineHeight: 1.5 }}>{svc.desc}</p>
              <p style={{ fontSize: 11, color: ORANGE, fontWeight: 'bold', marginBottom: svc.setupNote ? 8 : 0 }}>{svc.cost}</p>
              {svc.setupNote && svc.status !== 'active' && (
                <div style={{ background: '#f5f5f5', borderRadius: 6, padding: '6px 10px', fontSize: 11, color: '#444', marginBottom: 6 }}>
                  {svc.setupNote}
                </div>
              )}
              {svc.setupUrl && svc.status !== 'active' && (
                <a href={svc.setupUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: BLUE, textDecoration: 'underline' }}>
                  → Get API credentials
                </a>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Other Connected Services ─────────────────────── */}
      <h3 style={{ marginTop: 32, marginBottom: 4, color: BLUE, fontSize: 15 }}>
        Other Connected Services
      </h3>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginTop: 12 }}>
        {[
          { name: 'Twilio / WhatsApp', key: 'whatsapp', desc: 'WhatsApp messaging for customer communication and AI bot', configured: integration.whatsapp?.configured },
          { name: 'Perplexity AI', key: 'perplexity', desc: 'Web search for live permit fees, material prices, code lookup', configured: integration.perplexity?.configured },
          { name: 'Google Calendar', key: 'gcal', desc: 'Calendar sync for jobs, tasks, and scheduling', configured: true },
        ].map((svc) => (
          <div key={svc.key} style={{ border: `1px solid ${svc.configured ? '#4CAF50' : '#ddd'}`, borderRadius: 8, padding: 14, background: svc.configured ? '#f0fff4' : 'white' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontWeight: 'bold', fontSize: 12, color: BLUE }}>{svc.name}</span>
              <span style={{ fontSize: 10, color: svc.configured ? '#2E7D32' : '#aaa' }}>{svc.configured ? '● ON' : '○ OFF'}</span>
            </div>
            <p style={{ fontSize: 11, color: '#666', margin: 0 }}>{svc.desc}</p>
          </div>
        ))}
      </div>

      {/* Hardware — Printer & Scanner */}
      <div style={{ marginTop: 28 }}>
        <div style={{ fontWeight: 700, color: BLUE, fontSize: 14, marginBottom: 4 }}>🖨️ Hardware</div>
        <p style={{ fontSize: 12, color: '#888', marginBottom: 14 }}>
          Configure the default printer and the scanner inbox folder on the Windows server.
        </p>

        {/* Printer name input */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
          <input
            value={printerName}
            onChange={(e) => setPrinterName(e.target.value)}
            placeholder="e.g. HP77ED59 (HP OfficeJet 8010 series)"
            style={{ flex: 1, minWidth: 260, padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 13 }}
          />
          <button
            onClick={savePrinterName}
            disabled={printerSaving}
            style={{ padding: '8px 18px', background: BLUE, color: 'white', border: 'none', borderRadius: 6, cursor: printerSaving ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 'bold', opacity: printerSaving ? 0.6 : 1 }}
          >
            {printerSaved ? '✅ Saved' : printerSaving ? 'Saving...' : 'Save'}
          </button>
          <button
            onClick={detectPrinters}
            disabled={printerDetecting}
            style={{ padding: '8px 14px', background: '#f4f6fb', border: '1px solid #ddd', borderRadius: 6, cursor: printerDetecting ? 'not-allowed' : 'pointer', fontSize: 13, color: '#555', opacity: printerDetecting ? 0.6 : 1 }}
          >
            {printerDetecting ? 'Detecting...' : '🔍 Detect Printers'}
          </button>
        </div>

        {/* Detected printer list */}
        {printerList.length > 0 && (
          <div style={{ background: '#f8f9fa', border: '1px solid #e0e7ef', borderRadius: 8, padding: '10px 14px', marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: '#555', fontWeight: 'bold', marginBottom: 8 }}>Printers found on this machine — click to select:</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {printerList.map((p) => (
                <button
                  key={p}
                  onClick={() => setPrinterName(p)}
                  style={{ textAlign: 'left', padding: '6px 10px', background: printerName === p ? '#E3ECFF' : 'white', border: `1px solid ${printerName === p ? BLUE : '#ddd'}`, borderRadius: 6, cursor: 'pointer', fontSize: 12, color: printerName === p ? BLUE : '#333', fontWeight: printerName === p ? 'bold' : 'normal' }}
                >
                  🖨️ {p}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Scan inbox folder */}
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid #e5e7eb' }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: '#374151', marginBottom: 4 }}>📂 Scanner Inbox Folder</div>
          <p style={{ fontSize: 12, color: '#888', marginBottom: 10 }}>
            Set up <strong>Scan to Network Folder</strong> on the HP printer and point it here.
            The app will read scanned files from this folder so you can attach them to jobs.
          </p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              value={scanInboxFolder}
              onChange={(e) => setScanInboxFolder(e.target.value)}
              placeholder={`e.g. C:\\Users\\theso\\Desktop\\scan_inbox`}
              style={{ flex: 1, minWidth: 260, padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 12, fontFamily: 'monospace' }}
            />
            <button
              onClick={saveScanFolder}
              disabled={scanFolderSaving}
              style={{ padding: '8px 18px', background: BLUE, color: 'white', border: 'none', borderRadius: 6, cursor: scanFolderSaving ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 'bold', opacity: scanFolderSaving ? 0.6 : 1 }}
            >
              {scanFolderSaved ? '✅ Saved' : scanFolderSaving ? 'Saving...' : 'Save'}
            </button>
          </div>
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 8, lineHeight: 1.5 }}>
            <strong>HP Setup:</strong> On the HP printer, go to <em>Scan → Scan to Network Folder</em>, create a shortcut pointing to this folder path (or a shared network path), and use that button to scan. The file will appear in the app within seconds.
          </div>
        </div>
      </div>

      {/* IP Allowlist — system_admin only */}
      {userRole === 'system_admin' && (
        <div style={{ marginTop: 28 }}>
          <div style={{ fontWeight: 700, color: BLUE, fontSize: 14, marginBottom: 4 }}>🔒 IP Access Control</div>
          <p style={{ fontSize: 12, color: '#888', marginBottom: 14 }}>
            Only these IP addresses can access the app. The customer portal (signing) is always public.
            Local network connections are always allowed automatically.
          </p>
          <div style={{ background: '#f8f9fa', border: '1px solid #e0e7ef', borderRadius: 8, padding: '12px 16px', marginBottom: 12 }}>
            {allowedIps.length === 0 && (
              <div style={{ fontSize: 12, color: '#aaa', marginBottom: 8 }}>No IPs configured — all traffic allowed</div>
            )}
            {allowedIps.map((ip) => (
              <div key={ip} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #eee' }}>
                <span style={{ fontSize: 13, fontFamily: 'monospace', color: '#1B3A6B', fontWeight: 600 }}>{ip}</span>
                <button
                  onClick={() => removeIp(ip)}
                  style={{ padding: '3px 10px', background: '#fee2e2', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: 5, cursor: 'pointer', fontSize: 12, fontWeight: 'bold' }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              value={newIp}
              onChange={(e) => setNewIp(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addIp()}
              placeholder="e.g. 73.45.100.22 (your home IP)"
              style={{ flex: 1, minWidth: 220, padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 13, fontFamily: 'monospace' }}
            />
            <button
              onClick={addIp}
              disabled={ipSaving || !newIp.trim()}
              style={{ padding: '8px 18px', background: BLUE, color: 'white', border: 'none', borderRadius: 6, cursor: ipSaving ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 'bold', opacity: ipSaving ? 0.6 : 1 }}
            >
              {ipSaving ? 'Adding...' : 'Add IP'}
            </button>
          </div>
          {ipMsg && (
            <div style={{ marginTop: 8, fontSize: 12, color: ipMsg.type === 'success' ? '#2E7D32' : '#dc2626', fontWeight: 600 }}>
              {ipMsg.type === 'success' ? '✅' : '❌'} {ipMsg.text}
            </div>
          )}
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 10, lineHeight: 1.5 }}>
            <strong>To find your home IP:</strong> Visit <a href="https://whatismyip.com" target="_blank" rel="noreferrer" style={{ color: BLUE }}>whatismyip.com</a> from home and paste the address above.
          </div>
        </div>
      )}
    </div>
  );

  const renderCalendar = () => {
    const calItems = settings.calendar || [];
    const calIdSetting = calItems.find((s) => s.key === 'gcal.calendarId');
    const calEnSetting = calItems.find((s) => s.key === 'gcal.enabled');
    const currentCalId = calIdSetting?.value || 'primary';
    const calEnabled = calEnSetting?.value !== 'false';

    return (
      <div>
        <p style={{ color: '#888', fontSize: 13, marginBottom: 20 }}>
          Your Google account is connected. Choose which calendar to save tasks and reminders to.
        </p>

        {/* Auto-add toggle */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '14px 16px',
            background: '#fafafa',
            borderRadius: 8,
            marginBottom: 20,
          }}
        >
          <div>
            <div style={{ fontSize: 13, fontWeight: '600', color: '#333' }}>
              Auto-add tasks to Google Calendar
            </div>
            <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
              When ON, every task with a due date is instantly added to your Google Calendar
            </div>
          </div>
          <button
            onClick={() => {
              update('gcal.enabled', calEnabled ? 'false' : 'true');
            }}
            style={{
              padding: '6px 18px',
              borderRadius: 20,
              border: 'none',
              cursor: 'pointer',
              fontWeight: 'bold',
              fontSize: 12,
              background: calEnabled ? '#2E7D32' : '#ccc',
              color: 'white',
            }}
          >
            {calEnabled ? 'ON' : 'OFF'}
          </button>
        </div>

        {/* Calendar picker */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: '600', color: '#333', marginBottom: 10 }}>
            Calendar to use
          </div>

          {calendars.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {calendars.map((cal) => (
                <label
                  key={cal.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '12px 14px',
                    background: currentCalId === cal.id ? '#E3ECFF' : 'white',
                    border: `2px solid ${currentCalId === cal.id ? BLUE : '#eee'}`,
                    borderRadius: 8,
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="radio"
                    name="calId"
                    value={cal.id}
                    checked={currentCalId === cal.id}
                    onChange={() => update('gcal.calendarId', cal.id)}
                    style={{ flexShrink: 0 }}
                  />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: '600', color: BLUE }}>
                      {cal.summary} {cal.primary ? '⭐ (Primary)' : ''}
                    </div>
                    <div style={{ fontSize: 11, color: '#888' }}>{cal.id}</div>
                  </div>
                </label>
              ))}
            </div>
          ) : (
            <div
              style={{
                padding: '14px 16px',
                background: '#f8f9ff',
                border: '1px solid #e0e7ff',
                borderRadius: 8,
                fontSize: 13,
                color: '#555',
              }}
            >
              {calLoading ? (
                '⏳ Loading your calendars...'
              ) : (
                <span>
                  Click <strong>Load My Calendars</strong> to see all calendars in your Google
                  account.
                </span>
              )}
            </div>
          )}

          <button
            onClick={loadCalendars}
            disabled={calLoading}
            style={{
              marginTop: 12,
              padding: '8px 18px',
              background: '#4285F4',
              color: 'white',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 'bold',
            }}
          >
            {calLoading ? 'Loading...' : '📅 Load My Calendars'}
          </button>
        </div>

        {/* Save button */}
        <button
          onClick={() => saveCal(currentCalId, calEnabled)}
          style={{
            padding: '10px 24px',
            background: calSaved ? '#2E7D32' : BLUE,
            color: 'white',
            border: 'none',
            borderRadius: 8,
            cursor: 'pointer',
            fontWeight: 'bold',
            fontSize: 13,
          }}
        >
          {calSaved ? '✅ Saved!' : 'Save Calendar Settings'}
        </button>

        <div
          style={{
            marginTop: 20,
            background: '#f8f9ff',
            border: '1px solid #e0e7ff',
            borderRadius: 8,
            padding: 14,
            fontSize: 12,
            color: '#444',
          }}
        >
          <strong>How it works:</strong> When you (or the bot) create a task with a due date, the
          system automatically adds it directly to the selected Google Calendar — no clicking
          required. You'll get email and popup reminders 60 and 30 minutes before.
        </div>
      </div>
    );
  };

  const renderBotBehavior = () => {
    const items = settings.behavior || [];
    return (
      <div>
        <p style={{ color: '#888', fontSize: 13, marginBottom: 20 }}>
          Control how the bot behaves when processing estimates.
        </p>
        {items.map((s) => (
          <div
            key={s.key}
            style={{
              marginBottom: 16,
              padding: 14,
              background: '#fafafa',
              borderRadius: 8,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div>
              <div style={{ fontSize: 13, fontWeight: '500', color: '#333' }}>{s.label}</div>
              <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{s.key}</div>
            </div>
            {s.value === 'true' || s.value === 'false' || s.value === true || s.value === false ? (
              <button
                onClick={() =>
                  update(s.key, s.value === 'true' || s.value === true ? 'false' : 'true')
                }
                style={{
                  padding: '6px 16px',
                  borderRadius: 20,
                  border: 'none',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  fontSize: 12,
                  background: s.value === 'true' || s.value === true ? '#2E7D32' : '#ccc',
                  color: 'white',
                }}
              >
                {s.value === 'true' || s.value === true ? 'ON' : 'OFF'}
              </button>
            ) : (
              <input
                value={s.value || ''}
                onChange={(e) => update(s.key, e.target.value)}
                style={{
                  width: 100,
                  padding: 6,
                  border: '1px solid #ddd',
                  borderRadius: 4,
                  fontSize: 13,
                  textAlign: 'center',
                }}
              />
            )}
          </div>
        ))}
      </div>
    );
  };

  const flashMsg = (msg, ms = 3000) => {
    setSecretsMsg(msg);
    setTimeout(() => setSecretsMsg(null), ms);
  };

  const loadSecrets = async () => {
    setSecretsLoading(true);
    try {
      const res = await fetch('/api/secrets', { headers: { 'x-auth-token': token } });
      const data = await res.json();
      if (res.ok) {
        setSecrets(data);
        setEditingKey(null);
        setAddingNew(false);
      }
    } catch (_e) {
      /* secrets save failed */
    }
    setSecretsLoading(false);
  };

  const startEdit = (s) => {
    setEditingKey(s.key);
    setEditDraft({ key: s.key, value: s.value });
    setAddingNew(false);
  };

  const cancelEdit = () => {
    setEditingKey(null);
    setEditDraft({ key: '', value: '' });
  };

  const saveEdit = async (originalKey) => {
    const body = { value: editDraft.value };
    if (editDraft.key !== originalKey) body.newKey = editDraft.key;
    const res = await fetch(`/api/secrets/${encodeURIComponent(originalKey)}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(body),
    });
    if (res.ok) {
      await loadSecrets();
      flashMsg('✅ Saved');
    } else {
      const d = await res.json();
      flashMsg(`❌ ${d.error || 'Save failed'}`);
    }
    cancelEdit();
  };

  const deleteSecret = async (key) => {
    if (!window.confirm(`Delete secret "${key}"?`)) return;
    const res = await fetch(`/api/secrets/${encodeURIComponent(key)}`, {
      method: 'DELETE',
      headers,
    });
    if (res.ok) {
      setSecrets((prev) => prev.filter((s) => s.key !== key));
      flashMsg('🗑 Deleted');
    }
  };

  const saveNew = async () => {
    if (!newSecret.key.trim()) return;
    const res = await fetch('/api/secrets', {
      method: 'POST',
      headers,
      body: JSON.stringify({ key: newSecret.key.trim(), value: newSecret.value }),
    });
    if (res.ok) {
      setAddingNew(false);
      setNewSecret({ key: '', value: '' });
      await loadSecrets();
      flashMsg('✅ Secret added');
    } else {
      const d = await res.json();
      flashMsg(`❌ ${d.error || 'Add failed'}`);
    }
  };

  const renderSecrets = () => {
    if (secretsLoading)
      return <div style={{ color: '#888', fontSize: 13, padding: 20 }}>Loading...</div>;

    if (secrets.length === 0) {
      return (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <p style={{ color: '#888', fontSize: 13, marginBottom: 16 }}>
            Load your current .env secrets to view, edit, add, or remove them.
          </p>
          <button
            onClick={loadSecrets}
            style={{
              padding: '10px 24px',
              background: BLUE,
              color: 'white',
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer',
              fontWeight: 'bold',
              fontSize: 13,
            }}
          >
            🔑 Load Secrets
          </button>
        </div>
      );
    }

    const ROW = {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '8px 0',
      borderBottom: '1px solid #f0f0f0',
    };
    const BTN = (extra = {}) => ({
      padding: '5px 10px',
      border: '1px solid #ddd',
      borderRadius: 6,
      cursor: 'pointer',
      fontSize: 12,
      background: 'white',
      ...extra,
    });

    return (
      <div>
        <div
          style={{
            background: '#fff8f0',
            border: `1px solid ${ORANGE}`,
            borderRadius: 8,
            padding: 12,
            fontSize: 12,
            color: '#5D3A00',
            marginBottom: 16,
          }}
        >
          ⚠️ Changes write directly to your <strong>.env</strong> file. API key changes (Claude,
          Twilio) need a server restart to take full effect.
        </div>

        {secretsMsg && (
          <div
            style={{
              marginBottom: 12,
              padding: '8px 14px',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              background: secretsMsg.startsWith('❌') ? '#fff0f0' : '#f0fff4',
              color: secretsMsg.startsWith('❌') ? '#c00' : '#2E7D32',
              border: `1px solid ${secretsMsg.startsWith('❌') ? '#fcc' : '#b2dfdb'}`,
            }}
          >
            {secretsMsg}
          </div>
        )}

        {/* Column headers */}
        <div
          style={{
            display: 'flex',
            gap: 8,
            padding: '4px 0 8px',
            fontSize: 11,
            fontWeight: 700,
            color: '#999',
            textTransform: 'uppercase',
            letterSpacing: 0.8,
          }}
        >
          <div style={{ width: 220, flexShrink: 0 }}>Key Name</div>
          <div style={{ flex: 1 }}>Value</div>
          <div style={{ width: 100, flexShrink: 0 }}></div>
        </div>

        {secrets.map((s) => {
          const isEditing = editingKey === s.key;
          const isVisible = showValues[s.key] || s.noMask;

          if (isEditing) {
            return (
              <div
                key={s.key}
                style={{
                  ...ROW,
                  background: '#fffbf5',
                  borderRadius: 6,
                  padding: '8px',
                  margin: '4px 0',
                  border: `1px solid ${ORANGE}`,
                }}
              >
                <input
                  value={editDraft.key}
                  onChange={(e) =>
                    setEditDraft((p) => ({
                      ...p,
                      key: e.target.value.toUpperCase().replace(/\s/g, '_'),
                    }))
                  }
                  style={{
                    width: 210,
                    flexShrink: 0,
                    padding: '6px 8px',
                    border: '1px solid #ccc',
                    borderRadius: 6,
                    fontSize: 12,
                    fontFamily: 'monospace',
                    fontWeight: 600,
                  }}
                  placeholder="KEY_NAME"
                />
                <input
                  type={isVisible ? 'text' : 'password'}
                  value={editDraft.value}
                  onChange={(e) => setEditDraft((p) => ({ ...p, value: e.target.value }))}
                  style={{
                    flex: 1,
                    padding: '6px 8px',
                    border: '1px solid #ccc',
                    borderRadius: 6,
                    fontSize: 12,
                    fontFamily: 'monospace',
                  }}
                  placeholder="value"
                  autoFocus
                />
                <button
                  onClick={() => setShowValues((p) => ({ ...p, [s.key]: !p[s.key] }))}
                  style={BTN()}
                  title={isVisible ? 'Hide' : 'Reveal'}
                >
                  {isVisible ? '🙈' : '👁'}
                </button>
                <button
                  onClick={() => saveEdit(s.key)}
                  style={BTN({ background: BLUE, color: 'white', border: 'none' })}
                >
                  Save
                </button>
                <button onClick={cancelEdit} style={BTN()}>
                  Cancel
                </button>
              </div>
            );
          }

          return (
            <div
              key={s.key}
              style={{
                ...ROW,
                opacity: s.disabled ? 0.6 : 1,
                background: s.disabled ? '#fff8f0' : 'transparent',
                borderRadius: s.disabled ? 6 : 0,
                padding: s.disabled ? '6px 8px' : '8px 0',
              }}
            >
              <div
                style={{
                  width: 220,
                  flexShrink: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={s.key}
              >
                <span
                  style={{
                    fontFamily: 'monospace',
                    fontSize: 12,
                    fontWeight: 600,
                    color: s.disabled ? '#b45' : '#333',
                  }}
                >
                  {s.key}
                </span>
                {s.disabled && (
                  <span
                    style={{
                      marginLeft: 6,
                      fontSize: 10,
                      background: '#f5c242',
                      color: '#5D3A00',
                      borderRadius: 4,
                      padding: '1px 5px',
                      fontWeight: 700,
                    }}
                  >
                    COMMENTED OUT
                  </span>
                )}
              </div>
              <div
                style={{
                  flex: 1,
                  fontFamily: 'monospace',
                  fontSize: 12,
                  color: '#666',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {isVisible ? (
                  s.value || <span style={{ color: '#ccc', fontStyle: 'italic' }}>empty</span>
                ) : s.value ? (
                  '••••••••••••'
                ) : (
                  <span style={{ color: '#ccc', fontStyle: 'italic' }}>empty</span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                {!s.noMask && (
                  <button
                    onClick={() => setShowValues((p) => ({ ...p, [s.key]: !p[s.key] }))}
                    style={BTN()}
                    title={isVisible ? 'Hide' : 'Reveal'}
                  >
                    {isVisible ? '🙈' : '👁'}
                  </button>
                )}
                {s.disabled ? (
                  <button
                    onClick={() => startEdit(s)}
                    style={BTN({
                      background: '#E07B2A',
                      color: 'white',
                      border: 'none',
                      fontWeight: 700,
                    })}
                    title="Enable this key"
                  >
                    Enable
                  </button>
                ) : (
                  <button onClick={() => startEdit(s)} style={BTN()} title="Edit">
                    ✏️
                  </button>
                )}
                <button
                  onClick={() => deleteSecret(s.key)}
                  style={BTN({ color: '#c00' })}
                  title="Delete"
                >
                  🗑
                </button>
              </div>
            </div>
          );
        })}

        {/* Add new secret */}
        {addingNew ? (
          <div
            style={{
              marginTop: 16,
              padding: 12,
              border: `1px solid ${BLUE}`,
              borderRadius: 8,
              background: '#f8faff',
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 700, color: BLUE, marginBottom: 10 }}>
              Add New Secret
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                value={newSecret.key}
                onChange={(e) =>
                  setNewSecret((p) => ({
                    ...p,
                    key: e.target.value.toUpperCase().replace(/\s/g, '_'),
                  }))
                }
                placeholder="KEY_NAME"
                style={{
                  width: 210,
                  flexShrink: 0,
                  padding: '7px 10px',
                  border: '1px solid #ccc',
                  borderRadius: 6,
                  fontSize: 12,
                  fontFamily: 'monospace',
                  fontWeight: 600,
                }}
                autoFocus
              />
              <input
                value={newSecret.value}
                onChange={(e) => setNewSecret((p) => ({ ...p, value: e.target.value }))}
                placeholder="value"
                type="text"
                style={{
                  flex: 1,
                  padding: '7px 10px',
                  border: '1px solid #ccc',
                  borderRadius: 6,
                  fontSize: 12,
                  fontFamily: 'monospace',
                }}
              />
              <button
                onClick={saveNew}
                disabled={!newSecret.key.trim()}
                style={BTN({
                  background: BLUE,
                  color: 'white',
                  border: 'none',
                  opacity: newSecret.key.trim() ? 1 : 0.5,
                })}
              >
                Add
              </button>
              <button
                onClick={() => {
                  setAddingNew(false);
                  setNewSecret({ key: '', value: '' });
                }}
                style={BTN()}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => {
              setAddingNew(true);
              setEditingKey(null);
            }}
            style={{
              marginTop: 16,
              padding: '8px 18px',
              background: 'white',
              border: `1px dashed ${BLUE}`,
              borderRadius: 8,
              color: BLUE,
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            + Add Secret
          </button>
        )}

        <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
          <button
            onClick={loadSecrets}
            style={{
              padding: '8px 16px',
              background: 'white',
              color: '#888',
              border: '1px solid #ddd',
              borderRadius: 8,
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            ↺ Reload
          </button>
        </div>
      </div>
    );
  };

  const loadLogs = async (lines) => {
    setLogsLoading(true);
    setLogsError(null);
    try {
      const n = lines || logsLines;
      setLogsLines(n);
      const res = await fetch(`/api/settings/logs?lines=${n}`, { headers: { 'x-auth-token': token } });
      if (!res.ok) {
        const d = await res.json();
        setLogsError(d.error || `Error ${res.status}`);
      } else {
        setLogsData(await res.json());
      }
    } catch (e) {
      setLogsError('Could not reach server — ' + e.message);
    }
    setLogsLoading(false);
  };

  const loadStatus = async () => {
    setStatusLoading(true);
    setStatusError(null);
    try {
      const res = await fetch('/api/status', { headers: { 'x-auth-token': token } });
      const data = await res.json();
      if (res.ok) {
        setStatusData(data);
      } else if (res.status === 401) {
        setStatusError('Session expired — please log out and log back in.');
      } else if (res.status === 403) {
        setStatusError('Access denied — system admin only.');
      } else {
        setStatusError(data.error || `Error ${res.status}`);
      }
    } catch (e) {
      setStatusError('Could not reach server — ' + e.message);
    }
    setStatusLoading(false);
  };

  const loadEmailLog = async () => {
    setEmailLogLoading(true);
    const res = await fetch('/api/email-log?limit=200', { headers: { 'x-auth-token': token } });
    const data = await res.json();
    setEmailLog(data);
    setEmailLogLoading(false);
  };

  const renderEmailLog = () => {
    if (!emailLog) {
      return (
        <div style={{ textAlign: 'center', padding: 32 }}>
          <button
            onClick={loadEmailLog}
            disabled={emailLogLoading}
            style={{
              background: BLUE,
              color: 'white',
              border: 'none',
              padding: '10px 24px',
              borderRadius: 8,
              cursor: 'pointer',
              fontWeight: 'bold',
              fontSize: 14,
            }}
          >
            {emailLogLoading ? 'Loading...' : '📬 Load Email Log'}
          </button>
        </div>
      );
    }
    const { stats, byType, byDay, byMonth, emails } = emailLog;
    const openRate = stats.total > 0 ? Math.round((stats.opened / stats.total) * 100) : 0;

    return (
      <div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 20,
          }}
        >
          <h3 style={{ margin: 0, color: BLUE }}>Email Activity</h3>
          <button
            onClick={loadEmailLog}
            disabled={emailLogLoading}
            style={{
              background: '#eee',
              border: 'none',
              padding: '6px 14px',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            {emailLogLoading ? 'Refreshing...' : '🔄 Refresh'}
          </button>
        </div>

        {/* Summary cards */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(5, 1fr)',
            gap: 12,
            marginBottom: 24,
          }}
        >
          {[
            { label: 'Today', value: stats.today },
            { label: 'This Month', value: stats.thisMonth },
            { label: 'This Year', value: stats.thisYear },
            { label: 'All Time', value: stats.total },
            { label: 'Open Rate', value: `${openRate}%` },
          ].map((c) => (
            <div
              key={c.label}
              style={{
                background: '#F3F6FC',
                borderRadius: 8,
                padding: '14px 16px',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: 24, fontWeight: 'bold', color: BLUE }}>{c.value}</div>
              <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>{c.label}</div>
            </div>
          ))}
        </div>

        {/* By type */}
        {byType.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontWeight: 'bold', color: '#444', marginBottom: 10 }}>By Type</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {byType.map((t) => (
                <div
                  key={t.email_type}
                  style={{
                    background: '#E8F0FE',
                    borderRadius: 20,
                    padding: '4px 12px',
                    fontSize: 12,
                    color: BLUE,
                  }}
                >
                  {t.email_type} <strong>{t.count}</strong>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Last 30 days chart */}
        {byDay.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontWeight: 'bold', color: '#444', marginBottom: 10 }}>Last 30 Days</div>
            <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 60 }}>
              {[...byDay].reverse().map((d) => {
                const max = Math.max(...byDay.map((x) => x.count), 1);
                const h = Math.max(4, Math.round((d.count / max) * 56));
                return (
                  <div
                    key={d.day}
                    title={`${d.day}: ${d.count}`}
                    style={{
                      flex: 1,
                      background: BLUE,
                      borderRadius: '2px 2px 0 0',
                      height: h,
                      minWidth: 4,
                    }}
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* Monthly breakdown */}
        {byMonth.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontWeight: 'bold', color: '#444', marginBottom: 10 }}>
              Monthly Totals
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#F3F6FC' }}>
                  <th style={{ padding: '8px 12px', textAlign: 'left', color: '#555' }}>Month</th>
                  <th style={{ padding: '8px 12px', textAlign: 'right', color: '#555' }}>
                    Emails Sent
                  </th>
                </tr>
              </thead>
              <tbody>
                {byMonth.map((m) => (
                  <tr key={m.month} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ padding: '8px 12px' }}>{m.month}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 'bold' }}>
                      {m.count}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Recent emails */}
        <div>
          <div style={{ fontWeight: 'bold', color: '#444', marginBottom: 10 }}>
            Recent Emails ({emails.length})
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#F3F6FC' }}>
                  <th style={{ padding: '8px 10px', textAlign: 'left', color: '#555' }}>Sent</th>
                  <th style={{ padding: '8px 10px', textAlign: 'left', color: '#555' }}>To</th>
                  <th style={{ padding: '8px 10px', textAlign: 'left', color: '#555' }}>Subject</th>
                  <th style={{ padding: '8px 10px', textAlign: 'left', color: '#555' }}>Type</th>
                  <th style={{ padding: '8px 10px', textAlign: 'center', color: '#555' }}>
                    Opened
                  </th>
                  <th style={{ padding: '8px 10px', textAlign: 'center', color: '#555' }}>
                    Preview
                  </th>
                </tr>
              </thead>
              <tbody>
                {emails.map((e) => (
                  <tr key={e.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ padding: '7px 10px', whiteSpace: 'nowrap', color: '#666' }}>
                      {new Date(e.sent_at).toLocaleString()}
                    </td>
                    <td style={{ padding: '7px 10px', color: '#333' }}>{e.to_address}</td>
                    <td style={{ padding: '7px 10px', color: '#333' }}>{e.subject}</td>
                    <td style={{ padding: '7px 10px' }}>
                      <span
                        style={{
                          background: '#E8F0FE',
                          color: BLUE,
                          borderRadius: 10,
                          padding: '2px 8px',
                          fontSize: 11,
                        }}
                      >
                        {e.email_type}
                      </span>
                    </td>
                    <td style={{ padding: '7px 10px', textAlign: 'center' }}>
                      {e.opened_at ? (
                        <span
                          title={`Opened ${e.opened_count}x — first: ${new Date(e.opened_at).toLocaleString()}`}
                          style={{ color: '#2E7D32', fontWeight: 'bold' }}
                        >
                          ✅ {e.opened_count}×
                        </span>
                      ) : (
                        <span style={{ color: '#aaa' }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: '7px 10px', textAlign: 'center' }}>
                      {e.has_preview ? (
                        <button
                          onClick={() => setEmailPreview({ id: e.id, subject: e.subject })}
                          style={{
                            background: BLUE,
                            color: 'white',
                            border: 'none',
                            borderRadius: 6,
                            padding: '3px 10px',
                            fontSize: 11,
                            cursor: 'pointer',
                          }}
                        >
                          👁 View
                        </button>
                      ) : (
                        <span style={{ color: '#ccc', fontSize: 11 }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
                {emails.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ padding: 20, textAlign: 'center', color: '#aaa' }}>
                      No emails logged yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  const renderLogs = () => {
    const lines = logsPanel === 'error' ? (logsData?.error || []) : (logsData?.out || []);
    const isError = (line) => /error|exception|uncaught|unhandled|fatal|crash/i.test(line);
    const isWarn = (line) => /warn|deprecat/i.test(line);

    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            {['error', 'out'].map((p) => (
              <button
                key={p}
                onClick={() => setLogsPanel(p)}
                style={{
                  padding: '6px 18px',
                  borderRadius: 6,
                  border: logsPanel === p ? 'none' : '1px solid #ddd',
                  background: logsPanel === p ? (p === 'error' ? '#C62828' : BLUE) : '#f5f5f5',
                  color: logsPanel === p ? 'white' : '#555',
                  fontWeight: logsPanel === p ? 'bold' : 'normal',
                  cursor: 'pointer',
                  fontSize: 13,
                }}
              >
                {p === 'error' ? '🔴 Error Log' : '📋 Output Log'}
                {logsData && (
                  <span style={{ marginLeft: 6, opacity: 0.8, fontSize: 11 }}>
                    ({p === 'error' ? logsData.error.length : logsData.out.length})
                  </span>
                )}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select
              value={logsLines}
              onChange={(e) => loadLogs(parseInt(e.target.value))}
              style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #ddd', fontSize: 13 }}
            >
              {[100, 200, 500, 1000].map((n) => (
                <option key={n} value={n}>{n} lines</option>
              ))}
            </select>
            <button
              onClick={() => loadLogs(logsLines)}
              disabled={logsLoading}
              style={{
                padding: '6px 16px',
                background: BLUE,
                color: 'white',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 'bold',
              }}
            >
              {logsLoading ? '⏳' : '↻ Refresh'}
            </button>
          </div>
        </div>

        {logsError && (
          <div style={{ padding: '10px 16px', background: '#fff3f3', border: '1px solid #ffcccc', borderRadius: 8, color: '#c00', fontSize: 13, marginBottom: 12 }}>
            {logsError}
          </div>
        )}

        {logsData && (
          <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>
            {logsData.paths[logsPanel]} — fetched {new Date(logsData.timestamp).toLocaleTimeString()}
          </div>
        )}

        <div style={{
          background: '#0d1117',
          borderRadius: 8,
          padding: '12px 14px',
          fontFamily: 'monospace',
          fontSize: 12,
          lineHeight: 1.6,
          maxHeight: 520,
          overflowY: 'auto',
          color: '#c9d1d9',
        }}>
          {!logsData && !logsLoading && (
            <span style={{ color: '#666' }}>No logs loaded yet.</span>
          )}
          {logsLoading && <span style={{ color: '#888' }}>Loading logs…</span>}
          {logsData && lines.length === 0 && (
            <span style={{ color: '#666' }}>No entries in this log.</span>
          )}
          {lines.map((line, i) => (
            <div
              key={i}
              style={{
                color: isError(line) ? '#ff7b72' : isWarn(line) ? '#e3b341' : '#c9d1d9',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                borderBottom: '1px solid #21262d',
                paddingBottom: 2,
                marginBottom: 2,
              }}
            >
              {line}
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderStatus = () => {
    const GREEN_C = '#2E7D32';
    const RED_C = '#C62828';
    if (!statusData) {
      return (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <p style={{ color: '#888', fontSize: 13, marginBottom: 16 }}>
            Run a live check on all connected services.
          </p>
          <button
            onClick={loadStatus}
            disabled={statusLoading}
            style={{
              padding: '10px 28px',
              background: BLUE,
              color: 'white',
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer',
              fontWeight: 'bold',
              fontSize: 13,
            }}
          >
            {statusLoading ? '⏳ Checking...' : '🔍 Run Status Check'}
          </button>
          {statusError && (
            <div
              style={{
                marginTop: 16,
                padding: '10px 16px',
                background: '#fff3f3',
                border: '1px solid #ffcccc',
                borderRadius: 8,
                color: '#c00',
                fontSize: 13,
              }}
            >
              {statusError}
            </div>
          )}
        </div>
      );
    }

    const services = Object.values(statusData.services);
    const allOk = services.every((s) => s.ok);
    const okCount = services.filter((s) => s.ok).length;

    return (
      <div>
        {/* Summary bar */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '12px 16px',
            borderRadius: 8,
            marginBottom: 20,
            background: allOk ? '#f0fdf4' : '#fff8f0',
            border: `1px solid ${allOk ? '#bbf7d0' : ORANGE}`,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 14, fontWeight: 'bold', color: allOk ? GREEN_C : ORANGE }}>
              {allOk
                ? '✅ All systems operational'
                : `⚠️ ${okCount} of ${services.length} services OK`}
            </span>
            {statusData.version && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  background: BLUE,
                  color: 'white',
                  borderRadius: 12,
                  padding: '2px 10px',
                  letterSpacing: 0.5,
                }}
              >
                v{statusData.version}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: '#888' }}>
              Checked: {new Date(statusData.checkedAt).toLocaleTimeString()}
            </span>
            <button
              onClick={loadStatus}
              disabled={statusLoading}
              style={{
                padding: '5px 14px',
                background: BLUE,
                color: 'white',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 11,
                fontWeight: 'bold',
              }}
            >
              {statusLoading ? '...' : '↺ Recheck'}
            </button>
          </div>
        </div>

        {/* Service rows */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
          {services.map((svc, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 14,
                padding: '14px 16px',
                borderRadius: 8,
                background: svc.ok ? '#f0fdf4' : '#fef2f2',
                border: `1px solid ${svc.ok ? '#bbf7d0' : '#fecaca'}`,
              }}
            >
              <span style={{ fontSize: 20, lineHeight: 1 }}>{svc.ok ? '🟢' : '🔴'}</span>
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 'bold',
                    color: svc.ok ? GREEN_C : RED_C,
                    marginBottom: 3,
                  }}
                >
                  {svc.label}
                </div>
                <div style={{ fontSize: 12, color: svc.ok ? '#555' : RED_C }}>{svc.detail}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Token Usage Summary */}
        {statusData.tokenUsage && Object.keys(statusData.tokenUsage).length > 0 && (
          <div style={{ borderTop: '1px solid #eee', paddingTop: 20, marginBottom: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 'bold', color: BLUE, marginBottom: 12 }}>
              AI Token Usage
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: 12,
              }}
            >
              {Object.entries(statusData.tokenUsage).map(([svc, data]) => {
                const label =
                  svc === 'claude'
                    ? 'Claude (Anthropic)'
                    : svc === 'perplexity'
                      ? 'Perplexity Sonar'
                      : svc;
                const todayTotal = (data.today?.in || 0) + (data.today?.out || 0);
                const monthTotal = (data.month?.in || 0) + (data.month?.out || 0);
                const allTimeTotal = (data.allTime || []).reduce(
                  (s, r) => s + (r.in || 0) + (r.out || 0),
                  0,
                );
                const fmt = (n) =>
                  n >= 1000000
                    ? (n / 1000000).toFixed(2) + 'M'
                    : n >= 1000
                      ? (n / 1000).toFixed(1) + 'K'
                      : String(n);
                return (
                  <div
                    key={svc}
                    style={{
                      padding: '14px 16px',
                      borderRadius: 8,
                      background: '#f8faff',
                      border: '1px solid #dce8ff',
                    }}
                  >
                    <div
                      style={{ fontSize: 13, fontWeight: 'bold', color: BLUE, marginBottom: 10 }}
                    >
                      {label}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div
                        style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}
                      >
                        <span style={{ color: '#555' }}>Today</span>
                        <span style={{ fontWeight: 600, color: '#222' }}>
                          {fmt(todayTotal)} tokens
                        </span>
                      </div>
                      <div
                        style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}
                      >
                        <span style={{ color: '#555' }}>This Month</span>
                        <span style={{ fontWeight: 600, color: '#222' }}>
                          {fmt(monthTotal)} tokens
                        </span>
                      </div>
                      <div
                        style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}
                      >
                        <span style={{ color: '#555' }}>All Time</span>
                        <span style={{ fontWeight: 600, color: '#222' }}>
                          {fmt(allTimeTotal)} tokens
                        </span>
                      </div>
                      {(data.allTime || []).length > 0 && (
                        <div
                          style={{
                            marginTop: 6,
                            borderTop: '1px solid #e0e8ff',
                            paddingTop: 6,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 3,
                          }}
                        >
                          {data.allTime.map((r, i) => (
                            <div
                              key={i}
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                fontSize: 11,
                                color: '#666',
                              }}
                            >
                              <span>{r.model || 'unknown'}</span>
                              <span>
                                {fmt(r.in)} in · {fmt(r.out)} out · {r.calls} call
                                {r.calls !== 1 ? 's' : ''}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Alerts summary (last 24h) */}
        {statusData.alertsSummary && (
          <div style={{ borderTop: '1px solid #eee', paddingTop: 20, marginBottom: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 'bold', color: BLUE, marginBottom: 12 }}>
              System Alerts Sent — Last 24 Hours
              <span
                style={{
                  marginLeft: 10,
                  padding: '2px 10px',
                  borderRadius: 12,
                  fontSize: 11,
                  fontWeight: 'bold',
                  background: statusData.alertsSummary.last24hCount > 0 ? '#fef2f2' : '#f0fdf4',
                  color: statusData.alertsSummary.last24hCount > 0 ? RED_C : GREEN_C,
                  border: `1px solid ${statusData.alertsSummary.last24hCount > 0 ? '#fecaca' : '#bbf7d0'}`,
                }}
              >
                {statusData.alertsSummary.last24hCount} alert
                {statusData.alertsSummary.last24hCount !== 1 ? 's' : ''}
              </span>
            </div>
            {statusData.alertsSummary.last24hCount === 0 ? (
              <div
                style={{
                  padding: '12px 16px',
                  background: '#f0fdf4',
                  border: '1px solid #bbf7d0',
                  borderRadius: 8,
                  fontSize: 13,
                  color: GREEN_C,
                }}
              >
                ✅ No system alerts fired in the last 24 hours
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {statusData.alertsSummary.last24h.map((alert, i) => (
                  <div
                    key={i}
                    style={{
                      padding: '12px 14px',
                      borderRadius: 8,
                      background: alert.severity === 'critical' ? '#fef2f2' : '#fff8f0',
                      border: `1px solid ${alert.severity === 'critical' ? '#fecaca' : '#f9ddb3'}`,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: 4,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 'bold',
                          color: alert.severity === 'critical' ? RED_C : ORANGE,
                        }}
                      >
                        {alert.severity === 'critical' ? '🔴' : '🟡'} {alert.source.toUpperCase()} —{' '}
                        {alert.severity.toUpperCase()}
                      </span>
                      <span style={{ fontSize: 11, color: '#888' }}>
                        {new Date(alert.ts).toLocaleString()}
                      </span>
                    </div>
                    <div
                      style={{ fontSize: 12, color: '#1B3A6B', fontWeight: 500, marginBottom: 4 }}
                    >
                      {alert.suggestedCause}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: '#666',
                        fontFamily: 'monospace',
                        wordBreak: 'break-word',
                      }}
                    >
                      {alert.message}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Recent error log */}
        <div style={{ borderTop: '1px solid #eee', paddingTop: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 'bold', color: BLUE, marginBottom: 12 }}>
            Recent Server Errors
            <span style={{ fontSize: 11, fontWeight: 'normal', color: '#888', marginLeft: 8 }}>
              (last {statusData.recentErrors?.length || 0} captured since last restart)
            </span>
          </div>
          {!statusData.recentErrors?.length ? (
            <div
              style={{
                padding: '12px 16px',
                background: '#f0fdf4',
                border: '1px solid #bbf7d0',
                borderRadius: 8,
                fontSize: 13,
                color: GREEN_C,
              }}
            >
              ✅ No errors recorded since last restart
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {statusData.recentErrors.map((err, i) => (
                <div
                  key={i}
                  style={{
                    padding: '10px 14px',
                    background: '#fef2f2',
                    border: '1px solid #fecaca',
                    borderRadius: 8,
                    fontFamily: 'monospace',
                  }}
                >
                  <div
                    style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}
                  >
                    <span style={{ fontSize: 11, fontWeight: 'bold', color: RED_C }}>
                      🔴 {err.source}
                    </span>
                    <span style={{ fontSize: 11, color: '#888' }}>
                      {new Date(err.ts).toLocaleTimeString()}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: '#333', wordBreak: 'break-word' }}>
                    {err.message}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Backup ── */}
        <div
          style={{
            marginTop: 28,
            background: '#F3F6FC',
            borderRadius: 10,
            padding: '18px 20px',
            border: '1px solid #dce3f3',
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 'bold', color: BLUE, marginBottom: 14 }}>
            💾 Database Backups
          </div>
          {backupInfo ? (
            <div>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 12,
                  marginBottom: 14,
                  alignItems: 'flex-end',
                }}
              >
                <div>
                  <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Back up every</div>
                  <select
                    value={backupInfo.intervalHours}
                    onChange={(e) =>
                      setBackupInfo((s) => ({ ...s, intervalHours: parseInt(e.target.value) }))
                    }
                    style={{
                      padding: '7px 12px',
                      border: '1px solid #ccc',
                      borderRadius: 6,
                      fontSize: 13,
                    }}
                  >
                    {[1, 2, 4, 6, 8, 12, 24, 48, 72, 168].map((h) => (
                      <option key={h} value={h}>
                        {h === 1 ? '1 hour' : h === 168 ? '1 week' : `${h} hours`}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={async () => {
                      await fetch('/api/status/backup/schedule', {
                        method: 'POST',
                        headers,
                        body: JSON.stringify({
                          intervalHours: backupInfo.intervalHours,
                          customPath: backupInfo.customPath,
                        }),
                      });
                      setBackupMsg('✅ Schedule saved');
                      setTimeout(() => setBackupMsg(null), 2500);
                    }}
                    style={{
                      padding: '7px 16px',
                      background: BLUE,
                      color: 'white',
                      border: 'none',
                      borderRadius: 6,
                      cursor: 'pointer',
                      fontWeight: 'bold',
                      fontSize: 13,
                    }}
                  >
                    Save
                  </button>
                  <button
                    disabled={backupRunning}
                    onClick={async () => {
                      setBackupRunning(true);
                      setBackupMsg('⏳ Running backup…');
                      try {
                        const r = await fetch('/api/status/backup', { method: 'POST', headers });
                        const d = await r.json();
                        if (d.ok) {
                          setBackupMsg(
                            `✅ Saved: ${d.file} (${d.dbSize}) — ${d.totalBackups} backups on disk`,
                          );
                          const r2 = await fetch('/api/status/backup', {
                            headers: { 'x-auth-token': token },
                          });
                          const d2 = await r2.json();
                          if (!d2.error) setBackupInfo(d2);
                        } else {
                          setBackupMsg(`❌ ${d.error}`);
                        }
                      } finally {
                        setBackupRunning(false);
                      }
                    }}
                    style={{
                      padding: '7px 16px',
                      background: 'white',
                      color: BLUE,
                      border: `1.5px solid ${BLUE}`,
                      borderRadius: 6,
                      cursor: 'pointer',
                      fontWeight: 'bold',
                      fontSize: 13,
                    }}
                  >
                    {backupRunning ? '⏳ Backing up…' : '▶ Back Up Now'}
                  </button>
                </div>
              </div>
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>
                  Backup folder path{' '}
                  <span style={{ color: '#bbb' }}>
                    (leave blank to use default: data/backups inside app folder)
                  </span>
                </div>
                <input
                  type="text"
                  value={backupInfo.customPath || ''}
                  onChange={(e) => setBackupInfo((s) => ({ ...s, customPath: e.target.value }))}
                  placeholder={`e.g. C:\\Users\\theso\\Desktop\\PB_Backups`}
                  style={{
                    width: '100%',
                    padding: '7px 12px',
                    border: '1px solid #ccc',
                    borderRadius: 6,
                    fontSize: 13,
                    boxSizing: 'border-box',
                    fontFamily: 'monospace',
                  }}
                />
              </div>
              {backupMsg && (
                <div style={{ fontSize: 13, color: '#2E7D32', marginBottom: 10, marginTop: 10 }}>
                  {backupMsg}
                </div>
              )}
              <div
                style={{
                  display: 'flex',
                  gap: 20,
                  fontSize: 12,
                  color: '#555',
                  marginBottom: 10,
                  marginTop: 12,
                }}
              >
                <span>
                  📦 <strong>{backupInfo.count}</strong> backups stored (max 14)
                </span>
                {backupInfo.lastRanAt && (
                  <span>
                    🕐 Last:{' '}
                    {new Date(backupInfo.lastRanAt).toLocaleString('en-US', {
                      timeZone: 'America/New_York',
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                )}
              </div>
              {backupInfo.backups?.length > 0 && (
                <div
                  style={{
                    maxHeight: 140,
                    overflowY: 'auto',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                  }}
                >
                  {backupInfo.backups.map((b, i) => (
                    <div
                      key={i}
                      style={{
                        fontSize: 11,
                        color: '#555',
                        fontFamily: 'monospace',
                        padding: '4px 8px',
                        background: 'white',
                        borderRadius: 4,
                        border: '1px solid #e5e7eb',
                      }}
                    >
                      {b.file} — {b.size}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div style={{ fontSize: 13, color: '#888' }}>Loading backup info…</div>
          )}
        </div>

        {/* ── Report Schedule ── */}
        <div
          style={{
            marginTop: 16,
            background: '#F3F6FC',
            borderRadius: 10,
            padding: '18px 20px',
            border: '1px solid #dce3f3',
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 'bold', color: BLUE, marginBottom: 14 }}>
            📅 Auto-Report Schedule
          </div>
          {reportSchedule ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end' }}>
              <div>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Send every</div>
                <select
                  value={reportSchedule.intervalHours}
                  onChange={(e) =>
                    setReportSchedule((s) => ({ ...s, intervalHours: parseInt(e.target.value) }))
                  }
                  style={{
                    padding: '7px 12px',
                    border: '1px solid #ccc',
                    borderRadius: 6,
                    fontSize: 13,
                  }}
                >
                  {[1, 2, 4, 6, 8, 12, 24, 48, 72, 168].map((h) => (
                    <option key={h} value={h}>
                      {h === 1 ? '1 hour' : h === 168 ? '1 week' : `${h} hours`}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>
                  At specific hour (ET)
                </div>
                <select
                  value={reportSchedule.hourOfDay}
                  onChange={(e) =>
                    setReportSchedule((s) => ({ ...s, hourOfDay: parseInt(e.target.value) }))
                  }
                  style={{
                    padding: '7px 12px',
                    border: '1px solid #ccc',
                    borderRadius: 6,
                    fontSize: 13,
                  }}
                >
                  <option value={-1}>— use interval only —</option>
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      {h === 0
                        ? '12:00 AM'
                        : h < 12
                          ? `${h}:00 AM`
                          : h === 12
                            ? '12:00 PM'
                            : `${h - 12}:00 PM`}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  disabled={scheduleSaving}
                  onClick={async () => {
                    setScheduleSaving(true);
                    try {
                      await fetch('/api/status/schedule', {
                        method: 'POST',
                        headers,
                        body: JSON.stringify(reportSchedule),
                      });
                      setScheduleSaved(true);
                      setTimeout(() => setScheduleSaved(false), 2500);
                    } finally {
                      setScheduleSaving(false);
                    }
                  }}
                  style={{
                    padding: '7px 18px',
                    background: scheduleSaved ? '#2E7D32' : BLUE,
                    color: 'white',
                    border: 'none',
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    fontSize: 13,
                  }}
                >
                  {scheduleSaved ? '✅ Saved' : scheduleSaving ? '...' : 'Save Schedule'}
                </button>
                <button
                  onClick={async () => {
                    await fetch('/api/status/send-now', { method: 'POST', headers });
                    alert('Report sending now — check your email in a moment.');
                  }}
                  style={{
                    padding: '7px 18px',
                    background: 'white',
                    color: BLUE,
                    border: `1.5px solid ${BLUE}`,
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    fontSize: 13,
                  }}
                >
                  ▶ Send Now
                </button>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 13, color: '#888' }}>Loading schedule…</div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="pb-page">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 24,
          flexWrap: 'wrap',
          gap: 10,
        }}
      >
        <h1 style={{ fontSize: 22, fontWeight: 'bold', color: BLUE, margin: 0 }}>⚙️ Settings</h1>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <a
            href={`/api/blank-contract?token=${token}`}
            download="PB_Contract_Template_BLANK.docx"
            style={{
              background: 'white',
              color: BLUE,
              border: `2px solid ${BLUE}`,
              padding: '10px 20px',
              borderRadius: 8,
              cursor: 'pointer',
              fontWeight: 'bold',
              textDecoration: 'none',
              fontSize: 14,
            }}
          >
            ⬇ Blank Contract
          </a>
          {activeTab !== 'Secrets' && activeTab !== 'Status' && (
            <button
              onClick={save}
              style={{
                background: saved ? '#2E7D32' : BLUE,
                color: 'white',
                border: 'none',
                padding: '10px 24px',
                borderRadius: 8,
                cursor: 'pointer',
                fontWeight: 'bold',
              }}
            >
              {saved ? '✅ Saved!' : 'Save Changes'}
            </button>
          )}
        </div>
      </div>

      {/* Tabs — horizontally scrollable on mobile */}
      <div
        className="pb-tabs"
        style={{
          marginBottom: 24,
          borderBottom: '2px solid #eee',
          display: 'flex',
          overflowX: 'auto',
          WebkitOverflowScrolling: 'touch',
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
        }}
      >
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '10px 16px',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 13,
              whiteSpace: 'nowrap',
              flexShrink: 0,
              fontWeight: activeTab === tab ? 'bold' : 'normal',
              color: activeTab === tab ? BLUE : '#888',
              borderBottom: activeTab === tab ? `2px solid ${BLUE}` : '2px solid transparent',
              marginBottom: -2,
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      <div
        style={{
          background: 'white',
          borderRadius: 10,
          padding: 24,
          boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
        }}
      >
        {activeTab === 'Markup' && renderMarkup()}
        {activeTab === 'Labor Rates' && renderLaborRates()}
        {activeTab === 'Dept Definitions' && renderDeptDefinitions()}
        {activeTab === 'Allowances' && renderAllowances()}
        {activeTab === 'Integrations' && renderIntegrations()}
        {activeTab === 'Bot Behavior' && renderBotBehavior()}
        {activeTab === 'Calendar' && renderCalendar()}
        {activeTab === 'Email Log' && renderEmailLog()}
        {activeTab === 'Secrets' && renderSecrets()}
        {activeTab === 'Status' && renderStatus()}
        {activeTab === 'Logs' && renderLogs()}
      </div>

      {/* Email preview modal */}
      {emailPreview && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={() => setEmailPreview(null)}
        >
          <div
            style={{
              background: 'white',
              borderRadius: 10,
              width: '80vw',
              maxWidth: 720,
              height: '80vh',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                padding: '14px 20px',
                borderBottom: '1px solid #eee',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <div style={{ fontWeight: 'bold', color: BLUE, fontSize: 14 }}>
                  📧 Email Preview
                </div>
                <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
                  {emailPreview.subject}
                </div>
              </div>
              <button
                onClick={() => setEmailPreview(null)}
                style={{
                  background: '#eee',
                  border: 'none',
                  borderRadius: 6,
                  padding: '6px 14px',
                  cursor: 'pointer',
                  fontSize: 13,
                }}
              >
                ✕ Close
              </button>
            </div>
            <iframe
              src={`/api/email-log/${emailPreview.id}/preview?token=${encodeURIComponent(token)}`}
              title="Email Preview"
              style={{ flex: 1, border: 'none', width: '100%' }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
