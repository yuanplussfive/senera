import { useEffect, useRef, useState } from "react";
import { Tooltip } from "../../../shared/ui/Tooltip";
import { buildHttpApiUrl } from "../../../api/httpApiUrl";
import type { WorkspaceControllerHandle } from "../../../app/useWorkspaceController";
import { formatDateTime, formatFileSize, formatInteger } from "../../../lib/util";
import { frontendMessage } from "../../../i18n/frontendMessageCatalog";
import { frontendFeatureMessage } from "../../../i18n/frontendFeatureMessageCatalog";
import { AppIcon, Button, IconButton, InlineError, Spinner, useClipboardCopy } from "../../../shared/ui";
import { MotionIconSwap } from "../../../shared/motion";
import { AgentToolPresentationIcon } from "../../../shared/workspace/AgentToolPresentationIcon";
import { useWorkspaceResourceController } from "../../../shared/workspace/WorkspaceResourceProvider";
import {
  AgentApplicationHttpRoutes,
  AgentApplicationStorageScopes,
  AgentApplicationStorageMigrationSnapshotSchema,
  AgentApplicationStorageSnapshotSchema,
  type AgentApplicationStorageScope,
  type AgentApplicationStorageSnapshot,
  type AgentApplicationStorageMigrationSnapshot,
} from "../../../../../Source/AgentSystem/WorkspaceResources/AgentApplicationStorageContract";

interface StorageRequest {
  readonly scope: AgentApplicationStorageScope;
  readonly workspaceId?: string;
  readonly revision: number;
}

const StorageSnapshotCacheLimit = 6;

const storageSnapshotCache = new Map<string, AgentApplicationStorageSnapshot>();

function storageSnapshotCacheKey(httpBaseUrl: string, request: Pick<StorageRequest, "scope" | "workspaceId">): string {
  return `${httpBaseUrl}\n${request.scope}\n${request.workspaceId ?? ""}`;
}

function writeStorageSnapshotCache(key: string, snapshot: AgentApplicationStorageSnapshot): void {
  storageSnapshotCache.delete(key);
  storageSnapshotCache.set(key, snapshot);
  while (storageSnapshotCache.size > StorageSnapshotCacheLimit) {
    const oldest = storageSnapshotCache.keys().next().value;
    if (oldest === undefined) break;
    storageSnapshotCache.delete(oldest);
  }
}

function PathCell({ path }: { path: string }): JSX.Element {
  const { copied, copyText } = useClipboardCopy({ successMessage: frontendMessage("settings.action.copied") });
  return (
    <span className="flex min-w-0 items-center gap-1">
      <Tooltip content={path}>
        <code className="min-w-0 truncate font-mono text-[10.5px] text-content-secondary">{path}</code>
      </Tooltip>
      <IconButton
        className="shrink-0"
        label={frontendMessage("settings.action.copyPath")}
        tooltip={copied ? frontendMessage("settings.action.copied") : frontendMessage("settings.action.copyPath")}
        size="sm"
        tone="muted"
        onClick={() => void copyText(path)}
      >
        <MotionIconSwap stateKey={copied ? "copied" : "copy"}>
          {copied ? (
            <AppIcon icon="check" size={13} className="text-accent-content" aria-hidden="true" />
          ) : (
            <AppIcon icon="copy" size={13} aria-hidden="true" />
          )}
        </MotionIconSwap>
      </IconButton>
    </span>
  );
}

export function StorageUsageTable({ workspace }: { workspace?: WorkspaceControllerHandle }): JSX.Element {
  const controller = useWorkspaceResourceController();
  const httpBaseUrl = controller?.httpBaseUrl;
  const currentWorkspaceId = workspace?.snapshot?.workspaceId;
  const [storageRequest, setStorageRequest] = useState<StorageRequest>({
    scope: AgentApplicationStorageScopes.Runtime,
    revision: 0,
  });
  // A refresh is a one-shot intent: consume it when the request effect runs so a later
  // dependency change cannot silently force another full workspace scan.
  const refreshNextReadRef = useRef(false);
  const cleanupRefreshTimerRef = useRef<number | undefined>(undefined);
  const [snapshot, setSnapshot] = useState<AgentApplicationStorageSnapshot | undefined>(() => {
    if (!httpBaseUrl) return undefined;
    const cached = storageSnapshotCache.get(
      storageSnapshotCacheKey(httpBaseUrl, {
        scope: AgentApplicationStorageScopes.Runtime,
      }),
    );
    if (!cached) return undefined;
    return !currentWorkspaceId || cached.workspaces.some((entry) => entry.id === currentWorkspaceId)
      ? cached
      : undefined;
  });
  const [storageError, setStorageError] = useState<string>();
  const [storageLoading, setStorageLoading] = useState(false);
  const [migrationSnapshot, setMigrationSnapshot] = useState<AgentApplicationStorageMigrationSnapshot>();
  const [migrationError, setMigrationError] = useState<string>();
  const [migrationRevision, setMigrationRevision] = useState(0);

  useEffect(() => {
    if (!httpBaseUrl) return;
    const refresh = refreshNextReadRef.current;
    refreshNextReadRef.current = false;
    const cacheKey = storageSnapshotCacheKey(httpBaseUrl, storageRequest);
    const cached = storageSnapshotCache.get(cacheKey);
    const cacheCoversCurrentWorkspace =
      !currentWorkspaceId || cached?.workspaces.some((entry) => entry.id === currentWorkspaceId);
    if (cached && cacheCoversCurrentWorkspace && storageRequest.revision === 0) {
      setSnapshot(cached);
      setStorageError(undefined);
      setStorageLoading(false);
    } else {
      if (storageRequest.revision === 0 && !cacheCoversCurrentWorkspace) setSnapshot(undefined);
      setStorageLoading(true);
    }
    const abort = new AbortController();
    const url = new URL(buildHttpApiUrl(httpBaseUrl, AgentApplicationHttpRoutes.Storage));
    url.searchParams.set("scope", storageRequest.scope);
    if (storageRequest.workspaceId) url.searchParams.set("workspaceId", storageRequest.workspaceId);
    if (refresh) url.searchParams.set("refresh", "1");
    void fetch(url, {
      credentials: "include",
      signal: abort.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`${frontendMessage("settings.storage.loadFailed")} (${response.status})`);
        const value = AgentApplicationStorageSnapshotSchema.parse(await response.json());
        if (!abort.signal.aborted) {
          setSnapshot(value);
          setStorageError(undefined);
          writeStorageSnapshotCache(cacheKey, value);
        }
      })
      .catch((failure: unknown) => {
        if (!abort.signal.aborted) setStorageError(failure instanceof Error ? failure.message : String(failure));
      })
      .finally(() => {
        if (!abort.signal.aborted) setStorageLoading(false);
      });
    return () => abort.abort();
  }, [currentWorkspaceId, httpBaseUrl, storageRequest]);

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

  useEffect(() => {
    return () => {
      if (cleanupRefreshTimerRef.current !== undefined) window.clearTimeout(cleanupRefreshTimerRef.current);
    };
  }, []);

  const requestStorage = (scope: AgentApplicationStorageScope, workspaceId?: string, refresh = false): void => {
    refreshNextReadRef.current = refresh;
    setStorageRequest((current) => ({ scope, workspaceId, revision: current.revision + 1 }));
  };

  // Cleaning backups one by one would otherwise force a full workspace scan per row.
  const scheduleUsageRefresh = (): void => {
    if (cleanupRefreshTimerRef.current !== undefined) window.clearTimeout(cleanupRefreshTimerRef.current);
    cleanupRefreshTimerRef.current = window.setTimeout(() => {
      cleanupRefreshTimerRef.current = undefined;
      requestStorage(AgentApplicationStorageScopes.Runtime, undefined, true);
    }, 400);
  };

  const refreshAll = (): void => {
    requestStorage(AgentApplicationStorageScopes.Runtime, undefined, true);
    setMigrationRevision((value) => value + 1);
    workspace?.refresh();
  };

  const inspectCurrentProject = (): void => {
    const workspaceId = workspace?.snapshot?.workspaceId;
    if (!workspaceId) return;
    requestStorage(AgentApplicationStorageScopes.Project, workspaceId);
  };

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
    scheduleUsageRefresh();
  };

  const backups = (migrationSnapshot?.workspaces ?? []).flatMap((entry) =>
    entry.inventory.backups.map((backup) => ({
      ...backup,
      workspaceId: entry.id,
      workspaceName: entry.name,
      markerInvalid: entry.inventory.markerStatus === "invalid",
    })),
  );
  const reclaimableBytes = backups.reduce((sum, backup) => sum + backup.bytes, 0);
  const totalRuntimeBytes = snapshot?.workspaces.reduce((sum, entry) => sum + entry.bytes, 0) ?? 0;
  const projectScanRunning = storageLoading && storageRequest.scope === AgentApplicationStorageScopes.Project;

  return (
    <div className="space-y-3" data-storage-usage>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-[13px] font-medium text-content-primary">{frontendMessage("settings.storage.title")}</h4>
          <p className="mt-0.5 text-[11px] text-content-muted">
            {snapshot?.measuredAt
              ? frontendMessage("settings.storage.measuredAt", { time: formatDateTime(snapshot.measuredAt) })
              : frontendMessage("settings.storage.measuring")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={inspectCurrentProject}
            disabled={!workspace?.snapshot?.workspaceId || projectScanRunning}
          >
            {projectScanRunning ? <Spinner size="sm" /> : <AgentToolPresentationIcon icon="scan-search" size={14} />}
            {frontendMessage("settings.storage.scanProject")}
          </Button>
          <IconButton
            label={frontendMessage("settings.storage.refresh")}
            tooltip={frontendMessage("settings.storage.refresh")}
            disabled={storageLoading}
            onClick={refreshAll}
          >
            {storageLoading ? <Spinner size="sm" /> : <AppIcon icon="refresh" />}
          </IconButton>
        </div>
      </div>

      {!httpBaseUrl ? (
        <p className="text-[11.5px] text-content-muted">
          {frontendFeatureMessage("settings.storage.connectionUnavailable")}
        </p>
      ) : null}
      {storageError ? (
        <InlineError onRetry={() => requestStorage(storageRequest.scope, storageRequest.workspaceId, true)}>
          {storageError}
        </InlineError>
      ) : null}
      {!snapshot && !storageError && httpBaseUrl ? (
        <div className="flex items-center gap-2 py-2 text-[11.5px] text-content-muted">
          <Spinner size="sm" />
          {frontendMessage("settings.storage.measuring")}
        </div>
      ) : null}

      {snapshot ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-[11.5px]">
            <thead>
              <tr className="border-b border-line-subtle text-left text-[10.5px] text-content-muted">
                <th className="py-2 pr-3 font-normal">{frontendMessage("settings.storage.location")}</th>
                <th className="py-2 pr-3 font-normal">{frontendMessage("settings.storage.path")}</th>
                <th className="py-2 pr-3 text-right font-normal">
                  <Tooltip content={frontendMessage("settings.storage.workspaceRuntimeIncludes")}>
                    <span>{frontendMessage("settings.storage.factBytes")}</span>
                  </Tooltip>
                </th>
                <th className="py-2 text-right font-normal">{frontendMessage("settings.storage.projectBytes")}</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-line-subtle align-top">
                <td className="py-2 pr-3">{frontendMessage("settings.storage.appData")}</td>
                <td className="py-2 pr-3">
                  <PathCell path={snapshot.root} />
                </td>
                <td className="py-2 pr-3 text-right tabular-nums text-content-primary">
                  {formatFileSize(snapshot.bytes)}
                </td>
                <td className="py-2 text-right text-content-muted">—</td>
              </tr>
              {snapshot.workspaces.map((entry) => (
                <tr key={entry.id} className="border-b border-line-subtle align-top">
                  <td className="py-2 pr-3">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-content-primary">{entry.name}</span>
                      {entry.id === currentWorkspaceId ? (
                        <span className="shrink-0 text-[10px] text-content-muted">
                          {frontendMessage("settings.storage.currentWorkspace")}
                        </span>
                      ) : null}
                    </span>
                  </td>
                  <td className="py-2 pr-3">
                    <PathCell path={entry.root} />
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums text-content-primary">
                    {formatFileSize(entry.bytes)}
                  </td>
                  <td className="py-2 text-right tabular-nums text-content-secondary">
                    {entry.projectBytes !== undefined ? formatFileSize(entry.projectBytes) : "—"}
                  </td>
                </tr>
              ))}
              <tr>
                <td className="py-2 pr-3 text-content-muted">{frontendMessage("settings.storage.totalLabel")}</td>
                <td className="py-2 pr-3 text-[10.5px] text-content-muted">
                  {frontendMessage("settings.storage.workspaceCount", {
                    count: formatInteger(snapshot.workspaces.length),
                  })}
                </td>
                <td className="py-2 pr-3 text-right font-semibold tabular-nums text-content-primary">
                  {formatFileSize(totalRuntimeBytes)}
                </td>
                <td className="py-2 text-right text-content-muted">—</td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : null}

      {migrationError || backups.length > 0 ? (
        <div className="space-y-2 border-t border-line-subtle pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h5 className="text-[12px] font-medium text-content-primary">
              {frontendMessage("settings.storage.migrationsTitle")}
            </h5>
            {backups.length > 0 ? (
              <span className="text-[10.5px] text-content-muted">
                {frontendMessage("settings.storage.factReclaimable")} {formatFileSize(reclaimableBytes)} ·{" "}
                {frontendMessage("settings.storage.factBackups")} {formatInteger(backups.length)}
              </span>
            ) : null}
          </div>
          {migrationError ? (
            <InlineError onRetry={() => setMigrationRevision((value) => value + 1)}>{migrationError}</InlineError>
          ) : null}
          {backups.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-[11.5px]">
                <thead>
                  <tr className="border-b border-line-subtle text-left text-[10.5px] text-content-muted">
                    <th className="py-2 pr-3 font-normal">{frontendMessage("settings.storage.location")}</th>
                    <th className="py-2 pr-3 font-normal">{frontendMessage("settings.storage.migrationPathLabel")}</th>
                    <th className="py-2 pr-3 text-right font-normal">
                      {frontendMessage("settings.storage.factBytes")}
                    </th>
                    <th className="py-2 text-right font-normal" />
                  </tr>
                </thead>
                <tbody>
                  {backups.map((backup) => (
                    <tr key={`${backup.workspaceId}:${backup.id}`} className="border-b border-line-subtle align-top">
                      <td className="py-2 pr-3">
                        <span className="block truncate text-content-primary">{backup.workspaceName}</span>
                        <span className="block text-[10px] text-content-muted">
                          {frontendMessage("settings.storage.migrationBackupAt", {
                            time: formatDateTime(backup.createdAt),
                          })}
                          {backup.markerInvalid ? (
                            <span className="ml-1 text-brick-500">
                              {frontendMessage("settings.storage.migrationMarkerInvalid")}
                            </span>
                          ) : null}
                        </span>
                      </td>
                      <td className="py-2 pr-3">
                        <PathCell path={backup.path} />
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-content-primary">
                        {formatFileSize(backup.bytes)}
                      </td>
                      <td className="py-2 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={backup.markerInvalid}
                          onClick={() => {
                            void removeMigrationBackup(backup.workspaceId, backup.id).catch((failure: unknown) => {
                              setMigrationError(failure instanceof Error ? failure.message : String(failure));
                            });
                          }}
                        >
                          {frontendMessage("settings.storage.migrationClean")}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
