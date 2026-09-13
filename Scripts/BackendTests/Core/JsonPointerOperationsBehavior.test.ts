import { describe, expect, test } from "vitest";
import {
  parseAgentJsonPointer,
  readAgentJsonPointer,
  readAgentJsonPointerMatches,
  replaceAgentJsonPointer,
} from "../../../Source/AgentSystem/Core/AgentJsonPointerOperations.js";

describe("JSON Pointer operations", () => {
  test("supports the RFC 6901 empty pointer for the document root", () => {
    expect(parseAgentJsonPointer("")).toEqual([]);
    expect(readAgentJsonPointer({ value: 1 }, "")).toEqual({ found: true, value: { value: 1 } });
    expect(replaceAgentJsonPointer({ value: 1 }, "", { value: 2 })).toEqual({ value: 2 });
  });

  test("uses one RFC 6901 implementation for escaped lookup and immutable replacement", () => {
    const source = { "a/b": { "c~d": ["before", "target"] } };
    const pointer = "/a~1b/c~0d/1";

    expect(parseAgentJsonPointer(pointer)).toEqual(["a/b", "c~d", "1"]);
    expect(readAgentJsonPointer(source, pointer)).toEqual({ found: true, value: "target" });
    expect(replaceAgentJsonPointer(source, pointer, "after")).toEqual({ "a/b": { "c~d": ["before", "after"] } });
    expect(source).toEqual({ "a/b": { "c~d": ["before", "target"] } });
  });

  test("rejects malformed pointer escapes consistently", () => {
    expect(() => parseAgentJsonPointer("/a~2b")).toThrow("Invalid JSON Pointer escape");
    expect(() => parseAgentJsonPointer("root")).toThrow("Invalid JSON Pointer");
  });

  test("resolves wildcard pointer patterns to concrete RFC pointers", () => {
    expect(
      readAgentJsonPointerMatches({ operations: [{ path: "a.ts" }, { path: "b.ts" }] }, "/operations/*/path"),
    ).toEqual([
      { pointer: "/operations/0/path", value: "a.ts" },
      { pointer: "/operations/1/path", value: "b.ts" },
    ]);
  });
});
