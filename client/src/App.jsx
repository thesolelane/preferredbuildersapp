import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import JobDetail from './pages/JobDetail';
import Settings from './pages/Settings';
import KnowledgeBase from './pages/KnowledgeBase';
import AdminChat from './pages/AdminChat';
import Team from './pages/Team';
import FieldGuide from './pages/FieldGuide';
import Contacts from './pages/Contacts';
import Vendors from './pages/Vendors';
import Tasks from './pages/Tasks';
import Leads from './pages/Leads';
import Payments from './pages/Payments';
import Invoices from './pages/Invoices';
import MaterialTakeOff from './pages/MaterialTakeOff';
import Analytics from './pages/Analytics';
import FieldCamera from './pages/FieldCamera';
import Reports from './pages/Reports';
import Agents from './pages/Agents';
import PurchaseOrders from './pages/PurchaseOrders';
import StaffView from './components/StaffView';
import Layout from './components/Layout';
import Toast from './components/Toast';
import ConfirmDialog from './components/ConfirmDialog';

function App() {
  const [token, setToken] = useState(localStorage.getItem('pb_token'));
  const [userName, setUserName] = useState(localStorage.getItem('pb_user_name') || '');
  const [userRole, setUserRole] = useState(localStorage.getItem('pb_user_role') || '');

  const handleLogin = (newToken, name, role) => {
    localStorage.setItem('pb_token', newToken);
    localStorage.setItem('pb_user_name', name);
    localStorage.setItem('pb_user_role', role);
    setToken(newToken);
    setUserName(name);
    setUserRole(role);
  };

  const handleLogout = () => {
    const currentToken = localStorage.getItem('pb_token');
    if (currentToken) {
      fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'x-auth-token': currentToken },
      }).catch(() => {});
    }
    localStorage.removeItem('pb_token');
    localStorage.removeItem('pb_user_name');
    localStorage.removeItem('pb_user_role');
    setToken(null);
    setUserName('');
    setUserRole('');
  };

  useEffect(() => {
    if (!token) return;
    const origFetch = window.fetch;
    window.fetch = async (...args) => {
      const res = await origFetch(...args);
      if (res.status === 401) {
        handleLogout();
      }
      return res;
    };
    return () => {
      window.fetch = origFetch;
    };
  }, [token]);

  // Validate session when user returns to the tab or focuses the window
  useEffect(() => {
    if (!token) return;
    const validate = async () => {
      try {
        const res = await fetch('/api/auth/validate', {
          headers: { 'x-auth-token': token },
        });
        if (res.status === 401) handleLogout();
      } catch (_e) {
        /* session may have expired */
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') validate();
    };
    const onFocus = () => validate();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
    };
  }, [token]);

  // Auto-logout after 20 minutes of no mouse/keyboard/touch activity
  useEffect(() => {
    if (!token) return;
    const IDLE_MS = 20 * 60 * 1000;
    let timer = setTimeout(handleLogout, IDLE_MS);
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(handleLogout, IDLE_MS);
    };
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [token]);

  if (!token) return <Login onLogin={handleLogin} />;

  return (
    <BrowserRouter>
      <Toast />
      <ConfirmDialog />
      <Layout token={token} onLogout={handleLogout} userName={userName} userRole={userRole}>
        <Routes>
          <Route path="/" element={<Dashboard token={token} />} />
          <Route path="/jobs/:id" element={<JobDetail token={token} userName={userName} />} />
          <Route path="/settings" element={<Settings token={token} userRole={userRole} />} />
          <Route path="/knowledge" element={<KnowledgeBase token={token} />} />
          <Route path="/chat" element={<AdminChat token={token} />} />
          <Route path="/team" element={<Team token={token} userRole={userRole} />} />
          <Route path="/whitelist" element={<Navigate to="/team" />} />
          <Route path="/contacts" element={<Contacts token={token} />} />
          <Route path="/vendors" element={<Vendors token={token} />} />
          <Route path="/tasks" element={<Tasks token={token} />} />
          <Route path="/leads" element={<Leads token={token} />} />
          <Route path="/payments" element={<Payments token={token} />} />
          <Route path="/invoices" element={<Invoices token={token} />} />
          <Route path="/takeoff" element={<MaterialTakeOff />} />
          <Route path="/analytics" element={<Analytics token={token} />} />
          <Route path="/reports" element={<Reports token={token} />} />
          <Route path="/purchase-orders" element={<PurchaseOrders token={token} />} />
          <Route path="/field-camera" element={<FieldCamera token={token} />} />
          <Route path="/guide" element={<FieldGuide />} />
          <Route path="/agents" element={<Agents token={token} userRole={userRole} />} />
          <Route path="/staff-portal" element={<StaffView token={token} />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}

export default App;
