import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Logo } from './Logo';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/** Catches render errors and shows a branded recovery screen. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Render error:', error, info.componentStack);
  }

  override render() {
    if (this.state.error) {
      return (
        <div className="grid min-h-screen place-items-center bg-app p-6 text-center">
          <div className="max-w-sm">
            <Logo className="mx-auto h-9 w-auto" />
            <h1 className="mt-5 font-display text-lg font-bold text-ink">
              Something went wrong
            </h1>
            <p className="mt-2 text-sm text-muted">
              The screen hit an unexpected error. Reloading usually fixes it.
            </p>
            <button
              type="button"
              className="btn-primary mt-5"
              onClick={() => window.location.reload()}
            >
              Reload app
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
