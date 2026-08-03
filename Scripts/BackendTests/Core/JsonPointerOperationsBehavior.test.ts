import { describe, expect, test } from "vitest";
import {
  parseAgentJsonPointer,
  readAgentJsonPointer,
  replaceAgentJsonPointer,
} from "../../../Source/AgentSystem/Core/AgentJsonPointerOperations.js";

describe("JSON Pointer operations", () => {
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
});
