import { useMemo, useState, type ElementType } from "react";
import ArrowsRightLeftIcon from "@heroicons/react/24/outline/ArrowsRightLeftIcon";
import BarsArrowUpIcon from "@heroicons/react/24/outline/BarsArrowUpIcon";
import ChatBubbleBottomCenterTextIcon from "@heroicons/react/24/outline/ChatBubbleBottomCenterTextIcon";
import CircleStackIcon from "@heroicons/react/24/outline/CircleStackIcon";
import CpuChipIcon from "@heroicons/react/24/outline/CpuChipIcon";
import EyeIcon from "@heroicons/react/24/outline/EyeIcon";
import QueueListIcon from "@heroicons/react/24/outline/QueueListIcon";
import ViewfinderCircleIcon from "@heroicons/react/24/outline/ViewfinderCircleIcon";
import WrenchScrewdriverIcon from "@heroicons/react/24/outline/WrenchScrewdriverIcon";
import { ArrowDown, ArrowUp, Check, Plus, Trash2 } from "lucide-react";
import { frontendMessage } from "../../../i18n/frontendMessageCatalog";
import type { ConfigFormFieldData } from "../../../api/eventTypes";
import { IconButton, MenuSelect, Spinner, StateView, Switch } from "../../../shared/ui";
import { findTopField } from "../../chat/modelConfigData";
import {
  inferModelProviderEndpointIcon,
  inferModelProviderIcon,
  ModelProviderIcon,
} from "../../chat/ModelProviderIcon";
import { ConfigFieldRequirementLabel } from "../../../shared/config/ConfigFieldVisibility";
import { cn } from "../../../lib/util";
import { useFrontendLocale } from "../../../i18n/useFrontendLocale";

import type { SettingsSystemConfigHandle } from "../SettingsContracts";
import { projectSystemExtensionRuntimeModelAssignmentSections } from "../systemExtensionConfigurationPresentation";
import type { ConfigSettingsDraftState } from "./configSettingsDraftState";
import { readModelServiceState } from "./modelServiceState";
import {
  isRuntimeModelAssignmentInheritanceValue,
  isRuntimeModelPoolAssignment,
  readRuntimeModelAssignmentCandidates,
  readRuntimeModelAssignmentFields,
  readRuntimeModelAssignmentSelection,
  readRuntimeModelPoolAssignmentSelection,
  writeRuntimeModelAssignment,
  writeRuntimeModelAssignmentInheritance,
  writeRuntimeModelPoolAssignment,
  type RuntimeModelAssignmentCandidate,
  type RuntimeModelAssignmentField,
  type RuntimeModelPoolAssignmentSelection,
} from "./runtimeModelAssignments";

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
  const assignmentSections = useMemo(() => {
    if (!snapshot) return [];
    return [
      ...snapshot.form.sections,
      ...projectSystemExtensionRuntimeModelAssignmentSections({
        extensions: systemConfig?.systemExtensions ?? [],
        locale,
        configSnapshot: snapshot,
      }),
    ];
  }, [locale, snapshot, systemConfig?.systemExtensions]);
  const assignmentGroups = useMemo(() => {
    const fields = readRuntimeModelAssignmentFields(assignmentSections);
    return assignmentSections.flatMap((section) => {
      const assignments = fields.filter((field) => field.section === section.name);
      return assignments.length > 0 ? [{ id: section.name, label: section.label, fields: assignments }] : [];
    });
  }, [assignmentSections]);
  const allFields = useMemo(() => assignmentSections.flatMap((section) => section.fields), [assignmentSections]);
  const defaultModelId = state?.defaultModel?.model.Id ?? "";

  if (!systemConfig) {
    return (
      <StateView
        status="loading"
        className="min-h-[220px] bg-paper-50"
        description={frontendMessage("settings.state.loadingMain")}
      />
    );
  }
  if (!snapshot || !modelSection || !state) {
    return (
      <StateView
        status="loading"
        className="min-h-[220px] bg-paper-50"
        description={frontendMessage("settings.state.loadingDefaultModel")}
      />
    );
  }

  return (
    <div className="bg-transparent px-0 py-3 sm:py-4">
      <section className="mx-auto w-full max-w-[1120px]">
        <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-line-subtle pb-4">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-content-strong">
              {frontendMessage("settings.model.assignmentsTitle")}
            </h2>
            <p className="mt-1 max-w-[720px] text-[12px] leading-5 text-content-secondary">
              {frontendMessage("settings.model.assignmentsDescription")}
            </p>
          </div>
        </header>

        <div className="mt-4 space-y-5">
          {assignmentGroups.map((group) => (
            <section key={group.id} data-model-assignment-group>
              <div className="flex items-center border-b border-line-subtle pb-2">
                <h3 className="text-[12.5px] font-semibold text-content-primary">{group.label}</h3>
              </div>
              <div className="divide-y divide-line-subtle">
                {group.fields.map((field) => (
                  <ModelAssignmentRow
                    key={field.modelSelection.id}
                    allFields={allFields}
                    defaultModelId={defaultModelId}
                    draftState={draftState}
                    field={field}
                    modelTemplate={modelTemplate}
                    pendingModelId={pendingModelId}
                    state={state}
                    systemConfig={systemConfig}
                    onDefaultModelPending={setPendingModelId}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </section>
    </div>
  );
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
  allFields: ConfigFormFieldData[];
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
    allFields,
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
      className="grid min-h-[58px] min-w-0 gap-3 py-2.5 md:grid-cols-[minmax(0,1fr)_minmax(220px,320px)] md:items-center"
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
              <Check className="h-3.5 w-3.5 text-moss-600" />
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
  const hasInheritance = Boolean(field.modelSelection.inheritance);
  const sourceCount = selection.modelIds.length + Number(hasInheritance && selection.inheritanceEnabled);

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
      <div className="py-3">
        <AssignmentLabel field={field} />
      </div>
      <div className="divide-y divide-line-subtle border-t border-line-subtle">
        {hasInheritance ? (
          <div className="flex min-h-[58px] min-w-0 items-center gap-4 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-medium text-ink-850">{inheritanceSourceLabel(field)}</div>
              <div className="mt-0.5 text-[11.5px] leading-5 text-ink-500">
                {frontendMessage("settings.model.poolRuntimeResolved")}
              </div>
            </div>
            <Switch
              checked={selection.inheritanceEnabled}
              disabled={selection.inheritanceEnabled && selection.modelIds.length === 0}
              ariaLabel={frontendMessage("settings.model.poolToggleInheritance")}
              onCheckedChange={(inheritanceEnabled) => update({ ...selection, inheritanceEnabled })}
            />
          </div>
        ) : null}

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
                  <ArrowUp className="h-3.5 w-3.5" />
                </IconButton>
                <IconButton
                  label={frontendMessage("settings.model.poolMoveDown", { model: modelId })}
                  tooltip={frontendMessage("settings.model.poolMoveDownShort")}
                  size="sm"
                  tone="muted"
                  disabled={index === selection.modelIds.length - 1}
                  onClick={() => moveModel(index, 1)}
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </IconButton>
                <IconButton
                  label={frontendMessage("settings.model.poolRemove", { model: modelId })}
                  tooltip={frontendMessage("settings.model.poolRemoveShort")}
                  size="sm"
                  tone="danger"
                  disabled={cannotRemove}
                  onClick={() => removeModel(index)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
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
            leading={<Plus className="h-3.5 w-3.5" />}
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
    <div className="min-w-0">
      <span className="sr-only">
        <AssignmentRoleIcon field={field} />
      </span>
      <div className="min-w-0 pt-0.5">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-[13px] font-medium text-content-primary">{field.label}</span>
          <ConfigFieldRequirementLabel required={field.modelSelection.required} />
        </div>
        {field.description ? (
          <p className="mt-0.5 text-[11.5px] leading-5 text-content-secondary">{field.description}</p>
        ) : null}
      </div>
    </div>
  );
}

function inheritanceSourceLabel(field: RuntimeModelAssignmentField): string {
  return frontendMessage(
    field.modelSelection.inheritance?.source === "default-model"
      ? "settings.model.poolDefaultModelSource"
      : "settings.model.poolParentModelSource",
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

const assignmentRoleIcons: Readonly<Record<string, ElementType<{ className?: string }>>> = {
  assistant: CpuChipIcon,
  planner: QueueListIcon,
  "planner-base": QueueListIcon,
  "action-planner": ArrowsRightLeftIcon,
  "final-answer": ChatBubbleBottomCenterTextIcon,
  "tool-learning": WrenchScrewdriverIcon,
  "continuity-learning": CircleStackIcon,
  embedding: ViewfinderCircleIcon,
  rerank: BarsArrowUpIcon,
};

function AssignmentRoleIcon({ field }: { field: RuntimeModelAssignmentField }): JSX.Element {
  const selection = field.modelSelection;
  const Icon =
    assignmentRoleIcons[selection.id] ??
    (isRuntimeModelPoolAssignment(field)
      ? QueueListIcon
      : selection.capability === "Embedding"
        ? ViewfinderCircleIcon
        : selection.capability === "Rerank"
          ? BarsArrowUpIcon
          : selection.capability === "Vision"
            ? EyeIcon
            : CpuChipIcon);
  return <Icon className="h-3.5 w-3.5" data-model-assignment-icon={selection.id} />;
}
