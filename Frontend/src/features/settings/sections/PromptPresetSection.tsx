import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
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
import { AppIcon, Button, IconButton, Input, Spinner, Switch } from "../../../shared/ui";
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

export function PromptPresetSection(): JSX.Element {
  const resources = useWorkspaceResourceController();
  if (!resources) {
    return (
      <div className="grid h-full min-h-[220px] place-items-center bg-surface-canvas px-6 text-sm text-content-muted">
        {frontendMessage("settings.prompt.unavailable")}
      </div>
    );
  }
  return (
    <WorkspaceSourceRuntime>
      <PromptPresetEditor resources={resources} />
    </WorkspaceSourceRuntime>
  );
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

  const dirty = resource?.content !== undefined && draft !== resource.content;
  const busy = saving || creatingFile || loadState.status === "loading";
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;

  const entryFilter = useCallback((entry: WorkspaceTreeEntry): boolean => {
    const promptDirectoryPrefix = `${AgentPromptPresetDirectoryPath}/`;
    if (entry.path !== AgentPromptPresetDirectoryPath && !entry.path.startsWith(promptDirectoryPrefix)) return false;
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
      if (path === activePath) return;
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

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-surface-canvas" data-prompt-preset>
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-4 sm:px-5">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-accent-content/[0.08] text-accent-content">
          <AppIcon icon="file-text" size={16} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate text-[13px] font-semibold text-content-primary">
              {frontendMessage("settings.prompt.title")}
            </h1>
            <code className="truncate text-[10px] text-content-muted">{AgentPromptPresetDirectoryPath}/</code>
          </div>
        </div>
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

      <div className="grid min-h-0 flex-1 grid-rows-[minmax(12rem,38%)_minmax(0,1fr)] md:grid-cols-[minmax(210px,280px)_minmax(0,1fr)] md:grid-rows-1">
        <aside
          className="min-h-0 overflow-hidden border-b border-line md:border-b-0 md:border-r"
          aria-label={frontendMessage("settings.prompt.files")}
        >
          <div className="flex h-10 items-center justify-between border-b border-line-subtle px-3">
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
              className="border-b border-line-subtle bg-surface-subtle/50 p-2"
              onSubmit={(event) => void createPreset(event)}
            >
              <div className="flex items-center gap-1.5">
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
              {createError ? <p className="mt-1.5 px-1 text-[11px] leading-4 text-danger">{createError}</p> : null}
            </form>
          ) : null}
          <WorkspaceFileTree
            httpBaseUrl={resources.httpBaseUrl}
            activePath={activePath}
            entryFilter={entryFilter}
            emptyMessage={frontendMessage("settings.prompt.noFiles")}
            searchPlaceholder={frontendMessage("settings.prompt.search")}
            filesLabel={frontendMessage("settings.prompt.files")}
            initialExpansion="open"
            revision={revision}
            onSelect={selectPreset}
          />
        </aside>

        <main className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--theme-code-editor-bg)]">
          <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line-subtle px-4">
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
              <WorkspaceTextSurface
                key={`${resource.path}:${resource.etag}:${editorRevision}`}
                name={resource.name}
                cacheKey={`${resource.path}:${resource.etag}`}
                editing
                view="source"
                content={resource.content}
                onChange={setDraft}
              />
            ) : loadState.status === "loading" ? (
              <div className="grid h-full place-items-center text-xs text-content-muted">
                <Spinner size="md" />
              </div>
            ) : loadState.status === "error" ? (
              <div role="alert" className="grid h-full place-items-center px-6 text-center text-xs text-danger">
                {loadState.message}
              </div>
            ) : (
              <div className="grid h-full place-items-center px-6 text-center">
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
            <div className="flex shrink-0 flex-wrap items-center gap-3 border-t border-line bg-surface-panel px-4 py-2.5">
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
      </div>
    </section>
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
