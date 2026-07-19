import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertCircle, RefreshCcw, RefreshCw } from "lucide-react";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { Button } from "./Button";
import { cn } from "../../lib/util";

export interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  resetKey?: unknown;
  presentation?: "component" | "app";
  reload?: () => void;
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
      return (
        <DefaultErrorFallback
          onReset={this.resetErrorBoundary}
          presentation={this.props.presentation ?? "component"}
          onReload={this.props.reload}
        />
      );
    }

    return this.props.children;
  }
}

interface DefaultErrorFallbackProps {
  onReset: () => void;
  onReload?: () => void;
  presentation: "component" | "app";
}

function DefaultErrorFallback({ onReset, onReload, presentation }: DefaultErrorFallbackProps): JSX.Element {
  const appPresentation = presentation === "app";
  return (
    <main
      className={cn(
        "flex w-full items-center justify-center bg-paper-50 p-6",
        appPresentation ? "min-h-screen" : "h-full",
      )}
      role="alert"
    >
      <section
        aria-labelledby="error-boundary-title"
        className="flex w-full max-w-[520px] flex-col gap-4 rounded-lg border border-ink-200 bg-paper-100 p-6 text-center shadow-panel"
      >
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-brick-50">
          <AlertCircle aria-hidden="true" className="h-6 w-6 text-brick-600" />
        </div>
        <div className="flex flex-col gap-2">
          <h1 id="error-boundary-title" className="text-[16px] font-semibold text-ink-950">
            {frontendMessage("app.errorBoundary.title")}
          </h1>
          <p className="text-[13px] leading-5 text-ink-600">
            {frontendMessage("app.errorBoundary.description")}
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={onReset} variant="outline">
            <RefreshCw aria-hidden="true" className="h-4 w-4" />
            {frontendMessage("app.errorBoundary.retry")}
          </Button>
          {appPresentation ? (
            <Button onClick={onReload ?? (() => globalThis.location?.reload())}>
              <RefreshCcw aria-hidden="true" className="h-4 w-4" />
              {frontendMessage("app.errorBoundary.reload")}
            </Button>
          ) : null}
        </div>
      </section>
    </main>
  );
}
