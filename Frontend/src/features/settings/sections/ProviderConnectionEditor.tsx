import {
  Check,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Server,
  Settings2,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import type { SettingsConfigCommands } from "../SettingsContracts";
import {
  Button,
  ScrollArea,
} from "../../../shared/ui";
import {
  inferModelProviderIcon,
  ModelProviderIcon,
  ModelProviderIconNames,
} from "../../chat/ModelProviderIcon";
import {
  DetailTitle,
  EmptyDetail,
  IconAction,
  inputClassName,
  MenuRow,
  MenuSelect,
  ProviderCatalogStatus,
  SettingRow,
  SettingsTable,
  TextRow,
  ToggleRow,
} from "../../chat/ModelConfigPrimitives";
import {
  nextHeaderKey,
  providerEnabled,
  providerIdLabel,
} from "../../chat/modelConfigData";
import type { ProviderEndpointDraft } from "../../chat/modelConfigTypes";
import { ProviderConnectionStatusBadge, ProviderFormError } from "./ProviderConnectionFeedback";
import { isProtectedProvider } from "./ProviderConnectionIdentity";

export function ProviderConnectionEditor({
  acceptedProvider,
  catalog,
  dirty,
  draftProvider,
  disabled,
  error,
  loading,
  localError,
  operation,
  providerModelCount,
  providerIndex,
  onCancel,
  onChange,
  onConfirm,
  onDelete,
  onFetch,
}: {
  acceptedProvider: ProviderEndpointDraft | null;
  catalog?: SettingsConfigCommands["providerModelCatalogs"][string];
  dirty: boolean;
  draftProvider: ProviderEndpointDraft | null;
  disabled: boolean;
  error?: SettingsConfigCommands["providerModelErrors"][string];
  loading: boolean;
  localError: string | null;
  operation?: SettingsConfigCommands["providerEndpointOperations"][string];
  providerModelCount: number;
  providerIndex: number;
  onCancel: () => void;
  onChange: (patch: Partial<ProviderEndpointDraft>) => void;
  onConfirm: () => void;
  onDelete?: () => void;
  onFetch: (force?: boolean) => void;
}): JSX.Element {
  const [showKey, setShowKey] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const provider = draftProvider;

  if (!provider || !acceptedProvider || providerIndex < 0) {
    return (
      <EmptyDetail
        icon={<Server className="h-5 w-5" />}
        title="选择供应商"
        text="添加或选择供应商后，在这里确认连接字段。"
      />
    );
  }

  const enabled = providerEnabled(provider);
  const protectedProvider = isProtectedProvider(provider.Id);
  const pending = operation?.status === "pending";
  const operationError = operation?.status === "error" ? operation.message : null;
  const confirmDisabled = disabled || pending || !dirty || !provider.Id.trim();
  const iconOptions = ModelProviderIconNames.map((icon) => ({ value: icon, label: icon }));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ScrollArea className="min-h-0 flex-1" viewportClassName="h-full">
        <div className="mx-auto w-full max-w-[420px] px-3 py-4">
        <DetailTitle
          icon={<ModelProviderIcon icon={provider.Icon || inferModelProviderIcon(provider.Id)} size={22} />}
          title={providerIdLabel(provider)}
          subtitle={readProviderConnectionSubtitle({
            dirty,
            enabled,
            operation,
            protectedProvider,
            providerModelCount,
          })}
          actions={(
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={disabled || loading || !enabled || !provider.Id}
                onClick={() => onFetch(true)}
              >
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                管理模型
              </Button>
              {onDelete ? (
                <IconAction label="删除供应商" danger disabled={disabled || protectedProvider} onClick={onDelete}>
                  <Trash2 className="h-3.5 w-3.5" />
                </IconAction>
              ) : null}
            </>
          )}
        />

        <div className="mb-3 flex flex-wrap items-center gap-2">
          {protectedProvider ? (
            <span className="rounded-md border border-ink-200 bg-ink-900/[0.035] px-2 py-1 text-[11px] font-medium text-ink-500">
              内置身份
            </span>
          ) : (
            <span className="rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-[11px] font-medium text-sky-700">
              自定义身份
            </span>
          )}
        </div>

        <SettingsTable>
          <ToggleRow
            label="启用供应商"
            enabled={enabled}
            disabled={disabled || pending}
            onChange={(Enabled) => onChange({ Enabled })}
          />
          <SettingRow
            icon={<Server className="h-3.5 w-3.5" />}
            label="供应商"
            description={protectedProvider ? "内置供应商身份不能在这里重命名。" : "重命名请使用左侧行操作。"}
          >
            <div className="rounded-md border border-ink-200 bg-paper-50 px-2.5 py-2 font-mono text-[12.5px] text-ink-700">
              {provider.Id}
            </div>
          </SettingRow>
          <MenuRow icon={<Settings2 className="h-3.5 w-3.5" />} label="图标">
            <MenuSelect
              value={provider.Icon ?? ""}
              placeholder="选择图标"
              options={iconOptions}
              disabled={disabled || pending}
              renderValue={(value) => value ? (
                <span className="inline-flex min-w-0 items-center gap-2">
                  <ModelProviderIcon icon={value} size={18} />
                  <span className="truncate">{value}</span>
                </span>
              ) : null}
              renderOption={(option) => (
                <span className="inline-flex min-w-0 items-center gap-2">
                  <ModelProviderIcon icon={option.value} size={16} />
                  <span className="truncate">{option.label}</span>
                </span>
              )}
              onChange={(Icon) => onChange({ Icon })}
            />
          </MenuRow>
          <TextRow
            icon={<Server className="h-3.5 w-3.5" />}
            label="Base URL"
            value={provider.BaseUrl ?? ""}
            disabled={disabled || pending}
            placeholder="https://.../v1"
            onChange={(BaseUrl) => onChange({ BaseUrl })}
          />
          <TextRow
            icon={<KeyRound className="h-3.5 w-3.5" />}
            label="API Key"
            value={provider.ApiKey ?? ""}
            disabled={disabled || pending}
            secret={!showKey}
            placeholder="sk-..."
            trailing={(
              <button
                type="button"
                className="grid h-8 w-8 shrink-0 place-items-center border-l border-ink-200 text-ink-450 transition hover:text-ink-800"
                onClick={() => setShowKey((current) => !current)}
                aria-label={showKey ? "隐藏 API Key" : "显示 API Key"}
              >
                {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            )}
            onChange={(ApiKey) => onChange({ ApiKey })}
          />
        </SettingsTable>

        <button
          type="button"
          className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-md border border-ink-200 bg-paper-50 px-2.5 text-[12px] font-medium text-ink-600 transition hover:border-terra-200 hover:bg-terra-50 hover:text-terra-700"
          onClick={() => setAdvancedOpen((current) => !current)}
        >
          <Settings2 className="h-3.5 w-3.5" />
          {advancedOpen ? "收起高级字段" : "高级字段"}
        </button>

        {advancedOpen ? (
          <div className="mt-3">
            <SettingsTable>
              <TextRow
                icon={<Settings2 className="h-3.5 w-3.5" />}
                label="API 版本"
                value={provider.ApiVersion ?? ""}
                disabled={disabled || pending}
                placeholder="需要时填写"
                onChange={(ApiVersion) => onChange({ ApiVersion })}
              />
              <HeadersEditor
                headers={provider.Headers ?? {}}
                disabled={disabled || pending}
                onChange={(Headers) => onChange({ Headers })}
              />
            </SettingsTable>
          </div>
        ) : null}

        <div className="mt-4">
          <ProviderCatalogStatus catalog={catalog} error={error} loading={loading} expanded disabled={!enabled} />
          {dirty ? (
            <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] leading-5 text-amber-800">
            当前模型列表检测会使用这些可见值；只有点击保存才会保存连接字段。
            </p>
          ) : null}
          {localError ? <ProviderFormError message={localError} /> : null}
          {operationError ? <ProviderFormError message={operationError} /> : null}
        </div>
        </div>
      </ScrollArea>
      <div className="shrink-0 border-t border-ink-200/70 bg-paper-50 px-3 py-3">
        <div className="mx-auto flex w-full max-w-[420px] items-center justify-between gap-2">
          <ProviderConnectionStatusBadge dirty={dirty} operation={operation} />
          <div className="flex shrink-0 items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={disabled || pending || !dirty}
            onClick={onCancel}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            取消
          </Button>
          <Button
            size="sm"
            disabled={confirmDisabled}
            onClick={onConfirm}
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            保存
          </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function HeadersEditor({
  disabled,
  headers,
  onChange,
}: {
  disabled: boolean;
  headers: Record<string, string>;
  onChange: (headers: Record<string, string>) => void;
}): JSX.Element {
  const entries = Object.entries(headers);
  return (
    <SettingRow icon={<Settings2 className="h-3.5 w-3.5" />} label="请求头">
      <div className="grid gap-2">
        {entries.map(([key, value], index) => (
          <div key={`${key}:${index}`} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <input
              value={key}
              placeholder="Header"
              disabled={disabled}
              className={inputClassName}
              onChange={(event) => {
                const next = [...entries];
                next[index] = [event.currentTarget.value, value];
                onChange(Object.fromEntries(next.filter(([entryKey]) => entryKey.trim())));
              }}
            />
            <input
              value={value}
              placeholder="Value"
              disabled={disabled}
              className={inputClassName}
              onChange={(event) => {
                const next = [...entries];
                next[index] = [key, event.currentTarget.value];
                onChange(Object.fromEntries(next));
              }}
            />
            <IconAction
              label="删除请求头"
              danger
              disabled={disabled}
              onClick={() => onChange(Object.fromEntries(entries.filter((_, entryIndex) => entryIndex !== index)))}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </IconAction>
          </div>
        ))}
        <button
          type="button"
          disabled={disabled}
          className="inline-flex h-8 w-fit items-center gap-1.5 rounded-md border border-dashed border-ink-300 bg-paper-50 px-2.5 text-[12px] text-ink-600 transition hover:border-terra-300 hover:text-terra-700 disabled:pointer-events-none disabled:opacity-50"
          onClick={() => onChange({ ...headers, [nextHeaderKey(headers)]: "" })}
        >
          <Plus className="h-3.5 w-3.5" />
          添加请求头
        </button>
      </div>
    </SettingRow>
  );
}

function readProviderConnectionSubtitle({
  dirty,
  enabled,
  operation,
  protectedProvider,
  providerModelCount,
}: {
  dirty: boolean;
  enabled: boolean;
  operation?: SettingsConfigCommands["providerEndpointOperations"][string];
  protectedProvider: boolean;
  providerModelCount: number;
}): string {
  if (operation?.status === "pending") {
    return "正在保存连接配置";
  }
  if (operation?.status === "error") {
    return "上次保存失败";
  }
  const identity = protectedProvider ? "内置身份" : "自定义身份";
  const state = enabled ? "已启用" : "已关闭";
  const draft = dirty ? "有未确认修改" : "连接字段已同步";
  return `${identity} · ${state} · ${providerModelCount} 个已配置模型 · ${draft}`;
}
