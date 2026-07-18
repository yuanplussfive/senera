import { useMemo, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { Button } from "../../../shared/ui";
import { findTopField } from "../../chat/modelConfigData";
import { MenuSelect } from "../../chat/ModelConfigPrimitives";
import { SettingsWorkspaceState } from "../SettingsWorkspaceSurface";
import type { SettingsSystemConfigHandle } from "../SettingsContracts";
import { readDefaultAssistantModelCandidates, readModelServiceState } from "./modelServiceState";

const EMPTY_DRAFT: Record<string, unknown> = {};

/** Dedicated immediate-save surface for the runtime assistant model. */
export function DefaultModelSection({ systemConfig }: { systemConfig?: SettingsSystemConfigHandle }): JSX.Element {
  const [pendingModelId, setPendingModelId] = useState<string | null>(null);
  const snapshot = systemConfig?.configSnapshot ?? null;
  const modelSection = snapshot?.form.sections.find((section) => section.name === "models") ?? null;
  const state =
    systemConfig && snapshot && modelSection
      ? readModelServiceState({
          catalogs: systemConfig.providerModelCatalogs,
          draft: EMPTY_DRAFT,
          errors: systemConfig.providerModelErrors,
          loadingIds: systemConfig.providerModelLoadingIds,
          section: modelSection,
        })
      : null;
  const modelTemplate = useMemo(
    () => findTopField(modelSection ?? undefined, "ModelProviders")?.defaultItem ?? {},
    [modelSection],
  );
  const candidates = useMemo(
    () =>
      state
        ? readDefaultAssistantModelCandidates({
            models: state.models,
            providers: state.providers,
            modelTemplate,
          })
        : [],
    [modelTemplate, state],
  );
  const currentModelId = state?.defaultSlots.find((slot) => slot.definition.id === "assistant")?.selectedModelId ?? "";
  const currentDefaultSlot = state?.defaultSlots.find((slot) => slot.definition.id === "assistant");
  const operation = pendingModelId ? systemConfig?.providerModelOperations[pendingModelId] : undefined;
  const operationError = operation?.status === "error" ? operation.message : null;
  const operationPending = operation?.status === "pending";

  if (!systemConfig) {
    return <SettingsWorkspaceState>正在连接主配置服务</SettingsWorkspaceState>;
  }
  if (!snapshot || !modelSection || !state) {
    return <SettingsWorkspaceState>主配置连接后会加载默认模型</SettingsWorkspaceState>;
  }

  const selectModel = (modelId: string): void => {
    if (!modelId || modelId === currentModelId) return;
    const requestId = systemConfig.setDefaultProviderModel(modelId);
    if (requestId) setPendingModelId(modelId);
  };

  return (
    <div className="bg-paper-50 p-3 sm:p-4">
      <section className="mx-auto max-w-[760px]">
        <div className="border-b border-ink-200/70 pb-3">
          <h2 className="text-[14px] font-semibold text-ink-900">默认助手模型</h2>
          <p className="mt-1 text-[12px] leading-5 text-ink-500">
            选择一个已配置、供应商已启用且支持对话的模型；更改会立即保存，并作为新建对话的初始模型。当前对话可在聊天模型菜单中恢复为默认。
          </p>
        </div>
        <div className="space-y-3 px-1 pt-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1" aria-label="默认助手模型">
              <MenuSelect
                value={currentModelId}
                placeholder="选择默认助手模型"
                options={candidates.map(({ model, provider }) => ({
                  value: model.Id,
                  label: `${model.Model} · ${provider.Id}`,
                }))}
                disabled={candidates.length === 0 || operationPending}
                onChange={selectModel}
              />
            </div>
            {operationPending ? (
              <Button size="sm" variant="outline" disabled>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> 保存中
              </Button>
            ) : operation?.status === "success" ? (
              <span className="inline-flex h-8 items-center gap-1.5 rounded-md border border-moss-200 bg-moss-50 px-2.5 text-[11.5px] font-medium text-moss-700">
                <Check className="h-3.5 w-3.5" /> 已保存
              </span>
            ) : null}
          </div>
          {candidates.length === 0 ? (
            <p className="rounded-md border border-ink-200 bg-paper-100 px-3 py-2 text-[12px] leading-5 text-ink-700">
              暂无可用候选。请先在模型服务中启用供应商并配置支持对话的模型。
            </p>
          ) : null}
          {currentDefaultSlot && currentDefaultSlot.status !== "ready" && currentModelId ? (
            <p className="rounded-md border border-ink-200 bg-paper-100 px-3 py-2 text-[12px] leading-5 text-ink-700">
              当前默认助手模型不可用（{currentDefaultSlot.statusLabel}），请选择一个可用候选。
            </p>
          ) : null}
          {operationError ? (
            <p className="rounded-md border border-brick-200 bg-brick-50 px-3 py-2 text-[12px] leading-5 text-brick-700">
              保存失败：{operationError}
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
