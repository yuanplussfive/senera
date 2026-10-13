import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { resolveWorkspaceRoot } from "../../../Scripts/WorkspaceRoot.ts";

const {
  aggregateMeasureValues,
  formatMeasureValue,
  projectToolCallCardLabel,
  projectToolActivityInspection,
  readTypedAtPointer,
  renderActivityTemplate,
  selectActivityVariant,
} = await import("../../../Frontend/src/features/workflow/toolActivityPresentation.ts");
const { projectToolBatchActivity } = await import("../../../Frontend/src/features/workflow/ToolBatchActivity.tsx");

function localized(value) {
  return { "zh-CN": value, "en-US": value };
}

const OperationLabels = {
  add: localized("新增"),
  update: localized("编辑"),
  write: localized("覆写"),
  delete: localized("删除"),
  move: localized("移动"),
};

/** The v2 block from the P2 design, kept verbatim so the design cannot drift. */
const WorkspacePatchV2 = {
  measures: [
    {
      id: "operationKind",
      from: "argument",
      pointer: "/operations",
      field: "kind",
      aggregate: "first",
      type: "enum",
      sign: "never",
      zero: "omit",
      labels: OperationLabels,
    },
    {
      id: "operationCount",
      from: "argument",
      pointer: "/operations",
      aggregate: "count",
      type: "number",
      sign: "never",
      zero: "omit",
    },
    {
      id: "primaryPath",
      from: "argument",
      pointer: "/operations",
      field: "path",
      aggregate: "first",
      type: "path",
      sign: "never",
      zero: "omit",
    },
    {
      id: "moveSource",
      from: "argument",
      pointer: "/operations",
      field: "source",
      aggregate: "first",
      type: "path",
      sign: "never",
      zero: "omit",
    },
    {
      id: "moveDestination",
      from: "argument",
      pointer: "/operations",
      field: "destination",
      aggregate: "first",
      type: "path",
      sign: "never",
      zero: "omit",
    },
    {
      id: "changedFiles",
      from: "result",
      pointer: "/changes",
      field: "key",
      where: { field: "kind", equals: "workspace" },
      aggregate: "count",
      type: "number",
      sign: "never",
      zero: "omit",
    },
    {
      id: "addedLines",
      from: "result",
      pointer: "/changes",
      field: "addedLines",
      where: { field: "kind", equals: "workspace" },
      aggregate: "sum",
      type: "delta",
      sign: "always",
      zero: "omit",
    },
    {
      id: "removedLines",
      from: "result",
      pointer: "/changes",
      field: "removedLines",
      where: { field: "kind", equals: "workspace" },
      aggregate: "sum",
      type: "delta",
      sign: "negative-only",
      zero: "omit",
    },
  ],
  variants: [
    {
      id: "singleMove",
      when: { measure: "operationKind", equals: "move" },
      title: "移动 {{moveSource}} → {{moveDestination}}",
    },
    {
      id: "single",
      when: { measure: "operationCount", equals: 1 },
      title: "{{operationKind}} {{primaryPath}} · {{addedLines}} {{removedLines}}",
    },
    {
      id: "batch",
      title: "修改 · {{operationCount}} 项 · {{changedFiles}} 个文件 · {{addedLines}} {{removedLines}}",
    },
  ],
  title: "修改 · {{operationCount}} 项操作",
};

function origin(activity) {
  return {
    kind: "system",
    name: "Workspace tools",
    presentation: {
      category: "workspace-patch",
      icon: "pencil",
      group: { id: "workspace", title: localized("工作区") },
      activity: { action: localized("修改"), ...activity },
    },
  };
}

function result(changes, workspaceObservation) {
  return {
    type: "senera.tool_result_presentation.v1",
    version: 1,
    status: "success",
    headline: "已应用补丁",
    facts: [],
    evidence: [],
    changes,
    ...(workspaceObservation ? { workspaceObservation } : {}),
  };
}

function workspaceChange(key, addedLines, removedLines, workspaceStatus = "modified") {
  return {
    kind: "workspace",
    status: "changed",
    key,
    summary: `modified: ${key}`,
    workspaceStatus,
    addedLines,
    removedLines,
  };
}

function patchLabel({ operations, changes, v2 = WorkspacePatchV2 }) {
  return projectToolActivityInspection({
    toolName: "WorkspaceApplyPatch",
    origin: origin({ v2 }),
    arguments: { operations },
    result: changes ? result(changes) : undefined,
    status: "completed",
  }).label;
}

test("tool call card titles retain the registered tool identity beside activity summaries", () => {
  const patchTitle = projectToolCallCardLabel({
    toolName: "WorkspaceApplyPatch",
    origin: origin({ v2: WorkspacePatchV2 }),
    arguments: { operations: [{ kind: "add", path: "src/new.ts", content: "export {}" }] },
    status: "completed",
  });
  expect(patchTitle).toContain("WorkspaceApplyPatch");
  expect(patchTitle).toContain("新增");
  expect(patchTitle).toContain("src/new.ts");

  const mcpTitle = projectToolCallCardLabel({
    toolName: "get_file",
    origin: { kind: "mcp", name: "github", server: "github", tool: "get_file" },
    arguments: { path: "README.md" },
    status: "completed",
  });
  expect(mcpTitle).toContain("github");
  expect(mcpTitle).toContain("get_file");
});

test("typed pointer reading distinguishes an absent pointer from an empty collection", () => {
  const value = { operations: [{ kind: "update" }, { kind: "add" }], nested: { list: [1, 2] } };

  expect(readTypedAtPointer(value, "/operations")).toEqual([[{ kind: "update" }, { kind: "add" }]]);
  expect(readTypedAtPointer(value, "/operations/*/kind")).toEqual(["update", "add"]);
  expect(readTypedAtPointer(value, "/nested/list")).toEqual([[1, 2]]);
  expect(readTypedAtPointer(value, "/operations/1/kind")).toEqual(["add"]);
  expect(readTypedAtPointer(value, "/missing")).toEqual([]);
  expect(readTypedAtPointer(value, "/operations/9")).toEqual([]);
  expect(readTypedAtPointer(undefined, "/operations")).toEqual([]);
});

test("every aggregate reduces the entries a measure addresses", () => {
  const changes = [
    workspaceChange("src/app.ts", 12, -3),
    { kind: "evidence", status: "unchanged", key: "senera://evidence/a", summary: "evidence" },
    workspaceChange("src/b.ts", 33, -9),
  ];
  const measure = (overrides) => ({
    id: "value",
    from: "result",
    pointer: "/changes",
    aggregate: "first",
    type: "text",
    sign: "never",
    zero: "omit",
    ...overrides,
  });
  const workspaceOnly = { field: "kind", equals: "workspace" };

  expect(aggregateMeasureValues(measure({ field: "key" }), { changes })).toBe("src/app.ts");
  expect(aggregateMeasureValues(measure({ aggregate: "count" }), { changes })).toBe(3);
  // `where` filters before aggregation, so evidence entries never join a file count.
  expect(aggregateMeasureValues(measure({ aggregate: "count", field: "key", where: workspaceOnly }), { changes })).toBe(
    2,
  );
  expect(
    aggregateMeasureValues(measure({ aggregate: "sum", type: "delta", field: "addedLines", where: workspaceOnly }), {
      changes,
    }),
  ).toBe(45);
  expect(
    aggregateMeasureValues(measure({ aggregate: "max", type: "number", field: "addedLines", where: workspaceOnly }), {
      changes,
    }),
  ).toBe(33);
  expect(aggregateMeasureValues(measure({ aggregate: "join", field: "key", separator: ", " }), { changes })).toBe(
    "src/app.ts, senera://evidence/a, src/b.ts",
  );
});

test("an absent collection yields no value while an empty one counts as zero", () => {
  const measure = {
    id: "changedFiles",
    from: "result",
    pointer: "/changes",
    field: "key",
    where: { field: "kind", equals: "workspace" },
    aggregate: "count",
    type: "number",
    sign: "never",
    zero: "omit",
  };

  expect(aggregateMeasureValues(measure, { changes: [] })).toBe(0);
  expect(aggregateMeasureValues(measure, {})).toBeUndefined();
  expect(aggregateMeasureValues(measure, undefined)).toBeUndefined();
  // No numeric entry survives the filter, so a sum has no value instead of 0.
  expect(
    aggregateMeasureValues(
      { ...measure, aggregate: "sum", type: "delta", field: "addedLines" },
      { changes: [{ kind: "evidence", addedLines: "n/a" }] },
    ),
  ).toBeUndefined();
});

test("delta formatting owns the sign and the zero policy", () => {
  const delta = (overrides = {}) => ({ type: "delta", sign: "always", zero: "omit", ...overrides });

  expect(formatMeasureValue(12, delta())).toBe("+12");
  expect(formatMeasureValue(-3, delta())).toBe("−3");
  expect(formatMeasureValue(0, delta())).toBe("");
  expect(formatMeasureValue(0, delta({ zero: "show" }))).toBe("+0");
  expect(formatMeasureValue(-3, delta({ sign: "positive-only" }))).toBe("3");
  expect(formatMeasureValue(12, delta({ sign: "positive-only" }))).toBe("+12");
  expect(formatMeasureValue(3, delta({ sign: "negative-only" }))).toBe("−3");
  // Results such as removedLines are counts, but older projections may have
  // already encoded the direction. The declaration normalizes both shapes.
  expect(formatMeasureValue(-3, delta({ sign: "negative-only" }))).toBe("−3");
  expect(formatMeasureValue(-3, delta({ sign: "never" }))).toBe("−3");
  expect(formatMeasureValue(12, delta({ sign: "never" }))).toBe("12");
  expect(formatMeasureValue(12.345, delta({ precision: 1, unit: "行" }))).toBe("+12.3行");
  expect(formatMeasureValue(undefined, delta())).toBe("");
});

test("tool discovery activity uses concise verbs from the shipped contracts", () => {
  const workspaceRoot = resolveWorkspaceRoot();
  const searchContract = JSON.parse(
    readFileSync(
      path.join(workspaceRoot, "System", "Extensions", "knowledge", "tool-search", "tools", "ToolSearch.tool.json"),
      "utf8",
    ),
  );
  const describeContract = JSON.parse(
    readFileSync(
      path.join(workspaceRoot, "System", "Extensions", "knowledge", "tool-search", "tools", "ToolDescribe.tool.json"),
      "utf8",
    ),
  );
  const projectDeclaredActivity = (contract, argumentsValue) =>
    projectToolActivityInspection({
      toolName: contract.name,
      origin: {
        kind: "system",
        name: "tool-search",
        presentation: {
          ...contract.presentation,
          group: { id: "tool-discovery", title: localized("工具") },
        },
      },
      arguments: argumentsValue,
      status: "completed",
    }).label;

  expect(projectDeclaredActivity(searchContract, { query: "workspace patch" })).toBe("查找工具 · workspace patch");
  expect(projectDeclaredActivity(describeContract, { tools: ["WorkspaceRead"] })).toBe("查看工具 · WorkspaceRead");
});

test("number, enum, boolean and path formatting stay deterministic", () => {
  expect(formatMeasureValue(3, { type: "number", sign: "never", zero: "omit" })).toBe("3");
  expect(formatMeasureValue(1500, { type: "number", unit: "ms", sign: "never", zero: "omit" })).toBe("1500ms");
  expect(formatMeasureValue(12.345, { type: "number", precision: 1, sign: "never", zero: "omit" })).toBe("12.3");
  expect(formatMeasureValue("not-a-number", { type: "number", sign: "never", zero: "omit" })).toBe("");

  const labels = { update: localized("编辑"), true: localized("是") };
  expect(formatMeasureValue("update", { type: "enum", sign: "never", zero: "omit", labels })).toBe("编辑");
  // A missing mapping falls back to the raw value instead of dropping it.
  expect(formatMeasureValue("unmapped", { type: "enum", sign: "never", zero: "omit", labels })).toBe("unmapped");
  expect(formatMeasureValue(true, { type: "boolean", sign: "never", zero: "omit", labels })).toBe("是");
  expect(formatMeasureValue(false, { type: "boolean", sign: "never", zero: "omit", labels })).toBe("false");

  expect(formatMeasureValue("  src/app.ts  ", { type: "path", sign: "never", zero: "omit" })).toBe("src/app.ts");
  expect(formatMeasureValue(undefined, { type: "text", sign: "never", zero: "omit" })).toBe("");
});

test("template rendering collapses whitespace and removes separators a missing value would strand", () => {
  const values = new Map([
    ["operationCount", "3"],
    ["addedLines", ""],
    ["removedLines", "−12"],
  ]);

  expect(renderActivityTemplate("修改 · {{operationCount}} 项操作 · {{addedLines}} {{removedLines}}", values)).toBe(
    "修改 · 3 项操作 · −12",
  );
  expect(renderActivityTemplate("{{addedLines}} {{removedLines}}", values)).toBe("−12");
  expect(renderActivityTemplate("{{addedLines}}", values)).toBe("");
  // Every placeholder in the only segment is empty, so the segment goes with
  // them: a dangling `移动文件 →` is the same empty shell the rule exists to
  // prevent. The caller then degrades to the v1 label.
  expect(renderActivityTemplate("移动文件 {{source}} → {{destination}}", new Map())).toBe("");
  expect(renderActivityTemplate("移动文件 {{source}} → {{destination}}", new Map([["source", "src/old.ts"]]))).toBe(
    "移动文件 src/old.ts →",
  );
});

test("variants match in array order and the fallback catches the rest", () => {
  const variants = WorkspacePatchV2.variants;

  expect(
    selectActivityVariant(
      variants,
      new Map([
        ["operationKind", "move"],
        ["operationCount", 1],
      ]),
    )?.id,
  ).toBe("singleMove");
  expect(
    selectActivityVariant(
      variants,
      new Map([
        ["operationKind", "update"],
        ["operationCount", 1],
      ]),
    )?.id,
  ).toBe("single");
  expect(
    selectActivityVariant(
      variants,
      new Map([
        ["operationKind", "update"],
        ["operationCount", 3],
      ]),
    )?.id,
  ).toBe("batch");
  expect(selectActivityVariant([], new Map())).toBeUndefined();
});

test("a single edit renders its concise action, filename, and exact line deltas", () => {
  expect(
    patchLabel({
      operations: [{ kind: "update", path: "src/app.ts" }],
      changes: [workspaceChange("src/app.ts", 12, 3)],
    }),
  ).toBe("编辑 app.ts +12 −3");
});

test("a delete keeps the zero addition alongside its removed-line count", () => {
  expect(
    patchLabel({
      operations: [{ kind: "delete", path: "src/legacy.ts" }],
      changes: [workspaceChange("src/legacy.ts", 0, 42, "deleted")],
    }),
  ).toBe("删除 legacy.ts +0 −42");
});

test("the move variant wins over the single-operation variant", () => {
  expect(
    patchLabel({
      operations: [{ kind: "move", path: "src/new.ts", source: "src/old.ts", destination: "src/new.ts" }],
    }),
  ).toBe("移动 src/old.ts → src/new.ts");
});

test("a mixed file batch aggregates its summary while retaining distinct per-file actions", () => {
  expect(
    patchLabel({
      operations: [
        { kind: "add", path: "src/a.ts" },
        { kind: "update", path: "src/b.ts" },
        { kind: "delete", path: "src/c.ts" },
      ],
      changes: [
        workspaceChange("src/a.ts", 20, 0, "added"),
        workspaceChange("src/b.ts", 25, 12),
        workspaceChange("src/c.ts", 0, 0, "deleted"),
      ],
    }),
  ).toBe("变更 3 个文件 +45 −12");
});

test("a missing result shrinks the label without stranding a separator or a sign", () => {
  expect(
    patchLabel({
      operations: [
        { kind: "add", path: "src/a.ts" },
        { kind: "update", path: "src/b.ts" },
        { kind: "delete", path: "src/c.ts" },
      ],
    }),
  ).toBe("修改 · 3 项");
});

test("evidence changes never join the workspace file count", () => {
  expect(
    patchLabel({
      operations: [
        { kind: "add", path: "src/a.ts" },
        { kind: "update", path: "src/b.ts" },
        { kind: "delete", path: "src/c.ts" },
      ],
      changes: [
        workspaceChange("src/a.ts", 20, 0, "added"),
        { kind: "evidence", status: "unchanged", key: "senera://evidence/a", summary: "evidence" },
        workspaceChange("src/b.ts", 25, -12),
        workspaceChange("src/c.ts", 0, 0, "deleted"),
      ],
    }),
  ).toBe("变更 3 个文件 +45 −12");
});

test("standard workspace changes project file rows without per-tool row declarations", () => {
  const inspection = projectToolActivityInspection({
    toolName: "ShellCommandTool",
    origin: { kind: "system", name: "Shell" },
    arguments: { command: "apply changes" },
    result: result([
      workspaceChange("src/app.ts", 12, 3),
      { kind: "evidence", status: "unchanged", key: "senera://evidence/a", summary: "evidence" },
    ]),
    status: "completed",
  });

  expect(inspection.rows).toEqual([
    {
      label: "编辑 app.ts +12 −3",
      action: "编辑",
      path: "src/app.ts",
      addedLines: 12,
      removedLines: 3,
      status: "modified",
    },
  ]);
  expect(inspection.label).toBe("编辑 app.ts +12 −3");
});

test("directory workspace entries do not inflate the file activity summary", () => {
  const inspection = projectToolActivityInspection({
    toolName: "ShellCommandTool",
    origin: { kind: "system", name: "Shell" },
    arguments: { command: "create output" },
    result: result([
      workspaceChange("pelican-bicycle.svg", 170, 0, "added"),
      {
        kind: "workspace",
        status: "changed",
        key: "images",
        summary: "added: images",
        workspaceStatus: "added",
        workspaceBeforeKind: "missing",
        workspaceAfterKind: "directory",
      },
    ]),
    status: "completed",
  });

  expect(inspection.label).toBe("新增 1 个文件，1 个文件夹 +170 −0");
  expect(inspection.rows).toHaveLength(1);
  expect(inspection.rows?.[0]?.path).toBe("pelican-bicycle.svg");
});

test("directory-only workspace changes remain a summary without line deltas", () => {
  const inspection = projectToolActivityInspection({
    toolName: "ShellCommandTool",
    origin: { kind: "system", name: "Shell" },
    arguments: { command: "create folder" },
    result: result([
      {
        kind: "workspace",
        status: "changed",
        key: "images",
        summary: "added: images",
        workspaceStatus: "added",
        workspaceBeforeKind: "missing",
        workspaceAfterKind: "directory",
      },
    ]),
    status: "completed",
  });

  expect(inspection.label).toBe("新增 1 个文件夹");
  expect(inspection.rows).toBeUndefined();
});

test("observed workspace changes stay at batch scope and summarize files separately from folders", () => {
  const observed = {
    status: "complete",
    coverage: "observed",
    scope: { kind: "tool_batch", id: "batch-1" },
    beforeEntryCount: 0,
    afterEntryCount: 2,
    changedFileCount: 1,
    changedDirectoryCount: 1,
    warningCount: 0,
  };
  const changes = [
    {
      kind: "workspace",
      status: "changed",
      key: "pelican-bicycle.svg",
      summary: "added: pelican-bicycle.svg",
      workspaceStatus: "added",
      workspaceBeforeKind: "missing",
      workspaceAfterKind: "file",
      addedLines: 170,
      removedLines: 0,
    },
    {
      kind: "workspace",
      status: "changed",
      key: "images",
      summary: "added: images",
      workspaceStatus: "added",
      workspaceBeforeKind: "missing",
      workspaceAfterKind: "directory",
    },
  ];
  const activity = projectToolBatchActivity({
    steps: [
      {
        id: "tool-1",
        kind: "tool",
        toolName: "WorkspaceRead",
        status: "done",
        toolBatch: { id: "batch-1", index: 0, size: 2, executionMode: "parallel" },
        toolPresentation: result(changes, observed),
      },
      {
        id: "tool-2",
        kind: "tool",
        toolName: "ShellCommandTool",
        status: "done",
        toolBatch: { id: "batch-1", index: 1, size: 2, executionMode: "parallel" },
        toolPresentation: result([], observed),
      },
    ],
  });

  expect(activity?.workspaceSummary?.label).toBe("新增 1 个文件，1 个文件夹");
  expect(activity?.workspaceSummary?.accessibleLabel).toBe("新增 1 个文件，1 个文件夹 +170 −0");
  expect(activity?.items[0]?.label).not.toContain("文件夹");
});

test("a v2 title that renders empty degrades to the v1 label, never to a raw dump", () => {
  const withoutV2 = projectToolActivityInspection({
    toolName: "WorkspaceApplyPatch",
    origin: origin({ argumentPath: "/operations/*/path" }),
    arguments: { operations: [{ kind: "update", path: "src/app.ts" }] },
    status: "completed",
  }).label;
  expect(withoutV2).toBe("修改 · src/app.ts");

  const emptyTitle = projectToolActivityInspection({
    toolName: "WorkspaceApplyPatch",
    origin: origin({
      argumentPath: "/operations/*/path",
      v2: {
        measures: [{ id: "missing", from: "result", pointer: "/absent", type: "path", sign: "never", zero: "omit" }],
        variants: [],
        title: "{{missing}}",
      },
    }),
    arguments: { operations: [{ kind: "update", path: "src/app.ts" }] },
    status: "completed",
  }).label;
  expect(emptyTitle).toBe(withoutV2);
});

test("env measures read the closed host facts without gaining any other read", () => {
  const inspection = projectToolActivityInspection({
    toolName: "ShellCommandTool",
    origin: origin({
      v2: {
        measures: [
          {
            id: "toolName",
            from: "env",
            pointer: "/toolName",
            aggregate: "first",
            type: "text",
            sign: "never",
            zero: "omit",
          },
          {
            id: "durationMs",
            from: "env",
            pointer: "/durationMs",
            aggregate: "first",
            type: "number",
            unit: "ms",
            sign: "never",
            zero: "omit",
          },
        ],
        variants: [],
        title: "{{toolName}} · {{durationMs}}",
      },
    }),
    arguments: {},
    durationMs: 1500,
    status: "completed",
  });

  expect(inspection.label).toBe("ShellCommandTool · 1500ms");
});

test("an argument-side enum label drives the variant and the rendered title", () => {
  const inspection = projectToolActivityInspection({
    toolName: "GitInspect",
    origin: origin({
      v2: {
        measures: [
          {
            id: "operation",
            from: "argument",
            pointer: "/operation",
            aggregate: "first",
            type: "enum",
            sign: "never",
            zero: "omit",
            labels: { status: localized("工作区状态"), diff: localized("差异") },
          },
        ],
        variants: [],
        title: "检查 Git · {{operation}}",
      },
    }),
    arguments: { operation: "diff" },
    status: "completed",
  });

  expect(inspection.label).toBe("检查 Git · 差异");
});

function readOrigin() {
  return {
    kind: "system",
    name: "Workspace tools",
    presentation: {
      category: "workspace-read",
      icon: "file-text",
      group: { id: "workspace-read", title: localized("工作区读取") },
      activity: { action: localized("读取文件"), argumentPath: "/path" },
    },
  };
}

function toolStep(overrides = {}) {
  return {
    id: "step-1",
    kind: "tool",
    toolName: "WorkspaceApplyPatch",
    toolOrigin: origin({ v2: WorkspacePatchV2 }),
    toolArgs: { operations: [{ kind: "update", path: "src/app.ts" }] },
    toolPresentation: result([workspaceChange("src/app.ts", 12, 3)]),
    durationMs: 320,
    status: "done",
    ...overrides,
  };
}

test("a batch reads one step identically in its header and in that step's row", () => {
  const model = projectToolBatchActivity({ steps: [toolStep()] });

  expect(model.label).toBe("编辑 app.ts +12 −3");
  expect(model.items.map((item) => item.label)).toEqual([model.label]);
});

test("a multi-tool header names the first tool while the disclosure keeps every row", () => {
  const model = projectToolBatchActivity({
    steps: [
      toolStep(),
      toolStep({
        id: "step-2",
        toolName: "WorkspaceRead",
        toolOrigin: readOrigin(),
        toolArgs: { path: ".tmp/persona.txt" },
        toolPresentation: undefined,
      }),
    ],
  });

  expect(model.items.map((item) => item.label)).toEqual(["编辑 app.ts +12 −3", "读取文件 · .tmp/persona.txt"]);
  // Enumerating every call in the header grew with the batch; the disclosure
  // below is where the full list lives.
  expect(model.label).toBe("编辑 app.ts +12 −3");
});

test("a legacy truncation envelope never reaches the row as raw JSON", () => {
  // Builds before shape-preserving projection replaced oversized arguments with
  // `{ __truncated, preview }`. Enumerating that marker printed
  // `__truncated=true · preview=[{"operations":[{"ki…` on the row. Historical
  // traces still carry it, so it must degrade to the declared action instead.
  const legacy = {
    __truncated: true,
    preview: '{"operations":[{"kind":"update","path":"src/app.ts"',
  };

  const inspection = projectToolActivityInspection({
    toolName: "WorkspaceApplyPatch",
    origin: origin({}),
    arguments: legacy,
    status: "completed",
  });

  expect(inspection.argumentPreview ?? "").not.toContain("__truncated");
  expect(inspection.argumentPreviewParts.join(" ")).not.toContain("__truncated");
  expect(inspection.label).not.toContain("__truncated");
  expect(inspection.label).not.toContain("preview=");
  // The declared action survives; only the unreadable argument detail is gone.
  expect(inspection.label).toBe("修改");
});

test("a legacy envelope alongside declared pointers still renders the pointer value", () => {
  const inspection = projectToolActivityInspection({
    toolName: "WorkspaceApplyPatch",
    origin: origin({ argumentPath: "/operations/*/path" }),
    arguments: { __truncated: true, preview: "…" },
    status: "completed",
  });

  expect(inspection.label).not.toContain("__truncated");
  expect(inspection.label).toBe("修改");
});

test("projected arguments keep the declared pointers readable on the row", () => {
  // Shape-preserving projection keeps `/operations/*/kind` and `/path`, which is
  // what the v2 template reads. A large body shrinks without breaking them.
  const body = "x".repeat(40_000);
  const inspection = projectToolActivityInspection({
    toolName: "WorkspaceApplyPatch",
    origin: origin({
      v2: {
        measures: [
          {
            id: "operationKind",
            from: "argument",
            pointer: "/operations",
            field: "kind",
            aggregate: "first",
            type: "enum",
            sign: "never",
            zero: "omit",
            labels: OperationLabels,
          },
          {
            id: "primaryPath",
            from: "argument",
            pointer: "/operations",
            field: "path",
            aggregate: "first",
            type: "path",
            sign: "never",
            zero: "omit",
          },
        ],
        variants: [{ id: "single", title: "{{operationKind}} {{primaryPath}}" }],
        title: "{{operationKind}} {{primaryPath}}",
      },
    }),
    arguments: { operations: [{ kind: "update", path: "src/app.ts", newStr: body }] },
    status: "completed",
  });

  expect(inspection.label).toBe("编辑 src/app.ts");
});
