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

    this.props.onError?.(error, errorInfo);
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
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.resetErrorBoundary);
      }

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
        "flex w-full items-start justify-center bg-[var(--theme-bg)] px-4 py-6 sm:px-6",
        appPresentation ? "min-h-dvh pt-[clamp(32px,12vh,120px)]" : "h-full",
      )}
      role="alert"
    >
      <section
        aria-labelledby="error-boundary-title"
        className={cn(
          "w-full bg-paper-100",
          appPresentation
            ? "max-w-[860px] border-y border-ink-200/70 px-5 py-6 sm:px-8 sm:py-7"
            : "border-y border-ink-200/70 px-4 py-5",
        )}
      >
        <div className="flex items-start gap-4">
          <AlertCircle aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-brick-600" />
          <div className="min-w-0 flex-1">
            <h1 id="error-boundary-title" className="text-[15px] font-semibold text-ink-950 sm:text-[16px]">
              {frontendMessage("app.errorBoundary.title")}
            </h1>
            <p className="mt-1.5 max-w-[64ch] text-[13px] leading-5 text-ink-600">
              {frontendMessage("app.errorBoundary.description")}
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <Button onClick={onReset} size="sm">
                <RefreshCw aria-hidden="true" className="h-4 w-4" />
                {frontendMessage("app.errorBoundary.retry")}
              </Button>
              {appPresentation ? (
                <Button onClick={onReload ?? (() => globalThis.location?.reload())} size="sm" variant="ghost">
                  <RefreshCcw aria-hidden="true" className="h-4 w-4" />
                  {frontendMessage("app.errorBoundary.reload")}
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
