import { useMemo } from "react";
import {
  BadgeCheck,
  BookMarked,
  Boxes,
  Check,
  CircleOff,
  Lightbulb,
  MessageSquareQuote,
  Plus,
  Power,
  PowerOff,
  Save,
  Trash2,
  UserRound,
  WandSparkles,
} from "lucide-react";
import type { PersonaPresetCard, PresetItem, PresetWorldPackageDescriptor } from "../../api/eventTypes";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn, formatInteger } from "../../lib/util";
import { Button, IconButton, Spinner } from "../../shared/ui";
import { presetCardText } from "./presetPanelUtils";

export function PresetWorkspace({
  busy,
  deleting,
  diagnostics,
  dirty,
  draft,
  draftName,
  saving,
  selected,
  selectedIsActive,
  settingActive,
  worldPackages,
  onDelete,
  onDraftChange,
  onNameChange,
  onSave,
  onToggleActive,
}: {
  busy: boolean;
  deleting: boolean;
  diagnostics: Array<{ severity: "error" | "warning"; message: string }>;
  dirty: boolean;
  draft: PersonaPresetCard;
  draftName: string;
  saving: boolean;
  selected: PresetItem | null;
  selectedIsActive: boolean;
  settingActive: boolean;
  worldPackages: PresetWorldPackageDescriptor[];
  onDelete: () => void;
  onDraftChange: (card: PersonaPresetCard) => void;
  onNameChange: (name: string) => void;
  onSave: (activate: boolean) => void;
  onToggleActive: () => void;
}): JSX.Element {
  const projectedText = useMemo(() => presetCardText(draft), [draft]);
  const characterCount = projectedText.length;
  const worldPackageOptions = useMemo(() => {
    const availableIds = new Set(worldPackages.map((entry) => entry.id));
    return [
      ...worldPackages.map((entry) => ({ ...entry, available: true as const })),
      ...draft.worldPackageIds
        .filter((id) => !availableIds.has(id))
        .map((id) => ({
          id,
          title: id,
          entityCount: 0,
          relationCount: 0,
          stateMachineCount: 0,
          habitCount: 0,
          autonomyCount: 0,
          available: false as const,
        })),
    ];
  }, [draft.worldPackageIds, worldPackages]);

  return (
    <section className="flex min-h-0 w-full min-w-0 flex-col overflow-hidden bg-surface-panel">
      <PresetToolbar
        deleting={deleting}
        draftName={draftName}
        saving={saving}
        selected={selected}
        selectedIsActive={selectedIsActive}
        settingActive={settingActive}
        onDelete={onDelete}
        onNameChange={onNameChange}
        onSave={onSave}
        onToggleActive={onToggleActive}
      />

      {diagnostics.length > 0 ? (
        <div className="shrink-0 border-b border-line-subtle bg-umber-50/50 px-4 py-2 text-[12px] text-umber-800">
          {diagnostics.map((item) => item.message).join("\n")}
        </div>
      ) : null}

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto bg-surface-subtle px-4 py-4 sm:px-6">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 pb-5">
          <PersonaSection
            icon={<UserRound className="h-4 w-4" />}
            title={frontendMessage("preset.ui.corePersona")}
            description={frontendMessage("preset.ui.corePersonaDescription")}
          >
            <textarea
              aria-label={frontendMessage("preset.ui.corePersona")}
              value={draft.corePersona}
              disabled={busy}
              onChange={(event) => onDraftChange({ ...draft, corePersona: event.currentTarget.value })}
              placeholder={frontendMessage("preset.ui.corePersonaPlaceholder")}
              className={textareaClass}
            />
          </PersonaSection>

          <PersonaSection
            icon={<WandSparkles className="h-4 w-4" />}
            title={frontendMessage("preset.ui.languageStyle")}
            description={frontendMessage("preset.ui.languageStyleDescription")}
          >
            <textarea
              aria-label={frontendMessage("preset.ui.languageStyle")}
              value={draft.languageStyle}
              disabled={busy}
              onChange={(event) => onDraftChange({ ...draft, languageStyle: event.currentTarget.value })}
              placeholder={frontendMessage("preset.ui.languageStylePlaceholder")}
              className={textareaClass}
            />
          </PersonaSection>

          <PersonaSection
            icon={<Boxes className="h-4 w-4" />}
            title={frontendMessage("preset.ui.worldPackages")}
            description={frontendMessage("preset.ui.worldPackagesDescription")}
          >
            {worldPackageOptions.length === 0 ? (
              <EmptySection label={frontendMessage("preset.ui.worldPackagesEmpty")} />
            ) : (
              <div className="divide-y divide-line-subtle">
                {worldPackageOptions.map((worldPackage) => {
                  const selected = draft.worldPackageIds.includes(worldPackage.id);
                  return (
                    <label
                      key={worldPackage.id}
                      className="flex min-h-11 cursor-pointer items-center gap-3 py-2 text-content-primary"
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        disabled={busy}
                        onChange={(event) =>
                          onDraftChange({
                            ...draft,
                            worldPackageIds: event.currentTarget.checked
                              ? [...draft.worldPackageIds, worldPackage.id]
                              : draft.worldPackageIds.filter((id) => id !== worldPackage.id),
                          })
                        }
                        className="h-3.5 w-3.5 rounded border-line text-accent-content focus:ring-accent-focus"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px] font-medium">{worldPackage.title}</span>
                        <span className="block truncate text-[10.5px] text-content-muted">{worldPackage.id}</span>
                      </span>
                      <span className="shrink-0 text-[10.5px] tabular-nums text-content-muted">
                        {worldPackage.available
                          ? frontendMessage("preset.ui.worldPackageStats", {
                              entities: formatInteger(worldPackage.entityCount),
                              relations: formatInteger(worldPackage.relationCount),
                              states: formatInteger(worldPackage.stateMachineCount),
                              habits: formatInteger(worldPackage.habitCount),
                              autonomy: formatInteger(worldPackage.autonomyCount),
                            })
                          : frontendMessage("preset.ui.worldPackageMissing")}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </PersonaSection>

          <PersonaSection
            icon={<MessageSquareQuote className="h-4 w-4" />}
            title={frontendMessage("preset.ui.examples")}
            description={frontendMessage("preset.ui.examplesDescription")}
            action={
              <IconButton
                label={frontendMessage("preset.ui.addExample")}
                tooltip={frontendMessage("preset.ui.addExample")}
                size="sm"
                tone="muted"
                disabled={busy}
                onClick={() =>
                  onDraftChange({
                    ...draft,
                    examples: [...draft.examples, { id: crypto.randomUUID(), situation: "", reply: "" }],
                  })
                }
              >
                <Plus className="h-3.5 w-3.5" />
              </IconButton>
            }
          >
            {draft.examples.length === 0 ? <EmptySection label={frontendMessage("preset.ui.examplesEmpty")} /> : null}
            <div className="space-y-3">
              {draft.examples.map((example, index) => (
                <div key={example.id} className="border-b border-line-subtle pb-3 last:border-b-0 last:pb-0">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[11px] font-medium text-content-muted">
                      {frontendMessage("preset.ui.exampleTitle", { index: index + 1 })}
                    </span>
                    <IconButton
                      label={frontendMessage("preset.ui.removeExample")}
                      tooltip={frontendMessage("preset.ui.removeExample")}
                      size="sm"
                      tone="danger"
                      disabled={busy}
                      onClick={() =>
                        onDraftChange({ ...draft, examples: draft.examples.filter((entry) => entry.id !== example.id) })
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconButton>
                  </div>
                  <textarea
                    aria-label={frontendMessage("preset.ui.exampleSituation", { index: index + 1 })}
                    value={example.situation}
                    disabled={busy}
                    onChange={(event) =>
                      onDraftChange(replaceExample(draft, example.id, { situation: event.currentTarget.value }))
                    }
                    placeholder={frontendMessage("preset.ui.exampleSituationPlaceholder")}
                    className={cn(textareaClass, "min-h-18")}
                  />
                  <textarea
                    aria-label={frontendMessage("preset.ui.exampleReply", { index: index + 1 })}
                    value={example.reply}
                    disabled={busy}
                    onChange={(event) =>
                      onDraftChange(replaceExample(draft, example.id, { reply: event.currentTarget.value }))
                    }
                    placeholder={frontendMessage("preset.ui.exampleReplyPlaceholder")}
                    className={cn(textareaClass, "mt-2 min-h-18")}
                  />
                </div>
              ))}
            </div>
          </PersonaSection>

          <PersonaSection
            icon={<BookMarked className="h-4 w-4" />}
            title={frontendMessage("preset.ui.lore")}
            description={frontendMessage("preset.ui.loreDescription")}
            action={
              <IconButton
                label={frontendMessage("preset.ui.addLore")}
                tooltip={frontendMessage("preset.ui.addLore")}
                size="sm"
                tone="muted"
                disabled={busy}
                onClick={() =>
                  onDraftChange({
                    ...draft,
                    lore: [
                      ...draft.lore,
                      { id: crypto.randomUUID(), title: "", keywords: [], content: "", enabled: true },
                    ],
                  })
                }
              >
                <Plus className="h-3.5 w-3.5" />
              </IconButton>
            }
          >
            {draft.lore.length === 0 ? <EmptySection label={frontendMessage("preset.ui.loreEmpty")} /> : null}
            <div className="space-y-3">
              {draft.lore.map((entry, index) => (
                <div key={entry.id} className="border-b border-line-subtle pb-3 last:border-b-0 last:pb-0">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <span className="text-[11px] font-medium text-content-muted">
                      {frontendMessage("preset.ui.loreEntryTitle", { index: index + 1 })}
                    </span>
                    <div className="flex items-center gap-1">
                      <label className="inline-flex h-7 items-center gap-1.5 px-1.5 text-[11px] text-content-muted">
                        <input
                          type="checkbox"
                          checked={entry.enabled}
                          disabled={busy}
                          onChange={(event) =>
                            onDraftChange(replaceLore(draft, entry.id, { enabled: event.currentTarget.checked }))
                          }
                          className="h-3.5 w-3.5 rounded border-line text-accent-content focus:ring-accent-focus"
                        />
                        {frontendMessage("preset.ui.enable")}
                      </label>
                      <IconButton
                        label={frontendMessage("preset.ui.removeLore")}
                        tooltip={frontendMessage("preset.ui.removeLore")}
                        size="sm"
                        tone="danger"
                        disabled={busy}
                        onClick={() =>
                          onDraftChange({ ...draft, lore: draft.lore.filter((candidate) => candidate.id !== entry.id) })
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </IconButton>
                    </div>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input
                      aria-label={frontendMessage("preset.ui.loreTitle", { index: index + 1 })}
                      value={entry.title}
                      disabled={busy}
                      onChange={(event) =>
                        onDraftChange(replaceLore(draft, entry.id, { title: event.currentTarget.value }))
                      }
                      placeholder={frontendMessage("preset.ui.loreTitlePlaceholder")}
                      className={inputClass}
                    />
                    <input
                      aria-label={frontendMessage("preset.ui.loreKeywords", { index: index + 1 })}
                      value={entry.keywords.join(", ")}
                      disabled={busy}
                      onChange={(event) =>
                        onDraftChange(
                          replaceLore(draft, entry.id, {
                            keywords: event.currentTarget.value
                              .split(/[，,]/u)
                              .map((keyword) => keyword.trim())
                              .filter(Boolean),
                          }),
                        )
                      }
                      placeholder={frontendMessage("preset.ui.loreKeywordsPlaceholder")}
                      className={inputClass}
                    />
                  </div>
                  <textarea
                    aria-label={frontendMessage("preset.ui.loreContent", { index: index + 1 })}
                    value={entry.content}
                    disabled={busy}
                    onChange={(event) =>
                      onDraftChange(replaceLore(draft, entry.id, { content: event.currentTarget.value }))
                    }
                    placeholder={frontendMessage("preset.ui.loreContentPlaceholder")}
                    className={cn(textareaClass, "mt-2 min-h-22")}
                  />
                </div>
              ))}
            </div>
          </PersonaSection>
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-line-subtle bg-surface-subtle px-4 py-2 text-[11px] text-content-secondary sm:px-5">
        <span className="inline-flex min-w-0 items-center gap-1.5 truncate">
          {busy ? (
            <Spinner size="sm" />
          ) : selectedIsActive ? (
            <BadgeCheck className="h-3.5 w-3.5 text-accent-content" />
          ) : (
            <CircleOff className="h-3.5 w-3.5" />
          )}
          {busy
            ? frontendMessage("preset.ui.updating")
            : dirty
              ? frontendMessage("preset.ui.unsaved")
              : selectedIsActive
                ? frontendMessage("preset.ui.active")
                : frontendMessage("preset.ui.disabled")}
        </span>
        <span className="shrink-0 tabular-nums">
          {frontendMessage("preset.ui.characterCount", { count: formatInteger(characterCount) })}
        </span>
      </div>
    </section>
  );
}

function PresetToolbar({
  deleting,
  draftName,
  saving,
  selected,
  selectedIsActive,
  settingActive,
  onDelete,
  onNameChange,
  onSave,
  onToggleActive,
}: {
  deleting: boolean;
  draftName: string;
  saving: boolean;
  selected: PresetItem | null;
  selectedIsActive: boolean;
  settingActive: boolean;
  onDelete: () => void;
  onNameChange: (name: string) => void;
  onSave: (activate: boolean) => void;
  onToggleActive: () => void;
}): JSX.Element {
  return (
    <div className="shrink-0 border-b border-line-subtle bg-surface-panel px-4 py-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <input
          value={draftName}
          onChange={(event) => onNameChange(event.currentTarget.value)}
          placeholder={frontendMessage("preset.ui.name")}
          aria-label={frontendMessage("preset.ui.name")}
          className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-surface-panel px-3 text-[13px] text-content-primary shadow-sm outline-none transition placeholder:text-content-muted focus:border-accent-border focus:ring-2 focus:ring-accent-focus"
        />
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <IconButton
            label={frontendMessage("preset.ui.deleteCurrent")}
            tooltip={frontendMessage("preset.ui.delete")}
            size="md"
            tone="danger"
            disabled={!selected || deleting}
            onClick={onDelete}
          >
            {deleting ? <Spinner size="sm" /> : <Trash2 className="h-3.5 w-3.5" />}
          </IconButton>
          <Button
            size="sm"
            variant={selectedIsActive ? "outline" : "ghost"}
            disabled={!selected || settingActive}
            onClick={onToggleActive}
          >
            {settingActive ? (
              <Spinner size="sm" />
            ) : selectedIsActive ? (
              <PowerOff className="h-3.5 w-3.5" />
            ) : (
              <Power className="h-3.5 w-3.5" />
            )}
            {selectedIsActive ? frontendMessage("preset.ui.disable") : frontendMessage("preset.ui.enable")}
          </Button>
          <Button size="sm" variant="outline" disabled={saving} onClick={() => onSave(false)}>
            {saving ? <Spinner size="sm" /> : <Save className="h-3.5 w-3.5" />}
            {frontendMessage("preset.ui.save")}
          </Button>
          <Button size="sm" disabled={saving} onClick={() => onSave(true)}>
            <Check className="h-3.5 w-3.5" />
            {frontendMessage("preset.ui.saveAndEnable")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function PersonaSection({
  icon,
  title,
  description,
  action,
  children,
}: {
  icon: JSX.Element;
  title: string;
  description: string;
  action?: JSX.Element;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section className="border-b border-line-subtle pb-6 last:border-b-0 last:pb-0">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-content-primary">
            <span className="grid h-6 w-6 place-items-center rounded-md bg-ink-900/[0.045] text-content-muted">
              {icon}
            </span>
            {title}
          </div>
          <p className="mt-1 pl-8 text-[11.5px] leading-5 text-content-muted">{description}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function EmptySection({ label }: { label: string }): JSX.Element {
  return (
    <div className="flex min-h-18 items-center gap-2 border border-dashed border-line-subtle px-3 text-[12px] text-content-muted">
      <Lightbulb className="h-3.5 w-3.5 shrink-0" />
      {label}
    </div>
  );
}

function replaceExample(
  card: PersonaPresetCard,
  id: string,
  patch: Partial<PersonaPresetCard["examples"][number]>,
): PersonaPresetCard {
  return { ...card, examples: card.examples.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)) };
}

function replaceLore(
  card: PersonaPresetCard,
  id: string,
  patch: Partial<PersonaPresetCard["lore"][number]>,
): PersonaPresetCard {
  return { ...card, lore: card.lore.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)) };
}

const inputClass =
  "h-9 w-full rounded-md border border-line bg-surface-panel px-2.5 text-[12px] text-content-primary outline-none placeholder:text-content-muted focus:border-accent-border focus:ring-2 focus:ring-accent-focus disabled:cursor-not-allowed disabled:opacity-60";
const textareaClass =
  "min-h-28 w-full resize-y rounded-md border border-line bg-surface-panel px-3 py-2.5 text-[12.5px] leading-6 text-content-primary outline-none placeholder:text-content-muted focus:border-accent-border focus:ring-2 focus:ring-accent-focus disabled:cursor-not-allowed disabled:opacity-60";
