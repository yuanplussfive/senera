import type { Story } from "@ladle/react";
import { useState } from "react";
import { MenuSelect } from "./MenuSelect";
import { SettingsControlRow } from "./SettingsControlRow";
import { JsonConfigFieldControl } from "../config/JsonConfigFieldControl";

const fieldState = {
  section: "example",
  value: undefined,
  effectiveValue: undefined,
  configured: true,
  missing: false,
  valueSource: "explicit",
  required: false,
  essential: false,
} as const;

export const Default: Story = () => {
  const [value, setValue] = useState("standard");
  const [words, setWords] = useState<unknown>(["PATH"]);
  const [headers, setHeaders] = useState<unknown>({ Accept: "application/json" });
  return (
    <main className="min-h-[320px] bg-surface-canvas p-8 text-content-primary">
      <div className="mx-auto max-w-[720px] border-y border-line-subtle">
        <SettingsControlRow
          label="工作区字号"
          description="控制设置和工作台中的界面文字比例。"
          control={
            <MenuSelect
              value={value}
              placeholder="选择字号"
              options={[
                { value: "compact", label: "紧凑" },
                { value: "standard", label: "标准" },
                { value: "comfortable", label: "舒展" },
              ]}
              ariaLabel="工作区字号"
              onChange={setValue}
            />
          }
        />
        <JsonConfigFieldControl
          field={{
            ...fieldState,
            key: "includeOnly",
            path: ["ToolExecution", "Environment", "IncludeOnly"],
            label: "包含环境变量",
            type: "array",
            itemType: "string",
            placeholder: "PATH",
            description: "仅这些环境变量会传给工具执行进程。",
          }}
          value={words}
          disabled={false}
          onChange={setWords}
        />
        <JsonConfigFieldControl
          field={{
            ...fieldState,
            key: "headers",
            path: ["headers"],
            label: "请求头",
            type: "record",
            itemType: "string",
            keyPlaceholder: "名称",
            valuePlaceholder: "值",
          }}
          value={headers}
          disabled={false}
          onChange={setHeaders}
        />
      </div>
    </main>
  );
};
