import { Pencil, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "../../../lib/util";
import { Button, Dialog, DialogContent } from "../../../shared/ui";
import { ModelProviderIcon } from "../../chat/ModelProviderIcon";
import { inputClassName, MenuSelect } from "../../chat/ModelConfigPrimitives";
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
        title="添加供应商"
        description="先创建供应商身份；密钥和地址会在右侧连接表单里确认。"
        className="w-[min(460px,calc(100vw_-_24px))] rounded-xl bg-paper-50"
      >
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-ink-700">供应商名称</span>
            <input
              value={providerId}
              placeholder="custom-openai"
              className={cn(inputClassName, "rounded-md border border-ink-200 bg-paper-50")}
              onChange={(event) => setProviderId(event.currentTarget.value)}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-ink-700">类型 / 预设</span>
            <MenuSelect
              value={presetId}
              placeholder="选择预设"
              options={providerPresets.map((entry) => ({ value: entry.id, label: entry.label }))}
              disabled={false}
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
          </label>
          {duplicate ? <ProviderFormError message="这个供应商名称已存在或属于内置身份，请换一个自定义名称。" /> : null}
          <div className="flex justify-end gap-2 pt-2">
            <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button size="sm" disabled={invalid} onClick={submit}>
              <Plus className="h-3.5 w-3.5" />
              添加
            </Button>
          </div>
        </div>
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
        className="w-[min(420px,calc(100vw_-_24px))] rounded-xl bg-paper-50"
      >
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-ink-700">新的供应商名称</span>
            <input
              value={nextProviderId}
              className={cn(inputClassName, "rounded-md border border-ink-200 bg-paper-50")}
              onChange={(event) => setNextProviderId(event.currentTarget.value)}
            />
          </label>
          {targetId &&
          targetId !== provider?.Id &&
          (providers.some((entry) => entry.Id === targetId) || isProtectedProvider(targetId)) ? (
            <ProviderFormError message="这个名称已存在或属于内置身份。" />
          ) : null}
          <div className="flex justify-end gap-2 pt-2">
            <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button size="sm" disabled={invalid} onClick={() => provider && onRename(provider.Id, targetId)}>
              <Pencil className="h-3.5 w-3.5" />
              重命名
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
