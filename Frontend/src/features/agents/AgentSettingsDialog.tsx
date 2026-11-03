import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { WorkspaceAgent, WorkspaceAgentInput } from "../../../../Source/AgentSystem/Core/AgentDirectoryContract";
import { WorkspaceAgentInputSchema } from "../../../../Source/AgentSystem/Core/AgentDirectoryContract";
import {
  AppIcon,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  FormField,
  FormLabel,
  FormHint,
  Input,
  MenuSelect,
  ScrollArea,
  Switch,
} from "../../shared/ui";
import {
  AgentPromptPresetDirectoryPath,
  AgentPromptPresetFileExtension,
} from "../../../../Source/AgentSystem/Core/AgentPromptPresetContract";
import { listWorkspaceEntries, WorkspaceResourceClientError } from "../../api/workspaceResourceClient";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { frontendFeatureMessage as t } from "../../i18n/frontendFeatureMessageCatalog";
import { useStore } from "../../store/sessionStore";
import { useWorkspaceResourceController } from "../../shared/workspace/WorkspaceResourceProvider";
import { saveProfileAvatar } from "../../api/profileAvatarClient";
import { ProfileIdentityAvatar } from "../session/ProfileAvatar";
import { readChatModelProviders } from "../chat/modelProvider";
import { ModelSelect, modelSelectOption } from "../../shared/models/ModelSelect";
import { AvatarCropDialog } from "../../shared/media/AvatarCropDialog";
import { readAvatarCrop, dataUrlToFile, type AvatarCropState } from "../../shared/media/useAvatarCrop";
import { useAgentDirectory } from "./AgentDirectoryProvider";

export function AgentSettingsDialog({
  open,
  onOpenChange,
  initialId,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  initialId: string;
}): JSX.Element {
  const { directory } = useAgentDirectory();
  const [selectedId, setSelectedId] = useState(initialId);
  const [formKey, setFormKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const agent = directory?.agents.find((entry) => entry.id === selectedId);
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) onOpenChange(value);
      }}
    >
      <DialogContent
        title={t("agents.manage")}
        description={t("agents.manageDescription")}
        className="max-w-xl"
        bodyClassName="min-h-0"
      >
        <div className="flex items-center gap-2 px-6 pb-4">
          <MenuSelect
            disabled={busy}
            value={selectedId}
            placeholder={t("agents.create")}
            options={directory?.agents.map((entry) => ({ value: entry.id, label: entry.name })) ?? []}
            onChange={(id) => {
              setSelectedId(id);
              setFormKey((key) => key + 1);
            }}
          />
          <Button
            disabled={busy}
            variant="outline"
            size="sm"
            onClick={() => {
              setSelectedId("");
              setFormKey((key) => key + 1);
            }}
          >
            <AppIcon icon="plus" size={15} />
            {t("agents.create")}
          </Button>
        </div>
        <ScrollArea viewportClassName="max-h-[65vh]">
          <AgentForm
            key={`${selectedId}:${formKey}`}
            agent={agent}
            busy={busy}
            setBusy={setBusy}
            onSaved={(id) => {
              setSelectedId(id);
              setFormKey((key) => key + 1);
            }}
          />
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function AgentForm({
  agent,
  onSaved,
  busy,
  setBusy,
}: {
  agent?: WorkspaceAgent;
  onSaved(id: string): void;
  busy: boolean;
  setBusy(value: boolean): void;
}): JSX.Element {
  const { directory, controller } = useAgentDirectory();
  const resources = useWorkspaceResourceController();
  const models = useStore((state) => state.modelProviders);
  const revision = useRef(directory?.revision);
  const [draft, setDraft] = useState<WorkspaceAgentInput>(() => ({
    name: agent?.name ?? "",
    avatarPath: agent?.avatarPath ?? null,
    enabled: agent?.enabled ?? true,
    modelProviderId: agent?.modelProviderId ?? null,
    presetPath: agent?.presetPath ?? null,
    presetEnabled: agent?.presetEnabled ?? false,
  }));
  const [error, setError] = useState<string>();
  const [avatarCrop, setAvatarCrop] = useState<AvatarCropState | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [presets, setPresets] = useState<string[]>([]);
  const [presetError, setPresetError] = useState<string>();
  const [loadingPresets, setLoadingPresets] = useState(true);
  const deleting = Boolean(agent && directory?.deletingAgentIds.includes(agent.id));
  const upload = useRef<HTMLInputElement>(null);
  const patch = (values: Partial<WorkspaceAgentInput>) => setDraft((value) => ({ ...value, ...values }));
  useEffect(() => {
    if (!resources) return;
    const cancellation = new AbortController();
    async function read(path: string): Promise<string[]> {
      const entries = await listWorkspaceEntries(resources!.httpBaseUrl, path, { signal: cancellation.signal });
      const nested = await Promise.all(
        entries.filter((entry) => entry.kind === "directory").map((entry) => read(entry.path)),
      );
      return [
        ...entries
          .filter(
            (entry) => entry.kind !== "directory" && entry.path.toLowerCase().endsWith(AgentPromptPresetFileExtension),
          )
          .map((entry) => entry.path),
        ...nested.flat(),
      ];
    }
    void read(AgentPromptPresetDirectoryPath)
      .then((paths) => {
        if (!cancellation.signal.aborted) setPresets(paths.sort());
      })
      .catch((reason: unknown) => {
        if (!cancellation.signal.aborted && !(reason instanceof WorkspaceResourceClientError && reason.status === 404))
          setPresetError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!cancellation.signal.aborted) setLoadingPresets(false);
      });
    return () => cancellation.abort();
  }, [resources]);
  async function remove() {
    if (!agent || !controller || !directory || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const snapshot = await controller.execute({ type: "agent.delete", revision: directory.revision, id: agent.id });
      setConfirmDelete(false);
      toast.success(t("agents.deleted"));
      onSaved(snapshot.defaultAgentId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!controller || revision.current === undefined || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const input = WorkspaceAgentInputSchema.parse(draft);
      const snapshot = await controller.execute(
        agent
          ? { type: "agent.update", revision: revision.current, id: agent.id, agent: input }
          : { type: "agent.create", revision: revision.current, agent: input },
      );
      const id = agent?.id ?? snapshot.agents.at(-1)!.id;
      toast.success(t("agents.saved"));
      onSaved(id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid gap-5 px-6 pb-6">
      <div className="flex items-center gap-3">
        <ProfileIdentityAvatar
          identity={{ name: draft.name, avatarPath: draft.avatarPath, avatarDataUrl: null }}
          kind="assistant"
        />
        <Button
          variant="ghost"
          size="sm"
          disabled={busy || deleting || !resources}
          onClick={() => upload.current?.click()}
        >
          {t("agents.avatar")}
        </Button>
        {draft.avatarPath ? (
          <Button variant="ghost" size="sm" disabled={busy || deleting} onClick={() => patch({ avatarPath: null })}>
            {t("agents.resetAvatar")}
          </Button>
        ) : null}
        <input
          ref={upload}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file || !resources) return;
            setBusy(true);
            setError(undefined);
            void readAvatarCrop(file)
              .then(setAvatarCrop)
              .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
              .finally(() => setBusy(false));
          }}
        />
      </div>
      <FormField>
        <FormLabel>{t("agents.name")}</FormLabel>
        <Input
          disabled={busy || deleting}
          aria-label={t("agents.name")}
          value={draft.name}
          maxLength={48}
          onChange={(event) => patch({ name: event.target.value })}
        />
      </FormField>
      <FormField>
        <FormLabel>{t("agents.model")}</FormLabel>
        <ModelSelect
          disabled={busy || deleting}
          value={draft.modelProviderId ?? ""}
          placeholder={t("agents.inheritModel")}
          options={[
            { value: "", label: t("agents.inheritModel") },
            ...readChatModelProviders(models).map(modelSelectOption),
          ]}
          onChange={(modelProviderId) => patch({ modelProviderId: modelProviderId || null })}
        />
      </FormField>
      <FormField>
        <FormLabel>{t("agents.preset")}</FormLabel>
        <MenuSelect
          ariaLabel={t("agents.preset")}
          disabled={busy || deleting || loadingPresets}
          value={draft.presetPath ?? ""}
          placeholder={t("agents.noPreset")}
          options={[
            { value: "", label: t("agents.noPreset") },
            ...presets.map((path) => ({ value: path, label: path.slice(AgentPromptPresetDirectoryPath.length + 1) })),
          ]}
          onChange={(path) => patch({ presetPath: path || null, ...(!path ? { presetEnabled: false } : {}) })}
        />
        <FormHint>{t("agents.presetHint")}</FormHint>
        {presetError ? (
          <p role="alert" className="text-xs text-brick-600">
            {presetError}
          </p>
        ) : null}
      </FormField>
      <div className="flex items-center justify-between text-sm">
        <span>{t("agents.presetEnabled")}</span>
        <Switch
          ariaLabel={t("agents.presetEnabled")}
          checked={draft.presetEnabled}
          disabled={!draft.presetPath || busy || deleting}
          onCheckedChange={(presetEnabled) => patch({ presetEnabled })}
        />
      </div>
      <div className="flex items-center justify-between text-sm">
        <span>{t("agents.enabled")}</span>
        <Switch
          ariaLabel={t("agents.enabled")}
          checked={draft.enabled}
          disabled={busy || deleting || agent?.id === directory?.defaultAgentId}
          onCheckedChange={(enabled) => patch({ enabled })}
        />
      </div>
      <FormHint>{t("agents.sessionHint")}</FormHint>
      {error ? (
        <p role="alert" className="text-xs text-brick-600">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2 border-t border-line-subtle pt-4">
        {agent && agent.id !== directory?.defaultAgentId ? (
          <Button
            variant="ghost"
            size="sm"
            className="mr-auto text-brick-600"
            disabled={busy}
            onClick={() => setConfirmDelete(true)}
          >
            {t("agents.delete")}
          </Button>
        ) : null}
        {agent && agent.id !== directory?.defaultAgentId ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy || !agent.enabled}
            onClick={() => {
              if (!controller || !directory) return;
              setBusy(true);
              void controller
                .execute({ type: "agent.default", revision: directory.revision, id: agent.id })
                .then(() => onSaved(agent.id))
                .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
                .finally(() => setBusy(false));
            }}
          >
            {t("agents.setDefault")}
          </Button>
        ) : null}
        <Button size="sm" loading={busy} disabled={deleting || !draft.name.trim()} onClick={() => void save()}>
          {t("agents.save")}
        </Button>
      </div>
      {avatarCrop ? (
        <AvatarCropDialog
          initialCrop={avatarCrop}
          onCancel={() => setAvatarCrop(null)}
          onApply={async (dataUrl) => {
            if (!resources) throw new Error(frontendMessage("upload.failed"));
            setBusy(true);
            try {
              const avatarPath = await saveProfileAvatar(
                resources.httpBaseUrl,
                "assistant",
                dataUrlToFile(dataUrl, "agent-avatar.webp"),
                resources.csrfToken,
              );
              patch({ avatarPath });
              setAvatarCrop(null);
            } finally {
              setBusy(false);
            }
          }}
        />
      ) : null}
      <Dialog
        open={confirmDelete}
        onOpenChange={(value) => {
          if (!busy) setConfirmDelete(value);
        }}
      >
        <DialogContent
          title={t("agents.deleteTitle", { name: agent?.name ?? "" })}
          description={t("agents.deleteDescription")}
          className="max-w-md"
          bodyClassName="px-6 pb-6"
          onEscapeKeyDown={(event) => {
            if (busy) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (busy) event.preventDefault();
          }}
          footer={
            <DialogActions>
              <Button variant="ghost" disabled={busy} onClick={() => setConfirmDelete(false)}>
                {frontendMessage("ui.cancel")}
              </Button>
              <Button variant="destructive" loading={busy} onClick={() => void remove()}>
                {t("agents.deleteConfirm")}
              </Button>
            </DialogActions>
          }
        >
          <p className="text-sm leading-6 text-content-secondary">{t("agents.deleteRisk")}</p>
          {error ? (
            <p role="alert" className="mt-3 text-xs text-brick-600">
              {error}
            </p>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
