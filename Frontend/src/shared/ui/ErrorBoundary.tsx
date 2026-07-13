import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "./Button";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  resetKey?: unknown;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    if (import.meta.env.DEV) {
      console.error("ErrorBoundary caught an error:", error, errorInfo);
    }

    // Call optional error handler
    this.props.onError?.(error, errorInfo);

    // In production, this could send to a monitoring service
    // Example: sendToSentry(error, errorInfo);
  }

  componentDidUpdate(previousProps: Readonly<ErrorBoundaryProps>): void {
    if (this.state.hasError && !Object.is(previousProps.resetKey, this.props.resetKey)) {
      this.resetErrorBoundary();
    }
  }

  resetErrorBoundary = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError && this.state.error) {
      // Use custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.resetErrorBoundary);
      }

      // Default fallback UI
      return <DefaultErrorFallback onReset={this.resetErrorBoundary} />;
    }

    return this.props.children;
  }
}

interface DefaultErrorFallbackProps {
  onReset: () => void;
}

function DefaultErrorFallback({ onReset }: DefaultErrorFallbackProps): JSX.Element {
  return (
    <div className="flex h-full w-full items-center justify-center bg-paper-50 p-6" role="alert">
      <div className="flex max-w-md flex-col items-center gap-4 rounded-lg border border-border-200 bg-paper-100 p-6 text-center shadow-sm">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive-100">
          <AlertCircle aria-hidden="true" className="h-6 w-6 text-destructive-600" />
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-lg font-semibold text-text-primary">Something went wrong</h3>
          <p className="text-sm text-text-secondary">
            An unexpected error occurred. You can try refreshing this component, or reload the page if the problem
            persists.
          </p>
        </div>
        <Button onClick={onReset} variant="default" className="mt-2">
          <RefreshCw aria-hidden="true" className="mr-2 h-4 w-4" />
          Try again
        </Button>
      </div>
    </div>
  );
}
