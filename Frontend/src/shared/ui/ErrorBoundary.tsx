import { Component, type ErrorInfo, type ReactNode, useId } from "react";
import { AlertCircle } from "lucide-react";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { Button } from "./Button";
import { cn } from "../../lib/util";
import { ResonanceTrace } from "./LoadingSignal";

export interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  onReset?: () => void;
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
    this.setState({ hasError: false, error: null }, () => this.props.onReset?.());
  };

  render(): ReactNode {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.resetErrorBoundary);
      }

      return (
        <DefaultErrorFallback
          error={this.state.error}
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
  error: Error;
  onReset: () => void;
  onReload?: () => void;
  presentation: "component" | "app";
}

function DefaultErrorFallback({ error, onReset, onReload, presentation }: DefaultErrorFallbackProps): JSX.Element {
  const appPresentation = presentation === "app";
  const requiresPageReload = appPresentation && isDynamicModuleLoadError(error);
  const titleId = useId();
  const Container = appPresentation ? "main" : "section";
  const Heading = appPresentation ? "h1" : "h2";
  return (
    <Container
      className={cn(
        "flex w-full items-start justify-center bg-[var(--theme-bg)] px-5 py-8 sm:px-8",
        appPresentation ? "min-h-dvh pt-[clamp(48px,16vh,160px)]" : "h-full py-6",
      )}
      role="alert"
      aria-labelledby={titleId}
      aria-live="polite"
      data-error-boundary
      data-error-boundary-kind={requiresPageReload ? "reload" : "retry"}
    >
      <div
        className={cn(
          "relative w-full",
          appPresentation
            ? "max-w-[720px] border-y border-line-subtle px-1 py-7 sm:px-2 sm:py-8"
            : "border-y border-line-subtle px-1 py-5",
        )}
      >
        <span className="senera-error-boundary__pulse" aria-hidden="true" />
        <div className="flex items-start gap-3.5 sm:gap-4">
          <div className="relative mt-0.5 flex h-8 w-11 shrink-0 items-center justify-start">
            <ResonanceTrace size="sm" state="settled" className="opacity-80" />
            <AlertCircle aria-hidden="true" className="absolute left-0 h-3.5 w-3.5 text-accent-content" />
          </div>
          <div className="min-w-0 flex-1">
            <Heading
              id={titleId}
              className="text-[15px] font-semibold tracking-[0.01em] text-content-primary sm:text-[16px]"
            >
              {frontendMessage("app.errorBoundary.title")}
            </Heading>
            <p className="mt-1.5 max-w-[64ch] text-[13px] leading-5 text-content-secondary">
              {frontendMessage(
                requiresPageReload ? "app.errorBoundary.dynamicImportDescription" : "app.errorBoundary.description",
              )}
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-2.5">
              {requiresPageReload ? (
                <Button onClick={onReload ?? (() => globalThis.location?.reload())} size="sm">
                  {frontendMessage("app.errorBoundary.reload")}
                </Button>
              ) : (
                <Button onClick={onReset} size="sm">
                  {frontendMessage("app.errorBoundary.retry")}
                </Button>
              )}
              {appPresentation && !requiresPageReload ? (
                <Button onClick={onReload ?? (() => globalThis.location?.reload())} size="sm" variant="ghost">
                  {frontendMessage("app.errorBoundary.reload")}
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </Container>
  );
}

function isDynamicModuleLoadError(error: Error): boolean {
  return /failed to fetch dynamically imported module|importing a module script failed|dynamically imported module/i.test(
    error.message,
  );
}
