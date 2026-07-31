import React from 'react';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches render errors so one bad screen doesn't blank the whole window.
 *
 * Without this, any throw during render unmounts the entire React tree and the
 * user is left staring at the dark background with no explanation and no way
 * back — which is a particularly bad outcome for an app that is mid-way through
 * telling them what it's about to delete.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[AICacheCleaner] render error:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="ins-scope" style={{ padding: 'var(--ins-space-6)', minHeight: '100vh', background: 'var(--ins-graphite-900)' }}>
        <div className="ins-panel" style={{ padding: 'var(--ins-space-5)', maxWidth: '620px' }}>
          <h1 className="ins-h1" style={{ fontSize: '1.125rem', marginBottom: 'var(--ins-space-2)' }}>
            This screen stopped responding
          </h1>
          <p className="ins-sub" style={{ marginBottom: 'var(--ins-space-4)' }}>
            Nothing was deleted. The rest of the app is unaffected — reload to carry on.
          </p>

          <pre
            className="ins-data"
            style={{
              background: 'var(--ins-graphite-850)',
              border: '1px solid var(--ins-graphite-700)',
              borderRadius: '4px',
              padding: 'var(--ins-space-3)',
              fontSize: '0.75rem',
              color: 'var(--ins-mist-300)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              marginBottom: 'var(--ins-space-4)'
            }}
          >
            {this.state.error.message}
          </pre>

          <div style={{ display: 'flex', gap: 'var(--ins-space-2)' }}>
            <button className="ins-btn ins-btn--primary" onClick={() => window.location.reload()}>
              Reload
            </button>
            <button className="ins-btn" onClick={() => this.setState({ error: null })}>
              Try this screen again
            </button>
          </div>
        </div>
      </div>
    );
  }
}
