import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { toast } from "sonner";
import {
  createWorkspaceEntry,
  readWorkspaceResource,
  saveWorkspaceResource,
  WorkspaceResourceClientError,
  type WorkspaceResourceData,
  type WorkspaceTreeEntry,
} from "../../../api/workspaceResourceClient";
import { frontendMessage } from "../../../i18n/frontendMessageCatalog";
import {
  AppIcon,
  Button,
  IconButton,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Spinner,
  Switch,
} from "../../../shared/ui";
import {
  useWorkspaceResourceController,
  type WorkspaceResourceController,
} from "../../../shared/workspace/WorkspaceResourceProvider";
import { WorkspaceFileTree } from "../../../shared/workspace/WorkspaceFileTree";
import { WorkspaceSourceRuntime } from "../../../shared/workspace/WorkspaceSourceView";
import { WorkspaceTextSurface } from "../../../shared/workspace/WorkspaceTextSurface";
import {
  AgentPromptPresetFileExtension,
  AgentPromptPresetDirectoryPath,
  AgentPromptPresetManifestVersion,
  AgentPromptPresetStatePath,
  parseAgentPromptPresetManifest,
  type AgentPromptPresetManifest,
} from "../../../../../Source/AgentSystem/Core/AgentPromptPresetContract";

type PromptLoadState =
  | { readonly status: "loading" }
  | { readonly status: "empty" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly resource: WorkspaceResourceData };

const promptPresetSurfaceStyle = {
  "--surface-subtle": "var(--theme-config-stage-bg)",
  "--surface-muted": "var(--theme-config-header-bg)",
} as CSSProperties;

const promptPresetListSurfaceStyle = {
  "--surface-panel": "var(--theme-config-list-bg)",
  "--surface-selected": "var(--accent-surface)",
} as CSSProperties;

export function PromptPresetSection(): JSX.Element {
  const resources = useWorkspaceResourceController();
  if (!resources) {
    return (
      <div className="grid h-full min-h-[220px] place-items-center bg-surface-canvas px-6 text-sm text-content-muted">
        {frontendMessage("settings.prompt.unavailable")}
      </div>
    );
  }
  return <PromptPresetEditor resources={resources} />;
}

function PromptPresetEditor({ resources }: { resources: WorkspaceResourceController }): JSX.Element {
  const [activePath, setActivePath] = useState<string>();
  const [presetEnabled, setPresetEnabled] = useState(false);
  const [resource, setResource] = useState<WorkspaceResourceData>();
  const [draft, setDraft] = useState("");
  const [loadState, setLoadState] = useState<PromptLoadState>({ status: "loading" });
  const [revision, setRevision] = useState(0);
  const [editorRevision, setEditorRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saved">("idle");
  const [pendingPath, setPendingPath] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const [creatingFile, setCreatingFile] = useState(false);
  const [createError, setCreateError] = useState<string>();
  const [showFileBrowser, setShowFileBrowser] = useState(false);

  const dirty = resource?.content !== undefined && draft !== resource.content;
  const busy = saving || creatingFile || loadState.status === "loading";
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;

  const entryFilter = useCallback((entry: WorkspaceTreeEntry): boolean => {
    if (entry.kind === "directory") return !entry.name.startsWith(".");
    return entry.path.toLocaleLowerCase().endsWith(AgentPromptPresetFileExtension);
  }, []);

  const readPreset = useCallback(
    async (path: string): Promise<WorkspaceResourceData> => {
      const next = await readWorkspaceResource(resources.httpBaseUrl, path);
      if (next.content === undefined || !next.editable) {
        throw new Error(frontendMessage("settings.prompt.notEditable"));
      }
      return next;
    },
    [resources.httpBaseUrl],
  );

  const writeManifest = useCallback(
    async (manifest: AgentPromptPresetManifest): Promise<void> => {
      const content = JSON.stringify(manifest, null, 2);
      try {
        const current = await readWorkspaceResource(resources.httpBaseUrl, AgentPromptPresetStatePath);
        await saveWorkspaceResource(
          resources.httpBaseUrl,
          AgentPromptPresetStatePath,
          content,
          current.etag,
          resources.csrfToken,
        );
      } catch (reason) {
        if (!(reason instanceof WorkspaceResourceClientError) || reason.status !== 404) throw reason;
        await createWorkspaceEntry(
          resources.httpBaseUrl,
          AgentPromptPresetStatePath,
          "file",
          content,
          resources.csrfToken,
        );
      }
    },
    [resources.csrfToken, resources.httpBaseUrl],
  );

  const applyPreset = useCallback(
    async (path: string): Promise<void> => {
      setSaving(true);
      setLoadState({ status: "loading" });
      try {
        const next = await readPreset(path);
        await writeManifest({ version: AgentPromptPresetManifestVersion, activePath: path, enabled: true });
        setActivePath(path);
        setPresetEnabled(true);
        setResource(next);
        setDraft(next.content ?? "");
        setEditorRevision((value) => value + 1);
        setLoadState({ status: "ready", resource: next });
        setShowFileBrowser(false);
        setPendingPath(undefined);
        toast.success(frontendMessage("settings.prompt.saved"));
      } catch (reason) {
        setLoadState({ status: "error", message: reason instanceof Error ? reason.message : String(reason) });
        toast.error(reason instanceof Error ? reason.message : String(reason));
      } finally {
        setSaving(false);
      }
    },
    [readPreset, writeManifest],
  );

  const loadActivePreset = useCallback(async (): Promise<void> => {
    if (dirtyRef.current) return;
    setLoadState({ status: "loading" });
    let state: WorkspaceResourceData;
    try {
      state = await readWorkspaceResource(resources.httpBaseUrl, AgentPromptPresetStatePath);
    } catch (reason) {
      if (reason instanceof WorkspaceResourceClientError && reason.status === 404) {
        setActivePath(undefined);
        setPresetEnabled(false);
        setResource(undefined);
        setLoadState({ status: "empty" });
        setShowFileBrowser(true);
      } else {
        setLoadState({ status: "error", message: reason instanceof Error ? reason.message : String(reason) });
      }
      return;
    }
    const manifest = parseManifest(state.content);
    if (!manifest) {
      setActivePath(undefined);
      setPresetEnabled(false);
      setResource(undefined);
      setLoadState({ status: "error", message: frontendMessage("settings.prompt.invalidState") });
      setShowFileBrowser(true);
      return;
    }
    try {
      const next = await readPreset(manifest.activePath);
      setActivePath(manifest.activePath);
      setPresetEnabled(manifest.enabled);
      setResource(next);
      setDraft(next.content ?? "");
      setEditorRevision((value) => value + 1);
      setLoadState({ status: "ready", resource: next });
      setShowFileBrowser(false);
    } catch (reason) {
      setActivePath(manifest.activePath);
      setPresetEnabled(manifest.enabled);
      setResource(undefined);
      setLoadState({
        status: "error",
        message:
          reason instanceof WorkspaceResourceClientError && reason.status === 404
            ? frontendMessage("settings.prompt.missing")
            : reason instanceof Error
              ? reason.message
              : String(reason),
      });
      setShowFileBrowser(true);
    }
  }, [readPreset, resources.httpBaseUrl]);

  const togglePreset = useCallback(
    async (enabled: boolean): Promise<void> => {
      if (!activePath || saving || loadState.status === "loading") return;
      setSaving(true);
      try {
        await writeManifest({ version: AgentPromptPresetManifestVersion, activePath, enabled });
        setPresetEnabled(enabled);
        toast.success(frontendMessage(enabled ? "settings.prompt.enabled" : "settings.prompt.disabled"));
      } catch (reason) {
        toast.error(reason instanceof Error ? reason.message : frontendMessage("settings.prompt.toggleFailed"));
      } finally {
        setSaving(false);
      }
    },
    [activePath, loadState.status, saving, writeManifest],
  );

  useEffect(() => {
    void loadActivePreset();
  }, [loadActivePreset]);

  const selectPreset = useCallback(
    (path: string): void => {
      if (path === activePath) {
        setShowFileBrowser(false);
        return;
      }
      if (dirty) {
        setPendingPath(path);
        return;
      }
      void applyPreset(path);
    },
    [activePath, applyPreset, dirty],
  );

  const discardAndSwitch = useCallback((): void => {
    const nextPath = pendingPath;
    setPendingPath(undefined);
    if (!nextPath || !resource) return;
    setDraft(resource.content ?? "");
    setEditorRevision((value) => value + 1);
    void applyPreset(nextPath);
  }, [applyPreset, pendingPath, resource]);

  const save = useCallback(async (): Promise<void> => {
    if (!resource?.editable || !dirty || saving) return;
    setSaving(true);
    try {
      const saved = await saveWorkspaceResource(
        resources.httpBaseUrl,
        resource.path,
        draft,
        resource.etag,
        resources.csrfToken,
      );
      setResource(saved);
      setDraft(saved.content ?? draft);
      setLoadState({ status: "ready", resource: saved });
      setSaveState("saved");
      toast.success(frontendMessage("resource.saved"));
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : frontendMessage("resource.saveFailed"));
    } finally {
      setSaving(false);
    }
  }, [dirty, draft, resource, resources.csrfToken, resources.httpBaseUrl, saving]);

  useEffect(() => {
    if (saveState !== "saved") return;
    const timer = window.setTimeout(() => setSaveState("idle"), 1600);
    return () => window.clearTimeout(timer);
  }, [saveState]);

  const createPreset = useCallback(
    async (event: FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault();
      if (dirty || creatingFile) return;
      const name = normalizePromptPresetFileName(newFileName);
      if (!name) {
        setCreateError(frontendMessage("settings.prompt.invalidName"));
        return;
      }
      setCreatingFile(true);
      setCreateError(undefined);
      try {
        const entry = await createWorkspaceEntry(
          resources.httpBaseUrl,
          `${AgentPromptPresetDirectoryPath}/${name}`,
          "file",
          "",
          resources.csrfToken,
        );
        setNewFileName("");
        setCreating(false);
        setRevision((value) => value + 1);
        await applyPreset(entry.path);
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : String(reason);
        setCreateError(message);
        toast.error(message);
      } finally {
        setCreatingFile(false);
      }
    },
    [applyPreset, creatingFile, dirty, newFileName, resources.csrfToken, resources.httpBaseUrl],
  );

  const fileBrowser = (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--theme-config-stage-bg)]" data-prompt-file-browser>
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-line-subtle bg-[var(--theme-config-toolbar-bg)] px-4">
        <span className="text-[11px] font-medium text-content-secondary">
          {frontendMessage("settings.prompt.files")}
        </span>
        <div className="flex items-center gap-1">
          {busy ? <Spinner size="sm" className="text-content-muted" /> : null}
          <IconButton
            label={frontendMessage("settings.prompt.create")}
            tooltip={frontendMessage("settings.prompt.create")}
            size="sm"
            tone="primary"
            disabled={busy || dirty}
            onClick={() => {
              setCreating(true);
              setCreateError(undefined);
            }}
          >
            <AppIcon icon="plus" size={15} aria-hidden="true" />
          </IconButton>
        </div>
      </div>
      {creating ? (
        <form
          className="border-b border-line-subtle bg-[var(--theme-config-toolbar-bg)] p-2"
          onSubmit={(event) => void createPreset(event)}
        >
          <div className="mx-auto flex max-w-2xl items-center gap-1.5">
            <Input
              autoFocus
              size="sm"
              value={newFileName}
              disabled={creatingFile}
              onChange={(event) => {
                setNewFileName(event.target.value);
                setCreateError(undefined);
              }}
              placeholder={frontendMessage("settings.prompt.createPlaceholder")}
              aria-label={frontendMessage("settings.prompt.createPlaceholder")}
            />
            <IconButton
              label={frontendMessage("settings.prompt.createConfirm")}
              tooltip={frontendMessage("settings.prompt.createConfirm")}
              size="sm"
              tone="primary"
              disabled={creatingFile || !newFileName.trim()}
              type="submit"
            >
              <AppIcon icon="checkmark" size={14} aria-hidden="true" />
            </IconButton>
            <IconButton
              label={frontendMessage("settings.prompt.createCancel")}
              tooltip={frontendMessage("settings.prompt.createCancel")}
              size="sm"
              tone="muted"
              disabled={creatingFile}
              onClick={() => {
                setCreating(false);
                setNewFileName("");
                setCreateError(undefined);
              }}
            >
              <AppIcon icon="close" size={14} aria-hidden="true" />
            </IconButton>
          </div>
          {createError ? (
            <p className="mx-auto mt-1.5 max-w-2xl px-1 text-[11px] leading-4 text-danger">{createError}</p>
          ) : null}
        </form>
      ) : null}
      <div
        className="min-h-0 flex-1 overflow-hidden bg-[var(--theme-config-list-bg)]"
        style={promptPresetListSurfaceStyle}
      >
        <WorkspaceFileTree
          httpBaseUrl={resources.httpBaseUrl}
          rootPath={AgentPromptPresetDirectoryPath}
          missingRootBehavior="empty"
          activePath={activePath}
          entryFilter={entryFilter}
          emptyMessage={frontendMessage("settings.prompt.noFiles")}
          searchPlaceholder={frontendMessage("settings.prompt.search")}
          filesLabel={frontendMessage("settings.prompt.files")}
          initialExpansion="open"
          revision={revision}
          onSelect={selectPreset}
        />
      </div>
    </div>
  );

  return (
    <section
      className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--theme-config-stage-bg)] text-content-primary"
      data-prompt-preset
      style={promptPresetSurfaceStyle}
    >
      <header
        className="flex h-10 shrink-0 items-center justify-end gap-2 border-b border-line bg-[var(--theme-config-header-bg)] px-4 sm:px-5"
        role="toolbar"
        aria-label={frontendMessage("settings.prompt.title")}
      >
        <Popover>
          <PopoverTrigger asChild>
            <IconButton
              label={frontendMessage("settings.prompt.rules")}
              tooltip={frontendMessage("settings.prompt.rules")}
              size="sm"
              tone="muted"
            >
              <AppIcon icon="info" size={15} aria-hidden="true" />
            </IconButton>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-[min(24rem,calc(100vw-2rem))] space-y-3 text-xs leading-5"
            aria-label={frontendMessage("settings.prompt.rules")}
          >
            <div>
              <p className="font-medium text-content-primary">{frontendMessage("settings.prompt.identityVariables")}</p>
              <p className="mt-1 text-content-secondary">
                {frontendMessage("settings.prompt.identityVariablesDescription")}
              </p>
            </div>
            <dl className="space-y-2 text-content-secondary">
              <div>
                <dt className="font-mono text-content-primary">{"{{user}}"}</dt>
                <dd>{frontendMessage("settings.prompt.userIdentity")}</dd>
              </div>
              <div>
                <dt className="font-mono text-content-primary">{"{{assistant}}"}</dt>
                <dd>{frontendMessage("settings.prompt.assistantIdentity")}</dd>
              </div>
            </dl>
            <p className="border-t border-line-subtle pt-2 text-content-muted">
              {frontendMessage("settings.prompt.identityBoundaries")}
            </p>
          </PopoverContent>
        </Popover>
        {showFileBrowser ? (
          resource ? (
            <IconButton
              label={frontendMessage("settings.prompt.backToEditor")}
              tooltip={frontendMessage("settings.prompt.backToEditor")}
              size="sm"
              tone="muted"
              disabled={busy}
              onClick={() => setShowFileBrowser(false)}
            >
              <AppIcon icon="arrow-left" size={15} aria-hidden="true" />
            </IconButton>
          ) : null
        ) : (
          <IconButton
            label={frontendMessage("settings.prompt.browse")}
            tooltip={frontendMessage("settings.prompt.browse")}
            size="sm"
            tone="muted"
            disabled={busy || dirty}
            onClick={() => setShowFileBrowser(true)}
          >
            <AppIcon icon="folder" size={15} aria-hidden="true" />
          </IconButton>
        )}
        <div className="flex shrink-0 items-center gap-2" data-prompt-preset-toggle>
          <Switch
            checked={presetEnabled}
            disabled={!activePath || busy || loadState.status === "error"}
            ariaLabel={frontendMessage(presetEnabled ? "settings.prompt.disable" : "settings.prompt.enable")}
            onCheckedChange={(enabled) => void togglePreset(enabled)}
          />
        </div>
        {saveState === "saved" ? (
          <span className="text-[11px] text-content-muted">{frontendMessage("resource.savedState")}</span>
        ) : null}
        <IconButton
          label={frontendMessage("resource.reload")}
          tooltip={frontendMessage("resource.reload")}
          size="sm"
          tone="muted"
          disabled={busy || dirty}
          onClick={() => {
            setRevision((value) => value + 1);
            void loadActivePreset();
          }}
        >
          <AppIcon icon="refresh" size={15} aria-hidden="true" />
        </IconButton>
        <IconButton
          label={frontendMessage("resource.save")}
          tooltip={frontendMessage("resource.save")}
          size="sm"
          tone="primary"
          loading={saving}
          disabled={!dirty || !resource?.editable || loadState.status !== "ready"}
          onClick={() => void save()}
        >
          <AppIcon icon="checkmark" size={15} aria-hidden="true" />
        </IconButton>
      </header>

      {showFileBrowser ? (
        fileBrowser
      ) : (
        <main className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--theme-config-stage-bg)]">
          <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line-subtle bg-[var(--theme-config-toolbar-bg)] px-4">
            <AppIcon icon="file-code" size={15} className="text-content-muted" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-[11px] text-content-secondary" title={activePath}>
              {activePath ?? frontendMessage("settings.prompt.empty")}
            </span>
            {dirty ? (
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent-solid"
                aria-label={frontendMessage("resource.changed")}
              />
            ) : null}
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            {loadState.status === "ready" && resource?.content !== undefined ? (
              <PromptPresetSourceSurface
                key={`${resource.path}:${resource.etag}:${editorRevision}`}
                name={resource.name}
                cacheKey={`${resource.path}:${resource.etag}`}
                content={resource.content}
                onChange={setDraft}
              />
            ) : loadState.status === "loading" ? (
              <div className="grid h-full place-items-center bg-[var(--theme-config-stage-bg)] text-xs text-content-muted">
                <Spinner size="md" />
              </div>
            ) : loadState.status === "error" ? (
              <div
                role="alert"
                className="grid h-full place-items-center bg-[var(--theme-config-stage-bg)] px-6 text-center text-xs text-danger"
              >
                {loadState.message}
              </div>
            ) : (
              <div className="grid h-full place-items-center bg-[var(--theme-config-stage-bg)] px-6 text-center">
                <div className="max-w-sm">
                  <AppIcon icon="file-code" size={26} className="mx-auto text-content-muted" aria-hidden="true" />
                  <p className="mt-3 text-xs leading-5 text-content-muted">
                    {frontendMessage("settings.prompt.empty")}
                  </p>
                </div>
              </div>
            )}
          </div>
          {pendingPath ? (
            <div className="flex shrink-0 flex-wrap items-center gap-3 border-t border-line bg-[var(--theme-config-panel-bg)] px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-medium text-content-strong">
                  {frontendMessage("resource.unsavedTitle")}
                </p>
                <p className="text-[11px] text-content-muted">{frontendMessage("resource.unsavedDescription")}</p>
              </div>
              <Button type="button" size="sm" variant="ghost" onClick={() => setPendingPath(undefined)}>
                {frontendMessage("resource.keepEditing")}
              </Button>
              <Button type="button" size="sm" variant="destructive" onClick={discardAndSwitch}>
                {frontendMessage("resource.discard")}
              </Button>
            </div>
          ) : null}
        </main>
      )}
    </section>
  );
}

function PromptPresetSourceSurface({
  name,
  cacheKey,
  content,
  onChange,
}: {
  readonly name: string;
  readonly cacheKey: string;
  readonly content: string;
  readonly onChange: (value: string) => void;
}): JSX.Element {
  return (
    <WorkspaceSourceRuntime>
      <WorkspaceTextSurface
        name={name}
        cacheKey={cacheKey}
        editing
        view="source"
        content={content}
        onChange={onChange}
      />
    </WorkspaceSourceRuntime>
  );
}

function parseManifest(content: string | undefined): AgentPromptPresetManifest | undefined {
  if (!content) return undefined;
  try {
    const value: unknown = JSON.parse(content);
    const manifest = parseAgentPromptPresetManifest(value);
    if (!manifest) return undefined;
    const activePath = manifest.activePath.trim().replace(/\\/gu, "/");
    if (!activePath || activePath.startsWith("/") || /^[a-z]:/iu.test(activePath)) return undefined;
    const segments = activePath.split("/");
    if (segments.some((segment) => segment === ".." || segment.length === 0)) return undefined;
    if (!activePath.toLocaleLowerCase().endsWith(AgentPromptPresetFileExtension)) return undefined;
    if (!activePath.startsWith(`${AgentPromptPresetDirectoryPath}/`)) return undefined;
    return { version: AgentPromptPresetManifestVersion, activePath, enabled: manifest.enabled };
  } catch {
    return undefined;
  }
}

function normalizePromptPresetFileName(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith(".") || trimmed === "." || trimmed === "..") return undefined;
  if (trimmed.includes("/") || trimmed.includes("\\")) return undefined;
  const name = trimmed.toLocaleLowerCase().endsWith(AgentPromptPresetFileExtension)
    ? trimmed
    : `${trimmed}${AgentPromptPresetFileExtension}`;
  if (name === AgentPromptPresetFileExtension || name.length > 255) return undefined;
  return name;
}
