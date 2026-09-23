import { Component, type ErrorInfo, type ReactNode, useId, useState } from "react";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import { AppIcon } from "./AppIcon";
import { RetryButton } from "./StateView";
import { useClipboardCopy } from "./useClipboardCopy";

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
  const [detailsExpanded, setDetailsExpanded] = useState(true);
  const { copied, copyText } = useClipboardCopy({ successMessage: frontendMessage("clipboard.copied") });
  const appPresentation = presentation === "app";
  const requiresPageReload = appPresentation && isDynamicModuleLoadError(error);
  const titleId = useId();
  const detailsId = useId();
  const Container = appPresentation ? "main" : "section";
  const Heading = appPresentation ? "h1" : "h2";
  const trace = error.stack || error.message;

  return (
    <Container
      className={cn(
        "flex w-full items-center justify-center bg-[var(--theme-bg)] px-6 py-8",
        appPresentation ? "min-h-dvh" : "h-full py-6",
      )}
      role="alert"
      aria-labelledby={titleId}
      aria-live="polite"
      data-error-boundary
      data-error-boundary-kind={requiresPageReload ? "reload" : "retry"}
    >
      <div className="senera-state-enter flex w-full max-w-[460px] flex-col items-start text-left">
        <Heading id={titleId} className="text-[14px] font-medium tracking-[-0.01em] text-content-primary">
          {frontendMessage("app.errorBoundary.title")}
        </Heading>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-content-secondary">
          {frontendMessage(
            requiresPageReload ? "app.errorBoundary.dynamicImportDescription" : "app.errorBoundary.description",
          )}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {requiresPageReload ? (
            <RetryButton
              onRetry={onReload ?? (() => globalThis.location?.reload())}
              label={frontendMessage("app.errorBoundary.reload")}
            />
          ) : (
            <RetryButton onRetry={onReset} label={frontendMessage("app.errorBoundary.retry")} />
          )}
          {appPresentation && !requiresPageReload ? (
            <button
              type="button"
              onClick={onReload ?? (() => globalThis.location?.reload())}
              className="inline-flex h-8 shrink-0 cursor-pointer items-center justify-center rounded-full px-3 text-[12.5px] font-medium leading-none text-content-muted transition-colors duration-150 ease-out hover:bg-ink-900/[0.05] hover:text-content-primary active:scale-[0.97]"
            >
              {frontendMessage("app.errorBoundary.reload")}
            </button>
          ) : null}
        </div>
        {trace ? (
          <div className="mt-3.5 w-full">
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-expanded={detailsExpanded}
                aria-controls={detailsId}
                onClick={() => setDetailsExpanded((prev) => !prev)}
                className="group inline-flex cursor-pointer items-center gap-1.5 text-[11.5px] text-content-muted transition-colors hover:text-content-secondary"
              >
                <AppIcon
                  icon="chevron-right"
                  size={12}
                  aria-hidden="true"
                  className={cn("transition-transform duration-150 ease-out", detailsExpanded && "rotate-90")}
                />
                <span>
                  {frontendMessage(detailsExpanded ? "app.errorBoundary.hideDetails" : "app.errorBoundary.details")}
                </span>
              </button>
              <button
                type="button"
                onClick={() => void copyText(trace)}
                aria-label={frontendMessage("app.errorBoundary.copyDetails")}
                title={frontendMessage("app.errorBoundary.copyDetails")}
                className="grid h-5 w-5 shrink-0 cursor-pointer place-items-center rounded text-content-muted transition-colors hover:bg-ink-900/[0.05] hover:text-content-primary active:scale-[0.94]"
              >
                <span className="t-icon-swap h-3 w-3" data-state={copied ? "b" : "a"} aria-hidden="true">
                  <AppIcon icon="copy" size={12} className="t-icon" data-icon="a" />
                  <AppIcon icon="checkmark" size={12} className="t-icon" data-icon="b" />
                </span>
              </button>
            </div>
            {detailsExpanded ? (
              <div
                id={detailsId}
                className="mt-2 max-h-36 w-full overflow-x-auto overflow-y-auto rounded border border-line-subtle/80 bg-surface-subtle/35 p-2.5 font-mono text-[10.5px] leading-relaxed text-content-muted select-all"
              >
                <pre className="font-mono whitespace-pre-wrap break-all">{trace}</pre>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </Container>
  );
}

function isDynamicModuleLoadError(error: Error): boolean {
  return /failed to fetch dynamically imported module|importing a module script failed|dynamically imported module/i.test(
    error.message,
  );
}
