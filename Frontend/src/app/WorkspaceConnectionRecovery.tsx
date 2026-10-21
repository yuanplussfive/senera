import { useEffect, useState } from "react";
import type { AgentWorkspaceCatalogSnapshot } from "../../../Source/AgentSystem/WorkspaceResources/AgentWorkspaceCatalogContract";
import { readWorkspaceCatalog } from "../api/workspaceCatalogClient";
import { frontendMessage } from "../i18n/frontendMessageCatalog";
import { AppIcon, Button, StateView } from "../shared/ui";

export function WorkspaceConnectionRecovery({
  httpBaseUrl,
  onSelect,
}: {
  httpBaseUrl: string;
  onSelect: (workspaceId: string) => void;
}): JSX.Element {
  const [attempt, setAttempt] = useState(0);
  const [catalog, setCatalog] = useState<AgentWorkspaceCatalogSnapshot>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setFailed(false);
    setCatalog(undefined);
    void readWorkspaceCatalog(httpBaseUrl, controller.signal).then(
      (value) => {
        if (!controller.signal.aborted) setCatalog(value);
      },
      () => {
        if (!controller.signal.aborted) setFailed(true);
      },
    );
    return () => controller.abort();
  }, [attempt, httpBaseUrl]);

  return (
    <main className="grid h-dvh place-items-center bg-surface-canvas px-6 text-content-primary" data-workspace-recovery>
      <section className="w-full max-w-md">
        <h1 className="text-base font-medium">{frontendMessage("workspace.unavailableTitle")}</h1>
        <p className="mt-2 text-sm text-content-muted">{frontendMessage("workspace.unavailableDescription")}</p>
        {!catalog ? (
          <StateView
            status={failed ? "error" : "loading"}
            description={failed ? frontendMessage("workspace.catalogFailed") : undefined}
            onRetry={() => setAttempt((value) => value + 1)}
          />
        ) : (
          <div className="mt-5 max-h-[60dvh] space-y-1 overflow-y-auto overflow-x-hidden">
            {catalog.workspaces.map((workspace) => (
              <Button
                key={workspace.id}
                variant="ghost"
                className="h-auto w-full justify-start gap-3 py-3"
                onClick={() => onSelect(workspace.id)}
              >
                <AppIcon icon="folder" size={18} />
                <span className="min-w-0 flex-1 text-left">
                  <span className="block truncate">{workspace.name}</span>
                  <span className="block truncate text-xs text-content-muted" title={workspace.root}>
                    {workspace.root}
                  </span>
                </span>
                <AppIcon icon="arrow-right" size={16} />
              </Button>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
