import { describe, expect, it } from "vitest";
import {
  createSettingsDiagnostics,
  groupSettingsSectionResults,
  readSettingsSectionPlan,
  readSettingsSectionStatus,
  readSettingsSectionGroup,
  readSettingsWorkbenchSectionSummary,
  searchSettingsSectionResults,
  searchSettingsSections,
} from "../../../Frontend/src/features/settings/settingsPresentation.ts";
import { settingsSections } from "../../../Frontend/src/features/settings/types.ts";
describe("settingsPresentation", () => {
  it("puts model service/default model first and retires legacy IDs", () => {
    const sectionIds = settingsSections.map((section) => section.id);
    expect(sectionIds.slice(0, 3)).toEqual(["model-service", "default-model", "system"]);
    expect(sectionIds).not.toContain("providers");
    expect(sectionIds).not.toContain("models");
    expect(searchSettingsSections(settingsSections, "providers")).toEqual([]);
    expect(searchSettingsSections(settingsSections, "models")).toEqual([]);
  });

  it("marks currently implemented sections as configurable", () => {
    expect(readSettingsSectionStatus("appearance")).toBe("configurable");
    expect(readSettingsSectionStatus("general")).toBe("configurable");
    expect(readSettingsSectionStatus("system")).toBe("configurable");
    expect(readSettingsSectionStatus("model-service")).toBe("configurable");
    expect(readSettingsSectionStatus("default-model")).toBe("configurable");
    expect(readSettingsSectionStatus("skills")).toBe("configurable");
    expect(readSettingsSectionStatus("about")).toBe("configurable");
  });
  it("describes planned sections with concrete future owners", () => {
    expect(readSettingsSectionPlan("tools")).toEqual({
      title: "工具会迁入这里",
      items: ["工具权限", "调用确认策略", "运行安全边界"],
    });
  });
  it("creates diagnostics for the active app surface", () => {
    expect(
      createSettingsDiagnostics({
        appVersion: "1.2.3",
        frontendVersion: "0.4.5",
        mode: "development",
        isDesktop: true,
        section: "about",
      }),
    ).toEqual([
      { label: "应用版本", value: "1.2.3" },
      { label: "前端版本", value: "0.4.5" },
      { label: "运行模式", value: "development" },
      { label: "运行表面", value: "Electron 桌面端" },
      { label: "当前分区", value: "about" },
    ]);
  });
  it("returns every section for an empty search query", () => {
    expect(searchSettingsSections(settingsSections, "").map((section) => section.id)).toEqual(
      settingsSections.map((section) => section.id),
    );
  });
  it("matches migrated sections by label and description", () => {
    expect(searchSettingsSections(settingsSections, "供应商连接").map((section) => section.id)).toEqual([
      "model-service",
    ]);
    expect(searchSettingsSections(settingsSections, "默认模型").map((section) => section.id)).toEqual([
      "default-model",
    ]);
  });
  it("matches planned sections by future plan text without enabling them", () => {
    expect(searchSettingsSections(settingsSections, "运行安全边界")).toEqual([
      expect.objectContaining({
        id: "tools",
        enabled: false,
      }),
    ]);
  });
  it("groups settings sections into stable workbench domains", () => {
    const groups = groupSettingsSectionResults(searchSettingsSectionResults(settingsSections, ""));
    expect(
      groups.map((group) => ({
        label: group.group.label,
        sectionIds: group.results.map((result) => result.section.id),
      })),
    ).toEqual([
      { label: "模型服务", sectionIds: ["model-service", "default-model"] },
      { label: "体验", sectionIds: ["general", "appearance"] },
      {
        label: "运行能力",
        sectionIds: ["system", "runtime", "planning", "retrieval", "storage", "skills"],
      },
      { label: "规划中", sectionIds: ["tools", "memory", "integrations", "usage"] },
      { label: "支持", sectionIds: ["about"] },
    ]);
    expect(readSettingsSectionGroup("model-service")).toMatchObject({
      id: "model",
      label: "模型服务",
    });
  });
  it("matches section groups without enabling planned sections", () => {
    expect(searchSettingsSectionResults(settingsSections, "运行能力")).toEqual([]);
    expect(
      searchSettingsSectionResults(settingsSections, "规划中").map((result) => ({
        id: result.section.id,
        enabled: result.section.enabled,
      })),
    ).toEqual([
      { id: "tools", enabled: false },
      { id: "memory", enabled: false },
      { id: "integrations", enabled: false },
      { id: "usage", enabled: false },
    ]);
  });
  it("returns search details for section labels, descriptions, ids, and planned items", () => {
    expect(searchSettingsSectionResults(settingsSections, "供应商")).toEqual([
      expect.objectContaining({
        section: expect.objectContaining({ id: "model-service" }),
      }),
    ]);
    expect(searchSettingsSectionResults(settingsSections, "model-service")).toEqual([
      expect.objectContaining({
        section: expect.objectContaining({ id: "model-service" }),
        details: [{ label: "ID", value: "model-service" }],
      }),
    ]);
    expect(searchSettingsSectionResults(settingsSections, "运行安全边界")).toEqual([
      expect.objectContaining({
        section: expect.objectContaining({ id: "tools", enabled: false }),
        details: [{ label: "规划", value: "运行安全边界" }],
      }),
    ]);
  });
  it("limits each search result to two visible details", () => {
    const [result] = searchSettingsSectionResults(settingsSections, "运行环境");
    expect(result).toEqual(
      expect.objectContaining({
        section: expect.objectContaining({ id: "integrations" }),
        details: [
          { label: "描述", value: "外部服务、搜索和运行环境配置会在这里扩展。" },
          { label: "规划", value: "运行环境" },
        ],
      }),
    );
    expect(result?.details).toHaveLength(2);
  });
  it("summarizes planned sections with visible disabled reasons", () => {
    const tools = settingsSections.find((section) => section.id === "tools");
    expect(tools && readSettingsWorkbenchSectionSummary(tools)).toMatchObject({
      actionKind: "none",
      disabledReason: "仍处于 legacy compatibility（旧版兼容）阶段，完整功能迁移前不会打开空白设置页。",
      nextStepLabel: "等待能力规格",
      runtimeSurfaceLabel: "暂未开放",
      saveModelLabel: "迁移前置",
      statusLabel: "规划中",
      statusTone: "neutral",
    });
  });
  it("summarizes config-backed sections by shared draft state", () => {
    const modelService = settingsSections.find((section) => section.id === "model-service");
    expect(
      modelService &&
        readSettingsWorkbenchSectionSummary(modelService, {
          label: "未保存",
          state: "dirty",
        }),
    ).toMatchObject({
      actionSurfaceLabel: "在模型服务中即时保存",
      actionKind: "none",
      nextStepLabel: "检查当前操作状态",
      runtimeSurfaceLabel: "配置已连接",
      saveModelLabel: "按项即时保存",
      statusDetail: "模型服务有待处理的连接或模型操作。",
      statusLabel: "未保存",
      statusTone: "warning",
    });
  });
  it("summarizes skills separately from the shared config draft", () => {
    const skills = settingsSections.find((section) => section.id === "skills");
    expect(
      skills &&
        readSettingsWorkbenchSectionSummary(skills, {
          label: "需配置",
          state: "needs_attention",
        }),
    ).toMatchObject({
      actionKind: "none",
      nextStepLabel: "补齐插件配置",
      runtimeSurfaceLabel: "插件通道",
      saveModelLabel: "插件操作",
      statusLabel: "需配置",
      statusTone: "warning",
    });
  });
  it("keeps non-config sections from showing config loading state", () => {
    const appearance = settingsSections.find((section) => section.id === "appearance");
    const about = settingsSections.find((section) => section.id === "about");
    expect(appearance && readSettingsWorkbenchSectionSummary(appearance)).toMatchObject({
      runtimeSurfaceLabel: "本地偏好",
      runtimeSurfaceTone: "success",
      saveModelLabel: "即时应用",
    });
    expect(about && readSettingsWorkbenchSectionSummary(about)).toMatchObject({
      runtimeSurfaceLabel: "诊断视图",
      runtimeSurfaceTone: "neutral",
      saveModelLabel: "只读诊断",
    });
  });
  it("keeps config-backed sections in waiting state while config is still loading", () => {
    const modelService = settingsSections.find((section) => section.id === "model-service");
    expect(
      modelService &&
        readSettingsWorkbenchSectionSummary(modelService, {
          label: "加载中",
          state: "idle",
        }),
    ).toMatchObject({
      actionSurfaceLabel: "在模型服务中即时保存",
      runtimeSurfaceLabel: "等待配置",
      runtimeSurfaceTone: "neutral",
      statusLabel: "加载中",
    });
  });
  it("keeps system config actions owned by the content workspace", () => {
    const system = settingsSections.find((section) => section.id === "system");
    expect(
      system &&
        readSettingsWorkbenchSectionSummary(system, {
          label: "已同步",
          state: "synced",
        }),
    ).toMatchObject({
      actionKind: "config",
      actionSurfaceLabel: "在配置工作区保存",
      actionSurfaceDetail: "刷新、还原和保存由下方主配置工作区处理。",
      nextStepLabel: "在工作区继续编辑",
    });
  });
});
