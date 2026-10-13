import { useEffect, useState } from "react";
import { buildHttpApiUrl } from "../../../api/httpApiUrl";
import { formatFileSize } from "../../../lib/util";
import { frontendMessage } from "../../../i18n/frontendMessageCatalog";
import { IconButton, AppIcon, InlineError, StateView } from "../../../shared/ui";
import { useWorkspaceResourceController } from "../../../shared/workspace/WorkspaceResourceProvider";
import {
  AgentApplicationHttpRoutes,
  AgentApplicationStorageSnapshotSchema,
  type AgentApplicationStorageSnapshot,
} from "../../../../../Source/AgentSystem/WorkspaceResources/AgentApplicationStorageContract";

export function StorageSettings(): JSX.Element {
  const controller = useWorkspaceResourceController();
  const httpBaseUrl = controller?.httpBaseUrl;
  const [snapshot, setSnapshot] = useState<AgentApplicationStorageSnapshot>();
  const [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!httpBaseUrl) return;
    const abort = new AbortController();
    setError(undefined);
    void fetch(buildHttpApiUrl(httpBaseUrl, AgentApplicationHttpRoutes.Storage), {
      credentials: "include",
      signal: abort.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`${frontendMessage("settings.storage.loadFailed")} (${response.status})`);
        const value = AgentApplicationStorageSnapshotSchema.parse(await response.json());
        if (!abort.signal.aborted) setSnapshot(value);
      })
      .catch((failure: unknown) => {
        if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure));
      });
    return () => abort.abort();
  }, [httpBaseUrl, revision]);
  if (error) return <InlineError onRetry={() => setRevision((value) => value + 1)}>{error}</InlineError>;
  if (!snapshot) return <StateView status="loading" />;
  return (
    <div className="mx-auto w-full max-w-[900px] px-5 pt-6 sm:px-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-content-strong">{frontendMessage("settings.storage.location")}</span>
        <IconButton
          label={frontendMessage("settings.storage.refresh")}
          onClick={() => setRevision((value) => value + 1)}
        >
          <AppIcon icon="refresh" />
        </IconButton>
      </div>
      <p className="break-all text-sm text-content-muted">{snapshot.root}</p>
      <div className="mt-4 flex justify-between border-b border-line pb-3 text-sm">
        <span>{frontendMessage("settings.storage.total")}</span>
        <span className="tabular-nums">{formatFileSize(snapshot.bytes)}</span>
      </div>
      {snapshot.workspaces.map((workspace) => (
        <div key={workspace.id} className="flex items-center justify-between gap-4 py-2 text-sm">
          <span className="min-w-0 truncate" title={workspace.root}>
            {workspace.name}
          </span>
          <span className="shrink-0 tabular-nums text-content-muted">{formatFileSize(workspace.bytes)}</span>
        </div>
      ))}
    </div>
  );
}
