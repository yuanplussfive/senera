import { useEffect, useState } from "react";
import { buildHttpApiUrl } from "../../../api/httpApiUrl";
import { formatFileSize } from "../../../lib/util";
import { frontendMessage } from "../../../i18n/frontendMessageCatalog";
import { Button, IconButton, AppIcon, InlineError, StateView } from "../../../shared/ui";
import { useWorkspaceResourceController } from "../../../shared/workspace/WorkspaceResourceProvider";
import {
  AgentApplicationHttpRoutes,
  AgentApplicationStorageScopes,
  AgentApplicationStorageMigrationSnapshotSchema,
  AgentApplicationStorageSnapshotSchema,
  type AgentApplicationStorageSnapshot,
  type AgentApplicationStorageMigrationSnapshot,
} from "../../../../../Source/AgentSystem/WorkspaceResources/AgentApplicationStorageContract";

export function StorageSettings(): JSX.Element {
  const controller = useWorkspaceResourceController();
  const httpBaseUrl = controller?.httpBaseUrl;
  const [snapshot, setSnapshot] = useState<AgentApplicationStorageSnapshot>();
  const [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0);
  const [includeProject, setIncludeProject] = useState(false);
  const [migrationSnapshot, setMigrationSnapshot] = useState<AgentApplicationStorageMigrationSnapshot>();
  const [migrationError, setMigrationError] = useState<string>();
  const [migrationRevision, setMigrationRevision] = useState(0);
  useEffect(() => {
    if (!httpBaseUrl) return;
    const abort = new AbortController();
    setError(undefined);
    const url = new URL(buildHttpApiUrl(httpBaseUrl, AgentApplicationHttpRoutes.Storage));
    if (includeProject) url.searchParams.set("scope", AgentApplicationStorageScopes.Project);
    void fetch(url, {
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
  }, [httpBaseUrl, includeProject, revision]);
  useEffect(() => {
    if (!httpBaseUrl) return;
    const abort = new AbortController();
    setMigrationError(undefined);
    void fetch(buildHttpApiUrl(httpBaseUrl, AgentApplicationHttpRoutes.StorageMigrations), {
      credentials: "include",
      signal: abort.signal,
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(`${frontendMessage("settings.storage.migrationsLoadFailed")} (${response.status})`);
        const value = AgentApplicationStorageMigrationSnapshotSchema.parse(await response.json());
        if (!abort.signal.aborted) setMigrationSnapshot(value);
      })
      .catch((failure: unknown) => {
        if (!abort.signal.aborted) setMigrationError(failure instanceof Error ? failure.message : String(failure));
      });
    return () => abort.abort();
  }, [httpBaseUrl, migrationRevision]);

  const removeMigrationBackup = async (workspaceId: string, backupId: string): Promise<void> => {
    if (!httpBaseUrl || !window.confirm(frontendMessage("settings.storage.migrationConfirm"))) return;
    const url = new URL(buildHttpApiUrl(httpBaseUrl, AgentApplicationHttpRoutes.StorageMigrations));
    url.searchParams.set("workspaceId", workspaceId);
    url.searchParams.set("backupId", backupId);
    const response = await fetch(url, {
      method: "DELETE",
      credentials: "include",
      headers: controller?.csrfToken ? { "X-Senera-Csrf": controller.csrfToken } : undefined,
    });
    if (!response.ok)
      throw new Error(`${frontendMessage("settings.storage.migrationCleanFailed")} (${response.status})`);
    setMigrationRevision((value) => value + 1);
  };
  if (error) return <InlineError onRetry={() => setRevision((value) => value + 1)}>{error}</InlineError>;
  if (!snapshot) return <StateView status="loading" />;
  return (
    <div className="mx-auto w-full max-w-[900px] px-5 pt-6 sm:px-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <span className="text-sm font-medium text-content-strong">
            {frontendMessage("settings.storage.location")}
          </span>
          <p className="mt-1 text-xs text-content-muted">{frontendMessage("settings.storage.runtimeScope")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setIncludeProject(true)} disabled={includeProject}>
            {frontendMessage("settings.storage.scanProject")}
          </Button>
          <IconButton
            label={frontendMessage("settings.storage.refresh")}
            onClick={() => setRevision((value) => value + 1)}
          >
            <AppIcon icon="refresh" />
          </IconButton>
        </div>
      </div>
      <div className="mt-3 text-xs text-content-muted">
        <span>{frontendMessage("settings.storage.stateRoot")}</span>
        <p className="mt-1 break-all text-sm">{snapshot.root}</p>
      </div>
      <div className="mt-4 flex justify-between border-b border-line pb-3 text-sm">
        <span>{frontendMessage("settings.storage.runtimeTotal")}</span>
        <span className="tabular-nums">{formatFileSize(snapshot.bytes)}</span>
      </div>
      {snapshot.workspaces.map((workspace) => (
        <div key={workspace.id} className="border-b border-line py-3 text-sm last:border-b-0">
          <div className="flex items-center justify-between gap-4">
            <span className="min-w-0 truncate" title={workspace.stateRoot}>
              {workspace.name}
            </span>
            <span className="shrink-0 tabular-nums text-content-muted">{formatFileSize(workspace.bytes)}</span>
          </div>
          {workspace.projectBytes !== undefined ? (
            <div className="mt-1 flex items-center justify-between gap-4 text-xs text-content-muted">
              <span title={workspace.root}>{frontendMessage("settings.storage.projectFiles")}</span>
              <span className="shrink-0 tabular-nums">{formatFileSize(workspace.projectBytes)}</span>
            </div>
          ) : null}
        </div>
      ))}
      <section className="mt-6 border-t border-line pt-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium text-content-strong">
              {frontendMessage("settings.storage.migrationsTitle")}
            </h3>
            <p className="mt-1 text-xs text-content-muted">
              {frontendMessage("settings.storage.migrationsDescription")}
            </p>
          </div>
        </div>
        {migrationError ? (
          <InlineError onRetry={() => setMigrationRevision((value) => value + 1)}>{migrationError}</InlineError>
        ) : null}
        {migrationSnapshot?.workspaces.map((workspace) => (
          <div key={workspace.id} className="mt-3 border-b border-line pb-3 last:border-b-0">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="truncate" title={workspace.root}>
                {workspace.name}
              </span>
              <span className="text-xs text-content-muted">
                {workspace.inventory.markerStatus === "invalid"
                  ? frontendMessage("settings.storage.migrationMarkerInvalid")
                  : frontendMessage("settings.storage.migrationBackupCount", {
                      count: workspace.inventory.backups.length,
                    })}
              </span>
            </div>
            {workspace.inventory.backups.map((backup) => (
              <div key={backup.id} className="mt-2 flex items-center justify-between gap-3 text-xs text-content-muted">
                <span className="min-w-0 truncate" title={backup.path}>
                  {backup.id} · {formatFileSize(backup.bytes)}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={workspace.inventory.markerStatus === "invalid"}
                  onClick={() =>
                    void removeMigrationBackup(workspace.id, backup.id).catch((failure: unknown) => {
                      setMigrationError(failure instanceof Error ? failure.message : String(failure));
                    })
                  }
                >
                  {frontendMessage("settings.storage.migrationClean")}
                </Button>
              </div>
            ))}
          </div>
        ))}
      </section>
    </div>
  );
}
