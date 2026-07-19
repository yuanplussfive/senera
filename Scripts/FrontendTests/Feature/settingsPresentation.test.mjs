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
      "default-model",
      "runtime",
      "planning",
      "retrieval",
      "skills",
      "general",
      "appearance",
      "storage",
      "about",
    ]);
    expect(isSettingsSectionId("tools")).toBe(false);
    expect(isSettingsSectionId("memory")).toBe(false);
    expect(isSettingsSectionId("system")).toBe(false);
  });

  it("groups navigation in product-domain order", () => {
    expect(settingsSectionGroups).toEqual([
      { id: "model", label: "模型", sectionIds: ["model-service", "default-model"] },
      {
        id: "capabilities",
        label: "能力与运行",
        sectionIds: ["runtime", "planning", "retrieval", "skills"],
      },
      { id: "personal", label: "个人", sectionIds: ["general", "appearance"] },
      { id: "system", label: "系统", sectionIds: ["storage", "about"] },
    ]);
    expect(readSettingsSectionGroup("appearance").label).toBe("个人");
  });

  it("keeps search results attached to their groups", () => {
    const grouped = groupSettingsSectionResults(searchSettingsSectionResults(settingsSections, "模型"));
    expect(
      grouped.map(({ group, results }) => ({
        label: group.label,
        ids: results.map((result) => result.section.id),
      })),
    ).toEqual([
      { label: "模型", ids: ["model-service", "default-model"] },
      { label: "能力与运行", ids: ["retrieval"] },
    ]);
  });

  it("searches concrete config fields, skills, and tools", () => {
    const entries = createSettingsSearchEntries(
      [
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
      ],
      [
        {
          name: "DocumentPlugin",
          title: "文档处理",
          description: "处理文档",
          sections: [{ fields: [{ key: "RootDir", path: ["RootDir"], label: "文档目录" }] }],
          tools: [{ name: "DocumentTool", summary: "读取文档" }],
        },
      ],
    );

    expect(searchSettingsSectionResults(settingsSections, "Host", entries)[0]).toMatchObject({
      section: { id: "runtime" },
      details: [{ label: "字段", value: "服务 Host" }],
    });
    expect(searchSettingsSectionResults(settingsSections, "DocumentPlugin", entries)[0]).toMatchObject({
      section: { id: "skills" },
      details: [{ label: "技能", value: "文档处理" }],
    });
    expect(searchSettingsSectionResults(settingsSections, "DocumentTool", entries)[0]).toMatchObject({
      section: { id: "skills" },
      details: [{ label: "工具", value: "DocumentTool" }],
    });
  });
  it("searches labels, descriptions, ids, and group names", () => {
    expect(searchSettingsSections(settingsSections, "供应商").map((section) => section.id)).toEqual(["model-service"]);
    expect(searchSettingsSections(settingsSections, "个人").map((section) => section.id)).toEqual([
      "general",
      "appearance",
    ]);
    expect(searchSettingsSections(settingsSections, "storage").map((section) => section.id)).toEqual(["storage"]);
    expect(searchSettingsSectionResults(settingsSections, "上传")[0]).toMatchObject({
      section: { id: "storage" },
      details: [{ label: "说明" }],
    });
  });
});
