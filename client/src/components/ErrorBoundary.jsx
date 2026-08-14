import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(err) {
    return { error: err };
  }

  componentDidCatch(err, info) {
    console.error('[ErrorBoundary]', err, info?.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f4f6fb',
          fontFamily: 'Arial, sans-serif',
          padding: 24,
        }}>
          <div style={{
            background: 'white',
            borderRadius: 12,
            padding: 32,
            maxWidth: 600,
            width: '100%',
            boxShadow: '0 2px 12px rgba(0,0,0,0.1)',
          }}>
            <h2 style={{ color: '#C62828', margin: '0 0 12px' }}>Something went wrong</h2>
            <p style={{ color: '#555', marginBottom: 16, fontSize: 14 }}>
              The app hit an unexpected error. Please copy the message below and send it to support.
            </p>
            <pre style={{
              background: '#fafafa',
              border: '1px solid #ddd',
              borderRadius: 6,
              padding: 12,
              fontSize: 12,
              overflowX: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              color: '#333',
            }}>
              {String(this.state.error)}
            </pre>
            <button
              onClick={() => window.location.reload()}
              style={{
                marginTop: 16,
                padding: '10px 20px',
                background: '#1B3A6B',
                color: 'white',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 14,
              }}
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
