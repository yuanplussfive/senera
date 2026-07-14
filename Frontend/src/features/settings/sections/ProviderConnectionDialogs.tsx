import { Pencil, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogActionButton,
  DialogActions,
  DialogContent,
  FormField,
  FormHint,
  FormLabel,
  Input,
} from "../../../shared/ui";
import { ModelProviderIcon } from "../../chat/ModelProviderIcon";
import { MenuSelect } from "../../chat/ModelConfigPrimitives";
import { normalizeProviderEndpointDraft } from "../../chat/modelConfigData";
import type { ProviderEndpointDraft } from "../../chat/modelConfigTypes";
import { ProviderFormError } from "./ProviderConnectionFeedback";
import { isProtectedProvider, providerPresets } from "./ProviderConnectionIdentity";

// TODO: providerPresets currently select compatible OpenAI-style connections.
// Native OpenAI Responses, Gemini, Anthropic, and other protocol adapters need
// dedicated backend endpoint behavior before they can be advertised as types.

export function AddProviderDialog({
  open,
  providers,
  onAdd,
  onOpenChange,
}: {
  open: boolean;
  providers: readonly ProviderEndpointDraft[];
  onAdd: (provider: ProviderEndpointDraft) => void;
  onOpenChange: (open: boolean) => void;
}): JSX.Element {
  const [providerId, setProviderId] = useState("");
  const [presetId, setPresetId] = useState<string>(providerPresets[0]?.id ?? "custom");
  const preset = providerPresets.find((entry) => entry.id === presetId) ?? providerPresets[0];
  const duplicate = providerId.trim()
    ? providers.some((provider) => provider.Id === providerId.trim()) || isProtectedProvider(providerId.trim())
    : false;
  const invalid = !providerId.trim() || duplicate;

  useEffect(() => {
    if (!open) return;
    setProviderId("");
    setPresetId(providerPresets[0]?.id ?? "custom");
  }, [open]);

  const submit = (): void => {
    const id = providerId.trim();
    if (!id || duplicate || !preset) return;
    onAdd(
      normalizeProviderEndpointDraft({
        Id: id,
        Icon: preset.icon,
        Enabled: true,
        Kind: "OpenAICompatible",
        BaseUrl: preset.baseUrl,
        ApiKey: "",
        ApiVersion: preset.apiVersion ?? "2023-06-01",
        Headers: preset.headers ?? {},
      }),
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="添加自定义供应商"
        description="创建供应商身份后，在连接页配置 API 地址和密钥。"
        className="min-h-[540px] w-[min(600px,calc(100vw_-_32px))]"
        bodyClassName="flex min-h-0 flex-1 flex-col px-8 pb-7 pt-3"
      >
        <div className="grid gap-6">
          <FormField>
            <FormLabel required>供应商名称</FormLabel>
            <Input
              autoFocus
              value={providerId}
              placeholder="例如 OpenAI"
              aria-invalid={duplicate}
              onChange={(event) => setProviderId(event.currentTarget.value)}
            />
            <FormHint>名称用于模型服务列表和模型关联。</FormHint>
          </FormField>
          <FormField>
            <FormLabel>类型 / 预设</FormLabel>
            <MenuSelect
              value={presetId}
              placeholder="选择预设"
              options={providerPresets.map((entry) => ({ value: entry.id, label: entry.label }))}
              disabled={false}
              triggerClassName="h-11 rounded-lg px-3.5 text-[14px] hover:border-ink-300"
              renderValue={(value) => {
                const current = providerPresets.find((entry) => entry.id === value);
                return current ? (
                  <span className="inline-flex min-w-0 items-center gap-2">
                    <ModelProviderIcon icon={current.icon} size={18} />
                    <span className="truncate">{current.label}</span>
                  </span>
                ) : null;
              }}
              renderOption={(option) => {
                const current = providerPresets.find((entry) => entry.id === option.value);
                return current ? (
                  <span className="inline-flex min-w-0 items-center gap-2">
                    <ModelProviderIcon icon={current.icon} size={16} />
                    <span className="truncate">{current.label}</span>
                  </span>
                ) : (
                  option.label
                );
              }}
              onChange={setPresetId}
            />
            <FormHint>预设只填充兼容协议和默认地址，之后仍可修改连接配置。</FormHint>
          </FormField>
          {duplicate ? <ProviderFormError message="这个供应商名称已存在或属于内置身份，请换一个自定义名称。" /> : null}
        </div>
        <DialogActions className="mt-auto">
          <DialogActionButton onClick={() => onOpenChange(false)}>取消</DialogActionButton>
          <DialogActionButton variant="primary" disabled={invalid} onClick={submit}>
            <span className="inline-flex items-center gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              添加
            </span>
          </DialogActionButton>
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}

export function RenameProviderDialog({
  provider,
  providers,
  onOpenChange,
  onRename,
}: {
  provider: ProviderEndpointDraft | null;
  providers: readonly ProviderEndpointDraft[];
  onOpenChange: (open: boolean) => void;
  onRename: (providerId: string, nextProviderId: string) => void;
}): JSX.Element {
  const [nextProviderId, setNextProviderId] = useState("");
  const open = Boolean(provider);

  useEffect(() => {
    setNextProviderId(provider?.Id ?? "");
  }, [provider]);

  const targetId = nextProviderId.trim();
  const invalid =
    !provider ||
    !targetId ||
    targetId === provider.Id ||
    providers.some((entry) => entry.Id === targetId) ||
    isProtectedProvider(targetId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="重命名供应商"
        description="只用于自定义供应商身份；关联模型引用由后端命令一起更新。"
        className="min-h-[420px] w-[min(560px,calc(100vw_-_32px))]"
        bodyClassName="flex min-h-0 flex-1 flex-col px-8 pb-7 pt-3"
      >
        <div>
          <FormField>
            <FormLabel required>新的供应商名称</FormLabel>
            <Input
              autoFocus
              value={nextProviderId}
              aria-invalid={Boolean(
                targetId &&
                targetId !== provider?.Id &&
                (providers.some((entry) => entry.Id === targetId) || isProtectedProvider(targetId)),
              )}
              onChange={(event) => setNextProviderId(event.currentTarget.value)}
            />
          </FormField>
          {targetId &&
          targetId !== provider?.Id &&
          (providers.some((entry) => entry.Id === targetId) || isProtectedProvider(targetId)) ? (
            <ProviderFormError message="这个名称已存在或属于内置身份。" />
          ) : null}
        </div>
        <DialogActions className="mt-auto">
          <DialogActionButton onClick={() => onOpenChange(false)}>取消</DialogActionButton>
          <DialogActionButton
            variant="primary"
            disabled={invalid}
            onClick={() => provider && onRename(provider.Id, targetId)}
          >
            <span className="inline-flex items-center gap-1.5">
              <Pencil className="h-3.5 w-3.5" />
              重命名
            </span>
          </DialogActionButton>
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}
