import { useEffect, useMemo, useState } from "react";
import { frontendMessage } from "../../../i18n/frontendMessageCatalog";
import { Dialog, DialogActionButton, DialogActions, DialogContent } from "../../../shared/ui";
import type { ModelProviderDraft, ProviderEndpointDraft } from "../../chat/modelConfigTypes";

export interface DefaultModelCandidate {
  model: ModelProviderDraft;
  provider: ProviderEndpointDraft;
}

export function ProviderModelLifecycleDialogs({
  candidateModels,
  defaultModelId,
  disabled,
  modelToRemove,
  models,
  providerToRemove,
  onCloseModelRemoval,
  onCloseProviderRemoval,
  onConfirmModelRemoval,
  onConfirmProviderRemoval,
}: {
  candidateModels: readonly DefaultModelCandidate[];
  defaultModelId: string | null;
  disabled: boolean;
  modelToRemove: ModelProviderDraft | null;
  models: readonly ModelProviderDraft[];
  providerToRemove: ProviderEndpointDraft | null;
  onCloseModelRemoval: () => void;
  onCloseProviderRemoval: () => void;
  onConfirmModelRemoval: (input: { modelId: string; replacementDefaultModelId?: string }) => boolean;
  onConfirmProviderRemoval: (input: {
    providerId: string;
    cascadeModels: boolean;
    replacementDefaultModelId?: string;
  }) => boolean;
}): JSX.Element {
  const providerModels = useMemo(
    () => (providerToRemove ? models.filter((model) => model.ProviderId === providerToRemove.Id) : []),
    [models, providerToRemove],
  );

  return (
    <>
      <ModelRemovalDialog
        candidateModels={candidateModels}
        defaultModelId={defaultModelId}
        disabled={disabled}
        model={modelToRemove}
        onClose={onCloseModelRemoval}
        onConfirm={onConfirmModelRemoval}
      />
      <ProviderRemovalDialog
        candidateModels={candidateModels}
        defaultModelId={defaultModelId}
        disabled={disabled}
        provider={providerToRemove}
        providerModels={providerModels}
        onClose={onCloseProviderRemoval}
        onConfirm={onConfirmProviderRemoval}
      />
    </>
  );
}

function ModelRemovalDialog({
  candidateModels,
  defaultModelId,
  disabled,
  model,
  onClose,
  onConfirm,
}: {
  candidateModels: readonly DefaultModelCandidate[];
  defaultModelId: string | null;
  disabled: boolean;
  model: ModelProviderDraft | null;
  onClose: () => void;
  onConfirm: (input: { modelId: string; replacementDefaultModelId?: string }) => boolean;
}): JSX.Element {
  const [replacementDefaultModelId, setReplacementDefaultModelId] = useState("");
  const requiresReplacement = Boolean(model && model.Id === defaultModelId);
  const replacements = useMemo(
    () => candidateModels.filter((candidate) => candidate.model.Id !== model?.Id),
    [candidateModels, model?.Id],
  );

  useEffect(() => {
    setReplacementDefaultModelId("");
  }, [model?.Id]);

  const canConfirm = Boolean(model) && !disabled && (!requiresReplacement || Boolean(replacementDefaultModelId));

  return (
    <Dialog open={Boolean(model)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={frontendMessage("settings.modelLifecycle.removeModel.title")}
        description={
          requiresReplacement && model
            ? frontendMessage("settings.modelLifecycle.removeDefault.description", { model: model.Model })
            : frontendMessage("settings.modelLifecycle.removeModel.description")
        }
        className="w-[min(480px,calc(100vw_-_28px))] rounded-lg bg-paper-50"
        bodyClassName="p-4"
      >
        {requiresReplacement ? (
          <ReplacementControl
            candidateModels={replacements}
            value={replacementDefaultModelId}
            disabled={disabled}
            onChange={setReplacementDefaultModelId}
          />
        ) : null}
        <DialogActions className="mt-5">
          <DialogActionButton close>{frontendMessage("settings.modelLifecycle.cancel")}</DialogActionButton>
          <DialogActionButton
            disabled={!canConfirm}
            variant="danger"
            onClick={() => {
              if (!model) return;
              const accepted = onConfirm({
                modelId: model.Id,
                ...(requiresReplacement ? { replacementDefaultModelId } : {}),
              });
              if (accepted) onClose();
            }}
          >
            {requiresReplacement
              ? frontendMessage("settings.modelLifecycle.confirmReplaceRemoveModel")
              : frontendMessage("settings.modelLifecycle.confirmRemoveModel")}
          </DialogActionButton>
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}

function ProviderRemovalDialog({
  candidateModels,
  defaultModelId,
  disabled,
  provider,
  providerModels,
  onClose,
  onConfirm,
}: {
  candidateModels: readonly DefaultModelCandidate[];
  defaultModelId: string | null;
  disabled: boolean;
  provider: ProviderEndpointDraft | null;
  providerModels: readonly ModelProviderDraft[];
  onClose: () => void;
  onConfirm: (input: { providerId: string; cascadeModels: boolean; replacementDefaultModelId?: string }) => boolean;
}): JSX.Element {
  const [replacementDefaultModelId, setReplacementDefaultModelId] = useState("");
  const associatedModelIds = useMemo(() => new Set(providerModels.map((model) => model.Id)), [providerModels]);
  const requiresReplacement = Boolean(defaultModelId && associatedModelIds.has(defaultModelId));
  const replacements = useMemo(
    () => candidateModels.filter((candidate) => candidate.provider.Id !== provider?.Id),
    [candidateModels, provider?.Id],
  );

  useEffect(() => {
    setReplacementDefaultModelId("");
  }, [provider?.Id]);

  const cascadeModels = providerModels.length > 0;
  const canConfirm = Boolean(provider) && !disabled && (!requiresReplacement || Boolean(replacementDefaultModelId));
  const description = provider
    ? cascadeModels
      ? frontendMessage("settings.modelLifecycle.deleteProvider.withModels", {
          provider: provider.Id,
          count: providerModels.length,
        })
      : frontendMessage("settings.modelLifecycle.deleteProvider.none", { provider: provider.Id })
    : "";

  return (
    <Dialog open={Boolean(provider)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={frontendMessage("settings.modelLifecycle.deleteProvider.title")}
        description={description}
        className="w-[min(520px,calc(100vw_-_28px))] rounded-lg bg-paper-50"
        bodyClassName="p-4"
      >
        <div className="space-y-4">
          {cascadeModels ? (
            <section className="rounded-lg border border-ink-200/70 bg-paper-100/65 p-3">
              <h3 className="text-[12px] font-semibold text-ink-750">
                {frontendMessage("settings.modelLifecycle.affectedModels")}
              </h3>
              <ul className="mt-2 space-y-1 text-[12px] text-ink-600">
                {providerModels.map((model) => (
                  <li key={model.Id} className="truncate">
                    {model.Model}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {requiresReplacement ? (
            <ReplacementControl
              candidateModels={replacements}
              value={replacementDefaultModelId}
              disabled={disabled}
              onChange={setReplacementDefaultModelId}
            />
          ) : null}
        </div>
        <DialogActions className="mt-5">
          <DialogActionButton close>{frontendMessage("settings.modelLifecycle.cancel")}</DialogActionButton>
          <DialogActionButton
            disabled={!canConfirm}
            variant="danger"
            onClick={() => {
              if (!provider) return;
              const accepted = onConfirm({
                providerId: provider.Id,
                cascadeModels,
                ...(requiresReplacement ? { replacementDefaultModelId } : {}),
              });
              if (accepted) onClose();
            }}
          >
            {requiresReplacement
              ? frontendMessage("settings.modelLifecycle.confirmReplaceDeleteProvider")
              : cascadeModels
                ? frontendMessage("settings.modelLifecycle.confirmCascadeProvider", { count: providerModels.length })
                : frontendMessage("settings.modelLifecycle.confirmDeleteProvider")}
          </DialogActionButton>
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}

function ReplacementControl({
  candidateModels,
  value,
  disabled,
  onChange,
}: {
  candidateModels: readonly DefaultModelCandidate[];
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}): JSX.Element {
  return (
    <label className="block space-y-1.5">
      <span className="text-[12px] font-medium text-ink-750">
        {frontendMessage("settings.modelLifecycle.replacement.label")}
      </span>
      <select
        value={value}
        disabled={disabled || candidateModels.length === 0}
        aria-label={frontendMessage("settings.modelLifecycle.replacement.label")}
        className="h-9 w-full rounded-md border border-ink-200 bg-paper-50 px-2.5 text-[12.5px] text-ink-800 outline-none focus:border-terra-300 focus:ring-2 focus:ring-terra-100 disabled:cursor-not-allowed disabled:opacity-60"
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        <option value="">{frontendMessage("settings.modelLifecycle.replacement.placeholder")}</option>
        {candidateModels.map(({ model, provider }) => (
          <option key={model.Id} value={model.Id}>
            {model.Model} · {provider.Id}
          </option>
        ))}
      </select>
      {candidateModels.length === 0 ? (
        <p className="rounded-md border border-ink-200 bg-paper-100 px-3 py-2 text-[12px] leading-5 text-ink-700">
          {frontendMessage("settings.modelLifecycle.noReplacement")}
        </p>
      ) : null}
    </label>
  );
}
