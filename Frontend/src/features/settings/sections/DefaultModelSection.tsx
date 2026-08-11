import { useMemo, useState, type ComponentType } from "react";
import {
  ArrowDown,
  ArrowUp,
  BrainCircuit,
  Check,
  GitFork,
  ListFilter,
  Plus,
  Search,
  Target,
  Trash2,
} from "lucide-react";
import { frontendMessage } from "../../../i18n/frontendMessageCatalog";
import type { ConfigFormFieldData } from "../../../api/eventTypes";
import { IconButton, MenuSelect, Spinner, StateView, Switch } from "../../../shared/ui";
import { findTopField } from "../../chat/modelConfigData";
import { ModelProviderIcon, inferModelProviderIcon } from "../../chat/ModelProviderIcon";
import { ConfigFieldRequirementLabel } from "../../../shared/config/ConfigFieldVisibility";
import { cn } from "../../../lib/util";
import { useFrontendLocale } from "../../../i18n/useFrontendLocale";

import type { SettingsSystemConfigHandle } from "../SettingsContracts";
import { projectSystemExtensionRuntimeModelAssignmentSections } from "../systemExtensionConfigurationPresentation";
import type { ConfigSettingsDraftState } from "./configSettingsDraftState";
import { readModelServiceState } from "./modelServiceState";
import {
  isRuntimeModelPoolAssignment,
  readRuntimeModelAssignmentCandidates,
  readRuntimeModelAssignmentFields,
  readRuntimeModelAssignmentSelection,
  readRuntimeModelPoolAssignmentSelection,
  writeRuntimeModelAssignment,
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
        className="min-h-[360px] bg-paper-50"
        description={frontendMessage("settings.state.loadingMain")}
      />
    );
  }
  if (!snapshot || !modelSection || !state) {
    return (
      <StateView
        status="loading"
        className="min-h-[360px] bg-paper-50"
        description={frontendMessage("settings.state.loadingDefaultModel")}
      />
    );
  }

  return (
    <div className="bg-paper-50 px-3 py-4 sm:px-5 sm:py-5">
      <section className="mx-auto max-w-[900px]">
        <header className="border-b border-ink-200/70 pb-3">
          <h2 className="text-[14px] font-semibold text-ink-900">
            {frontendMessage("settings.model.assignmentsTitle")}
          </h2>
          <p className="mt-1 max-w-[720px] text-[12px] leading-5 text-ink-500">
            {frontendMessage("settings.model.assignmentsDescription")}
          </p>
        </header>

        <div className="mt-3 border-y border-ink-200/70">
          {assignmentGroups.map((group) => (
            <section key={group.id} className="border-b border-ink-200/70 last:border-b-0">
              <div className="flex h-9 items-center gap-2 bg-[var(--theme-config-list-bg)] px-3 text-[11.5px] font-semibold text-ink-600">
                <AssignmentGroupIcon fields={group.fields} />
                {group.label}
              </div>
              <div className="divide-y divide-ink-200/70">
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
  const operation =
    field.modelSelection.mutation === "default-model" && pendingModelId
      ? systemConfig.providerModelOperations[pendingModelId]
      : undefined;
  const options = [
    ...(selection.unavailableLabel
      ? [{ value: selection.value, label: selection.unavailableLabel, disabled: true }]
      : []),
    ...candidates.map(({ model, provider }) => ({
      value: model.Id,
      label: `${model.Model} · ${provider.Id}`,
    })),
  ];

  const selectCandidate = (modelId: string): void => {
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
    <div className="grid min-h-[76px] min-w-0 gap-3 bg-paper-50 px-3 py-3 md:grid-cols-[minmax(190px,0.8fr)_minmax(260px,1.2fr)] md:items-center">
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
              candidate={candidates.find((candidate) => candidate.model.Id === value)}
              label={option?.label ?? value}
              unavailable={Boolean(selection.unavailableLabel)}
            />
          )}
          renderOption={(option) => (
            <AssignmentOption
              candidate={candidates.find((candidate) => candidate.model.Id === option.value)}
              label={option.label}
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
    <div className="grid min-h-[76px] min-w-0 gap-3 bg-paper-50 px-3 py-3 md:grid-cols-[minmax(190px,0.8fr)_minmax(260px,1.2fr)] md:items-start">
      <AssignmentLabel field={field} />

      <div className="min-w-0">
        <div className="divide-y divide-ink-200/70 border-y border-ink-200/70">
          {hasInheritance ? (
            <div className="flex min-h-10 min-w-0 items-center gap-2 px-1.5 py-1">
              <AssignmentPriority value={selection.inheritanceEnabled ? 1 : undefined} />
              <GitFork className="h-3.5 w-3.5 shrink-0 text-ink-500" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] font-medium text-ink-800">{inheritanceSourceLabel(field)}</div>
                <div className="truncate text-[10.5px] text-ink-450">
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
            const priority = index + 1 + Number(hasInheritance && selection.inheritanceEnabled);
            const unavailable = !candidate;
            const cannotRemove = sourceCount <= 1;
            return (
              <div key={`${modelId}:${index}`} className="flex min-h-10 min-w-0 items-center gap-2 px-1.5 py-1">
                <AssignmentPriority value={priority} />
                <span className="min-w-0 flex-1">
                  <AssignmentOption candidate={candidate} label={modelId} unavailable={unavailable} />
                </span>
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
        </div>

        <div className="mt-2">
          <MenuSelect
            value=""
            placeholder={field.placeholder ?? frontendMessage("settings.model.poolAdd")}
            ariaLabel={frontendMessage("settings.model.poolAdd")}
            options={availableCandidates.map(({ model, provider }) => ({
              value: model.Id,
              label: `${model.Model} · ${provider.Id}`,
            }))}
            disabled={availableCandidates.length === 0}
            emptyState={frontendMessage("settings.model.poolNoAdditionalCandidates")}
            leading={<Plus className="h-3.5 w-3.5" />}
            renderOption={(option) => (
              <AssignmentOption candidate={candidatesById.get(option.value)} label={option.label} />
            )}
            onChange={addModel}
          />
        </div>

        {selection.modelIds.some((modelId) => !candidatesById.has(modelId)) ? (
          <p className="mt-1.5 text-[11px] leading-4 text-umber-600">
            {frontendMessage("settings.model.poolUnavailable")}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function AssignmentLabel({ field }: { field: RuntimeModelAssignmentField }): JSX.Element {
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md border border-ink-200/70 bg-paper-100 text-ink-500">
        <AssignmentCapabilityIcon capability={field.modelSelection.capability} />
      </span>
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-[12.5px] font-medium text-ink-850">{field.label}</span>
          <ConfigFieldRequirementLabel required={field.modelSelection.required} />
        </div>
        {field.description ? <p className="mt-0.5 text-[11px] leading-4 text-ink-500">{field.description}</p> : null}
      </div>
    </div>
  );
}

function AssignmentPriority({ value }: { value?: number }): JSX.Element {
  return (
    <span className="w-4 shrink-0 text-center font-mono text-[10px] tabular-nums text-ink-400">{value ?? "-"}</span>
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
  candidate,
  label,
  unavailable,
}: {
  candidate?: RuntimeModelAssignmentCandidate;
  label: string;
  unavailable?: boolean;
}): JSX.Element {
  const icon = candidate?.model.Icon ?? inferModelProviderIcon(candidate?.model.Model ?? label);
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2", unavailable && "text-umber-600")}>
      <ModelProviderIcon icon={icon} size={16} />
      <span className="truncate">{label}</span>
    </span>
  );
}

function AssignmentGroupIcon({ fields }: { fields: readonly RuntimeModelAssignmentField[] }): JSX.Element {
  const capability = fields[0]?.modelSelection.capability;
  const Icon: ComponentType<{ className?: string }> = fields.some(isRuntimeModelPoolAssignment)
    ? GitFork
    : capability === "Embedding"
      ? Search
      : capability === "Rerank"
        ? ListFilter
        : capability === "Chat"
          ? BrainCircuit
          : Target;
  return <Icon className="h-3.5 w-3.5 text-ink-500" />;
}

function AssignmentCapabilityIcon({
  capability,
}: {
  capability: RuntimeModelAssignmentField["modelSelection"]["capability"];
}): JSX.Element {
  const Icon = capability === "Embedding" ? Search : capability === "Rerank" ? ListFilter : BrainCircuit;
  return <Icon className="h-3.5 w-3.5" />;
}
