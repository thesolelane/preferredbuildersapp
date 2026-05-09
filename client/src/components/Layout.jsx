import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import StaffChat from './StaffChat';

const BLUE = '#1B3A6B';
const ORANGE = '#E07B2A';

const MAIN_NAV = [
  { path: '/', icon: '📊', label: 'Dashboard' },
  { path: '/leads', icon: '📞', label: 'Leads' },
  { path: '/tasks', icon: '✅', label: 'Tasks' },
  { path: '/payments', icon: '💰', label: 'Payments' },
  { path: '/invoices', icon: '🧾', label: 'Invoices' },
  { path: '/purchase-orders', icon: '📦', label: 'Purchase Orders' },
  { path: '/field-camera', icon: '📷', label: 'Field Camera' },
  { path: '/staff-portal', icon: '👷', label: 'Staff Portal' },
  { path: '/chat', icon: '🤖', label: 'Ask the Bot' },
  { path: '/contacts', icon: '👥', label: 'Contacts' },
  { path: '/vendors', icon: '🏗️', label: 'Subs & Vendors' },
  { path: '/takeoff', icon: '📐', label: 'Material Take-Off' },
  { path: '/analytics', icon: '📈', label: 'Analytics' },
  { path: '/reports', icon: '📋', label: 'Reports' },
];

const CONFIG_NAV_ALL = [
  { path: '/settings', icon: '⚙️', label: 'Settings', adminOnly: true },
  { path: '/knowledge', icon: '📚', label: 'Knowledge Base' },
  { path: '/team', icon: '👷', label: 'Team' },
  { path: '/agents', icon: '🤖', label: 'Agents' },
  { path: '/guide', icon: '📋', label: 'Help Guide' },
];

const BOTTOM_NAV = [
  { path: '/', icon: '📊', label: 'Jobs' },
  { path: '/tasks', icon: '✅', label: 'Tasks' },
  { path: '/field-camera', icon: '📷', label: 'Camera' },
  { path: '/payments', icon: '💰', label: 'Payments' },
];

const ALL_NAV = [...MAIN_NAV, ...CONFIG_NAV_ALL];

function SidebarNavItem({ item, active, collapsed }) {
  return (
    <Link to={item.path} style={{ textDecoration: 'none' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '9px 16px',
          background: active ? 'rgba(224,123,42,0.28)' : 'transparent',
          borderLeft: active ? `3px solid ${ORANGE}` : '3px solid transparent',
          color: 'white',
          fontSize: 13,
          cursor: 'pointer',
          transition: 'background 0.15s',
        }}
        title={collapsed ? item.label : undefined}
      >
        <span style={{ fontSize: 16, flexShrink: 0 }}>{item.icon}</span>
        {!collapsed && (
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {item.label}
          </span>
        )}
      </div>
    </Link>
  );
}

export default function Layout({ children, token, onLogout, userName, userRole }) {
  const { pathname } = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  const CONFIG_NAV = CONFIG_NAV_ALL.filter((n) => !n.adminOnly || userRole === 'system_admin');

  const configActive = CONFIG_NAV.some((n) => n.path === pathname);
  const currentPage = ALL_NAV.find((n) => n.path === pathname);

  return (
    <div style={{ minHeight: '100vh', fontFamily: 'Arial, sans-serif', background: '#f4f6fb' }}>
      {/* ── Mobile header — hidden on desktop via CSS ── */}
      <header
        className="pb-mobile-header"
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 900,
          background: BLUE,
          color: 'white',
          alignItems: 'center',
          padding: '12px 16px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
        }}
      >
        <div>
          <div style={{ fontWeight: 'bold', fontSize: 10, color: ORANGE, letterSpacing: '0.05em' }}>
            PREFERRED BUILDERS
          </div>
          <div style={{ fontSize: 14, fontWeight: 'bold', marginTop: 1 }}>
            {currentPage ? `${currentPage.icon} ${currentPage.label}` : '📊 Dashboard'}
          </div>
        </div>
      </header>

      {/* ── Main layout row: sidebar + content ── */}
      <div style={{ display: 'flex', minHeight: 'calc(100vh - 0px)' }}>
        {/* Sidebar — hidden on mobile via CSS */}
        <aside
          className="pb-sidebar-wrap"
          style={{
            width: collapsed ? 58 : 222,
            background: BLUE,
            color: 'white',
            flexDirection: 'column',
            transition: 'width 0.2s',
            flexShrink: 0,
            overflow: 'hidden',
            height: '100vh',
            position: 'sticky',
            top: 0,
          }}
        >
          <div
            style={{
              padding: '16px 14px 10px',
              borderBottom: '1px solid rgba(255,255,255,0.1)',
              flexShrink: 0,
            }}
          >
            {!collapsed && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <img
                    src="/images/logo-bolinha.png"
                    alt="PB"
                    style={{
                      width: 34,
                      height: 34,
                      objectFit: 'contain',
                      borderRadius: '50%',
                      flexShrink: 0,
                    }}
                  />
                  <div>
                    <div
                      style={{
                        fontWeight: 'bold',
                        fontSize: 11,
                        color: ORANGE,
                        letterSpacing: '0.04em',
                        lineHeight: 1.2,
                      }}
                    >
                      PREFERRED BUILDERS
                    </div>
                    <div style={{ fontSize: 9, opacity: 0.6, marginTop: 1 }}>
                      AI Contract System
                    </div>
                  </div>
                </div>
              </>
            )}
            <button
              onClick={() => setCollapsed(!collapsed)}
              style={{
                background: 'none',
                border: 'none',
                color: 'white',
                cursor: 'pointer',
                fontSize: 17,
                marginTop: collapsed ? 0 : 8,
                padding: 0,
              }}
              title={collapsed ? 'Expand' : 'Collapse'}
            >
              {collapsed ? '▶' : '◀'}
            </button>
          </div>

          <nav style={{ flex: 1, paddingTop: 6, overflowY: 'auto', overflowX: 'hidden' }}>
            {MAIN_NAV.map((item) => (
              <SidebarNavItem
                key={item.path}
                item={item}
                active={pathname === item.path}
                collapsed={collapsed}
              />
            ))}
            <div
              style={{ marginTop: 8, borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 4 }}
            >
              <button
                onClick={() => setConfigOpen((o) => !o)}
                style={{
                  width: '100%',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '9px 16px',
                  color: configActive ? ORANGE : 'rgba(255,255,255,0.55)',
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: '0.07em',
                  textTransform: 'uppercase',
                }}
                title={collapsed ? 'Config & Tools' : undefined}
              >
                <span style={{ fontSize: 15, flexShrink: 0 }}>🛠️</span>
                {!collapsed && (
                  <>
                    <span style={{ flex: 1, textAlign: 'left' }}>Config &amp; Tools</span>
                    <span style={{ fontSize: 12, opacity: 0.7, marginRight: 2 }}>
                      {configOpen ? '▾' : '▸'}
                    </span>
                  </>
                )}
              </button>
              {collapsed &&
                CONFIG_NAV.map((item) => (
                  <SidebarNavItem
                    key={item.path}
                    item={item}
                    active={pathname === item.path}
                    collapsed={true}
                  />
                ))}
              {!collapsed && configOpen && (
                <div
                  style={{ background: 'rgba(0,0,0,0.15)', borderRadius: 6, margin: '2px 8px 6px' }}
                >
                  {CONFIG_NAV.map((item) => (
                    <Link key={item.path} to={item.path} style={{ textDecoration: 'none' }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          padding: '8px 14px',
                          background:
                            pathname === item.path ? 'rgba(224,123,42,0.28)' : 'transparent',
                          borderLeft:
                            pathname === item.path
                              ? `3px solid ${ORANGE}`
                              : '3px solid transparent',
                          color: pathname === item.path ? 'white' : 'rgba(255,255,255,0.75)',
                          fontSize: 12,
                          cursor: 'pointer',
                          borderRadius: 4,
                          transition: 'background 0.15s',
                        }}
                      >
                        <span style={{ fontSize: 15 }}>{item.icon}</span>
                        <span>{item.label}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </nav>

          <div
            style={{
              padding: '12px 14px',
              borderTop: '1px solid rgba(255,255,255,0.1)',
              flexShrink: 0,
            }}
          >
            {!collapsed && userName && (
              <div style={{ fontSize: 11, opacity: 0.75, marginBottom: 8, lineHeight: 1.4 }}>
                Signed in as
                <br />
                <span style={{ fontWeight: 'bold', fontSize: 12 }}>{userName}</span>
                {userRole && (
                  <span style={{ fontSize: 10, opacity: 0.65, marginLeft: 5 }}>
                    (
                    {{ system_admin: 'Sys Admin', admin: 'Admin', pm: 'PM', staff: 'Staff' }[
                      userRole
                    ] || userRole}
                    )
                  </span>
                )}
              </div>
            )}
            <button
              onClick={onLogout}
              title="Logout"
              style={{
                background: 'rgba(255,255,255,0.1)',
                border: 'none',
                color: 'white',
                padding: '7px 10px',
                borderRadius: 6,
                cursor: 'pointer',
                width: '100%',
                fontSize: 12,
              }}
            >
              {collapsed ? '🚪' : '🚪 Logout'}
            </button>
          </div>
        </aside>

        {/* Main content — always visible, fills remaining space */}
        <main className="pb-mobile-content" style={{ flex: 1, overflow: 'auto', minWidth: 0 }}>
          {children}
        </main>
      </div>

      {/* ── Bottom nav — hidden on desktop via CSS ── */}
      <nav
        className="pb-bottom-nav"
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 1000,
          background: BLUE,
          borderTop: '1px solid rgba(255,255,255,0.15)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        {BOTTOM_NAV.map((item) => {
          const active = pathname === item.path;
          return (
            <Link key={item.path} to={item.path} style={{ flex: 1, textDecoration: 'none' }}>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  padding: '10px 0 8px',
                  color: active ? ORANGE : 'rgba(255,255,255,0.65)',
                  fontSize: 10,
                  fontWeight: active ? 'bold' : 'normal',
                  borderTop: active ? `2px solid ${ORANGE}` : '2px solid transparent',
                }}
              >
                <span style={{ fontSize: 22, marginBottom: 2 }}>{item.icon}</span>
                {item.label}
              </div>
            </Link>
          );
        })}
        <button
          onClick={() => setSheetOpen(true)}
          style={{
            flex: 1,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            padding: '10px 0 8px',
            color: 'rgba(255,255,255,0.65)',
            fontSize: 10,
            borderTop: '2px solid transparent',
          }}
        >
          <span style={{ fontSize: 22, marginBottom: 2 }}>☰</span>
          More
        </button>
      </nav>

      {/* ── Staff team chat widget — desktop only ── */}
      <StaffChat token={token} />

      {/* ── Mobile "More" slide-up sheet ── */}
      {sheetOpen && (
        <>
          <div
            onClick={() => setSheetOpen(false)}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.5)',
              zIndex: 1100,
            }}
          />
          <div
            style={{
              position: 'fixed',
              bottom: 0,
              left: 0,
              right: 0,
              zIndex: 1200,
              background: BLUE,
              borderRadius: '16px 16px 0 0',
              maxHeight: '75vh',
              overflowY: 'auto',
              paddingBottom: 'env(safe-area-inset-bottom)',
            }}
          >
            <div
              style={{
                padding: '14px 20px 8px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <div style={{ fontWeight: 'bold', fontSize: 13, color: ORANGE }}>
                  PREFERRED BUILDERS
                </div>
                {userName && (
                  <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>{userName}</div>
                )}
              </div>
              <button
                onClick={() => setSheetOpen(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'white',
                  fontSize: 22,
                  cursor: 'pointer',
                  padding: '4px 8px',
                }}
              >
                ✕
              </button>
            </div>
            <div style={{ padding: '4px 0 8px' }}>
              {ALL_NAV.map((item) => {
                const active = pathname === item.path;
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    onClick={() => setSheetOpen(false)}
                    style={{ textDecoration: 'none' }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 14,
                        padding: '13px 20px',
                        background: active ? 'rgba(224,123,42,0.25)' : 'transparent',
                        borderLeft: active ? `3px solid ${ORANGE}` : '3px solid transparent',
                        color: active ? 'white' : 'rgba(255,255,255,0.8)',
                        fontSize: 15,
                      }}
                    >
                      <span style={{ fontSize: 20 }}>{item.icon}</span>
                      <span>{item.label}</span>
                      {active && <span style={{ marginLeft: 'auto', color: ORANGE }}>●</span>}
                    </div>
                  </Link>
                );
              })}
            </div>
            <div
              style={{ padding: '12px 20px 16px', borderTop: '1px solid rgba(255,255,255,0.1)' }}
            >
              <button
                onClick={() => {
                  setSheetOpen(false);
                  onLogout();
                }}
                style={{
                  width: '100%',
                  background: 'rgba(255,255,255,0.1)',
                  border: 'none',
                  color: 'white',
                  padding: '13px',
                  borderRadius: 8,
                  cursor: 'pointer',
                  fontSize: 15,
                }}
              >
                🚪 Logout
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
