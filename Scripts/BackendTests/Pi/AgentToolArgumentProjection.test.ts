import { describe, expect, test } from "vitest";
import {
  DefaultAgentToolArgumentProjection,
  projectAgentToolArguments,
  truncateUtf8,
} from "../../../Source/AgentSystem/Core/AgentToolArgumentProjection.js";
import { readAgentJsonPointer } from "../../../Source/AgentSystem/Core/AgentJsonPointerOperations.js";
import { collectAgentToolPresentationArgumentPointers } from "../../../Source/AgentSystem/SystemTools/AgentSystemToolPresentation.js";
import type {
  AgentToolPresentation,
  AgentToolPresentationMeasure,
} from "../../../Source/AgentSystem/Types/AgentToolPresentationTypes.js";

const localized = (text: string) => ({ "zh-CN": text, "en-US": text });

const policy = (
  keepPointers: readonly string[],
  overrides: Partial<typeof DefaultAgentToolArgumentProjection> = {},
) => ({
  keepPointers,
  ...DefaultAgentToolArgumentProjection,
  ...overrides,
});

/** The v2 measure defaults the contract schema would apply. */
const measure = (
  overrides: Partial<AgentToolPresentationMeasure> & Pick<AgentToolPresentationMeasure, "id" | "pointer">,
): AgentToolPresentationMeasure => ({
  from: "argument",
  aggregate: "first",
  type: "text",
  sign: "never",
  zero: "omit",
  ...overrides,
});

function presentation(activity: AgentToolPresentation["activity"]): AgentToolPresentation {
  return {
    category: "test",
    icon: "tools",
    group: { id: "test", title: localized("Test") },
    activity,
  };
}

describe("projectAgentToolArguments", () => {
  test("keeps every declared pointer addressable on a large patch payload", () => {
    const body = "x".repeat(20_000);
    const value = {
      operations: [{ kind: "update", path: "src/app.ts", oldStr: body, newStr: `${body}y` }],
    };

    const projected = projectAgentToolArguments(
      value,
      policy(["/operations", "/operations/*/kind", "/operations/*/path"]),
    );

    // The declared reads still resolve — this is what regressed before, when
    // the whole object was replaced by an unaddressable envelope.
    expect(readAgentJsonPointer(projected.value, "/operations/0/kind")).toEqual({ found: true, value: "update" });
    expect(readAgentJsonPointer(projected.value, "/operations/0/path")).toEqual({ found: true, value: "src/app.ts" });
    // Undeclared leaves shrink instead of disappearing.
    const oldStr = readAgentJsonPointer(projected.value, "/operations/0/oldStr");
    expect(oldStr.found).toBe(true);
    expect(String(oldStr.value).length).toBeLessThan(body.length);
    expect(projected.omissions.some((omission) => omission.path === "/operations/0/oldStr")).toBe(true);
  });

  test("never produces the legacy truncation envelope", () => {
    const value = { operations: [{ kind: "add", path: "a.ts", content: "y".repeat(30_000) }] };
    const projected = projectAgentToolArguments(value, policy(["/operations/*/kind"]));
    expect(JSON.stringify(projected.value)).not.toContain("__truncated");
    expect(projected.value).toBeTypeOf("object");
  });

  test("keeps declared array entries beyond the fan-out cap", () => {
    const value = {
      operations: Array.from({ length: 64 }, (_, index) => ({ kind: "add", path: `f${index}.ts` })),
    };
    // A small cap must not drop a path the contract declared: the measure reads
    // every entry, so index 63 has to stay readable.
    const projected = projectAgentToolArguments(value, policy(["/operations/*/kind"], { maxArrayEntries: 4 }));
    expect(readAgentJsonPointer(projected.value, "/operations/63/kind")).toEqual({ found: true, value: "add" });
    expect(projected.value).toMatchObject({ operations: expect.any(Array) });
  });

  test("preserves array positions so pointers do not re-index", () => {
    const value = { operations: [{ kind: "a" }, { kind: "b" }, { kind: "c" }] };
    // Only entry 2 is declared; entries 0 and 1 must still occupy their slots.
    const projected = projectAgentToolArguments(value, policy(["/operations/2/kind"]));
    const operations = readAgentJsonPointer(projected.value, "/operations");
    expect((operations.value as readonly unknown[]).length).toBe(3);
    expect(readAgentJsonPointer(projected.value, "/operations/2/kind")).toEqual({ found: true, value: "c" });
  });

  test("records a branch omission when entries are skipped", () => {
    const value = { operations: Array.from({ length: 200 }, () => ({ kind: "add" })) };
    const projected = projectAgentToolArguments(value, policy(["/operations/0/kind"], { maxArrayEntries: 2 }));
    expect(projected.omissions.some((omission) => omission.reason === "branch_limit")).toBe(true);
  });

  test("records deviations by RFC 6901 path with an escaped token", () => {
    const value = { "a/b": "z".repeat(5000) };
    const projected = projectAgentToolArguments(value, policy([], { maxLeafBytes: 64 }));
    const omission = projected.omissions.find((entry) => entry.path === "/a~1b");
    expect(omission).toBeDefined();
    expect(omission?.reason).toBe("token_limit");
    // The escaped path must read back through the same reader that produced it.
    expect(readAgentJsonPointer(projected.value, "/a~1b").found).toBe(true);
  });

  test("keeps the shape when no pointer is declared", () => {
    const value = { exitCode: 1, stdout: "o".repeat(9_000), nested: { keep: true } };
    const projected = projectAgentToolArguments(value, policy([], { maxLeafBytes: 128 }));
    expect(projected.value).toMatchObject({ exitCode: 1 });
    expect(readAgentJsonPointer(projected.value, "/nested/keep")).toEqual({ found: true, value: true });
    expect(String(readAgentJsonPointer(projected.value, "/stdout").value).length).toBeLessThan(9_000);
  });

  test("passes scalars through untouched when they fit", () => {
    expect(projectAgentToolArguments(7, policy(["/x"])).value).toBe(7);
    expect(projectAgentToolArguments(true, policy(["/x"])).value).toBe(true);
    expect(projectAgentToolArguments("short", policy(["/x"])).value).toBe("short");
  });
});

describe("truncateUtf8", () => {
  test("does not split a multi-byte sequence", () => {
    // Each CJK character is 3 UTF-8 bytes; a UTF-16 slice would cut mid-character.
    const value = "上".repeat(100);
    const { text, truncated } = truncateUtf8(value, 10);
    expect(truncated).toBe(true);
    expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(10);
    // A broken slice would leave U+FFFD replacement characters behind.
    expect(text).not.toContain("�");
  });

  test("returns short values unchanged", () => {
    expect(truncateUtf8("ok", 64)).toEqual({ text: "ok", truncated: false });
  });
});

describe("collectAgentToolPresentationArgumentPointers", () => {
  test("gathers every argument-side pointer source", () => {
    const pointers = collectAgentToolPresentationArgumentPointers(
      presentation({
        action: localized("Edit"),
        argumentPath: "/path",
        detailPaths: ["/operations/*/source"],
        v2: {
          measures: [
            measure({ id: "kind", pointer: "/operations", field: "kind" }),
            measure({ id: "changed", pointer: "/changes", from: "result" }),
          ],
          variants: [
            {
              id: "move",
              when: { measure: "kind", equals: "move" },
              argumentPath: "/operations/0/destination",
            },
          ],
        },
      }),
    );
    expect(pointers).toContain("/path");
    expect(pointers).toContain("/operations/*/source");
    expect(pointers).toContain("/operations");
    // A measure reading `field` off each entry needs the entry-relative path too.
    expect(pointers).toContain("/operations/*/kind");
    // Variants may refine the pointers, so they are reads as well.
    expect(pointers).toContain("/operations/0/destination");
    // `result` measures are not argument reads.
    expect(pointers).not.toContain("/changes");
  });

  test("keeps the `where` filter field addressable", () => {
    const pointers = collectAgentToolPresentationArgumentPointers(
      presentation({
        action: localized("Edit"),
        v2: {
          measures: [
            measure({
              id: "count",
              pointer: "/operations",
              field: "path",
              where: { field: "kind", equals: "delete" },
            }),
          ],
          variants: [],
        },
      }),
    );
    expect(pointers).toContain("/operations/*/path");
    expect(pointers).toContain("/operations/*/kind");
  });

  test("returns nothing for an absent presentation", () => {
    expect(collectAgentToolPresentationArgumentPointers(undefined)).toEqual([]);
  });
});
