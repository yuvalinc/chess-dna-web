import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-chess-bg p-6">
          <div className="text-center max-w-md">
            <div className="text-4xl mb-4">Something went wrong</div>
            <p className="text-sm text-gray-400 mb-4">
              An unexpected error occurred. This has been logged for debugging.
            </p>
            {this.state.error && (
              <pre className="text-[10px] text-gray-600 bg-chess-surface rounded-lg p-3 mb-4 overflow-auto max-h-32 text-left">
                {this.state.error.message}
              </pre>
            )}
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.href = '/';
              }}
              className="bg-chess-accent text-chess-bg px-6 py-2 rounded-lg text-sm font-bold hover:brightness-110 transition-all"
            >
              Go Home
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
