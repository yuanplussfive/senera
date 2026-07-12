import { useEffect, useMemo, useState } from "react";
import type { FileRejection } from "react-dropzone";
import { AlertTriangle, BookUser } from "lucide-react";
import type { PresetFormat, PresetItem, PresetMutationState } from "../../api/eventTypes";
import { cn } from "../../lib/util";
import { useResponsiveMode } from "../../shared/responsive";
import { Dialog, DialogContent, FileDropZone, Tooltip, type FileDropZoneAccept } from "../../shared/ui";
import {
  describeRejectedImports,
  readPresetDisplayName,
  readPresetImportEntries,
  usePresetTokenCount,
  validateDraft,
  withPresetFormatExtension,
} from "./presetPanelUtils";
import { PresetSidebar } from "./PresetSidebar";
import { PresetInspector, PresetWorkspace } from "./PresetWorkspace";
import { ConfirmLayer, DropOverlay, type PresetConfirmAction } from "./PresetOverlays";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";

const PresetFileAccept = {
  "application/json": [".json"],
  "text/markdown": [".md"],
  "text/plain": [".md", ".txt"],
} satisfies FileDropZoneAccept;

type DraftPatch = Partial<{
  name: string;
  format: PresetFormat;
  content: string;
}>;

export function PresetControl({
  disabled,
  enabled,
  rootDir,
  presets,
  activePresetName,
  operations,
  onRefresh,
  onSave,
  onDelete,
  onSetActive,
}: {
  disabled: boolean;
  enabled: boolean;
  rootDir: string;
  presets: PresetItem[];
  activePresetName: string | null;
  operations: Record<string, PresetMutationState>;
  onRefresh: () => void;
  onSave: (input: { name: string; format: PresetFormat; content: string; activate?: boolean }) => string | null;
  onDelete: (name: string) => string | null;
  onSetActive: (name: string | null) => string | null;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftFormat, setDraftFormat] = useState<PresetFormat>("markdown");
  const [draftContent, setDraftContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saveRequestId, setSaveRequestId] = useState<string | null>(null);
  const [deleteRequestId, setDeleteRequestId] = useState<string | null>(null);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<PresetConfirmAction | null>(null);
  const [importing, setImporting] = useState(false);
  const [filterText, setFilterText] = useState("");
  const { viewport } = useResponsiveMode();
  const useThreePaneLayout = viewport === "desktop" || viewport === "wide";
  const tokenState = usePresetTokenCount(draftContent, open);

  const selected = useMemo(
    () => presets.find((preset) => preset.name === selectedName) ?? null,
    [presets, selectedName],
  );
  const activePreset = presets.find((preset) => preset.name === activePresetName) ?? null;
  const hasDiagnostics = presets.some((preset) => preset.diagnostics.length > 0);
  const saveOperation = saveRequestId ? operations[saveRequestId] : undefined;
  const deleteOperation = deleteRequestId ? operations[deleteRequestId] : undefined;
  const activeOperation = activeRequestId ? operations[activeRequestId] : undefined;
  const saving = saveOperation?.status === "pending";
  const deleting = deleteOperation?.status === "pending";
  const settingActive = activeOperation?.status === "pending";
  const busy = saving || deleting || settingActive || importing;
  const currentName = draftName.trim();
  const selectedIsActive = Boolean(selected && selected.name === activePresetName);
  const diagnostics = [
    ...(selected?.diagnostics ?? []),
    ...(localError ? [{ severity: "error" as const, message: localError }] : []),
  ];
  const filteredPresets = useMemo(() => {
    const query = filterText.trim().toLocaleLowerCase();
    if (!query) {
      return presets;
    }
    return presets.filter((preset) =>
      [
        preset.name,
        preset.title,
        readPresetDisplayName(preset.name),
        readPresetDisplayName(preset.title),
        preset.format,
      ]
        .join(" ")
        .toLocaleLowerCase()
        .includes(query),
    );
  }, [filterText, presets]);

  const replaceDraft = (next: { name: string; format: PresetFormat; content: string }): void => {
    setDraftName(next.name);
    setDraftFormat(next.format);
    setDraftContent(next.content);
  };

  const updateDraft = (patch: DraftPatch): void => {
    if (patch.name !== undefined) setDraftName(patch.name);
    if (patch.format !== undefined) setDraftFormat(patch.format);
    if (patch.content !== undefined) setDraftContent(patch.content);
    setDirty(true);
    setLocalError(null);
  };

  const changeDraftFormat = (format: PresetFormat): void => {
    updateDraft({
      format,
      name: withPresetFormatExtension(draftName, format),
    });
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

  const handleImportedFiles = (files: File[], rejections: FileRejection[]): void => {
    if (busy) return;
    const rejectedMessages = describeRejectedImports(rejections);
    if (files.length === 0) {
      setLocalError(rejectedMessages.join("\n") || frontendMessage("preset.ui.noImportableFiles"));
      return;
    }

    runAfterDiscardCheck(() => {
      void saveImportedFiles(files, rejectedMessages);
    }, frontendMessage("preset.ui.importReplaceWarning"));
  };

  useEffect(() => {
    if (!open) return;
    if (selectedName && presets.some((preset) => preset.name === selectedName)) return;
    if (selectedName === null && dirty) return;
    setSelectedName(activePresetName ?? presets[0]?.name ?? null);
  }, [activePresetName, dirty, open, presets, selectedName]);

  useEffect(() => {
    if (!open || !selected) return;
    replaceDraft({
      name: selected.name,
      format: selected.format,
      content: selected.content,
    });
    setDirty(false);
    setLocalError(null);
  }, [open, selected]);

  useEffect(() => {
    if (!saveOperation) return;
    if (saveOperation.status === "success") {
      setSaveRequestId(null);
      setDirty(false);
      setLocalError(null);
      if (saveOperation.name) {
        setSelectedName(saveOperation.name);
      }
      return;
    }
    if (saveOperation.status === "error") {
      setSaveRequestId(null);
      setLocalError(saveOperation.message ?? frontendMessage("preset.saveFailed"));
    }
  }, [saveOperation]);

  useEffect(() => {
    if (deleteOperation && deleteOperation.status !== "pending") {
      setDeleteRequestId(null);
    }
    if (activeOperation && activeOperation.status !== "pending") {
      setActiveRequestId(null);
    }
  }, [activeOperation, deleteOperation]);

  const selectPreset = (name: string): void => {
    if (name === selectedName) return;
    runAfterDiscardCheck(() => setSelectedName(name), frontendMessage("preset.ui.switchReplaceWarning"));
  };

  const createPreset = (): void => {
    runAfterDiscardCheck(() => {
      setSelectedName(null);
      replaceDraft({
        name: "roleplay-preset.md",
        format: "markdown",
        content: "",
      });
      setDirty(true);
      setLocalError(null);
    }, frontendMessage("preset.ui.createClearWarning"));
  };

  const save = (activate: boolean): void => {
    if (!currentName || saving || importing) return;
    const validationError = validateDraft(draftFormat, draftContent);
    if (validationError) {
      setLocalError(validationError);
      return;
    }

    const requestId = onSave({
      name: currentName,
      format: draftFormat,
      content: draftContent,
      activate,
    });
    if (requestId) {
      setSaveRequestId(requestId);
    }
  };

  const removeSelected = (): void => {
    if (!selected || deleting) return;
    setConfirmAction({
      title: frontendMessage("preset.ui.deleteTitle"),
      description: selected.name,
      confirmLabel: frontendMessage("preset.ui.delete"),
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
    if (settingActive) return;
    const nextName = selectedIsActive ? null : (selected?.name ?? null);
    const requestId = onSetActive(nextName);
    if (requestId) {
      setActiveRequestId(requestId);
    }
  };

  const saveImportedFiles = async (files: readonly File[], rejectedMessages: readonly string[]): Promise<void> => {
    setImporting(true);
    setLocalError(null);

    try {
      const result = await readPresetImportEntries(files);
      const errors: string[] = [
        ...rejectedMessages,
        ...result.rejected.map((name) => frontendMessage("preset.ui.unsupportedFile", { name })),
      ];

      for (const entry of result.entries) {
        const validationError = validateDraft(entry.format, entry.content);
        if (validationError) {
          errors.push(`${entry.name}: ${validationError}`);
          continue;
        }

        const requestId = onSave({
          name: entry.name,
          format: entry.format,
          content: entry.content,
        });
        if (requestId) {
          setSaveRequestId(requestId);
          setSelectedName(entry.name);
          replaceDraft(entry);
          setDirty(false);
        }
      }

      setLocalError(errors.length > 0 ? errors.join("\n") : null);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip content={frontendMessage("preset.ui.title")} side="top">
        <button
          type="button"
          className={cn(
            "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[11px]",
            "text-ink-500 transition hover:bg-ink-900/[0.045] hover:text-ink-800",
            "focus:outline-none focus:ring-2 focus:ring-terra-200/60",
            disabled && "pointer-events-none opacity-55",
          )}
          aria-label={frontendMessage("preset.ui.title")}
          disabled={disabled}
          onClick={() => setOpen(true)}
        >
          <BookUser className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{frontendMessage("preset.ui.shortTitle")}</span>
          {activePreset ? <span className="h-1.5 w-1.5 rounded-full bg-terra-500" /> : null}
          {hasDiagnostics ? <AlertTriangle className="h-3.5 w-3.5 text-amber-500" /> : null}
        </button>
      </Tooltip>

      <DialogContent
        title={frontendMessage("preset.ui.title")}
        description={rootDir || frontendMessage("preset.ui.localPresets")}
        motionPreset="focus"
        className="h-[min(900px,calc(100dvh_-_20px))] max-h-none w-[min(1440px,calc(100vw_-_20px))] max-w-none rounded-xl bg-paper-100 sm:w-[min(1440px,calc(100vw_-_32px))]"
        bodyClassName="flex min-h-0 flex-1 bg-paper-100"
      >
        <FileDropZone
          accept={PresetFileAccept}
          className="flex min-h-0 flex-1 overflow-hidden bg-[#f7f3ea]"
          disabled={disabled || busy}
          multiple
          onFiles={handleImportedFiles}
        >
          {({ isDragActive, isDragReject, open: openFileDialog }) => (
            <>
              {isDragActive ? <DropOverlay rejected={isDragReject} /> : null}
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

              {useThreePaneLayout ? (
                <div className="grid min-h-0 flex-1 grid-cols-[minmax(280px,320px)_minmax(0,1fr)_minmax(260px,300px)] overflow-hidden">
                  <PresetSidebar
                    activePreset={activePreset}
                    busy={busy}
                    enabled={enabled}
                    filterText={filterText}
                    importing={importing}
                    presets={filteredPresets}
                    rootDir={rootDir}
                    selectedName={selected?.name ?? null}
                    totalPresets={presets.length}
                    onCreate={createPreset}
                    onFilterTextChange={setFilterText}
                    onImport={openFileDialog}
                    onRefresh={onRefresh}
                    onSelect={selectPreset}
                  />
                  <PresetWorkspace
                    busy={busy}
                    currentName={currentName}
                    deleting={deleting}
                    diagnostics={diagnostics}
                    dirty={dirty}
                    draftContent={draftContent}
                    draftFormat={draftFormat}
                    draftName={draftName}
                    importing={importing}
                    saving={saving}
                    selected={selected}
                    selectedIsActive={selectedIsActive}
                    settingActive={settingActive}
                    tokenState={tokenState}
                    onContentChange={(content) => updateDraft({ content })}
                    onDelete={removeSelected}
                    onFormatChange={changeDraftFormat}
                    onNameChange={(name) => updateDraft({ name })}
                    onSave={save}
                    onToggleActive={toggleActive}
                  />
                  <PresetInspector
                    active={selectedIsActive}
                    content={draftContent}
                    dirty={dirty}
                    format={draftFormat}
                    name={currentName}
                    preset={selected}
                    tokenState={tokenState}
                  />
                </div>
              ) : (
                <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
                  <PresetSidebar
                    activePreset={activePreset}
                    busy={busy}
                    enabled={enabled}
                    filterText={filterText}
                    importing={importing}
                    presets={filteredPresets}
                    rootDir={rootDir}
                    selectedName={selected?.name ?? null}
                    totalPresets={presets.length}
                    onCreate={createPreset}
                    onFilterTextChange={setFilterText}
                    onImport={openFileDialog}
                    onRefresh={onRefresh}
                    onSelect={selectPreset}
                  />
                  <PresetWorkspace
                    busy={busy}
                    currentName={currentName}
                    deleting={deleting}
                    diagnostics={diagnostics}
                    dirty={dirty}
                    draftContent={draftContent}
                    draftFormat={draftFormat}
                    draftName={draftName}
                    importing={importing}
                    saving={saving}
                    selected={selected}
                    selectedIsActive={selectedIsActive}
                    settingActive={settingActive}
                    tokenState={tokenState}
                    onContentChange={(content) => updateDraft({ content })}
                    onDelete={removeSelected}
                    onFormatChange={changeDraftFormat}
                    onNameChange={(name) => updateDraft({ name })}
                    onSave={save}
                    onToggleActive={toggleActive}
                  />
                </div>
              )}
            </>
          )}
        </FileDropZone>
      </DialogContent>
    </Dialog>
  );
}
