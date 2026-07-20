import { AlertTriangle, LoaderCircle, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { Button, ErrorBoundary } from "../../shared/ui";
import { TerminalWindowFrame } from "./TerminalWindowFrame";

export interface TerminalPanelStatusProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: "loading" | "error";
  onRetry?: () => void;
}

export function TerminalPanelStatus(props: TerminalPanelStatusProps): JSX.Element {
  const failed = props.status === "error";
  return (
    <TerminalWindowFrame open={props.open} onOpenChange={props.onOpenChange}>
      <div
        className="grid h-full min-h-0 place-items-center bg-[var(--terminal-canvas)] px-6 text-center"
        role={failed ? "alert" : "status"}
      >
        <div className="flex max-w-sm flex-col items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-md border border-[var(--terminal-border)] bg-[var(--terminal-elevated)] text-[var(--terminal-accent)]">
            {failed ? (
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            ) : (
              <LoaderCircle className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
            )}
          </div>
          <div>
            <h2 className="text-[13px] font-medium text-[var(--terminal-foreground)]">
              {frontendMessage(failed ? "terminal.error.title" : "terminal.loading.title")}
            </h2>
            <p className="mt-1 text-[12px] leading-5 text-[var(--terminal-muted)]">
              {frontendMessage(failed ? "terminal.error.description" : "terminal.loading.description")}
            </p>
          </div>
          {failed && props.onRetry ? (
            <Button
              size="sm"
              variant="outline"
              onClick={props.onRetry}
              className="mt-1 border-[var(--terminal-border)] bg-[var(--terminal-elevated)] text-[var(--terminal-foreground)] hover:bg-white/[0.08]"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              {frontendMessage("terminal.error.retry")}
            </Button>
          ) : null}
        </div>
      </div>
    </TerminalWindowFrame>
  );
}

export function TerminalRuntimeBoundary(props: {
  children: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRetry: () => void;
  resetKey: unknown;
}): JSX.Element {
  return (
    <ErrorBoundary
      resetKey={props.resetKey}
      fallback={(_error, reset) => (
        <TerminalPanelStatus
          open={props.open}
          onOpenChange={props.onOpenChange}
          status="error"
          onRetry={() => {
            props.onRetry();
            reset();
          }}
        />
      )}
    >
      {props.children}
    </ErrorBoundary>
  );
}
