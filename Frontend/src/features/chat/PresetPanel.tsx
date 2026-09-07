import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, BookOpenText, Check } from "lucide-react";
import type {
  PersonaPresetCard,
  PresetItem,
  PresetMutationState,
  PresetWorldPackageDescriptor,
} from "../../api/eventTypes";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import { Dialog, DialogContent } from "../../shared/ui";
import { createPersonaPresetCard, normalizePersonaPresetCard, validatePersonaPresetCard } from "./presetPanelUtils";
import { PresetSidebar } from "./PresetSidebar";
import { PresetWorkspace } from "./PresetWorkspace";
import { ConfirmLayer, type PresetConfirmAction } from "./PresetOverlays";

export function PresetControl({
  open,
  onOpenChange,
  disabled,
  enabled,
  presets,
  worldPackages,
  activePresetName,
  operations,
  onRefresh,
  onSave,
  onDelete,
  onSetActive,
}: {
  open?: boolean;
  onOpenChange?: (value: boolean) => void;
  disabled: boolean;
  enabled: boolean;
  rootDir: string;
  presets: PresetItem[];
  worldPackages: PresetWorldPackageDescriptor[];
  activePresetName: string | null;
  operations: Record<string, PresetMutationState>;
  onRefresh: () => void;
  onSave: (input: { name: string; card: PersonaPresetCard; activate?: boolean }) => string | null;
  onDelete: (name: string) => string | null;
  onSetActive: (name: string | null) => string | null;
}): JSX.Element {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = open !== undefined && onOpenChange !== undefined;
  const dialogOpen = isControlled ? open : internalOpen;
  const handleOpenChange = onOpenChange ?? setInternalOpen;
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draft, setDraft] = useState<PersonaPresetCard>(() => createPersonaPresetCard());
  const [dirty, setDirty] = useState(false);
  const [saveRequestId, setSaveRequestId] = useState<string | null>(null);
  const [deleteRequestId, setDeleteRequestId] = useState<string | null>(null);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<PresetConfirmAction | null>(null);
  const [filterText, setFilterText] = useState("");

  const selected = useMemo(
    () => presets.find((preset) => preset.name === selectedName) ?? null,
    [presets, selectedName],
  );
  const activePreset = presets.find((preset) => preset.name === activePresetName) ?? null;
  const saveOperation = saveRequestId ? operations[saveRequestId] : undefined;
  const deleteOperation = deleteRequestId ? operations[deleteRequestId] : undefined;
  const activeOperation = activeRequestId ? operations[activeRequestId] : undefined;
  const busy =
    saveOperation?.status === "pending" ||
    deleteOperation?.status === "pending" ||
    activeOperation?.status === "pending";
  const selectedIsActive = Boolean(selected && selected.name === activePresetName);
  const diagnostics = [
    ...(selected?.diagnostics ?? []),
    ...(localError ? [{ severity: "error" as const, message: localError }] : []),
  ];
  const filteredPresets = useMemo(() => {
    const query = filterText.trim().toLocaleLowerCase();
    if (!query) return presets;
    return presets.filter((preset) => [preset.title, preset.name].join(" ").toLocaleLowerCase().includes(query));
  }, [filterText, presets]);

  useEffect(() => {
    if (!dialogOpen || selectedName || dirty) return;
    setSelectedName(activePresetName ?? presets[0]?.name ?? null);
  }, [activePresetName, dialogOpen, dirty, presets, selectedName]);

  useEffect(() => {
    if (!dialogOpen || !selected) return;
    setDraftName(selected.title);
    setDraft(normalizePersonaPresetCard(selected.card, selected.title));
    setDirty(false);
    setLocalError(null);
  }, [dialogOpen, selected]);

  useEffect(() => {
    if (!saveOperation) return;
    if (saveOperation.status === "pending") return;
    setSaveRequestId(null);
    if (saveOperation.status === "success") {
      setDirty(false);
      setLocalError(null);
      if (saveOperation.name) setSelectedName(saveOperation.name);
    } else {
      setLocalError(saveOperation.message ?? frontendMessage("preset.ui.updateFailed"));
    }
  }, [saveOperation]);

  useEffect(() => {
    if (deleteOperation && deleteOperation.status !== "pending") setDeleteRequestId(null);
    if (activeOperation && activeOperation.status !== "pending") setActiveRequestId(null);
  }, [activeOperation, deleteOperation]);

  const updateDraft = (next: PersonaPresetCard): void => {
    setDraft(next);
    setDirty(true);
    setLocalError(null);
  };

  const updateName = (name: string): void => {
    setDraftName(name);
    updateDraft({ ...draft, title: name });
  };

  const runAfterDiscardCheck = (action: () => void, description: string): void => {
    if (!dirty) {
      action();
      return;
    }
    setConfirmAction({
      title: frontendMessage("preset.ui.discardTitle"),
      description,
      confirmLabel: frontendMessage("preset.ui.discardConfirm"),
      tone: "danger",
      onConfirm: action,
    });
  };

  const createPreset = (): void => {
    runAfterDiscardCheck(() => {
      const title = frontendMessage("preset.ui.newTitle");
      setSelectedName(null);
      setDraftName(title);
      setDraft(createPersonaPresetCard(title));
      setDirty(true);
      setLocalError(null);
    }, frontendMessage("preset.ui.createClearWarning"));
  };

  const selectPreset = (name: string): void => {
    if (name === selectedName) return;
    runAfterDiscardCheck(() => setSelectedName(name), frontendMessage("preset.ui.switchReplaceWarning"));
  };

  const save = (activate: boolean): void => {
    const validationError = validatePersonaPresetCard(draft);
    if (validationError) {
      setLocalError(validationError);
      return;
    }
    const requestId = onSave({
      name: selected?.name ?? draftName.trim(),
      card: { ...draft, title: draftName.trim() },
      activate,
    });
    if (requestId) setSaveRequestId(requestId);
  };

  const removeSelected = (): void => {
    if (!selected) return;
    setConfirmAction({
      title: frontendMessage("preset.ui.deleteConfirmTitle"),
      description: selected.title,
      confirmLabel: frontendMessage("preset.ui.deleteConfirm"),
      tone: "danger",
      onConfirm: () => {
        const requestId = onDelete(selected.name);
        if (requestId) {
          setDeleteRequestId(requestId);
          setSelectedName(null);
        }
      },
    });
  };

  const toggleActive = (): void => {
    const requestId = onSetActive(selectedIsActive ? null : (selected?.name ?? null));
    if (requestId) setActiveRequestId(requestId);
  };

  return (
    <>
      {!isControlled ? (
        <button
          type="button"
          className={cn(
            "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[11px] text-ink-500 transition hover:bg-ink-900/[0.045] hover:text-ink-800",
            "focus:outline-none focus:ring-2 focus:ring-accent-focus disabled:pointer-events-none disabled:opacity-55",
          )}
          aria-label={frontendMessage("preset.ui.title")}
          disabled={disabled}
          onClick={() => setInternalOpen(true)}
        >
          <BookOpenText className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{frontendMessage("preset.ui.shortTitle")}</span>
          {activePreset ? <Check className="h-3 w-3 text-accent-content" /> : null}
          {presets.some((preset) => preset.diagnostics.length > 0) ? (
            <AlertTriangle className="h-3.5 w-3.5 text-umber-500" />
          ) : null}
        </button>
      ) : null}
      <Dialog open={dialogOpen} onOpenChange={handleOpenChange}>
        <DialogContent
          title={frontendMessage("preset.ui.title")}
          description={frontendMessage("preset.ui.dialogDescription")}
          motionPreset="focus"
          className="h-[min(760px,calc(100dvh_-_24px))] max-h-none w-[min(1120px,calc(100vw_-_24px))] max-w-none rounded-[10px] bg-paper-100 sm:w-[min(1120px,calc(100vw_-_48px))]"
          bodyClassName="flex min-h-0 flex-1 flex-col bg-paper-100"
        >
          {confirmAction ? (
            <ConfirmLayer
              action={confirmAction}
              onCancel={() => setConfirmAction(null)}
              onConfirm={() => {
                const action = confirmAction.onConfirm;
                setConfirmAction(null);
                action();
              }}
            />
          ) : null}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden sm:flex-row">
            <PresetSidebar
              activePreset={activePreset}
              busy={Boolean(busy)}
              enabled={enabled}
              filterText={filterText}
              presets={filteredPresets}
              selectedName={selectedName}
              onCreate={createPreset}
              onFilterTextChange={setFilterText}
              onRefresh={onRefresh}
              onSelect={selectPreset}
            />
            <PresetWorkspace
              busy={Boolean(busy)}
              deleting={deleteOperation?.status === "pending"}
              diagnostics={diagnostics}
              dirty={dirty}
              draft={draft}
              draftName={draftName}
              saving={saveOperation?.status === "pending"}
              selected={selected}
              selectedIsActive={selectedIsActive}
              settingActive={activeOperation?.status === "pending"}
              worldPackages={worldPackages}
              onDelete={removeSelected}
              onDraftChange={updateDraft}
              onNameChange={updateName}
              onSave={save}
              onToggleActive={toggleActive}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
