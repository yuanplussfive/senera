import { useEffect, useState, type ReactNode } from "react";
import { buildHttpApiUrl } from "../../../api/httpApiUrl";
import type { WorkspaceControllerHandle } from "../../../app/useWorkspaceController";
import { formatDateTime, formatFileSize, formatInteger } from "../../../lib/util";
import { frontendMessage } from "../../../i18n/frontendMessageCatalog";
import { frontendFeatureMessage } from "../../../i18n/frontendFeatureMessageCatalog";
import {
  Button,
  IconButton,
  AppIcon,
  InlineError,
  SegmentedControl,
  SettingsControlRow,
  Spinner,
  StateView,
  useClipboardCopy,
} from "../../../shared/ui";
import { MotionIconSwap } from "../../../shared/motion";
import { AgentToolPresentationIcon } from "../../../shared/workspace/AgentToolPresentationIcon";
import { useWorkspaceResourceController } from "../../../shared/workspace/WorkspaceResourceProvider";
import { SettingsPanel } from "../SettingsPanel";
import {
  AgentApplicationHttpRoutes,
  AgentApplicationStorageScopes,
  AgentApplicationStorageMigrationSnapshotSchema,
  AgentApplicationStorageSnapshotSchema,
  type AgentApplicationStorageScope,
  type AgentApplicationStorageSnapshot,
  type AgentApplicationStorageMigrationSnapshot,
} from "../../../../../Source/AgentSystem/WorkspaceResources/AgentApplicationStorageContract";

type StorageView = "overview" | "configuration";

interface StorageRequest {
  readonly scope: AgentApplicationStorageScope;
  readonly workspaceId?: string;
  readonly revision: number;
}

type StorageWorkspaceEntry = AgentApplicationStorageSnapshot["workspaces"][number];

interface StorageFact {
  readonly label: string;
  readonly value: ReactNode;
  readonly title?: string;
}

function StorageFacts({ items }: { items: readonly StorageFact[] }): JSX.Element | null {
  if (items.length === 0) return null;
  return (
    <dl className="flex flex-wrap items-center text-[11px]">
      {items.map((item, index) => (
        <div
          key={item.label}
          title={item.title}
          className={
            index === 0
              ? "inline-flex items-baseline gap-1"
              : "ml-3 inline-flex items-baseline gap-1 border-l border-line pl-3"
          }
        >
          <dt className="text-[10px] text-content-muted">{item.label}</dt>
          <dd className="text-[11px] font-semibold tabular-nums text-content-primary">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function PathLine({ label, path }: { label: string; path: string }): JSX.Element {
  const copyLabel = frontendMessage("settings.action.copyPath");
  const copiedLabel = frontendMessage("settings.action.copied");
  const { copied, copyText } = useClipboardCopy({ successMessage: copiedLabel });
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="shrink-0 whitespace-nowrap text-[11px] text-content-muted">{label}</span>
      <code className="min-w-0 truncate font-mono text-[11.5px] text-content-secondary" title={path}>
        {path}
      </code>
      <IconButton
        className="shrink-0"
        label={copyLabel}
        tooltip={copied ? copiedLabel : copyLabel}
        size="sm"
        tone="muted"
        onClick={() => void copyText(path)}
      >
        <MotionIconSwap stateKey={copied ? "copied" : "copy"}>
          {copied ? (
            <AppIcon icon="check" size={14} className="text-accent-content" aria-hidden="true" />
          ) : (
            <AppIcon icon="copy" size={14} aria-hidden="true" />
          )}
        </MotionIconSwap>
      </IconButton>
    </div>
  );
}

function StorageCoverageNotice({
  coverage,
  unavailableEntryCount,
}: Pick<AgentApplicationStorageSnapshot, "coverage" | "unavailableEntryCount">): JSX.Element | null {
  if (coverage === "complete") return null;
  return (
    <p className="text-[11px] text-content-muted" data-storage-coverage="partial">
      {frontendMessage("settings.storage.partialUsage", { count: unavailableEntryCount })}
    </p>
  );
}

function ApplicationStatePanel({ snapshot }: { snapshot: AgentApplicationStorageSnapshot }): JSX.Element {
  return (
    <SettingsPanel
      title={frontendMessage("settings.storage.appData")}
      description={frontendFeatureMessage("settings.storage.appDataScope")}
      actions={
        <StorageFacts
          items={[{ label: frontendMessage("settings.storage.factBytes"), value: formatFileSize(snapshot.bytes) }]}
        />
      }
    >
      <div className="space-y-1.5 py-2">
        <PathLine label={frontendMessage("settings.storage.stateRoot")} path={snapshot.root} />
        <StorageCoverageNotice coverage={snapshot.coverage} unavailableEntryCount={snapshot.unavailableEntryCount} />
      </div>
    </SettingsPanel>
  );
}

function WorkspaceUsageRow({
  entry,
  isCurrent,
  configPath,
}: {
  entry: StorageWorkspaceEntry;
  isCurrent: boolean;
  configPath?: string;
}): JSX.Element {
  const facts: StorageFact[] = [
    {
      label: frontendMessage("settings.storage.workspaceRuntimeBytes"),
      value: formatFileSize(entry.bytes),
    },
  ];
  if (entry.projectBytes !== undefined) {
    facts.push({
      label: frontendMessage("settings.storage.projectBytes"),
      value: formatFileSize(entry.projectBytes),
      title: frontendMessage("settings.storage.projectFiles"),
    });
  }
  return (
    <SettingsControlRow
      className="items-start sm:items-start"
      label={
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate">{entry.name}</span>
          {isCurrent ? (
            <span className="shrink-0 rounded-md border border-accent-border bg-accent-surface px-1.5 text-[10.5px] font-medium text-accent-content">
              {frontendMessage("settings.storage.currentWorkspace")}
            </span>
          ) : null}
        </span>
      }
      description={
        <div className="space-y-1.5">
          <PathLine label={frontendMessage("settings.storage.workspaceRootLabel")} path={entry.root} />
          {isCurrent ? (
            <PathLine label={frontendMessage("settings.storage.workspaceStateRoot")} path={entry.stateRoot} />
          ) : null}
          {isCurrent && configPath ? (
            <PathLine label={frontendMessage("settings.workspace.configLabel")} path={configPath} />
          ) : null}
          <StorageCoverageNotice coverage={entry.coverage} unavailableEntryCount={entry.unavailableEntryCount} />
          {entry.projectBytes !== undefined ? (
            <StorageCoverageNotice
              coverage={entry.projectCoverage ?? "complete"}
              unavailableEntryCount={entry.projectUnavailableEntryCount ?? 0}
            />
          ) : null}
        </div>
      }
      control={<StorageFacts items={facts} />}
    />
  );
}

function WorkspaceUsagePanel({
  snapshot,
  currentWorkspaceId,
  configPath,
  projectScanAvailable,
  projectScanRunning,
  onInspectCurrentProject,
}: {
  snapshot: AgentApplicationStorageSnapshot;
  currentWorkspaceId?: string;
  configPath?: string;
  projectScanAvailable: boolean;
  projectScanRunning: boolean;
  onInspectCurrentProject: () => void;
}): JSX.Element {
  const totalRuntimeBytes = snapshot.workspaces.reduce((sum, entry) => sum + entry.bytes, 0);
  return (
    <SettingsPanel
      title={frontendMessage("settings.storage.workspaces")}
      description={frontendFeatureMessage("settings.storage.workspaceScope")}
      actions={
        <Button
          size="sm"
          variant="outline"
          onClick={onInspectCurrentProject}
          disabled={!projectScanAvailable || projectScanRunning}
        >
          {projectScanRunning ? <Spinner size="sm" /> : <AgentToolPresentationIcon icon="scan-search" size={14} />}
          {frontendMessage("settings.storage.scanProject")}
        </Button>
      }
    >
      {snapshot.workspaces.map((entry) => (
        <WorkspaceUsageRow
          key={entry.id}
          entry={entry}
          isCurrent={entry.id === currentWorkspaceId}
          configPath={configPath}
        />
      ))}
      <SettingsControlRow
        className="items-start sm:items-start"
        label={<span className="font-normal text-content-muted">{frontendMessage("settings.storage.totalLabel")}</span>}
        control={
          <StorageFacts
            items={[
              {
                label: frontendMessage("settings.storage.workspaces"),
                value: formatInteger(snapshot.workspaces.length),
              },
              {
                label: frontendMessage("settings.storage.workspaceRuntimeBytes"),
                value: formatFileSize(totalRuntimeBytes),
              },
            ]}
          />
        }
      />
    </SettingsPanel>
  );
}

function MigrationBackupPanel({
  snapshot,
  error,
  onRetry,
  onRemove,
}: {
  snapshot?: AgentApplicationStorageMigrationSnapshot;
  error?: string;
  onRetry: () => void;
  onRemove: (workspaceId: string, backupId: string) => void;
}): JSX.Element {
  const backups = (snapshot?.workspaces ?? []).flatMap((entry) =>
    entry.inventory.backups.map((backup) => ({
      ...backup,
      workspaceId: entry.id,
      workspaceName: entry.name,
      markerInvalid: entry.inventory.markerStatus === "invalid",
    })),
  );
  const reclaimableBytes = backups.reduce((sum, backup) => sum + backup.bytes, 0);
  return (
    <SettingsPanel
      title={frontendMessage("settings.storage.migrationsTitle")}
      description={frontendMessage("settings.storage.migrationsDescription")}
      actions={
        backups.length === 0 ? undefined : (
          <StorageFacts
            items={[
              {
                label: frontendMessage("settings.storage.factReclaimable"),
                value: formatFileSize(reclaimableBytes),
              },
              { label: frontendMessage("settings.storage.factBackups"), value: formatInteger(backups.length) },
            ]}
          />
        )
      }
    >
      {error ? <InlineError onRetry={onRetry}>{error}</InlineError> : null}
      {!error && snapshot && backups.length === 0 ? (
        <p className="py-3 text-[12px] text-content-muted">{frontendMessage("settings.storage.migrationEmpty")}</p>
      ) : null}
      {backups.map((backup) => (
        <SettingsControlRow
          key={`${backup.workspaceId}:${backup.id}`}
          className="items-start sm:items-start"
          label={<span className="min-w-0 truncate">{backup.workspaceName}</span>}
          description={
            <div className="space-y-1.5">
              <PathLine label={frontendMessage("settings.storage.migrationPathLabel")} path={backup.path} />
              <p className="flex flex-wrap items-center gap-x-2 text-[11px] text-content-muted">
                <span>
                  {frontendMessage("settings.storage.migrationBackupAt", {
                    time: formatDateTime(backup.createdAt),
                  })}
                </span>
                {backup.markerInvalid ? (
                  <span className="text-brick-500">{frontendMessage("settings.storage.migrationMarkerInvalid")}</span>
                ) : null}
              </p>
            </div>
          }
          controlClassName="items-center gap-3"
          control={
            <>
              <StorageFacts
                items={[{ label: frontendMessage("settings.storage.factBytes"), value: formatFileSize(backup.bytes) }]}
              />
              <Button
                size="sm"
                variant="outline"
                className="shrink-0"
                disabled={backup.markerInvalid}
                onClick={() => onRemove(backup.workspaceId, backup.id)}
              >
                {frontendMessage("settings.storage.migrationClean")}
              </Button>
            </>
          }
        />
      ))}
    </SettingsPanel>
  );
}

export function StorageSettings({
  workspace,
  configuration,
}: {
  workspace?: WorkspaceControllerHandle;
  configuration: ReactNode;
}): JSX.Element {
  const controller = useWorkspaceResourceController();
  const httpBaseUrl = controller?.httpBaseUrl;
  const [view, setView] = useState<StorageView>("overview");
  const [snapshot, setSnapshot] = useState<AgentApplicationStorageSnapshot>();
  const [storageError, setStorageError] = useState<string>();
  const [storageLoading, setStorageLoading] = useState(false);
  const [storageRequest, setStorageRequest] = useState<StorageRequest>({
    scope: AgentApplicationStorageScopes.Runtime,
    revision: 0,
  });
  const [migrationSnapshot, setMigrationSnapshot] = useState<AgentApplicationStorageMigrationSnapshot>();
  const [migrationError, setMigrationError] = useState<string>();
  const [migrationRevision, setMigrationRevision] = useState(0);

  useEffect(() => {
    if (!httpBaseUrl) return;
    const abort = new AbortController();
    setStorageLoading(true);
    const url = new URL(buildHttpApiUrl(httpBaseUrl, AgentApplicationHttpRoutes.Storage));
    url.searchParams.set("scope", storageRequest.scope);
    if (storageRequest.workspaceId) url.searchParams.set("workspaceId", storageRequest.workspaceId);
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
        }
      })
      .catch((failure: unknown) => {
        if (!abort.signal.aborted) setStorageError(failure instanceof Error ? failure.message : String(failure));
      })
      .finally(() => {
        if (!abort.signal.aborted) setStorageLoading(false);
      });
    return () => abort.abort();
  }, [httpBaseUrl, storageRequest]);

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

  const requestStorage = (scope: AgentApplicationStorageScope, workspaceId?: string): void => {
    setStorageRequest((current) => ({ scope, workspaceId, revision: current.revision + 1 }));
  };

  const refreshAll = (): void => {
    requestStorage(AgentApplicationStorageScopes.Runtime);
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
  };

  return (
    <section className="w-full" data-storage-settings>
      <div className="mx-auto flex w-full max-w-[900px] items-center justify-end gap-2 px-5 pt-5 sm:px-6">
        <SegmentedControl
          ariaLabel={frontendMessage("settings.section.storage.label")}
          value={view}
          options={[
            {
              value: "overview",
              label: frontendMessage("continuity.tab.overview"),
              icon: <AppIcon icon="stack" size={14} aria-hidden="true" />,
            },
            {
              value: "configuration",
              label: frontendMessage("settings.tools.viewConfiguration"),
              icon: <AppIcon icon="sliders" size={14} aria-hidden="true" />,
            },
          ]}
          onChange={setView}
        />
        {view === "overview" ? (
          <IconButton
            label={frontendMessage("settings.storage.refresh")}
            tooltip={frontendMessage("settings.storage.refresh")}
            disabled={storageLoading}
            onClick={refreshAll}
          >
            {storageLoading ? <Spinner size="sm" /> : <AppIcon icon="refresh" />}
          </IconButton>
        ) : null}
      </div>
      {view === "configuration" ? configuration : null}
      {view === "overview" ? (
        <StorageOverview
          workspace={workspace}
          httpBaseUrl={httpBaseUrl}
          snapshot={snapshot}
          storageError={storageError}
          storageLoading={storageLoading}
          projectScanActive={storageRequest.scope === AgentApplicationStorageScopes.Project}
          migrationSnapshot={migrationSnapshot}
          migrationError={migrationError}
          onInspectCurrentProject={inspectCurrentProject}
          onRetryStorage={() => requestStorage(storageRequest.scope, storageRequest.workspaceId)}
          onRetryMigrations={() => setMigrationRevision((value) => value + 1)}
          onRemoveMigrationBackup={(workspaceId, backupId) => {
            void removeMigrationBackup(workspaceId, backupId).catch((failure: unknown) => {
              setMigrationError(failure instanceof Error ? failure.message : String(failure));
            });
          }}
        />
      ) : null}
    </section>
  );
}

function StorageOverview({
  workspace,
  httpBaseUrl,
  snapshot,
  storageError,
  storageLoading,
  projectScanActive,
  migrationSnapshot,
  migrationError,
  onInspectCurrentProject,
  onRetryStorage,
  onRetryMigrations,
  onRemoveMigrationBackup,
}: {
  workspace?: WorkspaceControllerHandle;
  httpBaseUrl?: string;
  snapshot?: AgentApplicationStorageSnapshot;
  storageError?: string;
  storageLoading: boolean;
  projectScanActive: boolean;
  migrationSnapshot?: AgentApplicationStorageMigrationSnapshot;
  migrationError?: string;
  onInspectCurrentProject: () => void;
  onRetryStorage: () => void;
  onRetryMigrations: () => void;
  onRemoveMigrationBackup: (workspaceId: string, backupId: string) => void;
}): JSX.Element {
  if (!httpBaseUrl) {
    return <StateView status="error" description={frontendFeatureMessage("settings.storage.connectionUnavailable")} />;
  }
  if (!snapshot) {
    if (storageError) return <InlineError onRetry={onRetryStorage}>{storageError}</InlineError>;
    return <StateView status="loading" />;
  }

  return (
    <div className="mx-auto w-full max-w-[900px] px-5 pb-6 pt-4 sm:px-6">
      {storageError ? (
        <div className="mb-4">
          <InlineError onRetry={onRetryStorage}>{storageError}</InlineError>
        </div>
      ) : null}
      <ApplicationStatePanel snapshot={snapshot} />
      <WorkspaceUsagePanel
        snapshot={snapshot}
        currentWorkspaceId={workspace?.snapshot?.workspaceId}
        configPath={workspace?.snapshot?.configPath}
        projectScanAvailable={Boolean(workspace?.snapshot?.workspaceId)}
        projectScanRunning={storageLoading && projectScanActive}
        onInspectCurrentProject={onInspectCurrentProject}
      />
      <MigrationBackupPanel
        snapshot={migrationSnapshot}
        error={migrationError}
        onRetry={onRetryMigrations}
        onRemove={onRemoveMigrationBackup}
      />
    </div>
  );
}
