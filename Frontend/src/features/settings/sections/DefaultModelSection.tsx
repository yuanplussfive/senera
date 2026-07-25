import { useMemo, useState, type ComponentType } from "react";
import { BrainCircuit, Check, ListFilter, Loader2, Search, Target } from "lucide-react";
import { frontendMessage } from "../../../i18n/frontendMessageCatalog";
import type { ConfigFormFieldData } from "../../../api/eventTypes";
import { MenuSelect } from "../../../shared/ui";
import { findTopField } from "../../chat/modelConfigData";
import { ModelProviderIcon, inferModelProviderIcon } from "../../chat/ModelProviderIcon";
import { ConfigFieldRequirementLabel } from "../../../shared/config/ConfigFieldVisibility";
import { cn } from "../../../lib/util";
import { SettingsWorkspaceState } from "../SettingsWorkspaceSurface";
import type { SettingsSystemConfigHandle } from "../SettingsContracts";
import type { ConfigSettingsDraftState } from "./configSettingsDraftState";
import { readModelServiceState } from "./modelServiceState";
import {
  readRuntimeModelAssignmentCandidates,
  readRuntimeModelAssignmentFields,
  readRuntimeModelAssignmentSelection,
  writeRuntimeModelAssignment,
  type RuntimeModelAssignmentCandidate,
  type RuntimeModelAssignmentField,
} from "./runtimeModelAssignments";

export function DefaultModelSection({
  draftState,
  systemConfig,
}: {
  draftState: ConfigSettingsDraftState;
  systemConfig?: SettingsSystemConfigHandle;
}): JSX.Element {
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
  const assignmentGroups = useMemo(() => {
    if (!snapshot) return [];
    const fields = readRuntimeModelAssignmentFields(snapshot.form.sections);
    return snapshot.form.sections.flatMap((section) => {
      const assignments = fields.filter((field) => field.section === section.name);
      return assignments.length > 0 ? [{ id: section.name, label: section.label, fields: assignments }] : [];
    });
  }, [snapshot]);
  const allFields = useMemo(() => snapshot?.form.sections.flatMap((section) => section.fields) ?? [], [snapshot]);
  const defaultModelId = state?.defaultModel?.model.Id ?? "";

  if (!systemConfig) {
    return <SettingsWorkspaceState>{frontendMessage("settings.state.loadingMain")}</SettingsWorkspaceState>;
  }
  if (!snapshot || !modelSection || !state) {
    return <SettingsWorkspaceState>{frontendMessage("settings.state.loadingDefaultModel")}</SettingsWorkspaceState>;
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
                <AssignmentGroupIcon groupId={group.id} />
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
      <div className="flex min-w-0 items-start gap-2.5">
        <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md border border-ink-200/70 bg-paper-100 text-ink-450">
          <AssignmentCapabilityIcon capability={field.modelSelection.capability} />
        </span>
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-[12.5px] font-medium text-ink-850">{field.label}</span>
            <ConfigFieldRequirementLabel required={field.modelSelection.required} />
          </div>
          {field.description ? <p className="mt-0.5 text-[11px] leading-4 text-ink-450">{field.description}</p> : null}
        </div>
      </div>

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
              <Loader2 className="h-3.5 w-3.5 animate-spin text-ink-400" />
            ) : operation?.status === "success" ? (
              <Check className="h-3.5 w-3.5 text-moss-700" />
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
    <span className={cn("inline-flex min-w-0 items-center gap-2", unavailable && "text-umber-700")}>
      <ModelProviderIcon icon={icon} size={16} />
      <span className="truncate">{label}</span>
    </span>
  );
}

function AssignmentGroupIcon({ groupId }: { groupId: string }): JSX.Element {
  const Icon: ComponentType<{ className?: string }> =
    groupId === "planning" ? BrainCircuit : groupId === "retrieval" ? Search : Target;
  return <Icon className="h-3.5 w-3.5 text-ink-450" />;
}

function AssignmentCapabilityIcon({
  capability,
}: {
  capability: RuntimeModelAssignmentField["modelSelection"]["capability"];
}): JSX.Element {
  const Icon = capability === "Embedding" ? Search : capability === "Rerank" ? ListFilter : BrainCircuit;
  return <Icon className="h-3.5 w-3.5" />;
}
