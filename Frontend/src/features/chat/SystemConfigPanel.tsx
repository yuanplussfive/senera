import {
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  AlertTriangle,
  BrainCircuit,
  Check,
  FolderCog,
  Loader2,
  RefreshCw,
  Route,
  Save,
  Search,
  Settings,
  ShieldAlert,
  SlidersHorizontal,
} from "lucide-react";
import type {
  ConfigMutationState,
  ConfigSnapshotData,
  ProviderModelEndpointInput,
  ProviderModelsFailedData,
  ProviderModelsSnapshotData,
} from "../../api/eventTypes";
import { cn } from "../../lib/util";
import {
  Button,
  Dialog,
  DialogContent,
  ScrollArea,
  Tooltip,
} from "../../shared/ui";
import {
  JsonConfigSettingsView,
  validateJsonConfigDraft,
  type JsonConfigObject,
} from "../../shared/config/JsonConfigForm";
import { ModelConfigView } from "./ModelConfigView";
import { PlanningConfigView } from "./PlanningConfigView";
import { VectorModelConfigView } from "./VectorModelConfigView";

export function SystemConfigControl({
  disabled,
  operation,
  snapshot,
  providerModelCatalogs,
  providerModelErrors,
  providerModelLoadingIds,
  onRefresh,
  onSave,
  onFetchProviderModels,
}: {
  disabled: boolean;
  operation: ConfigMutationState | null;
  snapshot: ConfigSnapshotData | null;
  providerModelCatalogs: Record<string, ProviderModelsSnapshotData>;
  providerModelErrors: Record<string, ProviderModelsFailedData & { updatedAt: string }>;
  providerModelLoadingIds: Record<string, boolean>;
  onRefresh: () => void;
  onSave: (config: Record<string, unknown>) => string | null;
  onFetchProviderModels: (providerId: string, force?: boolean, endpoint?: ProviderModelEndpointInput) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [contentReady, setContentReady] = useState(false);
  const [draft, setDraft] = useState<JsonConfigObject>({});
  const [selectedSection, setSelectedSection] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saveRequestId, setSaveRequestId] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const currentSnapshotVersion = snapshot?.version;
  const sectionList = snapshot?.form.sections ?? [];
  const visibleSections = useMemo(
    () => selectedSection
      ? sectionList.filter((section) => section.name === selectedSection)
      : sectionList.slice(0, 1),
    [sectionList, selectedSection],
  );
  const saveOperation = saveRequestId && operation?.requestId === saveRequestId ? operation : null;
  const saving = saveOperation?.status === "pending";
  const refreshDisabled = saving || !snapshot;
  const diagnostics = snapshot?.diagnostics ?? [];
  const hasDiagnostics = diagnostics.length > 0;
  const formValidationErrors = useMemo(
    () => snapshot ? validateJsonConfigDraft(snapshot.form.sections, draft) : [],
    [draft, snapshot],
  );

  useEffect(() => {
    if (!open) {
      setContentReady(false);
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setContentReady(true);
    }, 48);
    return () => window.clearTimeout(timeoutId);
  }, [open]);

  useEffect(() => {
    if (!open || !snapshot) return;
    setDraft(snapshot.value);
    setDirty(false);
    setSelectedSection((current) =>
      current && snapshot.form.sections.some((section) => section.name === current)
        ? current
        : snapshot.form.sections[0]?.name ?? null);
    setSaveRequestId(null);
    setLocalError(null);
  }, [currentSnapshotVersion, open, snapshot]);

  useEffect(() => {
    if (!saveOperation) return;
    if (saveOperation.status === "success") {
      setSaveRequestId(null);
      setDirty(false);
      setLocalError(null);
      return;
    }
    if (saveOperation.status === "error") {
      setSaveRequestId(null);
      setLocalError(saveOperation.message ?? "主配置保存失败");
    }
  }, [saveOperation]);

  const updateDraft = (value: JsonConfigObject): void => {
    const currentSnapshot = snapshot;
    setDraft(value);
    setDirty(currentSnapshot ? !sameJson(value, currentSnapshot.value) : false);
    setLocalError(null);
  };

  const save = (): void => {
    if (!dirty || saving) return;
    const errors = snapshot ? validateJsonConfigDraft(snapshot.form.sections, draft) : [];
    if (errors.length > 0) {
      setLocalError(errors[0] ?? "主配置表单校验失败");
      return;
    }
    const requestId = onSave(draft);
    if (requestId) {
      setSaveRequestId(requestId);
    }
  };

  const refreshOrRestore = (): void => {
    if (!snapshot || saving) return;
    if (dirty) {
      setDraft(snapshot.value);
      setDirty(false);
      setSaveRequestId(null);
      setLocalError(null);
      return;
    }
    onRefresh();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip content="主配置" side="top">
        <button
          type="button"
          className={cn(
            "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[11px]",
            "text-ink-500 transition hover:bg-ink-900/[0.045] hover:text-ink-800",
            "focus:outline-none focus:ring-2 focus:ring-terra-200/60",
            disabled && "pointer-events-none opacity-55",
          )}
          aria-label="主配置"
          disabled={disabled}
          onClick={() => setOpen(true)}
        >
          <Settings className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">配置</span>
          {hasDiagnostics ? <AlertTriangle className="h-3.5 w-3.5 text-amber-500" /> : null}
        </button>
      </Tooltip>

      <DialogContent
        title="主配置"
        description={snapshot?.path ?? "等待配置快照"}
        motionPreset="focus"
        className="h-[min(900px,calc(100dvh_-_20px))] max-h-none w-[min(1280px,calc(100vw_-_20px))] max-w-none rounded-xl bg-paper-100 sm:w-[min(1280px,calc(100vw_-_32px))]"
        bodyClassName="flex min-h-0 flex-1 bg-paper-100"
      >
        <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-[#f7f3ea] lg:grid-cols-[220px_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
          <ConfigSectionNav
            sections={sectionList}
            selectedSection={selectedSection}
            onSelect={setSelectedSection}
          />
          <section className="flex min-h-0 min-w-0 flex-col overflow-hidden border-b border-ink-200/70 bg-paper-50 lg:border-b-0">
            <MobileSectionNav
              sections={sectionList}
              selectedSection={selectedSection}
              onSelect={setSelectedSection}
            />
            <ConfigToolbar
              dirty={dirty}
              disabled={!snapshot || formValidationErrors.length > 0 || saving}
              refreshDisabled={refreshDisabled}
              localError={localError}
              validationErrors={formValidationErrors}
              saving={saving}
              onRefresh={refreshOrRestore}
              onSave={save}
            />
            <Diagnostics
              diagnostics={diagnostics}
              localError={localError}
              validationErrors={formValidationErrors}
            />
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {!contentReady ? (
                <ConfigPanelSkeleton />
              ) : snapshot ? (
                selectedSection === "models" ? (
                  <ModelConfigView
                    value={draft}
                    section={visibleSections[0]}
                    disabled={saving}
                    catalogs={providerModelCatalogs}
                    errors={providerModelErrors}
                    loadingProviderIds={providerModelLoadingIds}
                    onFetchProviderModels={onFetchProviderModels}
                    onChange={updateDraft}
                  />
                ) : selectedSection === "retrieval" ? (
                  <VectorModelConfigView
                    value={draft}
                    section={visibleSections[0]}
                    disabled={saving}
                    onChange={updateDraft}
                  />
                ) : selectedSection === "planning" ? (
                  <PlanningConfigView
                    value={draft}
                    section={visibleSections[0]}
                    disabled={saving}
                    onChange={updateDraft}
                  />
                ) : (
                  <JsonConfigSettingsView
                    sections={visibleSections}
                    value={draft}
                    disabled={saving}
                    onChange={updateDraft}
                  />
                )
              ) : (
                <div className="grid h-full place-items-center text-[13px] text-ink-400">
                  后端连接后会加载主配置
                </div>
              )}
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ConfigPanelSkeleton(): JSX.Element {
  return (
    <div className="grid h-full min-h-0 place-items-center bg-paper-50 text-[12.5px] text-ink-400">
      <div className="grid gap-2 text-center">
        <span className="mx-auto h-8 w-8 rounded-full border border-ink-200 bg-paper-100" />
        <span>加载配置面板</span>
      </div>
    </div>
  );
}

function ConfigToolbar({
  dirty,
  disabled,
  refreshDisabled,
  localError,
  validationErrors,
  saving,
  onRefresh,
  onSave,
}: {
  dirty: boolean;
  disabled: boolean;
  refreshDisabled: boolean;
  localError: string | null;
  validationErrors: string[];
  saving: boolean;
  onRefresh: () => void;
  onSave: () => void;
}): JSX.Element {
  const invalid = localError || validationErrors.length > 0;
  const statusLabel = invalid
    ? "需要修复"
    : dirty
      ? "未保存"
      : "已同步";

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-ink-200/70 bg-[#f3eee5] px-3.5 py-3">
      <div className="flex min-w-0 items-center gap-2">
        <span className={cn(
          "grid h-8 w-8 place-items-center border",
          invalid
            ? "border-brick-200 bg-brick-50 text-brick-600"
            : dirty
              ? "border-amber-200 bg-amber-50 text-amber-700"
              : "border-terra-200 bg-terra-50 text-terra-700",
        )}>
          {invalid ? (
            <AlertTriangle className="h-4 w-4" />
          ) : dirty ? (
            <Settings className="h-4 w-4" />
          ) : (
            <Check className="h-4 w-4" />
          )}
        </span>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-ink-900">{statusLabel}</div>
          <div className="mt-0.5 text-[11px] text-ink-500">
            按板块填写，未填写的项目会使用系统默认值
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <Button
          size="sm"
          variant="outline"
          disabled={refreshDisabled}
          onClick={onRefresh}
          className="h-8"
          title={dirty ? "放弃未保存修改并还原当前快照" : "刷新配置快照"}
        >
          <RefreshCw className={cn("h-3.5 w-3.5", saving && "animate-spin")} />
          {dirty ? "还原" : "刷新"}
        </Button>
        <Button
          size="sm"
          disabled={!dirty || disabled}
          onClick={onSave}
          className="h-8"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          保存
        </Button>
      </div>
    </div>
  );
}

function ConfigSectionNav({
  sections,
  selectedSection,
  onSelect,
}: {
  sections: ConfigSnapshotData["form"]["sections"];
  selectedSection: string | null;
  onSelect: (section: string) => void;
}): JSX.Element {
  return (
    <aside className="hidden min-h-0 border-r border-ink-200/70 bg-[#f2ece2] lg:flex lg:flex-col">
      <div className="shrink-0 border-b border-ink-200/70 px-3.5 py-3.5">
        <div className="text-[12px] font-semibold text-ink-900">配置板块</div>
        <div className="mt-1 text-[11px] text-ink-500">按功能分组填写</div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-1 p-2">
          {sections.map((section) => {
            const active = section.name === selectedSection;
            const Icon = sectionIcon(section.icon);
            return (
              <button
                key={section.name}
                type="button"
                className={cn(
                  "w-full rounded-md px-2.5 py-2 text-left transition",
                  active
                    ? "bg-paper-50 text-ink-900 shadow-panel"
                    : "text-ink-600 hover:bg-paper-50/70 hover:text-ink-900",
                )}
                onClick={() => onSelect(section.name)}
              >
                <span className="flex min-w-0 items-start gap-2">
                  <span className={cn(
                    "mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md border",
                    active ? "border-terra-200 bg-terra-50 text-terra-700" : "border-ink-200 bg-paper-100 text-ink-450",
                  )}>
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium">{section.label}</span>
                    {section.description ? (
                      <span className="mt-0.5 line-clamp-2 block text-[11px] leading-4 text-ink-500">
                        {section.description}
                      </span>
                    ) : null}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </ScrollArea>
    </aside>
  );
}

function MobileSectionNav({
  sections,
  selectedSection,
  onSelect,
}: {
  sections: ConfigSnapshotData["form"]["sections"];
  selectedSection: string | null;
  onSelect: (section: string) => void;
}): JSX.Element {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-ink-200/70 bg-[#f2ece2] px-2 py-2 lg:hidden">
      {sections.map((section) => {
        const Icon = sectionIcon(section.icon);
        return (
          <button
            key={section.name}
            type="button"
            className={cn(
              "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[12px] transition",
              section.name === selectedSection
                ? "bg-paper-50 text-ink-900 shadow-panel"
                : "text-ink-500 hover:bg-paper-50/70 hover:text-ink-900",
            )}
            onClick={() => onSelect(section.name)}
          >
            <Icon className="h-3.5 w-3.5" />
            {section.label}
          </button>
        );
      })}
    </div>
  );
}

function sectionIcon(icon: string | undefined): typeof Settings {
  switch (icon) {
    case "brain-circuit":
      return BrainCircuit;
    case "sliders-horizontal":
      return SlidersHorizontal;
    case "route":
      return Route;
    case "search":
      return Search;
    case "folder-cog":
      return FolderCog;
    case "shield-alert":
      return ShieldAlert;
    default:
      return Settings;
  }
}

function Diagnostics({
  diagnostics,
  localError,
  validationErrors,
}: {
  diagnostics: ConfigSnapshotData["diagnostics"];
  localError: string | null;
  validationErrors: string[];
}): JSX.Element | null {
  const items = [
    ...diagnostics,
    ...validationErrors.map((message) => ({ severity: "error" as const, message })),
    ...(localError ? [{ severity: "error" as const, message: localError }] : []),
  ];
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="shrink-0 space-y-1 border-b border-ink-200/60 bg-paper-50 px-3 py-2 sm:px-5">
      {items.slice(0, 4).map((item, index) => (
        <div
          key={`${item.severity}-${index}`}
          className={cn(
            "whitespace-pre-wrap border px-2 py-1.5 text-[12px]",
            item.severity === "error"
              ? "border-brick-200 bg-brick-50 text-brick-700"
              : "border-amber-200 bg-amber-50 text-amber-800",
          )}
        >
          {item.message}
        </div>
      ))}
      {items.length > 4 ? (
        <div className="px-1 text-[11px] text-ink-400">还有 {items.length - 4} 条诊断</div>
      ) : null}
    </div>
  );
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
