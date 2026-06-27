import {
  BrainCircuit,
  Database,
  Plus,
  Search,
  Tags,
  Trash2,
} from "lucide-react";
import { cn } from "../../lib/util";
import {
  Button,
  Dialog,
  DialogContent,
  ScrollArea,
} from "../../shared/ui";
import {
  ModelProviderIcon,
  ModelProviderIconNames,
  type ModelProviderRuleMatchKind,
} from "./ModelProviderIcon";
import {
  createModelGroupDraft,
  normalizeModelGroupDraft,
  normalizeModelGroupStrategy,
  parseDelimitedValues,
  ModelGroupMatchOptions,
} from "./modelConfigData";
import type {
  ModelGroupDraft,
  ModelGroupStrategyDraft,
} from "./modelConfigTypes";
import {
  IconAction,
  MenuRow,
  MenuSelect,
  SettingRow,
  SettingsTable,
  TextRow,
  inputClassName,
} from "./ModelConfigPrimitives";

export function ModelGroupsDialog({
  open,
  groups,
  groupTemplate,
  disabled,
  onOpenChange,
  onChange,
  onResetDefault,
}: {
  open: boolean;
  groups: ModelGroupDraft[];
  groupTemplate: Record<string, unknown>;
  disabled: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (groups: ModelGroupDraft[]) => void;
  onResetDefault: () => void;
}): JSX.Element {
  const iconOptions = ModelProviderIconNames.map((icon) => ({ value: icon, label: icon }));

  const updateGroup = (index: number, patch: Partial<ModelGroupDraft>): void => {
    onChange(groups.map((group, groupIndex) =>
      groupIndex === index ? normalizeModelGroupDraft({ ...group, ...patch }) : group));
  };

  const updateStrategy = (
    groupIndex: number,
    strategyIndex: number,
    patch: Partial<ModelGroupStrategyDraft>,
  ): void => {
    const group = groups[groupIndex];
    if (!group) return;
    updateGroup(groupIndex, {
      Strategies: group.Strategies.map((strategy, index) =>
        index === strategyIndex ? normalizeModelGroupStrategy({ ...strategy, ...patch }) : strategy),
    });
  };

  const addStrategy = (groupIndex: number): void => {
    const group = groups[groupIndex];
    if (!group) return;
    updateGroup(groupIndex, {
      Strategies: [...group.Strategies, { Match: "prefix", Values: [] }],
    });
  };

  const removeStrategy = (groupIndex: number, strategyIndex: number): void => {
    const group = groups[groupIndex];
    if (!group) return;
    updateGroup(groupIndex, {
      Strategies: group.Strategies.filter((_, index) => index !== strategyIndex),
    });
  };

  const addGroup = (): void => {
    onChange([...groups, createModelGroupDraft(groupTemplate, groups)]);
  };

  const removeGroup = (index: number): void => {
    onChange(groups.filter((_, groupIndex) => groupIndex !== index));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="模型分组"
        description="按模型名称规则自动归类，默认规则来自模型图标规则。"
        motionPreset="focus"
        className="h-[min(760px,calc(100dvh_-_48px))] w-[min(880px,calc(100vw_-_32px))] max-w-none rounded-xl bg-paper-50"
        bodyClassName="flex min-h-0 flex-col"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-ink-200/70 bg-paper-100 px-5 py-3">
          <div className="min-w-0 text-[12px] text-ink-500">
            {groups.length} 个分组，按顺序匹配，第一个命中的分组生效。
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" disabled={disabled} onClick={onResetDefault}>
              恢复默认
            </Button>
            <Button size="sm" disabled={disabled} onClick={addGroup}>
              <Plus className="h-3.5 w-3.5" />
              新增
            </Button>
          </div>
        </div>
        <ScrollArea className="min-h-0 flex-1" viewportClassName="h-full">
          <div className="space-y-3 px-5 py-4">
            {groups.map((group, index) => (
              <section key={`${group.Id}:${index}`} className="border border-ink-200/70 bg-paper-100">
                <div className="flex min-w-0 items-center justify-between gap-3 border-b border-ink-200/70 px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <ModelProviderIcon icon={group.Icon} size={18} className="rounded" />
                    <span className="truncate text-[13px] font-semibold text-ink-850">
                      {group.Label || group.Id || "未命名分组"}
                    </span>
                  </div>
                  <IconAction label="删除分组" danger disabled={disabled} onClick={() => removeGroup(index)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </IconAction>
                </div>
                <SettingsTable>
                  <TextRow
                    icon={<Tags className="h-3.5 w-3.5" />}
                    label="名称"
                    value={group.Label}
                    disabled={disabled}
                    placeholder="分组名称"
                    onChange={(Label) => updateGroup(index, { Label })}
                  />
                  <TextRow
                    icon={<Database className="h-3.5 w-3.5" />}
                    label="ID"
                    value={group.Id}
                    disabled={disabled}
                    placeholder="唯一 ID"
                    onChange={(Id) => updateGroup(index, { Id })}
                  />
                  <MenuRow icon={<BrainCircuit className="h-3.5 w-3.5" />} label="图标">
                    <MenuSelect
                      value={group.Icon ?? ""}
                      placeholder="选择图标"
                      options={iconOptions}
                      disabled={disabled}
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
                      onChange={(Icon) => updateGroup(index, { Icon })}
                    />
                  </MenuRow>
                  <SettingRow icon={<Search className="h-3.5 w-3.5" />} label="策略">
                    <div className="grid gap-2">
                      {group.Strategies.map((strategy, strategyIndex) => (
                        <div
                          key={strategyIndex}
                          className="grid gap-2 rounded-md border border-ink-200 bg-paper-50 p-2 sm:grid-cols-[150px_minmax(0,1fr)_auto]"
                        >
                          <MenuSelect
                            value={strategy.Match}
                            placeholder="匹配方式"
                            options={[...ModelGroupMatchOptions]}
                            disabled={disabled}
                            onChange={(Match) => updateStrategy(index, strategyIndex, {
                              Match: Match as ModelProviderRuleMatchKind,
                            })}
                          />
                          <input
                            type="text"
                            value={strategy.Values.join(", ")}
                            disabled={disabled}
                            placeholder="多个词用逗号分隔"
                            className={cn(inputClassName, "rounded-md border border-ink-200 bg-paper-50")}
                            onChange={(event) => updateStrategy(index, strategyIndex, {
                              Values: parseDelimitedValues(event.currentTarget.value),
                            })}
                          />
                          <IconAction
                            label="删除策略"
                            danger
                            disabled={disabled || group.Strategies.length <= 1}
                            onClick={() => removeStrategy(index, strategyIndex)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </IconAction>
                        </div>
                      ))}
                      <button
                        type="button"
                        disabled={disabled}
                        className="inline-flex h-8 w-fit items-center gap-1.5 rounded-md border border-ink-200 bg-paper-50 px-2.5 text-[12px] text-ink-650 transition hover:border-terra-200 hover:bg-terra-50 hover:text-terra-700 disabled:pointer-events-none disabled:opacity-50"
                        onClick={() => addStrategy(index)}
                      >
                        <Plus className="h-3.5 w-3.5" />
                        新增策略
                      </button>
                    </div>
                  </SettingRow>
                </SettingsTable>
              </section>
            ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
