import { describe, expect, it } from "vitest";
import { readSettingsDraftInteraction } from "../../../Frontend/src/features/settings/settingsInteractionModel.ts";
describe("readSettingsDraftInteraction", () => {
  it("blocks save while the snapshot is loading", () => {
    expect(
      readSettingsDraftInteraction({
        dirty: false,
        ready: false,
        saving: false,
      }),
    ).toMatchObject({
      status: "loading",
      statusLabel: "等待加载",
      saveDisabled: true,
      saveTitle: "配置快照尚未加载",
      refreshDisabled: true,
    });
  });
  it("explains synced drafts as not saveable", () => {
    expect(
      readSettingsDraftInteraction({
        dirty: false,
        saving: false,
      }),
    ).toMatchObject({
      status: "synced",
      statusLabel: "已同步",
      detail: "没有未保存修改。",
      saveDisabled: true,
      saveTitle: "没有未保存修改",
    });
  });
  it("enables save for dirty valid drafts", () => {
    expect(
      readSettingsDraftInteraction({
        dirty: true,
        saving: false,
      }),
    ).toMatchObject({
      status: "dirty",
      statusLabel: "未保存",
      refreshLabel: "还原",
      saveDisabled: false,
      saveTitle: "保存当前草稿",
    });
  });
  it("blocks save on validation errors and keeps the reason visible", () => {
    expect(
      readSettingsDraftInteraction({
        dirty: true,
        saving: false,
        validationErrors: ["模型 ID 不能为空"],
      }),
    ).toMatchObject({
      status: "invalid",
      statusLabel: "需要修复",
      detail: "模型 ID 不能为空",
      saveDisabled: true,
      saveTitle: "请先修复校验错误：模型 ID 不能为空",
    });
  });
  it("allows retrying dirty drafts after backend save errors", () => {
    expect(
      readSettingsDraftInteraction({
        dirty: true,
        localError: "写入失败",
        saving: false,
      }),
    ).toMatchObject({
      status: "invalid",
      statusLabel: "需要修复",
      detail: "写入失败",
      saveDisabled: false,
      saveTitle: "重试保存当前草稿",
    });
  });
});
