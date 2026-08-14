// client/src/index.js
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// ErrorBoundary lives here in the entry point so webpack never scope-hoists it
// into the same chunk as React internals (prevents TDZ name collision).
class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(err) {
    return { error: err };
  }
  componentDidCatch(err, info) {
    console.error('[AppErrorBoundary]', err, info?.componentStack);
  }
  render() {
    if (this.state.error) {
      return React.createElement('div', {
        style: {
          minHeight: '100vh', display: 'flex', alignItems: 'center',
          justifyContent: 'center', background: '#f4f6fb',
          fontFamily: 'Arial, sans-serif', padding: 24,
        }
      }, React.createElement('div', {
        style: {
          background: 'white', borderRadius: 12, padding: 32,
          maxWidth: 600, width: '100%', boxShadow: '0 2px 12px rgba(0,0,0,0.1)',
        }
      },
        React.createElement('h2', { style: { color: '#C62828', margin: '0 0 12px' } }, 'Something went wrong'),
        React.createElement('p', { style: { color: '#555', marginBottom: 16, fontSize: 14 } },
          'The app hit an unexpected error. Copy the message below and send it to support.'),
        React.createElement('pre', {
          style: {
            background: '#fafafa', border: '1px solid #ddd', borderRadius: 6,
            padding: 12, fontSize: 12, overflowX: 'auto',
            whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: '#333',
          }
        }, String(this.state.error)),
        React.createElement('button', {
          onClick: () => window.location.reload(),
          style: {
            marginTop: 16, padding: '10px 20px', background: '#1B3A6B',
            color: 'white', border: 'none', borderRadius: 6,
            cursor: 'pointer', fontSize: 14,
          }
        }, 'Reload Page')
      ));
    }
    return this.props.children;
  }
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>
);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js');
  });
}
