import { useEffect, useMemo, useState } from "react";
import { frontendMessage } from "../../../i18n/frontendMessageCatalog";
import { Dialog, DialogActionButton, DialogActions, DialogContent } from "../../../shared/ui";
import { ModelSelect, modelSelectOption } from "../../../shared/models/ModelSelect";
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
        className="w-[min(420px,calc(100vw-28px))]"
        bodyClassName="p-4"
        footerClassName="px-4"
        footer={
          <DialogActions>
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
        }
      >
        {requiresReplacement ? (
          <ReplacementControl
            candidateModels={replacements}
            value={replacementDefaultModelId}
            disabled={disabled}
            onChange={setReplacementDefaultModelId}
          />
        ) : null}
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
        className="w-[min(420px,calc(100vw-28px))]"
        bodyClassName="p-4"
        footerClassName="px-4"
        footer={
          <DialogActions>
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
        }
      >
        <div className="space-y-4">
          {cascadeModels ? (
            <section className="rounded-lg border border-line bg-surface-muted p-3">
              <h3 className="text-[12px] font-semibold text-content-primary">
                {frontendMessage("settings.modelLifecycle.affectedModels")}
              </h3>
              <ul className="mt-2 space-y-1 text-[12px] text-content-secondary">
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
    <div className="block space-y-1.5">
      <span className="text-[12px] font-medium text-ink-800">
        {frontendMessage("settings.modelLifecycle.replacement.label")}
      </span>
      <ModelSelect
        ariaLabel={frontendMessage("settings.modelLifecycle.replacement.label")}
        value={value}
        placeholder={frontendMessage("settings.modelLifecycle.replacement.placeholder")}
        disabled={disabled || candidateModels.length === 0}
        options={candidateModels.map(({ model, provider }) =>
          modelSelectOption({
            id: model.Id,
            model: model.Model,
            providerId: provider.Id,
            icon: model.Icon ?? provider.Icon,
          }),
        )}
        onChange={onChange}
      />
      {candidateModels.length === 0 ? (
        <p className="rounded-md border border-ink-200 bg-paper-100 px-3 py-2 text-[12px] leading-5 text-ink-700">
          {frontendMessage("settings.modelLifecycle.noReplacement")}
        </p>
      ) : null}
    </div>
  );
}
