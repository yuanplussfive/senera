import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCcw, RotateCcw } from "lucide-react";
import { frontendMessage } from "../i18n/frontendMessageCatalog";
import { Button } from "../shared/ui/Button";

export interface AppErrorBoundaryProps {
  children: ReactNode;
  onError?: (error: Error, info: ErrorInfo) => void;
  reload?: () => void;
}

interface AppErrorBoundaryState {
  failed: boolean;
  resetKey: number;
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = {
    failed: false,
    resetKey: 0,
  };

  static getDerivedStateFromError(): Partial<AppErrorBoundaryState> {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  render(): ReactNode {
    if (!this.state.failed) {
      return <AppErrorBoundaryResetScope key={this.state.resetKey}>{this.props.children}</AppErrorBoundaryResetScope>;
    }

    return (
      <main className="flex min-h-screen items-center justify-center bg-paper-100 px-4 py-8 text-ink-900">
        <section
          aria-labelledby="app-error-boundary-title"
          className="w-full max-w-[520px] rounded-lg border border-ink-200 bg-paper-50 p-5 shadow-[0_18px_60px_rgba(24,27,31,0.12)]"
        >
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brick-50 text-brick-600">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h1 id="app-error-boundary-title" className="text-[16px] font-semibold leading-6 text-ink-950">
                {frontendMessage("app.errorBoundary.title")}
              </h1>
              <p className="mt-1 text-[13px] leading-5 text-ink-600">
                {frontendMessage("app.errorBoundary.description")}
              </p>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={this.reset}>
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              {frontendMessage("app.errorBoundary.retry")}
            </Button>
            <Button onClick={this.reload}>
              <RefreshCcw className="h-3.5 w-3.5" aria-hidden="true" />
              {frontendMessage("app.errorBoundary.reload")}
            </Button>
          </div>
        </section>
      </main>
    );
  }

  private readonly reset = (): void => {
    this.setState((state) => ({
      failed: false,
      resetKey: state.resetKey + 1,
    }));
  };

  private readonly reload = (): void => {
    const reload = this.props.reload ?? (() => globalThis.location?.reload());
    reload();
  };
}

function AppErrorBoundaryResetScope(props: { children: ReactNode }): JSX.Element {
  return <>{props.children}</>;
}
