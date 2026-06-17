import { describe, expect, it } from "vitest";
import {
  readNumberDraftCommitValue,
  validatePluginConfigDraft,
  writeDraftFieldValue,
} from "./PluginConfigPanel";
import { parse as parseToml, type TomlTableWithoutBigInt } from "smol-toml";
import type { PluginConfigField, PluginConfigSection } from "../../api/eventTypes";

describe("readNumberDraftCommitValue", () => {
  it("does not coerce empty or incomplete number drafts to zero", () => {
    expect(readNumberDraftCommitValue("")).toBeNull();
    expect(readNumberDraftCommitValue("-")).toBeNull();
    expect(readNumberDraftCommitValue("1.")).toBeNull();
    expect(readNumberDraftCommitValue("1e")).toBeNull();
    expect(readNumberDraftCommitValue("1e-")).toBeNull();
  });

  it("accepts finite number drafts once they are complete", () => {
    expect(readNumberDraftCommitValue("1.5")).toBe(1.5);
    expect(readNumberDraftCommitValue("-2")).toBe(-2);
    expect(readNumberDraftCommitValue("1e-3")).toBe(0.001);
  });
});

describe("validatePluginConfigDraft", () => {
  it("rejects number values outside metadata constraints", () => {
    const field = configField({
      key: "timeout_ms",
      path: ["weather", "timeout_ms"],
      type: "number",
      label: "请求超时",
      min: 1000,
      max: 300000,
      step: 1000,
    });
    const sections = [configSection("weather", [field])];

    expect(validatePluginConfigDraft(sections, parseDraft("[weather]\ntimeout_ms = 1\n"))).toEqual([
      "请求超时 不能小于 1000",
      "请求超时 必须按 1000 递增",
    ]);
    expect(validatePluginConfigDraft(sections, parseDraft("[weather]\ntimeout_ms = 15000\n"))).toEqual([]);
  });

  it("rejects option values outside the declared list", () => {
    const field = configField({
      key: "provider",
      path: ["weather", "provider"],
      type: "string",
      label: "天气服务",
      options: ["qweather", "weatherapi"],
    });
    const sections = [configSection("weather", [field])];

    expect(validatePluginConfigDraft(sections, parseDraft("[weather]\nprovider = \"unknown\"\n"))).toEqual([
      "天气服务 必须是允许的选项",
    ]);
  });
});

describe("writeDraftFieldValue", () => {
  it("updates a visual field without rewriting unrelated comments", () => {
    const draft = [
      "[weather]",
      "# qweather: 默认服务，更适合中文城市名和国内天气。",
      "provider = \"qweather\"",
      "timeout_ms = 15000",
      "",
    ].join("\n");
    const field = configField({
      key: "provider",
      path: ["weather", "provider"],
      type: "string",
    });

    expect(writeDraftFieldValue(draft, field, "weatherapi")).toContain(
      "# qweather: 默认服务，更适合中文城市名和国内天气。\nprovider = \"weatherapi\"",
    );
  });
});

function parseDraft(toml: string): TomlTableWithoutBigInt {
  return parseToml(toml) as TomlTableWithoutBigInt;
}

function configSection(name: string, fields: PluginConfigField[]): PluginConfigSection {
  return {
    name,
    keyCount: fields.length,
    toml: "",
    fields,
  };
}

function configField(input: Partial<PluginConfigField> & Pick<PluginConfigField, "key" | "path" | "type">): PluginConfigField {
  return {
    section: input.path.slice(0, -1).join("."),
    value: undefined,
    ...input,
  };
}
