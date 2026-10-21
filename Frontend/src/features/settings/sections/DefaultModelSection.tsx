import { useId, useMemo, useState } from "react";
import { frontendMessage } from "../../../i18n/frontendMessageCatalog";
import type { ConfigFormFieldData, ConfigFormSectionData } from "../../../api/eventTypes";
import { MotionDisclosure } from "../../../shared/motion";
import { AppIcon, type AppIconName, IconButton, MenuSelect, Spinner, Switch } from "../../../shared/ui";
import { AgentToolPresentationIcon } from "../../../shared/workspace/AgentToolPresentationIcon";
import { findTopField } from "../../chat/modelConfigData";
import {
  inferModelProviderEndpointIcon,
  inferModelProviderIcon,
  ModelProviderIcon,
} from "../../chat/ModelProviderIcon";
import { ConfigFieldRequirementLabel } from "../../../shared/config/ConfigFieldVisibility";
import { cn } from "../../../lib/util";
import { useFrontendLocale } from "../../../i18n/useFrontendLocale";
import { SettingsSectionLoading } from "../SettingsLoading";

import type { SettingsSystemConfigHandle } from "../SettingsContracts";
import {
  projectSystemExtensionRuntimeModelAssignmentSections,
  type SystemExtensionRuntimeModelAssignmentSection,
} from "../systemExtensionConfigurationPresentation";
import type { ConfigSettingsDraftState } from "./configSettingsDraftState";
import { readModelServiceState } from "./modelServiceState";
import {
  isRuntimeModelAssignmentInheritanceValue,
  isRuntimeModelPoolAssignment,
  readRuntimeModelAssignmentCandidates,
  readRuntimeModelAssignmentFields,
  readRuntimeModelAssignmentSelection,
  readRuntimeModelPoolInheritanceField,
  readRuntimeModelPoolAssignmentSelection,
  writeRuntimeModelAssignment,
  writeRuntimeModelAssignmentInheritance,
  writeRuntimeModelPoolAssignment,
  type RuntimeModelAssignmentCandidate,
  type RuntimeModelAssignmentField,
  type RuntimeModelPoolAssignmentSelection,
} from "./runtimeModelAssignments";

interface ModelAssignmentSection {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly fields: readonly RuntimeModelAssignmentField[];
}

interface CoreModelAssignmentGroup {
  readonly kind: "core";
  readonly id: string;
  readonly label: string;
  readonly sections: readonly [ModelAssignmentSection];
}

interface ExtensionModelAssignmentGroup {
  readonly kind: "extension";
  readonly id: string;
  readonly label: string;
  readonly icon: SystemExtensionRuntimeModelAssignmentSection["extensionIcon"];
  readonly sections: readonly ModelAssignmentSection[];
}

type ModelAssignmentGroup = CoreModelAssignmentGroup | ExtensionModelAssignmentGroup;

export function DefaultModelSection({
  draftState,
  systemConfig,
}: {
  draftState: ConfigSettingsDraftState;
  systemConfig?: SettingsSystemConfigHandle;
}): JSX.Element {
  const locale = useFrontendLocale();
  const [pendingModelId, setPendingModelId] = useState<string | null>(null);
  const snapshot = systemConfig?.configSnapshot ?? null;
  const modelSection = snapshot?.form.sections.find((section) => section.name === "models") ?? null;
  const state =
    systemConfig && snapshot && modelSection
      ? readModelServiceState({
          catalogs: systemConfig.providerModelCatalogs,
          configDiagnostics: snapshot.diagnostics,
          draft: draftState.draft,
          errors: systemConfig.providerModelErrors,
          loadingIds: systemConfig.providerModelLoadingIds,
          section: modelSection,
        })
      : null;
  const modelTemplate = useMemo(
    () => findTopField(modelSection ?? undefined, "ModelProviders")?.defaultItem ?? {},
    [modelSection],
  );
  const extensionAssignmentSections = useMemo(
    () =>
      snapshot
        ? projectSystemExtensionRuntimeModelAssignmentSections({
            extensions: systemConfig?.systemExtensions ?? [],
            locale,
            configSnapshot: snapshot,
          })
        : [],
    [locale, snapshot, systemConfig?.systemExtensions],
  );
  const assignmentSections = useMemo(
    () =>
      snapshot
        ? [...snapshot.form.sections, ...extensionAssignmentSections.map((assignment) => assignment.section)]
        : [],
    [extensionAssignmentSections, snapshot],
  );
  const assignmentGroups = useMemo(() => {
    if (!snapshot) return [];
    return projectModelAssignmentGroups({
      coreSections: snapshot.form.sections,
      extensionSections: extensionAssignmentSections,
    });
  }, [extensionAssignmentSections, snapshot]);
  const allFields = useMemo(() => assignmentSections.flatMap((section) => section.fields), [assignmentSections]);
  const defaultModelId = state?.defaultModel?.model.Id ?? "";

  if (!systemConfig) {
    return <SettingsSectionLoading />;
  }
  if (!snapshot || !modelSection || !state) {
    return <SettingsSectionLoading />;
  }

  return (
    <div className="px-0 py-1 sm:py-2">
      <section className="mx-auto w-full max-w-[880px]">
        <div className="space-y-6">
          {assignmentGroups.map((group) => (
            <ModelAssignmentGroupSection
              key={group.id}
              allFields={allFields}
              defaultModelId={defaultModelId}
              draftState={draftState}
              group={group}
              modelTemplate={modelTemplate}
              pendingModelId={pendingModelId}
              state={state}
              systemConfig={systemConfig}
              onDefaultModelPending={setPendingModelId}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

interface ModelAssignmentEditorProps {
  readonly allFields: readonly ConfigFormFieldData[];
  readonly defaultModelId: string;
  readonly draftState: ConfigSettingsDraftState;
  readonly modelTemplate: Record<string, unknown>;
  readonly pendingModelId: string | null;
  readonly state: ReturnType<typeof readModelServiceState>;
  readonly systemConfig: SettingsSystemConfigHandle;
  readonly onDefaultModelPending: (modelId: string) => void;
}

function ModelAssignmentGroupSection({
  group,
  ...editorProps
}: ModelAssignmentEditorProps & { group: ModelAssignmentGroup }): JSX.Element {
  if (group.kind === "extension") {
    return <ExtensionModelAssignmentGroupSection group={group} {...editorProps} />;
  }

  const section = group.sections[0];
  return (
    <section data-model-assignment-group className="border-t border-line-subtle">
      <h2 className="px-0 pb-2 pt-3 text-[12.5px] font-semibold text-content-secondary">{group.label}</h2>
      <ModelAssignmentRows section={section} {...editorProps} />
    </section>
  );
}

function ExtensionModelAssignmentGroupSection({
  group,
  ...editorProps
}: ModelAssignmentEditorProps & { group: ExtensionModelAssignmentGroup }): JSX.Element {
  const [open, setOpen] = useState(false);
  const contentId = useId();

  return (
    <section data-model-assignment-group data-model-assignment-extension className="border-t border-line-subtle">
      <button
        type="button"
        className="group flex w-full min-w-0 items-center gap-2.5 py-3 text-left outline-none transition-colors hover:text-content-primary focus-visible:ring-2 focus-visible:ring-accent-focus"
        aria-controls={contentId}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <AgentToolPresentationIcon
          icon={group.icon}
          size={16}
          className="shrink-0 text-content-secondary"
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-content-primary">{group.label}</span>
        <AppIcon
          icon="chevron-right"
          size={15}
          className={cn("shrink-0 text-content-muted transition-transform duration-200", open && "rotate-90")}
          aria-hidden="true"
        />
      </button>
      <MotionDisclosure id={contentId} open={open} className="border-t border-line-subtle">
        <div className="pb-1 pt-0.5">
          {group.sections.map((section) => (
            <section key={section.id} className="border-b border-line-subtle/70 last:border-b-0">
              <header className="pb-1 pt-3">
                <h3 className="text-[12.5px] font-medium text-content-primary">{section.label}</h3>
                {section.description ? (
                  <p className="mt-0.5 max-w-[680px] text-[11.5px] leading-5 text-content-muted">
                    {section.description}
                  </p>
                ) : null}
              </header>
              <ModelAssignmentRows section={section} {...editorProps} />
            </section>
          ))}
        </div>
      </MotionDisclosure>
    </section>
  );
}

function ModelAssignmentRows({
  section,
  ...editorProps
}: ModelAssignmentEditorProps & { section: ModelAssignmentSection }): JSX.Element {
  return (
    <div className="divide-y divide-line-subtle/70">
      {section.fields.map((field) => (
        <ModelAssignmentRow key={field.modelSelection.id} field={field} {...editorProps} />
      ))}
    </div>
  );
}

function projectModelAssignmentGroups({
  coreSections,
  extensionSections,
}: {
  coreSections: readonly ConfigFormSectionData[];
  extensionSections: readonly SystemExtensionRuntimeModelAssignmentSection[];
}): readonly ModelAssignmentGroup[] {
  const coreGroups = coreSections.flatMap((section) => {
    const assignment = projectModelAssignmentSection(section);
    return assignment
      ? [
          {
            kind: "core" as const,
            id: `core:${section.name}`,
            label: section.label,
            sections: [assignment] as const,
          },
        ]
      : [];
  });
  const extensions = new Map<string, ExtensionModelAssignmentGroup>();

  for (const assignment of extensionSections) {
    const section = projectModelAssignmentSection(assignment.section);
    if (!section) continue;
    const current = extensions.get(assignment.extensionId);
    if (current) {
      extensions.set(assignment.extensionId, { ...current, sections: [...current.sections, section] });
      continue;
    }
    extensions.set(assignment.extensionId, {
      kind: "extension",
      id: `extension:${assignment.extensionId}`,
      label: assignment.extensionLabel,
      icon: assignment.extensionIcon,
      sections: [section],
    });
  }

  return [...coreGroups, ...extensions.values()];
}

function projectModelAssignmentSection(section: ConfigFormSectionData): ModelAssignmentSection | undefined {
  const fields = readRuntimeModelAssignmentFields([section]);
  return fields.length > 0
    ? {
        id: section.name,
        label: section.label,
        description: section.description,
        fields,
      }
    : undefined;
}

function ModelAssignmentRow({
  allFields,
  defaultModelId,
  draftState,
  field,
  modelTemplate,
  pendingModelId,
  state,
  systemConfig,
  onDefaultModelPending,
}: {
  allFields: readonly ConfigFormFieldData[];
  defaultModelId: string;
  draftState: ConfigSettingsDraftState;
  field: RuntimeModelAssignmentField;
  modelTemplate: Record<string, unknown>;
  pendingModelId: string | null;
  state: ReturnType<typeof readModelServiceState>;
  systemConfig: SettingsSystemConfigHandle;
  onDefaultModelPending: (modelId: string) => void;
}): JSX.Element {
  const candidates = readRuntimeModelAssignmentCandidates({
    field,
    models: state.models,
    providers: state.providers,
    modelTemplate,
  });
  if (isRuntimeModelPoolAssignment(field)) {
    return (
      <ModelPoolAssignmentRow allFields={allFields} candidates={candidates} draftState={draftState} field={field} />
    );
  }
  const selection = readRuntimeModelAssignmentSelection({
    field,
    candidates,
    defaultModelId,
    draft: draftState.draft,
  });
  const selectedCandidate = selection.inherited
    ? candidates.find((candidate) => candidate.model.Id === defaultModelId)
    : candidates.find((candidate) => candidate.model.Id === selection.value);
  const operation =
    field.modelSelection.mutation === "default-model" && pendingModelId
      ? systemConfig.providerModelOperations[pendingModelId]
      : undefined;
  const options = [
    ...(field.modelSelection.inheritance?.source === "default-model"
      ? [
          {
            value: `inherit:${field.modelSelection.id}`,
            label: frontendMessage("settings.model.inheritDefault", {
              model:
                candidates.find((candidate) => candidate.model.Id === defaultModelId)?.model.Model ?? defaultModelId,
            }),
          },
        ]
      : []),
    ...(selection.unavailableLabel
      ? [{ value: selection.value, label: selection.unavailableLabel, disabled: true }]
      : []),
    ...candidates.map(({ model, provider }) => ({
      value: model.Id,
      label: model.Model,
      description: provider.Id,
    })),
  ];

  const selectCandidate = (modelId: string): void => {
    if (isRuntimeModelAssignmentInheritanceValue(field, modelId)) {
      draftState.updateDraft(writeRuntimeModelAssignmentInheritance(draftState.draft, field), "immediate");
      return;
    }
    const candidate = candidates.find((entry) => entry.model.Id === modelId);
    if (!candidate) return;
    if (field.modelSelection.mutation === "default-model") {
      const requestId = systemConfig.setDefaultProviderModel(modelId);
      if (requestId) onDefaultModelPending(modelId);
      return;
    }
    draftState.updateDraft(writeRuntimeModelAssignment(draftState.draft, field, candidate), "immediate");
  };

  return (
    <div
      className="grid min-h-[62px] min-w-0 gap-3 py-3 md:grid-cols-[minmax(0,1fr)_minmax(240px,340px)] md:items-center"
      data-model-assignment-row
    >
      <AssignmentLabel field={field} />

      <div className="min-w-0">
        <MenuSelect
          value={selection.value}
          placeholder={field.placeholder ?? frontendMessage("settings.model.defaultPlaceholder")}
          ariaLabel={field.label}
          options={options}
          disabled={candidates.length === 0 || operation?.status === "pending"}
          emptyState={frontendMessage("settings.model.noCandidates")}
          trailing={
            operation?.status === "pending" ? (
              <Spinner size="sm" className="text-ink-400" />
            ) : operation?.status === "success" ? (
              <AppIcon icon="checkmark" size={14} className="text-moss-600" />
            ) : undefined
          }
          renderValue={(value, option) => (
            <AssignmentOption
              label={option?.label ?? value}
              providerId={selectedCandidate?.provider.Id}
              icon={readCandidateIcon(selectedCandidate)}
              unavailable={Boolean(selection.unavailableLabel)}
            />
          )}
          renderOption={(option) => (
            <AssignmentOption
              label={option.label}
              providerId={option.description}
              icon={readCandidateIcon(candidates.find((candidate) => candidate.model.Id === option.value))}
              unavailable={option.disabled}
            />
          )}
          onChange={selectCandidate}
        />
        {candidates.length === 0 || selection.unavailableLabel || operation?.status === "error" ? (
          <p
            className={cn(
              "mt-1.5 text-[11px] leading-4",
              operation?.status === "error" ? "text-brick-700" : "text-umber-600",
            )}
          >
            {operation?.status === "error"
              ? frontendMessage("settings.model.saveFailed", { error: operation.message ?? "" })
              : candidates.length === 0
                ? frontendMessage("settings.model.noCapableCandidates")
                : frontendMessage("settings.model.assignmentUnavailable")}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ModelPoolAssignmentRow({
  allFields,
  candidates,
  draftState,
  field,
}: {
  allFields: readonly ConfigFormFieldData[];
  candidates: readonly RuntimeModelAssignmentCandidate[];
  draftState: ConfigSettingsDraftState;
  field: RuntimeModelAssignmentField;
}): JSX.Element {
  const selection = readRuntimeModelPoolAssignmentSelection({ field, allFields, draft: draftState.draft });
  const candidatesById = new Map(candidates.map((candidate) => [candidate.model.Id, candidate]));
  const selectedIds = new Set(selection.modelIds);
  const availableCandidates = candidates.filter((candidate) => !selectedIds.has(candidate.model.Id));
  const inheritanceField = readRuntimeModelPoolInheritanceField(field, allFields);
  const sourceCount = selection.modelIds.length + Number(selection.inheritanceEnabled);

  const update = (next: RuntimeModelPoolAssignmentSelection): void => {
    draftState.updateDraft(writeRuntimeModelPoolAssignment(draftState.draft, field, next), "immediate");
  };
  const addModel = (modelId: string): void => {
    if (!candidatesById.has(modelId) || selectedIds.has(modelId)) return;
    update({ ...selection, modelIds: [...selection.modelIds, modelId] });
  };
  const removeModel = (index: number): void => {
    if (sourceCount <= 1) return;
    update({ ...selection, modelIds: selection.modelIds.filter((_, candidateIndex) => candidateIndex !== index) });
  };
  const moveModel = (index: number, offset: -1 | 1): void => {
    const target = index + offset;
    if (target < 0 || target >= selection.modelIds.length) return;
    const modelIds = [...selection.modelIds];
    [modelIds[index], modelIds[target]] = [modelIds[target]!, modelIds[index]!];
    update({ ...selection, modelIds });
  };

  return (
    <div className="min-w-0" data-model-pool-assignment>
      <div className="divide-y divide-line-subtle">
        {inheritanceField ? (
          <div className="flex min-h-[58px] min-w-0 items-center gap-4 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-medium text-ink-850">{inheritanceField.label}</div>
              {inheritanceField.description ? (
                <div className="mt-0.5 text-[11.5px] leading-5 text-ink-500">{inheritanceField.description}</div>
              ) : null}
            </div>
            <Switch
              checked={selection.inheritanceEnabled}
              disabled={selection.inheritanceEnabled && selection.modelIds.length === 0}
              ariaLabel={inheritanceField.label}
              onCheckedChange={(inheritanceEnabled) => update({ ...selection, inheritanceEnabled })}
            />
          </div>
        ) : null}

        <div className="py-3">
          <AssignmentLabel field={field} />
        </div>

        {selection.modelIds.map((modelId, index) => {
          const candidate = candidatesById.get(modelId);
          const unavailable = !candidate;
          const cannotRemove = sourceCount <= 1;
          return (
            <div key={`${modelId}:${index}`} className="flex min-h-[54px] min-w-0 items-center gap-3 py-2">
              <PoolCandidateLabel candidate={candidate} modelId={modelId} unavailable={unavailable} />
              <div className="flex shrink-0 items-center gap-0.5">
                <IconButton
                  label={frontendMessage("settings.model.poolMoveUp", { model: modelId })}
                  tooltip={frontendMessage("settings.model.poolMoveUpShort")}
                  size="sm"
                  tone="muted"
                  disabled={index === 0}
                  onClick={() => moveModel(index, -1)}
                >
                  <AppIcon icon="arrow-up" size={14} />
                </IconButton>
                <IconButton
                  label={frontendMessage("settings.model.poolMoveDown", { model: modelId })}
                  tooltip={frontendMessage("settings.model.poolMoveDownShort")}
                  size="sm"
                  tone="muted"
                  disabled={index === selection.modelIds.length - 1}
                  onClick={() => moveModel(index, 1)}
                >
                  <AppIcon icon="arrow-down" size={14} />
                </IconButton>
                <IconButton
                  label={frontendMessage("settings.model.poolRemove", { model: modelId })}
                  tooltip={frontendMessage("settings.model.poolRemoveShort")}
                  size="sm"
                  tone="danger"
                  disabled={cannotRemove}
                  onClick={() => removeModel(index)}
                >
                  <AppIcon icon="trash" size={14} />
                </IconButton>
              </div>
            </div>
          );
        })}

        <div className="py-2">
          <MenuSelect
            value=""
            placeholder={field.placeholder ?? frontendMessage("settings.model.poolAdd")}
            ariaLabel={frontendMessage("settings.model.poolAdd")}
            options={availableCandidates.map(({ model, provider }) => ({
              value: model.Id,
              label: model.Model,
              description: provider.Id,
            }))}
            disabled={availableCandidates.length === 0}
            emptyState={frontendMessage("settings.model.poolNoAdditionalCandidates")}
            leading={<AppIcon icon="plus" size={14} />}
            triggerClassName="border-0 bg-transparent px-0 hover:border-transparent focus-visible:border-transparent focus-visible:ring-0"
            renderOption={(option) => (
              <AssignmentOption
                label={option.label}
                providerId={option.description}
                icon={readCandidateIcon(candidatesById.get(option.value))}
              />
            )}
            onChange={addModel}
          />
          {selection.modelIds.some((modelId) => !candidatesById.has(modelId)) ? (
            <p className="pb-1 text-[11px] leading-4 text-umber-600">
              {frontendMessage("settings.model.poolUnavailable")}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function PoolCandidateLabel({
  candidate,
  modelId,
  unavailable,
}: {
  candidate?: RuntimeModelAssignmentCandidate;
  modelId: string;
  unavailable: boolean;
}): JSX.Element {
  const icon = readCandidateIcon(candidate);
  return (
    <div className={cn("flex min-w-0 flex-1 items-center gap-2.5", unavailable && "text-umber-600")}>
      {icon ? <ModelProviderIcon icon={icon} size={15} /> : null}
      <div className="min-w-0">
        <div className="truncate text-[12.5px] font-medium text-ink-850">{candidate?.model.Model ?? modelId}</div>
        {candidate ? <div className="mt-0.5 truncate text-[10.5px] text-ink-450">{candidate.provider.Id}</div> : null}
      </div>
    </div>
  );
}

function AssignmentLabel({ field }: { field: RuntimeModelAssignmentField }): JSX.Element {
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <span className="mt-1 shrink-0 text-content-secondary">
        <AssignmentRoleIcon field={field} />
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-[13px] font-medium text-content-primary">{field.label}</span>
          <ConfigFieldRequirementLabel required={field.modelSelection.required} />
        </div>
        {field.description ? (
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-content-muted">{field.description}</p>
        ) : null}
      </div>
    </div>
  );
}

function AssignmentOption({
  label,
  providerId,
  icon,
  unavailable,
}: {
  label: string;
  providerId?: string;
  icon?: string;
  unavailable?: boolean;
}): JSX.Element {
  return (
    <span className={cn("flex min-w-0 items-center gap-2 leading-5", unavailable && "text-umber-600")}>
      {icon ? <ModelProviderIcon icon={icon} size={14} /> : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {providerId ? <span className="shrink-0 text-[10.5px] text-content-muted">{providerId}</span> : null}
    </span>
  );
}

function readCandidateIcon(candidate?: RuntimeModelAssignmentCandidate): string | undefined {
  if (!candidate) return undefined;
  return (
    candidate.model.Icon ??
    inferModelProviderIcon(candidate.model.Model, false) ??
    inferModelProviderEndpointIcon(candidate.provider.Id, false) ??
    candidate.provider.Icon ??
    inferModelProviderIcon(candidate.model.Model)
  );
}

const assignmentRoleIcons: Readonly<Record<string, AppIconName>> = {
  assistant: "target",
  planner: "list-tree",
  "planner-base": "list-tree",
  "action-planner": "delegation",
  "final-answer": "answer",
  "state-card": "state-card",
  "continuity-learning": "stack",
};

function AssignmentRoleIcon({ field }: { field: RuntimeModelAssignmentField }): JSX.Element {
  const selection = field.modelSelection;
  const icon =
    assignmentRoleIcons[selection.id] ??
    (isRuntimeModelPoolAssignment(field) ? "list-tree" : selection.capability === "Vision" ? "eye" : "target");
  return <AppIcon icon={icon} className="h-4 w-4" data-model-assignment-icon={selection.id} />;
}
