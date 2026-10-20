import { describe, expect, it } from "vitest";
import {
  createSettingsSearchEntries,
  groupSettingsSectionResults,
  readSettingsSectionGroup,
  searchSettingsSectionResults,
  searchSettingsSections,
  settingsSectionGroups,
} from "../../../Frontend/src/features/settings/settingsPresentation.ts";
import {
  defaultSettingsSectionId,
  isSettingsSectionId,
  readSettingsSection,
  settingsSections,
} from "../../../Frontend/src/features/settings/types.ts";

describe("settings presentation", () => {
  it("uses the first visible navigation item as the default", () => {
    expect(defaultSettingsSectionId).toBe("model-service");
    expect(settingsSections[0].id).toBe(defaultSettingsSectionId);
  });

  it("contains only formal settings sections", () => {
    expect(settingsSections.map((section) => section.id)).toEqual([
      "model-service",
      "model-roles",
      "runtime",
      "prompt",
      "planning",
      "retrieval",
      "system-tools",
      "dependencies",
      "channels",
      "general",
      "appearance",
      "storage",
      "about",
    ]);
    expect(isSettingsSectionId("tools")).toBe(false);
    expect(isSettingsSectionId("memory")).toBe(false);
    expect(isSettingsSectionId("system")).toBe(false);
  });

  it("declares section-owned header treatment instead of deriving it from section ids", () => {
    expect(settingsSections.find((section) => section.id === "model-service")?.headerMode).toBe("local");
    expect(settingsSections.find((section) => section.id === "runtime")?.headerMode).toBe("none");
    expect(settingsSections.find((section) => section.id === "system-tools")?.headerMode).toBe("none");
    expect(settingsSections.find((section) => section.id === "general")?.headerMode).toBe("none");
    expect(settingsSections.find((section) => section.id === "appearance")?.headerMode).toBe("none");
    expect(settingsSections.find((section) => section.id === "planning")?.headerMode).toBe("global");
  });

  it("uses section semantics instead of generic tool or download glyphs", () => {
    expect(readSettingsSection("dependencies").icon).toBe("server");
    expect(readSettingsSection("general").icon).toBe("sliders");
  });

  it("resolves retired section ids to the sections that absorbed them", () => {
    expect(readSettingsSection("mcp-servers").id).toBe("system-tools");
    expect(readSettingsSection("workspace").id).toBe("storage");
    expect(readSettingsSection("storage").id).toBe("storage");
  });

  it("groups navigation in product-domain order", () => {
    expect(settingsSectionGroups).toEqual([
      { id: "model", label: "模型", sectionIds: ["model-service", "model-roles"] },
      {
        id: "capabilities",
        label: "能力与运行",
        sectionIds: ["runtime", "prompt", "planning", "retrieval"],
      },
      { id: "tools", label: "工具", sectionIds: ["system-tools", "dependencies", "channels"] },
      { id: "personal", label: "个人", sectionIds: ["general", "appearance"] },
      { id: "system", label: "系统", sectionIds: ["storage", "about"] },
    ]);
    expect(readSettingsSectionGroup("appearance").label).toBe("个人");
  });

  it("keeps search results attached to their groups", () => {
    const groupBy = (query) =>
      groupSettingsSectionResults(searchSettingsSectionResults(settingsSections, query)).map(({ group, results }) => ({
        label: group.label,
        ids: results.map((result) => result.section.id),
      }));

    expect(groupBy("模型")).toEqual([{ label: "模型", ids: ["model-service", "model-roles"] }]);
    expect(groupBy("检索")).toEqual([{ label: "能力与运行", ids: ["retrieval"] }]);
  });

  it("searches concrete config fields", () => {
    const entries = createSettingsSearchEntries([
      {
        name: "runtime",
        label: "运行",
        fields: [
          {
            key: "Host",
            path: ["Server", "Host"],
            label: "服务 Host",
            description: "配置服务地址",
          },
        ],
      },
    ]);

    expect(searchSettingsSectionResults(settingsSections, "Host", entries)[0]).toMatchObject({
      section: { id: "runtime" },
      details: [{ label: "字段", value: "服务 Host" }],
    });
  });
  it("routes declared model assignments to the model roles workspace", () => {
    const entries = createSettingsSearchEntries([
      {
        name: "models",
        label: "模型",
        fields: [
          {
            key: "DefaultModelProviderId",
            path: ["DefaultModelProviderId"],
            label: "默认模型",
            modelSelection: { presentation: "central" },
          },
          {
            key: "ModelProviders",
            path: ["ModelProviders"],
            label: "模型列表",
          },
        ],
      },
    ]);

    expect(searchSettingsSectionResults(settingsSections, "默认模型", entries)[0]).toMatchObject({
      section: { id: "model-roles" },
      details: [{ label: "字段", value: "默认模型" }],
    });
    expect(searchSettingsSectionResults(settingsSections, "模型列表", entries)[0]).toMatchObject({
      section: { id: "model-service" },
      details: [{ label: "字段", value: "模型列表" }],
    });
  });
  it("searches labels, descriptions, ids, and group names", () => {
    expect(searchSettingsSections(settingsSections, "供应商").map((section) => section.id)).toEqual(["model-service"]);
    expect(searchSettingsSections(settingsSections, "个人").map((section) => section.id)).toEqual([
      "general",
      "appearance",
    ]);
    expect(searchSettingsSections(settingsSections, "storage").map((section) => section.id)).toEqual(["storage"]);
    expect(searchSettingsSectionResults(settingsSections, "占用")[0]).toMatchObject({
      section: { id: "storage" },
      details: [{ label: "说明" }],
    });
  });
});
